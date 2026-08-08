/**
 * Progress computation — SRS §5.14, BR-PRG-01..05.
 *
 * NFR-MNT-002 requires 100% coverage of progress logic. This number drives
 * certification and appears on every dashboard, so the redistribution rule in
 * particular must be provable rather than assumed.
 */

import {
  DEFAULT_WEIGHTS,
  computeProgress,
  evaluateCompletion,
  validateWeights,
  type ComponentInputs,
} from "./progress-formula";

const inputs = (over: Partial<ComponentInputs> = {}): ComponentInputs => ({
  video: { completed: 0, total: 0 },
  assignment: { completed: 0, total: 0 },
  quiz: { completed: 0, total: 0 },
  attendance: { completed: 0, total: 0 },
  ...over,
});

describe("validateWeights (BR-PRG-02)", () => {
  it("accepts the institute defaults", () => {
    expect(() => validateWeights(DEFAULT_WEIGHTS)).not.toThrow();
  });

  it("rejects weights that do not sum to 1.00", () => {
    // Silently normalising would hide the mistake while producing figures
    // nobody can reconcile against the configured policy.
    expect(() =>
      validateWeights({ video: 0.3, assignment: 0.3, quiz: 0.25, attendance: 0.05 }),
    ).toThrow(/sum to 1\.00/);
  });

  it("rejects a negative or out-of-range weight", () => {
    expect(() =>
      validateWeights({ video: -0.1, assignment: 0.4, quiz: 0.35, attendance: 0.35 }),
    ).toThrow();
  });
});

describe("computeProgress — the weighted formula (Figure 5-3)", () => {
  it("computes the documented example", () => {
    // 75×0.30 + 66.7×0.30 + 60×0.25 + 71.4×0.15 ≈ 68.3
    const r = computeProgress(
      inputs({
        video: { completed: 15, total: 20 },
        assignment: { completed: 4, total: 6 },
        quiz: { completed: 3, total: 5 },
        attendance: { completed: 20, total: 28 },
      }),
    );
    expect(r.overallPercent).toBeCloseTo(68.3, 0);
    expect(r.weightsRedistributed).toBe(false);
  });

  it("reaches exactly 100 when everything is complete", () => {
    const r = computeProgress(
      inputs({
        video: { completed: 20, total: 20 },
        assignment: { completed: 6, total: 6 },
        quiz: { completed: 5, total: 5 },
        attendance: { completed: 28, total: 28 },
      }),
    );
    expect(r.overallPercent).toBe(100);
  });

  it("returns 0, not NaN, before anything is published", () => {
    // A brand-new subject. NaN would render as "NaN%" on the dashboard, and
    // 100% would be a lie the student would happily accept.
    const r = computeProgress(inputs());
    expect(r.overallPercent).toBe(0);
    expect(Number.isNaN(r.overallPercent)).toBe(false);
  });
});

describe("BR-PRG-03 — redistribution of an inapplicable component", () => {
  it("does NOT cap a subject that has no quizzes at 75%", () => {
    // The rule that matters most. Treating an absent component as zero would
    // tell every student in a quiz-free subject that they had failed to do
    // something which does not exist.
    const r = computeProgress(
      inputs({
        video: { completed: 20, total: 20 },
        assignment: { completed: 6, total: 6 },
        quiz: { completed: 0, total: 0 }, // none published
        attendance: { completed: 28, total: 28 },
      }),
    );
    expect(r.overallPercent).toBe(100);
    expect(r.weightsRedistributed).toBe(true);
    expect(r.components.find((c) => c.key === "quiz")?.included).toBe(false);
  });

  it("redistributes PROPORTIONALLY, preserving relative importance", () => {
    // Dropping quiz (0.25) leaves 0.75 to share. Video 0.30/0.75 = 0.40,
    // assignment 0.40, attendance 0.20 — the Institute's relative ordering
    // survives. An equal split would silently re-weight the policy.
    const r = computeProgress(
      inputs({
        video: { completed: 1, total: 2 },
        assignment: { completed: 1, total: 2 },
        quiz: { completed: 0, total: 0 },
        attendance: { completed: 1, total: 2 },
      }),
    );
    expect(r.weightsApplied.video).toBeCloseTo(0.4, 3);
    expect(r.weightsApplied.assignment).toBeCloseTo(0.4, 3);
    expect(r.weightsApplied.attendance).toBeCloseTo(0.2, 3);
    expect(r.weightsApplied.quiz).toBe(0);
  });

  it("effective weights still sum to 1.00 after redistribution", () => {
    const r = computeProgress(
      inputs({
        video: { completed: 3, total: 10 },
        attendance: { completed: 5, total: 10 },
      }),
    );
    const sum = Object.values(r.weightsApplied).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 4);
  });

  it("works when only ONE component applies", () => {
    const r = computeProgress(inputs({ attendance: { completed: 7, total: 10 } }));
    expect(r.overallPercent).toBe(70);
    expect(r.weightsApplied.attendance).toBeCloseTo(1, 4);
  });

  it("persists the weights actually used, so a past figure stays reproducible", () => {
    // DB-011 / BR-PRG-04. Without this, changing the institute weights makes
    // every historical progress figure unexplainable.
    const r = computeProgress(inputs({ video: { completed: 1, total: 4 } }));
    expect(r.weightsApplied).toBeDefined();
    expect(r.weightsApplied.video).toBeCloseTo(1, 4);
  });
});

describe("defensive behaviour", () => {
  it("clamps a component above 100% rather than inflating overall progress", () => {
    // A data error giving completed > total must never push a student over
    // the line and hand out an unearned certificate.
    const r = computeProgress(inputs({ video: { completed: 25, total: 20 } }));
    expect(r.components.find((c) => c.key === "video")?.value).toBe(100);
    expect(r.overallPercent).toBeLessThanOrEqual(100);
  });

  it("honours custom per-subject weights (CFG-PRG-01..04)", () => {
    const r = computeProgress(
      inputs({
        video: { completed: 1, total: 1 },
        assignment: { completed: 0, total: 1 },
      }),
      { video: 0.8, assignment: 0.2, quiz: 0, attendance: 0 },
    );
    expect(r.overallPercent).toBe(80);
  });

  it("gives every component a human-readable detail line", () => {
    const r = computeProgress(inputs({ video: { completed: 3, total: 8 } }));
    expect(r.components.find((c) => c.key === "video")?.detail).toBe("3 of 8 complete");
    expect(r.components.find((c) => c.key === "quiz")?.detail).toMatch(/not applicable/i);
  });
});

describe("evaluateCompletion (FR-PRG-008/010)", () => {
  const full = computeProgress(
    inputs({
      video: { completed: 20, total: 20 },
      assignment: { completed: 6, total: 6 },
      quiz: { completed: 5, total: 5 },
      attendance: { completed: 28, total: 28 },
    }),
  );

  it("is met when every criterion is satisfied", () => {
    const r = evaluateCompletion(
      full,
      { minProgressPercent: 80, minAttendancePercent: 75, minAverageGradePercent: 50 },
      { attendancePercent: 92, averageGradePercent: 71 },
    );
    expect(r.met).toBe(true);
    expect(r.outstanding).toHaveLength(0);
  });

  it("states the GAP in points, not merely that it failed", () => {
    // "Not yet eligible" is useless. A student needs to know how far off they
    // are and what to do about it.
    const partial = computeProgress(
      inputs({
        video: { completed: 15, total: 20 },
        assignment: { completed: 4, total: 6 },
        quiz: { completed: 3, total: 5 },
        attendance: { completed: 20, total: 28 },
      }),
    );
    const r = evaluateCompletion(
      partial,
      { minProgressPercent: 80, minAttendancePercent: 75 },
      { attendancePercent: 71.4, averageGradePercent: 65 },
    );

    expect(r.met).toBe(false);
    expect(r.outstanding.join(" ")).toMatch(/points below/);
    // And the specific items, because "do more" is not actionable.
    expect(r.outstanding.join(" ")).toMatch(/5 lectures not yet watched/);
    expect(r.outstanding.join(" ")).toMatch(/2 assignments not yet submitted/);
    expect(r.outstanding.join(" ")).toMatch(/attendance is 71\.4%/i);
  });

  it("distinguishes 'no data yet' from 'below threshold'", () => {
    // A student with no graded work has not failed; they simply have nothing
    // marked yet, and saying otherwise is both wrong and discouraging.
    const r = evaluateCompletion(
      full,
      { minAverageGradePercent: 50 },
      { attendancePercent: null, averageGradePercent: null },
    );
    expect(r.outstanding.join(" ")).toMatch(/no graded work yet/i);
    expect(r.outstanding.join(" ")).not.toMatch(/below/i);
  });

  it("uses singular wording for a single outstanding item", () => {
    const nearly = computeProgress(inputs({ assignment: { completed: 5, total: 6 } }));
    const r = evaluateCompletion(nearly, { minProgressPercent: 100 }, {
      attendancePercent: 100,
      averageGradePercent: 100,
    });
    expect(r.outstanding.join(" ")).toMatch(/1 assignment not yet submitted/);
    expect(r.outstanding.join(" ")).not.toMatch(/1 assignments/);
  });
});
