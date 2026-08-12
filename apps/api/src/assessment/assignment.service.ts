import { Injectable, Logger } from "@nestjs/common";
import { AppError } from "@lms/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { getActor } from "../prisma/actor-context";
import { applyLatePenalty, assessLateness, type LatePolicy } from "./late-penalty";
import { forStudent, validateScores } from "./rubric-scoring";
import { NotificationService } from "../notification/notification.service";
import { assertOwnsSectionSubject } from "../rbac/ownership";

export interface CreateAssignmentInput {
  sectionSubjectId: string;
  lessonId?: string;
  title: string;
  instructions: string;
  marksAvailable: number;
  opensAt: Date;
  dueAt: Date;
  hardCloseAt?: Date;
  graceMinutes?: number;
  latePolicy?: LatePolicy;
  latePenaltyValue?: number;
  latePenaltyFloor?: number;
  submissionType?: "FILE" | "TEXT" | "BOTH";
  allowedFileTypes?: string[];
  maxFileSizeMb?: number;
  maxFileCount?: number;
  resubmissionPolicy?: "NONE" | "UNLIMITED_UNTIL_DUE" | "LIMITED";
  maxAttempts?: number;
  rubricId?: string;
}

export interface GradeInput {
  rawMarks: number;
  rubricScores?: Record<string, number>;
  feedback?: string;
  internalNotes?: string;
  revisionReason?: string;
}

/** Appendix H — the institute-wide ceiling. A teacher may narrow it, never widen it. */
const INSTITUTE_FILE_TYPES = [
  "pdf", "docx", "doc", "pptx", "ppt", "xlsx",
  "jpg", "jpeg", "png", "mp3", "zip", "txt",
];
const INSTITUTE_MAX_MB = 10;
const INSTITUTE_MAX_FILES = 5;

/**
 * Assignments — SRS §5.9.
 *
 * Two rules shape almost everything here. Grades are invisible to students
 * until explicitly released (BR-ASG-09), so no student sees a mark before the
 * rest of the cohort. And internal grading notes are never visible to a
 * student in any response, export or report (BR-ASG-08) — that is the entire
 * purpose of the field, so it is stripped by a projection rather than by each
 * caller remembering.
 */
@Injectable()
export class AssignmentService {
  private readonly logger = new Logger(AssignmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
  ) {}

  // -------------------------------------------------------------- authoring

  async create(input: CreateAssignmentInput) {
    // The scope predicate does not constrain a create (ARC-051 injects a
    // `where`, and an INSERT has none), so without this a teacher could set
    // homework for another teacher's class — and those students would see it
    // and submit to it.
    assertOwnsSectionSubject(input.sectionSubjectId);

    if (input.dueAt <= input.opensAt) {
      throw new AppError("VALIDATION_FAILED", {
        details: [
          { field: "dueAt", code: "INVALID_RANGE", message: "The deadline must be after the open date." },
        ],
      });
    }
    if (input.hardCloseAt && input.hardCloseAt < input.dueAt) {
      throw new AppError("VALIDATION_FAILED", {
        details: [
          {
            field: "hardCloseAt",
            code: "INVALID_RANGE",
            message: "The hard close cannot be before the deadline.",
          },
        ],
      });
    }

    // FR-ASG-006 — a teacher narrows the institute policy; anything outside it
    // is rejected rather than silently accepted and then failing at upload.
    const requested = (input.allowedFileTypes ?? INSTITUTE_FILE_TYPES).map((t) =>
      t.toLowerCase().replace(/^\./, ""),
    );
    const outside = requested.filter((t) => !INSTITUTE_FILE_TYPES.includes(t));
    if (outside.length > 0) {
      throw new AppError("VALIDATION_FAILED", {
        details: [
          {
            field: "allowedFileTypes",
            code: "OUTSIDE_POLICY",
            message: `These types are not permitted by the institute policy: ${outside.join(", ")}.`,
          },
        ],
      });
    }

    const created = await this.prisma.scoped.assignment.create({
      data: {
        sectionSubjectId: input.sectionSubjectId,
        lessonId: input.lessonId ?? null,
        title: input.title,
        instructions: input.instructions,
        marksAvailable: input.marksAvailable,
        opensAt: input.opensAt,
        dueAt: input.dueAt,
        hardCloseAt: input.hardCloseAt ?? null,
        graceMinutes: input.graceMinutes ?? 0,
        latePolicy: input.latePolicy ?? "FLAG_ONLY",
        latePenaltyValue: input.latePenaltyValue ?? null,
        latePenaltyFloor: input.latePenaltyFloor ?? null,
        submissionType: input.submissionType ?? "FILE",
        allowedFileTypes: requested as object,
        maxFileSizeMb: Math.min(input.maxFileSizeMb ?? INSTITUTE_MAX_MB, INSTITUTE_MAX_MB),
        maxFileCount: Math.min(input.maxFileCount ?? INSTITUTE_MAX_FILES, INSTITUTE_MAX_FILES),
        resubmissionPolicy: input.resubmissionPolicy ?? "NONE",
        maxAttempts: input.maxAttempts ?? null,
        rubricId: input.rubricId ?? null,
        publicationStatus: "DRAFT", // BR-CNT-01
      },
    });

    await this.audit.record({
      action: "assignment.create",
      entityType: "Assignment",
      entityId: created.id,
      after: { title: created.title, dueAt: created.dueAt, marks: input.marksAvailable },
    });
    return created;
  }

  async publish(id: string) {
    const before = await this.prisma.scoped.assignment.findFirst({
      where: { id, deletedAt: null },
    });
    if (!before) throw new AppError("RESOURCE_NOT_FOUND");

    const updated = await this.prisma.scoped.assignment.update({
      where: { id },
      data: { publicationStatus: "PUBLISHED" },
    });

    await this.audit.record({
      action: "assignment.publish",
      entityType: "Assignment",
      entityId: id,
      before: { publicationStatus: before.publicationStatus },
      after: { publicationStatus: "PUBLISHED" },
    });
    return updated;
  }

  // ------------------------------------------------------------- submission

  /**
   * FR-ASG-015..023 — submit.
   *
   * The file bytes are handled by the storage layer; this records the
   * submission and decides lateness. BR-ASG-04: the timestamp is taken HERE,
   * on the server, at the moment the record is written.
   */
  async submit(assignmentId: string, input: { textResponse?: string; fileIds?: string[] }) {
    const actor = getActor();
    if (!actor?.studentId) {
      throw new AppError("AUTH_FORBIDDEN", { message: "Only a student can submit work." });
    }
    const studentId = actor.studentId;

    // Scoped: a student not enrolled in this subject-section cannot see the
    // assignment at all, so this returns nothing rather than leaking it.
    const assignment = await this.prisma.scoped.assignment.findFirst({
      where: { id: assignmentId, deletedAt: null, publicationStatus: "PUBLISHED" },
    });
    if (!assignment) throw new AppError("RESOURCE_NOT_FOUND");

    const now = new Date();
    if (now < assignment.opensAt) {
      throw new AppError("SUBMISSION_WINDOW_CLOSED", {
        message: `This assignment opens on ${assignment.opensAt.toISOString()}.`,
      });
    }

    const extension = await this.prisma.asSystem((db) =>
      db.assignmentExtension.findUnique({
        where: { assignmentId_studentId: { assignmentId, studentId } },
      }),
    );

    const lateness = assessLateness({
      submittedAt: now,
      dueAt: assignment.dueAt,
      graceMinutes: assignment.graceMinutes,
      extendedTo: extension?.extendedTo ?? null,
      hardCloseAt: assignment.hardCloseAt,
    });

    // FR-ASG-020 — the hard close is absolute.
    if (lateness.isAfterHardClose) {
      throw new AppError("SUBMISSION_WINDOW_CLOSED", {
        message: `This assignment closed on ${assignment.hardCloseAt?.toISOString()}.`,
      });
    }
    if (lateness.isLate && assignment.latePolicy === "NOT_ACCEPTED") {
      throw new AppError("SUBMISSION_WINDOW_CLOSED", {
        message: "This assignment does not accept late submissions.",
      });
    }

    return this.prisma.asSystem((db) =>
      db.$transaction(async (tx) => {
        const previous = await tx.assignmentSubmission.findFirst({
          where: { assignmentId, studentId },
          orderBy: { version: "desc" },
        });

        if (previous) {
          // FR-ASG-008 — resubmission policy.
          if (assignment.resubmissionPolicy === "NONE") {
            throw new AppError("RESOURCE_CONFLICT", {
              message: "You have already submitted, and this assignment does not allow changes.",
            });
          }
          if (assignment.resubmissionPolicy === "UNLIMITED_UNTIL_DUE" && lateness.isLate) {
            throw new AppError("SUBMISSION_WINDOW_CLOSED", {
              message: "The deadline has passed, so this submission can no longer be replaced.",
            });
          }
          if (
            assignment.resubmissionPolicy === "LIMITED" &&
            assignment.maxAttempts != null &&
            previous.version >= assignment.maxAttempts
          ) {
            throw new AppError("RESOURCE_CONFLICT", {
              message: `You have used all ${assignment.maxAttempts} submission attempts.`,
            });
          }

          // BR-ASG-07 — the old version is RETAINED, only demoted.
          await tx.assignmentSubmission.updateMany({
            where: { assignmentId, studentId },
            data: { isLatest: false },
          });
        }

        const submission = await tx.assignmentSubmission.create({
          data: {
            assignmentId,
            studentId,
            version: (previous?.version ?? 0) + 1,
            isLatest: true,
            submittedAt: now,
            isLate: lateness.isLate,
            minutesLate: lateness.minutesLate,
            textResponse: input.textResponse ?? null,
          },
        });

        // Attaching the student's OWN unattached files for THIS assignment.
        //
        // This used to be `updateMany({ where: { id: { in: fileIds } } })` on a
        // system-scoped client — no owner check, no assignment check. A student
        // could name a classmate's file id and pull their work into their own
        // submission, which would also REMOVE it from the classmate's, since a
        // file has a single parent. Nothing had ever exercised it because there
        // was no upload endpoint, so no SubmissionFile could exist.
        //
        // The three extra predicates are the fix. `submissionId: null` matters
        // as much as the other two: without it, a student could re-attach a
        // file from their own EARLIER submission and silently rewrite what they
        // handed in before the deadline (BR-ASG-07).
        const attached = input.fileIds?.length
          ? await tx.submissionFile.updateMany({
              where: {
                id: { in: input.fileIds },
                studentId,
                assignmentId,
                submissionId: null,
              },
              data: { submissionId: submission.id },
            })
          : { count: 0 };

        // Refuse rather than submit a subset. A student who selected four files
        // and had two accepted would believe all four were handed in, and would
        // find out when they were marked on half their work.
        if (input.fileIds?.length && attached.count !== input.fileIds.length) {
          throw new AppError("VALIDATION_FAILED", {
            message:
              "Some of those files are no longer available to attach. Reload the page and try again.",
          });
        }

        await this.audit.record(
          {
            action: "assignment.submit",
            entityType: "AssignmentSubmission",
            entityId: submission.id,
            after: {
              assignmentId,
              version: submission.version,
              isLate: lateness.isLate,
              minutesLate: lateness.minutesLate,
            },
          },
          tx as unknown as Parameters<AuditService["record"]>[1],
        );

        // FR-ASG-026 — the student is shown what lateness will cost BEFORE
        // they leave the page, rather than discovering it when graded.
        const preview = lateness.isLate
          ? applyLatePenalty(Number(assignment.marksAvailable), lateness.minutesLate, {
              latePolicy: assignment.latePolicy,
              latePenaltyValue: assignment.latePenaltyValue
                ? Number(assignment.latePenaltyValue)
                : null,
              latePenaltyFloor: assignment.latePenaltyFloor
                ? Number(assignment.latePenaltyFloor)
                : null,
              marksAvailable: Number(assignment.marksAvailable),
            })
          : null;

        return {
          submissionId: submission.id,
          version: submission.version,
          submittedAt: submission.submittedAt,
          isLate: submission.isLate,
          minutesLate: submission.minutesLate,
          latePenaltyPreview: preview
            ? {
                policy: assignment.latePolicy,
                estimatedDeduction: preview.penaltyApplied,
                explanation: preview.explanation,
              }
            : null,
        };
      }),
    );
  }

  // ---------------------------------------------------------------- grading

  /** FR-TCH-019 — who submitted, who did not, who is late, who is ungraded. */
  async submissionStatus(assignmentId: string) {
    const assignment = await this.prisma.scoped.assignment.findFirst({
      where: { id: assignmentId, deletedAt: null },
      select: {
        id: true,
        title: true,
        sectionSubjectId: true,
        marksAvailable: true,
        gradesReleased: true,
        dueAt: true,
        latePolicy: true,
      },
    });
    if (!assignment) throw new AppError("RESOURCE_NOT_FOUND");

    const [enrolled, submissions] = await Promise.all([
      this.prisma.scoped.enrolment.findMany({
        where: { sectionSubjectId: assignment.sectionSubjectId, status: "ACTIVE" },
        include: {
          student: { include: { user: { select: { fullName: true } } } },
        },
      }),
      this.prisma.scoped.assignmentSubmission.findMany({
        where: { assignmentId, isLatest: true },
        include: { grade: true, files: { select: { id: true, originalFilename: true } } },
      }),
    ]);

    const byStudent = new Map(submissions.map((s: (typeof submissions)[number]) => [s.studentId, s]));

    const rows = enrolled.map((e: (typeof enrolled)[number]) => {
      const sub = byStudent.get(e.studentId);
      const g = sub?.grade;
      return {
        studentId: e.studentId,
        rollNo: e.student.currentRollNo,
        name: e.student.user.fullName,
        // The grade endpoint is keyed by submission, so without this a teacher
        // can see who needs marking and has no way to mark them.
        submissionId: sub?.id ?? null,
        submitted: !!sub,
        submittedAt: sub?.submittedAt ?? null,
        isLate: sub?.isLate ?? false,
        minutesLate: sub?.minutesLate ?? 0,
        version: sub?.version ?? 0,
        textResponse: sub?.textResponse ?? null,
        files: (sub?.files ?? []).map((f: { id: string; originalFilename: string }) => ({
          id: f.id,
          filename: f.originalFilename,
        })),
        graded: !!g,
        rawMarks: g ? Number(g.rawMarks) : null,
        penaltyApplied: g ? Number(g.penaltyApplied) : null,
        finalMarks: g ? Number(g.finalMarks) : null,
        feedback: g?.feedback ?? null,
        // §4.5 keeps internal notes from students, and this endpoint is now
        // teacher-and-above only, so they belong here: a second marker needs
        // to see what the first one recorded.
        internalNotes: g?.internalNotes ?? null,
        // BR-ASG-11 — a released grade cannot be changed without a reason, and
        // the interface has to know that before the teacher starts typing.
        releasedAt: g?.releasedAt ?? null,
      };
    });

    return {
      assignment: {
        id: assignment.id,
        title: assignment.title,
        // The class this marking session belongs to. A staff note is anchored
        // to a section-subject (BR-ACC-04), and marking is where a teacher is
        // most likely to have something worth recording about a student.
        sectionSubjectId: assignment.sectionSubjectId,
        marksAvailable: Number(assignment.marksAvailable),
        gradesReleased: assignment.gradesReleased,
        dueAt: assignment.dueAt,
        latePolicy: assignment.latePolicy,
      },
      summary: {
        enrolled: rows.length,
        submitted: rows.filter((r) => r.submitted).length,
        notSubmitted: rows.filter((r) => !r.submitted).length,
        late: rows.filter((r) => r.isLate).length,
        graded: rows.filter((r) => r.graded).length,
        ungraded: rows.filter((r) => r.submitted && !r.graded).length,
      },
      students: rows.sort((a, b) => (a.rollNo ?? 9999) - (b.rollNo ?? 9999)),
    };
  }

  /**
   * FR-TCH-018 — a teacher's assignments for one subject-section, with how much
   * marking each still needs.
   *
   * Counted in two grouped queries rather than by loading every submission:
   * the index needs totals, and pulling the rows to count them would read the
   * whole cohort's work to render a summary.
   */
  async listForTeacher(sectionSubjectId: string) {
    const assignments = await this.prisma.scoped.assignment.findMany({
      where: { sectionSubjectId, deletedAt: null },
      orderBy: { dueAt: "desc" },
    });
    if (assignments.length === 0) return [];

    const ids = assignments.map((a: (typeof assignments)[number]) => a.id);

    const submittedCounts = await this.prisma.scoped.assignmentSubmission.groupBy({
      by: ["assignmentId"],
      where: { assignmentId: { in: ids }, isLatest: true },
      _count: { _all: true },
    });
    const gradedCounts = await this.prisma.scoped.assignmentSubmission.groupBy({
      by: ["assignmentId"],
      where: { assignmentId: { in: ids }, isLatest: true, grade: { isNot: null } },
      _count: { _all: true },
    });

    const submitted = new Map(
      submittedCounts.map((r: (typeof submittedCounts)[number]) => [r.assignmentId, r._count._all]),
    );
    const graded = new Map(
      gradedCounts.map((r: (typeof gradedCounts)[number]) => [r.assignmentId, r._count._all]),
    );

    return assignments.map((a: (typeof assignments)[number]) => {
      const submittedCount = submitted.get(a.id) ?? 0;
      return {
        id: a.id,
        title: a.title,
        dueAt: a.dueAt,
        marksAvailable: Number(a.marksAvailable),
        publicationStatus: a.publicationStatus,
        gradesReleased: a.gradesReleased,
        submittedCount,
        gradedCount: graded.get(a.id) ?? 0,
        // The number that decides what a teacher does next, so it is computed
        // here rather than left to the interface to subtract.
        ungradedCount: submittedCount - (graded.get(a.id) ?? 0),
      };
    });
  }

  /** FR-ASG-025/026 — grade, with the penalty applied by the System. */
  async grade(submissionId: string, input: GradeInput) {
    const actor = getActor();
    if (!actor) throw new AppError("AUTH_TOKEN_INVALID");

    const submission = await this.prisma.scoped.assignmentSubmission.findFirst({
      where: { id: submissionId },
      include: { assignment: true, grade: true },
    });
    if (!submission) throw new AppError("RESOURCE_NOT_FOUND");

    const a = submission.assignment;

    // BR-ASG-11 — changing a RELEASED grade needs a reason, is audited with
    // both values, and the student is notified.
    if (submission.grade?.releasedAt && !input.revisionReason) {
      throw new AppError("VALIDATION_FAILED", {
        details: [
          {
            field: "revisionReason",
            code: "REQUIRED",
            message: "This grade has been released. Record why it is being changed.",
          },
        ],
      });
    }

    // A mark above the maximum is a typo, not an intention.
    //
    // applyLatePenalty clamps to marksAvailable, so nothing over-awards — but
    // it clamps SILENTLY. A teacher who types 55 instead of 5.5 on a 20-mark
    // assignment would see 20/20 recorded and no indication anything was
    // adjusted. Refusing is the only outcome that gets the intended mark into
    // the record (NFR-USE-007).
    if (input.rawMarks > Number(a.marksAvailable)) {
      throw new AppError("VALIDATION_FAILED", {
        details: [
          {
            field: "rawMarks",
            code: "ABOVE_MAXIMUM",
            message: `This assignment is out of ${Number(a.marksAvailable)} marks.`,
          },
        ],
      });
    }

    // FR-ASG-016 — the rubric scores must be a valid marking of THIS rubric.
    //
    // They are stored in a JSON column, so nothing below this line can check
    // them: not the scope predicate, not `select`, not the DMMF-based guards.
    // Until this ran, the endpoint stored whatever `Record<string, number>` it
    // was handed — a score above the criterion maximum, a negative one, or a
    // criterion belonging to an entirely different rubric all went in, and the
    // first anyone knew was a student reading "12 out of 10".
    if (input.rubricScores && Object.keys(input.rubricScores).length > 0) {
      if (!a.rubricId) {
        throw new AppError("VALIDATION_FAILED", {
          details: [
            {
              field: "rubricScores",
              code: "NO_RUBRIC",
              message: "This assignment is not marked against a rubric.",
            },
          ],
        });
      }
      const criteria = await this.prisma.asSystem((db) =>
        db.rubricCriterion.findMany({
          where: { rubricId: a.rubricId as string },
          orderBy: { displayOrder: "asc" },
        }),
      );
      const problems = validateScores(
        criteria.map((c: (typeof criteria)[number]) => ({
          id: c.id,
          name: c.name,
          maxMarks: Number(c.maxMarks),
          displayOrder: c.displayOrder,
          isInternal: c.isInternal,
          description: c.description,
        })),
        input.rubricScores,
      );
      if (problems.length > 0) {
        throw new AppError("VALIDATION_FAILED", {
          details: problems.map((p) => ({
            field: p.criterionId ? `rubricScores.${p.criterionId}` : "rubricScores",
            code: "INVALID",
            message: p.message,
          })),
        });
      }
    }

    // BR-ASG-03 — the System computes the penalty. A teacher entering a
    // reduced figure by hand is unreproducible and indefensible if challenged.
    const penalty = applyLatePenalty(input.rawMarks, submission.minutesLate, {
      latePolicy: a.latePolicy,
      latePenaltyValue: a.latePenaltyValue ? Number(a.latePenaltyValue) : null,
      latePenaltyFloor: a.latePenaltyFloor ? Number(a.latePenaltyFloor) : null,
      marksAvailable: Number(a.marksAvailable),
    });

    const saved = await this.prisma.asSystem((db) =>
      db.$transaction(async (tx) => {
        const grade = await tx.assignmentGrade.upsert({
          where: { submissionId },
          create: {
            submissionId,
            rawMarks: penalty.rawMarks,
            penaltyApplied: penalty.penaltyApplied,
            finalMarks: penalty.finalMarks,
            rubricScores: (input.rubricScores ?? {}) as object,
            feedback: input.feedback ?? null,
            internalNotes: input.internalNotes ?? null,
            gradedBy: actor.userId,
          },
          update: {
            rawMarks: penalty.rawMarks,
            penaltyApplied: penalty.penaltyApplied,
            finalMarks: penalty.finalMarks,
            rubricScores: (input.rubricScores ?? {}) as object,
            feedback: input.feedback ?? null,
            internalNotes: input.internalNotes ?? null,
            gradedBy: actor.userId,
            gradedAt: new Date(),
            revisionReason: input.revisionReason ?? null,
          },
        });

        await this.audit.record(
          {
            action: submission.grade ? "assignment.regrade" : "assignment.grade",
            entityType: "AssignmentGrade",
            entityId: grade.id,
            before: submission.grade
              ? { finalMarks: Number(submission.grade.finalMarks) }
              : undefined,
            after: {
              rawMarks: penalty.rawMarks,
              penaltyApplied: penalty.penaltyApplied,
              finalMarks: penalty.finalMarks,
              revisionReason: input.revisionReason ?? null,
              // internalNotes deliberately NOT audited: the audit log is
              // readable by Admins, and BR-ASG-08 keeps these to the author.
            },
          },
          tx as unknown as Parameters<AuditService["record"]>[1],
        );

        return grade;
      }),
    );

    return { ...this.projectGradeForTeacher(saved), penaltyExplanation: penalty.explanation };
  }

  /** FR-ASG-028 / BR-ASG-09 — release the whole cohort at once. */
  async releaseGrades(assignmentId: string) {
    const assignment = await this.prisma.scoped.assignment.findFirst({
      where: { id: assignmentId, deletedAt: null },
    });
    if (!assignment) throw new AppError("RESOURCE_NOT_FOUND");

    const released = await this.prisma.asSystem((db) =>
      db.$transaction(async (tx) => {
        const now = new Date();
        const subs = await tx.assignmentSubmission.findMany({
          where: { assignmentId, isLatest: true },
          select: { id: true },
        });
        const { count } = await tx.assignmentGrade.updateMany({
          where: { submissionId: { in: subs.map((s) => s.id) }, releasedAt: null },
          data: { releasedAt: now },
        });
        await tx.assignment.update({
          where: { id: assignmentId },
          data: { gradesReleased: true, gradesReleasedAt: now },
        });

        await this.audit.record(
          {
            action: "assignment.release_grades",
            entityType: "Assignment",
            entityId: assignmentId,
            after: { gradesReleased: true, released: count },
          },
          tx as unknown as Parameters<AuditService["record"]>[1],
        );

        return count;
      }),
    );

    // DEP-04 — the students whose marks just became visible are told.
    //
    // AFTER the transaction, not inside it: a notification is a consequence of
    // the release, and a messaging failure must not roll back grades that are
    // already released. The inbox copy is written regardless of any channel.
    if (released > 0) {
      const recipients = await this.prisma.asSystem((db) =>
        db.assignmentSubmission.findMany({
          where: { assignmentId, isLatest: true, grade: { releasedAt: { not: null } } },
          select: { student: { select: { userId: true } } },
        }),
      );

      await this.notifications.notify({
        recipientUserIds: recipients.map(
          (r: { student: { userId: string } }) => r.student.userId,
        ),
        kind: "grade.released",
        title: `Your mark for "${assignment.title}" is available`,
        // No mark in the message. A grade is between a student and the
        // Institute, and a WhatsApp preview on a shared phone is not the place
        // for it (SEC-PRV).
        body: "Your teacher has released the marks for this assignment.",
        linkPath: "/subjects",
      });
    }

    return { assignmentId, gradesReleased: released };
  }

  /**
   * A student's own view of a submission.
   *
   * BR-ASG-08/09 are enforced by this projection rather than by each caller
   * remembering: internal notes are absent from the returned shape entirely,
   * and an unreleased grade reports as pending rather than leaking the mark.
   */
  /**
   * FR-ASG-011 — every assignment in one subject, with this student's standing
   * in each.
   *
   * One query for the assignments and one for the submissions, rather than a
   * submission lookup per row. A subject with twenty assignments would
   * otherwise issue twenty-one queries to render one page.
   *
   * The scope policy restricts this to PUBLISHED assignments in the student's
   * own sections, so nothing here filters on publication status.
   */
  async listForStudent(sectionSubjectId: string) {
    const actor = getActor();
    if (!actor?.studentId) {
      throw new AppError("AUTH_FORBIDDEN", {
        message: "This view is for students. Your account is not a student account.",
      });
    }
    const studentId = actor.studentId;

    const assignments = await this.prisma.scoped.assignment.findMany({
      where: { sectionSubjectId, deletedAt: null },
      orderBy: { dueAt: "asc" },
    });
    if (assignments.length === 0) return [];

    const submissions = await this.prisma.scoped.assignmentSubmission.findMany({
      where: { studentId, assignmentId: { in: assignments.map((a) => a.id) }, isLatest: true },
      include: { grade: true, files: { select: { id: true } } },
    });
    const byAssignment = new Map(
      submissions.map((s: (typeof submissions)[number]) => [s.assignmentId, s]),
    );

    const extensions = await this.prisma.scoped.assignmentExtension.findMany({
      where: { studentId, assignmentId: { in: assignments.map((a) => a.id) } },
    });
    const extensionFor = new Map(
      extensions.map((e: (typeof extensions)[number]) => [e.assignmentId, e.extendedTo]),
    );

    const now = new Date();

    return assignments.map((a: (typeof assignments)[number]) => {
      const submission = byAssignment.get(a.id);
      const extendedTo = extensionFor.get(a.id) ?? null;
      const effectiveDue = extendedTo ?? a.dueAt;
      const grade = submission?.grade;

      return {
        id: a.id,
        title: a.title,
        instructions: a.instructions,
        marksAvailable: Number(a.marksAvailable),
        opensAt: a.opensAt,
        dueAt: a.dueAt,
        // FR-ASG-018 — a personal extension replaces the deadline the student
        // is shown. Displaying the cohort deadline to someone who has been
        // granted longer is simply wrong information.
        extendedTo,
        hardCloseAt: a.hardCloseAt,
        submissionType: a.submissionType,
        allowedFileTypes: a.allowedFileTypes,
        maxFileSizeMb: a.maxFileSizeMb,
        maxFileCount: a.maxFileCount,
        resubmissionPolicy: a.resubmissionPolicy,
        latePolicy: a.latePolicy,

        isOpen: now >= a.opensAt && (!a.hardCloseAt || now <= a.hardCloseAt),
        isOverdue: now > effectiveDue,

        submitted: submission != null,
        submittedAt: submission?.submittedAt ?? null,
        version: submission?.version ?? 0,
        wasLate: submission?.isLate ?? false,
        fileCount: submission?.files.length ?? 0,

        // BR-ASG-09 — a mark does not exist for the student until released.
        //
        // releasedAt is checked HERE, explicitly. The AssignmentGrade scope
        // policy does withhold unreleased grades, but it does NOT apply to a
        // nested `include` — the extension rewrites the where of the model
        // being queried, and a relation loaded alongside it never passes
        // through the child model's policy. Relying on the predicate here
        // leaked every unreleased mark to its student.
        grade:
          grade?.releasedAt != null
            ? {
                status: "RELEASED" as const,
                finalMarks: Number(grade.finalMarks),
                penaltyApplied: Number(grade.penaltyApplied),
              }
            : submission
              ? { status: "AWAITING_GRADE" as const }
              : { status: "NOT_SUBMITTED" as const },
      };
    });
  }

  async studentView(assignmentId: string) {
    const actor = getActor();
    if (!actor?.studentId) throw new AppError("AUTH_FORBIDDEN");

    const submission = await this.prisma.scoped.assignmentSubmission.findFirst({
      where: { assignmentId, studentId: actor.studentId, isLatest: true },
      include: {
        grade: true,
        files: { select: { id: true, originalFilename: true, sizeBytes: true } },
        // The criteria are loaded so they can be REMOVED. forStudent needs the
        // internal ones to know which rows to drop and whether the remaining
        // account is complete; they are stripped before anything is returned.
        assignment: {
          select: { rubric: { select: { criteria: { orderBy: { displayOrder: "asc" } } } } },
        },
      },
    });
    if (!submission) return { submitted: false as const };

    const g = submission.grade;
    const isReleased = !!g?.releasedAt;
    const criteria = (submission.assignment.rubric?.criteria ?? []).map(
      (c: { id: string; name: string; maxMarks: unknown; displayOrder: number; isInternal: boolean; description: string | null }) => ({
        id: c.id,
        name: c.name,
        maxMarks: Number(c.maxMarks),
        displayOrder: c.displayOrder,
        isInternal: c.isInternal,
        description: c.description,
      }),
    );

    return {
      submitted: true as const,
      version: submission.version,
      submittedAt: submission.submittedAt,
      isLate: submission.isLate,
      minutesLate: submission.minutesLate,
      // sizeBytes is a BigInt, which JSON.stringify throws on rather than
      // coercing. This returned raw rows and 500'd the moment a submission
      // actually had a file — invisible until now, because nothing could
      // create one.
      files: submission.files.map((f: (typeof submission.files)[number]) => ({
        id: f.id,
        filename: f.originalFilename,
        sizeBytes: Number(f.sizeBytes),
      })),
      grade: !g
        ? { status: "NOT_YET_GRADED" as const }
        : !isReleased
          ? // The student is TOLD grading is in progress rather than shown a
            // blank that looks like a zero.
            { status: "GRADING_IN_PROGRESS" as const }
          : {
              status: "RELEASED" as const,
              rawMarks: Number(g.rawMarks),
              penaltyApplied: Number(g.penaltyApplied),
              finalMarks: Number(g.finalMarks),
              feedback: g.feedback,
              // FR-ASG-014 — the breakdown, WITHOUT the internal criteria.
              //
              // This handed back `g.rubricScores` verbatim. It is a JSON
              // column, so the whole blob went out: every internal criterion's
              // id and its mark, for a student to read in the network tab. A
              // criterion is marked internal precisely because it records
              // something the student must not see — a moderation adjustment, a
              // plagiarism weighting, a marker's confidence.
              //
              // Nothing structural could have caught this. Scope filters rows,
              // `select` narrows columns, and the DMMF guards read the schema;
              // to all three this field is one opaque value.
              rubric: forStudent(criteria, (g.rubricScores ?? {}) as Record<string, number>),
              releasedAt: g.releasedAt,
              // internalNotes is absent by construction — there is no branch
              // in this method that can emit it.
            },
    };
  }

  private projectGradeForTeacher(g: {
    id: string;
    rawMarks: unknown;
    penaltyApplied: unknown;
    finalMarks: unknown;
    feedback: string | null;
    internalNotes: string | null;
    releasedAt: Date | null;
  }) {
    return {
      id: g.id,
      rawMarks: Number(g.rawMarks),
      penaltyApplied: Number(g.penaltyApplied),
      finalMarks: Number(g.finalMarks),
      feedback: g.feedback,
      internalNotes: g.internalNotes, // teacher-only surface
      releasedAt: g.releasedAt,
    };
  }
}
