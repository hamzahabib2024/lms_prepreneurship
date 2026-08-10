/**
 * What makes a question answerable — SRS §5.10, FR-QIZ-004..012.
 *
 * A pure module, because the failure this prevents is silent and expensive: a
 * question with no correct option is one no student can get right, and nobody
 * finds out until a cohort has sat the paper and the marks come back wrong.
 * By then the quiz has been taken and the damage is a re-mark or a re-sit.
 *
 * Eight question types, each with its own idea of what "complete" means. The
 * rules are here rather than in the service so they can be exercised without a
 * database, and so the teacher gets ALL the problems with their question at
 * once rather than one per save (NFR-ERR-005).
 */

export type QuestionType =
  | "MCQ_SINGLE"
  | "MCQ_MULTI"
  | "TRUE_FALSE"
  | "SHORT_ANSWER"
  | "ESSAY"
  | "NUMERIC"
  | "MATCHING"
  | "FILL_BLANK";

export interface DraftOption {
  optionText: string;
  isCorrect: boolean;
}

export interface DraftQuestion {
  questionType: QuestionType;
  stem: string;
  defaultMarks: number;
  options?: DraftOption[];
  /** SHORT_ANSWER, FILL_BLANK, NUMERIC, MATCHING. */
  acceptedAnswers?: unknown;
  tolerance?: number | null;
}

export interface Problem {
  field: string;
  code: string;
  message: string;
}

/** Types answered by choosing from a list. */
const OPTION_TYPES = new Set<QuestionType>(["MCQ_SINGLE", "MCQ_MULTI", "TRUE_FALSE"]);

/** Types answered by typing, and marked against accepted answers. */
const TYPED_TYPES = new Set<QuestionType>(["SHORT_ANSWER", "FILL_BLANK", "NUMERIC"]);

/**
 * Every problem with a question, or an empty list.
 *
 * Returns them ALL rather than throwing on the first, because a teacher fixing
 * a question one complaint at a time will give up before the question is right.
 */
export function validateQuestion(q: DraftQuestion): Problem[] {
  const problems: Problem[] = [];
  const options = q.options ?? [];
  const correct = options.filter((o) => o.isCorrect);

  if (q.stem.trim().length < 3) {
    problems.push({
      field: "stem",
      code: "REQUIRED",
      message: "Write the question itself.",
    });
  }

  if (!(q.defaultMarks > 0)) {
    problems.push({
      field: "defaultMarks",
      code: "INVALID",
      // A zero-mark question still takes a student's time in a timed quiz.
      message: "A question must be worth more than zero marks.",
    });
  }

  if (OPTION_TYPES.has(q.questionType)) {
    problems.push(...validateOptions(q.questionType, options, correct));
  } else if (options.length > 0) {
    problems.push({
      field: "options",
      code: "NOT_APPLICABLE",
      message: `A ${label(q.questionType)} question is not answered by choosing from a list.`,
    });
  }

  if (TYPED_TYPES.has(q.questionType)) {
    problems.push(...validateAcceptedAnswers(q));
  }

  if (q.questionType === "MATCHING") {
    problems.push(...validateMatching(q));
  }

  if (q.questionType === "ESSAY") {
    if (q.acceptedAnswers != null) {
      problems.push({
        field: "acceptedAnswers",
        code: "NOT_APPLICABLE",
        // An essay marked automatically against a model answer would fail every
        // student who wrote a good answer in different words.
        message: "An essay is marked by a person, so it has no accepted answers.",
      });
    }
  }

  return problems;
}

function validateOptions(
  type: QuestionType,
  options: DraftOption[],
  correct: DraftOption[],
): Problem[] {
  const problems: Problem[] = [];

  if (type === "TRUE_FALSE") {
    if (options.length !== 2) {
      problems.push({
        field: "options",
        code: "INVALID_COUNT",
        message: "A true/false question has exactly two options.",
      });
    }
  } else if (options.length < 2) {
    problems.push({
      field: "options",
      code: "INVALID_COUNT",
      message: "Give at least two options; one option is not a choice.",
    });
  }

  if (correct.length === 0) {
    // THE ONE THAT MATTERS. Nobody can answer this correctly, and without this
    // check nobody finds out until the cohort has sat the paper.
    problems.push({
      field: "options",
      code: "NO_CORRECT_ANSWER",
      message: "Mark at least one option as correct, or no student can answer this.",
    });
  }

  if (type !== "MCQ_MULTI" && correct.length > 1) {
    problems.push({
      field: "options",
      code: "TOO_MANY_CORRECT",
      message:
        type === "TRUE_FALSE"
          ? "Exactly one of true and false is correct."
          : "This type allows one correct option. Use multiple-answer if more than one is right.",
    });
  }

  if (type === "MCQ_MULTI" && correct.length === options.length && options.length > 0) {
    problems.push({
      field: "options",
      code: "ALL_CORRECT",
      // Every answer scores full marks, so the question measures nothing.
      message: "Every option is marked correct, so this question cannot distinguish anybody.",
    });
  }

  const seen = new Set<string>();
  for (const option of options) {
    const text = option.optionText.trim();
    if (text.length === 0) {
      problems.push({
        field: "options",
        code: "EMPTY_OPTION",
        message: "An option cannot be blank.",
      });
    } else if (seen.has(text.toLowerCase())) {
      problems.push({
        field: "options",
        code: "DUPLICATE_OPTION",
        // Two identical options mean one of them is wrong while reading
        // identically to the right one.
        message: `"${text}" appears more than once.`,
      });
    }
    seen.add(text.toLowerCase());
  }

  return problems;
}

function validateAcceptedAnswers(q: DraftQuestion): Problem[] {
  const answers = Array.isArray(q.acceptedAnswers) ? q.acceptedAnswers : null;

  if (!answers || answers.length === 0) {
    return [
      {
        field: "acceptedAnswers",
        code: "REQUIRED",
        message: "Give at least one answer that should be accepted.",
      },
    ];
  }

  const problems: Problem[] = [];

  if (q.questionType === "NUMERIC") {
    const numeric = answers.filter((a) => typeof a === "number" && Number.isFinite(a));
    if (numeric.length === 0) {
      problems.push({
        field: "acceptedAnswers",
        code: "INVALID",
        message: "A numeric question needs a number as its answer.",
      });
    }
    if (q.tolerance != null && q.tolerance < 0) {
      problems.push({
        field: "tolerance",
        code: "INVALID",
        message: "A tolerance cannot be negative.",
      });
    }
  } else if (answers.some((a) => typeof a !== "string" || a.trim().length === 0)) {
    problems.push({
      field: "acceptedAnswers",
      code: "INVALID",
      message: "Every accepted answer must be some text.",
    });
  }

  return problems;
}

function validateMatching(q: DraftQuestion): Problem[] {
  const pairs = q.acceptedAnswers;
  if (!pairs || typeof pairs !== "object" || Array.isArray(pairs)) {
    return [
      {
        field: "acceptedAnswers",
        code: "REQUIRED",
        message: "Give the pairs a student has to match.",
      },
    ];
  }

  const entries = Object.entries(pairs as Record<string, unknown>);
  if (entries.length < 2) {
    return [
      {
        field: "acceptedAnswers",
        code: "INVALID_COUNT",
        message: "A matching question needs at least two pairs.",
      },
    ];
  }

  return entries.every(([, v]) => typeof v === "string" && v.trim().length > 0)
    ? []
    : [
        {
          field: "acceptedAnswers",
          code: "INVALID",
          message: "Every pair needs both sides filled in.",
        },
      ];
}

/**
 * Whether a quiz can be published — FR-QIZ-020.
 *
 * A published quiz is one students can sit, so the checks here are about
 * whether sitting it would be coherent, not about whether it is finished to the
 * teacher's satisfaction.
 */
export function validateQuizForPublication(quiz: {
  questionCount: number;
  totalMarks: number;
  sumOfQuestionMarks: number;
  opensAt: Date;
  closesAt: Date;
  timeLimitMinutes: number | null;
  passingMarks: number | null;
}): Problem[] {
  const problems: Problem[] = [];

  if (quiz.questionCount === 0) {
    problems.push({
      field: "questions",
      code: "EMPTY",
      message: "A quiz with no questions cannot be published.",
    });
  }

  if (quiz.closesAt <= quiz.opensAt) {
    problems.push({
      field: "closesAt",
      code: "INVALID_RANGE",
      message: "The quiz must close after it opens.",
    });
  }

  if (quiz.timeLimitMinutes != null && quiz.timeLimitMinutes <= 0) {
    problems.push({
      field: "timeLimitMinutes",
      code: "INVALID",
      message: "A time limit must be more than zero minutes.",
    });
  }

  // The total is what a student is measured against, so it has to be the sum of
  // what is actually on the paper. A mismatch shows up as marks over 100% or a
  // ceiling nobody can reach.
  if (quiz.questionCount > 0 && quiz.sumOfQuestionMarks !== quiz.totalMarks) {
    problems.push({
      field: "totalMarks",
      code: "MISMATCH",
      message:
        `The questions add up to ${quiz.sumOfQuestionMarks} marks but the quiz is set to ` +
        `${quiz.totalMarks}. Correct one of them.`,
    });
  }

  if (quiz.passingMarks != null && quiz.passingMarks > quiz.totalMarks) {
    problems.push({
      field: "passingMarks",
      code: "UNREACHABLE",
      message: `Nobody can reach ${quiz.passingMarks} on a quiz worth ${quiz.totalMarks}.`,
    });
  }

  return problems;
}

function label(type: QuestionType): string {
  switch (type) {
    case "ESSAY":
      return "written";
    case "SHORT_ANSWER":
      return "short-answer";
    case "NUMERIC":
      return "numeric";
    case "FILL_BLANK":
      return "fill-in-the-blank";
    case "MATCHING":
      return "matching";
    default:
      return type.toLowerCase();
  }
}
