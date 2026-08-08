import { Injectable, Logger } from "@nestjs/common";
import { AppError } from "@lms/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { getActor } from "../prisma/actor-context";
import { applyLatePenalty, assessLateness, type LatePolicy } from "./late-penalty";

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
  ) {}

  // -------------------------------------------------------------- authoring

  async create(input: CreateAssignmentInput) {
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

        if (input.fileIds?.length) {
          await tx.submissionFile.updateMany({
            where: { id: { in: input.fileIds } },
            data: { submissionId: submission.id },
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
      select: { id: true, sectionSubjectId: true, marksAvailable: true, gradesReleased: true },
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
      return {
        studentId: e.studentId,
        rollNo: e.student.currentRollNo,
        name: e.student.user.fullName,
        submitted: !!sub,
        submittedAt: sub?.submittedAt ?? null,
        isLate: sub?.isLate ?? false,
        version: sub?.version ?? 0,
        fileCount: sub?.files.length ?? 0,
        graded: !!sub?.grade,
        finalMarks: sub?.grade ? Number(sub.grade.finalMarks) : null,
      };
    });

    return {
      assignment: { id: assignment.id, marksAvailable: Number(assignment.marksAvailable), gradesReleased: assignment.gradesReleased },
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

    return { assignmentId, gradesReleased: released };
  }

  /**
   * A student's own view of a submission.
   *
   * BR-ASG-08/09 are enforced by this projection rather than by each caller
   * remembering: internal notes are absent from the returned shape entirely,
   * and an unreleased grade reports as pending rather than leaking the mark.
   */
  async studentView(assignmentId: string) {
    const actor = getActor();
    if (!actor?.studentId) throw new AppError("AUTH_FORBIDDEN");

    const submission = await this.prisma.scoped.assignmentSubmission.findFirst({
      where: { assignmentId, studentId: actor.studentId, isLatest: true },
      include: {
        grade: true,
        files: { select: { id: true, originalFilename: true, sizeBytes: true } },
      },
    });
    if (!submission) return { submitted: false as const };

    const g = submission.grade;
    const isReleased = !!g?.releasedAt;

    return {
      submitted: true as const,
      version: submission.version,
      submittedAt: submission.submittedAt,
      isLate: submission.isLate,
      minutesLate: submission.minutesLate,
      files: submission.files,
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
              rubricScores: g.rubricScores,
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
