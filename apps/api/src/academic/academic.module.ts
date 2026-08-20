import { Module } from "@nestjs/common";
import { AcademicService } from "./academic.service";
import { CourseBuilderService } from "./course-builder.service";
import { StudentNoteService } from "./student-note.service";
import { AssignmentService } from "./assignment.service";
import { EnrolmentService } from "./enrolment.service";
import { AcademicController } from "./academic.controller";
import { AdmissionModule } from "../admission/admission.module";

// AdmissionModule is imported for RegistrationNumberService: transfer needs
// the same locked, lowest-unused roll number allocation that approval uses
// (FR-REG-058), and duplicating it would let the two drift apart.
@Module({
  imports: [AdmissionModule],
  controllers: [AcademicController],
  providers: [AcademicService, CourseBuilderService, StudentNoteService, AssignmentService, EnrolmentService],
  exports: [AcademicService, StudentNoteService, EnrolmentService],
})
export class AcademicModule {}
