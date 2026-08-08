import { Module } from "@nestjs/common";
import { AssignmentService } from "./assignment.service";
import { AssessmentController } from "./assessment.controller";

@Module({
  controllers: [AssessmentController],
  providers: [AssignmentService],
  exports: [AssignmentService],
})
export class AssessmentModule {}
