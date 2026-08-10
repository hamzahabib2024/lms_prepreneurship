import {
  decideWarning,
  severityFor,
  warningMessage,
  type ThresholdConfig,
  type WarningState,
} from "./attendance-warning";

/**
 * Attendance warnings — FR-ATT-020/021/022, Appendix F.
 *
 * The rule that matters is not "is this student below the line". It is "have we
 * already told them". A system that repeats itself after every class is one
 * people stop reading, and then the message that mattered is lost among the
 * ones that did not.
 */

const config: ThresholdConfig = {
  warningPercent: 75,
  criticalPercent: 60,
  minimumSessions: 3,
};

const state = (severity: "WARNING" | "CRITICAL", cleared: Date | null = null): WarningState => ({
  severity,
  clearedAt: cleared,
});

const decide = (
  percentage: number | null,
  previous: WarningState | null = null,
  sessions = 10,
) => decideWarning({ percentage, sessionsInDenominator: sessions, previous, config });

describe("severityFor", () => {
  it.each([
    [100, null],
    [80, null],
    [75, null], // the threshold itself is acceptable
    [74.9, "WARNING"],
    [61, "WARNING"],
    [60, "WARNING"], // critical is BELOW 60, so 60 is still only a warning
    [59.9, "CRITICAL"],
    [0, "CRITICAL"],
  ])("%i%% -> %s", (percentage, expected) => {
    expect(severityFor(percentage as number, config)).toBe(expected);
  });
});

describe("too early to judge", () => {
  it("says nothing before the minimum number of sessions", () => {
    // A student who missed the only class held is at 0%. Telling them they are
    // in critical difficulty after one absence is wrong about the facts.
    expect(decide(0, null, 1).action).toBe("NONE");
    expect(decide(0, null, 2).action).toBe("NONE");
  });

  it("starts judging at the minimum", () => {
    expect(decide(0, null, 3)).toMatchObject({ action: "RAISE", severity: "CRITICAL" });
  });

  it("says nothing when nothing has been marked", () => {
    expect(decide(null).action).toBe("NONE");
  });

  it("checks the session count BEFORE the severity", () => {
    // Otherwise the reason returned would describe a critical problem that the
    // System has decided not to mention, which is worse than saying nothing.
    const decision = decide(0, null, 1);
    expect(decision.reason).toContain("not yet meaningful");
  });
});

describe("raising a warning", () => {
  it("warns the first time a student falls below", () => {
    expect(decide(70)).toMatchObject({ action: "RAISE", severity: "WARNING" });
  });

  it("warns critically the first time, without a warning step first", () => {
    // A student who joins late and misses everything goes straight to critical.
    expect(decide(40)).toMatchObject({ action: "RAISE", severity: "CRITICAL" });
  });

  it("warns again when it gets worse", () => {
    expect(decide(50, state("WARNING"))).toMatchObject({
      action: "RAISE",
      severity: "CRITICAL",
    });
  });
});

describe("staying quiet", () => {
  it("does not repeat itself at the same level", () => {
    // THE CASE THE WHOLE MODULE EXISTS FOR. This runs after every register a
    // teacher marks; without it a struggling student is pinged every class.
    expect(decide(70, state("WARNING")).action).toBe("NONE");
    expect(decide(65, state("WARNING")).action).toBe("NONE");
    expect(decide(40, state("CRITICAL")).action).toBe("NONE");
  });

  it("does not announce an improvement that is still below the line", () => {
    // CRITICAL -> WARNING is progress, and the student knows: they are the one
    // attending. A message saying "still not enough" helps nobody.
    const decision = decide(70, state("CRITICAL"));
    expect(decision.action).toBe("NONE");
    expect(decision.reason).toContain("Improving");
  });

  it("says nothing about a student who was never below", () => {
    expect(decide(90).action).toBe("NONE");
  });
});

describe("recovery and relapse", () => {
  it("clears a live warning when the student climbs back", () => {
    expect(decide(80, state("WARNING"))).toMatchObject({ action: "CLEAR" });
    expect(decide(80, state("CRITICAL"))).toMatchObject({ action: "CLEAR" });
  });

  it("does not clear twice", () => {
    expect(decide(80, state("WARNING", new Date())).action).toBe("NONE");
  });

  it("warns AGAIN after a recovery, even at the same level", () => {
    // They fixed it once and have slipped back. That is new information, and
    // the dedupe must not swallow it.
    expect(decide(70, state("WARNING", new Date()))).toMatchObject({
      action: "RAISE",
      severity: "WARNING",
      reason: "Fell below the threshold again.",
    });
  });

  it("warns again at a LOWER level after a recovery", () => {
    expect(decide(70, state("CRITICAL", new Date()))).toMatchObject({
      action: "RAISE",
      severity: "WARNING",
    });
  });
});

describe("warningMessage", () => {
  it("states the figure, the requirement and the gap", () => {
    // "Your attendance is low" gives somebody nothing to act on (NFR-USE-007).
    const { body } = warningMessage("WARNING", 68.5, "Graphic Designing", config);
    expect(body).toContain("68.5%");
    expect(body).toContain("75%");
    expect(body).toContain("6.5 points");
  });

  it("names the subject, because a student takes several", () => {
    const { title } = warningMessage("CRITICAL", 40, "English", config);
    expect(title).toContain("English");
  });

  it("measures a critical warning against the CRITICAL threshold", () => {
    const { body } = warningMessage("CRITICAL", 50, "Graphic Designing", config);
    expect(body).toContain("60%");
    expect(body).toContain("10 points");
  });

  it("tells a critical student what to do", () => {
    expect(warningMessage("CRITICAL", 50, "X", config).body).toContain("Speak to your teacher");
  });

  it("mentions no classmate and no teacher by name", () => {
    const { title, body } = warningMessage("CRITICAL", 50, "X", config);
    for (const word of ["class average", "other students", "worst", "rank"]) {
      expect(`${title} ${body}`.toLowerCase()).not.toContain(word);
    }
  });
});
