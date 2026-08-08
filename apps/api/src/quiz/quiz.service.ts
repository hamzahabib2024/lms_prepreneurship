import { Injectable, Logger } from "@nestjs/common";
import { AppError } from "@lms/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { getActor } from "../prisma/actor-context";
import {
  resolveAttemptScore,
  scoreAttempt,
  type QuestionKey,
  type Response as AnswerResponse,
} from "./scoring";

/**
 * A question as a STUDENT sees it during an attempt.
 *
 * SEC-AUZ-009 / BR-QIZ-07 — this shape is the enforcement. There is no
 * isCorrect, no acceptedAnswers, no numericAnswer, no explanation, and no
 * matchKey. The keys are not stripped by a filter someone could forget; they
 * have no field to occupy, so a careless include cannot leak them.
 */
export interface StudentQuestionView {
  questionId: string;
  questionVersion: number;
  displayOrder: number;
  type: string;
  stem: string;
  marks: number;
  options?: Array<{ optionId: string; text: string }>;
}

@Injectable()
export class QuizService {
  private readonly logger = new Logger(QuizService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------- attempts --

  /**
   * FR-QIZ-024 — start or resume an attempt.
   *
   * BR-QIZ-04: an in-progress attempt is RESUMED rather than replaced, and its
   * remaining time is computed from the server-recorded start. A student whose
   * connection dropped must not be handed a fresh clock, nor lose the one they
   * had.
   */
  async startOrResume(quizId: string) {
    const actor = getActor();
    if (!actor?.studentId) {
      throw new AppError("AUTH_FORBIDDEN", { message: "Only a student can attempt a quiz." });
    }
    const studentId = actor.studentId;

    // Scoped: an unenrolled student cannot see the quiz, so this returns
    // nothing rather than disclosing that it exists.
    const quiz = await this.prisma.scoped.quiz.findFirst({
      where: { id: quizId, deletedAt: null, publicationStatus: "PUBLISHED" },
      include: {
        questions: {
          include: { question: { include: { options: true } } },
          orderBy: { displayOrder: "asc" },
        },
      },
    });
    if (!quiz) throw new AppError("RESOURCE_NOT_FOUND");

    const now = new Date();
    if (now < quiz.opensAt) {
      throw new AppError("RESOURCE_CONFLICT", {
        message: `This quiz opens on ${quiz.opensAt.toISOString()}.`,
      });
    }

    const existing = await this.prisma.asSystem((db) =>
      db.quizAttempt.findFirst({
        where: { quizId, studentId },
        orderBy: { attemptNumber: "desc" },
        include: { answers: true },
      }),
    );

    // ---- resume -----------------------------------------------------------
    if (existing?.status === "IN_PROGRESS") {
      const expired = existing.expiresAt && existing.expiresAt <= now;
      if (expired) {
        // FR-QIZ-028 — the clock ran out while they were away. Submit what was
        // saved rather than discarding it.
        await this.finalise(existing.id, "AUTO_TIME_EXPIRED");
        throw new AppError("QUIZ_ATTEMPT_EXPIRED", {
          message:
            "Your time ran out while you were disconnected. The answers you had saved were submitted.",
        });
      }

      const order = existing.questionOrder as unknown as string[];
      return {
        attemptId: existing.id,
        attemptNumber: existing.attemptNumber,
        resumed: true,
        startedAt: existing.startedAt,
        expiresAt: existing.expiresAt,
        // Computed from the SERVER-recorded start, never from a client clock
        // and never from the moment of reconnection (BR-QIZ-04).
        remainingSeconds: existing.expiresAt
          ? Math.max(0, Math.floor((existing.expiresAt.getTime() - now.getTime()) / 1000))
          : null,
        maxAttempts: quiz.maxAttempts,
        negativeMarking: this.negativeMarkingSummary(quiz),
        presentation: quiz.presentation,
        allowBackwardNavigation: quiz.allowBackwardNavigation,
        // The SAME question order they were shown before (BR-QIZ-02).
        questions: this.projectForStudent(quiz.questions, order, quiz.shuffleOptions),
        savedAnswers: Object.fromEntries(
          existing.answers.map((a: (typeof existing.answers)[number]) => [
            a.questionId,
            a.response,
          ]),
        ),
      };
    }

    // ---- new attempt ------------------------------------------------------
    if (now > quiz.closesAt) {
      throw new AppError("RESOURCE_CONFLICT", { message: "This quiz has closed." });
    }

    const used = existing?.attemptNumber ?? 0;
    if (used >= quiz.maxAttempts) {
      throw new AppError("QUIZ_ATTEMPTS_EXHAUSTED", {
        message:
          quiz.maxAttempts === 1
            ? "You have already attempted this quiz."
            : `You have used all ${quiz.maxAttempts} attempts for this quiz.`,
      });
    }

    // FR-QIZ-015/016 — selection and shuffling happen ONCE, here, and the
    // result is persisted. Reshuffling on resume would change the paper
    // underneath a student mid-attempt.
    const order = this.selectAndOrder(quiz.questions, quiz.shuffleQuestions);

    const expiresAt = quiz.timeLimitMinutes
      ? new Date(now.getTime() + quiz.timeLimitMinutes * 60_000)
      : null;

    const attempt = await this.prisma.asSystem((db) =>
      db.quizAttempt.create({
        data: {
          quizId,
          studentId,
          attemptNumber: used + 1,
          startedAt: now,
          expiresAt,
          status: "IN_PROGRESS",
          questionOrder: order as unknown as object,
        },
      }),
    );

    await this.audit.record({
      action: "quiz.attempt_start",
      entityType: "QuizAttempt",
      entityId: attempt.id,
      after: { quizId, attemptNumber: attempt.attemptNumber, expiresAt },
    });

    return {
      attemptId: attempt.id,
      attemptNumber: attempt.attemptNumber,
      resumed: false,
      startedAt: attempt.startedAt,
      expiresAt,
      remainingSeconds: quiz.timeLimitMinutes ? quiz.timeLimitMinutes * 60 : null,
      maxAttempts: quiz.maxAttempts,
      negativeMarking: this.negativeMarkingSummary(quiz),
      presentation: quiz.presentation,
      allowBackwardNavigation: quiz.allowBackwardNavigation,
      questions: this.projectForStudent(quiz.questions, order, quiz.shuffleOptions),
      savedAnswers: {},
    };
  }

  /**
   * FR-QIZ-026 — auto-save.
   *
   * Deliberately cheap and forgiving: it accepts a partial answer at any time
   * while the attempt is open, because the alternative is a student losing
   * work when their connection drops.
   */
  async saveAnswer(attemptId: string, questionId: string, response: AnswerResponse) {
    const actor = getActor();
    if (!actor?.studentId) throw new AppError("AUTH_FORBIDDEN");

    const attempt = await this.prisma.asSystem((db) =>
      db.quizAttempt.findUnique({ where: { id: attemptId } }),
    );
    if (!attempt || attempt.studentId !== actor.studentId) {
      throw new AppError("RESOURCE_NOT_FOUND");
    }
    if (attempt.status !== "IN_PROGRESS") {
      throw new AppError("RESOURCE_CONFLICT", { message: "This attempt has already been submitted." });
    }
    // Server clock only. A client that believes it has time left does not.
    if (attempt.expiresAt && attempt.expiresAt <= new Date()) {
      await this.finalise(attemptId, "AUTO_TIME_EXPIRED");
      throw new AppError("QUIZ_ATTEMPT_EXPIRED", {
        message: "Your time has run out. The answers you saved were submitted.",
      });
    }

    const question = await this.prisma.asSystem((db) =>
      db.question.findUnique({ where: { id: questionId }, select: { version: true } }),
    );
    if (!question) throw new AppError("RESOURCE_NOT_FOUND");

    await this.prisma.asSystem((db) =>
      db.quizAnswer.upsert({
        where: { attemptId_questionId: { attemptId, questionId } },
        create: {
          attemptId,
          questionId,
          questionVersion: question.version, // FR-QIZ-009
          response: (response ?? null) as object,
        },
        update: { response: (response ?? null) as object },
      }),
    );

    // Deliberately minimal: no score, no correctness, nothing that could hint
    // at the answer key mid-attempt (SEC-AUZ-009).
    return { saved: true, savedAt: new Date() };
  }

  /** FR-QIZ-029 — submit, with the unanswered count surfaced for confirmation. */
  async submit(attemptId: string) {
    const actor = getActor();
    if (!actor?.studentId) throw new AppError("AUTH_FORBIDDEN");

    const attempt = await this.prisma.asSystem((db) =>
      db.quizAttempt.findUnique({ where: { id: attemptId } }),
    );
    if (!attempt || attempt.studentId !== actor.studentId) {
      throw new AppError("RESOURCE_NOT_FOUND");
    }
    if (attempt.status !== "IN_PROGRESS") {
      throw new AppError("RESOURCE_CONFLICT", { message: "This attempt has already been submitted." });
    }

    return this.finalise(attemptId, "MANUAL");
  }

  /**
   * Scores and closes an attempt.
   *
   * FR-QIZ-032/033: the auto-gradable portion is scored immediately. Where a
   * question needs judgement the attempt sits in GRADING and the student is
   * TOLD so, rather than shown a partial score that reads as a failure.
   */
  private async finalise(attemptId: string, mode: "MANUAL" | "AUTO_TIME_EXPIRED") {
    return this.prisma.asSystem((db) =>
      db.$transaction(async (tx) => {
        const attempt = await tx.quizAttempt.findUnique({
          where: { id: attemptId },
          include: {
            answers: true,
            quiz: {
              include: {
                questions: { include: { question: { include: { options: true } } } },
              },
            },
          },
        });
        if (!attempt) throw new AppError("RESOURCE_NOT_FOUND");
        if (attempt.status !== "IN_PROGRESS") {
          return this.attemptSummary(attempt);
        }

        const keys = this.buildKeys(attempt.quiz.questions);
        const responses = Object.fromEntries(
          attempt.answers.map((a: (typeof attempt.answers)[number]) => [
            a.questionId,
            a.response as AnswerResponse,
          ]),
        );

        const result = scoreAttempt(keys, responses, {
          mode: attempt.quiz.negativeMarking,
          value: attempt.quiz.negativeMarkingValue
            ? Number(attempt.quiz.negativeMarkingValue)
            : null,
        });

        for (const a of result.answers) {
          await tx.quizAnswer.updateMany({
            where: { attemptId, questionId: a.questionId },
            data: {
              isCorrect: a.isCorrect,
              marksAwarded: a.marksAwarded - a.penaltyApplied,
              isManuallyGraded: false,
            },
          });
        }

        const now = new Date();
        const status = result.requiresManualGrading ? "GRADING" : "GRADED";
        const passing = attempt.quiz.passingMarks ? Number(attempt.quiz.passingMarks) : null;

        // Release policy decides visibility, not scoring. A held result is
        // still computed; it is simply not shown yet.
        const releaseNow =
          !result.requiresManualGrading &&
          attempt.quiz.resultReleasePolicy === "IMMEDIATE";

        const updated = await tx.quizAttempt.update({
          where: { id: attemptId },
          data: {
            status,
            submittedAt: now,
            submissionMode: mode,
            autoScore: result.autoScore,
            finalScore: result.requiresManualGrading ? null : result.autoScore,
            isPassed:
              result.requiresManualGrading || passing === null
                ? null
                : result.autoScore >= passing,
            releasedAt: releaseNow ? now : null,
          },
        });

        await this.audit.record(
          {
            action: "quiz.attempt_submit",
            entityType: "QuizAttempt",
            entityId: attemptId,
            after: {
              mode,
              autoScore: result.autoScore,
              requiresManualGrading: result.requiresManualGrading,
            },
          },
          tx as unknown as Parameters<AuditService["record"]>[1],
        );

        return {
          attemptId,
          status,
          submittedAt: now,
          submissionMode: mode,
          autoScore: result.autoScore,
          autoScoreOutOf: result.maxScore - result.pendingManualMarks,
          manualPending: result.requiresManualGrading
            ? {
                questionCount: result.answers.filter((a) => a.requiresManualGrading).length,
                marksOutstanding: result.pendingManualMarks,
              }
            : null,
          resultAvailable: releaseNow,
          // FR-QIZ-033 — say what is happening instead of showing a number
          // that looks like a poor result.
          message: result.requiresManualGrading
            ? "Your quiz has been submitted. Some questions need marking by your teacher; " +
              "your result will appear once that is done."
            : releaseNow
              ? "Your quiz has been submitted and marked."
              : "Your quiz has been submitted. Results will be released by your teacher.",
        };
      }),
    );
  }

  /**
   * FR-QIZ-021/022 — the student's result view.
   *
   * Answer review is gated by the configured policy, so correct answers and
   * explanations appear only when the teacher intends them to.
   */
  async attemptResult(attemptId: string) {
    const actor = getActor();
    if (!actor?.studentId) throw new AppError("AUTH_FORBIDDEN");

    const attempt = await this.prisma.asSystem((db) =>
      db.quizAttempt.findUnique({
        where: { id: attemptId },
        include: { quiz: true, answers: true },
      }),
    );
    if (!attempt || attempt.studentId !== actor.studentId) {
      throw new AppError("RESOURCE_NOT_FOUND");
    }

    if (attempt.status === "IN_PROGRESS") {
      throw new AppError("RESOURCE_CONFLICT", { message: "This attempt is still in progress." });
    }
    if (!attempt.releasedAt) {
      return {
        attemptId,
        status: attempt.status,
        resultAvailable: false as const,
        message:
          attempt.status === "GRADING"
            ? "Your teacher is still marking part of this quiz."
            : "Results have not been released yet.",
      };
    }

    const now = new Date();
    const mayReview =
      attempt.quiz.answerReviewPolicy === "AFTER_RELEASE" ||
      (attempt.quiz.answerReviewPolicy === "AFTER_CLOSE" && now > attempt.quiz.closesAt);

    return {
      attemptId,
      status: attempt.status,
      resultAvailable: true as const,
      score: Number(attempt.finalScore ?? attempt.autoScore ?? 0),
      outOf: Number(attempt.quiz.totalMarks),
      isPassed: attempt.isPassed,
      submittedAt: attempt.submittedAt,
      // Only when the policy allows. Otherwise a student can screenshot the
      // key and pass it to the next cohort.
      answers: mayReview
        ? attempt.answers.map((a: (typeof attempt.answers)[number]) => ({
            questionId: a.questionId,
            isCorrect: a.isCorrect,
            marksAwarded: a.marksAwarded ? Number(a.marksAwarded) : 0,
            graderComment: a.graderComment,
          }))
        : null,
    };
  }

  /** FR-QIZ-034 — manual grading, grouped by question across the cohort. */
  async gradeAnswer(answerId: string, marks: number, comment?: string) {
    const actor = getActor();
    if (!actor) throw new AppError("AUTH_TOKEN_INVALID");

    const answer = await this.prisma.asSystem((db) =>
      db.quizAnswer.findUnique({ where: { id: answerId }, include: { attempt: true } }),
    );
    if (!answer) throw new AppError("RESOURCE_NOT_FOUND");

    await this.prisma.asSystem((db) =>
      db.quizAnswer.update({
        where: { id: answerId },
        data: {
          marksAwarded: marks,
          isManuallyGraded: true,
          gradedBy: actor.userId,
          graderComment: comment ?? null,
        },
      }),
    );

    await this.recomputeAttempt(answer.attemptId);
    return { answerId, marksAwarded: marks };
  }

  /** Recomputes once every manual answer on an attempt has been marked. */
  private async recomputeAttempt(attemptId: string) {
    await this.prisma.asSystem((db) =>
      db.$transaction(async (tx) => {
        const attempt = await tx.quizAttempt.findUnique({
          where: { id: attemptId },
          include: { answers: true, quiz: true },
        });
        if (!attempt) return;

        const total = attempt.answers.reduce(
          (s: number, a: (typeof attempt.answers)[number]) =>
            s + Number(a.marksAwarded ?? 0),
          0,
        );
        const stillPending = attempt.answers.some(
          (a: (typeof attempt.answers)[number]) =>
            a.isCorrect === null && !a.isManuallyGraded,
        );

        const passing = attempt.quiz.passingMarks ? Number(attempt.quiz.passingMarks) : null;
        const finalScore = Math.max(0, Math.round(total * 100) / 100);

        await tx.quizAttempt.update({
          where: { id: attemptId },
          data: {
            manualScore: finalScore - Number(attempt.autoScore ?? 0),
            finalScore: stillPending ? null : finalScore,
            status: stillPending ? "GRADING" : "GRADED",
            isPassed: stillPending || passing === null ? null : finalScore >= passing,
          },
        });
      }),
    );
  }

  /** FR-QIZ-018 — the recorded score across a student's attempts. */
  async recordedScore(quizId: string, studentId: string) {
    const quiz = await this.prisma.asSystem((db) =>
      db.quiz.findUnique({ where: { id: quizId }, select: { attemptScoring: true } }),
    );
    if (!quiz) throw new AppError("RESOURCE_NOT_FOUND");

    const attempts = await this.prisma.asSystem((db) =>
      db.quizAttempt.findMany({
        where: { quizId, studentId, status: "GRADED" },
        orderBy: { attemptNumber: "asc" },
        select: { finalScore: true },
      }),
    );

    const scores = attempts
      .map((a: { finalScore: unknown }) => Number(a.finalScore ?? 0))
      .filter((n: number) => Number.isFinite(n));

    return {
      quizId,
      studentId,
      policy: quiz.attemptScoring,
      attempts: scores.length,
      recordedScore: resolveAttemptScore(scores, quiz.attemptScoring),
    };
  }

  // ------------------------------------------------------------ internals --

  /**
   * SEC-AUZ-009 / BR-QIZ-07 — the projection that keeps answer keys out of a
   * student's response.
   *
   * It builds a NEW object rather than deleting fields from the database row.
   * Deleting is one forgotten property away from a leak; constructing means a
   * field can only appear if someone deliberately adds it here.
   */
  private projectForStudent(
    quizQuestions: Array<{
      questionId: string;
      marks: unknown;
      displayOrder: number;
      question: {
        id: string;
        version: number;
        questionType: string;
        stem: string;
        options: Array<{ id: string; optionText: string; displayOrder: number }>;
      };
    }>,
    order: string[],
    shuffleOptions: boolean,
  ): StudentQuestionView[] {
    const byId = new Map(quizQuestions.map((qq) => [qq.questionId, qq]));

    // Resolve first, then build. A question referenced by the persisted order
    // but since retired simply drops out rather than producing a null hole.
    const resolved = order
      .map((questionId) => byId.get(questionId))
      .filter((qq): qq is NonNullable<typeof qq> => qq !== undefined);

    return resolved.map((qq, index) => {
      const options = [...qq.question.options].sort((a, b) => a.displayOrder - b.displayOrder);
      if (shuffleOptions) shuffleInPlace(options);

      const view: StudentQuestionView = {
        questionId: qq.question.id,
        questionVersion: qq.question.version,
        displayOrder: index + 1,
        type: qq.question.questionType,
        stem: qq.question.stem,
        marks: Number(qq.marks),
      };
      // Assigned only when present, so the key is absent rather than
      // explicitly undefined — which keeps the JSON response clean.
      if (options.length > 0) {
        view.options = options.map((o) => ({ optionId: o.id, text: o.optionText }));
      }
      return view;
    });
  }

  /** The teacher-side view, where the keys legitimately live. */
  private buildKeys(
    quizQuestions: Array<{
      marks: unknown;
      question: {
        id: string;
        questionType: string;
        acceptedAnswers: unknown;
        tolerance: unknown;
        caseSensitive: boolean;
        options: Array<{ id: string; isCorrect: boolean; matchKey: string | null }>;
      };
    }>,
  ): QuestionKey[] {
    return quizQuestions.map((qq) => {
      const q = qq.question;
      const accepted = Array.isArray(q.acceptedAnswers)
        ? (q.acceptedAnswers as string[])
        : undefined;

      const matchPairs: Record<string, string> = {};
      for (const o of q.options) if (o.matchKey) matchPairs[o.id] = o.matchKey;

      return {
        questionId: q.id,
        questionType: q.questionType as QuestionKey["questionType"],
        marks: Number(qq.marks),
        correctOptionIds: q.options.filter((o) => o.isCorrect).map((o) => o.id),
        acceptedAnswers: accepted,
        caseSensitive: q.caseSensitive,
        numericAnswer:
          q.questionType === "NUMERIC" && accepted?.[0] != null
            ? Number(accepted[0])
            : undefined,
        tolerance: q.tolerance != null ? Number(q.tolerance) : undefined,
        matchPairs: Object.keys(matchPairs).length > 0 ? matchPairs : undefined,
      };
    });
  }

  /** FR-QIZ-015/016 — selection and order, decided once and persisted. */
  private selectAndOrder(
    quizQuestions: Array<{ questionId: string; displayOrder: number }>,
    shuffle: boolean,
  ): string[] {
    const ids = [...quizQuestions]
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .map((q) => q.questionId);
    if (shuffle) shuffleInPlace(ids);
    return ids;
  }

  private negativeMarkingSummary(quiz: { negativeMarking: string; negativeMarkingValue: unknown }) {
    return quiz.negativeMarking === "NONE"
      ? null
      : {
          mode: quiz.negativeMarking,
          value: Number(quiz.negativeMarkingValue ?? 0),
          // Stated plainly up front, because a student who discovers negative
          // marking at the result screen has been treated unfairly.
          note: "Incorrect answers lose marks. Questions you leave blank do not.",
        };
  }

  private attemptSummary(attempt: {
    id: string;
    status: string;
    submittedAt: Date | null;
    autoScore: unknown;
  }) {
    return {
      attemptId: attempt.id,
      status: attempt.status,
      submittedAt: attempt.submittedAt,
      autoScore: Number(attempt.autoScore ?? 0),
      autoScoreOutOf: 0,
      manualPending: null,
      resultAvailable: false,
      submissionMode: "MANUAL" as const,
      message: "This attempt has already been submitted.",
    };
  }
}

/** Fisher-Yates. Uniform, unlike sort() with a random comparator. */
function shuffleInPlace<T>(items: T[]): void {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j] as T, items[i] as T];
  }
}
