import { Injectable, Logger } from "@nestjs/common";
import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { Prisma } from "@prisma/client";
import { AppError } from "@lms/shared";
import { getActor } from "../prisma/actor-context";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { SettingsService } from "../settings/settings.service";
import {
  NEVER_RESTORED,
  ageOf,
  prunable,
  restoreOrder,
  verifyAgainst,
  type Manifest,
  type ModelShape,
  type TableCount,
} from "./backup-plan";

/**
 * Backup and restore — SRS §5.25, FR-OPS-030..038.
 *
 * A DATA backup, not a pg_dump — the difference is set out at the top of
 * backup-plan.ts and repeated in what the endpoints return, because somebody
 * relying on this needs to know what it does not cover.
 *
 * THE VERIFY STEP IS THE POINT. A backup nobody has restored is a hope. This
 * re-reads the archive, checks the checksum, and compares row counts against
 * the manifest written at the time — so a broken archive is discovered while
 * there is still time to take another one, rather than during an emergency.
 */
@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);
  private readonly directory: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {
    this.directory = process.env["BACKUP_DIR"] ?? join(process.cwd(), "backups");
    mkdirSync(this.directory, { recursive: true });
  }

  /** FR-OPS-031 — take one. */
  async create() {
    const started = Date.now();
    const models = this.models();
    const { order, problems } = restoreOrder(models);
    if (problems.length > 0) {
      // Refusing beats writing an archive that cannot be loaded back.
      throw new AppError("INTERNAL_ERROR", {
        message: `The schema cannot be ordered for restore: ${problems[0]?.message}`,
      });
    }

    const counts: TableCount[] = [];
    const lines: string[] = [];

    for (const name of order) {
      const rows = await this.readAll(name);
      counts.push({ model: name, rows: rows.length });
      for (const row of rows) {
        lines.push(JSON.stringify({ m: name, r: encode(row) }));
      }
    }

    const payload = lines.join("\n");
    const checksum = createHash("sha256").update(payload).digest("hex");
    const takenAt = new Date();

    const manifest: Manifest = {
      version: 1,
      takenAt: takenAt.toISOString(),
      schemaVersion: await this.schemaVersion(),
      counts,
      checksum,
      totalRows: counts.reduce((n, c) => n + c.rows, 0),
    };

    const id = `backup-${takenAt.toISOString().replace(/[:.]/g, "-")}`;
    writeFileSync(join(this.directory, `${id}.ndjson.gz`), gzipSync(Buffer.from(payload, "utf8")));
    writeFileSync(join(this.directory, `${id}.manifest.json`), JSON.stringify(manifest, null, 2));

    await this.audit.record({
      action: "backup.create",
      entityType: "Backup",
      entityId: id,
      after: { totalRows: manifest.totalRows, models: counts.length, checksum },
    });

    this.logger.log(`Backup ${id}: ${manifest.totalRows} rows in ${Date.now() - started}ms.`);

    await this.prune();

    return {
      id,
      ...manifest,
      // Verified immediately, because a backup that was never read back is not
      // yet known to be a backup.
      verification: await this.verify(id),
      note:
        "This is a DATA backup. It does not contain the schema — restoring it needs a database " +
        "with the migrations and constraints already applied.",
    };
  }

  /**
   * FR-OPS-034 — hand a backup to the operator, off this machine.
   *
   * THE GAP THIS CLOSES, AND IT IS THE WHOLE POINT OF THE ROUTE. Archives are
   * written to BACKUP_DIR, which is a directory on the SAME MACHINE as the
   * database they protect. A disk failure, a stolen laptop or a wiped VM takes
   * the database and every backup of it in one move — so until a copy exists
   * somewhere else, the System has a backup procedure and no backup.
   *
   * TAKING A COPY IS AUDITED AS A PRIVILEGED ACT (SEC-LOG-009), and not as
   * bookkeeping. The file contains every CNIC, address and bank slip the
   * Institute holds; "who has a copy of our student records" has to be
   * answerable from the log rather than from memory. It is also what
   * `lastTakenOffServer` reads to tell the office how long it has been.
   */
  async download(id: string, ip?: string) {
    const actor = getActor();
    if (!actor) throw new AppError("AUTH_TOKEN_INVALID");

    const manifestPath = join(this.directory, `${id}.manifest.json`);
    const payloadPath = join(this.directory, `${id}.ndjson.gz`);
    if (!existsSync(manifestPath) || !existsSync(payloadPath)) {
      throw new AppError("RESOURCE_NOT_FOUND", { message: "That backup no longer exists." });
    }

    /*
     * VERIFIED BEFORE IT IS HANDED OVER. Sending an archive that cannot be
     * read back is worse than sending nothing: it is a copy somebody will
     * trust for a year and discover is broken on the day they need it.
     */
    const verification = await this.verify(id);
    if (!verification.ok) {
      throw new AppError("RESOURCE_CONFLICT", {
        message:
          `This backup did not verify — ${verification.message} It has not been sent. ` +
          "Take a fresh one and download that instead.",
      });
    }

    const body = readFileSync(payloadPath);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;

    await this.audit.record({
      action: "backup.download",
      entityType: "Backup",
      entityId: id,
      after: {
        by: actor.userId,
        totalRows: manifest.totalRows,
        checksum: manifest.checksum,
        sizeBytes: body.length,
      },
      ...(ip ? { ipAddress: ip } : {}),
    });

    return { filename: `${id}.ndjson.gz`, body, manifest };
  }

  /**
   * WHEN A COPY WAS LAST TAKEN OFF THIS MACHINE — read from the audit log.
   *
   * FROM THE LOG RATHER THAN FROM A COLUMN, deliberately. The question is
   * "did a human actually carry a copy away", and the only honest record of
   * that is the entry written when the download completed. A flag set when
   * somebody OPENED the page would answer a different and useless question,
   * and a column somebody can update is a column that can drift from the act.
   */
  async lastTakenOffServer() {
    const entry = await this.prisma.asSystem((db) =>
      db.auditLog.findFirst({
        where: { action: { in: ["backup.download", "archive.download"] } },
        orderBy: { occurredAt: "desc" },
        select: { occurredAt: true, action: true },
      }),
    );

    if (!entry) {
      return {
        takenAt: null,
        days: null,
        severity: "warn" as const,
        message:
          "No copy of the records has ever been taken off this server. If this machine is lost, " +
          "everything on it is lost with it.",
      };
    }

    const days = Math.floor((Date.now() - entry.occurredAt.getTime()) / 86_400_000);
    /*
     * ESCALATES BY PROMINENCE, NEVER BY BLOCKING. Nothing here stops anybody
     * working: a System that refuses to teach a class because nobody took a
     * backup has chosen the wrong thing to protect.
     */
    const severity = days >= 60 ? "warn" : days >= 30 ? "due" : "ok";

    return {
      takenAt: entry.occurredAt,
      days,
      severity,
      message:
        days === 0
          ? "A copy was taken off this server today."
          : `Last copy taken off this server ${days} day${days === 1 ? "" : "s"} ago.`,
    };
  }

  /**
   * Writes an UPLOADED payload into the backup directory so the existing
   * restore can load it, and returns its id.
   *
   * WHY THIS RATHER THAN A SECOND RESTORE. `restore` already owns the
   * dangerous half — maintenance mode, the REPLACE ALL DATA phrase, the
   * ordering out of backup-plan.ts, the audit entry. Teaching it to read from
   * a buffer as well as from disk would fork the most destructive operation in
   * the System into two paths that have to be kept in step for ever. Staging
   * the upload as an ordinary archive means there is still exactly one restore.
   *
   * The staged file is left in place deliberately: an operator who has just
   * rebuilt a server has one verified copy of everything on that machine, and
   * deleting it the moment it was used would be a strange kindness.
   */
  async stageForRestore(rows: Buffer, manifest?: Buffer): Promise<string> {
    const id = `uploaded-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    writeFileSync(join(this.directory, `${id}.ndjson.gz`), rows);

    if (manifest) {
      writeFileSync(join(this.directory, `${id}.manifest.json`), manifest);
    } else {
      /*
       * An archive without its manifest can still be loaded, but it cannot be
       * VERIFIED — and verify is what stands between "we restored it" and "we
       * restored something". Refusing is the honest answer.
       */
      throw new AppError("VALIDATION_FAILED", {
        message:
          "This archive has no system/manifest.json, so its contents cannot be checked before " +
          "being loaded. Use a copy that has one.",
      });
    }

    return id;
  }

  /** FR-OPS-032 — what there is. */
  async list() {
    const now = new Date();
    const manifests = readdirSync(this.directory).filter((f) => f.endsWith(".manifest.json"));

    const backups = manifests
      .map((file) => {
        const id = file.replace(".manifest.json", "");
        try {
          const manifest = JSON.parse(
            readFileSync(join(this.directory, file), "utf8"),
          ) as Manifest;
          const archive = join(this.directory, `${id}.ndjson.gz`);
          const size = statSync(archive).size;
          return {
            id,
            takenAt: new Date(manifest.takenAt),
            age: ageOf(new Date(manifest.takenAt), now),
            totalRows: manifest.totalRows,
            sizeBytes: size,
            schemaVersion: manifest.schemaVersion,
            broken: false as const,
          };
        } catch {
          // A manifest that will not parse is itself a finding: something is
          // wrong with the archive, and hiding it would be the worst option.
          return {
            id,
            takenAt: new Date(0),
            age: "unknown",
            totalRows: 0,
            sizeBytes: 0,
            schemaVersion: "unknown",
            broken: true as const,
          };
        }
      })
      .sort((a, b) => b.takenAt.getTime() - a.takenAt.getTime());

    return {
      backups,
      message:
        backups.length === 0
          ? "There are no backups. Nothing here has ever been backed up."
          : `${backups.length} backup${backups.length === 1 ? "" : "s"}, newest ${backups[0]?.age}.`,
    };
  }

  /**
   * FR-OPS-033 — is it actually restorable?
   *
   * Reads the whole archive back and counts what is in it. The alternative —
   * trusting the file because it exists and has a plausible size — is how an
   * institute discovers at the worst moment that it has been backing up
   * nothing for a month.
   */
  async verify(id: string) {
    let manifest: Manifest;
    try {
      manifest = JSON.parse(
        readFileSync(join(this.directory, `${id}.manifest.json`), "utf8"),
      ) as Manifest;
    } catch {
      throw new AppError("RESOURCE_NOT_FOUND");
    }

    let payload: string;
    try {
      payload = gunzipSync(readFileSync(join(this.directory, `${id}.ndjson.gz`))).toString("utf8");
    } catch {
      return {
        id,
        ok: false,
        problems: [
          {
            code: "UNREADABLE",
            message: "The archive could not be decompressed. It is not usable.",
          },
        ],
        message: "This backup is BROKEN. Take another one now.",
      };
    }

    const counts = new Map<string, number>();
    let readable = true;
    for (const line of payload.split("\n")) {
      if (!line) continue;
      try {
        const parsed = JSON.parse(line) as { m: string };
        counts.set(parsed.m, (counts.get(parsed.m) ?? 0) + 1);
      } catch {
        readable = false;
      }
    }

    const problems = verifyAgainst(manifest, {
      checksum: createHash("sha256").update(payload).digest("hex"),
      counts: manifest.counts.map((c) => ({ model: c.model, rows: counts.get(c.model) ?? 0 })),
    });
    if (!readable) {
      problems.push({ code: "UNREADABLE", message: "Some lines in the archive are not valid." });
    }

    return {
      id,
      ok: problems.length === 0,
      problems,
      message:
        problems.length === 0
          ? `Verified: ${manifest.totalRows} rows read back and the checksum matches.`
          : "This backup is BROKEN. Take another one now.",
    };
  }

  /**
   * FR-OPS-036 — load one back.
   *
   * REFUSED UNLESS MAINTENANCE MODE IS ON. A restore replaces the contents of
   * every table; doing that while students are submitting work would destroy
   * whatever they did in between and leave the System half one database and
   * half another. The check is deliberately here rather than trusted to
   * whoever presses it.
   *
   * The permission also demands step-up (§4.5), which the guard enforces.
   */
  async restore(id: string, confirmation: string) {
    if (confirmation !== "REPLACE ALL DATA") {
      throw new AppError("VALIDATION_FAILED", {
        details: [
          {
            field: "confirmation",
            code: "NOT_CONFIRMED",
            message:
              'Type "REPLACE ALL DATA" to confirm. This empties every table and loads the ' +
              "archive in its place; anything since the backup was taken is lost.",
          },
        ],
      });
    }

    const maintenance = (await this.settings.resolveFor())["maintenance.enabled"] === true;
    if (!maintenance) {
      throw new AppError("RESOURCE_CONFLICT", {
        message:
          "Turn maintenance mode on first. Restoring while people are using the System would " +
          "destroy whatever they do during the restore and leave it half one database and half " +
          "another.",
      });
    }

    const check = await this.verify(id);
    if (!check.ok) {
      throw new AppError("RESOURCE_CONFLICT", {
        message: `That archive does not verify, so it will not be loaded. ${check.problems[0]?.message ?? ""}`,
      });
    }

    const payload = gunzipSync(readFileSync(join(this.directory, `${id}.ndjson.gz`))).toString(
      "utf8",
    );
    const manifest = JSON.parse(
      readFileSync(join(this.directory, `${id}.manifest.json`), "utf8"),
    ) as Manifest;

    const { order } = restoreOrder(this.models());
    const byModel = new Map<string, Array<Record<string, unknown>>>();
    for (const line of payload.split("\n")) {
      if (!line) continue;
      const { m, r } = JSON.parse(line) as { m: string; r: Record<string, unknown> };
      const list = byModel.get(m) ?? [];
      list.push(decode(r));
      byModel.set(m, list);
    }

    const loaded: TableCount[] = [];

    // ONE TRANSACTION. Emptying every table and then failing halfway through
    // the reload would leave the Institute with no data at all and no way back
    // — the single worst outcome this System can produce. Either the whole
    // archive lands or nothing moves.
    //
    // The timeout is generous because this is minutes of work on a real
    // database and the default five seconds would abort a restore that was
    // going perfectly well.
    await this.prisma.asSystem((client) =>
      client.$transaction(
        async (db) => {
          // TRUNCATE, not a delete per table in reverse order.
          //
          // The insert order is computed from REQUIRED relations, because a
          // nullable link can be filled in afterwards. That is correct for
          // loading and WRONG for emptying: an optional foreign key with ON
          // DELETE RESTRICT blocks the delete just as firmly as a required one,
          // and reversing the insert order therefore fails with "that record is
          // referenced elsewhere".
          //
          // One TRUNCATE ... CASCADE over every table settles it without any
          // ordering at all.
          //
          // audit_log is NOT in the list, and its absence is load-bearing:
          // TRUNCATE does not fire the row-level trigger that makes the log
          // append-only, so including it would quietly do the one thing
          // FR-LOG-004 exists to prevent.
          // FOREIGN KEY CHECKS ARE DEFERRED FOR THE RESTORE, which is what
          // pg_restore does with --disable-triggers and for the same reason.
          //
          // The insert order is computed from REQUIRED relations only. That is
          // not enough: an OPTIONAL foreign key still has to point at a row
          // that exists at the moment it is written, so it constrains the order
          // as well — and honouring every optional relation produces genuine
          // cycles (a DiscussionPost's parent is a DiscussionPost; a Payment
          // and a RegistrationRequest point at each other). There is no order
          // that satisfies all of them.
          //
          // SET LOCAL, so it lasts exactly as long as this transaction and
          // reverts on commit or rollback without anything having to remember.
          // The constraints are still there and still checked on every write
          // afterwards; they are only stood down while the archive lands whole.
          await db.$executeRawUnsafe(`SET LOCAL session_replication_role = 'replica'`);

          const tables = this.tableNames();
          await db.$executeRawUnsafe(
            `TRUNCATE TABLE ${tables.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`,
          );
          for (const name of order) {
            if (NEVER_RESTORED.has(name)) continue;
            const rows = byModel.get(name) ?? [];
            if (rows.length === 0) continue;
            const delegate = this.delegate(db, name);
            if (!delegate) continue;
            await delegate.createMany({ data: rows as never, skipDuplicates: true });
            loaded.push({ model: name, rows: rows.length });
          }
        },
        { timeout: 10 * 60_000, maxWait: 30_000 },
      ),
    );

    await this.audit.record({
      action: "backup.restore",
      entityType: "Backup",
      entityId: id,
      after: { takenAt: manifest.takenAt, rowsLoaded: loaded.reduce((n, c) => n + c.rows, 0) },
    });

    this.logger.warn(`RESTORED from ${id}, taken ${manifest.takenAt}.`);

    return {
      id,
      restored: true,
      takenAt: manifest.takenAt,
      rowsLoaded: loaded.reduce((n, c) => n + c.rows, 0),
      // Said explicitly. Somebody restoring an old snapshot should know the
      // record of everything since is still there — including this restore.
      auditLogPreserved: true,
      message:
        "Restored. Turn maintenance mode off when you have checked it. Everything that happened " +
        "after the backup was taken is gone, EXCEPT the audit log, which is append-only and " +
        "still holds the record of it.",
    };
  }

  /** FR-OPS-035 — keep the newest few and remove the rest. */
  private async prune() {
    const keep = 7;
    const { backups } = await this.list();
    for (const old of prunable(backups, keep)) {
      try {
        unlinkSync(join(this.directory, `${old.id}.ndjson.gz`));
        unlinkSync(join(this.directory, `${old.id}.manifest.json`));
      } catch {
        // A backup that will not delete is not worth failing the new one over.
      }
    }
  }

  /**
   * The physical tables to empty: every model except those never restored.
   *
   * Read from the DMMF so a new model is included the day it is added, rather
   * than the day somebody remembers to add it here.
   */
  private tableNames(): string[] {
    return Prisma.dmmf.datamodel.models
      .filter((m) => !NEVER_RESTORED.has(m.name))
      .map((m) => m.dbName ?? m.name);
  }

  /** The models, as backup-plan needs them, straight from the schema. */
  private models(): ModelShape[] {
    return Prisma.dmmf.datamodel.models.map((m) => ({
      name: m.name,
      relations: m.fields
        .filter((f) => f.kind === "object" && !f.isList)
        .map((f) => ({ target: f.type, optional: !f.isRequired })),
    }));
  }

  private delegate(
    db: unknown,
    model: string,
  ): { findMany: (a?: unknown) => Promise<unknown[]>; deleteMany: (a: unknown) => Promise<unknown>; createMany: (a: unknown) => Promise<unknown> } | null {
    const key = model.charAt(0).toLowerCase() + model.slice(1);
    const client = db as Record<string, unknown>;
    const delegate = client[key];
    return delegate && typeof delegate === "object" ? (delegate as never) : null;
  }

  private async readAll(model: string): Promise<Array<Record<string, unknown>>> {
    return this.prisma.asSystem(async (db) => {
      const delegate = this.delegate(db, model);
      if (!delegate) return [];
      return (await delegate.findMany()) as Array<Record<string, unknown>>;
    });
  }

  private async schemaVersion(): Promise<string> {
    const rows = await this.prisma.asSystem((db) =>
      db.$queryRawUnsafe<Array<{ migration_name: string }>>(
        `select migration_name from _prisma_migrations where finished_at is not null
         order by finished_at desc limit 1`,
      ),
    );
    return rows[0]?.migration_name ?? "unknown";
  }
}

/**
 * JSON does not carry BigInt, Decimal or Date.
 *
 * Left to JSON.stringify, a BigInt THROWS and a Decimal becomes an object that
 * silently restores as `{}`. A file size or a fee amount coming back as an
 * empty object is the kind of corruption nobody notices until the figures are
 * wrong, so both are tagged on the way out and rebuilt on the way in.
 */
function encode(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (typeof value === "bigint") out[key] = { $bigint: value.toString() };
    else if (value instanceof Date) out[key] = { $date: value.toISOString() };
    else if (value instanceof Prisma.Decimal) out[key] = { $decimal: value.toString() };
    else out[key] = value;
  }
  return out;
}

function decode(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const tagged = value as Record<string, string>;
      if ("$bigint" in tagged) {
        out[key] = BigInt(tagged["$bigint"] as string);
        continue;
      }
      if ("$date" in tagged) {
        out[key] = new Date(tagged["$date"] as string);
        continue;
      }
      if ("$decimal" in tagged) {
        out[key] = new Prisma.Decimal(tagged["$decimal"] as string);
        continue;
      }
    }
    out[key] = value;
  }
  return out;
}
