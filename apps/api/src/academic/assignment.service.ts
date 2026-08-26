import { Injectable, Logger } from "@nestjs/common";
import { AppError, type AssignmentCreateInput } from "@lms/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { ActorService } from "../auth/actor.service";

/**
 * Teacher assignment — SRS §5.3.4.
 *
 * BR-ACC-04: this is the SOLE source of ASSIGNED scope. A teacher's authority
 * follows the assignment to a subject WITHIN a section, never to the subject
 * alone — a teacher assigned to Digital Marketing in Section A has no
 * authority over Digital Marketing in Section B.
 *
 * Every write here therefore changes what somebody can see, which is why each
 * one invalidates the scope cache synchronously (ARC-047, SEC-SES-009). A
 * revoked assignment that keeps working for fifteen minutes is a live
 * authorisation bug, not a caching inconvenience.
 */
@Injectable()
export class AssignmentService {
  private readonly logger = new Logger(AssignmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly actors: ActorService,
  ) {}

  async create(input: AssignmentCreateInput) {
    const [teacher, offering] = await Promise.all([
      this.prisma.scoped.teacher.findFirst({
        where: { id: input.teacherId, deletedAt: null },
        include: { user: { select: { id: true, fullName: true, status: true } } },
      }),
      this.prisma.scoped.sectionSubject.findFirst({
        where: { id: input.sectionSubjectId, deletedAt: null },
        include: {
          section: { select: { id: true, code: true, name: true } },
          subject: { select: { id: true, code: true, name: true } },
        },
      }),
    ]);

    if (!teacher) {
      throw new AppError("VALIDATION_FAILED", {
        details: [
          { field: "teacherId", code: "NOT_FOUND", message: "That teacher does not exist." },
        ],
      });
    }
    if (!offering) {
      throw new AppError("VALIDATION_FAILED", {
        details: [
          {
            field: "sectionSubjectId",
            code: "NOT_FOUND",
            message: "That subject is not offered to that batch.",
          },
        ],
      });
    }
    if (teacher.user.status !== "ACTIVE" && teacher.user.status !== "INVITED") {
      throw new AppError("RESOURCE_CONFLICT", {
        message: `${teacher.user.fullName}'s account is ${teacher.user.status.toLowerCase()} and cannot be assigned.`,
      });
    }

    // FR-CRS-022 permits several teachers per subject-section, so a duplicate
    // check must be for a LIVE assignment of this teacher, not for any
    // assignment at all.
    const live = await this.prisma.scoped.teacherAssignment.findFirst({
      where: {
        teacherId: input.teacherId,
        sectionSubjectId: input.sectionSubjectId,
        deletedAt: null,
        OR: [{ endDate: null }, { endDate: { gte: new Date() } }],
      },
    });
    if (live) {
      throw new AppError("DUPLICATE_RESOURCE", {
        message: `${teacher.user.fullName} is already assigned to ${offering.subject.name} in ${offering.section.name}.`,
      });
    }

    const created = await this.prisma.scoped.teacherAssignment.create({
      data: {
        teacherId: input.teacherId,
        sectionSubjectId: input.sectionSubjectId,
        assignmentRole: input.assignmentRole,
        startDate: input.startDate,
        endDate: input.endDate ?? null,
      },
    });

    await this.audit.record({
      action: "assignment.create",
      entityType: "TeacherAssignment",
      entityId: created.id,
      after: {
        teacherId: input.teacherId,
        sectionSubjectId: input.sectionSubjectId,
        role: input.assignmentRole,
        startDate: input.startDate,
        endDate: input.endDate ?? null,
        // Recorded explicitly so an audit reader can see WHAT reach was
        // granted without joining three tables.
        grantedReach: `${offering.subject.code} in ${offering.section.code}`,
      },
    });

    // The teacher can now see this subject-section. Without this the change
    // takes up to fifteen minutes to appear, and the teacher reasonably
    // concludes the System is broken.
    this.actors.invalidate(teacher.user.id);

    this.logger.log(
      `Assigned teacher ${input.teacherId} to ${offering.subject.code}/${offering.section.code}`,
    );
    return created;
  }

  /**
   * FR-CRS-023 — ending an assignment removes ASSIGNED scope immediately.
   *
   * The assignment row is retained rather than deleted: FR-CRS-024 requires
   * content authored by a departing teacher to survive, and the historical
   * record of who taught what is needed for the teacher activity report
   * (Report 16).
   */
  async end(id: string, endDate?: Date, reason?: string) {
    const assignment = await this.prisma.scoped.teacherAssignment.findFirst({
      where: { id, deletedAt: null },
      include: {
        teacher: { include: { user: { select: { id: true, fullName: true } } } },
        sectionSubject: {
          include: {
            section: { select: { code: true } },
            subject: { select: { code: true } },
          },
        },
      },
    });
    if (!assignment) throw new AppError("RESOURCE_NOT_FOUND");

    const effective = endDate ?? new Date();

    const updated = await this.prisma.scoped.teacherAssignment.update({
      where: { id },
      data: { endDate: effective },
    });

    await this.audit.record({
      action: "assignment.end",
      entityType: "TeacherAssignment",
      entityId: id,
      before: { endDate: assignment.endDate },
      after: {
        endDate: effective,
        reason: reason ?? null,
        revokedReach: `${assignment.sectionSubject.subject.code} in ${assignment.sectionSubject.section.code}`,
      },
    });

    // SEC-SES-009: the withdrawal must bite on the very next request. The
    // scope integration test asserts exactly this — end an assignment while
    // the teacher is active, then confirm the next call returns 403.
    this.actors.invalidate(assignment.teacher.user.id);

    this.logger.log(`Ended assignment ${id}; scope revoked for user ${assignment.teacher.user.id}`);
    return updated;
  }

  /** FR-CRS-021 — a teacher's current assignments, with their workload. */
  async listForTeacher(teacherId: string) {
    const now = new Date();
    const rows = await this.prisma.scoped.teacherAssignment.findMany({
      where: { teacherId, deletedAt: null },
      include: {
        sectionSubject: {
          include: {
            section: { select: { id: true, code: true, name: true, shift: true } },
            subject: { select: { id: true, code: true, name: true } },
            _count: { select: { enrolments: true } },
          },
        },
      },
      orderBy: { startDate: "desc" },
    });

    return rows.map((a: (typeof rows)[number]) => ({
      ...a,
      isLive: !a.endDate || a.endDate >= now,
    }));
  }

  /**
   * FR-CRS-015 — a teacher's current workload, so an administrator can see it
   * BEFORE making another assignment rather than discovering the overload
   * afterwards.
   */
  async workload() {
    const now = new Date();
    const teachers = await this.prisma.scoped.teacher.findMany({
      where: { deletedAt: null },
      include: {
        user: { select: { id: true, fullName: true, status: true } },
        assignments: {
          where: { deletedAt: null, OR: [{ endDate: null }, { endDate: { gte: now } }] },
          include: { sectionSubject: { include: { _count: { select: { enrolments: true } } } } },
        },
      },
    });

    return teachers.map((t: (typeof teachers)[number]) => ({
      teacherId: t.id,
      name: t.user.fullName,
      status: t.user.status,
      subjectSections: t.assignments.length,
      students: t.assignments.reduce(
        (sum: number, a: (typeof t.assignments)[number]) =>
          sum + a.sectionSubject._count.enrolments,
        0,
      ),
    }));
  }
}
