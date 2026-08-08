/**
 * Quiz scoring — SRS §5.10.5, BR-QIZ-06.
 *
 * A pure function, for the third time in this codebase and the same reason:
 * this arithmetic decides a mark, so it must be provable in isolation rather
 * than only observable through a database and an HTTP request.
 *
 * The rule that carries the most risk is BR-QIZ-06 — negative marking applies
 * to INCORRECT answers only, NEVER to unanswered ones. Getting that wrong
 * punishes a student for running out of time, which is both unjust and the
 * kind of defect that surfaces as a complaint rather than a bug report.
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

export type NegativeMarkingMode = "NONE" | "FIXED" | "PROPORTIONAL";

export interface QuestionKey {
  questionId: string;
  questionType: QuestionType;
  marks: number;
  /** Option ids flagged correct. MCQ, TRUE_FALSE, MATCHING. */
  correctOptionIds?: string[];
  /** SHORT_ANSWER, FILL_BLANK. */
  acceptedAnswers?: string[];
  caseSensitive?: boolean;
  /** NUMERIC. */
  numericAnswer?: number;
  tolerance?: number;
  /** MATCHING — optionId to matchKey. */
  matchPairs?: Record<string, string>;
}

/** null or undefined means UNANSWERED, which is distinct from wrong. */
export type Response =
  | { selectedOptionIds: string[] }
  | { text: string }
  | { value: number }
  | { pairs: Record<string, string> }
  | null
  | undefined;

export interface NegativeMarkingConfig {
  mode: NegativeMarkingMode;
  /** Marks for FIXED; a fraction of the question's marks for PROPORTIONAL. */
  value?: number | null;
}

export interface AnswerScore {
  questionId: string;
  answered: boolean;
  isCorrect: boolean | null; // null where the type needs manual grading
  marksAwarded: number;
  penaltyApplied: number;
  requiresManualGrading: boolean;
  detail: string;
}

export interface AttemptScore {
  autoScore: number;
  /** Marks locked behind manual grading — not yet part of autoScore. */
  pendingManualMarks: number;
  maxScore: number;
  answers: AnswerScore[];
  requiresManualGrading: boolean;
}

const MANUAL_TYPES: QuestionType[] = ["ESSAY"];

/** SHORT_ANSWER and FILL_BLANK auto-grade only when a key was supplied. */
function needsManual(key: QuestionKey): boolean {
  if (MANUAL_TYPES.includes(key.questionType)) return true;
  if (
    (key.questionType === "SHORT_ANSWER" || key.questionType === "FILL_BLANK") &&
    (!key.acceptedAnswers || key.acceptedAnswers.length === 0)
  ) {
    return true;
  }
  return false;
}

function isAnswered(response: Response): boolean {
  if (response === null || response === undefined) return false;
  if ("selectedOptionIds" in response) return response.selectedOptionIds.length > 0;
  if ("text" in response) return response.text.trim().length > 0;
  if ("value" in response) return Number.isFinite(response.value);
  if ("pairs" in response) return Object.keys(response.pairs).length > 0;
  return false;
}

function normalise(s: string, caseSensitive: boolean): string {
  const trimmed = s.trim().replace(/\s+/g, " ");
  return caseSensitive ? trimmed : trimmed.toLowerCase();
}

/**
 * Scores one answer.
 *
 * `proportionCorrect` is returned for MCQ_MULTI and MATCHING so partial credit
 * is possible; the caller decides whether to grant it. All-or-nothing is the
 * default because partial credit on a multi-select can be gamed by selecting
 * everything.
 */
export function scoreAnswer(
  key: QuestionKey,
  response: Response,
  negative: NegativeMarkingConfig = { mode: "NONE" },
  options: { allowPartialCredit?: boolean } = {},
): AnswerScore {
  const answered = isAnswered(response);

  if (needsManual(key)) {
    return {
      questionId: key.questionId,
      answered,
      isCorrect: null,
      marksAwarded: 0,
      penaltyApplied: 0,
      requiresManualGrading: true,
      detail: answered ? "Awaiting marking by your teacher" : "Not answered",
    };
  }

  // BR-QIZ-06 — THE rule. An unanswered question scores zero and is NEVER
  // penalised. Penalising it would punish a student for running out of time.
  if (!answered) {
    return {
      questionId: key.questionId,
      answered: false,
      isCorrect: false,
      marksAwarded: 0,
      penaltyApplied: 0,
      requiresManualGrading: false,
      detail: "Not answered — no penalty applied",
    };
  }

  const proportion = proportionCorrectFor(key, response);
  const fullyCorrect = proportion >= 1;

  let marks: number;
  if (fullyCorrect) {
    marks = key.marks;
  } else if (options.allowPartialCredit && proportion > 0) {
    marks = round2(key.marks * proportion);
  } else {
    marks = 0;
  }

  // The penalty applies only to a wholly incorrect answer. Deducting from
  // partial credit would let a student score below zero on one question.
  let penalty = 0;
  if (!fullyCorrect && marks === 0 && negative.mode !== "NONE") {
    penalty =
      negative.mode === "FIXED"
        ? (negative.value ?? 0)
        : round2(key.marks * ((negative.value ?? 0) / 100));
  }

  return {
    questionId: key.questionId,
    answered: true,
    isCorrect: fullyCorrect,
    marksAwarded: round2(marks),
    penaltyApplied: round2(penalty),
    requiresManualGrading: false,
    detail: fullyCorrect
      ? "Correct"
      : marks > 0
        ? `Partially correct (${Math.round(proportion * 100)}%)`
        : penalty > 0
          ? `Incorrect — ${round2(penalty)} mark${penalty === 1 ? "" : "s"} deducted`
          : "Incorrect",
  };
}

/** 0 to 1. Exactly 1 means fully correct. */
function proportionCorrectFor(key: QuestionKey, response: Response): number {
  if (!response) return 0;

  switch (key.questionType) {
    case "MCQ_SINGLE":
    case "TRUE_FALSE": {
      if (!("selectedOptionIds" in response)) return 0;
      const correct = key.correctOptionIds ?? [];
      // Selecting more than one on a single-answer question is incorrect,
      // not partially correct.
      return response.selectedOptionIds.length === 1 &&
        correct.includes(response.selectedOptionIds[0] as string)
        ? 1
        : 0;
    }

    case "MCQ_MULTI": {
      if (!("selectedOptionIds" in response)) return 0;
      const correct = new Set(key.correctOptionIds ?? []);
      const chosen = new Set(response.selectedOptionIds);
      if (correct.size === 0) return 0;

      let hits = 0;
      let wrong = 0;
      for (const id of chosen) (correct.has(id) ? hits++ : wrong++);

      // Selecting everything must not score well, so wrong choices subtract
      // from the proportion.
      const raw = (hits - wrong) / correct.size;
      return Math.max(0, Math.min(1, raw));
    }

    case "SHORT_ANSWER":
    case "FILL_BLANK": {
      if (!("text" in response)) return 0;
      const accepted = key.acceptedAnswers ?? [];
      const given = normalise(response.text, key.caseSensitive ?? false);
      return accepted.some((a) => normalise(a, key.caseSensitive ?? false) === given) ? 1 : 0;
    }

    case "NUMERIC": {
      if (!("value" in response)) return 0;
      if (key.numericAnswer === undefined) return 0;
      const tolerance = key.tolerance ?? 0;
      return Math.abs(response.value - key.numericAnswer) <= tolerance ? 1 : 0;
    }

    case "MATCHING": {
      if (!("pairs" in response)) return 0;
      const expected = key.matchPairs ?? {};
      const total = Object.keys(expected).length;
      if (total === 0) return 0;
      let hits = 0;
      for (const [optionId, matchKey] of Object.entries(expected)) {
        if (response.pairs[optionId] === matchKey) hits++;
      }
      return hits / total;
    }

    case "ESSAY":
      return 0; // handled by needsManual
  }
}

/**
 * Scores a whole attempt.
 *
 * FR-QIZ-032: the auto-gradable portion is scored immediately. Questions
 * needing judgement are reported separately as pendingManualMarks rather than
 * counted as zero — FR-QIZ-033 requires the student to be told grading is in
 * progress, not shown a partial score that reads as a failure.
 */
export function scoreAttempt(
  keys: QuestionKey[],
  responses: Record<string, Response>,
  negative: NegativeMarkingConfig = { mode: "NONE" },
  options: { allowPartialCredit?: boolean } = {},
): AttemptScore {
  const answers = keys.map((k) => scoreAnswer(k, responses[k.questionId], negative, options));

  const autoScore = answers.reduce(
    (sum, a) => sum + (a.requiresManualGrading ? 0 : a.marksAwarded - a.penaltyApplied),
    0,
  );

  return {
    // FR-QIZ-017: the TOTAL is floored at zero. A student may lose marks on a
    // question, but an attempt should not end below nothing.
    autoScore: round2(Math.max(0, autoScore)),
    pendingManualMarks: round2(
      keys.filter((k) => needsManual(k)).reduce((s, k) => s + k.marks, 0),
    ),
    maxScore: round2(keys.reduce((s, k) => s + k.marks, 0)),
    answers,
    requiresManualGrading: answers.some((a) => a.requiresManualGrading),
  };
}

/** FR-QIZ-018 — how several attempts resolve to one recorded score. */
export function resolveAttemptScore(
  scores: number[],
  policy: "HIGHEST" | "LATEST" | "FIRST" | "AVERAGE",
): number | null {
  if (scores.length === 0) return null;
  switch (policy) {
    case "HIGHEST":
      return Math.max(...scores);
    case "FIRST":
      return scores[0] as number;
    case "LATEST":
      return scores[scores.length - 1] as number;
    case "AVERAGE":
      return round2(scores.reduce((a, b) => a + b, 0) / scores.length);
  }
}

const round2 = (n: number): number => Math.round(n * 100) / 100;
