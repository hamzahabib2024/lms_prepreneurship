import { Module } from "@nestjs/common";
import { AssignmentService } from "./assignment.service";
import { SubmissionFileService } from "./submission-file.service";
import { VoiceBriefService } from "./voice-brief.service";
import { VoiceFeedbackService } from "./voice-feedback.service";
import { AttachmentService } from "./attachment.service";
import { SubmissionCommentService } from "./submission-comment.service";
import { AssessmentController } from "./assessment.controller";
import { RubricService } from "./rubric.service";
import { RubricController } from "./rubric.controller";
import { ContentModule } from "../content/content.module";
import { NotificationModule } from "../notification/notification.module";

/**
 * ContentModule is imported for StorageRegistry alone. Submissions and lecture
 * video resolve to DIFFERENT providers (ARC-043): video sits in the Institute's
 * Drive by mandate, while coursework belongs in storage the System controls.
 * Sharing the registry keeps that one choice in one place.
 */
@Module({
  // NotificationModule because a comment on somebody's work is only useful if
  // they are told it is there — a teacher's feedback nobody sees is a teacher
  // writing to themselves.
  imports: [ContentModule, NotificationModule],
  controllers: [AssessmentController, RubricController],
  providers: [
    AttachmentService,
    VoiceBriefService,
    VoiceFeedbackService,
    AssignmentService,
    SubmissionFileService,
    SubmissionCommentService,
    RubricService,
  ],
  exports: [AssignmentService],
})
export class AssessmentModule {}
