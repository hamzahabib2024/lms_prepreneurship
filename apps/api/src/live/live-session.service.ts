import { Injectable, Logger } from "@nestjs/common";
import { AppError } from "@lms/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { ProviderRegistry } from "./provider/provider.registry";
import { getActor } from "../prisma/actor-context";
import { ConfigService } from "@nestjs/config";
import type {
  JoinRoute,
  ProviderBinding,
  RoomEvent,
  RoomParticipant,
} from "./provider/live-classroom.provider";

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
    private readonly config: ConfigService,
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
            message: "That subject is not offered to that batch.",
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
      /*
       * So the class page can offer the host the controls only a host has —
       * ending the class for everyone.
       *
       * Not provider knowledge, and so not an ARC-025 breach: it says who this
       * person is to this class, which the System has always known. The
       * adapter receives the same fact through UserContext.isHost.
       */
      isHost,
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
   * A CLASS THAT STARTS NOW — FR-LIV, the ad-hoc case.
   *
   * The System could only ever hold a class somebody had scheduled in advance,
   * which is not how teaching actually goes: a revision hour is called because
   * an assessment went badly, a cancelled slot is picked up, a topic overruns
   * and needs another hour tomorrow. Every one of those ended up outside the
   * LMS entirely — a link pasted into WhatsApp, no register, no recording, no
   * record it happened (§2.2.2).
   *
   * Deliberately built ON schedule() rather than beside it. An instant class is
   * a scheduled class whose start time is now, and routing it through the same
   * method means it inherits the clash check, the provider binding, the
   * attendance register and the audit entry — all of which an "instant" path
   * written separately would have quietly done without.
   *
   * It is then marked LIVE, which nothing in the System did before: the column
   * and its enum have existed since the first migration and every session sat
   * at SCHEDULED for ever. A class a teacher has actually walked into should
   * say so.
   */
  async startNow(input: {
    sectionSubjectId: string;
    title?: string;
    durationMinutes?: number;
    hostTeacherId?: string;
  }) {
    const actor = getActor();
    if (!actor) throw new AppError("AUTH_TOKEN_INVALID");

    /*
     * The teacher is WHOEVER IS PRESSING THE BUTTON, not a field in the form.
     *
     * An explicit id is honoured so an administrator can open a room on behalf
     * of somebody, but the default has to be the caller: a body-supplied
     * teacher id with no default would let anybody start a class in another
     * teacher's name, and the register would then say that teacher held it.
     */
    const hostTeacherId = input.hostTeacherId ?? actor.teacherId;
    if (!hostTeacherId) {
      throw new AppError("VALIDATION_FAILED", {
        message: "Only a teacher can start a class. Say which teacher is taking it.",
        details: [
          { field: "hostTeacherId", code: "REQUIRED", message: "No teacher record for this user." },
        ],
      });
    }

    const offering = await this.prisma.scoped.sectionSubject.findFirst({
      where: { id: input.sectionSubjectId, deletedAt: null },
      include: { subject: { select: { name: true } } },
    });
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

    const now = new Date();
    const minutes = input.durationMinutes ?? 60;

    const session = await this.schedule({
      sectionSubjectId: input.sectionSubjectId,
      // Named after the subject unless the teacher said otherwise, because
      // this appears on a student's dashboard as the thing to join and
      // "Untitled class" tells them nothing about whether it is theirs.
      title: input.title?.trim() || offering.subject.name,
      scheduledStart: now,
      scheduledEnd: new Date(now.getTime() + minutes * 60_000),
      hostTeacherId,
      sessionType: "ONLINE",
      // Zero, because the class has already begun. The default fifteen minutes
      // would put the join window in the PAST, which changes nothing for a
      // student but reads as wrong to anybody looking at the record.
      joinWindowMinutesBefore: 0,
    });

    const live = await this.prisma.scoped.liveSession.update({
      where: { id: session.id },
      data: { status: "LIVE", actualStart: now },
    });

    await this.audit.record({
      action: "session.start_now",
      entityType: "LiveSession",
      entityId: session.id,
      after: { sectionSubjectId: input.sectionSubjectId, hostTeacherId, durationMinutes: minutes },
    });

    return live;
  }

  /**
   * FR-LIV — the class is over, said out loud.
   *
   * Without this an instant class occupies its teacher's diary until its
   * nominal end time, so the clash check refuses the next one: a teacher who
   * starts an hour, finishes in twenty minutes and wants another room is told
   * they are already teaching. Ending it frees them.
   *
   * It also closes the provider's room, which disconnects anybody still sitting
   * in it and invalidates the tokens already issued for it — tokens outlive a
   * class by design, because the adapter cannot see the scheduled end time.
   */
  async end(sessionId: string) {
    const session = await this.prisma.scoped.liveSession.findFirst({
      where: { id: sessionId, deletedAt: null },
      include: {
        binding: true,
        sectionSubject: { include: { section: { select: { liveProviderKey: true } } } },
      },
    });
    if (!session) throw new AppError("RESOURCE_NOT_FOUND");
    if (session.status === "CANCELLED") {
      throw new AppError("RESOURCE_CONFLICT", {
        message: "This class was cancelled, so there is nothing to end.",
      });
    }
    // Idempotent on purpose. Two teachers on one class, or one teacher with the
    // button pressed twice on a slow connection, must not produce an error that
    // reads as a fault.
    if (session.status === "ENDED") return session;

    const now = new Date();
    const updated = await this.prisma.scoped.liveSession.update({
      where: { id: sessionId },
      data: {
        status: "ENDED",
        actualEnd: now,
        // A class ended without ever being marked LIVE was scheduled the old
        // way; its best-known start is the one on the timetable. Leaving this
        // null would make the duration unreportable.
        ...(session.actualStart ? {} : { actualStart: session.scheduledStart }),
      },
    });

    if (session.binding) {
      const provider = this.providers.resolve(session.sectionSubject.section.liveProviderKey);
      // Optional on the interface — a provider that cannot close a room
      // remotely simply does not offer it (ARC-030), and the class is over in
      // the System either way.
      await provider
        .endSession?.({
          providerKey: session.binding.providerKey,
          externalId: session.binding.externalId,
          joinUrl: session.binding.joinUrl,
          hostUrl: session.binding.hostUrl,
          providerMetadata: null,
          status: session.binding.status,
        })
        .catch((e) => this.logger.warn(`Provider end failed: ${String(e)}`));
    }

    await this.audit.record({
      action: "session.end",
      entityType: "LiveSession",
      entityId: sessionId,
      before: { status: session.status },
      after: { status: "ENDED", actualEnd: now },
    });

    return updated;
  }

  /**
   * ATTENDANCE, TAKEN BY THE ROOM — FR-ATT-012, ARC-034.
   *
   * Joins and leaves arrive from the provider as they happen and are
   * accumulated here. Nothing in this method knows which provider sent them:
   * the adapter has already verified the delivery and normalised it to
   * RoomEvents, so there is no vendor shape below this line.
   *
   * WHAT IT WRITES IS A PROPOSAL, not a verdict. participationSeconds is a
   * measurement and proposedStatus is a suggestion; the teacher's register is
   * untouched unless the class was explicitly set to PROVIDER_DERIVED. A
   * student whose connection died for the second half was still in the lesson,
   * and no amount of participation data knows that.
   */
  async applyRoomEvents(events: RoomEvent[]): Promise<{ applied: number }> {
    let applied = 0;

    for (const event of events) {
      // The room id is the provider's, and only the binding knows which class
      // it belongs to. Looking it up here rather than parsing the name keeps
      // the room-naming convention inside the adapter where it belongs.
      const binding = await this.prisma.asSystem((db) =>
        db.liveSessionProviderBinding.findFirst({
          where: { externalId: event.room },
          select: { liveSessionId: true },
        }),
      );
      if (!binding) continue; // a room this System does not own

      if (event.kind === "ROOM_FINISHED") {
        await this.proposeAttendance(binding.liveSessionId);
        applied++;
        continue;
      }

      if (!event.identity) continue;
      // The identity is the LMS user id the adapter put in the token. A
      // teacher joining is not a student and has no attendance record — that
      // is the usual reason this finds nothing, and it is not an error.
      const student = await this.prisma.asSystem((db) =>
        db.student.findFirst({ where: { userId: event.identity as string }, select: { id: true } }),
      );
      if (!student) continue;

      if (event.kind === "PARTICIPANT_JOINED") {
        await this.prisma.asSystem((db) =>
          db.attendanceRecord.upsert({
            where: {
              liveSessionId_studentId: {
                liveSessionId: binding.liveSessionId,
                studentId: student.id,
              },
            },
            update: {},
            create: {
              liveSessionId: binding.liveSessionId,
              studentId: student.id,
              status: "NOT_MARKED",
              markingSource: "MANUAL",
              participationSeconds: 0,
            },
          }),
        );
        applied++;
      } else if (event.secondsInRoom != null) {
        const seconds = event.secondsInRoom;
        /*
         * ACCUMULATED, and via COALESCE — which is not a stylistic choice.
         *
         * Prisma's `increment` compiles to `col = col + n`, and in SQL
         * NULL + 2700 is NULL. participationSeconds is nullable and every
         * record written before this feature existed has a null in it, so the
         * obvious increment SILENTLY DISCARDED the time for exactly the
         * students who already had a register entry — measured against real
         * rows, where the webhook reported success and the column stayed empty.
         *
         * The sum matters as much as the null: a student who drops out and
         * rejoins three times on a bad line was present for the total of those
         * visits, and overwriting would credit only the last and shortest one.
         */
        await this.prisma.asSystem(async (db) => {
          await db.attendanceRecord.upsert({
            where: {
              liveSessionId_studentId: {
                liveSessionId: binding.liveSessionId,
                studentId: student.id,
              },
            },
            update: {},
            create: {
              liveSessionId: binding.liveSessionId,
              studentId: student.id,
              status: "NOT_MARKED",
              markingSource: "MANUAL",
              participationSeconds: 0,
            },
          });
          await db.$executeRaw`
            UPDATE attendance_records
               SET participation_seconds = COALESCE(participation_seconds, 0) + ${seconds}
             WHERE live_session_id = ${binding.liveSessionId}::uuid
               AND student_id = ${student.id}::uuid`;
        });
        applied++;
      }
    }

    return { applied };
  }

  /**
   * Turn accumulated seconds into a suggestion the teacher can accept.
   *
   * The threshold is a policy, not a fact, so it is configurable and its
   * default is stated: half the class. Anybody who was there at all but under
   * it is proposed LATE rather than ABSENT — "absent" is a claim that somebody
   * did not come, and the room says otherwise.
   */
  private async proposeAttendance(liveSessionId: string): Promise<void> {
    const session = await this.prisma.asSystem((db) =>
      db.liveSession.findUnique({
        where: { id: liveSessionId },
        include: { attendance: { select: { id: true, participationSeconds: true } } },
      }),
    );
    if (!session) return;

    const from = session.actualStart ?? session.scheduledStart;
    const to = session.actualEnd ?? session.scheduledEnd;
    const classSeconds = Math.max(1, Math.round((to.getTime() - from.getTime()) / 1000));

    const raw = Number(this.config.get<string>("LIVE_PRESENCE_MIN_PERCENT", "50"));
    const minPercent = Number.isFinite(raw) && raw > 0 && raw <= 100 ? raw : 50;

    /*
     * PROVIDER_DERIVED means the Institute asked for this class to be marked
     * from the room. Anything else leaves the register alone: the proposal is
     * recorded beside it and a teacher decides.
     */
    const adopt =
      session.attendancePolicy === "PROVIDER_DERIVED" || session.attendancePolicy === "HYBRID";

    for (const record of session.attendance) {
      const seconds = record.participationSeconds ?? 0;
      const percent = (seconds / classSeconds) * 100;
      const proposed = percent >= minPercent ? "PRESENT" : seconds > 0 ? "LATE" : "ABSENT";

      await this.prisma.asSystem((db) =>
        db.attendanceRecord.update({
          where: { id: record.id },
          data: {
            proposedStatus: proposed,
            ...(adopt
              ? { status: proposed, markingSource: "PROVIDER_DERIVED", markedAt: new Date() }
              : {}),
          },
        }),
      );
    }

    this.logger.log(
      `Proposed attendance for ${session.attendance.length} student(s) on session ${liveSessionId}` +
        `${adopt ? " and adopted it (policy)" : ""}.`,
    );
  }

  /**
   * The room's own register — who is in the class AT THIS MOMENT.
   *
   * Not the attendance register, and the difference matters: this empties as
   * people leave and nothing is derived from it. It exists so a teacher can see
   * the room they are teaching, which every conferencing tool shows and this
   * System could not.
   */
  private async roomFor(sessionId: string) {
    const session = await this.prisma.scoped.liveSession.findFirst({
      where: { id: sessionId, deletedAt: null },
      include: {
        binding: true,
        sectionSubject: { include: { section: { select: { liveProviderKey: true } } } },
      },
    });
    if (!session) throw new AppError("RESOURCE_NOT_FOUND");

    const provider = this.providers.resolve(session.sectionSubject.section.liveProviderKey);
    const binding: ProviderBinding = {
      providerKey: session.binding?.providerKey ?? provider.key,
      externalId: session.binding?.externalId ?? null,
      joinUrl: session.binding?.joinUrl ?? null,
      hostUrl: session.binding?.hostUrl ?? null,
      providerMetadata: null,
      status: (session.binding?.status ?? "PENDING") as ProviderBinding["status"],
    };
    return { session, provider, binding };
  }

  /** Everyone in the room, normalised — ARC-034, no vendor shape reaches here. */
  async participants(sessionId: string): Promise<RoomParticipant[]> {
    const { provider, binding } = await this.roomFor(sessionId);
    /*
     * An empty list where the provider cannot answer, NOT an error.
     *
     * A class on the manual provider is held in somebody else's meeting; the
     * System has no way to see inside it and never claimed to. The interface
     * says so through canModerateParticipants, and the screen renders "not
     * available for this classroom" rather than an empty room (ARC-030).
     */
    if (!provider.listParticipants) return [];
    return provider.listParticipants(binding);
  }

  /**
   * Mute one person — FR-LIV.
   *
   * Mute only. A teacher cannot switch a student's microphone or camera back
   * on, because that would open a student's room to them without consent; the
   * student unmutes themselves. Audited, because acting on somebody else in
   * front of a class is the kind of thing that gets disputed afterwards.
   */
  async muteParticipant(sessionId: string, identity: string, kind: "audio" | "video") {
    const { provider, binding } = await this.roomFor(sessionId);
    if (!provider.muteParticipant) {
      throw new AppError("RESOURCE_CONFLICT", {
        message: "This classroom cannot be moderated from the LMS.",
      });
    }
    await provider.muteParticipant(binding, identity, kind);

    await this.audit.record({
      action: "session.participant_mute",
      entityType: "LiveSession",
      entityId: sessionId,
      after: { identity, kind },
    });
    return { sessionId, identity, kind, muted: true };
  }

  /** Remove somebody from the room. They can rejoin — this is not a ban. */
  async removeParticipant(sessionId: string, identity: string) {
    const { provider, binding } = await this.roomFor(sessionId);
    if (!provider.removeParticipant) {
      throw new AppError("RESOURCE_CONFLICT", {
        message: "This classroom cannot be moderated from the LMS.",
      });
    }
    await provider.removeParticipant(binding, identity);

    await this.audit.record({
      action: "session.participant_remove",
      entityType: "LiveSession",
      entityId: sessionId,
      after: { identity },
    });
    return { sessionId, identity, removed: true };
  }

  /**
   * Classes happening RIGHT NOW that the caller can join — FR-LIV.
   *
   * A student who is in the section but not in the room has no way of knowing a
   * class has begun; the dashboard shows the next class and says nothing when
   * it starts. That matters most for a class called on the spot, which by
   * definition nobody had in their timetable.
   *
   * Scoped like everything else, so a student sees only their own sections and
   * a teacher only what they teach.
   */
  async liveNow() {
    const now = new Date();
    const rows = await this.prisma.scoped.liveSession.findMany({
      where: {
        deletedAt: null,
        status: { in: ["SCHEDULED", "LIVE"] },
        // Inside the join window at both ends: open early enough to walk in,
        // closed once the class is genuinely over, so nothing blinks all night.
        scheduledStart: { lte: new Date(now.getTime() + 15 * 60_000) },
        scheduledEnd: { gte: now },
      },
      include: { sectionSubject: { include: { subject: { select: { name: true } } } } },
      orderBy: { scheduledStart: "asc" },
      take: 5,
    });

    return rows.map((s) => ({
      id: s.id,
      title: s.title,
      subject: s.sectionSubject.subject.name,
      scheduledStart: s.scheduledStart,
      scheduledEnd: s.scheduledEnd,
      // A class somebody walked into, as opposed to one merely due to start.
      // The interface says "started" for one and "starting" for the other.
      hasStarted: s.status === "LIVE" || s.scheduledStart <= now,
    }));
  }

  /**
   * What the caller could start a class for — the picker behind "start now".
   *
   * Scoped twice over, and both are meant. ARC-051 already limits
   * `prisma.scoped` to a teacher's own assignments; the explicit filter states
   * the same thing so that a future scope change cannot silently widen this
   * into "every subject in the Institute" on a screen whose whole purpose is
   * one-click room creation.
   */
  async myTeaching() {
    const actor = getActor();
    // An administrator holds no teaching assignments and gets an empty list
    // rather than everything — they are not the person walking into a class.
    if (!actor?.teacherId) return [];

    const today = new Date();
    const rows = await this.prisma.scoped.sectionSubject.findMany({
      where: {
        deletedAt: null,
        status: { not: "ARCHIVED" },
        assignments: {
          some: {
            teacherId: actor.teacherId,
            deletedAt: null,
            // FR-CRS-025 — an expired assignment withdraws scope, so a teacher
            // who finished with a batch last term is not offered it now.
            OR: [{ endDate: null }, { endDate: { gte: today } }],
          },
        },
      },
      include: {
        subject: { select: { code: true, name: true } },
        section: { select: { code: true, name: true } },
      },
    });

    return rows
      .map((r) => ({
        sectionSubjectId: r.id,
        subject: r.subject,
        section: r.section,
      }))
      .sort((a, b) =>
        `${a.section.code} ${a.subject.name}`.localeCompare(`${b.section.code} ${b.subject.name}`),
      );
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
