import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import {
  assignmentCreateSchema,
  assignmentEndSchema,
  offeringCreateSchema,
  programmeCreateSchema,
  sectionCreateSchema,
  sectionUpdateSchema,
  subjectCreateSchema,
  suspendSchema,
  transferSchema,
  reinstateSchema,
  withdrawSchema,
  type AssignmentCreateInput,
  type OfferingCreateInput,
  type ProgrammeCreateInput,
  type SectionCreateInput,
  type SectionUpdateInput,
  type SubjectCreateInput,
  type TransferInput,
} from "@lms/shared";
import { AcademicService } from "./academic.service";
import { AssignmentService } from "./assignment.service";
import { EnrolmentService } from "./enrolment.service";
import { zodBody } from "../common/zod-validation.pipe";
import { RequirePermission } from "../rbac/permissions.guard";

/** SRS §9.5 — academic structure and enrolment endpoints. */
@Controller()
export class AcademicController {
  constructor(
    private readonly academic: AcademicService,
    private readonly assignments: AssignmentService,
    private readonly enrolments: EnrolmentService,
  ) {}

  // ----------------------------------------------------------- programmes --

  @RequirePermission("programme", "read")
  @Get("programmes")
  listProgrammes() {
    return this.academic.listProgrammes();
  }

  @RequirePermission("programme", "create")
  @Post("programmes")
  createProgramme(@Body(zodBody(programmeCreateSchema)) dto: ProgrammeCreateInput) {
    return this.academic.createProgramme(dto);
  }

  // ------------------------------------------------------------- subjects --

  @RequirePermission("subject", "read")
  @Get("subjects")
  listSubjects() {
    return this.academic.listSubjects();
  }

  /** FR-CRS-015 — an Admin creates a subject without a deployment. */
  @RequirePermission("subject", "create")
  @Post("subjects")
  createSubject(@Body(zodBody(subjectCreateSchema)) dto: SubjectCreateInput) {
    return this.academic.createSubject(dto);
  }

  // ------------------------------------------------------------- sections --

  @RequirePermission("section", "read")
  @Get("sections")
  listSections(
    @Query("batchId") batchId?: string,
    @Query("status") status?: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
  ) {
    return this.academic.listSections({
      batchId,
      status,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @RequirePermission("section", "create")
  @Post("sections")
  createSection(@Body(zodBody(sectionCreateSchema)) dto: SectionCreateInput) {
    return this.academic.createSection(dto);
  }

  @RequirePermission("section", "update")
  @Patch("sections/:id")
  updateSection(
    @Param("id") id: string,
    @Body(zodBody(sectionUpdateSchema)) dto: SectionUpdateInput,
  ) {
    return this.academic.updateSection(id, dto);
  }

  /**
   * FR-CRS-013 — archive, never delete. A section that has ever had an
   * enrolment cannot be removed (BR-DAT-04), so there is deliberately no
   * DELETE route here.
   */
  @RequirePermission("section", "update")
  @Post("sections/:id/archive")
  archiveSection(@Param("id") id: string) {
    return this.academic.archiveSection(id);
  }

  @RequirePermission("section", "read")
  @Get("sections/:id/roster")
  roster(@Param("id") id: string) {
    return this.enrolments.roster(id);
  }

  // ------------------------------------------------------------ offerings --

  @RequirePermission("section_subject", "read")
  @Get("sections/:id/subjects")
  listOfferings(@Param("id") id: string) {
    return this.academic.listOfferings(id);
  }

  @RequirePermission("section_subject", "create")
  @Post("sections/:id/subjects")
  offerSubject(
    @Param("id") id: string,
    @Body(zodBody(offeringCreateSchema)) dto: OfferingCreateInput,
  ) {
    return this.academic.offerSubject(id, dto);
  }

  // ---------------------------------------------------------- assignments --

  @RequirePermission("teacher_assignment", "read")
  @Get("teachers/workload")
  workload() {
    return this.assignments.workload();
  }

  @RequirePermission("teacher_assignment", "read")
  @Get("teachers/:id/assignments")
  listAssignments(@Param("id") id: string) {
    return this.assignments.listForTeacher(id);
  }

  /**
   * FR-CRS-021. This grants ASSIGNED scope, so it is Admin-only and audited.
   * A teacher cannot write their own assignment (BR-ACC-04) — the §4.5 matrix
   * grants them `read` on this resource and nothing more.
   */
  @RequirePermission("teacher_assignment", "create")
  @Post("teacher-assignments")
  createAssignment(@Body(zodBody(assignmentCreateSchema)) dto: AssignmentCreateInput) {
    return this.assignments.create(dto);
  }

  /** FR-CRS-023 — ends the assignment and revokes scope on the next request. */
  @RequirePermission("teacher_assignment", "delete")
  @Post("teacher-assignments/:id/end")
  endAssignment(
    @Param("id") id: string,
    @Body(zodBody(assignmentEndSchema)) dto: { endDate?: Date; reason?: string },
  ) {
    return this.assignments.end(id, dto.endDate, dto.reason);
  }

  // ------------------------------------------------------------ enrolment --

  @RequirePermission("enrolment", "read")
  @Get("students/:id/enrolments")
  history(@Param("id") id: string) {
    return this.enrolments.history(id);
  }

  @RequirePermission("enrolment", "update")
  @Post("students/:id/transfer")
  transfer(@Param("id") id: string, @Body(zodBody(transferSchema)) dto: TransferInput) {
    return this.enrolments.transfer(id, dto);
  }

  @RequirePermission("account_state", "update")
  @Post("students/:id/suspend")
  suspend(@Param("id") id: string, @Body(zodBody(suspendSchema)) dto: { reason: string }) {
    return this.enrolments.suspend(id, dto.reason);
  }

  @RequirePermission("account_state", "update")
  @Post("students/:id/withdraw")
  withdraw(@Param("id") id: string, @Body(zodBody(withdrawSchema)) dto: { reason: string }) {
    return this.enrolments.withdraw(id, dto.reason);
  }

  @RequirePermission("account_state", "update")
  @Post("students/:id/reinstate")
  reinstate(@Param("id") id: string, @Body(zodBody(reinstateSchema)) dto: { reason?: string }) {
    return this.enrolments.reinstate(id, dto.reason);
  }
}
