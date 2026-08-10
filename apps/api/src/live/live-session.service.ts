import { Injectable, Logger } from "@nestjs/common";
import { AppError } from "@lms/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { ProviderRegistry } from "./provider/provider.registry";
import { getActor } from "../prisma/actor-context";
import type { JoinRoute } from "./provider/live-classroom.provider";

export interface ScheduleSessionInput {
  sectionSubjectId: string;
  lessonId?: string;
  title: string;
  description?: string;
  scheduledStart: Date;
  scheduledEnd: Date;
  hostTeacherId: string;
  sessionType?: "ONLINE" | "OFFLINE";
  /**
   * FR-ATT-008 — who records attendance for this class.
   *
   * The column and its four values have existed since the first migration and
   * nothing could set them, so every session in the System was MANUAL and self
   * check-in was unreachable however the permission was granted.
   */
  attendancePolicy?: "MANUAL" | "SELF_CHECKIN" | "PROVIDER_DERIVED" | "HYBRID";
  /** How long before the start a student may join, and check in. */
  joinWindowMinutesBefore?: number;
}

/**
 * Live sessions — SRS §5.13.
 *
 * Nothing in this file names a conferencing vendor. Every provider
 * interaction goes through the registry and the LCAL interface, which is what
 * makes CON-03 achievable: replacing Google Meet is an adapter change, not a
 * redesign.
 */
@Injectable()
export class LiveSessionService {
  private readonly logger = new Logger(LiveSessionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly providers: ProviderRegistry,
  ) {}

  /** FR-LIV-001/003/021 — schedule, detect clashes, request a binding. */
  async schedule(input: ScheduleSessionInput) {
    if (input.scheduledEnd <= input.scheduledStart) {
      throw new AppError("VALIDATION_FAILED", {
        details: [
          {
            field: "scheduledEnd",
            code: "INVALID_RANGE",
            message: "The class must end after it starts.",
          },
        ],
      });
    }

    const offering = await this.prisma.scoped.sectionSubject.findFirst({
      where: { id: input.sectionSubjectId, deletedAt: null },
      include: {
        section: { select: { id: true, code: true, name: true, liveProviderKey: true } },
        subject: { select: { code: true, name: true } },
      },
    });
    if (!offering) {
      throw new AppError("VALIDATION_FAILED", {
        details: [
          {
            field: "sectionSubjectId",
            code: "NOT_FOUND",
            message: "That subject is not offered to that section.",
          },
        ],
      });
    }

    // FR-LIV-021 / FR-CRS-037 — a teacher cannot be in two places at once.
    // Overlap is (startA < endB) AND (endA > startB); touching boundaries are
    // fine, so a 09:00–10:30 and a 10:30–12:00 class do not clash.
    const clash = await this.prisma.scoped.liveSession.findFirst({
      where: {
        hostTeacherId: input.hostTeacherId,
        status: { in: ["SCHEDULED", "LIVE"] },
        deletedAt: null,
        scheduledStart: { lt: input.scheduledEnd },
        scheduledEnd: { gt: input.scheduledStart },
      },
      include: { sectionSubject: { include: { section: { select: { code: true } } } } },
    });
    if (clash) {
      throw new AppError("RESOURCE_CONFLICT", {
        message:
          `This teacher already has "${clash.title}" for ` +
          `${clash.sectionSubject.section.code} at that time.`,
        details: [
          {
            field: "scheduledStart",
            code: "TEACHER_CLASH",
            message: `${clash.scheduledStart.toISOString()} – ${clash.scheduledEnd.toISOString()}`,
          },
        ],
      });
    }

    const session = await this.prisma.scoped.liveSession.create({
      data: {
        sectionSubjectId: input.sectionSubjectId,
        lessonId: input.lessonId ?? null,
        title: input.title,
        description: input.description ?? null,
        scheduledStart: input.scheduledStart,
        scheduledEnd: input.scheduledEnd,
        hostTeacherId: input.hostTeacherId,
        sessionType: input.sessionType ?? "ONLINE",
        attendancePolicy: input.attendancePolicy ?? "MANUAL",
        ...(input.joinWindowMinutesBefore !== undefined
          ? { joinWindowMinutesBefore: input.joinWindowMinutesBefore }
          : {}),
        status: "SCHEDULED",
      },
    });

    // FR-LIV-020 — an OFFLINE session has no provider and needs none. It still
    // carries an attendance register, which is the point (FR-ATT-026).
    if ((input.sessionType ?? "ONLINE") === "ONLINE") {
      await this.createBinding(session.id, offering.section.liveProviderKey, {
        sessionId: session.id,
        title: input.title,
        description: input.description ?? null,
        scheduledStart: input.scheduledStart,
        scheduledEnd: input.scheduledEnd,
      });
    }

    await this.audit.record({
      action: "session.schedule",
      entityType: "LiveSession",
      entityId: session.id,
      after: {
        sectionSubjectId: input.sectionSubjectId,
        title: input.title,
        scheduledStart: input.scheduledStart,
        hostTeacherId: input.hostTeacherId,
      },
    });

    return session;
  }

  /**
   * FR-LIV-004 / ARC-026 — a binding failure must NOT fail the session.
   *
   * The session exists, is visible, is reportable, and carries an attendance
   * register regardless. Only the join route degrades, and the teacher is told
   * so they can paste a fallback link.
   */
  private async createBinding(
    sessionId: string,
    sectionProviderKey: string | null,
    req: {
      sessionId: string;
      title: string;
      description: string | null;
      scheduledStart: Date;
      scheduledEnd: Date;
    },
  ): Promise<void> {
    const provider = this.providers.resolve(sectionProviderKey);
    try {
      const binding = await provider.createSession(req);
      await this.prisma.asSystem((db) =>
        db.liveSessionProviderBinding.create({
          data: {
            liveSessionId: sessionId,
            providerKey: binding.providerKey,
            externalId: binding.externalId,
            joinUrl: binding.joinUrl,
            hostUrl: binding.hostUrl,
            providerMetadata: (binding.providerMetadata ?? {}) as object,
            status: binding.status,
          },
        }),
      );
    } catch (err) {
      this.logger.error(
        `Provider "${provider.key}" failed to create a meeting for session ${sessionId}`,
        err as Error,
      );
      await this.prisma.asSystem((db) =>
        db.liveSessionProviderBinding.create({
          data: {
            liveSessionId: sessionId,
            providerKey: provider.key,
            status: "FAILED",
            providerMetadata: { error: (err as Error).message } as object,
          },
        }),
      );
      // Swallowed on purpose: FR-LIV-004. A retry job and a teacher alert
      // handle it; a thrown error here would lose the whole session.
    }
  }

  /**
   * FR-LIV-006/007/008 — the join route.
   *
   * Returns a JoinRoute, never a URL. The client renders from `kind` alone,
   * which is why Phase 4 changes nothing above this line (ARC-029).
   */
  async getJoinRoute(sessionId: string): Promise<JoinRoute & { session: unknown }> {
    const actor = getActor();
    if (!actor) throw new AppError("AUTH_TOKEN_INVALID");

    // Scoped: a student outside the section cannot reach the session at all,
    // so this returns nothing rather than leaking its existence.
    const session = await this.prisma.scoped.liveSession.findFirst({
      where: { id: sessionId, deletedAt: null },
      include: {
        binding: true,
        sectionSubject: {
          include: {
            section: { select: { liveProviderKey: true } },
            subject: { select: { name: true } },
          },
        },
      },
    });
    if (!session) throw new AppError("RESOURCE_NOT_FOUND");

    const isHost = actor.teacherId === session.hostTeacherId;
    const now = Date.now();
    const opensAt = session.scheduledStart.getTime() - session.joinWindowMinutesBefore * 60_000;
    const closesAt = session.scheduledEnd.getTime() + 15 * 60_000;

    const summary = {
      id: session.id,
      title: session.title,
      subject: session.sectionSubject.subject.name,
      scheduledStart: session.scheduledStart,
      scheduledEnd: session.scheduledEnd,
      status: session.status,
      joinWindowOpensAt: new Date(opensAt),
    };

    if (session.status === "CANCELLED") {
      return {
        kind: "UNAVAILABLE",
        reasonCode: "SESSION_CANCELLED",
        message: session.cancellationReason
          ? `This class was cancelled: ${session.cancellationReason}`
          : "This class was cancelled.",
        session: summary,
      };
    }

    // A host may enter early to set up; a student may not (FR-LIV-006).
    if (!isHost && now < opensAt) {
      return {
        kind: "UNAVAILABLE",
        reasonCode: "WINDOW_NOT_OPEN",
        message: `You can join from ${new Date(opensAt).toISOString()}.`,
        retryAfter: new Date(opensAt),
        session: summary,
      };
    }
    if (now > closesAt) {
      return {
        kind: "UNAVAILABLE",
        reasonCode: "WINDOW_CLOSED",
        message: "This class has finished. The recording will appear here once published.",
        session: summary,
      };
    }

    if (session.sessionType === "OFFLINE") {
      return {
        kind: "UNAVAILABLE",
        reasonCode: "IN_PERSON",
        message: "This class is held in person.",
        session: summary,
      };
    }

    const provider = this.providers.resolve(session.sectionSubject.section.liveProviderKey);
    const route = await provider.getJoinRoute(
      {
        providerKey: session.binding?.providerKey ?? provider.key,
        externalId: session.binding?.externalId ?? null,
        joinUrl: session.binding?.joinUrl ?? null,
        hostUrl: session.binding?.hostUrl ?? null,
        providerMetadata: null,
        status: (session.binding?.status ?? "PENDING") as "PENDING",
      },
      { userId: actor.userId, email: "", isHost },
    );

    // FR-LIV-009 — record the join attempt as attendance evidence and for
    // audit. Best-effort: a logging failure must not stop a student joining.
    if (route.kind !== "UNAVAILABLE" && actor.studentId) {
      await this.recordJoin(session.id, actor.studentId).catch((e) =>
        this.logger.warn(`Could not record join for ${actor.studentId}: ${String(e)}`),
      );
    }

    return { ...route, session: summary };
  }

  private async recordJoin(sessionId: string, studentId: string): Promise<void> {
    await this.prisma.asSystem((db) =>
      db.attendanceRecord.upsert({
        where: { liveSessionId_studentId: { liveSessionId: sessionId, studentId } },
        // Only fills in the timestamp; it does NOT decide the state. That is
        // the teacher's judgement (FR-ATT-012), and a join is evidence rather
        // than a verdict.
        update: { participationSeconds: { increment: 0 } },
        create: {
          liveSessionId: sessionId,
          studentId,
          status: "NOT_MARKED",
          markingSource: "MANUAL",
        },
      }),
    );
  }

  /** FR-LIV-018 — a teacher-supplied link when the provider is unreachable. */
  async setFallbackLink(sessionId: string, joinUrl: string) {
    const session = await this.prisma.scoped.liveSession.findFirst({
      where: { id: sessionId, deletedAt: null },
      include: { binding: true },
    });
    if (!session) throw new AppError("RESOURCE_NOT_FOUND");

    await this.prisma.asSystem((db) =>
      db.liveSessionProviderBinding.upsert({
        where: { liveSessionId: sessionId },
        update: { joinUrl, status: "ACTIVE", isManualFallback: true },
        create: {
          liveSessionId: sessionId,
          providerKey: session.binding?.providerKey ?? "manual",
          joinUrl,
          status: "ACTIVE",
          isManualFallback: true,
        },
      }),
    );

    await this.audit.record({
      action: "session.fallback_link",
      entityType: "LiveSession",
      entityId: sessionId,
      after: { isManualFallback: true },
      // The URL itself is not audited: it is an opaque provider artefact, and
      // storing it twice widens the surface for no benefit.
    });

    return { sessionId, isManualFallback: true };
  }

  /** FR-LIV-013 — cancel with a reason; students are told. */
  async cancel(sessionId: string, reason: string) {
    const session = await this.prisma.scoped.liveSession.findFirst({
      where: { id: sessionId, deletedAt: null },
      include: {
        binding: true,
        sectionSubject: { include: { section: { select: { liveProviderKey: true } } } },
      },
    });
    if (!session) throw new AppError("RESOURCE_NOT_FOUND");
    if (session.status === "ENDED") {
      throw new AppError("RESOURCE_CONFLICT", {
        message: "This class has already finished and cannot be cancelled.",
      });
    }

    const updated = await this.prisma.scoped.liveSession.update({
      where: { id: sessionId },
      data: { status: "CANCELLED", cancellationReason: reason },
    });

    if (session.binding) {
      const provider = this.providers.resolve(session.sectionSubject.section.liveProviderKey);
      await provider
        .cancelSession({
          providerKey: session.binding.providerKey,
          externalId: session.binding.externalId,
          joinUrl: session.binding.joinUrl,
          hostUrl: session.binding.hostUrl,
          providerMetadata: null,
          status: session.binding.status,
        })
        // The session is cancelled in the System regardless. A provider that
        // cannot be reached must not leave students believing a class is on.
        .catch((e) => this.logger.warn(`Provider cancel failed: ${String(e)}`));
    }

    await this.audit.record({
      action: "session.cancel",
      entityType: "LiveSession",
      entityId: sessionId,
      before: { status: session.status },
      after: { status: "CANCELLED", reason },
    });

    return updated;
  }

  /**
   * FR-LIV-005 — sessions within the caller's scope.
   *
   * `pastDays` matters more than it looks. An UNMARKED REGISTER IS ALWAYS IN
   * THE PAST, so a forward-only list cannot reach the work the attendance
   * screen exists to complete (FR-TCH-002). The default stays forward-looking
   * for the dashboard's next-class widget; the register asks for history.
   */
  async listUpcoming(params: {
    sectionSubjectId?: string;
    days?: number;
    pastDays?: number;
  }) {
    const now = Date.now();
    const horizon = new Date(now + (params.days ?? 7) * 86_400_000);
    const earliest = new Date(now - (params.pastDays ?? 0) * 86_400_000);

    const rows = await this.prisma.scoped.liveSession.findMany({
      where: {
        deletedAt: null,
        // ENDED is included only when history was asked for, so the dashboard
        // never offers a finished class as the next one.
        status:
          (params.pastDays ?? 0) > 0
            ? { in: ["SCHEDULED", "LIVE", "ENDED"] }
            : { in: ["SCHEDULED", "LIVE"] },
        scheduledStart: { lte: horizon },
        scheduledEnd: { gte: earliest },
        ...(params.sectionSubjectId ? { sectionSubjectId: params.sectionSubjectId } : {}),
      },
      orderBy: { scheduledStart: "asc" },
      include: {
        binding: { select: { status: true, isManualFallback: true } },
        sectionSubject: {
          include: {
            subject: { select: { code: true, name: true } },
            section: { select: { code: true, name: true } },
          },
        },
      },
    });

    return rows.map((s: (typeof rows)[number]) => ({
      id: s.id,
      title: s.title,
      subject: s.sectionSubject.subject,
      section: s.sectionSubject.section,
      scheduledStart: s.scheduledStart,
      scheduledEnd: s.scheduledEnd,
      status: s.status,
      joinWindowOpensAt: new Date(
        s.scheduledStart.getTime() - s.joinWindowMinutesBefore * 60_000,
      ),
      // FR-LIV-019 — surfaced so a teacher learns the link is missing before
      // the class rather than during it. The raw URL is never included.
      linkReady: s.binding?.status === "ACTIVE",
    }));
  }
}
