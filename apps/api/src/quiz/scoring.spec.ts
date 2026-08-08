/**
 * Quiz scoring — SRS §5.10.5, BR-QIZ-06, FR-QIZ-017/018/032/033.
 *
 * NFR-MNT-002 requires 100% coverage of grading logic. The rule under most
 * scrutiny is BR-QIZ-06: negative marking on INCORRECT answers only, never on
 * unanswered ones. Getting that wrong punishes a student for running out of
 * time, which surfaces as a complaint rather than a bug report.
 */

import {
  resolveAttemptScore,
  scoreAnswer,
  scoreAttempt,
  type QuestionKey,
} from "./scoring";

const mcq = (over: Partial<QuestionKey> = {}): QuestionKey => ({
  questionId: "q1",
  questionType: "MCQ_SINGLE",
  marks: 2,
  correctOptionIds: ["a2"],
  ...over,
});

describe("BR-QIZ-06 — negative marking", () => {
  const negative = { mode: "FIXED" as const, value: 0.5 };

  it("penalises an INCORRECT answer", () => {
    const r = scoreAnswer(mcq(), { selectedOptionIds: ["a1"] }, negative);
    expect(r.isCorrect).toBe(false);
    expect(r.marksAwarded).toBe(0);
    expect(r.penaltyApplied).toBe(0.5);
  });

  it("does NOT penalise an UNANSWERED question", () => {
    // The rule that matters most. Penalising this punishes a student for
    // running out of time rather than for being wrong.
    for (const blank of [null, undefined, { selectedOptionIds: [] }]) {
      const r = scoreAnswer(mcq(), blank, negative);
      expect(r.answered).toBe(false);
      expect(r.penaltyApplied).toBe(0);
      expect(r.marksAwarded).toBe(0);
      expect(r.detail).toMatch(/no penalty/i);
    }
  });

  it("does not penalise blank or whitespace-only text", () => {
    const key: QuestionKey = {
      questionId: "q",
      questionType: "SHORT_ANSWER",
      marks: 2,
      acceptedAnswers: ["Paris"],
    };
    expect(scoreAnswer(key, { text: "   " }, negative).penaltyApplied).toBe(0);
  });

  it("never penalises a correct answer", () => {
    const r = scoreAnswer(mcq(), { selectedOptionIds: ["a2"] }, negative);
    expect(r.marksAwarded).toBe(2);
    expect(r.penaltyApplied).toBe(0);
  });

  it("PROPORTIONAL deducts a percentage of the question's marks", () => {
    const r = scoreAnswer(mcq({ marks: 4 }), { selectedOptionIds: ["a1"] }, {
      mode: "PROPORTIONAL",
      value: 25,
    });
    expect(r.penaltyApplied).toBe(1); // 25% of 4
  });

  it("applies nothing when the mode is NONE", () => {
    const r = scoreAnswer(mcq(), { selectedOptionIds: ["a1"] }, { mode: "NONE" });
    expect(r.penaltyApplied).toBe(0);
  });

  it("floors the ATTEMPT total at zero (FR-QIZ-017)", () => {
    // A student may lose marks on a question, but an attempt should not end
    // below nothing — a negative total is meaningless to report.
    const keys = [mcq({ questionId: "q1" }), mcq({ questionId: "q2" })];
    const r = scoreAttempt(
      keys,
      { q1: { selectedOptionIds: ["wrong"] }, q2: { selectedOptionIds: ["wrong"] } },
      { mode: "FIXED", value: 5 },
    );
    expect(r.autoScore).toBe(0);
  });
});

describe("MCQ_SINGLE and TRUE_FALSE", () => {
  it("awards full marks for the correct option", () => {
    expect(scoreAnswer(mcq(), { selectedOptionIds: ["a2"] }).marksAwarded).toBe(2);
  });

  it("treats multi-selection on a single-answer question as incorrect", () => {
    // Selecting everything must not become a strategy.
    const r = scoreAnswer(mcq(), { selectedOptionIds: ["a1", "a2"] });
    expect(r.isCorrect).toBe(false);
    expect(r.marksAwarded).toBe(0);
  });
});

describe("MCQ_MULTI", () => {
  const key = mcq({
    questionType: "MCQ_MULTI",
    marks: 4,
    correctOptionIds: ["a1", "a3"],
  });

  it("awards full marks for exactly the correct set", () => {
    expect(scoreAnswer(key, { selectedOptionIds: ["a1", "a3"] }).marksAwarded).toBe(4);
  });

  it("is all-or-nothing by default", () => {
    expect(scoreAnswer(key, { selectedOptionIds: ["a1"] }).marksAwarded).toBe(0);
  });

  it("grants partial credit when configured", () => {
    const r = scoreAnswer(key, { selectedOptionIds: ["a1"] }, { mode: "NONE" }, {
      allowPartialCredit: true,
    });
    expect(r.marksAwarded).toBe(2); // 1 of 2 correct
    expect(r.isCorrect).toBe(false);
  });

  it("subtracts wrong choices, so selecting everything scores nothing", () => {
    // The classic gaming strategy. 2 hits − 2 wrong = 0.
    const r = scoreAnswer(
      key,
      { selectedOptionIds: ["a1", "a2", "a3", "a4"] },
      { mode: "NONE" },
      { allowPartialCredit: true },
    );
    expect(r.marksAwarded).toBe(0);
  });
});

describe("SHORT_ANSWER and FILL_BLANK", () => {
  const key: QuestionKey = {
    questionId: "q",
    questionType: "SHORT_ANSWER",
    marks: 2,
    acceptedAnswers: ["Paris", "paris city"],
  };

  it("matches case-insensitively by default", () => {
    expect(scoreAnswer(key, { text: "PARIS" }).marksAwarded).toBe(2);
  });

  it("normalises surrounding and repeated whitespace", () => {
    // A student typing "  Paris  " has answered correctly.
    expect(scoreAnswer(key, { text: "  Paris  " }).marksAwarded).toBe(2);
    expect(scoreAnswer(key, { text: "paris   city" }).marksAwarded).toBe(2);
  });

  it("respects case sensitivity when the teacher requires it", () => {
    const cs = { ...key, caseSensitive: true };
    expect(scoreAnswer(cs, { text: "paris" }).marksAwarded).toBe(0);
    expect(scoreAnswer(cs, { text: "Paris" }).marksAwarded).toBe(2);
  });

  it("falls back to MANUAL grading when no key was supplied", () => {
    // FR-QIZ-033 — better to ask a teacher than to mark a reasonable answer
    // wrong because nobody wrote an answer key.
    const noKey: QuestionKey = { questionId: "q", questionType: "SHORT_ANSWER", marks: 2 };
    const r = scoreAnswer(noKey, { text: "Paris" });
    expect(r.requiresManualGrading).toBe(true);
    expect(r.isCorrect).toBeNull();
  });
});

describe("NUMERIC", () => {
  const key: QuestionKey = {
    questionId: "q",
    questionType: "NUMERIC",
    marks: 3,
    numericAnswer: 9.81,
    tolerance: 0.05,
  };

  it("accepts a value inside the tolerance", () => {
    expect(scoreAnswer(key, { value: 9.8 }).marksAwarded).toBe(3);
    expect(scoreAnswer(key, { value: 9.86 }).marksAwarded).toBe(3);
  });

  it("rejects a value outside it", () => {
    expect(scoreAnswer(key, { value: 9.7 }).marksAwarded).toBe(0);
  });

  it("accepts an exact match with zero tolerance", () => {
    const exact = { ...key, tolerance: 0 };
    expect(scoreAnswer(exact, { value: 9.81 }).marksAwarded).toBe(3);
    expect(scoreAnswer(exact, { value: 9.811 }).marksAwarded).toBe(0);
  });

  it("treats zero as answered, not blank", () => {
    // A real trap: falsy checks make a legitimate answer of 0 look unanswered.
    const zero: QuestionKey = {
      questionId: "q",
      questionType: "NUMERIC",
      marks: 1,
      numericAnswer: 0,
      tolerance: 0,
    };
    const r = scoreAnswer(zero, { value: 0 });
    expect(r.answered).toBe(true);
    expect(r.marksAwarded).toBe(1);
  });
});

describe("MATCHING", () => {
  const key: QuestionKey = {
    questionId: "q",
    questionType: "MATCHING",
    marks: 4,
    matchPairs: { o1: "m1", o2: "m2", o3: "m3", o4: "m4" },
  };

  it("awards full marks for every pair correct", () => {
    const r = scoreAnswer(key, { pairs: { o1: "m1", o2: "m2", o3: "m3", o4: "m4" } });
    expect(r.marksAwarded).toBe(4);
  });

  it("grants proportional credit when configured", () => {
    const r = scoreAnswer(
      key,
      { pairs: { o1: "m1", o2: "m2", o3: "wrong", o4: "wrong" } },
      { mode: "NONE" },
      { allowPartialCredit: true },
    );
    expect(r.marksAwarded).toBe(2); // 2 of 4
  });
});

describe("ESSAY and manual grading (FR-QIZ-033)", () => {
  const key: QuestionKey = { questionId: "q", questionType: "ESSAY", marks: 10 };

  it("is never auto-graded", () => {
    const r = scoreAnswer(key, { text: "A long considered answer…" });
    expect(r.requiresManualGrading).toBe(true);
    expect(r.isCorrect).toBeNull();
    expect(r.marksAwarded).toBe(0);
  });

  it("reports pending marks SEPARATELY rather than as zero", () => {
    // FR-QIZ-033 — the student is told grading is in progress. Folding the
    // essay in as zero would show a score that reads as a failure.
    const keys: QuestionKey[] = [mcq({ questionId: "q1", marks: 2 }), { ...key, questionId: "q2" }];
    const r = scoreAttempt(keys, {
      q1: { selectedOptionIds: ["a2"] },
      q2: { text: "An essay" },
    });

    expect(r.autoScore).toBe(2);
    expect(r.pendingManualMarks).toBe(10);
    expect(r.maxScore).toBe(12);
    expect(r.requiresManualGrading).toBe(true);
  });
});

describe("resolveAttemptScore (FR-QIZ-018)", () => {
  const scores = [6, 9, 7];

  it("applies each policy", () => {
    expect(resolveAttemptScore(scores, "HIGHEST")).toBe(9);
    expect(resolveAttemptScore(scores, "FIRST")).toBe(6);
    expect(resolveAttemptScore(scores, "LATEST")).toBe(7);
    expect(resolveAttemptScore(scores, "AVERAGE")).toBeCloseTo(7.33, 2);
  });

  it("returns null when there are no attempts", () => {
    // Distinct from zero: no attempt is not a failed attempt.
    expect(resolveAttemptScore([], "HIGHEST")).toBeNull();
  });
});
