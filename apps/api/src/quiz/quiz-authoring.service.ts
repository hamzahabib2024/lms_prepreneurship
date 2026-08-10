import { Injectable, Logger } from "@nestjs/common";
import { AppError } from "@lms/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { getActor } from "../prisma/actor-context";
import { assertOwnsSectionSubject } from "../rbac/ownership";
import type { Problem } from "./question-validation";
import {
  validateQuestion,
  validateQuizForPublication,
  type DraftQuestion,
} from "./question-validation";

export interface CreateQuizInput {
  sectionSubjectId: string;
  title: string;
  instructions?: string;
  opensAt: Date;
  closesAt: Date;
  timeLimitMinutes?: number | null;
  maxAttempts?: number;
  attemptScoring?: "HIGHEST" | "LATEST" | "FIRST" | "AVERAGE";
  shuffleQuestions?: boolean;
  shuffleOptions?: boolean;
  negativeMarking?: "NONE" | "FIXED" | "PROPORTIONAL";
  negativeMarkingValue?: number | null;
  passingMarks?: number | null;
  presentation?: "ONE_PER_PAGE" | "ALL_ON_PAGE";
  allowBackwardNavigation?: boolean;
  resultReleasePolicy?: "IMMEDIATE" | "AFTER_CLOSE" | "AFTER_GRADING" | "MANUAL";
}

/**
 * Quiz authoring — SRS §5.10, FR-QIZ-001..020.
 *
 * The half of quizzes that did not exist. Attempts, marking and release were
 * all built; there was no way to create a quiz except by writing rows, which
 * meant the seed was the only author.
 *
 * Everything here is a teacher or admin operation, and the answer key lives in
 * these responses on purpose — the person writing the question needs to see
 * which option is right. Students are denied the Question, QuestionOption and
 * QuestionBank models outright by the scope policy, so the key cannot reach
 * them through any read this service performs.
 */
@Injectable()
export class QuizAuthoringService {
  private readonly logger = new Logger(QuizAuthoringService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------- banks --

  /** FR-QIZ-002 — a bank groups questions, usually by subject. */
  async createBank(input: { name: string; subjectId?: string }) {
    const actor = getActor();
    if (!actor) throw new AppError("AUTH_TOKEN_INVALID");

    const bank = await this.prisma.scoped.questionBank.create({
      data: {
        name: input.name,
        subjectId: input.subjectId ?? null,
        ownerTeacherId: actor.teacherId ?? null,
      },
    });

    await this.audit.record({
      action: "question_bank.create",
      entityType: "QuestionBank",
      entityId: bank.id,
      after: { name: bank.name },
    });
    return bank;
  }

  async listBanks(subjectId?: string) {
    const banks = await this.prisma.scoped.questionBank.findMany({
      where: { deletedAt: null, ...(subjectId ? { subjectId } : {}) },
      orderBy: { name: "asc" },
      include: { _count: { select: { questions: true } } },
    });

    return banks.map((b: (typeof banks)[number]) => ({
      id: b.id,
      name: b.name,
      subjectId: b.subjectId,
      questionCount: b._count.questions,
    }));
  }

  // --------------------------------------------------------- questions --

  /**
   * FR-QIZ-004..012 — adds a question, or explains everything wrong with it.
   *
   * The validation is pure and returns EVERY problem at once, because a teacher
   * fixing a question one complaint at a time gives up before it is right
   * (NFR-ERR-005).
   */
  async addQuestion(
    bankId: string,
    input: DraftQuestion & { difficulty?: "EASY" | "MEDIUM" | "HARD"; explanation?: string },
  ) {
    const actor = getActor();
    if (!actor) throw new AppError("AUTH_TOKEN_INVALID");

    const bank = await this.prisma.scoped.questionBank.findFirst({
      where: { id: bankId, deletedAt: null },
    });
    if (!bank) throw new AppError("RESOURCE_NOT_FOUND");

    this.refuseIfInvalid(validateQuestion(input));

    const question = await this.prisma.scoped.question.create({
      data: {
        questionBankId: bankId,
        subjectId: bank.subjectId,
        questionType: input.questionType,
        stem: input.stem.trim(),
        difficulty: input.difficulty ?? "MEDIUM",
        defaultMarks: input.defaultMarks,
        explanation: input.explanation ?? null,
        // Prisma distinguishes SQL NULL from JSON null on a Json column, so an
        // absent value is omitted rather than written as either.
        ...(input.acceptedAnswers != null
          ? { acceptedAnswers: input.acceptedAnswers as object }
          : {}),
        tolerance: input.tolerance ?? null,
        createdBy: actor.userId,
        options: input.options?.length
          ? {
              create: input.options.map((o, index) => ({
                optionText: o.optionText.trim(),
                isCorrect: o.isCorrect,
                displayOrder: index + 1,
              })),
            }
          : undefined,
      },
      include: { options: true },
    });

    await this.audit.record({
      action: "question.create",
      entityType: "Question",
      entityId: question.id,
      after: { bankId, type: input.questionType, marks: input.defaultMarks },
    });

    return question;
  }

  /**
   * FR-QIZ-010 — retires a question instead of deleting it.
   *
   * A question that has been answered is evidence: deleting it would leave
   * every past attempt referring to something that no longer exists, and a
   * challenged mark unanswerable. Retiring keeps it out of new quizzes.
   */
  async retireQuestion(questionId: string) {
    const question = await this.prisma.scoped.question.findFirst({
      where: { id: questionId, deletedAt: null },
    });
    if (!question) throw new AppError("RESOURCE_NOT_FOUND");

    await this.prisma.scoped.question.update({
      where: { id: questionId },
      data: { isRetired: true },
    });

    await this.audit.record({
      action: "question.retire",
      entityType: "Question",
      entityId: questionId,
      before: { isRetired: false },
      after: { isRetired: true },
    });
    return { retired: true };
  }

  /** The bank as its author sees it — WITH the answer key. */
  async listQuestions(bankId: string, includeRetired = false) {
    const questions = await this.prisma.scoped.question.findMany({
      where: {
        questionBankId: bankId,
        deletedAt: null,
        ...(includeRetired ? {} : { isRetired: false }),
      },
      orderBy: { createdAt: "asc" },
      include: { options: { orderBy: { displayOrder: "asc" } } },
    });

    return questions.map((q: (typeof questions)[number]) => ({
      id: q.id,
      questionType: q.questionType,
      stem: q.stem,
      difficulty: q.difficulty,
      defaultMarks: Number(q.defaultMarks),
      explanation: q.explanation,
      acceptedAnswers: q.acceptedAnswers,
      isRetired: q.isRetired,
      options: q.options.map((o: (typeof q.options)[number]) => ({
        id: o.id,
        optionText: o.optionText,
        isCorrect: o.isCorrect,
      })),
    }));
  }

  // ------------------------------------------------------------ quizzes --

  /** FR-QIZ-001 — creates a quiz as DRAFT (BR-CNT-01). */
  async createQuiz(input: CreateQuizInput) {
    const actor = getActor();
    if (!actor) throw new AppError("AUTH_TOKEN_INVALID");

    // The scope predicate does not constrain a create, so the subject-section
    // the caller named has to be checked here.
    assertOwnsSectionSubject(input.sectionSubjectId);

    if (input.closesAt <= input.opensAt) {
      throw new AppError("VALIDATION_FAILED", {
        details: [
          {
            field: "closesAt",
            code: "INVALID_RANGE",
            message: "The quiz must close after it opens.",
          },
        ],
      });
    }

    const quiz = await this.prisma.scoped.quiz.create({
      data: {
        sectionSubjectId: input.sectionSubjectId,
        title: input.title.trim(),
        instructions: input.instructions ?? null,
        // Zero until questions are added; publication refuses a mismatch.
        totalMarks: 0,
        opensAt: input.opensAt,
        closesAt: input.closesAt,
        timeLimitMinutes: input.timeLimitMinutes ?? null,
        maxAttempts: input.maxAttempts ?? 1,
        attemptScoring: input.attemptScoring ?? "HIGHEST",
        shuffleQuestions: input.shuffleQuestions ?? false,
        shuffleOptions: input.shuffleOptions ?? false,
        negativeMarking: input.negativeMarking ?? "NONE",
        negativeMarkingValue: input.negativeMarkingValue ?? null,
        passingMarks: input.passingMarks ?? null,
        presentation: input.presentation ?? "ONE_PER_PAGE",
        allowBackwardNavigation: input.allowBackwardNavigation ?? true,
        resultReleasePolicy: input.resultReleasePolicy ?? "AFTER_CLOSE",
        publicationStatus: "DRAFT",
        createdBy: actor.userId,
      },
    });

    await this.audit.record({
      action: "quiz.create",
      entityType: "Quiz",
      entityId: quiz.id,
      after: { title: quiz.title, sectionSubjectId: input.sectionSubjectId },
    });
    return quiz;
  }

  /**
   * FR-QIZ-014 — puts a question on a quiz at a given weight.
   *
   * The weight is per QUIZ, not per question: the same question can be worth
   * two marks in a class test and five in an examination, and its default is
   * only a starting point.
   */
  async addQuestionToQuiz(quizId: string, questionId: string, marks?: number) {
    const quiz = await this.prisma.scoped.quiz.findFirst({
      where: { id: quizId, deletedAt: null },
    });
    if (!quiz) throw new AppError("RESOURCE_NOT_FOUND");

    this.refuseIfPublished(quiz.publicationStatus);

    const question = await this.prisma.scoped.question.findFirst({
      where: { id: questionId, deletedAt: null },
    });
    if (!question) throw new AppError("RESOURCE_NOT_FOUND");

    if (question.isRetired) {
      throw new AppError("VALIDATION_FAILED", {
        details: [
          {
            field: "questionId",
            code: "RETIRED",
            message: "That question has been retired and cannot be added to a new quiz.",
          },
        ],
      });
    }

    const existing = await this.prisma.scoped.quizQuestion.findFirst({
      where: { quizId, questionId },
    });
    if (existing) {
      throw new AppError("RESOURCE_CONFLICT", {
        // Twice on one paper is always a mistake, and it would double the marks
        // silently.
        message: "That question is already on this quiz.",
      });
    }

    const last = await this.prisma.scoped.quizQuestion.findFirst({
      where: { quizId },
      orderBy: { displayOrder: "desc" },
    });

    await this.prisma.scoped.quizQuestion.create({
      data: {
        quizId,
        questionId,
        marks: marks ?? Number(question.defaultMarks),
        displayOrder: (last?.displayOrder ?? 0) + 1,
      },
    });

    return this.recomputeTotal(quizId);
  }

  async removeQuestionFromQuiz(quizId: string, questionId: string) {
    const quiz = await this.prisma.scoped.quiz.findFirst({
      where: { id: quizId, deletedAt: null },
    });
    if (!quiz) throw new AppError("RESOURCE_NOT_FOUND");
    this.refuseIfPublished(quiz.publicationStatus);

    await this.prisma.scoped.quizQuestion.deleteMany({ where: { quizId, questionId } });
    return this.recomputeTotal(quizId);
  }

  /**
   * FR-QIZ-020 — publish.
   *
   * Refuses an incoherent paper rather than letting a cohort discover it. The
   * checks are about whether SITTING it would make sense, not whether the
   * teacher has finished fiddling.
   */
  async publishQuiz(quizId: string) {
    const quiz = await this.prisma.scoped.quiz.findFirst({
      where: { id: quizId, deletedAt: null },
      include: { questions: { select: { marks: true } } },
    });
    if (!quiz) throw new AppError("RESOURCE_NOT_FOUND");

    const sum = quiz.questions.reduce(
      (t: number, q: { marks: unknown }) => t + Number(q.marks),
      0,
    );

    this.refuseIfInvalid(
      validateQuizForPublication({
        questionCount: quiz.questions.length,
        totalMarks: Number(quiz.totalMarks),
        sumOfQuestionMarks: sum,
        opensAt: quiz.opensAt,
        closesAt: quiz.closesAt,
        timeLimitMinutes: quiz.timeLimitMinutes,
        passingMarks: quiz.passingMarks == null ? null : Number(quiz.passingMarks),
      }),
    );

    const published = await this.prisma.scoped.quiz.update({
      where: { id: quizId },
      data: { publicationStatus: "PUBLISHED" },
    });

    await this.audit.record({
      action: "quiz.publish",
      entityType: "Quiz",
      entityId: quizId,
      after: { questions: quiz.questions.length, totalMarks: sum },
    });

    return published;
  }

  /** The quiz as its author sees it, including the paper. */
  async quizDetail(quizId: string) {
    const quiz = await this.prisma.scoped.quiz.findFirst({
      where: { id: quizId, deletedAt: null },
      include: {
        questions: {
          orderBy: { displayOrder: "asc" },
          include: { question: { include: { options: { orderBy: { displayOrder: "asc" } } } } },
        },
      },
    });
    if (!quiz) throw new AppError("RESOURCE_NOT_FOUND");

    const attempts = await this.prisma.scoped.quizAttempt.count({ where: { quizId } });

    return {
      id: quiz.id,
      title: quiz.title,
      instructions: quiz.instructions,
      publicationStatus: quiz.publicationStatus,
      totalMarks: Number(quiz.totalMarks),
      passingMarks: quiz.passingMarks == null ? null : Number(quiz.passingMarks),
      opensAt: quiz.opensAt,
      closesAt: quiz.closesAt,
      timeLimitMinutes: quiz.timeLimitMinutes,
      maxAttempts: quiz.maxAttempts,
      negativeMarking: quiz.negativeMarking,
      resultReleasePolicy: quiz.resultReleasePolicy,
      // So the interface can refuse to let a teacher edit a paper people have
      // already sat.
      attemptCount: attempts,
      questions: quiz.questions.map((qq: (typeof quiz.questions)[number]) => ({
        questionId: qq.questionId,
        displayOrder: qq.displayOrder,
        marks: Number(qq.marks),
        questionType: qq.question.questionType,
        stem: qq.question.stem,
        options: qq.question.options.map((o: { id: string; optionText: string; isCorrect: boolean }) => ({
          id: o.id,
          optionText: o.optionText,
          isCorrect: o.isCorrect,
        })),
      })),
    };
  }

  // ------------------------------------------------------------ internals --

  /** Keeps the stated total equal to what is actually on the paper. */
  private async recomputeTotal(quizId: string) {
    const rows = await this.prisma.scoped.quizQuestion.findMany({
      where: { quizId },
      select: { marks: true },
    });
    const total = rows.reduce((t: number, r: { marks: unknown }) => t + Number(r.marks), 0);

    await this.prisma.scoped.quiz.update({
      where: { id: quizId },
      data: { totalMarks: total },
    });

    return { quizId, questionCount: rows.length, totalMarks: total };
  }

  /**
   * A published quiz is not edited.
   *
   * Someone may already be sitting it, and changing the paper underneath them
   * is worse than making them wait — BR-QIZ-02 is the same principle applied to
   * shuffling. Unpublish first if it genuinely needs changing.
   */
  private refuseIfPublished(status: string): void {
    if (status === "PUBLISHED") {
      throw new AppError("RESOURCE_CONFLICT", {
        message:
          "This quiz is published. Unpublish it before changing the questions — a student may be sitting it.",
      });
    }
  }

  private refuseIfInvalid(problems: Problem[]): void {
    if (problems.length > 0) {
      throw new AppError("VALIDATION_FAILED", { details: problems });
    }
  }
}
