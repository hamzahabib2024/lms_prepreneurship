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
   * FR-QIZ-023 — the quizzes set for one subject, with the student's standing.
   *
   * `quiz:read`, not `quiz_attempt`: this is the list of work set, and it
   * carries no question data at all — a student browsing has not started an
   * attempt, and shipping the paper early would let them read it off the clock.
   */
  @RequirePermission("quiz", "read")
  @Get("section-subjects/:id/my-quizzes")
  mine(@Param("id") id: string) {
    return this.quiz.listForStudent(id);
  }

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

  /**
   * FR-QIZ-031 — marks for a written answer.
   *
   * `quiz_answer_grade`, not `quiz_attempt`. A student holds
   * `quiz_attempt:update` so they can save answers while sitting the quiz;
   * that must never be the permission that decides what an answer is worth.
   */
  @RequirePermission("quiz_answer_grade", "update")
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
