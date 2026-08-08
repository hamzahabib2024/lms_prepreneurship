import { Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";
import { z } from "zod";
import { QuizService } from "./quiz.service";
import { zodBody } from "../common/zod-validation.pipe";
import { RequirePermission } from "../rbac/permissions.guard";

/** The four response shapes, matching the eight question types. */
const responseSchema = z.union([
  z.object({ selectedOptionIds: z.array(z.string()).max(50) }),
  z.object({ text: z.string().max(50000) }),
  z.object({ value: z.coerce.number() }),
  z.object({ pairs: z.record(z.string(), z.string()) }),
  z.null(),
]);

const saveAnswerSchema = z.object({
  questionId: z.string().uuid(),
  response: responseSchema,
});

const gradeAnswerSchema = z.object({
  marks: z.coerce.number().min(0),
  comment: z.string().trim().max(5000).optional(),
});

/** SRS §9.8 — quiz endpoints. */
@Controller()
export class QuizController {
  constructor(private readonly quiz: QuizService) {}

  /**
   * FR-QIZ-024 — start, or resume an attempt already in progress.
   *
   * The response carries no correct-answer data of any kind: not in a hidden
   * field, not in a comment, nowhere (SEC-AUZ-009, BR-QIZ-07).
   */
  @RequirePermission("quiz_attempt", "create")
  @Post("quizzes/:id/attempts")
  start(@Param("id") id: string) {
    return this.quiz.startOrResume(id);
  }

  /** FR-QIZ-026 — auto-save, so a dropped connection costs nothing. */
  @RequirePermission("quiz_attempt", "update")
  @Patch("attempts/:id/answers")
  save(@Param("id") id: string, @Body(zodBody(saveAnswerSchema)) dto: z.infer<typeof saveAnswerSchema>) {
    return this.quiz.saveAnswer(id, dto.questionId, dto.response);
  }

  @RequirePermission("quiz_attempt", "update")
  @Post("attempts/:id/submit")
  submit(@Param("id") id: string) {
    return this.quiz.submit(id);
  }

  /** FR-QIZ-021/022 — gated by the release and answer-review policies. */
  @RequirePermission("quiz_attempt", "read")
  @Get("attempts/:id/result")
  result(@Param("id") id: string) {
    return this.quiz.attemptResult(id);
  }

  @RequirePermission("quiz_attempt", "update")
  @Post("quiz-answers/:id/grade")
  grade(@Param("id") id: string, @Body(zodBody(gradeAnswerSchema)) dto: z.infer<typeof gradeAnswerSchema>) {
    return this.quiz.gradeAnswer(id, dto.marks, dto.comment);
  }

  @RequirePermission("quiz_attempt", "read")
  @Get("quizzes/:quizId/students/:studentId/score")
  recorded(@Param("quizId") quizId: string, @Param("studentId") studentId: string) {
    return this.quiz.recordedScore(quizId, studentId);
  }
}
