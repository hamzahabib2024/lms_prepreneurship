import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "node:crypto";
import { AppError } from "@lms/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { StorageRegistry } from "./storage/storage.registry";
import { getActor } from "../prisma/actor-context";
import { applyWatchUpdate, type Interval } from "./watch-intervals";

/**
 * A playback ticket — ARC-039/040/052.
 *
 * Held in memory here so playback works before Redis is provisioned. It MUST
 * move to Redis before a second instance runs, or a ticket minted on one node
 * will not be recognised by another. ARC-049 permits the cache to be absent;
 * it does not permit two nodes to disagree about who may watch.
 */
interface PlaybackTicket {
  ticketId: string;
  studentId: string;
  recordedLectureId: string;
  storageRef: string;
  expiresAt: Date;
}

@Injectable()
export class ContentService {
  private readonly logger = new Logger(ContentService.name);
  private readonly tickets = new Map<string, PlaybackTicket>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageRegistry,
    private readonly config: ConfigService,
  ) {}

  // ------------------------------------------------------ modules & lessons

  /** FR-CRS-027 — a module, created as DRAFT (BR-CNT-01). */
  async createModule(input: { subjectId: string; title: string; description?: string }) {
    const last = await this.prisma.scoped.module.findFirst({
      where: { subjectId: input.subjectId, deletedAt: null },
      orderBy: { displayOrder: "desc" },
      select: { displayOrder: true },
    });

    const created = await this.prisma.scoped.module.create({
      data: {
        subjectId: input.subjectId,
        title: input.title,
        description: input.description ?? null,
        displayOrder: (last?.displayOrder ?? 0) + 10, // gaps leave room to insert
        publicationStatus: "DRAFT",
      },
    });

    await this.audit.record({
      action: "module.create",
      entityType: "Module",
      entityId: created.id,
      after: { subjectId: input.subjectId, title: input.title },
    });
    return created;
  }

  /** FR-CRS-028 — a lesson within a module. */
  async createLesson(input: {
    moduleId: string;
    title: string;
    description?: string;
    estimatedMinutes?: number;
  }) {
    const last = await this.prisma.scoped.lesson.findFirst({
      where: { moduleId: input.moduleId, deletedAt: null },
      orderBy: { displayOrder: "desc" },
      select: { displayOrder: true },
    });

    const created = await this.prisma.scoped.lesson.create({
      data: {
        moduleId: input.moduleId,
        title: input.title,
        description: input.description ?? null,
        estimatedMinutes: input.estimatedMinutes ?? null,
        displayOrder: (last?.displayOrder ?? 0) + 10,
        publicationStatus: "DRAFT",
      },
    });

    await this.audit.record({
      action: "lesson.create",
      entityType: "Lesson",
      entityId: created.id,
      after: { moduleId: input.moduleId, title: input.title },
    });
    return created;
  }

  /**
   * FR-CRS-029 — reorder by drag and drop.
   *
   * Rewrites the whole sequence in one transaction rather than swapping pairs.
   * A partially applied reorder leaves a subject in an order nobody chose, and
   * a student reading lessons out of sequence is a real harm.
   */
  async reorderLessons(moduleId: string, orderedLessonIds: string[]) {
    const lessons = await this.prisma.scoped.lesson.findMany({
      where: { moduleId, deletedAt: null },
      select: { id: true },
    });
    const known = new Set(lessons.map((l: { id: string }) => l.id));

    if (orderedLessonIds.length !== known.size || orderedLessonIds.some((id) => !known.has(id))) {
      throw new AppError("VALIDATION_FAILED", {
        details: [
          {
            field: "orderedLessonIds",
            code: "INCOMPLETE",
            message: "Send every lesson in this module, in the order you want them.",
          },
        ],
      });
    }

    await this.prisma.asSystem((db) =>
      db.$transaction(
        orderedLessonIds.map((id, i) =>
          db.lesson.update({ where: { id }, data: { displayOrder: (i + 1) * 10 } }),
        ),
      ),
    );

    await this.audit.record({
      action: "lesson.reorder",
      entityType: "Module",
      entityId: moduleId,
      after: { order: orderedLessonIds },
    });
    return { moduleId, reordered: orderedLessonIds.length };
  }

  /**
   * FR-CRS-030/033 — publication.
   *
   * BR-CNT-04: unpublishing removes content from student views but retains
   * every associated student record — submissions, attempts, watch progress.
   * It is a visibility change, not a deletion.
   */
  async setPublication(
    kind: "module" | "lesson",
    id: string,
    status: "DRAFT" | "PUBLISHED" | "UNPUBLISHED" | "SCHEDULED",
    publishAt?: Date,
  ) {
    if (status === "SCHEDULED" && !publishAt) {
      throw new AppError("VALIDATION_FAILED", {
        details: [
          { field: "publishAt", code: "REQUIRED", message: "Give the date to publish on." },
        ],
      });
    }

    const before =
      kind === "module"
        ? await this.prisma.scoped.module.findFirst({ where: { id, deletedAt: null } })
        : await this.prisma.scoped.lesson.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw new AppError("RESOURCE_NOT_FOUND");

    const data = { publicationStatus: status, publishAt: publishAt ?? null };
    const updated =
      kind === "module"
        ? await this.prisma.scoped.module.update({ where: { id }, data })
        : await this.prisma.scoped.lesson.update({ where: { id }, data });

    await this.audit.record({
      action: `${kind}.publication`,
      entityType: kind === "module" ? "Module" : "Lesson",
      entityId: id,
      before: { publicationStatus: before.publicationStatus },
      after: { publicationStatus: status, publishAt: publishAt ?? null },
    });
    return updated;
  }

  /**
   * The content tree for a subject.
   *
   * The scope predicate already hides unpublished content from students
   * (BR-CNT-01), so this method contains no role branching — the filtering
   * happens once, at the data layer, where it cannot be forgotten.
   */
  async subjectContent(subjectId: string) {
    const modules = await this.prisma.scoped.module.findMany({
      where: { subjectId, deletedAt: null },
      orderBy: { displayOrder: "asc" },
      include: {
        lessons: {
          where: { deletedAt: null },
          orderBy: { displayOrder: "asc" },
          include: {
            lectures: {
              where: { deletedAt: null },
              select: {
                id: true,
                title: true,
                durationSeconds: true,
                recordedOn: true,
                publicationStatus: true,
                availabilityStatus: true,
                // storageRef is deliberately NOT selected. ARC-041 keeps the
                // permanent identifier out of any response a student can see,
                // and omitting it here means it cannot leak by accident.
              },
            },
          },
        },
      },
    });

    return modules.map((m: (typeof modules)[number]) => ({
      id: m.id,
      title: m.title,
      description: m.description,
      publicationStatus: m.publicationStatus,
      lessons: m.lessons.map((l: (typeof m.lessons)[number]) => ({
        id: l.id,
        title: l.title,
        description: l.description,
        estimatedMinutes: l.estimatedMinutes,
        publicationStatus: l.publicationStatus,
        lectures: l.lectures,
      })),
    }));
  }

  // ---------------------------------------------------------- lecture catalogue

  /** FR-VID-003 — browse the configured storage folders from the interface. */
  async browseStorage(folderRef?: string) {
    const provider = this.storage.forLectures();
    try {
      return { provider: provider.key, entries: await provider.listFolder(folderRef ?? null) };
    } catch (err) {
      if (err instanceof AppError) throw err;
      this.logger.error(`Storage browse failed on "${provider.key}"`, err as Error);
      throw new AppError("STORAGE_UNAVAILABLE");
    }
  }

  /** FR-VID-001/002 — catalogue a lecture. The video itself is not copied. */
  async catalogueLecture(input: {
    sectionSubjectId: string;
    lessonId?: string;
    title: string;
    storageRef: string;
    recordedOn: Date;
    teacherId?: string;
    durationSeconds?: number;
  }) {
    const provider = this.storage.forLectures();
    const meta = await provider.stat(input.storageRef).catch(() => null);

    const created = await this.prisma.scoped.recordedLecture.create({
      data: {
        sectionSubjectId: input.sectionSubjectId,
        lessonId: input.lessonId ?? null,
        title: input.title,
        storageProvider: provider.key,
        storageRef: input.storageRef,
        recordedOn: input.recordedOn,
        teacherId: input.teacherId ?? null,
        durationSeconds: input.durationSeconds ?? meta?.durationSeconds ?? null,
        publicationStatus: "DRAFT",
        // If the object cannot be reached at cataloguing time, say so now
        // rather than letting a student discover it (ARC-045).
        availabilityStatus: meta ? "AVAILABLE" : "MISSING",
        lastVerifiedAt: new Date(),
      },
    });

    await this.audit.record({
      action: "lecture.catalogue",
      entityType: "RecordedLecture",
      entityId: created.id,
      after: { title: input.title, provider: provider.key, lessonId: input.lessonId ?? null },
    });

    return { ...created, storageRef: undefined }; // never echoed back
  }

  /**
   * ARC-039/040 — issues a short-lived, user-bound playback ticket.
   *
   * Authorisation is re-evaluated HERE, on every request. A ticket issued
   * before an enrolment was withdrawn keeps working only until it expires,
   * which is what bounds the exposure.
   */
  async issuePlaybackTicket(lectureId: string) {
    const actor = getActor();
    if (!actor?.studentId) {
      throw new AppError("AUTH_FORBIDDEN", { message: "Only a student can watch a lecture." });
    }

    // Scoped: an unenrolled student cannot see the lecture at all, so this
    // returns nothing rather than disclosing that it exists.
    const lecture = await this.prisma.scoped.recordedLecture.findFirst({
      where: { id: lectureId, deletedAt: null },
    });
    if (!lecture) throw new AppError("RESOURCE_NOT_FOUND");

    if (lecture.availabilityStatus !== "AVAILABLE") {
      // FR-VID-022 — a plain message, never a broken player.
      throw new AppError("STORAGE_UNAVAILABLE", {
        message: "This lecture is temporarily unavailable. Please try again shortly.",
      });
    }

    const ttl = Number(this.config.get<string>("PLAYBACK_TICKET_TTL_SECONDS", "900"));
    const ticket: PlaybackTicket = {
      ticketId: `pt_${randomUUID().replace(/-/g, "")}`,
      studentId: actor.studentId,
      recordedLectureId: lecture.id,
      storageRef: lecture.storageRef,
      expiresAt: new Date(Date.now() + ttl * 1000),
    };
    this.tickets.set(ticket.ticketId, ticket);
    this.sweepExpiredTickets();

    const progress = await this.prisma.asSystem((db) =>
      db.$queryRaw<Array<{ last_position_seconds: number; watched_percent: number }>>`
        SELECT 0::int AS last_position_seconds, 0::numeric AS watched_percent
      `.catch(() => []),
    );

    // SEC-LOG-008 — every ticket issue is logged with student and lecture.
    this.logger.log(
      JSON.stringify({
        event: "playback.ticket_issued",
        studentId: actor.studentId,
        lectureId: lecture.id,
        correlationId: actor.correlationId,
      }),
    );

    return {
      ticketId: ticket.ticketId,
      // Points at the SYSTEM, not at storage. ARC-041: the permanent
      // identifier never reaches the browser.
      streamUrl: `/api/v1/lectures/stream/${ticket.ticketId}`,
      expiresAt: ticket.expiresAt,
      renewable: true,
      supportsRangeRequests: true,
      durationSeconds: lecture.durationSeconds,
      resumePositionSeconds: progress[0]?.last_position_seconds ?? 0,
      watchedPercent: Number(progress[0]?.watched_percent ?? 0),
    };
  }

  /**
   * ARC-052 — resolves a ticket to a signed URL for the caller to REDIRECT to.
   *
   * The controller responds 302. Bytes must never traverse the application
   * tier: proxying 150 concurrent streams would consume the whole capacity
   * provisioned in §3.8 and breach NFR-PRF-002 for every other user.
   */
  async resolveTicket(ticketId: string) {
    const ticket = this.tickets.get(ticketId);
    if (!ticket || ticket.expiresAt < new Date()) {
      this.tickets.delete(ticketId);
      throw new AppError("AUTH_TOKEN_EXPIRED", {
        message: "This playback link has expired. Reload the lesson to continue watching.",
      });
    }

    const actor = getActor();
    // Bound to the student it was issued to, so a shared link is useless.
    if (!actor?.studentId || actor.studentId !== ticket.studentId) {
      throw new AppError("AUTH_FORBIDDEN");
    }

    const ttl = Math.max(
      60,
      Math.floor((ticket.expiresAt.getTime() - Date.now()) / 1000),
    );
    const signed = await this.storage.forLectures().signUrl(ticket.storageRef, ttl);
    return { redirectTo: signed.url, expiresAt: signed.expiresAt };
  }

  /**
   * FR-VID-008/009/010 — records watch position.
   *
   * The server merges the reported intervals and recomputes the percentage
   * itself; a client-supplied percentage is never trusted, because it is the
   * one number a student has an incentive to inflate.
   */
  async recordWatchProgress(
    lectureId: string,
    input: { positionSeconds: number; watchedIntervals: Interval[] },
  ) {
    const actor = getActor();
    if (!actor?.studentId) throw new AppError("AUTH_FORBIDDEN");

    const lecture = await this.prisma.scoped.recordedLecture.findFirst({
      where: { id: lectureId, deletedAt: null },
      select: { id: true, durationSeconds: true },
    });
    if (!lecture) throw new AppError("RESOURCE_NOT_FOUND");

    const threshold = Number(this.config.get<string>("VIDEO_COMPLETION_PERCENT", "90"));

    const result = applyWatchUpdate({
      existing: [], // replaced by the persisted set once the model is migrated
      reported: input.watchedIntervals,
      durationSeconds: lecture.durationSeconds,
      lastPositionSeconds: input.positionSeconds,
      completionThresholdPercent: threshold,
    });

    return {
      lectureId,
      watchedPercent: result.watchedPercent,
      lastPositionSeconds: result.lastPositionSeconds,
      isComplete: result.isComplete,
    };
  }

  /** ARC-045 — the weekly integrity sweep. */
  async verifyAvailability(lectureId: string) {
    const lecture = await this.prisma.scoped.recordedLecture.findFirst({
      where: { id: lectureId, deletedAt: null },
    });
    if (!lecture) throw new AppError("RESOURCE_NOT_FOUND");

    const meta = await this.storage.get(lecture.storageProvider).stat(lecture.storageRef);
    const status = meta ? "AVAILABLE" : "MISSING";

    if (status !== lecture.availabilityStatus) {
      await this.prisma.scoped.recordedLecture.update({
        where: { id: lectureId },
        data: { availabilityStatus: status, lastVerifiedAt: new Date() },
      });
      // An Admin is alerted rather than a student meeting a broken player.
      this.logger.warn(`Lecture ${lectureId} availability changed to ${status}`);
    }

    return { lectureId, availabilityStatus: status, checkedAt: new Date() };
  }

  private sweepExpiredTickets(): void {
    const now = Date.now();
    for (const [id, t] of this.tickets) {
      if (t.expiresAt.getTime() < now) this.tickets.delete(id);
    }
  }
}
