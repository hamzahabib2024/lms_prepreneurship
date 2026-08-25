import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from "@nestjs/common";
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
  quickBatchCreateSchema,
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
  type QuickBatchCreateInput,
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
import { CourseBuilderService } from "./course-builder.service";
import { RemovalService } from "./removal.service";
import { assertOwnStudent } from "../rbac/ownership";

/** SRS §9.5 — academic structure and enrolment endpoints. */
@Controller()
export class AcademicController {
  constructor(
    private readonly academic: AcademicService,
    private readonly builder: CourseBuilderService,
    private readonly assignments: AssignmentService,
    private readonly enrolments: EnrolmentService,
    private readonly notes: StudentNoteService,
    private readonly removal: RemovalService,
  ) {}

  // ----------------------------------------------------------- programmes --

  @RequirePermission("programme", "read")
  @Get("programmes")
  listProgrammes() {
    return this.academic.listProgrammes();
  }

  /**
   * THE WHOLE COURSE, as an administrator pictures it — FR-CRS-004.
   *
   * Subjects, batches, seats and terms in one response, with the two middle
   * layers of the real hierarchy flattened away. `programme:read`, which every
   * role holds at its own scope, because this is what the Courses screen is.
   */
  @RequirePermission("programme", "read")
  @Get("course-tree")
  courseTree(@Query("programmeId") programmeId?: string) {
    return this.builder.courseTree(programmeId);
  }

  /**
   * Add a batch to a course, and whatever it needs above it — FR-CRS-011.
   *
   * `section:create`, because a batch IS a section. It is a different route
   * rather than a different guard: the same authority, asked for in the shape
   * somebody actually has the answers in.
   */
  @RequirePermission("section", "create")
  @Post("course-batches")
  createCourseBatch(@Body(zodBody(quickBatchCreateSchema)) dto: QuickBatchCreateInput) {
    return this.builder.createBatch(dto);
  }

  /**
   * FR-CRS-004 — which subjects a COURSE teaches. Its syllabus.
   *
   * `programme:update`, not `section_subject`: this changes what the course IS,
   * which is a decision about the Institute's offering. It touches no batch —
   * a running batch keeps teaching exactly what it was teaching, because its
   * register and its coursework hang off its own rows.
   */
  @RequirePermission("programme", "update")
  @Put("programmes/:id/subjects")
  setProgrammeSubjects(@Param("id") id: string, @Body() body: { subjectIds?: string[] }) {
    return this.builder.setProgrammeSubjects(id, body.subjectIds ?? []);
  }

  /** FR-CRS-016 — which subjects one BATCH actually teaches. */
  @RequirePermission("section_subject", "create")
  @Put("course-batches/:id/subjects")
  setBatchSubjects(@Param("id") id: string, @Body() body: { subjectIds?: string[] }) {
    return this.builder.setBatchSubjects(id, body.subjectIds ?? []);
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

  /**
   * Remove a subject from the Institute's catalogue.
   *
   * Refused while any class teaches it, or while it has course material —
   * a subject deleted out from under a module leaves lessons pointing at
   * nothing, which is worse than the duplicate somebody was trying to tidy.
   */
  @RequirePermission("subject", "delete")
  @Delete("subjects/:id")
  @HttpCode(200)
  deleteSubject(@Param("id") id: string) {
    return this.removal.removeSubject(id);
  }

  /**
   * Erase a subject for good — the row, not a `deletedAt` stamp.
   *
   * A separate path rather than a flag on the one above, deliberately. A
   * query parameter is something a caller adds by accident; a different
   * address is something they mean.
   */
  @RequirePermission("subject", "delete")
  @Delete("subjects/:id/permanent")
  @HttpCode(200)
  purgeSubject(@Param("id") id: string) {
    return this.removal.purgeSubject(id);
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

  /**
   * Remove a batch. Refused while it holds any section — the students and the
   * marks are down there, not here, so an empty-looking batch is not empty.
   */
  @RequirePermission("batch", "delete")
  @Delete("batches/:id")
  @HttpCode(200)
  deleteBatch(@Param("id") id: string) {
    return this.removal.removeBatch(id);
  }

  /** Erase a batch for good. Works on one already deleted. */
  @RequirePermission("batch", "delete")
  @Delete("batches/:id/permanent")
  @HttpCode(200)
  purgeBatch(@Param("id") id: string) {
    return this.removal.purgeBatch(id);
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
   * FR-CRS-013 — archive is what a section that has been TAUGHT gets. It
   * leaves every list an administrator works in while keeping the attendance
   * and the marks, which outlive the section itself (BR-DAT-04).
   *
   * The DELETE below is the other half of the same rule, not a contradiction
   * of it: a section created by mistake and never used has nothing to keep.
   */
  @RequirePermission("section", "update")
  @Post("sections/:id/archive")
  archiveSection(@Param("id") id: string) {
    return this.academic.archiveSection(id);
  }

  /**
   * Remove a section that was created by mistake — FR-CRS-013.
   *
   * Refused, by name, the moment anything depends on it: a student in it, an
   * admission pointing at it, a subject on it. The office is told which, and
   * told to archive instead where that is the right answer.
   */
  @RequirePermission("section", "delete")
  @Delete("sections/:id")
  @HttpCode(200)
  deleteSection(@Param("id") id: string) {
    return this.removal.removeSection(id);
  }

  /**
   * Erase a section for good.
   *
   * Counts records the soft delete does not: a DELETED assignment is invisible
   * but its row still holds a foreign key, so a section that looks clear on
   * screen can still be firmly held in the database.
   */
  @RequirePermission("section", "delete")
  @Delete("sections/:id/permanent")
  @HttpCode(200)
  purgeSection(@Param("id") id: string) {
    return this.removal.purgeSection(id);
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

  /**
   * Take one subject off one class — "remove Maths from the evening group".
   *
   * Addressed by the OFFERING'S OWN ID rather than by section and subject
   * together: that id is what the whole model hangs off (BR-CNT-03), it is
   * what every screen already holds, and a two-part address would let a
   * caller name a pair that does not exist and get a confusing 404.
   *
   * The teacher's posting to the class goes with it. Everything else — a
   * register, an assignment, a certificate — refuses the removal instead.
   */
  @RequirePermission("section_subject", "delete")
  @Delete("section-subjects/:id")
  @HttpCode(200)
  deleteOffering(@Param("id") id: string) {
    return this.removal.removeSectionSubject(id);
  }

  /** Erase one subject's place on one class for good. */
  @RequirePermission("section_subject", "delete")
  @Delete("section-subjects/:id/permanent")
  @HttpCode(200)
  purgeOffering(@Param("id") id: string) {
    return this.removal.purgeSectionSubject(id);
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
