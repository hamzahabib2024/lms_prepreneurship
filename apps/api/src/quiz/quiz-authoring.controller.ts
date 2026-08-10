import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { QuizAuthoringService } from "./quiz-authoring.service";
import { zodBody } from "../common/zod-validation.pipe";
import { RequirePermission } from "../rbac/permissions.guard";

const QUESTION_TYPES = [
  "MCQ_SINGLE",
  "MCQ_MULTI",
  "TRUE_FALSE",
  "SHORT_ANSWER",
  "ESSAY",
  "NUMERIC",
  "MATCHING",
  "FILL_BLANK",
] as const;

const bankSchema = z.object({
  name: z.string().trim().min(2).max(200),
  subjectId: z.string().uuid().optional(),
});

/**
 * SHAPE ONLY — is it a string, is it a number, is it one of the eight types.
 *
 * The MEANING is question-validation.ts: long enough, worth something, at least
 * one correct option, accepted answers where they are needed, no options on an
 * essay. The two must not overlap, and this schema deliberately omits `min(1)`
 * on the stem and `positive()` on the marks even though both are wrong values.
 *
 * Zod runs first and short-circuits. When it also checked those, a teacher
 * submitting a question with an empty stem AND no correct option was told about
 * the stem, fixed it, submitted again, and only then learnt the question was
 * unanswerable. Two round trips for one broken question, which is exactly what
 * NFR-ERR-005 exists to prevent.
 */
const questionSchema = z.object({
  questionType: z.enum(QUESTION_TYPES),
  stem: z.string().trim().max(5000),
  defaultMarks: z.coerce.number().max(100),
  difficulty: z.enum(["EASY", "MEDIUM", "HARD"]).optional(),
  explanation: z.string().trim().max(5000).optional(),
  options: z
    .array(
      z.object({
        optionText: z.string().max(1000),
        isCorrect: z.boolean().default(false),
      }),
    )
    .max(20)
    .optional(),
  acceptedAnswers: z.unknown().optional(),
  tolerance: z.coerce.number().nullable().optional(),
});

const quizSchema = z.object({
  sectionSubjectId: z.string().uuid(),
  title: z.string().trim().min(3).max(255),
  instructions: z.string().trim().max(10000).optional(),
  opensAt: z.coerce.date(),
  closesAt: z.coerce.date(),
  timeLimitMinutes: z.coerce.number().int().positive().max(600).nullable().optional(),
  maxAttempts: z.coerce.number().int().positive().max(10).optional(),
  attemptScoring: z.enum(["HIGHEST", "LATEST", "FIRST", "AVERAGE"]).optional(),
  shuffleQuestions: z.boolean().optional(),
  shuffleOptions: z.boolean().optional(),
  negativeMarking: z.enum(["NONE", "FIXED", "PROPORTIONAL"]).optional(),
  negativeMarkingValue: z.coerce.number().min(0).nullable().optional(),
  passingMarks: z.coerce.number().min(0).nullable().optional(),
  presentation: z.enum(["ONE_PER_PAGE", "ALL_ON_PAGE"]).optional(),
  allowBackwardNavigation: z.boolean().optional(),
  resultReleasePolicy: z
    .enum(["IMMEDIATE", "AFTER_CLOSE", "AFTER_GRADING", "MANUAL"])
    .optional(),
});

const addQuestionSchema = z.object({
  questionId: z.string().uuid(),
  /** Per QUIZ: the same question can be worth two marks here and five there. */
  marks: z.coerce.number().positive().max(100).optional(),
});

/**
 * SRS §9.8 — quiz authoring.
 *
 * Every response here carries the ANSWER KEY, because the person writing a
 * question needs to see which option is right. That is safe for one reason
 * worth stating: §4.5 gives no student key on `question`, `question_bank` or
 * `quiz_answer_key`, and the scope policy denies them those models outright —
 * so none of this is reachable by a student even if a route were mis-guarded.
 */
@Controller()
export class QuizAuthoringController {
  constructor(private readonly authoring: QuizAuthoringService) {}

  // ---------------------------------------------------------------- banks --

  @RequirePermission("question_bank", "create")
  @Post("question-banks")
  createBank(@Body(zodBody(bankSchema)) dto: z.infer<typeof bankSchema>) {
    return this.authoring.createBank(dto);
  }

  @RequirePermission("question_bank", "read")
  @Get("question-banks")
  listBanks(@Query("subjectId") subjectId?: string) {
    return this.authoring.listBanks(subjectId);
  }

  // ------------------------------------------------------------ questions --

  @RequirePermission("question", "create")
  @Post("question-banks/:id/questions")
  addQuestion(
    @Param("id") id: string,
    @Body(zodBody(questionSchema)) dto: z.infer<typeof questionSchema>,
  ) {
    return this.authoring.addQuestion(id, dto);
  }

  /** WITH the answer key — `quiz_answer_key:read`, which no student holds. */
  @RequirePermission("quiz_answer_key", "read")
  @Get("question-banks/:id/questions")
  listQuestions(@Param("id") id: string, @Query("includeRetired") includeRetired?: string) {
    return this.authoring.listQuestions(id, includeRetired === "true");
  }

  /** FR-QIZ-010 — retire, never delete: past attempts refer to it. */
  @RequirePermission("question", "delete")
  @Post("questions/:id/retire")
  @HttpCode(200)
  retireQuestion(@Param("id") id: string) {
    return this.authoring.retireQuestion(id);
  }

  // -------------------------------------------------------------- quizzes --

  @RequirePermission("quiz", "create")
  @Post("quizzes")
  createQuiz(@Body(zodBody(quizSchema)) dto: z.infer<typeof quizSchema>) {
    return this.authoring.createQuiz(dto);
  }

  @RequirePermission("quiz_answer_key", "read")
  @Get("quizzes/:id/detail")
  detail(@Param("id") id: string) {
    return this.authoring.quizDetail(id);
  }

  @RequirePermission("quiz", "update")
  @Post("quizzes/:id/questions")
  addToQuiz(
    @Param("id") id: string,
    @Body(zodBody(addQuestionSchema)) dto: z.infer<typeof addQuestionSchema>,
  ) {
    return this.authoring.addQuestionToQuiz(id, dto.questionId, dto.marks);
  }

  @RequirePermission("quiz", "update")
  @Delete("quizzes/:id/questions/:questionId")
  @HttpCode(200)
  removeFromQuiz(@Param("id") id: string, @Param("questionId") questionId: string) {
    return this.authoring.removeQuestionFromQuiz(id, questionId);
  }

  /** FR-QIZ-020 — refuses an incoherent paper rather than letting a cohort find it. */
  @RequirePermission("quiz", "update")
  @Post("quizzes/:id/publish")
  publish(@Param("id") id: string) {
    return this.authoring.publishQuiz(id);
  }
}
