import {
  validateQuestion,
  validateQuizForPublication,
  type DraftQuestion,
} from "./question-validation";

/**
 * Question validation — FR-QIZ-004..012, FR-QIZ-020.
 *
 * The failure worth preventing is silent: a question nobody can answer
 * correctly looks fine until a cohort has sat the paper and the marks come back
 * wrong. By then it is a re-mark or a re-sit.
 */

const codes = (q: DraftQuestion) => validateQuestion(q).map((p) => p.code);

const mcq = (over: Partial<DraftQuestion> = {}): DraftQuestion => ({
  questionType: "MCQ_SINGLE",
  stem: "Which colour model is used for print?",
  defaultMarks: 2,
  options: [
    { optionText: "CMYK", isCorrect: true },
    { optionText: "RGB", isCorrect: false },
  ],
  ...over,
});

describe("a question nobody can answer", () => {
  it("rejects a choice question with no correct option", () => {
    // THE CASE THIS MODULE EXISTS FOR.
    const problems = validateQuestion(
      mcq({
        options: [
          { optionText: "CMYK", isCorrect: false },
          { optionText: "RGB", isCorrect: false },
        ],
      }),
    );
    expect(problems.map((p) => p.code)).toContain("NO_CORRECT_ANSWER");
    expect(problems.find((p) => p.code === "NO_CORRECT_ANSWER")?.message).toContain(
      "no student can answer",
    );
  });

  it("rejects a multi-answer question where everything is correct", () => {
    // Every answer scores full marks, so the question measures nothing.
    expect(
      codes(
        mcq({
          questionType: "MCQ_MULTI",
          options: [
            { optionText: "A", isCorrect: true },
            { optionText: "B", isCorrect: true },
          ],
        }),
      ),
    ).toContain("ALL_CORRECT");
  });

  it("accepts a multi-answer question with some correct", () => {
    expect(
      codes(
        mcq({
          questionType: "MCQ_MULTI",
          options: [
            { optionText: "A", isCorrect: true },
            { optionText: "B", isCorrect: true },
            { optionText: "C", isCorrect: false },
          ],
        }),
      ),
    ).toEqual([]);
  });
});

describe("single-answer questions", () => {
  it("accepts a well-formed one", () => {
    expect(codes(mcq())).toEqual([]);
  });

  it("rejects two correct options", () => {
    expect(
      codes(
        mcq({
          options: [
            { optionText: "A", isCorrect: true },
            { optionText: "B", isCorrect: true },
          ],
        }),
      ),
    ).toContain("TOO_MANY_CORRECT");
  });

  it("rejects a single option, which is not a choice", () => {
    expect(codes(mcq({ options: [{ optionText: "Only", isCorrect: true }] }))).toContain(
      "INVALID_COUNT",
    );
  });

  it("rejects a blank option", () => {
    expect(
      codes(
        mcq({
          options: [
            { optionText: "CMYK", isCorrect: true },
            { optionText: "   ", isCorrect: false },
          ],
        }),
      ),
    ).toContain("EMPTY_OPTION");
  });

  it("rejects duplicate options", () => {
    // Two identical options mean one is wrong while reading identically to the
    // right one.
    expect(
      codes(
        mcq({
          options: [
            { optionText: "CMYK", isCorrect: true },
            { optionText: "cmyk", isCorrect: false },
          ],
        }),
      ),
    ).toContain("DUPLICATE_OPTION");
  });
});

describe("true/false", () => {
  const tf = (over: Partial<DraftQuestion> = {}) =>
    mcq({
      questionType: "TRUE_FALSE",
      options: [
        { optionText: "True", isCorrect: true },
        { optionText: "False", isCorrect: false },
      ],
      ...over,
    });

  it("accepts exactly two options with one correct", () => {
    expect(codes(tf())).toEqual([]);
  });

  it("rejects three options", () => {
    expect(
      codes(
        tf({
          options: [
            { optionText: "True", isCorrect: true },
            { optionText: "False", isCorrect: false },
            { optionText: "Maybe", isCorrect: false },
          ],
        }),
      ),
    ).toContain("INVALID_COUNT");
  });

  it("rejects both being correct", () => {
    expect(
      codes(
        tf({
          options: [
            { optionText: "True", isCorrect: true },
            { optionText: "False", isCorrect: true },
          ],
        }),
      ),
    ).toContain("TOO_MANY_CORRECT");
  });
});

describe("typed answers", () => {
  const typed = (over: Partial<DraftQuestion> = {}): DraftQuestion => ({
    questionType: "SHORT_ANSWER",
    stem: "Name the colour model used for print.",
    defaultMarks: 2,
    acceptedAnswers: ["CMYK"],
    ...over,
  });

  it("accepts a short answer with accepted answers", () => {
    expect(codes(typed())).toEqual([]);
  });

  it("rejects one with none", () => {
    expect(codes(typed({ acceptedAnswers: [] }))).toContain("REQUIRED");
    expect(codes(typed({ acceptedAnswers: undefined }))).toContain("REQUIRED");
  });

  it("rejects options on a typed question", () => {
    expect(
      codes(typed({ options: [{ optionText: "CMYK", isCorrect: true }] })),
    ).toContain("NOT_APPLICABLE");
  });

  it("requires a number for a numeric question", () => {
    expect(
      codes(typed({ questionType: "NUMERIC", acceptedAnswers: ["about five"] })),
    ).toContain("INVALID");
    expect(codes(typed({ questionType: "NUMERIC", acceptedAnswers: [5] }))).toEqual([]);
  });

  it("rejects a negative tolerance", () => {
    expect(
      codes(typed({ questionType: "NUMERIC", acceptedAnswers: [5], tolerance: -1 })),
    ).toContain("INVALID");
  });
});

describe("essays", () => {
  const essay = (over: Partial<DraftQuestion> = {}): DraftQuestion => ({
    questionType: "ESSAY",
    stem: "Explain why you would choose a serif for a printed book.",
    defaultMarks: 4,
    ...over,
  });

  it("needs neither options nor accepted answers", () => {
    expect(codes(essay())).toEqual([]);
  });

  it("rejects accepted answers", () => {
    // Marking an essay against a model answer would fail every student who
    // wrote a good answer in different words.
    expect(codes(essay({ acceptedAnswers: ["Because serifs guide the eye"] }))).toContain(
      "NOT_APPLICABLE",
    );
  });

  it("rejects options", () => {
    expect(codes(essay({ options: [{ optionText: "A", isCorrect: true }] }))).toContain(
      "NOT_APPLICABLE",
    );
  });
});

describe("matching", () => {
  const matching = (answers: unknown): DraftQuestion => ({
    questionType: "MATCHING",
    stem: "Match each term to its definition.",
    defaultMarks: 4,
    acceptedAnswers: answers,
  });

  it("accepts pairs", () => {
    expect(codes(matching({ serif: "has strokes", "sans-serif": "has none" }))).toEqual([]);
  });

  it("rejects fewer than two pairs", () => {
    expect(codes(matching({ serif: "has strokes" }))).toContain("INVALID_COUNT");
  });

  it("rejects a pair with a blank side", () => {
    expect(codes(matching({ serif: "has strokes", "sans-serif": "" }))).toContain("INVALID");
  });
});

describe("the basics, whatever the type", () => {
  it("requires a stem", () => {
    expect(codes(mcq({ stem: "  " }))).toContain("REQUIRED");
  });

  it("requires marks above zero", () => {
    // A zero-mark question still takes a student's time in a timed quiz.
    expect(codes(mcq({ defaultMarks: 0 }))).toContain("INVALID");
    expect(codes(mcq({ defaultMarks: -1 }))).toContain("INVALID");
  });

  it("reports EVERY problem at once", () => {
    // A teacher fixing a question one complaint at a time gives up before it is
    // right (NFR-ERR-005).
    const problems = validateQuestion({
      questionType: "MCQ_SINGLE",
      stem: "",
      defaultMarks: 0,
      options: [{ optionText: "Only", isCorrect: false }],
    });
    expect(problems.length).toBeGreaterThanOrEqual(4);
  });
});

describe("publishing a quiz", () => {
  const quiz = (over: Partial<Parameters<typeof validateQuizForPublication>[0]> = {}) => ({
    questionCount: 4,
    totalMarks: 10,
    sumOfQuestionMarks: 10,
    opensAt: new Date("2026-09-01T09:00:00Z"),
    closesAt: new Date("2026-09-10T23:00:00Z"),
    timeLimitMinutes: 10,
    passingMarks: 5,
    ...over,
  });

  it("accepts a coherent quiz", () => {
    expect(validateQuizForPublication(quiz())).toEqual([]);
  });

  it("refuses one with no questions", () => {
    expect(validateQuizForPublication(quiz({ questionCount: 0 })).map((p) => p.code)).toContain(
      "EMPTY",
    );
  });

  it("refuses when the questions do not add up to the total", () => {
    // A mismatch shows up as marks over 100% or a ceiling nobody can reach.
    const problems = validateQuizForPublication(quiz({ sumOfQuestionMarks: 12 }));
    expect(problems.map((p) => p.code)).toContain("MISMATCH");
    expect(problems[0]?.message).toContain("12");
    expect(problems[0]?.message).toContain("10");
  });

  it("refuses a pass mark nobody can reach", () => {
    expect(
      validateQuizForPublication(quiz({ passingMarks: 20 })).map((p) => p.code),
    ).toContain("UNREACHABLE");
  });

  it("refuses a window that closes before it opens", () => {
    expect(
      validateQuizForPublication(
        quiz({ closesAt: new Date("2026-08-01T00:00:00Z") }),
      ).map((p) => p.code),
    ).toContain("INVALID_RANGE");
  });

  it("refuses a time limit of zero", () => {
    expect(
      validateQuizForPublication(quiz({ timeLimitMinutes: 0 })).map((p) => p.code),
    ).toContain("INVALID");
  });

  it("allows no time limit at all", () => {
    expect(validateQuizForPublication(quiz({ timeLimitMinutes: null }))).toEqual([]);
  });

  it("does not complain about the total when there are no questions", () => {
    // The EMPTY problem already says what is wrong; a mismatch alongside it
    // would be noise.
    const codes = validateQuizForPublication(
      quiz({ questionCount: 0, sumOfQuestionMarks: 0, totalMarks: 10 }),
    ).map((p) => p.code);
    expect(codes).toContain("EMPTY");
    expect(codes).not.toContain("MISMATCH");
  });
});
