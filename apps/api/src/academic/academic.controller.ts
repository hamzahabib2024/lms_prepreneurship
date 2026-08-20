import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import {
  academicSessionCreateSchema,
  academicSessionUpdateSchema,
  assignmentCreateSchema,
  assignmentEndSchema,
  batchCreateSchema,
  batchUpdateSchema,
  noteCreateSchema,
  noteUpdateSchema,
  offeringCreateSchema,
  programmeCreateSchema,
  programmeUpdateSchema,
  sectionCreateSchema,
  sectionUpdateSchema,
  subjectCreateSchema,
  subjectUpdateSchema,
  suspendSchema,
  transferSchema,
  reinstateSchema,
  withdrawSchema,
  type AcademicSessionCreateInput,
  type AcademicSessionUpdateInput,
  type AssignmentCreateInput,
  type BatchCreateInput,
  type BatchUpdateInput,
  type NoteCreateInput,
  type NoteUpdateInput,
  type OfferingCreateInput,
  type ProgrammeCreateInput,
  type ProgrammeUpdateInput,
  type SectionCreateInput,
  type SectionUpdateInput,
  type SubjectCreateInput,
  type SubjectUpdateInput,
  type TransferInput,
} from "@lms/shared";
import { AcademicService } from "./academic.service";
import { StudentNoteService } from "./student-note.service";
import { AssignmentService } from "./assignment.service";
import { EnrolmentService } from "./enrolment.service";
import { zodBody } from "../common/zod-validation.pipe";
import { RequirePermission } from "../rbac/permissions.guard";
import { assertOwnStudent } from "../rbac/ownership";

/** SRS §9.5 — academic structure and enrolment endpoints. */
@Controller()
export class AcademicController {
  constructor(
    private readonly academic: AcademicService,
    private readonly assignments: AssignmentService,
    private readonly enrolments: EnrolmentService,
    private readonly notes: StudentNoteService,
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

  /** FR-CRS-004. The code is not editable — see the schema for why. */
  @RequirePermission("programme", "update")
  @Patch("programmes/:id")
  updateProgramme(
    @Param("id") id: string,
    @Body(zodBody(programmeUpdateSchema)) dto: ProgrammeUpdateInput,
  ) {
    return this.academic.updateProgramme(id, dto);
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

  @RequirePermission("subject", "update")
  @Patch("subjects/:id")
  updateSubject(
    @Param("id") id: string,
    @Body(zodBody(subjectUpdateSchema)) dto: SubjectUpdateInput,
  ) {
    return this.academic.updateSubject(id, dto);
  }

  // ------------------------------------------------- sessions and batches --

  @RequirePermission("academic_session", "read")
  @Get("academic-sessions")
  listSessions(@Query("programmeId") programmeId?: string, @Query("status") status?: string) {
    return this.academic.listSessions({ programmeId, status });
  }

  @RequirePermission("academic_session", "create")
  @Post("academic-sessions")
  createSession(@Body(zodBody(academicSessionCreateSchema)) dto: AcademicSessionCreateInput) {
    return this.academic.createSession(dto);
  }

  @RequirePermission("academic_session", "update")
  @Patch("academic-sessions/:id")
  updateSession(
    @Param("id") id: string,
    @Body(zodBody(academicSessionUpdateSchema)) dto: AcademicSessionUpdateInput,
  ) {
    return this.academic.updateSession(id, dto);
  }

  @RequirePermission("batch", "read")
  @Get("batches")
  listBatches(@Query("academicSessionId") academicSessionId?: string) {
    return this.academic.listBatches({ academicSessionId });
  }

  @RequirePermission("batch", "create")
  @Post("batches")
  createBatch(@Body(zodBody(batchCreateSchema)) dto: BatchCreateInput) {
    return this.academic.createBatch(dto);
  }

  @RequirePermission("batch", "update")
  @Patch("batches/:id")
  updateBatch(
    @Param("id") id: string,
    @Body(zodBody(batchUpdateSchema)) dto: BatchUpdateInput,
  ) {
    return this.academic.updateBatch(id, dto);
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

  // -------------------------------------------------------------- notes ----

  /**
   * FR-REG-046. `internal_note` — §4.5 grants Super Admin and Admin `read`,
   * a Teacher FULL over ASSIGNED scope, and a STUDENT NOTHING.
   *
   * There is deliberately no "my notes" route for a student to call. The
   * absence is the feature: a pastoral note is written so staff can help
   * someone, and is the text that does harm if its subject reads it.
   */
  @RequirePermission("internal_note", "read")
  @Get("students/:id/notes")
  listNotes(@Param("id") id: string) {
    return this.notes.list(id);
  }

  @RequirePermission("internal_note", "create")
  @Post("students/:id/notes")
  createNote(@Param("id") id: string, @Body(zodBody(noteCreateSchema)) dto: NoteCreateInput) {
    return this.notes.create(id, dto);
  }

  @RequirePermission("internal_note", "update")
  @Patch("student-notes/:noteId")
  updateNote(
    @Param("noteId") noteId: string,
    @Body(zodBody(noteUpdateSchema)) dto: NoteUpdateInput,
  ) {
    return this.notes.update(noteId, dto.body);
  }

  @RequirePermission("internal_note", "delete")
  @Delete("student-notes/:noteId")
  deleteNote(@Param("noteId") noteId: string) {
    return this.notes.remove(noteId);
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
    assertOwnStudent(id); // SEC-AUZ-004
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
