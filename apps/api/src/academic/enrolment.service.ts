import { Injectable, Logger } from "@nestjs/common";
import { AppError, type TransferInput } from "@lms/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { ActorService } from "../auth/actor.service";
import { RegistrationNumberService } from "../admission/registration-number.service";
import { getActor } from "../prisma/actor-context";

/**
 * Enrolment lifecycle — SRS §5.4, state machine at Figure 12-10.
 *
 * The governing principle is BR-ENR-10: enrolment history is RETAINED across
 * transfer, suspension and withdrawal. States transition; rows are never
 * deleted. FR-ENR-022 goes further — an enrolment with graded work cannot be
 * removed at all, only withdrawn or completed.
 */
@Injectable()
export class EnrolmentService {
  private readonly logger = new Logger(EnrolmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly actors: ActorService,
    private readonly numbers: RegistrationNumberService,
  ) {}

  /** FR-ENR-012 — the section roster. */
  async roster(sectionId: string) {
    const rows = await this.prisma.scoped.student.findMany({
      where: { currentSectionId: sectionId, deletedAt: null },
      include: {
        user: { select: { fullName: true, email: true, phone: true, status: true, photoUrl: true } },
        enrolments: {
          where: { status: "ACTIVE" },
          include: { sectionSubject: { include: { subject: { select: { code: true } } } } },
        },
      },
      orderBy: { currentRollNo: "asc" }, // matches how a register is called
    });

    return rows.map((s: (typeof rows)[number]) => ({
      studentId: s.id,
      rollNo: s.currentRollNo,
      registrationNo: s.registrationNo,
      name: s.user.fullName,
      photoUrl: s.user.photoUrl,
      accountStatus: s.user.status,
      subjects: s.enrolments.map((e: (typeof s.enrolments)[number]) => e.sectionSubject.subject.code),
      // Contact details are omitted deliberately. §4.7 restricts them to
      // Admin unless CFG-PRV-02 is enabled, and a roster is the surface a
      // teacher sees most often.
    }));
  }

  /**
   * FR-ENR-005/006 — transfer between sections.
   *
   * The registration number never changes (BR-REG-07); a new roll number is
   * allocated in the destination (FR-REG-058); source enrolments close as
   * TRANSFERRED rather than being deleted.
   */
  async transfer(studentId: string, input: TransferInput) {
    const actor = getActor();
    if (!actor) throw new AppError("AUTH_TOKEN_INVALID");

    return this.prisma.asSystem((db) =>
      db.$transaction(async (tx) => {
        // Lock the destination first so the capacity check and the roll number
        // allocation cannot race another approval or transfer.
        await this.numbers.lockSection(tx, input.toSectionId);

        const student = await tx.student.findUnique({
          where: { id: studentId },
          include: {
            user: { select: { id: true } },
            currentSection: { select: { id: true, code: true, name: true } },
            enrolments: {
              where: { status: "ACTIVE" },
              include: { sectionSubject: { select: { id: true, subjectId: true } } },
            },
          },
        });
        if (!student) throw new AppError("RESOURCE_NOT_FOUND");

        if (student.currentSectionId === input.toSectionId) {
          throw new AppError("RESOURCE_CONFLICT", {
            message: "The student is already in that batch.",
          });
        }

        const to = await tx.section.findUnique({
          where: { id: input.toSectionId },
          include: {
            sectionSubjects: {
              where: { isCompulsory: true, status: { in: ["PLANNED", "ACTIVE"] } },
              select: { id: true },
            },
          },
        });
        if (!to) {
          throw new AppError("VALIDATION_FAILED", {
            details: [
              { field: "toSectionId", code: "NOT_FOUND", message: "That batch does not exist." },
            ],
          });
        }
        if (to.status === "ARCHIVED") {
          throw new AppError("RESOURCE_CONFLICT", {
            message: "That batch is archived and cannot accept students.",
          });
        }

        // FR-CRS-009 / BR-ENR-05 — absolute, exactly as at admission. There is
        // no override, and transfer must not become a way around it.
        if (to.genderRestriction !== "MIXED" && to.genderRestriction !== student.gender) {
          throw new AppError("SECTION_GENDER_RESTRICTED", {
            message: `${to.name} admits ${to.genderRestriction.toLowerCase()} students only.`,
          });
        }

        if (to.enrolledCount >= to.capacity && !input.capacityOverride) {
          throw new AppError("SECTION_AT_CAPACITY", {
            message: `${to.name} is full (${to.enrolledCount} of ${to.capacity}).`,
          });
        }

        const fromSectionId = student.currentSectionId;
        const newRollNo = await this.numbers.allocateRollNumber(tx, to.id);

        // BR-ENR-10 — close, never delete. The prior roll number stays on the
        // closed row so the historical register still reads correctly.
        await tx.enrolment.updateMany({
          where: { studentId, status: "ACTIVE" },
          data: {
            status: "TRANSFERRED",
            endedAt: new Date(),
            statusReason: input.reason,
          },
        });

        if (to.sectionSubjects.length > 0) {
          await tx.enrolment.createMany({
            data: to.sectionSubjects.map((ss) => ({
              studentId,
              sectionSubjectId: ss.id,
              status: "ACTIVE" as const,
              rollNoAtEnrolment: newRollNo,
            })),
          });
        }

        await tx.student.update({
          where: { id: studentId },
          data: { currentSectionId: to.id, currentRollNo: newRollNo },
        });

        // Occupancy on both sides, inside the same transaction (§8.5).
        if (fromSectionId) {
          await tx.section.update({
            where: { id: fromSectionId },
            data: { enrolledCount: { decrement: 1 } },
          });
        }
        await tx.section.update({
          where: { id: to.id },
          data: { enrolledCount: { increment: 1 } },
        });

        await this.audit.record(
          {
            action: "enrolment.transfer",
            entityType: "Student",
            entityId: studentId,
            before: {
              sectionId: fromSectionId,
              sectionCode: student.currentSection?.code,
              rollNo: student.currentRollNo,
            },
            after: {
              sectionId: to.id,
              sectionCode: to.code,
              rollNo: newRollNo,
              // The explicit choice is recorded because both answers are
              // legitimate and the decision is hard to reconstruct later.
              carryHistory: input.carryHistory,
              reason: input.reason,
              capacityOverride: input.capacityOverride,
            },
          },
          tx as unknown as Parameters<AuditService["record"]>[1],
        );

        // The student's ENROLLED reach changed entirely.
        this.actors.invalidate(student.user.id);

        return {
          studentId,
          registrationNo: student.registrationNo, // unchanged, by rule
          from: student.currentSection,
          to: { id: to.id, code: to.code, name: to.name },
          newRollNo,
          subjectsEnrolled: to.sectionSubjects.length,
        };
      }),
    );
  }

  /**
   * FR-ENR-007/008 — suspension.
   *
   * Read access to the student's own history is retained (BR-ENR-07); what is
   * removed is the ability to join sessions, submit, and attempt quizzes. The
   * reason is mandatory and shown to the student, because an unexplained loss
   * of function is indistinguishable from a fault (FR-ENR-008).
   */
  async suspend(studentId: string, reason: string) {
    return this.prisma.asSystem((db) =>
      db.$transaction(async (tx) => {
        const student = await tx.student.findUnique({
          where: { id: studentId },
          include: { user: { select: { id: true, status: true } } },
        });
        if (!student) throw new AppError("RESOURCE_NOT_FOUND");

        await tx.user.update({
          where: { id: student.user.id },
          data: { status: "SUSPENDED", statusReason: reason },
        });
        await tx.enrolment.updateMany({
          where: { studentId, status: "ACTIVE" },
          data: { status: "SUSPENDED", statusReason: reason },
        });
        // SEC-SES-007 — end live sessions so the suspension is immediate
        // rather than lasting until the current token expires.
        await tx.userSession.updateMany({
          where: { userId: student.user.id, revokedAt: null },
          data: { revokedAt: new Date() },
        });

        await this.audit.record(
          {
            action: "student.suspend",
            entityType: "Student",
            entityId: studentId,
            before: { status: student.user.status },
            after: { status: "SUSPENDED", reason },
          },
          tx as unknown as Parameters<AuditService["record"]>[1],
        );

        this.actors.invalidate(student.user.id);
        return { studentId, status: "SUSPENDED" as const, reason };
      }),
    );
  }

  /**
   * FR-ENR-009/011 — withdrawal.
   *
   * Frees the roll number for reuse within the section (BR-REG-08) but never
   * the registration number (BR-REG-07). The student keeps read access to
   * their own record and issued certificates (BR-ENR-08).
   */
  async withdraw(studentId: string, reason: string) {
    return this.prisma.asSystem((db) =>
      db.$transaction(async (tx) => {
        const student = await tx.student.findUnique({
          where: { id: studentId },
          include: { user: { select: { id: true, status: true } } },
        });
        if (!student) throw new AppError("RESOURCE_NOT_FOUND");

        const fromSectionId = student.currentSectionId;

        await tx.enrolment.updateMany({
          where: { studentId, status: { in: ["ACTIVE", "SUSPENDED"] } },
          data: { status: "WITHDRAWN", endedAt: new Date(), statusReason: reason },
        });
        await tx.user.update({
          where: { id: student.user.id },
          data: { status: "WITHDRAWN", statusReason: reason },
        });
        await tx.userSession.updateMany({
          where: { userId: student.user.id, revokedAt: null },
          data: { revokedAt: new Date() },
        });

        // Clearing currentRollNo is what frees it: the partial unique index
        // covers live rows only, so the number becomes available again.
        await tx.student.update({
          where: { id: studentId },
          data: { currentRollNo: null },
        });

        if (fromSectionId) {
          await tx.section.update({
            where: { id: fromSectionId },
            data: { enrolledCount: { decrement: 1 } },
          });
        }

        await this.audit.record(
          {
            action: "student.withdraw",
            entityType: "Student",
            entityId: studentId,
            before: { status: student.user.status, rollNo: student.currentRollNo },
            after: {
              status: "WITHDRAWN",
              rollNo: null,
              reason,
              // Stated in the audit record because it is the question people
              // ask months later.
              registrationNoRetained: student.registrationNo,
            },
          },
          tx as unknown as Parameters<AuditService["record"]>[1],
        );

        this.actors.invalidate(student.user.id);
        return {
          studentId,
          status: "WITHDRAWN" as const,
          registrationNo: student.registrationNo,
          rollNumberReleased: student.currentRollNo,
        };
      }),
    );
  }

  /** FR-ENR-010 — reinstate a suspended or withdrawn student. */
  async reinstate(studentId: string, reason?: string) {
    return this.prisma.asSystem((db) =>
      db.$transaction(async (tx) => {
        const student = await tx.student.findUnique({
          where: { id: studentId },
          include: { user: { select: { id: true, status: true } } },
        });
        if (!student) throw new AppError("RESOURCE_NOT_FOUND");
        if (student.user.status === "ACTIVE") {
          throw new AppError("RESOURCE_CONFLICT", { message: "That student is already active." });
        }

        const wasWithdrawn = student.user.status === "WITHDRAWN";

        // A suspended student's enrolments are restored as they were. A
        // withdrawn student needs a fresh enrolment decision, because their
        // section may have closed and their roll number been reused.
        if (!wasWithdrawn) {
          await tx.enrolment.updateMany({
            where: { studentId, status: "SUSPENDED" },
            data: { status: "ACTIVE", statusReason: null },
          });
        }

        await tx.user.update({
          where: { id: student.user.id },
          data: { status: "ACTIVE", statusReason: null },
        });

        await this.audit.record(
          {
            action: "student.reinstate",
            entityType: "Student",
            entityId: studentId,
            before: { status: student.user.status },
            after: { status: "ACTIVE", reason: reason ?? null },
          },
          tx as unknown as Parameters<AuditService["record"]>[1],
        );

        this.actors.invalidate(student.user.id);

        return {
          studentId,
          status: "ACTIVE" as const,
          // Told plainly rather than left for the administrator to discover.
          requiresReEnrolment: wasWithdrawn,
          message: wasWithdrawn
            ? "Account reactivated. This student was withdrawn, so enrol them into a section to restore access."
            : "Account and enrolments restored.",
        };
      }),
    );
  }

  /** FR-ENR-021 — the complete enrolment history for a student. */
  async history(studentId: string) {
    const rows = await this.prisma.scoped.enrolment.findMany({
      where: { studentId },
      include: {
        sectionSubject: {
          include: {
            subject: { select: { code: true, name: true } },
            section: { select: { code: true, name: true } },
          },
        },
      },
      orderBy: { enrolledAt: "desc" },
    });

    return rows.map((e: (typeof rows)[number]) => ({
      id: e.id,
      subject: e.sectionSubject.subject,
      section: e.sectionSubject.section,
      status: e.status,
      rollNoAtEnrolment: e.rollNoAtEnrolment,
      enrolledAt: e.enrolledAt,
      endedAt: e.endedAt,
      reason: e.statusReason,
    }));
  }
}
