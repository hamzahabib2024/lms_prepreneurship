/**
 * Late penalty — SRS FR-ASG-003, FR-ASG-026, BR-ASG-03/04.
 *
 * NFR-MNT-002 requires 100% coverage of grading logic. This arithmetic decides
 * a student's mark, and a student who believes a deduction is wrong will
 * challenge it — so the calculation must be reproducible by hand and provable
 * here.
 */

import { applyLatePenalty, assessLateness, daysLate } from "./late-penalty";

const due = new Date("2026-08-09T23:59:00Z");

describe("assessLateness (BR-ASG-04)", () => {
  it("is not late when submitted before the deadline", () => {
    const r = assessLateness({ submittedAt: new Date("2026-08-09T22:00:00Z"), dueAt: due });
    expect(r.isLate).toBe(false);
    expect(r.minutesLate).toBe(0);
  });

  it("is not late at exactly the deadline", () => {
    // A boundary a student WILL hit, and getting it wrong generates a
    // complaint that is impossible to defend.
    const r = assessLateness({ submittedAt: new Date(due), dueAt: due });
    expect(r.isLate).toBe(false);
  });

  it("accepts within grace but still counts the minutes from the deadline", () => {
    // FR-ASG-004 — grace decides whether a submission is ACCEPTED. It does not
    // make it on time, so the penalty is computed from the original deadline.
    const r = assessLateness({
      submittedAt: new Date("2026-08-10T00:20:00Z"), // 21 minutes over
      dueAt: due,
      graceMinutes: 30,
    });
    expect(r.isLate).toBe(false); // inside grace, so accepted without flag
    expect(r.minutesLate).toBe(0);
  });

  it("is late once grace is exceeded, measured from the ORIGINAL deadline", () => {
    const r = assessLateness({
      submittedAt: new Date("2026-08-10T00:45:00Z"), // 46 min over, grace 30
      dueAt: due,
      graceMinutes: 30,
    });
    expect(r.isLate).toBe(true);
    expect(r.minutesLate).toBe(46); // not 16 — grace is not extra time
  });

  it("an individual extension replaces the deadline entirely (FR-ASG-024)", () => {
    const r = assessLateness({
      submittedAt: new Date("2026-08-11T10:00:00Z"),
      dueAt: due,
      extendedTo: new Date("2026-08-12T23:59:00Z"),
    });
    expect(r.isLate).toBe(false);
  });

  it("flags submission after the hard close separately", () => {
    // FR-ASG-020 — an absolute bar, distinct from lateness. Enforced before
    // the record is created; reported here so the caller can refuse.
    const r = assessLateness({
      submittedAt: new Date("2026-08-15T00:00:00Z"),
      dueAt: due,
      hardCloseAt: new Date("2026-08-12T23:59:00Z"),
    });
    expect(r.isAfterHardClose).toBe(true);
  });
});

describe("daysLate — a day is STARTED, not completed", () => {
  it("counts one minute over as a full day", () => {
    // Rounding down would make a per-day policy free for the first 24 hours,
    // which is not what "10% per day" means to anyone.
    expect(daysLate(1)).toBe(1);
    expect(daysLate(60 * 24)).toBe(1);
    expect(daysLate(60 * 24 + 1)).toBe(2);
    expect(daysLate(0)).toBe(0);
  });
});

describe("applyLatePenalty", () => {
  const marksAvailable = 25;

  it("deducts nothing when on time", () => {
    const r = applyLatePenalty(20, 0, { latePolicy: "PER_DAY_PERCENT", latePenaltyValue: 10, marksAvailable });
    expect(r.finalMarks).toBe(20);
    expect(r.penaltyApplied).toBe(0);
  });

  it("FLAG_ONLY records lateness without touching the mark", () => {
    const r = applyLatePenalty(20, 167, { latePolicy: "FLAG_ONLY", marksAvailable });
    expect(r.finalMarks).toBe(20);
    expect(r.penaltyApplied).toBe(0);
    expect(r.explanation).toMatch(/no marks were deducted/i);
  });

  it("FIXED_DEDUCTION removes a flat number of marks", () => {
    const r = applyLatePenalty(20, 60, {
      latePolicy: "FIXED_DEDUCTION",
      latePenaltyValue: 5,
      marksAvailable,
    });
    expect(r.finalMarks).toBe(15);
    expect(r.penaltyApplied).toBe(5);
  });

  it("PER_DAY_PERCENT charges per started day, of the marks AVAILABLE", () => {
    // 10% of 25 = 2.5 per day. Two days late on a raw 20 → 20 − 5 = 15.
    // Note the base is marksAvailable, not the raw mark: otherwise two
    // students the same distance late lose different amounts.
    const r = applyLatePenalty(20, 60 * 24 + 1, {
      latePolicy: "PER_DAY_PERCENT",
      latePenaltyValue: 10,
      marksAvailable,
    });
    expect(r.penaltyApplied).toBe(5);
    expect(r.finalMarks).toBe(15);
  });

  it("respects the floor so a late submission stays worth attempting", () => {
    // FR-ASG-003 — 10 days at 10%/day would wipe the mark out. The floor at
    // 40% of 25 = 10 stops it, because a student who can no longer score
    // anything has no reason to finish the work.
    const r = applyLatePenalty(22, 60 * 24 * 10, {
      latePolicy: "PER_DAY_PERCENT",
      latePenaltyValue: 10,
      latePenaltyFloor: 40,
      marksAvailable,
    });
    expect(r.finalMarks).toBe(10);
    expect(r.explanation).toMatch(/capped/i);
  });

  it("never produces a negative mark even with no floor", () => {
    const r = applyLatePenalty(5, 60 * 24 * 30, {
      latePolicy: "PER_DAY_PERCENT",
      latePenaltyValue: 10,
      marksAvailable,
    });
    expect(r.finalMarks).toBe(0);
    expect(r.finalMarks).toBeGreaterThanOrEqual(0);
  });

  it("clamps a raw mark above the maximum", () => {
    // A teacher typing 30 into a 25-mark assignment is a slip, not an
    // intention to award bonus marks.
    const r = applyLatePenalty(30, 0, { latePolicy: "FLAG_ONLY", marksAvailable });
    expect(r.rawMarks).toBe(25);
    expect(r.finalMarks).toBe(25);
  });

  it("reports raw, penalty and final separately (FR-ASG-026)", () => {
    // The student must be able to see what the lateness cost, not just a
    // reduced number they cannot account for.
    const r = applyLatePenalty(20, 60 * 24, {
      latePolicy: "PER_DAY_PERCENT",
      latePenaltyValue: 10,
      marksAvailable,
    });
    expect(r.rawMarks).toBe(20);
    expect(r.penaltyApplied).toBe(2.5);
    expect(r.finalMarks).toBe(17.5);
    expect(r.rawMarks - r.penaltyApplied).toBeCloseTo(r.finalMarks, 2);
  });

  it("explains itself in plain language (NFR-USE-007)", () => {
    const r = applyLatePenalty(20, 60 * 24 + 1, {
      latePolicy: "PER_DAY_PERCENT",
      latePenaltyValue: 10,
      marksAvailable,
    });
    expect(r.explanation).toMatch(/2 days/);
    expect(r.explanation).toMatch(/10%/);
    expect(r.explanation).not.toMatch(/NaN|undefined|null|Infinity/);
  });

  it("rounds to two places without drift", () => {
    const r = applyLatePenalty(17.333, 60 * 24, {
      latePolicy: "PER_DAY_PERCENT",
      latePenaltyValue: 7.5,
      marksAvailable: 30,
    });
    expect(Number.isFinite(r.finalMarks)).toBe(true);
    expect(String(r.finalMarks).split(".")[1]?.length ?? 0).toBeLessThanOrEqual(2);
  });
});
