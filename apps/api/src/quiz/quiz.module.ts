import { Module } from "@nestjs/common";
import { QuizService } from "./quiz.service";
import { QuizAuthoringService } from "./quiz-authoring.service";
import { QuizAuthoringController } from "./quiz-authoring.controller";
import { QuizController } from "./quiz.controller";

@Module({
  controllers: [QuizController, QuizAuthoringController],
  providers: [QuizService, QuizAuthoringService],
  exports: [QuizService],
})
export class QuizModule {}
