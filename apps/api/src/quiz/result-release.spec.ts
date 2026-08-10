import { isResultVisible, shouldStampRelease, type ReleaseInput } from "./result-release";

/**
 * Result release — FR-QIZ-018/021, BR-QIZ-07.
 *
 * REGRESSION TESTS. Three of the four policies were never acted on: only
 * IMMEDIATE stamped releasedAt, and only at submission. A quiz containing an
 * essay was marked by the teacher, scored correctly, and then told the student
 * for ever that marking was still in progress.
 */

const CLOSES = new Date("2026-08-20T18:00:00Z");
const BEFORE = new Date("2026-08-19T10:00:00Z");
const AFTER = new Date("2026-08-21T10:00:00Z");

const input = (over: Partial<ReleaseInput>): ReleaseInput => ({
  policy: "AFTER_GRADING",
  releasedAt: null,
  awaitingManualMarking: false,
  closesAt: CLOSES,
  now: BEFORE,
  ...over,
});

describe("nothing is visible while a marker still has work", () => {
  it.each(["IMMEDIATE", "AFTER_CLOSE", "AFTER_GRADING", "MANUAL"] as const)(
    "%s withholds an unmarked attempt",
    (policy) => {
      // A partial score reads as a final one, so no policy may show it.
      expect(isResultVisible(input({ policy, awaitingManualMarking: true }))).toBe(false);
    },
  );

  it("withholds even after the quiz has closed", () => {
    expect(
      isResultVisible(
        input({ policy: "AFTER_CLOSE", awaitingManualMarking: true, now: AFTER }),
      ),
    ).toBe(false);
  });
});

describe("IMMEDIATE", () => {
  it("shows a fully auto-marked attempt at once", () => {
    expect(isResultVisible(input({ policy: "IMMEDIATE" }))).toBe(true);
  });

  it("stamps the release", () => {
    expect(shouldStampRelease(input({ policy: "IMMEDIATE" }))).toBe(true);
  });
});

describe("AFTER_CLOSE", () => {
  it("withholds while the quiz is still open", () => {
    // The point of the policy: a student who finishes early must not be able
    // to tell classmates which answers were right.
    expect(isResultVisible(input({ policy: "AFTER_CLOSE", now: BEFORE }))).toBe(false);
  });

  it("shows once the window has shut", () => {
    expect(isResultVisible(input({ policy: "AFTER_CLOSE", now: AFTER }))).toBe(true);
  });

  it("does NOT stamp, because visibility is evaluated on read", () => {
    // Stamping at the exact closing moment would need a scheduled job. The
    // result becomes visible on the next read instead.
    expect(shouldStampRelease(input({ policy: "AFTER_CLOSE", now: AFTER }))).toBe(false);
  });
});

describe("AFTER_GRADING", () => {
  it("shows once marking is done", () => {
    // THE CASE THAT WAS BROKEN. This is the seeded quiz's situation: an essay,
    // marked by the teacher, and previously invisible for ever.
    expect(isResultVisible(input({ policy: "AFTER_GRADING", awaitingManualMarking: false }))).toBe(
      true,
    );
  });

  it("stamps the release", () => {
    expect(shouldStampRelease(input({ policy: "AFTER_GRADING" }))).toBe(true);
  });

  it("shows regardless of whether the quiz is still open", () => {
    expect(isResultVisible(input({ policy: "AFTER_GRADING", now: BEFORE }))).toBe(true);
    expect(isResultVisible(input({ policy: "AFTER_GRADING", now: AFTER }))).toBe(true);
  });
});

describe("MANUAL", () => {
  it("withholds until a teacher acts", () => {
    expect(isResultVisible(input({ policy: "MANUAL", now: AFTER }))).toBe(false);
  });

  it("never stamps by itself", () => {
    expect(shouldStampRelease(input({ policy: "MANUAL" }))).toBe(false);
  });

  it("shows once a teacher has released it", () => {
    expect(isResultVisible(input({ policy: "MANUAL", releasedAt: new Date() }))).toBe(true);
  });
});

describe("a release is never withdrawn", () => {
  it.each(["IMMEDIATE", "AFTER_CLOSE", "AFTER_GRADING", "MANUAL"] as const)(
    "%s keeps showing a stamped result",
    (policy) => {
      // Taking a number back after a student has read it is worse than
      // releasing early: it looks like a fault or a reversal.
      expect(isResultVisible(input({ policy, releasedAt: new Date("2026-08-01") }))).toBe(true);
    },
  );

  it("keeps showing it even if an answer is reopened for re-marking", () => {
    expect(
      isResultVisible(
        input({ releasedAt: new Date("2026-08-01"), awaitingManualMarking: true }),
      ),
    ).toBe(true);
  });

  it("does not stamp twice", () => {
    expect(shouldStampRelease(input({ releasedAt: new Date("2026-08-01") }))).toBe(false);
  });
});
