import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "node:crypto";
import { AppError } from "@lms/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { StorageRegistry } from "./storage/storage.registry";
import { LectureSyncService } from "./lecture-sync.service";
import { getActor } from "../prisma/actor-context";
import { assertOwnsSectionSubject } from "../rbac/ownership";
import { applyWatchUpdate, type Interval } from "./watch-intervals";

/** What the player needs to render a lecture row and resume it. */
export interface WatchState {
  watchedPercent: number;
  lastPositionSeconds: number;
  isComplete: boolean;
}

/**
 * Reads `watchedIntervals` back out of the JSON column.
 *
 * A JSON column has no schema, so this validates rather than casts. Anything
 * malformed degrades to "watched nothing", which loses progress but keeps the
 * lecture playable — the alternative is a crash on a corrupt row, which would
 * lock the student out of the subject entirely.
 */
function parseIntervals(raw: unknown): Interval[] {
  if (!Array.isArray(raw)) return [];
  const out: Interval[] = [];
  for (const item of raw) {
    if (!Array.isArray(item) || item.length !== 2) continue;
    const [start, end] = item;
    if (typeof start !== "number" || typeof end !== "number") continue;
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    out.push([start, end]);
  }
  return out;
}

@Injectable()
export class ContentService {
  private readonly logger = new Logger(ContentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageRegistry,
    private readonly config: ConfigService,
    // Re-pointing a class at a different folder has to import what is in the
    // new one, in the same act — see setLectureFolder.
    private readonly lectureSync: LectureSyncService,
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
    kind: "module" | "lesson" | "lecture",
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

    // A recording has no publishAt column, so it cannot be scheduled. Saying so
    // is better than accepting the request and silently publishing at once.
    if (kind === "lecture" && status === "SCHEDULED") {
      throw new AppError("VALIDATION_FAILED", {
        details: [
          {
            field: "status",
            code: "NOT_SUPPORTED",
            message:
              "A recording cannot be scheduled. Schedule the lesson it belongs to instead.",
          },
        ],
      });
    }

    const before =
      kind === "module"
        ? await this.prisma.scoped.module.findFirst({ where: { id, deletedAt: null } })
        : kind === "lesson"
          ? await this.prisma.scoped.lesson.findFirst({ where: { id, deletedAt: null } })
          : await this.prisma.scoped.recordedLecture.findFirst({
              where: { id, deletedAt: null },
            });
    if (!before) throw new AppError("RESOURCE_NOT_FOUND");

    const updated =
      kind === "module"
        ? await this.prisma.scoped.module.update({
            where: { id },
            data: { publicationStatus: status, publishAt: publishAt ?? null },
          })
        : kind === "lesson"
          ? await this.prisma.scoped.lesson.update({
              where: { id },
              data: { publicationStatus: status, publishAt: publishAt ?? null },
            })
          : await this.prisma.scoped.recordedLecture.update({
              where: { id },
              data: { publicationStatus: status },
            });

    await this.audit.record({
      action: `${kind}.publication`,
      entityType:
        kind === "module" ? "Module" : kind === "lesson" ? "Lesson" : "RecordedLecture",
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
    // BR-CNT-01 restated for the NESTED reads.
    //
    // The Module policy filters the top-level query; it does NOT reach lessons
    // or lectures loaded alongside it (see the note in scope.extension.ts). A
    // draft lecture inside a PUBLISHED module was therefore visible to
    // students — a teacher preparing next week's material would have published
    // it by accident.
    //
    // Matching the Lesson and RecordedLecture policies deliberately: those
    // policies are the specification, this is the restatement the include
    // requires.
    const actor = getActor();
    const isStudent = actor?.roles.includes("student") === true;
    const lessonVisibility = isStudent ? { publicationStatus: "PUBLISHED" as const } : {};
    const lectureVisibility = isStudent
      ? { publicationStatus: "PUBLISHED" as const, availabilityStatus: "AVAILABLE" as const }
      : {};

    const modules = await this.prisma.scoped.module.findMany({
      where: { subjectId, deletedAt: null },
      orderBy: { displayOrder: "asc" },
      include: {
        lessons: {
          where: { deletedAt: null, ...lessonVisibility },
          orderBy: { displayOrder: "asc" },
          include: {
            lectures: {
              where: { deletedAt: null, ...lectureVisibility },
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

    // One query for every lecture on the page rather than one per row.
    // Returns empty for a teacher or admin, who have no watch state of their
    // own — the field is simply absent for them.
    const watch = await this.watchStateFor(
      modules.flatMap((m: (typeof modules)[number]) =>
        m.lessons.flatMap((l: (typeof m.lessons)[number]) => l.lectures.map((v) => v.id)),
      ),
    );

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
        lectures: l.lectures.map((v: (typeof l.lectures)[number]) => ({
          ...v,
          // FR-VID-008 — so the list can show how far through each lecture the
          // student is, and offer "resume" rather than restarting from zero.
          watch: watch.get(v.id) ?? null,
        })),
      })),
    }));
  }

  // ---------------------------------------------------------- lecture catalogue

  /** FR-VID-003 — browse the configured storage folders from the interface. */
  /**
   * Every recording for one class — FR-VID-005.
   *
   * THE SYNC MADE LECTURES NOBODY COULD SEE. A recording arrives from the
   * folder with no lesson attached, and the content tree is modules → lessons
   * → lectures — so a synced lecture existed in the database and appeared on
   * no screen at all until somebody bound it to a lesson by hand. The whole
   * point of the sweep is that a recording put in the folder turns up; a row
   * only a database client can see is not turning up.
   *
   * WHAT EACH ROLE SEES IS THE POINT. A student gets PUBLISHED recordings on a
   * class they are enrolled in — the scope predicate decides the second part
   * and this decides the first. Staff get everything including drafts, because
   * a draft they cannot see is one they cannot publish.
   */
  /**
   * Every class the person asking is entitled to see — the Courses screen.
   *
   * THIS EXISTED NOWHERE. The course page has been reachable only by knowing a
   * UUID, or by drilling three levels into Sections: term → batch → section →
   * a "Recordings" link on one row. A student had "My subjects"; staff had a
   * page and no way to it. So the whole recordings feature was, for an
   * administrator, effectively invisible.
   *
   * SCOPED, NOT FILTERED HERE. The query runs on `prisma.scoped`, so ARC-051's
   * predicate decides the rows: an administrator sees the Institute, a teacher
   * sees what they are assigned to, a student sees what they are enrolled on.
   * There is no role test in this method, and there must not be — the moment
   * one appears here it is a second place that can disagree with the matrix.
   *
   * WHAT AN ADMINISTRATOR NEEDS FROM IT is not a prettier list of subjects: it
   * is which classes have no folder connected, and which have recordings
   * waiting to be published. Both are invisible from anywhere else, and both
   * are the reason a student says "last Tuesday's class isn't there".
   */
  async listCourses() {
    const actor = getActor();
    if (!actor) throw new AppError("AUTH_TOKEN_INVALID");
    const isStudent = actor.roles.includes("student") && !actor.roles.some((r) => r !== "student");

    const offerings = await this.prisma.scoped.sectionSubject.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        lectureFolderRef: true,
        meetingUrl: true,
        meetingNote: true,
        subject: { select: { id: true, code: true, name: true } },
        section: {
          select: {
            id: true,
            code: true,
            name: true,
            status: true,
            batch: { select: { academicSession: { select: { name: true } } } },
          },
        },
        assignments: {
          where: { deletedAt: null },
          select: { teacher: { select: { user: { select: { fullName: true } } } } },
          take: 2,
        },
      },
    });

    if (offerings.length === 0) return [];

    // One grouped count for the whole page rather than a query per card. A
    // teacher with twelve classes would otherwise cost twelve round trips to
    // render a list nobody has clicked on yet.
    const counts = await this.prisma.asSystem((db) =>
      db.recordedLecture.groupBy({
        by: ["sectionSubjectId", "publicationStatus"],
        where: { sectionSubjectId: { in: offerings.map((o) => o.id) }, deletedAt: null },
        _count: { _all: true },
        _max: { recordedOn: true },
      }),
    );

    const tally = new Map<string, { published: number; drafts: number; latest: Date | null }>();
    for (const row of counts) {
      const entry = tally.get(row.sectionSubjectId) ?? { published: 0, drafts: 0, latest: null };
      const n = row._count._all;
      if (row.publicationStatus === "PUBLISHED") entry.published += n;
      else entry.drafts += n;
      const max = row._max.recordedOn;
      if (max && (!entry.latest || max > entry.latest)) entry.latest = max;
      tally.set(row.sectionSubjectId, entry);
    }

    return offerings
      .map((o) => {
        const t = tally.get(o.id) ?? { published: 0, drafts: 0, latest: null };
        return {
          id: o.id,
          subject: o.subject,
          section: {
            id: o.section.id,
            code: o.section.code,
            name: o.section.name,
            status: o.section.status,
            session: o.section.batch?.academicSession?.name ?? null,
          },
          teachers: o.assignments.map((a) => a.teacher.user.fullName),
          publishedCount: t.published,
          // A student is never told how many drafts exist. The number alone
          // says "your teacher has recorded four classes and shown you none",
          // which is a conversation the System should not start.
          draftCount: isStudent ? 0 : t.drafts,
          // Nor where the files live (ARC-041) — only whether it is set up,
          // which is all a student could act on anyway.
          folderConnected: o.lectureFolderRef !== null,
          lectureFolderRef: isStudent ? null : o.lectureFolderRef,
          /*
           * THE CLASS'S ROOM, and the one field here a STUDENT needs more than
           * staff do. Unlike the folder reference above it is not withheld:
           * the whole point is that a student clicks it. It reaches only
           * people the scope predicate already lets into this class, and it is
           * in no public projection.
           */
          meetingUrl: o.meetingUrl,
          meetingNote: o.meetingNote,
          latestRecordingOn: t.latest,
          canManage: !isStudent,
        };
      })
      .sort(
        (a, b) =>
          // Most recently taught first: the class somebody is looking for is
          // almost always the one that just happened. Classes with nothing
          // recorded sort to the bottom rather than the top, where an
          // alphabetical list would put half of them.
          (b.latestRecordingOn?.getTime() ?? 0) - (a.latestRecordingOn?.getTime() ?? 0) ||
          a.subject.name.localeCompare(b.subject.name),
      );
  }

  async lecturesFor(sectionSubjectId: string) {
    const actor = getActor();
    if (!actor) throw new AppError("AUTH_TOKEN_INVALID");
    const isStudent = actor.roles.includes("student") && !actor.roles.some((r) => r !== "student");

    // findFirst on the SCOPED client: a student asking about a class they are
    // not enrolled in gets nothing, and so does a teacher asking about one
    // they do not teach. The authorisation and the lookup are one query.
    const offering = await this.prisma.scoped.sectionSubject.findFirst({
      where: { id: sectionSubjectId, deletedAt: null },
      select: {
        id: true,
        lectureFolderRef: true,
        meetingUrl: true,
        meetingNote: true,
        subject: { select: { id: true, code: true, name: true } },
        section: { select: { code: true, name: true } },
      },
    });
    if (!offering) throw new AppError("RESOURCE_NOT_FOUND");

    const lectures = await this.prisma.asSystem((db) =>
      db.recordedLecture.findMany({
        where: {
          sectionSubjectId,
          deletedAt: null,
          ...(isStudent ? { publicationStatus: "PUBLISHED" } : {}),
        },
        orderBy: [{ recordedOn: "desc" }, { createdAt: "desc" }],
        select: {
          id: true,
          title: true,
          description: true,
          durationSeconds: true,
          recordedOn: true,
          publicationStatus: true,
          availabilityStatus: true,
          lessonId: true,
          // WHICH provider it was catalogued from — "google_drive" or "local".
          // Not a reference to anything and not secret; it is the name of a
          // mechanism, and it is what lets the screen say honestly whether
          // these came from Drive. NEVER storageRef: that is the permanent
          // identifier ARC-041 keeps away from students, and this list is read
          // by students.
          storageProvider: true,
        },
      }),
    );

    // FR-VID-008 — how far through each one this student already is, so the
    // list can show a progress bar and offer to resume rather than restart.
    // One query for the whole page. Empty for staff, who have no watch state
    // of their own, and the field is then simply absent.
    const watch = await this.watchStateFor(lectures.map((l) => l.id));

    /*
     * WHERE THESE ACTUALLY COME FROM, said plainly.
     *
     * The screen used to state "read from <folder>, checked every hour" no
     * matter what, and that can be flatly untrue: the rows can say
     * google_drive while LECTURE_STORAGE is local, in which case the sweep
     * looks for a local directory named after a Drive folder id, finds
     * nothing, and NOTHING NEW EVER ARRIVES — silently, with the screen still
     * promising hourly updates.
     *
     * That mismatch is exactly the question anybody asks about a catalogue
     * like this — "is this live?" — and it should be answerable by looking at
     * the page rather than by asking whoever built it.
     *
     * No network call: this compares what the lectures were catalogued from
     * against what is configured now. A health check per page load would cost
     * a round trip to Google to render a list.
     */
    const configured = this.storage.forLectures().key;
    const sources = [...new Set(lectures.map((l) => l.storageProvider))];
    const stale = sources.filter((s) => s !== configured);

    return {
      subject: offering.subject,
      section: offering.section,
      // Staff only: a student has no business knowing where the files live.
      lectureFolderRef: isStudent ? null : offering.lectureFolderRef,
      // The room, for everybody in the class — see the note on the list above.
      meetingUrl: offering.meetingUrl,
      meetingNote: offering.meetingNote,
      canManage: !isStudent,
      storage: {
        provider: configured,
        // True only when every catalogued recording came from the provider
        // that is configured now — which is what "these will play, and new
        // ones will appear" actually requires.
        live: offering.lectureFolderRef !== null && stale.length === 0,
        mismatchedSources: stale,
      },
      lectures: lectures.map((l) => ({ ...l, watch: watch.get(l.id) ?? null })),
    };
  }

  /**
   * Connect a class to the folder its recordings arrive in — FR-VID-003.
   *
   * An empty string disconnects it, which is why the field is not a UUID and
   * not optional: "" is a decision to stop syncing, and undefined would be
   * indistinguishable from a caller that forgot the field.
   */
  async setLectureFolder(sectionSubjectId: string, folderRef: string) {
    // findFirst on the scoped client — a teacher naming a class they do not
    // teach gets nothing back, so the check and the authorisation are one query.
    const offering = await this.prisma.scoped.sectionSubject.findFirst({
      where: { id: sectionSubjectId, deletedAt: null },
      select: { id: true, lectureFolderRef: true },
    });
    if (!offering) throw new AppError("RESOURCE_NOT_FOUND");

    const value = folderRef.trim() === "" ? null : folderRef.trim();

    /*
     * NOTHING CHANGED, SO NOTHING HAPPENS.
     *
     * Saving the same folder again is a common accident — the form is
     * submitted, the value is identical — and it must not sweep the catalogue
     * aside and rebuild it. Everything destructive below is guarded by this.
     */
    if (value === offering.lectureFolderRef) {
      return { id: offering.id, lectureFolderRef: value, cleared: 0, imported: null };
    }

    /*
     * THE NEW FOLDER IS PROVED READABLE BEFORE THE OLD CATALOGUE IS TOUCHED.
     *
     * The order matters more than it looks. Setting the reference first and
     * discovering afterwards that the folder is unshared, mistyped or in
     * somebody else's Drive would leave the class with its old recordings
     * already put aside and nothing to replace them — a class that had ten
     * lectures a moment ago now has none, and the message says "folder not
     * found". Listing it first turns that into a refusal that changes nothing.
     */
    if (value) {
      const provider = this.storage.forLectures();
      // Throws a readable AppError when the folder is gone or not shared —
      // the provider already words that one properly, so it is not caught.
      await provider.listFolder(value);
    }

    const updated = await this.prisma.scoped.sectionSubject.update({
      where: { id: sectionSubjectId },
      data: { lectureFolderRef: value },
      select: { id: true, lectureFolderRef: true },
    });

    /*
     * THE OLD FOLDER'S RECORDINGS ARE PUT ASIDE — FR-VID-003.
     *
     * They were catalogued from a folder that is no longer this class's, so
     * leaving them would mean a class listing recordings from somewhere else
     * while the hourly sweep marked them MISSING one by one — which reads as
     * the Institute losing files rather than as a folder having been changed.
     *
     * SOFT, ALWAYS. A student's watch progress hangs off these rows and is
     * their record of their own work; it is not ours to destroy because an
     * administrator corrected a folder. The sync below revives by storage
     * reference, so anything present in the NEW folder comes straight back
     * with its history — and so does everything else if somebody re-links the
     * old folder after a mistake.
     */
    const cleared = await this.prisma.asSystem((db) =>
      db.recordedLecture.updateMany({
        where: { sectionSubjectId, deletedAt: null },
        data: { deletedAt: new Date() },
      }),
    );

    await this.audit.record({
      action: value ? "lecture_folder.set" : "lecture_folder.cleared",
      entityType: "SectionSubject",
      entityId: sectionSubjectId,
      before: { lectureFolderRef: offering.lectureFolderRef },
      after: { lectureFolderRef: value, setAside: cleared.count },
    });

    /*
     * AND THE NEW FOLDER IS READ IMMEDIATELY, in the same act.
     *
     * Connecting a folder and then waiting up to an hour for the sweep is the
     * behaviour that makes this look broken: the administrator points at the
     * right folder, the page still shows nothing, and the natural conclusion
     * is that the folder is wrong.
     *
     * A failure here does not fail the change — the folder IS connected and
     * the hourly sweep will catch it — so the error is reported alongside
     * rather than thrown over the top of a successful update.
     */
    let imported: Awaited<ReturnType<LectureSyncService["sync"]>> | null = null;
    let importError: string | null = null;
    if (value) {
      try {
        imported = await this.lectureSync.sync(sectionSubjectId);
      } catch (err) {
        importError = err instanceof Error ? err.message : "The new folder could not be read.";
        this.logger.warn(
          `Folder for section-subject ${sectionSubjectId} was connected but not imported: ${importError}`,
        );
      }
    }

    return {
      ...updated,
      /** How many recordings from the previous folder were put aside. */
      cleared: cleared.count,
      /** What the new folder yielded, or null when there is no new folder. */
      imported,
      ...(importError ? { importError } : {}),
    };
  }

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

    // The scope predicate does not constrain a create, so the subject-section
    // the caller named has to be checked here.
    assertOwnsSectionSubject(input.sectionSubjectId);

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
    /*
     * ANYONE THE MATRIX LETS WATCH, CAN WATCH.
     *
     * This used to read `if (!actor?.studentId) throw AUTH_FORBIDDEN` — "only
     * a student can watch a lecture" — which refused THREE OF THE FOUR ROLES
     * that §4.5 grants lecture_playback:read to. A teacher could publish a
     * recording to thirty students and never once watch it back to check it;
     * an administrator could not open a single one. The permission existed and
     * nothing could satisfy it.
     *
     * The only test needed here is that somebody is signed in. WHICH lectures
     * they may open is not decided in this method and must not be: the scoped
     * query below is the whole of it, and it already answers correctly for
     * every role — ALL for an administrator, ASSIGNED for a teacher, ENROLLED
     * for a student. A role test here would be a second opinion that can
     * disagree with the matrix.
     */
    if (!actor?.userId) throw new AppError("AUTH_TOKEN_INVALID");

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
    const ticket = {
      ticketId: `pt_${randomUUID().replace(/-/g, "")}`,
      userId: actor.userId,
      // Null for staff. It is what watch progress hangs off, and a teacher
      // checking their own recording is not coursework — counting it would put
      // their viewing into a student's completion figures (BR-PRG-02).
      studentId: actor.studentId ?? null,
      recordedLectureId: lecture.id,
      storageRef: lecture.storageRef,
      expiresAt: new Date(Date.now() + ttl * 1000),
    };
    // IN THE DATABASE, not in a Map on this service. It was the latter, which
    // worked exactly as long as there was one process: a ticket minted on one
    // node is invisible to another, so a second instance would refuse about
    // half of all playback with "this link has expired" — and it would read as
    // an expiry bug rather than a scaling one.
    await this.prisma.asSystem((db) => db.playbackTicket.create({ data: ticket }));
    void this.sweepExpiredTickets();

    /*
     * FR-VID-008 — where THIS student stopped, so the player opens at the
     * resume point rather than restarting a 40-minute lecture.
     *
     * SKIPPED ENTIRELY FOR STAFF, and that is a privacy fix rather than an
     * optimisation. Prisma treats `studentId: undefined` as "do not filter on
     * studentId", and WatchProgress is unscoped for an administrator — so the
     * moment staff were allowed to watch, this query would have returned SOME
     * STUDENT'S row. An administrator's player would open at a named student's
     * resume position and announce "43% watched previously", which is that
     * student's study record shown to somebody who never asked for it.
     */
    const progress = actor.studentId
      ? await this.prisma.scoped.watchProgress.findFirst({
          where: { studentId: actor.studentId, recordedLectureId: lecture.id },
          select: { lastPositionSeconds: true, watchedPercent: true },
        })
      : null;

    // SEC-LOG-008 — every ticket issue is logged with who and which lecture.
    this.logger.log(
      JSON.stringify({
        event: "playback.ticket_issued",
        userId: actor.userId,
        studentId: actor.studentId ?? null,
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
      resumePositionSeconds: progress?.lastPositionSeconds ?? 0,
      watchedPercent: Number(progress?.watchedPercent ?? 0),
      /*
       * Whether watching this counts towards anything — and therefore whether
       * the player should report at all.
       *
       * `watch_progress:update` is a STUDENT-ONLY grant in §4.5, correctly:
       * progress feeds the video component of completion, which decides
       * certification (BR-PRG-02), and a teacher reviewing their own recording
       * is not coursework. So staff reporting would be refused — and the
       * player retries what it could not save, so a teacher watching a lecture
       * would loop a 403 every fifteen seconds for as long as they watched,
       * accumulating intervals it can never flush.
       *
       * Told here rather than inferred from a role in the browser: the server
       * already knows, and a client-side role test is a second opinion that
       * can disagree with the matrix.
       */
      recordsProgress: actor.studentId !== undefined && actor.studentId !== null,
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
    const ticket = await this.prisma.asSystem((db) =>
      db.playbackTicket.findUnique({ where: { ticketId } }),
    );
    if (!ticket || ticket.expiresAt < new Date()) {
      if (ticket) {
        await this.prisma.asSystem((db) =>
          db.playbackTicket.delete({ where: { ticketId } }).catch(() => undefined),
        );
      }
      throw new AppError("AUTH_TOKEN_EXPIRED", {
        message: "This playback link has expired. Reload the lesson to continue watching.",
      });
    }

    /*
     * THE TICKET IS THE CREDENTIAL. This route is reached by a <video> element,
     * which sends no Authorization header — so there is usually no actor here
     * at all, and requiring one refused every playback in every browser.
     *
     * What protects it: 128 bits of unguessable id, fifteen minutes, one
     * lecture, and issue only after ROLE ∩ ACTION ∩ SCOPE was checked. That is
     * the same protection the signed media URL at the end of this redirect has
     * always relied on, and it cannot be stronger while the browser fetches
     * media directly (ARC-052).
     *
     * The identity check below is kept but it is NOT the protection, and
     * pretending otherwise would be worse than not having it: it only fires
     * for a caller that troubled to send a token, which the real playback path
     * never does. What it does buy is the obvious misuse — a link pasted to a
     * classmate whose browser is signed in as themselves.
     */
    const actor = getActor();
    if (actor?.userId && actor.userId !== ticket.userId) {
      throw new AppError("AUTH_FORBIDDEN");
    }

    const ttl = Math.max(
      60,
      Math.floor((ticket.expiresAt.getTime() - Date.now()) / 1000),
    );

    /*
     * THE PROVIDER THE RECORDING CAME FROM, not the one configured today.
     *
     * This asked the registry for the CURRENT lecture provider, so the moment
     * LECTURE_STORAGE changed, every recording catalogued under the previous
     * one became unplayable — a Drive file id handed to the local disk, or a
     * local path handed to Drive. Both answer "not found", and the student is
     * told the recording was moved, which is a lie about their teacher's work.
     *
     * `storageProvider` is recorded on every lecture for exactly this reason.
     * Using it means the two stores coexist: recordings catalogued before a
     * switch keep playing, and new ones come from wherever they now arrive.
     */
    const lecture = await this.prisma.asSystem((db) =>
      db.recordedLecture.findUnique({
        where: { id: ticket.recordedLectureId },
        select: { storageProvider: true },
      }),
    );
    const provider = this.storage.get(lecture?.storageProvider ?? this.storage.forLectures().key);

    /*
     * A URL WHERE THERE IS ONE, BYTES WHERE THERE IS NOT.
     *
     * Local storage signs a short-lived URL and the browser is redirected to
     * it — bytes never cross this tier, which is what ARC-052 asks for.
     *
     * Google Drive has no such URL. It serves content directly against an
     * OAuth token, measured against the Institute's own Drive rather than
     * assumed, and the only ways to produce a browser-fetchable Drive link are
     * to make the recording link-shared or publish it — a permanent public
     * link to a paid course recording, which ARC-041 forbids outright. So
     * Drive-backed playback is proxied, and the caller is told which it is
     * getting rather than the two being conflated.
     */
    if (typeof provider.openStream === "function") {
      return { mode: "proxy" as const, provider, storageRef: ticket.storageRef };
    }

    const signed = await provider.signUrl(ticket.storageRef, ttl);
    return { mode: "redirect" as const, redirectTo: signed.url, expiresAt: signed.expiresAt };
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
    const studentId = actor.studentId;

    // Scoped, so a student can only ever report against a lecture that is
    // PUBLISHED, AVAILABLE and in a section they are enrolled in.
    const lecture = await this.prisma.scoped.recordedLecture.findFirst({
      where: { id: lectureId, deletedAt: null },
      select: { id: true, durationSeconds: true },
    });
    if (!lecture) throw new AppError("RESOURCE_NOT_FOUND");

    const threshold = Number(this.config.get<string>("VIDEO_COMPLETION_PERCENT", "90"));

    const existing = await this.prisma.scoped.watchProgress.findFirst({
      where: { studentId, recordedLectureId: lectureId },
    });

    const result = applyWatchUpdate({
      existing: parseIntervals(existing?.watchedIntervals),
      reported: input.watchedIntervals,
      durationSeconds: lecture.durationSeconds,
      lastPositionSeconds: input.positionSeconds,
      completionThresholdPercent: threshold,
    });

    // Latched. Intervals only ever grow, so the percentage cannot fall on its
    // own — but a duration corrected downwards later would otherwise revoke a
    // completion a student had already earned (BR-PRG-05).
    const wasComplete = existing?.isComplete ?? false;
    const isComplete = wasComplete || result.isComplete;
    const completedAt = wasComplete ? existing?.completedAt : isComplete ? new Date() : null;

    await this.prisma.scoped.watchProgress.upsert({
      where: { studentId_recordedLectureId: { studentId, recordedLectureId: lectureId } },
      create: {
        studentId,
        recordedLectureId: lectureId,
        watchedIntervals: result.intervals,
        watchedPercent: result.watchedPercent,
        lastPositionSeconds: result.lastPositionSeconds,
        isComplete,
        completedAt: completedAt ?? null,
      },
      update: {
        watchedIntervals: result.intervals,
        watchedPercent: result.watchedPercent,
        lastPositionSeconds: result.lastPositionSeconds,
        isComplete,
        completedAt: completedAt ?? null,
      },
    });

    return {
      lectureId,
      watchedPercent: result.watchedPercent,
      lastPositionSeconds: result.lastPositionSeconds,
      isComplete,
    };
  }

  /**
   * Watch state for a set of lectures, keyed by lecture id.
   *
   * One query for the whole list. The subject page shows a progress bar against
   * every lecture, and doing this per row would put a query per lecture on the
   * page load.
   */
  async watchStateFor(lectureIds: string[]): Promise<Map<string, WatchState>> {
    const actor = getActor();
    if (!actor?.studentId || lectureIds.length === 0) return new Map();

    const rows = await this.prisma.scoped.watchProgress.findMany({
      where: { studentId: actor.studentId, recordedLectureId: { in: lectureIds } },
    });

    return new Map(
      rows.map((r: (typeof rows)[number]) => [
        r.recordedLectureId,
        {
          watchedPercent: Number(r.watchedPercent),
          lastPositionSeconds: r.lastPositionSeconds,
          isComplete: r.isComplete,
        },
      ]),
    );
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

  /**
   * Expired tickets are removed on a timer.
   *
   * Not strictly required for correctness — redeeming checks the expiry — but
   * a table nobody prunes grows for ever, and every instance running this is
   * harmless: deleting rows that are already expired is idempotent.
   */
  private async sweepExpiredTickets(): Promise<void> {
    await this.prisma
      .asSystem((db) => db.playbackTicket.deleteMany({ where: { expiresAt: { lt: new Date() } } }))
      .catch(() => undefined);
  }

  /**
   * THE CLASS'S STANDING ROOM — FR-LIV.
   *
   * One link for the subject AS TAUGHT TO THIS GROUP, used every week. Not the
   * per-session link the System creates through a provider: this is the room
   * the Institute already has, pasted in once at the start of term.
   *
   * OPAQUE, PER ARC-025 — stored and shown, never parsed. It is not required
   * to be a Google link; an institute on Zoom or Teams pastes theirs and
   * everything works. The one thing checked is that it is https, and that is
   * not tidiness: this string is rendered into an anchor somebody clicks, and
   * a `javascript:` URL in that position is a stored cross-site scripting hole
   * while an http one hands the room's address to anybody on the same wifi.
   */
  async setMeetingLink(sectionSubjectId: string, url: string, note: string) {
    // findFirst on the SCOPED client — a teacher naming a class they do not
    // teach gets nothing back, so the check and the authorisation are one query.
    const offering = await this.prisma.scoped.sectionSubject.findFirst({
      where: { id: sectionSubjectId, deletedAt: null },
      select: { id: true, meetingUrl: true },
    });
    if (!offering) throw new AppError("RESOURCE_NOT_FOUND");

    // An empty string is a decision to REMOVE it, which is why the field is
    // not optional: undefined would be indistinguishable from a caller that
    // forgot it, and the class would keep a link nobody meant to keep.
    const value = url.trim() === "" ? null : url.trim();
    const noteValue = value === null ? null : note.trim() === "" ? null : note.trim();

    if (value !== null && !value.startsWith("https://")) {
      throw new AppError("VALIDATION_FAILED", {
        details: [
          {
            field: "meetingUrl",
            code: "NOT_HTTPS",
            message:
              "A meeting link must begin with https://. Paste the whole address from Google " +
              "Meet, Zoom or Teams — including the https:// at the front.",
          },
        ],
      });
    }

    const updated = await this.prisma.scoped.sectionSubject.update({
      where: { id: sectionSubjectId },
      data: { meetingUrl: value, meetingNote: noteValue },
      select: { id: true, meetingUrl: true, meetingNote: true },
    });

    await this.audit.record({
      action: value ? "class_meeting_link.set" : "class_meeting_link.cleared",
      entityType: "SectionSubject",
      entityId: sectionSubjectId,
      /*
       * The LINK ITSELF is recorded, and deliberately. It is a key to a room:
       * "who changed the address students were sent to, and to what" is
       * precisely the question the audit log exists to answer, and a log
       * saying only "the link changed" answers none of it.
       */
      before: { meetingUrl: offering.meetingUrl },
      after: { meetingUrl: value },
    });

    return updated;
  }

}
