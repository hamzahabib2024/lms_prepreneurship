/**
 * When a quiz result becomes visible — SRS §5.10, FR-QIZ-018/021, BR-QIZ-07.
 *
 * A pure function, because "may this student see their score yet?" is a rule
 * with four branches and a time comparison, and it is asked from three places.
 * Written once and tested, rather than reimplemented at each call site.
 *
 * The four policies were declared in the schema from the start, but only
 * IMMEDIATE was ever acted on: releasedAt was stamped at submission when the
 * quiz needed no manual marking, and nothing ever stamped it otherwise. A quiz
 * containing an essay therefore stayed invisible for ever — the teacher marked
 * it, the score was computed, and the student was told indefinitely that
 * marking was still in progress.
 */

export type ResultReleasePolicy = "IMMEDIATE" | "AFTER_CLOSE" | "AFTER_GRADING" | "MANUAL";

export interface ReleaseInput {
  policy: ResultReleasePolicy;
  /** Already stamped — a release, once made, is never withdrawn. */
  releasedAt: Date | null;
  /** True while any answer still needs a human. */
  awaitingManualMarking: boolean;
  closesAt: Date;
  now: Date;
}

/**
 * Whether the score may be shown.
 *
 * A stamped releasedAt always wins. Taking a result back after a student has
 * seen it is worse than releasing it early: they have already read the number,
 * and hiding it looks like a fault or a reversal.
 */
export function isResultVisible(input: ReleaseInput): boolean {
  if (input.releasedAt !== null) return true;

  // Nothing is visible while a marker still has work to do, whatever the
  // policy says. A partial score reads as a final one.
  if (input.awaitingManualMarking) return false;

  switch (input.policy) {
    case "IMMEDIATE":
      return true;
    case "AFTER_CLOSE":
      // Held until the window shuts, so a student who finishes early cannot
      // tell classmates which answers were right (BR-QIZ-07).
      return input.now > input.closesAt;
    case "AFTER_GRADING":
      // Reaching here means marking is done, since the guard above returned.
      return true;
    case "MANUAL":
      // Only a teacher's explicit act, which stamps releasedAt.
      return false;
  }
}

/**
 * Whether this transition should STAMP releasedAt, rather than merely compute
 * visibility.
 *
 * Kept separate because the two questions differ for AFTER_CLOSE: the result
 * becomes visible the moment the window shuts, and stamping it would otherwise
 * need a scheduled job running at exactly that time. Visibility is evaluated on
 * read; the stamp records a decision that was actually taken.
 */
export function shouldStampRelease(input: ReleaseInput): boolean {
  if (input.releasedAt !== null) return false;
  if (input.awaitingManualMarking) return false;
  return input.policy === "IMMEDIATE" || input.policy === "AFTER_GRADING";
}
