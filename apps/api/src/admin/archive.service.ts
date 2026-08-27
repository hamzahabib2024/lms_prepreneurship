import { Injectable, Logger } from "@nestjs/common";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Response } from "express";
import { AppError } from "@lms/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { StorageRegistry } from "../content/storage/storage.registry";
import { BackupService } from "./backup.service";
import { getActor } from "../prisma/actor-context";
import { ZipWriter, readZip, MAX_TOTAL } from "./zip";

/**
 * THE RECORDS ARCHIVE — one file, two audiences.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS IS, AND WHY IT IS NOT THE BACKUP MODULE BESIDE IT.
 *
 * backup.service.ts writes every database ROW as gzipped NDJSON and can load it
 * back. It is excellent at its job and has two gaps that this exists to close:
 *
 *   1. IT CONTAINS NO FILES. A payment slip is a `storageKey` STRING in a row;
 *      the JPEG lives behind StorageRegistry. Restoring that archive gives you
 *      a database full of references to images nobody has any more.
 *
 *   2. IT NEVER LEAVES THE SERVER. Archives are written to BACKUP_DIR, on the
 *      same machine as the database they protect, so one disk takes both.
 *
 * A BACKUP RESTORES THE SYSTEM; AN ARCHIVE SURVIVES IT. The distinction is the
 * whole design. `records/` is folders and CSVs a person opens on a laptop with
 * no LMS installed — the thing you want in 2029 when a student disputes a fee.
 * `system/` is the machine-readable payload, byte-for-byte the format
 * backup.service.ts already writes, so restoring reuses that module rather than
 * inventing a second and weaker one. `files/` is the bytes both of them refer
 * to, and it is the part nothing else in the System has ever captured.
 *
 * `records/` IS NEVER THE RESTORE SOURCE. A CSV loses types, nulls, ids and
 * relations, and covers a fraction of the sixty-odd tables — sessions, audit
 * entries, rubric criteria, enrolments. Restoring from it would produce a
 * plausible-looking System quietly missing half its state.
 * ─────────────────────────────────────────────────────────────────────────────
 */
@Injectable()
export class ArchiveService {
  private readonly logger = new Logger(ArchiveService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageRegistry,
    private readonly backups: BackupService,
  ) {}

  // ============================================================== export ====

  /**
   * Builds the archive and writes it to the response as it goes.
   *
   * STREAMED, NEVER ASSEMBLED. A term of photographed slips is hundreds of
   * megabytes; an implementation that concatenates them into one Buffer works
   * on a laptop with eight students and takes the server down with eight
   * hundred. Every entry is pushed to the socket the moment it is built, and
   * only the ZIP's central directory — a few dozen bytes per file — is held.
   */
  async export(res: Response, opts: { sessionId?: string }, ip?: string): Promise<void> {
    const actor = getActor();
    if (!actor) throw new AppError("AUTH_TOKEN_INVALID");

    const started = Date.now();
    const takenAt = new Date();
    const stamp = takenAt.toISOString().slice(0, 10);
    const name = `prepreneurship-archive-${stamp}`;

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${name}.zip"`);
    // The whole Institute in one file. Never a shared cache.
    res.setHeader("Cache-Control", "private, no-store");

    const zip = new ZipWriter();
    const manifest: Array<{ path: string; bytes: number; sha256: string }> = [];
    const missing: string[] = [];

    /** Writes one entry out and records it in the manifest. */
    const put = (path: string, data: Buffer): void => {
      res.write(zip.push({ path: `${name}/${path}`, data, modified: takenAt }));
      manifest.push({
        path,
        bytes: data.length,
        sha256: createHash("sha256").update(data).digest("hex"),
      });
    };

    try {
      // ---------------------------------------------------------- records --
      const students = await this.studentRecords(opts.sessionId);

      put("README.txt", Buffer.from(this.readme(takenAt, students.length), "utf8"));

      for (const s of students) {
        const dir = `records/students/${safeFolder(s.registrationNo)}`;
        put(`${dir}/registration.json`, Buffer.from(JSON.stringify(s.registration, null, 2), "utf8"));
        put(`${dir}/fee-record.csv`, Buffer.from(s.feeCsv, "utf8"));
        put(`${dir}/quizzes.csv`, Buffer.from(s.quizCsv, "utf8"));
        put(`${dir}/assignments.csv`, Buffer.from(s.assignmentCsv, "utf8"));

        /*
         * THE FILES THEMSELVES, under the student they belong to — which is
         * the whole reason a person opens this. A slip filed only by its
         * storage key would be findable by a programmer and by nobody else.
         *
         * They are ALSO written under files/ below, keyed by storageKey, and
         * that duplication is deliberate: `records/` is for reading and
         * `files/` is what a restore puts back. Deflate makes the second copy
         * of an identical JPEG cost very little, and conflating the two would
         * force one of the audiences to lose.
         */
        for (const f of s.files) {
          const bytes = await this.fetch(f.storageKey);
          if (!bytes) {
            missing.push(f.storageKey);
            continue;
          }
          put(`${dir}/${f.folder}/${safeFolder(f.filename)}`, bytes);
        }
      }

      put("records/fees/payments.csv", Buffer.from(await this.paymentsCsv(), "utf8"));
      put("records/registrations.csv", Buffer.from(await this.registrationsCsv(), "utf8"));
      put("records/certificates.csv", Buffer.from(await this.certificatesCsv(), "utf8"));

      // ------------------------------------------------------------ files --
      /*
       * EVERY STORED OBJECT, KEYED BY ITS storageKey.
       *
       * This is what a restore reads. The key is the filename because a
       * restored ROW points at that exact string — putting the bytes back
       * anywhere else leaves the database referring to something that is not
       * there, which is precisely the failure this whole feature exists to fix.
       */
      const keys = await this.allStorageKeys();
      let filesWritten = 0;
      for (const key of keys) {
        if (zip.bytesWritten > MAX_TOTAL) {
          throw new AppError("RESOURCE_CONFLICT", {
            message:
              "This archive would exceed 3.5 GB, which is more than the ZIP format used here " +
              "can address. Export one academic session at a time.",
          });
        }
        const bytes = await this.fetch(key);
        if (!bytes) {
          missing.push(key);
          continue;
        }
        put(`files/${encodeKey(key)}`, bytes);
        filesWritten += 1;
      }

      // ----------------------------------------------------------- system --
      /*
       * THE MACHINE-READABLE HALF: exactly what backup.service.ts writes, taken
       * fresh so the rows and the files in this archive describe the same
       * moment. `system/rows.ndjson.gz` is ALWAYS the whole database even when
       * `records/` was scoped to one session — a partial restore is not a
       * restore.
       */
      const backup = await this.backups.create();
      const dir = process.env["BACKUP_DIR"] ?? join(process.cwd(), "backups");
      put("system/rows.ndjson.gz", readFileSync(join(dir, `${backup.id}.ndjson.gz`)));
      put("system/manifest.json", readFileSync(join(dir, `${backup.id}.manifest.json`)));

      // ---------------------------------------------------------- manifest --
      // Written LAST because it describes everything above it. Its own hash is
      // not in it, for the obvious reason.
      const summary = {
        version: 1,
        takenAt: takenAt.toISOString(),
        institute: process.env["INSTITUTE_NAME"] ?? "Prepreneurship",
        scope: opts.sessionId ? { academicSessionId: opts.sessionId } : { academicSessionId: null },
        counts: {
          students: students.length,
          filesExpected: keys.length,
          filesWritten,
          filesMissing: missing.length,
          rows: backup.totalRows,
        },
        rowsChecksum: backup.checksum,
        missing,
        entries: manifest,
      };
      res.write(
        zip.push({
          path: `${name}/manifest.json`,
          data: Buffer.from(JSON.stringify(summary, null, 2), "utf8"),
          modified: takenAt,
        }),
      );

      res.write(zip.finish());
      res.end();

      await this.audit.record({
        action: "archive.download",
        entityType: "Archive",
        entityId: name,
        after: {
          by: actor.userId,
          students: students.length,
          filesWritten,
          filesMissing: missing.length,
          rows: backup.totalRows,
          bytes: zip.bytesWritten,
        },
        ...(ip ? { ipAddress: ip } : {}),
      });

      this.logger.log(
        `Archive ${name}: ${students.length} students, ${filesWritten} files, ` +
          `${backup.totalRows} rows in ${Date.now() - started}ms.`,
      );
    } catch (err) {
      /*
       * THE HEADERS HAVE ALREADY GONE. Once bytes are on the wire the status
       * cannot be changed, so an error here cannot become a 500 the browser
       * would render — the download simply ends short. Destroying the socket
       * is what makes it end SHORT rather than end cleanly: a truncated ZIP
       * fails our own reader's end-record check, which is far better than a
       * file that looks complete and is not.
       */
      this.logger.error(`Archive failed: ${err instanceof Error ? err.message : "unknown"}`);
      res.destroy();
      throw err;
    }
  }

  // ============================================================= restore ====

  /**
   * Puts an uploaded archive back — rows through the existing restore, then
   * the files.
   *
   * VERIFY FIRST, DESTROY SECOND. Every checksum in the manifest is checked
   * before a single table is emptied. An archive that fails is reported and
   * nothing is touched, because the alternative is a System with its old data
   * gone and its new data refused.
   */
  async restore(
    upload: Buffer,
    confirmation: string,
    ip?: string,
  ): Promise<{
    rowsLoaded: number;
    filesWritten: number;
    filesMissing: string[];
    message: string;
  }> {
    const actor = getActor();
    if (!actor) throw new AppError("AUTH_TOKEN_INVALID");

    /*
     * THE STRUCTURE HAS TO EXIST FIRST, and this is the moment the Institute
     * is most likely to believe the feature has failed them.
     *
     * The archive holds DATA, not SCHEMA — no tables, no indexes, no CHECK
     * constraints, no append-only trigger on the audit log. On a rebuilt
     * machine there is nothing to load INTO, and a foreign-key error at that
     * moment reads as "the backup is broken". So it is detected and answered
     * with the three commands instead.
     */
    /*
     * THE PHRASE IS CHECKED FIRST, before the schema probe and before every
     * checksum in a multi-gigabyte file is recomputed.
     *
     * It costs nothing and it is the operator's own last chance to have not
     * meant it. Checking it last — after several minutes of verification —
     * also buries the one message that tells them what to type, underneath
     * work they did not need to wait for.
     */
    if (confirmation !== "REPLACE ALL DATA") {
      throw new AppError("VALIDATION_FAILED", {
        message:
          'Type "REPLACE ALL DATA" to confirm. This empties every table and loads the archive ' +
          "over the top of it.",
        details: [
          {
            field: "confirmation",
            code: "NOT_CONFIRMED",
            message: 'Type "REPLACE ALL DATA" exactly, in capitals.',
          },
        ],
      });
    }

    await this.requireSchema();

    /*
     * A DAMAGED ZIP IS THE OPERATOR'S PROBLEM TO SOLVE, NOT A SERVER FAULT.
     *
     * readZip throws a plain Error for a truncated file or a bad CRC, which
     * would surface as "Something went wrong at our end" — sending somebody to
     * check the server when what they actually need to do is download the file
     * again. It is turned into the sentence that says so.
     */
    let entries: Map<string, Buffer>;
    try {
      entries = readZip(upload);
    } catch (err) {
      throw new AppError("VALIDATION_FAILED", {
        message:
          `This archive could not be read: ${err instanceof Error ? err.message : "unknown error"} ` +
          "Nothing has been changed. Download the file again and retry — a copy that was cut " +
          "short in transit will fail here every time.",
      });
    }
    const root = [...entries.keys()][0]?.split("/")[0] ?? "";
    const at = (p: string): Buffer | undefined => entries.get(`${root}/${p}`) ?? entries.get(p);

    const manifestRaw = at("manifest.json");
    if (!manifestRaw) {
      throw new AppError("VALIDATION_FAILED", {
        message:
          "That ZIP has no manifest.json, so it is not an archive this System produced. " +
          "Upload the file exactly as it was downloaded, without unzipping and re-zipping it.",
      });
    }

    const manifest = JSON.parse(manifestRaw.toString("utf8")) as {
      counts?: { rows?: number };
      entries?: Array<{ path: string; sha256: string; bytes: number }>;
    };

    // ---- verify every entry the manifest claims, before anything is emptied.
    const damaged: string[] = [];
    for (const e of manifest.entries ?? []) {
      const data = at(e.path);
      if (!data) {
        damaged.push(`${e.path} (missing)`);
        continue;
      }
      if (createHash("sha256").update(data).digest("hex") !== e.sha256) {
        damaged.push(`${e.path} (checksum)`);
      }
    }
    if (damaged.length > 0) {
      throw new AppError("VALIDATION_FAILED", {
        message:
          `This archive did not verify: ${damaged.length} entr${damaged.length === 1 ? "y is" : "ies are"} ` +
          `missing or altered — ${damaged.slice(0, 3).join(", ")}${damaged.length > 3 ? "…" : ""}. ` +
          "Nothing has been changed. Use a copy that verifies.",
      });
    }

    const rows = at("system/rows.ndjson.gz");
    if (!rows) {
      throw new AppError("VALIDATION_FAILED", {
        message:
          "This archive has records but no system/rows.ndjson.gz, so there is nothing to restore " +
          "the database from. The records folder is for reading, not for rebuilding.",
      });
    }

    /*
     * ROWS THROUGH THE EXISTING PATH. The same maintenance-mode requirement,
     * the same REPLACE ALL DATA phrase, the same ordering out of
     * backup-plan.ts. A second restore would be a second set of rules about
     * the most dangerous operation in the System.
     */
    const staged = await this.backups.stageForRestore(rows, at("system/manifest.json"));
    const result = await this.backups.restore(staged, confirmation);

    // ---- and then the files, at the keys the restored rows point at.
    let filesWritten = 0;
    const filesMissing: string[] = [];
    const documents = this.storage.forDocuments();

    for (const [path, data] of entries) {
      const rel = path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
      if (!rel.startsWith("files/")) continue;
      const key = decodeKey(rel.slice("files/".length));
      try {
        await documents.putAt(key, data);
        filesWritten += 1;
      } catch (err) {
        // One unreadable slip must not abandon a restore of eight hundred
        // students. Reported, and the restore continues.
        filesMissing.push(key);
        this.logger.warn(`Restore could not write ${key}: ${err instanceof Error ? err.message : ""}`);
      }
    }

    await this.audit.record({
      action: "archive.restore",
      entityType: "Archive",
      entityId: root || "upload",
      after: {
        by: actor.userId,
        rowsLoaded: result.rowsLoaded ?? manifest.counts?.rows ?? 0,
        filesWritten,
        filesMissing: filesMissing.length,
      },
      ...(ip ? { ipAddress: ip } : {}),
    });

    return {
      rowsLoaded: result.rowsLoaded ?? manifest.counts?.rows ?? 0,
      filesWritten,
      filesMissing,
      message:
        `Restored ${result.rowsLoaded ?? 0} rows and ${filesWritten} files.` +
        (filesMissing.length > 0
          ? ` ${filesMissing.length} file(s) could not be written and are listed above.`
          : ""),
    };
  }

  /** Refuses, with the three commands, when there is nothing to load into. */
  private async requireSchema(): Promise<void> {
    try {
      await this.prisma.asSystem((db) => db.$queryRaw`SELECT 1 FROM "students" LIMIT 1`);
    } catch {
      throw new AppError("RESOURCE_CONFLICT", {
        message:
          "This database has no structure yet, so there is nothing to restore into. An archive " +
          "holds DATA and not the schema. On a new machine, run these first:\n\n" +
          "  1. create the database\n" +
          "  2. npx prisma migrate deploy\n" +
          "  3. npm run db:constraints\n\n" +
          "Then upload this file again.",
      });
    }
  }


  // ============================================================ records ====

  /**
   * One folder per student, with everything the Institute holds about them.
   *
   * PER-STUDENT FOLDERS ARE THE POINT of `records/`. The flat CSVs beside them
   * are for a spreadsheet; the folders are for the question that is actually
   * asked, which is always "show me everything about this one person" — a fee
   * dispute, a lost certificate, a reference request in four years.
   */
  private async studentRecords(sessionId?: string) {
    const students = await this.prisma.asSystem((db) =>
      db.student.findMany({
        where: {
          deletedAt: null,
          ...(sessionId
            ? { currentSection: { batch: { academicSessionId: sessionId } } }
            : {}),
        },
        orderBy: { registrationNo: "asc" },
        select: {
          id: true,
          registrationNo: true,
          currentRollNo: true,
          admissionDate: true,
          nationalId: true,
          dateOfBirth: true,
          guardianName: true,
          guardianPhone: true,
          feePayer: true,
          user: { select: { fullName: true, email: true, phone: true } },
          partnerInstitute: { select: { name: true } },
          currentSection: {
            select: {
              name: true,
              batch: {
                select: {
                  name: true,
                  academicSession: {
                    select: { name: true, programme: { select: { name: true } } },
                  },
                },
              },
            },
          },
          feeCharges: {
            where: { deletedAt: null },
            select: { description: true, amount: true, dueDate: true, waivedAt: true },
          },
          payments: {
            select: {
              verifiedAmount: true,
              paymentDate: true,
              method: true,
              bankReference: true,
              receiptNo: true,
              isReversed: true,
            },
          },
          paymentSubmissions: {
            select: {
              reference: true,
              claimedAmount: true,
              status: true,
              paymentDate: true,
              documents: { select: { storageKey: true, originalFilename: true } },
            },
          },
          quizAttempts: {
            select: {
              finalScore: true,
              isPassed: true,
              submittedAt: true,
              releasedAt: true,
              quiz: { select: { title: true } },
            },
          },
          submissions: {
            where: { isLatest: true },
            select: {
              submittedAt: true,
              isLate: true,
              assignment: { select: { title: true, marksAvailable: true } },
              grade: { select: { finalMarks: true, feedback: true, releasedAt: true } },
              files: { select: { storageKey: true, originalFilename: true } },
            },
          },
          certificates: {
            select: { certificateNo: true, kind: true, status: true, issuedAt: true },
          },
        },
      }),
    );

    return students.map((s) => {
      const files: Array<{ storageKey: string; filename: string; folder: string }> = [];

      for (const sub of s.paymentSubmissions) {
        for (const d of sub.documents) {
          files.push({ storageKey: d.storageKey, filename: d.originalFilename, folder: "slips" });
        }
      }
      for (const sub of s.submissions) {
        for (const f of sub.files) {
          files.push({
            storageKey: f.storageKey,
            filename: f.originalFilename,
            folder: "assignments",
          });
        }
      }

      return {
        registrationNo: s.registrationNo,
        files,
        registration: {
          name: s.user.fullName,
          registrationNo: s.registrationNo,
          rollNo: s.currentRollNo,
          email: s.user.email,
          phone: s.user.phone,
          nationalId: s.nationalId,
          dateOfBirth: s.dateOfBirth,
          guardianName: s.guardianName,
          guardianPhone: s.guardianPhone,
          admissionDate: s.admissionDate,
          programme: s.currentSection?.batch.academicSession.programme.name ?? null,
          session: s.currentSection?.batch.academicSession.name ?? null,
          batch: s.currentSection?.batch.name ?? null,
          section: s.currentSection?.name ?? null,
          feePaidBy: s.feePayer === "PARTNER" ? (s.partnerInstitute?.name ?? "Institute") : "Student",
          certificates: s.certificates.map((c) => ({
            number: c.certificateNo,
            kind: c.kind,
            status: c.status,
            issuedAt: c.issuedAt,
          })),
        },
        feeCsv: csv(
          ["what", "amount", "due", "written off", "paid on", "method", "reference", "receipt", "reversed"],
          [
            ...s.feeCharges.map((c) => [
              c.description,
              String(c.amount),
              iso(c.dueDate),
              c.waivedAt ? "yes" : "",
              "",
              "",
              "",
              "",
              "",
            ]),
            ...s.payments.map((p) => [
              "Payment received",
              String(p.verifiedAmount),
              "",
              "",
              iso(p.paymentDate),
              p.method,
              p.bankReference ?? "",
              p.receiptNo ?? "",
              p.isReversed ? "yes" : "",
            ]),
          ],
        ),
        quizCsv: csv(
          ["quiz", "score", "passed", "submitted", "released"],
          s.quizAttempts.map((a) => [
            a.quiz.title,
            a.finalScore === null ? "" : String(a.finalScore),
            a.isPassed === null ? "" : a.isPassed ? "yes" : "no",
            iso(a.submittedAt),
            iso(a.releasedAt),
          ]),
        ),
        assignmentCsv: csv(
          ["assignment", "out of", "submitted", "late", "mark", "feedback", "released"],
          s.submissions.map((sub) => [
            sub.assignment.title,
            String(sub.assignment.marksAvailable),
            iso(sub.submittedAt),
            sub.isLate ? "yes" : "",
            sub.grade?.finalMarks === undefined || sub.grade === null
              ? ""
              : String(sub.grade.finalMarks),
            sub.grade?.feedback ?? "",
            iso(sub.grade?.releasedAt ?? null),
          ]),
        ),
      };
    });
  }

  /** Every verified payment, flat, for a spreadsheet. */
  private async paymentsCsv(): Promise<string> {
    const rows = await this.prisma.asSystem((db) =>
      db.payment.findMany({
        orderBy: { paymentDate: "asc" },
        select: {
          paymentDate: true,
          verifiedAmount: true,
          method: true,
          bankReference: true,
          receiptNo: true,
          isReversed: true,
          student: { select: { registrationNo: true, user: { select: { fullName: true } } } },
        },
      }),
    );
    return csv(
      ["date", "registration no", "student", "amount", "method", "reference", "receipt", "reversed"],
      rows.map((p) => [
        iso(p.paymentDate),
        p.student.registrationNo,
        p.student.user.fullName,
        String(p.verifiedAmount),
        p.method,
        p.bankReference ?? "",
        p.receiptNo ?? "",
        p.isReversed ? "yes" : "",
      ]),
    );
  }

  private async registrationsCsv(): Promise<string> {
    const rows = await this.prisma.asSystem((db) =>
      db.student.findMany({
        where: { deletedAt: null },
        orderBy: { registrationNo: "asc" },
        select: {
          registrationNo: true,
          admissionDate: true,
          currentRollNo: true,
          user: { select: { fullName: true, email: true, phone: true } },
          currentSection: {
            select: {
              name: true,
              batch: {
                select: {
                  academicSession: {
                    select: { name: true, programme: { select: { name: true } } },
                  },
                },
              },
            },
          },
        },
      }),
    );
    return csv(
      ["registration no", "student", "email", "phone", "programme", "session", "section", "roll no", "admitted"],
      rows.map((s) => [
        s.registrationNo,
        s.user.fullName,
        s.user.email,
        s.user.phone ?? "",
        s.currentSection?.batch.academicSession.programme.name ?? "",
        s.currentSection?.batch.academicSession.name ?? "",
        s.currentSection?.name ?? "",
        s.currentRollNo === null ? "" : String(s.currentRollNo),
        iso(s.admissionDate),
      ]),
    );
  }

  private async certificatesCsv(): Promise<string> {
    const rows = await this.prisma.asSystem((db) =>
      db.certificate.findMany({
        orderBy: { issuedAt: "asc" },
        select: {
          certificateNo: true,
          kind: true,
          status: true,
          issuedAt: true,
          student: { select: { registrationNo: true, user: { select: { fullName: true } } } },
        },
      }),
    );
    return csv(
      ["certificate no", "registration no", "student", "kind", "status", "issued"],
      rows.map((c) => [
        c.certificateNo,
        // Nullable: a certificate outlives the student record it was issued
        // against (a purge leaves the document, which is the point of it).
        c.student?.registrationNo ?? "",
        c.student?.user.fullName ?? "",
        c.kind,
        c.status,
        iso(c.issuedAt),
      ]),
    );
  }

  // ============================================================ helpers ====

  /** Every stored object this archive carries. Video is deliberately absent. */
  private async allStorageKeys(): Promise<string[]> {
    const [documents, submissions, attachments, resources] = await this.prisma.asSystem((db) =>
      Promise.all([
        db.registrationDocument.findMany({ select: { storageKey: true } }),
        db.submissionFile.findMany({ select: { storageKey: true } }),
        db.assignmentAttachment.findMany({ select: { storageKey: true } }),
        db.lessonResource.findMany({ select: { storageKey: true } }),
      ]),
    );
    /*
     * MediaAsset and RecordedLecture are NOT here, and that is a decision.
     * Lecture video lives in the Institute's Drive by mandate (ARC-043) and a
     * single recording outweighs every slip in this archive put together. The
     * records this exists to protect are the paperwork.
     */
    return [
      ...new Set(
        [...documents, ...submissions, ...attachments, ...resources]
          .map((r) => r.storageKey)
          .filter((k): k is string => !!k),
      ),
    ];
  }

  /** One object, or null. A missing file is reported, never fatal. */
  private async fetch(storageKey: string): Promise<Buffer | null> {
    try {
      return await this.storage.forDocuments().get(storageKey);
    } catch {
      return null;
    }
  }

  private readme(takenAt: Date, students: number): string {
    return [
      `${process.env["INSTITUTE_NAME"] ?? "Prepreneurship"} — records archive`,
      `Taken ${takenAt.toISOString()}`,
      "",
      "WHAT THIS IS",
      "  A copy of the Institute's records, readable without the LMS. Open",
      "  records/students/<registration number>/ to find one person's",
      "  registration, fee record, payment slips, receipts and certificates.",
      `  ${students} student folder(s) are included.`,
      "",
      "WHAT THIS IS NOT",
      "  It is not a database backup on its own, and it does not contain the",
      "  database STRUCTURE. Restoring it onto a new machine needs, in order:",
      "",
      "    1. create the database",
      "    2. npx prisma migrate deploy",
      "    3. npm run db:constraints",
      "    4. upload this file on the Backups screen",
      "",
      "  The records/ folder is for READING. It is never used to rebuild the",
      "  System — system/rows.ndjson.gz is.",
      "",
      "CHECKING THIS COPY IS INTACT",
      "  manifest.json lists every file with its SHA-256. A copy that still",
      "  matches its manifest is a copy nothing has altered.",
      "",
      "THIS CONTAINS PERSONAL DATA",
      "  National identity numbers, addresses, telephone numbers, bank slips",
      "  and marks, for every student named in it. Keep it where the",
      "  Institute's data-protection policy says such records may be kept, and",
      "  delete copies that are no longer needed. It is not a file to leave in",
      "  a downloads folder or to send over a messaging app.",
      "",
    ].join("\n");
  }
}

/** A path segment that is safe on every filesystem the Institute might use. */
function safeFolder(raw: string): string {
  return (
    raw
      .replace(/[\\/:*?"<>|]/g, "-")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120) || "unnamed"
  );
}

/*
 * A storage key becomes ONE filename rather than a path.
 *
 * Keys contain slashes ("registration-slips/ab12.jpg"), and writing them as
 * nested folders would make restore depend on reassembling a path exactly —
 * including on Windows, where the separator differs. Encoding the slash keeps
 * the key an opaque string, which is what the database rows treat it as.
 */
function encodeKey(key: string): string {
  return key.replace(/_/g, "__").replace(/\//g, "_-");
}

function decodeKey(name: string): string {
  return name.replace(/_-/g, "/").replace(/__/g, "_");
}

/**
 * A CSV a spreadsheet will open without complaint.
 *
 * QUOTES EVERYTHING rather than only what needs it. A student's name may
 * contain a comma, a feedback line may contain a newline, and an address will
 * eventually contain a quotation mark — deciding per value which of those is
 * present is three chances to be wrong, and quoting unconditionally is none.
 * Excel, LibreOffice and every parser handle a fully-quoted file identically.
 */
function csv(headers: string[], rows: string[][]): string {
  const cell = (v: string): string => `"${(v ?? "").replace(/"/g, '""')}"`;
  return [headers.map(cell).join(","), ...rows.map((r) => r.map(cell).join(","))].join("\r\n");
}

/** A date a person and a spreadsheet both read the same way, or blank. */
function iso(d: Date | null | undefined): string {
  return d ? d.toISOString().slice(0, 10) : "";
}
