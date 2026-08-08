/**
 * Progress computation — SRS §5.14, Figure 5-3.
 *
 * A pure function, for the same reason as the late-penalty engine: this number
 * appears on the student's dashboard, drives certification, and will be
 * questioned. FR-PRG-004 requires the breakdown to be shown so the figure is
 * explicable — an opaque percentage generates support enquiries and mistrust.
 */

export type ComponentKey = "video" | "assignment" | "quiz" | "attendance";

export interface ComponentInput {
  /** How many items the student has completed. */
  completed: number;
  /** How many items exist. Zero means the component does not apply yet. */
  total: number;
}

export type ComponentInputs = Record<ComponentKey, ComponentInput>;

/** Institute defaults (CFG-PRG-01..04). Configurable per subject. */
export const DEFAULT_WEIGHTS: Record<ComponentKey, number> = {
  video: 0.3,
  assignment: 0.3,
  quiz: 0.25,
  attendance: 0.15,
};

export interface ComponentResult {
  key: ComponentKey;
  weight: number;
  value: number;
  completed: number;
  total: number;
  included: boolean;
  detail: string;
}

export interface ProgressResult {
  overallPercent: number;
  components: ComponentResult[];
  /** True when a component was excluded and its weight redistributed. */
  weightsRedistributed: boolean;
  /** The weights ACTUALLY used, persisted so a historical figure stays reproducible. */
  weightsApplied: Record<ComponentKey, number>;
}

/**
 * BR-PRG-02 — weights must sum to 1.00.
 *
 * Validated on configuration save rather than silently normalised, because a
 * set of weights summing to 0.9 is a mistake, and quietly scaling it hides the
 * mistake while producing figures nobody can reconcile.
 */
export function validateWeights(weights: Record<ComponentKey, number>): void {
  const sum = Object.values(weights).reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 1) > 0.0001) {
    throw new Error(`Progress weights must sum to 1.00; these sum to ${sum.toFixed(4)}.`);
  }
  for (const [key, w] of Object.entries(weights)) {
    if (w < 0 || w > 1) throw new Error(`Weight for "${key}" must be between 0 and 1.`);
  }
}

/**
 * Computes weighted progress.
 *
 * BR-PRG-03 is the subtle rule: a component whose denominator is zero is
 * EXCLUDED and its weight redistributed proportionally across the rest.
 *
 * Without that, a subject with no quizzes would cap every student at 75% for
 * the whole term — they would be told they had failed to do something that
 * does not exist. Treating the absent component as zero is the single most
 * common way this calculation is got wrong.
 */
export function computeProgress(
  inputs: ComponentInputs,
  weights: Record<ComponentKey, number> = DEFAULT_WEIGHTS,
): ProgressResult {
  const keys = Object.keys(weights) as ComponentKey[];

  const applicable = keys.filter((k) => (inputs[k]?.total ?? 0) > 0);
  const excluded = keys.filter((k) => (inputs[k]?.total ?? 0) === 0);

  // Nothing exists yet in any component. 0% is honest; NaN is not, and 100%
  // would be a lie a student would happily accept.
  if (applicable.length === 0) {
    return {
      overallPercent: 0,
      components: keys.map((key) => ({
        key,
        weight: 0,
        value: 0,
        completed: 0,
        total: 0,
        included: false,
        detail: "Nothing published yet",
      })),
      weightsRedistributed: false,
      weightsApplied: Object.fromEntries(keys.map((k) => [k, 0])) as Record<ComponentKey, number>,
    };
  }

  // Redistribute proportionally, preserving the relative importance the
  // Institute configured rather than flattening to an equal split.
  const applicableWeightSum = applicable.reduce((sum, k) => sum + weights[k], 0);
  const effective = {} as Record<ComponentKey, number>;
  for (const k of keys) {
    effective[k] = applicable.includes(k) ? weights[k] / applicableWeightSum : 0;
  }

  let overall = 0;
  const components: ComponentResult[] = keys.map((key) => {
    const input = inputs[key] ?? { completed: 0, total: 0 };
    const included = input.total > 0;
    // Clamped: a data error giving completed > total must not push progress
    // above 100% and hand out an unearned certificate.
    const value = included ? Math.min(100, (input.completed / input.total) * 100) : 0;
    if (included) overall += value * effective[key];

    return {
      key,
      weight: round4(effective[key]),
      value: round1(value),
      completed: input.completed,
      total: input.total,
      included,
      detail: included
        ? `${input.completed} of ${input.total} complete`
        : "Not applicable — nothing published",
    };
  });

  return {
    overallPercent: round1(overall),
    components,
    weightsRedistributed: excluded.length > 0,
    weightsApplied: effective,
  };
}

export interface CompletionCriteria {
  minProgressPercent?: number;
  minAttendancePercent?: number;
  minAverageGradePercent?: number;
}

export interface CompletionResult {
  met: boolean;
  /** FR-PRG-010 — exactly what remains, in plain language. */
  outstanding: string[];
}

/**
 * FR-PRG-008/010 — evaluates completion and says precisely what is missing.
 *
 * "Not yet eligible" is useless to a student. "5 lectures remaining, and your
 * attendance is 3.6 points below the required 75%" is something they can act
 * on, which is the whole point of showing it.
 */
export function evaluateCompletion(
  progress: ProgressResult,
  criteria: CompletionCriteria,
  actuals: { attendancePercent: number | null; averageGradePercent: number | null },
): CompletionResult {
  const outstanding: string[] = [];

  if (criteria.minProgressPercent != null && progress.overallPercent < criteria.minProgressPercent) {
    const gap = round1(criteria.minProgressPercent - progress.overallPercent);
    outstanding.push(
      `Overall progress is ${progress.overallPercent}%, which is ${gap} points below the required ${criteria.minProgressPercent}%.`,
    );
    // Name the specific items, since "do more" is not actionable.
    for (const c of progress.components) {
      if (c.included && c.completed < c.total) {
        const remaining = c.total - c.completed;
        outstanding.push(`${remaining} ${labelFor(c.key, remaining)} outstanding.`);
      }
    }
  }

  if (criteria.minAttendancePercent != null) {
    if (actuals.attendancePercent === null) {
      outstanding.push("Attendance has not been recorded yet.");
    } else if (actuals.attendancePercent < criteria.minAttendancePercent) {
      const gap = round1(criteria.minAttendancePercent - actuals.attendancePercent);
      outstanding.push(
        `Attendance is ${actuals.attendancePercent}%, which is ${gap} points below the required ${criteria.minAttendancePercent}%.`,
      );
    }
  }

  if (criteria.minAverageGradePercent != null) {
    if (actuals.averageGradePercent === null) {
      outstanding.push("No graded work yet.");
    } else if (actuals.averageGradePercent < criteria.minAverageGradePercent) {
      const gap = round1(criteria.minAverageGradePercent - actuals.averageGradePercent);
      outstanding.push(
        `Average grade is ${actuals.averageGradePercent}%, which is ${gap} points below the required ${criteria.minAverageGradePercent}%.`,
      );
    }
  }

  return { met: outstanding.length === 0, outstanding };
}

function labelFor(key: ComponentKey, count: number): string {
  const plural = count === 1 ? "" : "s";
  switch (key) {
    case "video":
      return `lecture${plural} not yet watched`;
    case "assignment":
      return `assignment${plural} not yet submitted`;
    case "quiz":
      return `quiz${count === 1 ? "" : "zes"} not yet attempted`;
    case "attendance":
      return `session${plural} missed`;
  }
}

const round1 = (n: number): number => Math.round(n * 10) / 10;
const round4 = (n: number): number => Math.round(n * 10000) / 10000;
