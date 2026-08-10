import {
  forStudent,
  missingCriteria,
  rubricTotal,
  totalAwarded,
  totalsMatch,
  validateRubric,
  validateScores,
  type Criterion,
} from "./rubric-scoring";

const criterion = (over: Partial<Criterion> & { id: string }): Criterion => ({
  name: `Criterion ${over.id}`,
  maxMarks: 10,
  displayOrder: 1,
  isInternal: false,
  ...over,
});

/** A rubric of the shape a teacher actually builds. */
const rubric: Criterion[] = [
  criterion({ id: "arg", name: "Argument", maxMarks: 10, displayOrder: 1 }),
  criterion({ id: "evi", name: "Evidence", maxMarks: 8, displayOrder: 2 }),
  criterion({ id: "wri", name: "Writing", maxMarks: 7, displayOrder: 3 }),
];

/** The same, with a criterion the student must never see (FR-ASG-014). */
const withInternal: Criterion[] = [
  ...rubric,
  criterion({ id: "mod", name: "Moderation adjustment", maxMarks: 5, displayOrder: 4, isInternal: true }),
];

describe("validateRubric", () => {
  it("accepts a well-formed rubric", () => {
    expect(validateRubric(rubric)).toEqual([]);
  });

  it("refuses an empty one", () => {
    expect(validateRubric([])).toHaveLength(1);
  });

  it("refuses a criterion worth nothing", () => {
    const problems = validateRubric([criterion({ id: "a", maxMarks: 0 })]);
    expect(problems.some((p) => p.criterionId === "a")).toBe(true);
  });

  it("refuses a negative maximum", () => {
    expect(validateRubric([criterion({ id: "a", maxMarks: -5 })])).not.toEqual([]);
  });

  it("refuses a level awarding more than the criterion is worth", () => {
    const problems = validateRubric([
      criterion({
        id: "a",
        maxMarks: 10,
        levels: [
          { label: "Excellent", marks: 10 },
          { label: "Impossible", marks: 12 },
        ],
      }),
    ]);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.message).toContain("Impossible");
  });

  it("accepts levels inside the range, including zero", () => {
    expect(
      validateRubric([
        criterion({
          id: "a",
          maxMarks: 10,
          levels: [
            { label: "Excellent", marks: 10, text: "Sustained and well evidenced." },
            { label: "Absent", marks: 0 },
          ],
        }),
      ]),
    ).toEqual([]);
  });

  it("refuses a rubric that is entirely internal", () => {
    // The student would see a mark, be told a breakdown exists, and be shown
    // none of it.
    const problems = validateRubric([
      criterion({ id: "a", isInternal: true }),
      criterion({ id: "b", isInternal: true }),
    ]);
    expect(problems.some((p) => /internal/i.test(p.message))).toBe(true);
  });

  it("allows SOME criteria to be internal", () => {
    expect(validateRubric(withInternal)).toEqual([]);
  });
});

describe("rubricTotal and totalsMatch", () => {
  it("adds the criteria up", () => {
    expect(rubricTotal(rubric)).toBe(25);
    expect(rubricTotal(withInternal)).toBe(30);
  });

  it("is zero for an empty rubric rather than NaN", () => {
    expect(rubricTotal([])).toBe(0);
  });

  it("matches an assignment worth the same", () => {
    expect(totalsMatch(rubric, 25)).toBe(true);
  });

  it("does not match one worth more", () => {
    expect(totalsMatch(rubric, 50)).toBe(false);
  });

  it("tolerates decimal drift", () => {
    const thirds = [
      criterion({ id: "a", maxMarks: 3.33 }),
      criterion({ id: "b", maxMarks: 3.33 }),
      criterion({ id: "c", maxMarks: 3.34 }),
    ];
    expect(totalsMatch(thirds, 10)).toBe(true);
  });
});

describe("validateScores", () => {
  it("accepts a complete, in-range marking", () => {
    expect(validateScores(rubric, { arg: 8, evi: 6, wri: 5 })).toEqual([]);
  });

  it("accepts a partial marking — a teacher mid-way through", () => {
    expect(validateScores(rubric, { arg: 8 })).toEqual([]);
  });

  it("accepts zero", () => {
    expect(validateScores(rubric, { arg: 0 })).toEqual([]);
  });

  it("refuses a score above the criterion maximum", () => {
    // The defect this was written for: the endpoint stored whatever it was
    // given, so a student could be shown "12 out of 10".
    const problems = validateScores(rubric, { arg: 12 });
    expect(problems).toHaveLength(1);
    expect(problems[0]?.message).toContain("at most 10");
  });

  it("refuses a negative score", () => {
    expect(validateScores(rubric, { arg: -1 })).toHaveLength(1);
  });

  it("refuses a criterion belonging to another rubric", () => {
    // A stale browser tab marking against a rubric that has since been edited.
    const problems = validateScores(rubric, { somethingElse: 5 });
    expect(problems).toHaveLength(1);
    expect(problems[0]?.criterionId).toBe("somethingElse");
  });

  it("refuses a non-number", () => {
    expect(validateScores(rubric, { arg: "8" as unknown as number })).toHaveLength(1);
  });

  it("refuses NaN and Infinity", () => {
    expect(validateScores(rubric, { arg: Number.NaN })).toHaveLength(1);
    expect(validateScores(rubric, { evi: Number.POSITIVE_INFINITY })).toHaveLength(1);
  });

  it("reports every problem at once, not just the first", () => {
    // A marker fixing one error at a time, three round trips, is a worse
    // experience than being told all three.
    expect(validateScores(rubric, { arg: 12, evi: -1, nope: 3 })).toHaveLength(3);
  });

  it("allows marking an internal criterion", () => {
    expect(validateScores(withInternal, { mod: 4 })).toEqual([]);
  });
});

describe("missingCriteria", () => {
  it("lists what has not been marked", () => {
    expect(missingCriteria(rubric, { arg: 8 }).map((c) => c.id)).toEqual(["evi", "wri"]);
  });

  it("is empty when marking is complete", () => {
    expect(missingCriteria(rubric, { arg: 8, evi: 6, wri: 5 })).toEqual([]);
  });

  it("counts a zero as marked", () => {
    // Awarding zero is a judgement and must not read as an omission.
    expect(missingCriteria(rubric, { arg: 0, evi: 0, wri: 0 })).toEqual([]);
  });

  it("includes internal criteria — they must be marked too", () => {
    expect(missingCriteria(withInternal, { arg: 1, evi: 1, wri: 1 }).map((c) => c.id)).toEqual(["mod"]);
  });
});

describe("totalAwarded", () => {
  it("adds the awarded marks", () => {
    expect(totalAwarded(rubric, { arg: 8, evi: 6, wri: 5 })).toBe(19);
  });

  it("counts internal criteria — they earn marks", () => {
    expect(totalAwarded(withInternal, { arg: 8, evi: 6, wri: 5, mod: 3 })).toBe(22);
  });

  it("ignores an id the rubric no longer has rather than throwing", () => {
    // A historic mark must stay computable after the rubric is tidied up.
    expect(totalAwarded(rubric, { arg: 8, deleted: 99 })).toBe(8);
  });

  it("rounds to two places", () => {
    expect(totalAwarded(rubric, { arg: 0.1, evi: 0.2 })).toBe(0.3);
  });

  it("is zero for no scores", () => {
    expect(totalAwarded(rubric, {})).toBe(0);
  });
});

describe("forStudent — FR-ASG-014", () => {
  const scores = { arg: 8, evi: 6, wri: 5, mod: 3 };

  it("drops the internal criterion completely", () => {
    const view = forStudent(withInternal, scores);
    expect(view.rows.map((r) => r.name)).toEqual(["Argument", "Evidence", "Writing"]);
  });

  it("does not leak the internal criterion's NAME", () => {
    // The heading discloses the moderation as surely as the number does.
    const serialised = JSON.stringify(forStudent(withInternal, scores));
    expect(serialised).not.toContain("Moderation");
    expect(serialised).not.toContain("mod");
  });

  it("does not leak the internal criterion's MARKS in the visible total", () => {
    const view = forStudent(withInternal, scores);
    expect(view.visibleTotal).toBe(19);
    expect(view.visibleMaxMarks).toBe(25);
  });

  it("says the account is partial when internal marks were awarded", () => {
    // So the screen can explain why 19 out of 25 sits beside a mark of 22.
    expect(forStudent(withInternal, scores).isPartialAccount).toBe(true);
  });

  it("is not partial when no internal criterion was scored", () => {
    expect(forStudent(withInternal, { arg: 8, evi: 6, wri: 5 }).isPartialAccount).toBe(false);
  });

  it("is not partial for a rubric with no internal criteria at all", () => {
    expect(forStudent(rubric, { arg: 8 }).isPartialAccount).toBe(false);
  });

  it("orders by displayOrder, not by insertion", () => {
    const shuffled = [
      criterion({ id: "c", name: "Third", displayOrder: 3 }),
      criterion({ id: "a", name: "First", displayOrder: 1 }),
      criterion({ id: "b", name: "Second", displayOrder: 2 }),
    ];
    const view = forStudent(shuffled, { a: 1, b: 2, c: 3 });
    expect(view.rows.map((r) => r.name)).toEqual(["First", "Second", "Third"]);
  });

  it("omits an unmarked criterion rather than showing it as zero", () => {
    // Zero is a judgement; silence is the absence of one.
    const view = forStudent(rubric, { arg: 8 });
    expect(view.rows).toHaveLength(1);
    expect(view.visibleMaxMarks).toBe(10);
  });

  it("shows a criterion awarded zero", () => {
    const view = forStudent(rubric, { arg: 0 });
    expect(view.rows).toHaveLength(1);
    expect(view.rows[0]?.awarded).toBe(0);
  });

  it("returns an empty account for an unmarked submission", () => {
    const view = forStudent(rubric, {});
    expect(view.rows).toEqual([]);
    expect(view.visibleTotal).toBe(0);
    expect(view.isPartialAccount).toBe(false);
  });

  it("carries the criterion description, which is the teaching part", () => {
    const view = forStudent(
      [criterion({ id: "a", description: "Is the claim supported throughout?" })],
      { a: 7 },
    );
    expect(view.rows[0]?.description).toBe("Is the claim supported throughout?");
  });

  it("never emits levels, which can carry marker guidance", () => {
    const withLevels = [
      criterion({ id: "a", levels: [{ label: "Weak", marks: 2, text: "Refer to moderation." }] }),
    ];
    expect(JSON.stringify(forStudent(withLevels, { a: 2 }))).not.toContain("moderation");
  });

  it("survives a score for a criterion that no longer exists", () => {
    expect(() => forStudent(rubric, { deleted: 5 })).not.toThrow();
    expect(forStudent(rubric, { deleted: 5 }).rows).toEqual([]);
  });
});
