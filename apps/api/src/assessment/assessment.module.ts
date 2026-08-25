import { Module } from "@nestjs/common";
import { AssignmentService } from "./assignment.service";
import { SubmissionFileService } from "./submission-file.service";
import { VoiceBriefService } from "./voice-brief.service";
import { AttachmentService } from "./attachment.service";
import { AssessmentController } from "./assessment.controller";
import { RubricService } from "./rubric.service";
import { RubricController } from "./rubric.controller";
import { ContentModule } from "../content/content.module";

/**
 * ContentModule is imported for StorageRegistry alone. Submissions and lecture
 * video resolve to DIFFERENT providers (ARC-043): video sits in the Institute's
 * Drive by mandate, while coursework belongs in storage the System controls.
 * Sharing the registry keeps that one choice in one place.
 */
@Module({
  imports: [ContentModule],
  controllers: [AssessmentController, RubricController],
  providers: [AttachmentService, VoiceBriefService, AssignmentService, SubmissionFileService, RubricService],
  exports: [AssignmentService],
})
export class AssessmentModule {}
