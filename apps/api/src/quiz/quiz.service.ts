import { Injectable, Logger } from "@nestjs/common";
import { AppError } from "@lms/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { getActor } from "../prisma/actor-context";
import { assertOwnStudent } from "../rbac/ownership";
import { NotificationService } from "../notification/notification.service";
import { isResultVisible, shouldStampRelease, type ResultReleasePolicy } from "./result-release";
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
    private readonly notifications: NotificationService,
  ) {}

  /**
   * FR-QIZ-023 — the quizzes set for one subject, with this student's standing.
   *
   * Deliberately carries NO question data. A student browsing the list has not
   * started an attempt, and shipping the paper early would let them read the
   * questions without the clock running.
   */
  async listForStudent(sectionSubjectId: string) {
    const actor = getActor();
    if (!actor?.studentId) {
      throw new AppError("AUTH_FORBIDDEN", {
        message: "This view is for students. Your account is not a student account.",
      });
    }
    const studentId = actor.studentId;

    // Scoped: PUBLISHED quizzes in the student's own sections only.
    const quizzes = await this.prisma.scoped.quiz.findMany({
      where: { sectionSubjectId, deletedAt: null },
      orderBy: { closesAt: "asc" },
      select: {
        id: true,
        title: true,
        instructions: true,
        totalMarks: true,
        opensAt: true,
        closesAt: true,
        timeLimitMinutes: true,
        maxAttempts: true,
        attemptScoring: true,
        passingMarks: true,
        negativeMarking: true,
        resultReleasePolicy: true,
        resultsReleasedAt: true,
      },
    });
    if (quizzes.length === 0) return [];

    const attempts = await this.prisma.scoped.quizAttempt.findMany({
      where: { studentId, quizId: { in: quizzes.map((q) => q.id) } },
      orderBy: { attemptNumber: "asc" },
      select: {
        quizId: true,
        attemptNumber: true,
        status: true,
        finalScore: true,
        releasedAt: true,
      },
    });

    const byQuiz = new Map<string, typeof attempts>();
    for (const a of attempts) {
      const list = byQuiz.get(a.quizId) ?? [];
      list.push(a);
      byQuiz.set(a.quizId, list);
    }

    const now = new Date();

    return quizzes.map((q: (typeof quizzes)[number]) => {
      const mine = byQuiz.get(q.id) ?? [];
      const inProgress = mine.find((a) => a.status === "IN_PROGRESS");

      // BR-QIZ-07 — a score is a score only once released. Anything else must
      // read as "not yet", never as zero.
      //
      // The POLICY is evaluated, not just the stamp: AFTER_CLOSE becomes
      // visible the moment the window shuts, and waiting for a stamp would
      // need a job running at exactly that time.
      const released = mine.filter(
        (a) =>
          a.finalScore != null &&
          isResultVisible({
            policy: q.resultReleasePolicy as ResultReleasePolicy,
            releasedAt: a.releasedAt,
            awaitingManualMarking: a.status === "GRADING",
            closesAt: q.closesAt,
            now,
          }),
      );
      const scores = released.map((a) => Number(a.finalScore));
      const recorded =
        scores.length === 0
          ? null
          : resolveAttemptScore(scores, q.attemptScoring);

      return {
        id: q.id,
        title: q.title,
        instructions: q.instructions,
        totalMarks: Number(q.totalMarks),
        passingMarks: q.passingMarks == null ? null : Number(q.passingMarks),
        opensAt: q.opensAt,
        closesAt: q.closesAt,
        timeLimitMinutes: q.timeLimitMinutes,
        maxAttempts: q.maxAttempts,
        attemptsUsed: mine.length,
        // FR-QIZ-013 — stated up front, because a student choosing whether to
        // guess needs to know before they start, not afterwards.
        negativeMarking: q.negativeMarking,

        isOpen: now >= q.opensAt && now <= q.closesAt,
        opensLater: now < q.opensAt,
        hasClosed: now > q.closesAt,
        canAttempt:
          now >= q.opensAt && now <= q.closesAt && mine.length < q.maxAttempts,
        inProgress: inProgress != null,

        awaitingMarking: mine.some((a) => a.status === "GRADING"),
        recordedScore: recorded,
        scorePolicy: q.attemptScoring,
      };
    });
  }

  /**
   * FR-TCH-018 — the teacher's quizzes for one subject-section.
   *
   * Includes DRAFT quizzes, unlike the student list: a teacher needs to see
   * what they are still preparing.
   */
  async listForTeacher(sectionSubjectId: string) {
    const quizzes = await this.prisma.scoped.quiz.findMany({
      where: { sectionSubjectId, deletedAt: null },
      orderBy: { closesAt: "desc" },
    });
    if (quizzes.length === 0) return [];

    const attempts = await this.prisma.scoped.quizAttempt.findMany({
      where: { quizId: { in: quizzes.map((q: (typeof quizzes)[number]) => q.id) } },
      select: { quizId: true, status: true, releasedAt: true },
    });

    return quizzes.map((q: (typeof quizzes)[number]) => {
      const mine = attempts.filter((a: (typeof attempts)[number]) => a.quizId === q.id);
      return {
        id: q.id,
        title: q.title,
        totalMarks: Number(q.totalMarks),
        opensAt: q.opensAt,
        closesAt: q.closesAt,
        publicationStatus: q.publicationStatus,
        resultReleasePolicy: q.resultReleasePolicy,
        attemptCount: mine.length,
        // The number that decides what a teacher does next.
        awaitingMarking: mine.filter((a) => a.status === "GRADING").length,
        unreleased: mine.filter((a) => a.status === "GRADED" && a.releasedAt === null).length,
      };
    });
  }

  /**
   * FR-QIZ-031 — the written answers waiting on a human, for one quiz.
   *
   * Only answers that genuinely need marking: an auto-marked answer already
   * has isCorrect set, and listing it would bury the handful that need
   * judgement among dozens that do not.
   */
  async markingQueue(quizId: string) {
    const quiz = await this.prisma.scoped.quiz.findFirst({
      where: { id: quizId, deletedAt: null },
      select: { id: true, title: true, totalMarks: true, resultReleasePolicy: true },
    });
    if (!quiz) throw new AppError("RESOURCE_NOT_FOUND");

    const answers = await this.prisma.scoped.quizAnswer.findMany({
      where: {
        attempt: { quizId, status: { in: ["GRADING", "GRADED"] } },
        isCorrect: null, // never auto-marked, so a human must decide
      },
      include: {
        attempt: {
          include: { student: { include: { user: { select: { fullName: true } } } } },
        },
        question: { select: { id: true, stem: true, questionType: true } },
      },
    });

    // The marks available come from the QUIZ's weighting, not the question's
    // default: the same question can be worth different marks in two quizzes.
    const weights = await this.prisma.scoped.quizQuestion.findMany({
      where: { quizId },
      select: { questionId: true, marks: true },
    });
    const marksFor = new Map(
      weights.map((w: (typeof weights)[number]) => [w.questionId, Number(w.marks)]),
    );

    const rows = answers.map((a: (typeof answers)[number]) => ({
      answerId: a.id,
      attemptId: a.attemptId,
      studentName: a.attempt.student.user.fullName,
      rollNo: a.attempt.student.currentRollNo,
      attemptNumber: a.attempt.attemptNumber,
      questionId: a.question.id,
      stem: a.question.stem,
      questionType: a.question.questionType,
      marksAvailable: marksFor.get(a.question.id) ?? 0,
      response: a.response,
      marksAwarded: a.marksAwarded == null ? null : Number(a.marksAwarded),
      graderComment: a.graderComment,
      isMarked: a.isManuallyGraded,
    }));

    return {
      quiz: { id: quiz.id, title: quiz.title, totalMarks: Number(quiz.totalMarks) },
      // Unmarked first: that is the queue.
      answers: rows.sort(
        (x, y) => Number(x.isMarked) - Number(y.isMarked) || (x.rollNo ?? 0) - (y.rollNo ?? 0),
      ),
      remaining: rows.filter((r) => !r.isMarked).length,
    };
  }

  /**
   * FR-QIZ-021 — releases every fully-marked attempt on a quiz.
   *
   * The cohort goes together, like assignment grades (FR-ASG-028), so nobody
   * learns their score before their classmates. An attempt still awaiting
   * marking is skipped rather than released with a partial score.
   */
  async releaseResults(quizId: string) {
    const quiz = await this.prisma.scoped.quiz.findFirst({
      where: { id: quizId, deletedAt: null },
      select: { id: true, title: true },
    });
    if (!quiz) throw new AppError("RESOURCE_NOT_FOUND");

    const now = new Date();
    const result = await this.prisma.asSystem((db) =>
      db.quizAttempt.updateMany({
        where: { quizId, status: "GRADED", releasedAt: null },
        data: { releasedAt: now },
      }),
    );

    await this.prisma.asSystem((db) =>
      db.quiz.update({ where: { id: quizId }, data: { resultsReleasedAt: now } }),
    );

    await this.audit.record({
      action: "quiz.results_release",
      entityType: "Quiz",
      entityId: quizId,
      after: { released: result.count, releasedAt: now },
    });

    const stillMarking = await this.prisma.asSystem((db) =>
      db.quizAttempt.count({ where: { quizId, status: "GRADING" } }),
    );

    // DEP-04 — the students whose results just became visible are told. No
    // score in the message: a mark is between a student and the Institute, and
    // a notification preview on a shared phone is not the place for it.
    if (result.count > 0) {
      const recipients = await this.prisma.asSystem((db) =>
        db.quizAttempt.findMany({
          where: { quizId, releasedAt: now },
          select: { student: { select: { userId: true } } },
        }),
      );
      await this.notifications.notify({
        recipientUserIds: recipients.map(
          (r: { student: { userId: string } }) => r.student.userId,
        ),
        kind: "quiz.result_released",
        title: `Your result for "${quiz.title}" is available`,
        body: "Your teacher has released the results for this quiz.",
        linkPath: "/subjects",
      });
    }

    return { quizId, released: result.count, stillAwaitingMarking: stillMarking };
  }

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
          // `options: true` would load isCorrect — the answer key — into this
          // process. projectForStudent does not copy it, so nothing leaked,
          // but that is a guarantee held by one function: any future code
          // returning quiz.questions directly would hand students the answers.
          //
          // Selecting the columns instead means the key never leaves the
          // database on a student's request at all, which no later edit here
          // can undo. Question.explanation and acceptedAnswers are omitted for
          // the same reason (FR-QIZ-018).
          include: {
            question: {
              select: {
                id: true,
                version: true,
                questionType: true,
                stem: true,
                options: { select: { id: true, optionText: true, displayOrder: true } },
              },
            },
          },
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
    // Evaluated, not merely read. AFTER_CLOSE becomes visible the moment the
    // window shuts, and stamping that would need a job running at exactly that
    // time — so visibility is decided here and the stamp records only
    // decisions actually taken.
    const visible = isResultVisible({
      policy: attempt.quiz.resultReleasePolicy as ResultReleasePolicy,
      releasedAt: attempt.releasedAt,
      awaitingManualMarking: attempt.status === "GRADING",
      closesAt: attempt.quiz.closesAt,
      now: new Date(),
    });

    if (!visible) {
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

    // SCOPED, not asSystem. This lookup is the authorisation: the QuizAnswer
    // policy limits a teacher to answers on quizzes in the subject-sections
    // they actively teach (BR-ACC-04), and denies students outright.
    //
    // It used to run under asSystem with no ownership check at all, guarded
    // only by `quiz_attempt:update` — a permission every student holds so they
    // can save their own answers as they type. A student could therefore award
    // marks, on their own attempt or anyone else's.
    const answer = await this.prisma.scoped.quizAnswer.findFirst({
      where: { id: answerId },
      include: { attempt: true },
    });
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

        // FR-QIZ-021 — marking is finished, so the release policy gets its
        // chance. Nothing stamped releasedAt here before, which meant an
        // AFTER_GRADING quiz stayed invisible for ever: the teacher marked the
        // essay, the score was computed, and the student was told indefinitely
        // that marking was still in progress.
        const stamp = shouldStampRelease({
          policy: attempt.quiz.resultReleasePolicy as ResultReleasePolicy,
          releasedAt: attempt.releasedAt,
          awaitingManualMarking: stillPending,
          closesAt: attempt.quiz.closesAt,
          now: new Date(),
        });

        await tx.quizAttempt.update({
          where: { id: attemptId },
          data: {
            manualScore: finalScore - Number(attempt.autoScore ?? 0),
            finalScore: stillPending ? null : finalScore,
            status: stillPending ? "GRADING" : "GRADED",
            isPassed: stillPending || passing === null ? null : finalScore >= passing,
            ...(stamp ? { releasedAt: new Date() } : {}),
          },
        });
      }),
    );
  }

  /** FR-QIZ-018 — the recorded score across a student's attempts. */
  async recordedScore(quizId: string, studentId: string) {
    // SEC-AUZ-004. The studentId comes from the URL, and this ran under
    // asSystem with no check on it, so any caller holding `quiz_attempt:read`
    // — which includes every student — could read a classmate's score by
    // naming their id.
    assertOwnStudent(studentId);

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
