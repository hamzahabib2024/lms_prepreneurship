import { Injectable, Logger } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { AuthService } from "../auth/auth.service";
import { RegistrationNumberService } from "../admission/registration-number.service";
import { getActor } from "../prisma/actor-context";
import { AppError } from "@lms/shared";
import {
  countAgainstSection,
  describePlan,
  planImport,
  type ImportPlan,
  type ImportRow,
} from "./cohort-import";

export interface RowOutcome {
  line: number;
  fullName: string;
  email: string;
  status: "LOADED" | "REJOINED" | "SKIPPED";
  registrationNo?: string;
  rollNo?: number;
  /** Set only when SKIPPED. Says what to do, not merely what went wrong. */
  reason?: string;
  /** Shown once, never again — the account is created with it hashed. */
  temporaryPassword?: string;
}

export interface ImportResult {
  sectionId: string;
  sectionName: string;
  loaded: number;
  rejoined: number;
  skipped: number;
  outcomes: RowOutcome[];
  message: string;
}

/**
 * Loading a cohort — FR-OPS-024..026.
 *
 * ONE TRANSACTION PER STUDENT, not one for the file. A single transaction round
 * three hundred students means row 297 rolls back the 296 that were fine, and
 * the operator fixes one typo to discover nothing was loaded. Each student is
 * atomic in themselves; the file is "as many as could be done", and the report
 * says which. That matches bulk transfer, and for the same reason.
 *
 * THE ORDINARY ALLOCATION IS CALLED PER ROW. A bulk INSERT would be faster and
 * would skip the section lock, the roll-number sequence, the capacity check and
 * the gender restriction — putting a male student in a women's section, which
 * FR-CRS-009 makes absolute. The lock is per row too, so two operators
 * importing into one section cannot both claim roll number 41.
 *
 * NOTHING IS INVENTED. No payment is recorded, because none was seen: the
 * student appears in the fee ledger owing the full amount, which is true and
 * which the Institute can then settle from its own records. No consent
 * checkbox is written on the student's behalf — the operator asserts that
 * consent was collected offline, and that assertion is what goes in the audit
 * record, attributed to them (SEC-PRV-003).
 */
@Injectable()
export class CohortImportService {
  private readonly logger = new Logger(CohortImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
    private readonly numbers: RegistrationNumberService,
  ) {}

  /**
   * What would happen, before anything is written.
   *
   * Reads the file AND the section, because half of what can go wrong is about
   * the pairing: a file of male students against a women's section is a valid
   * file and a valid section that must not be put together.
   */
  async preview(csv: string, sectionId: string) {
    const plan = planImport(csv);
    const section = await this.loadSection(sectionId);

    const wrongGender = plan.rows.filter(
      (r) => section.genderRestriction !== "MIXED" && section.genderRestriction !== r.gender,
    );

    // Matching on email is how the ordinary approval recognises somebody, so it
    // is how the preview must recognise them: a returning student KEEPS their
    // registration number, and the operator should see that before they worry
    // about duplicates.
    const emails = plan.rows.map((r) => r.email);
    const existing =
      emails.length === 0
        ? []
        : await this.prisma.asSystem((db) =>
            db.user.findMany({
              where: { email: { in: emails }, deletedAt: null },
              select: { email: true, student: { select: { registrationNo: true } } },
            }),
          );
    const returning = new Map(
      existing
        .filter((u) => u.student)
        .map((u) => [u.email, u.student!.registrationNo] as const),
    );

    // Counted by the pure module, which has the tests. These three are
    // DISJOINT and the button on the screen is labelled with the sum of the
    // first two — see countAgainstSection for why that matters.
    const { wouldLoad, wouldRejoin } = countAgainstSection(
      plan.rows,
      section.genderRestriction,
      (email) => returning.has(email),
    );
    const room = section.capacity - section.enrolledCount;

    return {
      section: {
        id: section.id,
        name: section.name,
        genderRestriction: section.genderRestriction,
        capacity: section.capacity,
        enrolledCount: section.enrolledCount,
      },
      fileProblem: plan.fileProblem,
      unknownColumns: plan.unknownColumns,
      rowProblems: plan.rowProblems,
      rows: plan.rows.map((r) => ({
        line: r.line,
        fullName: r.fullName,
        email: r.email,
        gender: r.gender,
        returningWith: returning.get(r.email) ?? null,
        blocked:
          section.genderRestriction !== "MIXED" && section.genderRestriction !== r.gender
            ? `${section.name} admits ${section.genderRestriction.toLowerCase()} students only.`
            : null,
      })),
      wouldLoad,
      wouldRejoin,
      // Said BEFORE the operator commits, because afterwards it is a fact
      // rather than a decision. Capacity is overridable and gender is not.
      capacityWarning:
        wouldLoad + wouldRejoin > room
          ? `${section.name} has room for ${Math.max(0, room)} more (${section.enrolledCount} of ` +
            `${section.capacity}). Loading ${wouldLoad + wouldRejoin} needs the capacity override.`
          : null,
      message: this.previewMessage(plan, wouldLoad, wouldRejoin, wrongGender.length),
    };
  }

  /**
   * Loads them.
   *
   * @param consentCollectedOffline the operator asserting that these students
   *   were given the data-collection notice elsewhere. Recorded against them by
   *   name; it is not a checkbox the System ticks for itself.
   */
  async commit(
    csv: string,
    sectionId: string,
    options: { capacityOverride: boolean; consentCollectedOffline: boolean; note: string },
    ip?: string,
  ): Promise<ImportResult> {
    const actor = getActor();
    if (!actor) throw new AppError("AUTH_TOKEN_INVALID");

    const plan = planImport(csv);
    if (plan.fileProblem) {
      throw new AppError("VALIDATION_FAILED", {
        message: plan.fileProblem.message,
        details: [{ field: "file", code: plan.fileProblem.code, message: plan.fileProblem.message }],
      });
    }

    const section = await this.loadSection(sectionId);
    const outcomes: RowOutcome[] = [];

    // Rows the file itself rejected are reported here too, so the operator gets
    // ONE list covering the whole file rather than having to hold the preview
    // in their head next to the result.
    const byLine = new Map<number, string[]>();
    for (const p of plan.rowProblems) {
      byLine.set(p.line, [...(byLine.get(p.line) ?? []), p.message]);
    }
    for (const [line, messages] of [...byLine].sort((a, b) => a[0] - b[0])) {
      outcomes.push({
        line,
        fullName: "",
        email: "",
        status: "SKIPPED",
        reason: messages.join(" "),
      });
    }

    for (const row of plan.rows) {
      outcomes.push(await this.loadOne(row, section, options, actor.userId, ip));
    }

    outcomes.sort((a, b) => a.line - b.line);
    const loaded = outcomes.filter((o) => o.status === "LOADED").length;
    const rejoined = outcomes.filter((o) => o.status === "REJOINED").length;
    const skipped = outcomes.filter((o) => o.status === "SKIPPED").length;

    // One entry for the import itself, in addition to the per-student ones.
    // Without it, three hundred separate creations have no single thing an
    // administrator can point at and say "that was the import on Tuesday".
    await this.audit.record({
      action: "cohort.import",
      entityType: "Section",
      entityId: section.id,
      after: {
        loaded,
        rejoined,
        skipped,
        note: options.note,
        capacityOverride: options.capacityOverride,
        // The assertion, attributed. SEC-PRV-003.
        consentCollectedOffline: options.consentCollectedOffline,
      },
      ...(ip ? { ipAddress: ip } : {}),
    });

    return {
      sectionId: section.id,
      sectionName: section.name,
      loaded,
      rejoined,
      skipped,
      outcomes,
      message: this.resultMessage(loaded, rejoined, skipped),
    };
  }

  // ---------------------------------------------------------------- private

  private async loadSection(sectionId: string) {
    const section = await this.prisma.asSystem((db) =>
      db.section.findUnique({
        where: { id: sectionId },
        include: {
          batch: { include: { academicSession: true } },
          sectionSubjects: {
            where: { isCompulsory: true, status: { in: ["PLANNED", "ACTIVE"] } },
            select: { id: true },
          },
        },
      }),
    );
    if (!section) {
      throw new AppError("VALIDATION_FAILED", {
        details: [{ field: "sectionId", code: "NOT_FOUND", message: "That section does not exist." }],
      });
    }
    return section;
  }

  private async loadOne(
    row: ImportRow,
    section: Awaited<ReturnType<CohortImportService["loadSection"]>>,
    options: { capacityOverride: boolean; consentCollectedOffline: boolean; note: string },
    actorUserId: string,
    ip?: string,
  ): Promise<RowOutcome> {
    const base = { line: row.line, fullName: row.fullName, email: row.email };

    // FR-CRS-009 / BR-ENR-05 — absolute, and checked before anything is
    // written. There is deliberately no override, unlike capacity.
    if (section.genderRestriction !== "MIXED" && section.genderRestriction !== row.gender) {
      return {
        ...base,
        status: "SKIPPED",
        reason: `${section.name} admits ${section.genderRestriction.toLowerCase()} students only.`,
      };
    }

    const temporaryPassword = this.temporaryPassword();
    const passwordHash = await this.auth.hashPassword(temporaryPassword);
    const format = await this.numbers.resolveFormat();

    try {
      return await this.prisma.asSystem((db) =>
        db.$transaction(async (tx) => {
          // Serialises two operators importing into one section, exactly as the
          // ordinary approval does. Without it both can claim roll number 41.
          await this.numbers.lockSection(tx, section.id);

          const fresh = await tx.section.findUnique({
            where: { id: section.id },
            select: { enrolledCount: true, capacity: true },
          });
          // Re-read INSIDE the lock. The preview's count is a moment old, and
          // three hundred rows take long enough for it to stop being true.
          if (fresh && fresh.enrolledCount >= fresh.capacity && !options.capacityOverride) {
            return {
              ...base,
              status: "SKIPPED" as const,
              reason:
                `${section.name} is full (${fresh.enrolledCount} of ${fresh.capacity}). ` +
                "Load the rest with the capacity override, or into another section.",
            };
          }

          const existing = await tx.user.findFirst({
            where: { email: row.email, deletedAt: null },
            select: { id: true, student: { select: { id: true, registrationNo: true } } },
          });
          const returning = existing?.student ?? null;

          // A returning student KEEPS their number (BR-REG-07): it is permanent
          // and public, it is on certificates already issued, and a second one
          // would make the same person two people in every report.
          const registrationNo =
            returning?.registrationNo ??
            (
              await this.numbers.allocate(tx, {
                instituteCode: format.instituteCode,
                sessionCode: section.batch.academicSession.code,
                campusCode: format.campusCode,
              })
            ).registrationNo;

          // Per section, because a roll number is a position in one register,
          // not an identity (BR-REG-08).
          const rollNo = await this.numbers.allocateRollNumber(tx, section.id);

          let studentId: string;
          if (returning) {
            studentId = returning.id;
            await tx.student.update({
              where: { id: studentId },
              data: { currentSectionId: section.id, currentRollNo: rollNo },
            });
          } else {
            if (existing) {
              // An account with this address exists but is not a student —
              // a teacher, or an administrator. Making them a student as well
              // is a decision for a person, not for a spreadsheet.
              return {
                ...base,
                status: "SKIPPED" as const,
                reason:
                  `${row.email} is already an account here that is not a student. ` +
                  "Add the student role to it by hand if that is really the same person.",
              };
            }

            const user = await tx.user.create({
              data: {
                email: row.email,
                passwordHash,
                fullName: row.fullName,
                phone: row.phone,
                phoneIsWhatsapp: true,
                status: "INVITED",
                // FR-REG-040. An imported student has never chosen a password,
                // so the first thing they do is choose one.
                mustChangePassword: true,
                roles: { create: { role: { connect: { key: "student" } } } },
              },
              select: { id: true },
            });
            const created = await tx.student.create({
              data: {
                userId: user.id,
                registrationNo,
                currentSectionId: section.id,
                currentRollNo: rollNo,
                nationalId: row.nationalId,
                dateOfBirth: row.dateOfBirth,
                gender: row.gender,
                admissionDate: new Date(),
              },
              select: { id: true },
            });
            studentId = created.id;
          }

          if (section.sectionSubjects.length > 0) {
            await tx.enrolment.createMany({
              data: section.sectionSubjects.map((ss) => ({
                studentId,
                sectionSubjectId: ss.id,
                status: "ACTIVE" as const,
                rollNoAtEnrolment: rollNo,
              })),
              // A returning student re-imported into a section they already
              // hold must not gain a second enrolment in the same subject.
              skipDuplicates: true,
            });
          }

          await tx.section.update({
            where: { id: section.id },
            data: { enrolledCount: { increment: 1 } },
          });

          await this.audit.record(
            {
              action: returning ? "cohort.import.rejoin" : "cohort.import.create",
              entityType: "Student",
              entityId: studentId,
              after: {
                registrationNo,
                rollNo,
                sectionId: section.id,
                line: row.line,
                consentCollectedOffline: options.consentCollectedOffline,
                importedBy: actorUserId,
              },
              ...(ip ? { ipAddress: ip } : {}),
            },
            tx as unknown as Parameters<AuditService["record"]>[1],
          );

          return {
            ...base,
            status: (returning ? "REJOINED" : "LOADED") as "LOADED" | "REJOINED",
            registrationNo,
            rollNo,
            // Only for a new account. A returning student's existing password
            // is untouched, and saying otherwise would have the Institute hand
            // out a password that does not work.
            ...(returning ? {} : { temporaryPassword }),
          };
        }),
      );
    } catch (err) {
      // One row failing is not the file failing. Log the detail for an
      // operator with server access, and tell the administrator something they
      // can act on without leaking the driver's own words (NFR-ERR-002).
      this.logger.error(`Import row ${row.line} (${row.email}) failed`, err);
      return {
        ...base,
        status: "SKIPPED",
        reason: this.reasonFor(err),
      };
    }
  }

  /**
   * A reason the operator can act on.
   *
   * The generic fallback is a real cost, and this method exists because of it:
   * during development every row of a file failed with "this row could not be
   * loaded", and the actual cause — two students sharing a blank CNIC against a
   * UNIQUE column — was visible only in the server log. An administrator does
   * not have the server log. A collision on a unique field is the most likely
   * thing to go wrong in an import and the easiest to fix, so it is named.
   */
  private reasonFor(err: unknown): string {
    if (err instanceof AppError) return err.message;

    // Prisma's P2002. Read defensively rather than by importing the error
    // class: the shape is stable, and a wrong `instanceof` here would put us
    // back to the generic message this method exists to avoid.
    const e = err as { code?: string; meta?: { target?: unknown } };
    if (e?.code === "P2002") {
      // Prisma reports `target` as a string OR an array of strings, and
      // occasionally as neither. Stringifying an object gives the operator
      // "[object Object] must be unique", which is worse than saying nothing.
      const raw = e.meta?.target;
      const target = Array.isArray(raw) ? raw.join(", ") : typeof raw === "string" ? raw : "";
      const friendly: Record<string, string> = {
        national_id: "Another student already has this CNIC.",
        email: "Another account already uses this email address.",
        registration_no: "That registration number is already taken — try the import again.",
      };
      return (
        friendly[target] ??
        `Another record already has the same ${target || "value"}, which must be unique.`
      );
    }

    return "This row could not be loaded. The rest of the file was unaffected.";
  }

  /**
   * Readable over the phone, which is how these actually reach a student.
   * No l/1/O/0, for the same reason.
   */
  private temporaryPassword(): string {
    const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
    const bytes = randomBytes(12);
    return (
      "Lms-" +
      [...bytes].map((b) => alphabet[b % alphabet.length]).join("")
    );
  }

  private previewMessage(
    plan: ImportPlan,
    wouldLoad: number,
    wouldRejoin: number,
    wrongGender: number,
  ): string {
    if (plan.fileProblem) return plan.fileProblem.message;

    const parts = [describePlan(plan)];
    if (wrongGender > 0) {
      parts.push(
        `${wrongGender} of them cannot join this section because of its gender restriction, ` +
          "which cannot be overridden — put them in another section.",
      );
    }
    // Stated separately, because they are different events with different
    // consequences: one creates an account and hands out a password, the other
    // adds a course to somebody who already has both.
    if (wouldLoad > 0 && wouldRejoin > 0) {
      parts.push(
        `${wouldLoad} new ${wouldLoad === 1 ? "student" : "students"} would be created, and ` +
          `${wouldRejoin} already here would join this section keeping their registration ` +
          "number.",
      );
    } else if (wouldRejoin > 0) {
      parts.push(
        `All ${wouldRejoin} are already here and would join this section keeping the ` +
          "registration number they hold.",
      );
    } else {
      parts.push(`${wouldLoad} would be created in this section.`);
    }
    return parts.join(" ");
  }

  private resultMessage(loaded: number, rejoined: number, skipped: number): string {
    const parts: string[] = [];
    if (loaded > 0) parts.push(`${loaded} new ${loaded === 1 ? "student" : "students"} loaded`);
    if (rejoined > 0) {
      parts.push(
        `${rejoined} existing ${rejoined === 1 ? "student" : "students"} joined this section ` +
          "keeping their registration number",
      );
    }
    if (skipped > 0) parts.push(`${skipped} skipped`);
    if (parts.length === 0) return "Nothing was loaded.";
    return (
      parts.join(", ") +
      "." +
      (loaded > 0
        ? " Each new student has a temporary password shown once below and must change it when " +
          "they first sign in."
        : "")
    );
  }
}
