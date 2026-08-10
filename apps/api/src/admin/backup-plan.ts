/**
 * Backup and restore — SRS §5.25, FR-OPS-030..038.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS, AND WHAT IT IS NOT. Read this before relying on it.
 * ---------------------------------------------------------------------------
 * This is a DATA backup: every row of every table, written out and read back
 * by the application itself. It is NOT a pg_dump, and the difference matters.
 *
 *   - It does not capture the SCHEMA: no tables, indexes, constraints,
 *     triggers or extensions. This System has hand-written partial indexes,
 *     CHECK constraints and the append-only trigger on the audit log, and none
 *     of them are in here.
 *
 *   - So a restore is: create the database, run `prisma migrate deploy` and
 *     `db:constraints` to build the structure, THEN load the rows. That is
 *     documented in the restore endpoint and refused if the structure is
 *     missing.
 *
 * The embedded PostgreSQL this project runs on ships initdb, pg_ctl and
 * postgres and NOT pg_dump, so a physical backup is not available from inside
 * the application. A production deployment should have one as well, taken by
 * the database host. This exists so that an institute running the System has
 * something rather than nothing, and so that what it has is verifiable.
 *
 * ---------------------------------------------------------------------------
 * A BACKUP NOBODY HAS RESTORED IS A HOPE, NOT A BACKUP. The verify step is the
 * point of this module: it re-reads the archive, checks the checksum and
 * compares the row counts against the manifest written at the time. An archive
 * that cannot be read is reported as broken while somebody can still do
 * something about it.
 */

export interface ModelRelation {
  /** The model this one points AT. */
  target: string;
  /** A required relation must exist before this row can be written. */
  optional: boolean;
}

export interface ModelShape {
  name: string;
  relations: ModelRelation[];
}

export interface PlanProblem {
  code: "CYCLE";
  message: string;
  models: string[];
}

/**
 * The order to write rows back in.
 *
 * A row cannot reference a parent that is not there yet, so parents come first
 * — a topological sort over the required relations. OPTIONAL relations are
 * ignored deliberately: they are nullable, so the row can be written and the
 * link satisfied later, and including them creates cycles that do not exist in
 * practice (a User points at nothing, but half the System points at User).
 */
export function restoreOrder(models: ModelShape[]): {
  order: string[];
  problems: PlanProblem[];
} {
  const byName = new Map(models.map((m) => [m.name, m]));
  const order: string[] = [];
  const state = new Map<string, "visiting" | "done">();
  const problems: PlanProblem[] = [];

  const visit = (name: string, path: string[]): void => {
    const current = state.get(name);
    if (current === "done") return;
    if (current === "visiting") {
      // A genuine cycle among REQUIRED relations. It cannot be ordered, and
      // saying which models are involved is the only useful thing to do.
      const cycle = [...path.slice(path.indexOf(name)), name];
      if (!problems.some((p) => p.models.join(">") === cycle.join(">"))) {
        problems.push({
          code: "CYCLE",
          message:
            `${cycle.join(" → ")} reference each other and cannot be ordered. ` +
            `One of those relations has to be optional.`,
          models: cycle,
        });
      }
      return;
    }

    state.set(name, "visiting");
    const model = byName.get(name);
    for (const relation of model?.relations ?? []) {
      if (relation.optional) continue;
      if (!byName.has(relation.target)) continue;
      visit(relation.target, [...path, name]);
    }
    state.set(name, "done");
    order.push(name);
  };

  // Sorted first, so the same schema always produces the same order and two
  // archives of one database are comparable.
  for (const model of [...models].sort((a, b) => a.name.localeCompare(b.name))) {
    visit(model.name, []);
  }

  return { order, problems };
}

/**
 * Tables a restore must NOT touch.
 *
 * The audit log is append-only, enforced by a database trigger (FR-LOG-004),
 * and the first restore attempt failed against exactly that: "audit_log is
 * append-only: DELETE is not permitted". The trigger was right and the restore
 * was wrong.
 *
 * IT IS NOT MERELY A TECHNICAL OBSTACLE. If a restore could empty the audit log
 * and reload an older copy, then restoring a backup taken before an action
 * would erase the record of it — the tidiest possible way to launder a trail.
 * A log the Institute can rewrite by restoring around it is not a log.
 *
 * So the audit log is BACKED UP, because a copy is worth having, and never
 * restored over. After a restore the data is the archive's and the record of
 * what happened is unbroken, including the restore itself.
 */
export const NEVER_RESTORED: ReadonlySet<string> = new Set(["AuditLog"]);

export interface TableCount {
  model: string;
  rows: number;
}

export interface Manifest {
  version: 1;
  takenAt: string;
  /** Which migration the schema was at. A restore onto a different one is a
   *  different database, and the mismatch is worth refusing over. */
  schemaVersion: string;
  counts: TableCount[];
  /** SHA-256 of the payload, so a truncated file is caught rather than loaded. */
  checksum: string;
  totalRows: number;
}

export interface VerifyProblem {
  code: "CHECKSUM" | "MISSING_MODEL" | "COUNT_MISMATCH" | "UNREADABLE";
  message: string;
}

/**
 * Is this archive what it says it is?
 *
 * Compares the checksum of what was read against the manifest, then the row
 * counts model by model. Both matter and they fail differently: a checksum
 * mismatch means the file is damaged, a count mismatch means it was written
 * while the database was changing.
 */
export function verifyAgainst(
  manifest: Manifest,
  actual: { checksum: string; counts: TableCount[] },
): VerifyProblem[] {
  const problems: VerifyProblem[] = [];

  if (actual.checksum !== manifest.checksum) {
    problems.push({
      code: "CHECKSUM",
      message:
        "The archive does not match its checksum. It has been truncated or altered since it " +
        "was written, and restoring from it would load whatever survived.",
    });
  }

  const actualByModel = new Map(actual.counts.map((c) => [c.model, c.rows]));
  for (const expected of manifest.counts) {
    if (!actualByModel.has(expected.model)) {
      problems.push({
        code: "MISSING_MODEL",
        message: `${expected.model} is in the manifest but not in the archive.`,
      });
      continue;
    }
    const found = actualByModel.get(expected.model) as number;
    if (found !== expected.rows) {
      problems.push({
        code: "COUNT_MISMATCH",
        message: `${expected.model}: the manifest says ${expected.rows} rows, the archive has ${found}.`,
      });
    }
  }

  return problems;
}

/**
 * FR-OPS-035 — which backups to keep.
 *
 * Newest first, keep a fixed number. Not "delete older than 30 days": a system
 * that has been off for a month would delete everything it had on the morning
 * somebody needed it, which is exactly the wrong moment to discover the policy.
 */
export function prunable<T extends { takenAt: Date }>(backups: T[], keep: number): T[] {
  if (keep < 1) return [];
  return [...backups]
    .sort((a, b) => b.takenAt.getTime() - a.takenAt.getTime())
    .slice(keep);
}

/** How old, in words, because "1786400000000" means nothing on a screen. */
export function ageOf(takenAt: Date, now: Date): string {
  const minutes = Math.floor((now.getTime() - takenAt.getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
