import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AppError } from "@lms/shared";
import type { AttendanceStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { getActor } from "../prisma/actor-context";
import { assertOwnsSectionSubject } from "../rbac/ownership";
import { NotificationService } from "../notification/notification.service";
import {
  decideWarning,
  warningMessage,
  type ThresholdConfig,
} from "./attendance-warning";

export interface BulkMarkInput {
  defaultStatus: AttendanceStatus;
  exceptions: Array<{ studentId: string; status: AttendanceStatus; reason?: string }>;
}

/**
 * Attendance — SRS §5.11.
 *
 * The Institute's principal early-warning signal, and today its weakest: kept
 * in per-teacher spreadsheets, inconsistent, and consulted only after a
 * student has already failed (§2.2.2).
 *
 * The design constraint that shapes this module is RSK-01 — teacher adoption.
 * FR-ATT-007 requires a full 40-student register in under 60 seconds, and that
 * is an acceptance criterion rather than an aspiration. Hence
 * default-all-then-exceptions: a teacher states the majority once and touches
 * only the handful that differ.
 */
@Injectable()
export class AttendanceService {
  private readonly logger = new Logger(AttendanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
    private readonly notifications: NotificationService,
  ) {}

  /**
   * FR-ATT-001/003 — the register.
   *
   * Ordered by roll number because that is the order a teacher calls a class
   * in; any other order makes marking slower, which costs adoption.
   */
  async register(sessionId: string) {
    const session = await this.prisma.scoped.liveSession.findFirst({
      where: { id: sessionId, deletedAt: null },
      include: {
        sectionSubject: {
          include: {
            section: { select: { id: true, code: true, name: true } },
            subject: { select: { code: true, name: true } },
          },
        },
      },
    });
    if (!session) throw new AppError("RESOURCE_NOT_FOUND");

    // Rows are created lazily on first open rather than at scheduling time, so
    // a student enrolled after the session was created still appears.
    await this.ensureRows(sessionId, session.sectionSubjectId);

    const rows = await this.prisma.scoped.attendanceRecord.findMany({
      where: { liveSessionId: sessionId },
      include: {
        student: {
          include: { user: { select: { fullName: true, photoUrl: true } } },
        },
      },
    });

    const ordered = [...rows].sort(
      (a: (typeof rows)[number], b: (typeof rows)[number]) =>
        (a.student.currentRollNo ?? 9999) - (b.student.currentRollNo ?? 9999),
    );

    const summary = ordered.reduce<Record<string, number>>((acc, r) => {
      acc[r.status] = (acc[r.status] ?? 0) + 1;
      return acc;
    }, {});

    return {
      session: {
        id: session.id,
        title: session.title,
        scheduledStart: session.scheduledStart,
        status: session.status,
        subject: session.sectionSubject.subject,
        section: session.sectionSubject.section,
      },
      students: ordered.map((r: (typeof ordered)[number]) => ({
        studentId: r.studentId,
        rollNo: r.student.currentRollNo,
        registrationNo: r.student.registrationNo,
        name: r.student.user.fullName,
        photoUrl: r.student.user.photoUrl,
        status: r.status,
        markingSource: r.markingSource,
        proposedStatus: r.proposedStatus,
        participationSeconds: r.participationSeconds,
        markedAt: r.markedAt,
      })),
      summary,
      isComplete: (summary["NOT_MARKED"] ?? 0) === 0,
    };
  }

  /** Creates any missing rows for currently-enrolled students. Idempotent. */
  private async ensureRows(sessionId: string, sectionSubjectId: string): Promise<void> {
    await this.prisma.asSystem(async (db) => {
      const enrolled = await db.enrolment.findMany({
        where: { sectionSubjectId, status: "ACTIVE", deletedAt: null },
        select: { studentId: true },
      });
      if (enrolled.length === 0) return;

      await db.attendanceRecord.createMany({
        data: enrolled.map((e) => ({
          liveSessionId: sessionId,
          studentId: e.studentId,
          status: "NOT_MARKED" as const,
          markingSource: "MANUAL" as const,
        })),
        skipDuplicates: true,
      });
    });
  }

  /**
   * FR-ATT-004/007 — bulk marking.
   *
   * One statement sets the majority, a second handles the exceptions. Marking
   * forty students individually would take a teacher several minutes and they
   * would stop doing it (RSK-01).
   */
  async markBulk(sessionId: string, input: BulkMarkInput, ip?: string, userAgent?: string) {
    const actor = getActor();
    if (!actor) throw new AppError("AUTH_TOKEN_INVALID");

    const session = await this.prisma.scoped.liveSession.findFirst({
      where: { id: sessionId, deletedAt: null },
      select: { id: true, sectionSubjectId: true, status: true },
    });
    if (!session) throw new AppError("RESOURCE_NOT_FOUND");

    await this.ensureRows(sessionId, session.sectionSubjectId);

    const exceptionIds = input.exceptions.map((e) => e.studentId);
    const markedAt = new Date();

    const result = await this.prisma.asSystem((db) =>
      db.$transaction(async (tx) => {
        await tx.attendanceRecord.updateMany({
          where: {
            liveSessionId: sessionId,
            ...(exceptionIds.length > 0 ? { studentId: { notIn: exceptionIds } } : {}),
          },
          data: {
            status: input.defaultStatus,
            markingSource: "MANUAL",
            markedBy: actor.userId,
            markedAt,
          },
        });

        for (const ex of input.exceptions) {
          await tx.attendanceRecord.updateMany({
            where: { liveSessionId: sessionId, studentId: ex.studentId },
            data: {
              status: ex.status,
              markingSource: "MANUAL",
              markedBy: actor.userId,
              markedAt,
              ...(ex.reason ? { correctionReason: ex.reason } : {}),
            },
          });
        }

        const rows = await tx.attendanceRecord.findMany({
          where: { liveSessionId: sessionId },
          select: { studentId: true, status: true },
        });

        await this.audit.record(
          {
            action: "attendance.mark_bulk",
            entityType: "LiveSession",
            entityId: sessionId,
            after: {
              defaultStatus: input.defaultStatus,
              exceptions: input.exceptions.length,
              marked: rows.length,
            },
            ipAddress: ip,
            userAgent,
          },
          tx as unknown as Parameters<AuditService["record"]>[1],
        );

        return rows;
      }),
    );

    const summary = result.reduce<Record<string, number>>((acc, r) => {
      acc[r.status] = (acc[r.status] ?? 0) + 1;
      return acc;
    }, {});

    // FR-ATT-020/021 — recompute and raise warnings as part of marking, so the
    // teacher sees the consequence immediately rather than in a nightly batch.
    const warnings = await this.evaluateThresholds(
      session.sectionSubjectId,
      result.map((r) => r.studentId),
    );

    return {
      sessionId,
      marked: result.length,
      summary,
      // ARC-033 — echoed back so the caller can see WHAT was recorded, not
      // merely that something was. Never a vendor name.
      markingSource: "MANUAL" as const,
      thresholdWarningsRaised: warnings,
    };
  }

  /**
   * FR-ATT-017/018 — correction.
   *
   * Both values are retained. BR-ATT-07 puts corrections outside the window
   * beyond a teacher's authority, because late changes to attendance are
   * exactly what a disciplinary process needs to be able to trust.
   */
  async correct(
    sessionId: string,
    studentId: string,
    status: AttendanceStatus,
    reason: string,
  ) {
    const actor = getActor();
    if (!actor) throw new AppError("AUTH_TOKEN_INVALID");

    const record = await this.prisma.scoped.attendanceRecord.findFirst({
      where: { liveSessionId: sessionId, studentId },
      include: { liveSession: { select: { scheduledEnd: true, sectionSubjectId: true } } },
    });
    if (!record) throw new AppError("RESOURCE_NOT_FOUND");

    const windowDays = Number(this.config.get<string>("ATT_CORRECTION_WINDOW_DAYS", "7"));
    const deadline = record.liveSession.scheduledEnd.getTime() + windowDays * 86_400_000;
    const isAdmin = actor.roles.includes("admin") || actor.roles.includes("super_admin");

    if (Date.now() > deadline && !isAdmin) {
      throw new AppError("AUTH_FORBIDDEN", {
        message:
          `Attendance can be corrected by a teacher for ${windowDays} days after a class. ` +
          `Ask an administrator to make this change.`,
      });
    }

    const updated = await this.prisma.asSystem((db) =>
      db.$transaction(async (tx) => {
        const row = await tx.attendanceRecord.update({
          where: { liveSessionId_studentId: { liveSessionId: sessionId, studentId } },
          data: {
            status,
            correctedFrom: record.status,
            correctionReason: reason,
            markedBy: actor.userId,
            markedAt: new Date(),
          },
        });

        await this.audit.record(
          {
            action: "attendance.correct",
            entityType: "AttendanceRecord",
            entityId: row.id,
            before: { status: record.status },
            after: { status, reason, outsideWindow: Date.now() > deadline },
          },
          tx as unknown as Parameters<AuditService["record"]>[1],
        );

        return row;
      }),
    );

    await this.evaluateThresholds(record.liveSession.sectionSubjectId, [studentId]);
    return updated;
  }

  /**
   * FR-ATT-019 — the attendance percentage.
   *
   * BR-ATT-05: EXCUSED is excluded from the denominator, so an authorised
   * absence does not damage a student's standing. NOT_MARKED is excluded too —
   * a teacher's failure to mark must not count against the student.
   *
   * BR-ATT-06 requires this definition to be identical everywhere, which is
   * why every caller uses this method rather than computing its own.
   */
  async percentageFor(studentId: string, sectionSubjectId?: string) {
    const rows = await this.prisma.scoped.attendanceRecord.findMany({
      where: {
        studentId,
        liveSession: {
          ...(sectionSubjectId ? { sectionSubjectId } : {}),
          // Only classes that have actually happened.
          //
          // A record can exist against a SCHEDULED session — a register opened
          // early, a bulk operation, a fixture — and counting it marks a
          // student absent from a class nobody has taught yet. That silently
          // lowers attendance, which feeds the attendance component of
          // progress and therefore completion (BR-PRG-02). A CANCELLED class
          // is excluded for the same reason: the Institute called it off, so
          // it cannot count against the student (BR-ATT-06).
          //
          // LIVE is excluded too. A class in progress has an incomplete
          // register by definition, and counting it would make every student's
          // percentage dip for ninety minutes and then recover.
          status: "ENDED",
        },
      },
      select: { status: true },
    });

    const counts = rows.reduce<Record<string, number>>((acc, r) => {
      acc[r.status] = (acc[r.status] ?? 0) + 1;
      return acc;
    }, {});

    const present = counts["PRESENT"] ?? 0;
    const late = counts["LATE"] ?? 0;
    const absent = counts["ABSENT"] ?? 0;
    const excused = counts["EXCUSED"] ?? 0;

    const lateWeight = Number(this.config.get<string>("ATT_LATE_WEIGHT", "1.0"));
    const attended = present + late * lateWeight;
    const denominator = present + late + absent; // excused and unmarked excluded

    return {
      studentId,
      sectionSubjectId: sectionSubjectId ?? null,
      present,
      late,
      absent,
      excused,
      notMarked: counts["NOT_MARKED"] ?? 0,
      sessionsInDenominator: denominator,
      // Denominator returned alongside so the figure can be reproduced by
      // hand — a percentage nobody can check is a percentage nobody trusts.
      percentage: denominator === 0 ? null : Math.round((attended / denominator) * 1000) / 10,
    };
  }

  /**
   * FR-ATT-020/022 — evaluate against the thresholds, and say something when
   * the answer has CHANGED.
   *
   * This runs on every register a teacher marks and every correction they make,
   * so the decision of whether to notify is not "is this student below the
   * line" but "have we already told them". That rule lives in
   * attendance-warning.ts, pure and tested, because a system that repeats
   * itself after every class is one people stop reading.
   */
  private async evaluateThresholds(sectionSubjectId: string, studentIds: string[]) {
    const config: ThresholdConfig = {
      warningPercent: Number(this.config.get<string>("ATT_WARNING_THRESHOLD", "75")),
      criticalPercent: Number(this.config.get<string>("ATT_CRITICAL_THRESHOLD", "60")),
      minimumSessions: Number(this.config.get<string>("ATT_MIN_SESSIONS_FOR_WARNING", "3")),
    };

    const warnings: Array<{
      studentId: string;
      percentage: number;
      threshold: number;
      severity: "WARNING" | "CRITICAL";
      notified: boolean;
    }> = [];

    // Read once for the subject name in the message and the student's user id.
    const offering = await this.prisma.asSystem((db) =>
      db.sectionSubject.findUnique({
        where: { id: sectionSubjectId },
        select: { subject: { select: { name: true } } },
      }),
    );
    const subjectName = offering?.subject.name ?? "this subject";

    for (const studentId of studentIds) {
      const stats = await this.percentageFor(studentId, sectionSubjectId);

      const previous = await this.prisma.asSystem((db) =>
        db.attendanceWarning.findUnique({
          where: { studentId_sectionSubjectId: { studentId, sectionSubjectId } },
        }),
      );

      const decision = decideWarning({
        percentage: stats.percentage,
        sessionsInDenominator: stats.sessionsInDenominator,
        previous: previous
          ? { severity: previous.severity, clearedAt: previous.clearedAt }
          : null,
        config,
      });

      if (decision.action === "CLEAR") {
        await this.prisma.asSystem((db) =>
          db.attendanceWarning.update({
            where: { studentId_sectionSubjectId: { studentId, sectionSubjectId } },
            data: { clearedAt: new Date() },
          }),
        );
        // No "well done" message. Nobody asked to be told they are now doing
        // what was expected, and it would dilute the warnings that matter.
        continue;
      }

      if (decision.action === "NONE") continue;

      const threshold =
        decision.severity === "CRITICAL" ? config.criticalPercent : config.warningPercent;
      const percentage = stats.percentage as number;

      await this.prisma.asSystem((db) =>
        db.attendanceWarning.upsert({
          where: { studentId_sectionSubjectId: { studentId, sectionSubjectId } },
          create: {
            studentId,
            sectionSubjectId,
            severity: decision.severity,
            percentage,
            thresholdApplied: threshold,
          },
          update: {
            severity: decision.severity,
            percentage,
            thresholdApplied: threshold,
            raisedAt: new Date(),
            // A re-raise is a new warning, so a previous clearance and a
            // previous acknowledgement no longer apply.
            clearedAt: null,
            acknowledgedAt: null,
            acknowledgedBy: null,
          },
        }),
      );

      const student = await this.prisma.asSystem((db) =>
        db.student.findUnique({ where: { id: studentId }, select: { userId: true } }),
      );

      if (student) {
        const message = warningMessage(decision.severity, percentage, subjectName, config);
        await this.notifications.notify({
          recipientUserIds: [student.userId],
          kind: `attendance.${decision.severity.toLowerCase()}`,
          title: message.title,
          body: message.body,
          linkPath: "/subjects",
          // BR-COM-02 — a critical warning reaches the student past their quiet
          // hours. Falling out of a course is worth being woken for; a first
          // warning is not.
          isUrgent: decision.severity === "CRITICAL",
        });
      }

      warnings.push({
        studentId,
        percentage,
        threshold,
        severity: decision.severity,
        notified: student != null,
      });
    }

    return warnings;
  }

  /**
   * FR-ATT-022 — the live warnings in one subject-section.
   *
   * Worst first, then longest-standing: a critical warning raised three weeks
   * ago and never acted on is the one a teacher most needs to see, and sorting
   * by roll number would bury it among students who are fine.
   *
   * Cleared warnings are excluded. They are history, and a list of problems
   * that have already resolved is a list nobody reads.
   */
  async atRisk(sectionSubjectId: string) {
    // The scope policy already returns nothing for a section this teacher does
    // not teach — but an empty 200 still confirms the identifier is real, and
    // SEC-AUZ-006 wants the answer to be the same either way.
    assertOwnsSectionSubject(sectionSubjectId);

    const rows = await this.prisma.scoped.attendanceWarning.findMany({
      where: { sectionSubjectId, clearedAt: null },
      include: { student: { include: { user: { select: { fullName: true } } } } },
    });

    const ranked = { CRITICAL: 0, WARNING: 1 } as const;

    return {
      sectionSubjectId,
      critical: rows.filter((r: (typeof rows)[number]) => r.severity === "CRITICAL").length,
      warning: rows.filter((r: (typeof rows)[number]) => r.severity === "WARNING").length,
      unacknowledged: rows.filter((r: (typeof rows)[number]) => r.acknowledgedAt === null).length,
      students: rows
        .map((r: (typeof rows)[number]) => ({
          warningId: r.id,
          studentId: r.studentId,
          rollNo: r.student.currentRollNo,
          name: r.student.user.fullName,
          severity: r.severity,
          percentage: Number(r.percentage),
          thresholdApplied: Number(r.thresholdApplied),
          raisedAt: r.raisedAt,
          acknowledgedAt: r.acknowledgedAt,
        }))
        .sort(
          (a, b) =>
            ranked[a.severity] - ranked[b.severity] ||
            a.raisedAt.getTime() - b.raisedAt.getTime(),
        ),
    };
  }

  /**
   * FR-ATT-022 — a teacher recording that they have acted on a warning.
   *
   * It does NOT clear the warning. The student is still below the threshold;
   * what has changed is that somebody has spoken to them. Clearing is the
   * student's to earn by attending, and conflating the two would let a class
   * look healthy because its teacher had been diligent about paperwork.
   */
  async acknowledgeWarning(warningId: string, note?: string) {
    const actor = getActor();
    if (!actor) throw new AppError("AUTH_TOKEN_INVALID");

    const warning = await this.prisma.scoped.attendanceWarning.findFirst({
      where: { id: warningId },
    });
    if (!warning) throw new AppError("RESOURCE_NOT_FOUND");

    const updated = await this.prisma.scoped.attendanceWarning.update({
      where: { id: warningId },
      data: { acknowledgedAt: new Date(), acknowledgedBy: actor.userId },
    });

    await this.audit.record({
      action: "attendance.warning_acknowledged",
      entityType: "AttendanceWarning",
      entityId: warningId,
      after: { severity: warning.severity, percentage: Number(warning.percentage), note },
    });

    return {
      warningId: updated.id,
      acknowledgedAt: updated.acknowledgedAt,
      // Said plainly, so nobody reads the tick as "resolved".
      stillBelowThreshold: updated.clearedAt === null,
    };
  }

  /** FR-ATT-023 — a student's own record, per subject. */
  async studentSummary(studentId: string) {
    const enrolments = await this.prisma.scoped.enrolment.findMany({
      where: { studentId, status: { in: ["ACTIVE", "COMPLETED"] } },
      include: {
        sectionSubject: { include: { subject: { select: { code: true, name: true } } } },
      },
    });

    const perSubject = await Promise.all(
      enrolments.map(async (e: (typeof enrolments)[number]) => ({
        subject: e.sectionSubject.subject,
        ...(await this.percentageFor(studentId, e.sectionSubjectId)),
      })),
    );

    const overall = await this.percentageFor(studentId);
    const threshold = Number(this.config.get<string>("ATT_WARNING_THRESHOLD", "75"));

    return {
      overall,
      threshold,
      isBelowThreshold: overall.percentage !== null && overall.percentage < threshold,
      perSubject,
    };
  }
}
