/**
 * Rubric scoring — SRS §8.3.5, FR-ASG-012..018.
 *
 * A rubric turns "17 out of 25" into an account of where the marks went, which
 * is the difference between a mark a student can learn from and one they can
 * only accept.
 *
 * THE SCORES LIVE IN A JSON COLUMN, and that is why this module exists rather
 * than being a few lines in the grading service. `AssignmentGrade.rubricScores`
 * is one opaque value to the database, so:
 *
 *   - the scope predicate cannot filter it. Scope works on rows and relations;
 *     a blob has neither.
 *   - `select` cannot narrow it. There are no columns inside to choose from.
 *   - the nested-include and create-scope guards cannot see into it. They read
 *     the Prisma DMMF, and the DMMF says `Json`.
 *
 * So every rule about who may see which part of it, and about what a valid
 * score even is, has to be enforced here in application code — deliberately, in
 * one place, with tests — because nothing underneath will catch a mistake.
 *
 * FR-ASG-014 IS THE SHARP EDGE. A criterion may be marked internal, meaning it
 * is used to reach the mark but never shown to the student — moderation notes,
 * a plagiarism-suspicion weighting, a marker's confidence. Handing back the
 * whole blob discloses every one of them. `forStudent` is the only function
 * that should ever produce a student-facing rubric breakdown.
 */

/** A criterion as this module needs it. Decimal columns arrive as numbers. */
export interface Criterion {
  id: string;
  name: string;
  maxMarks: number;
  displayOrder: number;
  isInternal: boolean;
  description?: string | null;
  levels?: PerformanceLevel[] | null;
}

/** FR-ASG-013 — a named band with a mark and a description of what earns it. */
export interface PerformanceLevel {
  label: string;
  marks: number;
  text?: string;
}

/** criterion id -> marks awarded. The shape stored in the JSON column. */
export type RubricScores = Record<string, number>;

export interface ScoreProblem {
  criterionId: string | null;
  message: string;
}

/**
 * FR-ASG-012 — is this rubric coherent enough to mark against?
 *
 * Checked when the rubric is saved rather than when it is first used, because
 * the person who can fix it is the one editing it, and a rubric that fails
 * halfway through a marking session has already wasted somebody's evening.
 */
export function validateRubric(criteria: Criterion[]): ScoreProblem[] {
  const problems: ScoreProblem[] = [];

  if (criteria.length === 0) {
    problems.push({ criterionId: null, message: "A rubric needs at least one criterion." });
  }

  // Every criterion must be worth something. A zero-mark criterion is either a
  // mistake or a note pretending to be a criterion, and both are worth saying
  // out loud rather than silently accepting.
  for (const c of criteria) {
    if (!(c.maxMarks > 0)) {
      problems.push({ criterionId: c.id, message: `"${c.name}" must be worth more than zero marks.` });
    }
    if (!Number.isFinite(c.maxMarks)) {
      problems.push({ criterionId: c.id, message: `"${c.name}" has an unusable maximum.` });
    }
    for (const level of c.levels ?? []) {
      if (level.marks < 0 || level.marks > c.maxMarks) {
        problems.push({
          criterionId: c.id,
          message: `Level "${level.label}" awards ${level.marks}, outside 0–${c.maxMarks}.`,
        });
      }
    }
  }

  // A rubric whose criteria are ALL internal produces a mark the student can
  // see with an explanation they cannot, which is worse than no rubric: it
  // implies a breakdown exists and is being withheld.
  if (criteria.length > 0 && criteria.every((c) => c.isInternal)) {
    problems.push({
      criterionId: null,
      message: "Every criterion is internal, so the student would see no breakdown at all.",
    });
  }

  return problems;
}

/** The marks a rubric can award in total, internal criteria included. */
export function rubricTotal(criteria: Criterion[]): number {
  return round2(criteria.reduce((sum, c) => sum + c.maxMarks, 0));
}

/**
 * FR-ASG-015 — does the rubric add up to what the assignment is worth?
 *
 * A warning rather than a refusal. A rubric is reusable across assignments
 * (FR-ASG-012), so the same well-formed rubric legitimately meets a 25-mark and
 * a 50-mark assignment; refusing would make reuse impossible. The teacher is
 * told, and decides.
 */
export function totalsMatch(criteria: Criterion[], assignmentTotalMarks: number): boolean {
  return Math.abs(rubricTotal(criteria) - assignmentTotalMarks) < 0.005;
}

/**
 * FR-ASG-016 — are these scores a valid marking of this rubric?
 *
 * Called on the way IN. Until this existed the grading endpoint accepted
 * `Record<string, number>` and stored it verbatim, so a score could name a
 * criterion belonging to a different rubric, exceed the criterion's maximum, or
 * be negative, and nothing would notice until a student saw "12 out of 10".
 */
export function validateScores(criteria: Criterion[], scores: RubricScores): ScoreProblem[] {
  const problems: ScoreProblem[] = [];
  const byId = new Map(criteria.map((c) => [c.id, c]));

  for (const [criterionId, awarded] of Object.entries(scores)) {
    const criterion = byId.get(criterionId);
    if (!criterion) {
      // Names a criterion this rubric does not have. Almost always a stale
      // browser tab marking against a rubric that has since been edited.
      problems.push({
        criterionId,
        message: "That criterion is not part of this rubric.",
      });
      continue;
    }
    if (typeof awarded !== "number" || !Number.isFinite(awarded)) {
      problems.push({ criterionId, message: `"${criterion.name}" needs a number.` });
      continue;
    }
    if (awarded < 0) {
      problems.push({ criterionId, message: `"${criterion.name}" cannot be negative.` });
    }
    if (awarded > criterion.maxMarks) {
      problems.push({
        criterionId,
        message: `"${criterion.name}" is worth at most ${criterion.maxMarks}, not ${awarded}.`,
      });
    }
  }

  // Partial marking is allowed while the teacher works, but a rubric that is
  // still incomplete must not be what a student is shown. The caller decides
  // which of those it is; `missingCriteria` answers the question separately so
  // that saving a draft and releasing a grade can differ.
  return problems;
}

/** Criteria with no score yet. Empty means the marking is complete. */
export function missingCriteria(criteria: Criterion[], scores: RubricScores): Criterion[] {
  return criteria.filter((c) => !(c.id in scores));
}

/** The mark the rubric produces. Internal criteria COUNT — they earn marks. */
export function totalAwarded(criteria: Criterion[], scores: RubricScores): number {
  const byId = new Map(criteria.map((c) => [c.id, c]));
  let total = 0;
  for (const [criterionId, awarded] of Object.entries(scores)) {
    // Unknown ids contribute nothing rather than throwing. validateScores is
    // what rejects them; this function is also called on stored rows, where a
    // criterion may since have been deleted, and a historic mark must not
    // become uncomputable because a rubric was tidied up afterwards.
    if (byId.has(criterionId) && Number.isFinite(awarded)) total += awarded;
  }
  return round2(total);
}

/**
 * FR-ASG-014 — THE STUDENT-FACING BREAKDOWN.
 *
 * The only function that may produce a rubric breakdown for a student. It drops
 * internal criteria entirely: not the score with the name kept, not the name
 * with the score hidden — the whole row, because "Moderation adjustment" as a
 * heading discloses the moderation just as surely as the number does.
 *
 * The returned total is the sum of the VISIBLE criteria, and it is deliberately
 * NOT the student's mark. Where internal criteria carry marks the two differ,
 * and the honest thing is to show the breakdown as a partial account rather
 * than a total that fails to reconcile with the grade on the same screen. The
 * caller renders `finalMarks` as the mark; `visibleTotal` explains part of it.
 */
export function forStudent(
  criteria: Criterion[],
  scores: RubricScores,
): {
  rows: Array<{ name: string; description: string | null; awarded: number; maxMarks: number }>;
  visibleTotal: number;
  visibleMaxMarks: number;
  isPartialAccount: boolean;
} {
  const visible = criteria
    .filter((c) => !c.isInternal)
    .sort((a, b) => a.displayOrder - b.displayOrder);

  const rows = visible
    // A criterion the teacher has not reached yet is omitted rather than shown
    // as zero. Zero is a judgement; silence is the absence of one.
    .filter((c) => c.id in scores)
    .map((c) => ({
      name: c.name,
      description: c.description ?? null,
      awarded: round2(scores[c.id] as number),
      maxMarks: c.maxMarks,
    }));

  const visibleTotal = round2(rows.reduce((sum, r) => sum + r.awarded, 0));
  const visibleMaxMarks = round2(rows.reduce((sum, r) => sum + r.maxMarks, 0));

  return {
    rows,
    visibleTotal,
    visibleMaxMarks,
    // True when marks were awarded that this breakdown does not explain, so the
    // screen can say so instead of leaving the student to find the discrepancy.
    isPartialAccount: criteria.some((c) => c.isInternal && c.id in scores),
  };
}

/** Marks are money-like: two decimal places, and never 0.30000000000000004. */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
