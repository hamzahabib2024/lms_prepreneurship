/**
 * Late submission penalty — SRS FR-ASG-003, FR-ASG-026, BR-ASG-03.
 *
 * A pure function with no dependencies, deliberately. This is arithmetic that
 * decides a student's mark, so it must be provable in isolation rather than
 * only observable through a database and an HTTP request. BR-ASG-03 requires
 * the System to compute it from the configured policy — never a teacher
 * entering a reduced figure by hand, which is unreproducible and unarguable.
 */

export type LatePolicy =
  | "NOT_ACCEPTED"
  | "FLAG_ONLY"
  | "FIXED_DEDUCTION"
  | "PER_DAY_PERCENT";

export interface PenaltyPolicy {
  latePolicy: LatePolicy;
  /** Marks for FIXED_DEDUCTION; percent-per-day for PER_DAY_PERCENT. */
  latePenaltyValue?: number | null;
  /** Minimum retainable mark, as a PERCENTAGE of marksAvailable. */
  latePenaltyFloor?: number | null;
  marksAvailable: number;
}

export interface PenaltyResult {
  rawMarks: number;
  penaltyApplied: number;
  finalMarks: number;
  /** Plain-language explanation shown to the student (NFR-USE-007). */
  explanation: string;
}

/** A day is started, not completed: one minute late is one day's penalty. */
export function daysLate(minutesLate: number): number {
  if (minutesLate <= 0) return 0;
  return Math.ceil(minutesLate / (60 * 24));
}

/**
 * Determines lateness against the deadline, the grace period, and any
 * individual extension.
 *
 * BR-ASG-04: `submittedAt` must be the SERVER's time at completion of upload.
 * A client-supplied timestamp turns the deadline into an honour system.
 */
export function assessLateness(input: {
  submittedAt: Date;
  dueAt: Date;
  graceMinutes?: number;
  /** FR-ASG-024 — an individual extension replaces the deadline entirely. */
  extendedTo?: Date | null;
  hardCloseAt?: Date | null;
}): { isLate: boolean; minutesLate: number; isAfterHardClose: boolean } {
  const effectiveDue = input.extendedTo ?? input.dueAt;
  const graceMs = (input.graceMinutes ?? 0) * 60_000;
  const deadline = effectiveDue.getTime() + graceMs;

  const isAfterHardClose =
    !!input.hardCloseAt && input.submittedAt.getTime() > input.hardCloseAt.getTime();

  const overrunMs = input.submittedAt.getTime() - deadline;
  if (overrunMs <= 0) {
    return { isLate: false, minutesLate: 0, isAfterHardClose };
  }

  return {
    isLate: true,
    // Measured from the ORIGINAL deadline, not the end of grace. Grace decides
    // whether a submission is accepted; it does not make it on time.
    minutesLate: Math.ceil((input.submittedAt.getTime() - effectiveDue.getTime()) / 60_000),
    isAfterHardClose,
  };
}

/**
 * Applies the configured penalty to a raw mark.
 *
 * The floor exists so that a very late but genuine submission is still worth
 * attempting. Without it, a per-day policy drives a mark to zero within days
 * and removes any incentive to finish the work at all.
 */
export function applyLatePenalty(
  rawMarks: number,
  minutesLate: number,
  policy: PenaltyPolicy,
): PenaltyResult {
  const clampedRaw = Math.max(0, Math.min(rawMarks, policy.marksAvailable));

  if (minutesLate <= 0 || policy.latePolicy === "NOT_ACCEPTED") {
    // NOT_ACCEPTED never reaches grading — submission is refused up front
    // (FR-ASG-020). If a record somehow exists, do not penalise it twice.
    return {
      rawMarks: clampedRaw,
      penaltyApplied: 0,
      finalMarks: clampedRaw,
      explanation: "Submitted on time.",
    };
  }

  if (policy.latePolicy === "FLAG_ONLY") {
    return {
      rawMarks: clampedRaw,
      penaltyApplied: 0,
      finalMarks: clampedRaw,
      explanation: `Submitted ${describeLateness(minutesLate)} late. No marks were deducted.`,
    };
  }

  const floorMarks =
    policy.latePenaltyFloor != null
      ? (policy.marksAvailable * policy.latePenaltyFloor) / 100
      : 0;

  let penalty: number;
  let basis: string;

  if (policy.latePolicy === "FIXED_DEDUCTION") {
    penalty = policy.latePenaltyValue ?? 0;
    basis = `a fixed deduction of ${round2(penalty)} marks`;
  } else {
    const days = daysLate(minutesLate);
    const percent = (policy.latePenaltyValue ?? 0) * days;
    penalty = (policy.marksAvailable * percent) / 100;
    basis = `${round2(policy.latePenaltyValue ?? 0)}% per day for ${days} day${days === 1 ? "" : "s"}`;
  }

  // The penalty may not push the mark below the floor, and may not create a
  // negative mark even without one.
  const uncapped = clampedRaw - penalty;
  const finalMarks = round2(Math.max(floorMarks, Math.max(0, uncapped)));
  const actualPenalty = round2(clampedRaw - finalMarks);

  const flooredNote =
    uncapped < floorMarks
      ? ` The deduction was capped so the mark does not fall below the ${round2(policy.latePenaltyFloor ?? 0)}% floor.`
      : "";

  return {
    rawMarks: round2(clampedRaw),
    penaltyApplied: actualPenalty,
    finalMarks,
    explanation:
      `Submitted ${describeLateness(minutesLate)} late — ${basis}, ` +
      `reducing ${round2(clampedRaw)} to ${finalMarks}.${flooredNote}`,
  };
}

function describeLateness(minutesLate: number): string {
  if (minutesLate < 60) return `${minutesLate} minute${minutesLate === 1 ? "" : "s"}`;
  if (minutesLate < 60 * 24) {
    const h = Math.floor(minutesLate / 60);
    const m = minutesLate % 60;
    return m === 0 ? `${h} hour${h === 1 ? "" : "s"}` : `${h}h ${m}m`;
  }
  const d = Math.floor(minutesLate / (60 * 24));
  const h = Math.floor((minutesLate % (60 * 24)) / 60);
  return h === 0 ? `${d} day${d === 1 ? "" : "s"}` : `${d}d ${h}h`;
}

/** Currency-style rounding; marks are displayed to two places. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
