import { Body, Controller, Get, Param, Patch, Post, Put, Query, Res } from "@nestjs/common";
import { z } from "zod";
import type { Response } from "express";
import { ContentService } from "./content.service";
import { LectureSyncService } from "./lecture-sync.service";
import { StorageRegistry } from "./storage/storage.registry";
import { zodBody } from "../common/zod-validation.pipe";
import { Public, RequirePermission } from "../rbac/permissions.guard";

const moduleSchema = z.object({
  subjectId: z.string().uuid(),
  title: z.string().trim().min(2).max(255),
  description: z.string().trim().max(5000).optional(),
});

const lessonSchema = z.object({
  moduleId: z.string().uuid(),
  title: z.string().trim().min(2).max(255),
  description: z.string().trim().max(5000).optional(),
  estimatedMinutes: z.coerce.number().int().positive().max(600).optional(),
});

const reorderSchema = z.object({
  orderedLessonIds: z.array(z.string().uuid()).min(1),
});

const publishSchema = z.object({
  status: z.enum(["DRAFT", "PUBLISHED", "UNPUBLISHED", "SCHEDULED"]),
  publishAt: z.coerce.date().optional(),
});

/** A Drive folder id, or a path under local storage. Empty disconnects it. */
/**
 * The folder a class's recordings arrive in.
 *
 * ACCEPTS THE WHOLE URL, because that is what a person copies. Nobody opens
 * Drive and extracts the id from the address bar; they select the address bar,
 * copy, and paste. Refusing that with "must be a folder id" is a validation
 * message that blames somebody for doing the obvious thing.
 *
 *   https://drive.google.com/drive/folders/1Yhkvn_G0…?usp=sharing
 *   https://drive.google.com/drive/u/0/folders/1Yhkvn_G0…
 *   1Yhkvn_G0…
 *
 * All three become the id. An empty string still disconnects the folder, which
 * is why this is not a uuid or an id pattern.
 */
export const lectureFolderSchema = z.object({
  folderRef: z
    .string()
    .trim()
    .max(500)
    .transform((v) => {
      const url = /drive\.google\.com\/.*\/folders\/([A-Za-z0-9_-]+)/.exec(v);
      if (url) return url[1]!;
      // A file link pasted instead of a folder link — take the id and let the
      // sync report an empty folder rather than silently storing a URL.
      const file = /drive\.google\.com\/file\/d\/([A-Za-z0-9_-]+)/.exec(v);
      if (file) return file[1]!;
      return v;
    })
    .pipe(z.string().max(255)),
});

const catalogueSchema = z.object({
  sectionSubjectId: z.string().uuid(),
  lessonId: z.string().uuid().optional(),
  title: z.string().trim().min(2).max(255),
  storageRef: z.string().trim().min(1).max(255),
  recordedOn: z.coerce.date(),
  teacherId: z.string().uuid().optional(),
  durationSeconds: z.coerce.number().int().positive().optional(),
});

const progressSchema = z.object({
  positionSeconds: z.coerce.number().min(0),
  watchedIntervals: z
    .array(z.tuple([z.coerce.number(), z.coerce.number()]))
    // A client cannot flood the server with millions of fragments; the merge
    // is cheap but not free.
    .max(500)
    .default([]),
});

/** SRS §9.6 — content and recorded lectures. */
@Controller()
export class ContentController {
  constructor(
    private readonly content: ContentService,
    private readonly storage: StorageRegistry,
    private readonly lectureSync: LectureSyncService,
  ) {}

  // -------------------------------------------------------------- structure

  @RequirePermission("module", "read")
  @Get("subjects/:id/content")
  tree(@Param("id") id: string) {
    return this.content.subjectContent(id);
  }

  @RequirePermission("module", "create")
  @Post("modules")
  createModule(@Body(zodBody(moduleSchema)) dto: z.infer<typeof moduleSchema>) {
    return this.content.createModule(dto);
  }

  @RequirePermission("lesson", "create")
  @Post("lessons")
  createLesson(@Body(zodBody(lessonSchema)) dto: z.infer<typeof lessonSchema>) {
    return this.content.createLesson(dto);
  }

  @RequirePermission("lesson", "update")
  @Patch("modules/:id/lesson-order")
  reorder(@Param("id") id: string, @Body(zodBody(reorderSchema)) dto: z.infer<typeof reorderSchema>) {
    return this.content.reorderLessons(id, dto.orderedLessonIds);
  }

  @RequirePermission("content_publication", "update")
  @Post("modules/:id/publication")
  publishModule(@Param("id") id: string, @Body(zodBody(publishSchema)) dto: z.infer<typeof publishSchema>) {
    return this.content.setPublication("module", id, dto.status, dto.publishAt);
  }

  /**
   * FR-CNT-016 — publish a recording.
   *
   * Modules and lessons had this and recordings did not, so a catalogued
   * lecture stayed DRAFT for ever and no student could ever see it. Cataloguing
   * without publishing is half a feature.
   */
  @RequirePermission("content_publication", "update")
  @Post("recorded-lectures/:id/publication")
  publishLecture(
    @Param("id") id: string,
    @Body(zodBody(publishSchema)) dto: z.infer<typeof publishSchema>,
  ) {
    return this.content.setPublication("lecture", id, dto.status, dto.publishAt);
  }

  @RequirePermission("content_publication", "update")
  @Post("lessons/:id/publication")
  publishLesson(@Param("id") id: string, @Body(zodBody(publishSchema)) dto: z.infer<typeof publishSchema>) {
    return this.content.setPublication("lesson", id, dto.status, dto.publishAt);
  }

  // ---------------------------------------------------------------- lectures

  /**
   * FR-VID-003 — browse the configured folders to catalogue a recording.
   *
   * `recorded_lecture:CREATE`, not `read`. A student holds `read` so they can
   * see the lectures on their own subjects, and that let them list the raw
   * storage tree — folder and file names for everything the Institute keeps
   * there, INCLUDING the submissions directory where coursework lives. ARC-041
   * says a storage reference never reaches a student; this handed them the
   * whole index.
   *
   * Browsing exists to catalogue, so it is bounded by the permission to
   * catalogue.
   */
  @RequirePermission("recorded_lecture", "create")
  @Get("storage/browse")
  browse(@Query("folder") folder?: string) {
    return this.content.browseStorage(folder);
  }

  @RequirePermission("recorded_lecture", "create")
  @Post("recorded-lectures")
  catalogue(@Body(zodBody(catalogueSchema)) dto: z.infer<typeof catalogueSchema>) {
    return this.content.catalogueLecture(dto);
  }

  /**
   * Connect a class to the folder its recordings are put in — FR-VID-003.
   *
   * `recorded_lecture:create`, for the same reason browsing is: choosing which
   * folder feeds a class is the act of cataloguing, and it decides what a
   * whole cohort will be shown.
   */
  /**
   * The recordings for one class — the course page's card list.
   *
   * `recorded_lecture:read`, which a student holds over their own enrolments,
   * so this is the one lecture route they may call. The service decides what
   * they get back: published only, and never a storage reference (ARC-041).
   */
  @RequirePermission("recorded_lecture", "read")
  @Get("section-subjects/:id/lectures")
  lectures(@Param("id") id: string) {
    return this.content.lecturesFor(id);
  }

  /**
   * Every class the caller may see — the Courses screen.
   *
   * `section_subject:read`, which ALL FOUR ROLES hold, each with its own scope
   * (§4.5). That is deliberate: gating this on an administrator-only resource
   * would make the page a 403 for the teacher whose classes it lists, and
   * gating it on `recorded_lecture` would name the wrong thing — this is a
   * list of CLASSES that happens to count recordings, not a list of
   * recordings.
   *
   * No route parameter, so nothing to check ownership of. The scope predicate
   * decides the rows and is the only thing that does.
   */
  @RequirePermission("section_subject", "read")
  @Get("courses")
  courses() {
    return this.content.listCourses();
  }

  @RequirePermission("recorded_lecture", "create")
  @Put("section-subjects/:id/lecture-folder")
  setLectureFolder(
    @Param("id") id: string,
    @Body(zodBody(lectureFolderSchema)) dto: z.infer<typeof lectureFolderSchema>,
  ) {
    return this.content.setLectureFolder(id, dto.folderRef);
  }

  /**
   * Read the folder now, rather than waiting for the hourly sweep.
   *
   * A teacher who has just uploaded a recording and wants to see the card is
   * the whole reason this is a button as well as a schedule. It creates
   * DRAFTS, so pressing it cannot put anything in front of a class.
   */
  @RequirePermission("recorded_lecture", "create")
  @Post("section-subjects/:id/sync-lectures")
  syncLectures(@Param("id") id: string) {
    return this.lectureSync.sync(id);
  }

  /** ARC-039/040 — a short-lived, user-bound ticket. Never a storage link. */
  @RequirePermission("lecture_playback", "read")
  @Post("recorded-lectures/:id/playback-ticket")
  ticket(@Param("id") id: string) {
    return this.content.issuePlaybackTicket(id);
  }

  /**
   * ARC-052 — redirects to a short-lived signed URL.
   *
   * The bytes flow storage → browser directly. Streaming them through here
   * would consume the capacity provisioned for the whole System (§3.8) and
   * breach NFR-PRF-002 for every other user.
   *
   * ─────────────────────────────────────────────────────────────────────────
   * PUBLIC, BECAUSE A <video> ELEMENT CANNOT SIGN IN.
   *
   * This carried @RequirePermission, and the actor is resolved from an
   * Authorization header — which a media element never sends. The browser
   * requests `<video src>` as a plain GET with cookies and nothing else, so
   * every playback in a browser answered 401 and the player reported
   *
   *   "This recording could not be played. It may have been moved."
   *
   * — which reads as a missing file. NO VIDEO COULD EVER PLAY, on any storage,
   * for any role. It passed every test because every test sent the header.
   *
   * THE TICKET IS THE CREDENTIAL, which is what ARC-039 intends by "a
   * short-lived, user-bound ticket": 128 bits of randomness, valid fifteen
   * minutes, naming exactly one lecture, and issued only after ROLE ∩ ACTION ∩
   * SCOPE has already been checked. It is the same arrangement as the signed
   * media URL it redirects to, which has always been public for the same
   * reason and cannot be otherwise.
   *
   * The residual exposure is stated rather than glossed: somebody who passes
   * their ticket URL to another person within those fifteen minutes lets them
   * watch that one lecture. That exposure already exists on the signed URL at
   * the end of this redirect and cannot be closed while the browser fetches
   * media directly (ARC-052). The ticket still records who it was issued to,
   * so the audit answers "whose link was it".
   */
  @Public()
  @Get("lectures/stream/:ticketId")
  async stream(@Param("ticketId") ticketId: string, @Res() res: Response): Promise<void> {
    const { redirectTo } = await this.content.resolveTicket(ticketId);
    // 302 rather than 301: the target expires, and a permanent redirect would
    // be cached by the browser long after the signature is dead.
    res.redirect(302, redirectTo);
  }

  @RequirePermission("watch_progress", "update")
  @Patch("recorded-lectures/:id/progress")
  progress(@Param("id") id: string, @Body(zodBody(progressSchema)) dto: z.infer<typeof progressSchema>) {
    return this.content.recordWatchProgress(id, {
      positionSeconds: dto.positionSeconds,
      watchedIntervals: dto.watchedIntervals as Array<[number, number]>,
    });
  }

  @RequirePermission("recorded_lecture", "update")
  @Post("recorded-lectures/:id/verify")
  verify(@Param("id") id: string) {
    return this.content.verifyAvailability(id);
  }

  @RequirePermission("system_health", "read")
  @Get("storage/providers")
  providers() {
    return this.storage.listWithHealth();
  }
}
