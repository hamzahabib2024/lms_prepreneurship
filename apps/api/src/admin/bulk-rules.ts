/**
 * Bulk operations — SRS §5.24, FR-OPS-020..026.
 *
 * Doing to fifty students what an administrator would otherwise do fifty times.
 *
 * THE DEFECT THIS FEATURE INVITES IS BYPASSING THE RULES. A bulk transfer
 * written as one clever UPDATE moves fifty students in one statement and skips
 * every check the single-student path performs: gender restriction (FR-CRS-009,
 * which is absolute), capacity, archived sections, roll-number allocation. It
 * would be faster, and it would put a male student in a women's section.
 *
 * So the service calls the ORDINARY operation once per student, and this module
 * holds only what is genuinely about the batch: its size, its shape, and how to
 * report on it.
 *
 * IT IS NOT ALL-OR-NOTHING, AND THAT MUST BE SAID. Each student's transfer is
 * atomic in itself; the batch is "as many as could be done". Stopping at the
 * first failure would leave an arbitrary prefix applied and the operator
 * working out where it got to — worse than a complete report of what happened.
 * The preview exists so a careful operator need never find out.
 */

export interface BatchProblem {
  code: "EMPTY" | "TOO_MANY" | "DUPLICATES";
  message: string;
}

/** Above this, it is an import, and imports are a different feature. */
export const MAX_BATCH = 200;

export function refuseBatch(ids: string[], limit = MAX_BATCH): BatchProblem | null {
  if (ids.length === 0) {
    return { code: "EMPTY", message: "Choose at least one student." };
  }

  if (ids.length > limit) {
    return {
      code: "TOO_MANY",
      message:
        `${ids.length} is more than the ${limit} this can do at once. Split it, or use an ` +
        `import if you are loading a whole cohort.`,
    };
  }

  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  }
  if (duplicates.size > 0) {
    // Left in, the second attempt fails with "already in that section" and the
    // report accuses the operator of an error they did not make.
    return {
      code: "DUPLICATES",
      message: `${duplicates.size} ${duplicates.size === 1 ? "student appears" : "students appear"} more than once in the list.`,
    };
  }

  return null;
}

export type RowOutcome = "WOULD_SUCCEED" | "SUCCEEDED" | "FAILED" | "SKIPPED";

export interface RowResult {
  studentId: string;
  name?: string;
  outcome: RowOutcome;
  /** Why it failed or was skipped. Absent on success. */
  message?: string;
}

export interface BatchReport {
  total: number;
  succeeded: number;
  failed: number;
  skipped: number;
  rows: RowResult[];
  /** Said in words, because a caller reading only the counts must not be misled. */
  summary: string;
}

export function report(rows: RowResult[], isPreview: boolean): BatchReport {
  const succeeded = rows.filter(
    (r) => r.outcome === "SUCCEEDED" || r.outcome === "WOULD_SUCCEED",
  ).length;
  const failed = rows.filter((r) => r.outcome === "FAILED").length;
  const skipped = rows.filter((r) => r.outcome === "SKIPPED").length;

  return {
    total: rows.length,
    succeeded,
    failed,
    skipped,
    // Failures first: the rows needing attention should not be below fifty that
    // worked.
    rows: [...rows].sort((a, b) => rank(a.outcome) - rank(b.outcome)),
    summary: summarise({ succeeded, failed, skipped, total: rows.length, isPreview }),
  };
}

function rank(outcome: RowOutcome): number {
  return outcome === "FAILED" ? 0 : outcome === "SKIPPED" ? 1 : 2;
}

function summarise(o: {
  succeeded: number;
  failed: number;
  skipped: number;
  total: number;
  isPreview: boolean;
}): string {
  if (o.isPreview) {
    if (o.failed === 0 && o.skipped === 0) {
      return `All ${o.total} would go through.`;
    }
    return (
      `${o.succeeded} of ${o.total} would go through. ` +
      `${o.failed + o.skipped} would not — fix those first, or run it anyway and they will be ` +
      `left as they are.`
    );
  }

  if (o.failed === 0 && o.skipped === 0) {
    return `All ${o.total} done.`;
  }
  // THE SENTENCE THAT MATTERS. Somebody who reads "38 done" and closes the page
  // must not later discover twelve students never moved.
  return (
    `${o.succeeded} of ${o.total} done. ${o.failed + o.skipped} were NOT changed and are listed ` +
    `first — this is not all-or-nothing, so the rest went through.`
  );
}
