/**
 * When an attendance warning is worth raising — SRS FR-ATT-020/021/022,
 * Appendix F.
 *
 * A pure module, because the hard part of an early-warning system is not
 * noticing the problem. It is deciding when to say so.
 *
 * evaluateThresholds runs on EVERY register a teacher marks and every
 * correction they make. A student at 58 % is below the critical threshold after
 * Monday's class, and after Tuesday's, and after Wednesday's. Telling them each
 * time is how a system teaches people to ignore it — and the one message that
 * mattered is then indistinguishable from the eleven that did not.
 *
 * So a notification is raised on a TRANSITION, never on a state:
 *
 *   nothing  -> WARNING   say so
 *   WARNING  -> CRITICAL  say so, it got worse
 *   CRITICAL -> WARNING   say nothing; they are recovering and know why
 *   CRITICAL -> CRITICAL  say nothing; they were told
 *   below    -> above     record the recovery, say nothing
 *
 * Recovering and relapsing DOES warn again: the student fixed it once and has
 * slipped back, which is new information.
 */

export type Severity = "WARNING" | "CRITICAL";

export interface WarningState {
  severity: Severity;
  /** Set when the student climbed back above the threshold. */
  clearedAt: Date | null;
}

export interface ThresholdConfig {
  /** CFG-ATT-01, default 75. */
  warningPercent: number;
  /** CFG-ATT-02, default 60. */
  criticalPercent: number;
  /**
   * FR-ATT-020 — below this many marked sessions, no warning is raised at all.
   * One missed class out of two is 50 %, and flagging it produces noise a
   * teacher learns to dismiss before the figure means anything.
   */
  minimumSessions: number;
}

export type WarningDecision =
  | { action: "NONE"; reason: string }
  | { action: "CLEAR"; reason: string }
  | { action: "RAISE"; severity: Severity; reason: string };

/** Which band a percentage falls in, or null when it is acceptable. */
export function severityFor(
  percentage: number,
  config: ThresholdConfig,
): Severity | null {
  if (percentage < config.criticalPercent) return "CRITICAL";
  if (percentage < config.warningPercent) return "WARNING";
  return null;
}

const RANK: Record<Severity, number> = { WARNING: 1, CRITICAL: 2 };

/**
 * Decides what to do about one student in one subject.
 *
 * `previous` is the warning state already recorded, or null if none.
 */
export function decideWarning(input: {
  percentage: number | null;
  sessionsInDenominator: number;
  previous: WarningState | null;
  config: ThresholdConfig;
}): WarningDecision {
  const { percentage, sessionsInDenominator, previous, config } = input;

  if (percentage === null) {
    return { action: "NONE", reason: "No attendance has been marked yet." };
  }

  if (sessionsInDenominator < config.minimumSessions) {
    // Deliberately BEFORE the severity check. A student who has missed the only
    // class held so far is at 0 %, and telling them they are in critical
    // difficulty after one absence is wrong about the facts.
    return {
      action: "NONE",
      reason: `Only ${sessionsInDenominator} session(s) marked; the figure is not yet meaningful.`,
    };
  }

  const current = severityFor(percentage, config);

  if (current === null) {
    // Above the threshold. Clear a live warning so a later relapse warns again.
    return previous && previous.clearedAt === null
      ? { action: "CLEAR", reason: "Attendance has recovered above the threshold." }
      : { action: "NONE", reason: "Attendance is above the threshold." };
  }

  if (!previous) {
    return { action: "RAISE", severity: current, reason: "First time below the threshold." };
  }

  if (previous.clearedAt !== null) {
    // They recovered and slipped back. That is new information, so say it
    // again even at the same level as before.
    return { action: "RAISE", severity: current, reason: "Fell below the threshold again." };
  }

  if (RANK[current] > RANK[previous.severity]) {
    return { action: "RAISE", severity: current, reason: "The situation got worse." };
  }

  return {
    action: "NONE",
    reason:
      RANK[current] < RANK[previous.severity]
        ? "Improving, but still below the threshold; they were already told."
        : "Unchanged; they were already told.",
  };
}

/**
 * The message a student receives.
 *
 * States the figure, the requirement and the gap, because "your attendance is
 * low" gives somebody nothing to act on (NFR-USE-007). No teacher's name and no
 * comparison with classmates: this is about them.
 */
export function warningMessage(
  severity: Severity,
  percentage: number,
  subjectName: string,
  config: ThresholdConfig,
): { title: string; body: string } {
  const required = severity === "CRITICAL" ? config.criticalPercent : config.warningPercent;
  const gap = Math.round((required - percentage) * 10) / 10;

  return {
    title:
      severity === "CRITICAL"
        ? `Your attendance in ${subjectName} needs attention`
        : `Your attendance in ${subjectName} is below the requirement`,
    body:
      severity === "CRITICAL"
        ? `You are at ${percentage}%, which is ${gap} points below the ${required}% ` +
          `required to complete this subject. Speak to your teacher about how to catch up.`
        : `You are at ${percentage}%, which is ${gap} points below the ${required}% ` +
          `required. Attending the next few classes will bring this back up.`,
  };
}
