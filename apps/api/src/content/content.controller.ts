import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { open, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { z } from "zod";
import type { Request, Response } from "express";
import { AppError } from "@lms/shared";
import { ContentService } from "./content.service";
import { LectureStorageService } from "./lecture-storage.service";
import { LectureSyncService } from "./lecture-sync.service";
import { StorageRegistry } from "./storage/storage.registry";
import type { ByteRange } from "./storage/storage.provider";
import { zodBody } from "../common/zod-validation.pipe";
import { Public, RequirePermission } from "../rbac/permissions.guard";

/**
 * A LECTURE IS NOT A DOCUMENT, and the ceiling says so.
 *
 * The slip limit is 5 MB, which is right for a photograph of a bank receipt.
 * The Institute's own recordings run from 130 MB to 360 MB, so anything under
 * a gigabyte would refuse real files. Configurable because a course that
 * records three-hour workshops will want more, and finding that out should not
 * need a deployment.
 */
export const MAX_LECTURE_BYTES =
  Number(process.env["MAX_LECTURE_UPLOAD_MB"] ?? 1024) * 1024 * 1024;

const lectureUploadSchema = z.object({
  title: z.string().trim().min(2, "Give the recording a title students will recognise.").max(255),
  lessonId: z.string().uuid().optional(),
  recordedOn: z.coerce.date(),
  /** `local` stores it in the System instead of Drive — see the upload target. */
  storeIn: z.enum(["auto", "local"]).optional(),
});

/**
 * WHAT THE FILE ACTUALLY IS — SEC-FIL-003.
 *
 * Read from the first bytes on disk rather than from the name or the
 * content-type the browser sent, both of which the uploader chooses. Only the
 * header is read: the file is up to a gigabyte and the answer is in the first
 * few dozen bytes.
 *
 * The four containers here are what a phone, a screen recorder or Meet
 * actually produce. MP4 and MOV share the ISO base media format and are told
 * apart by the brand after `ftyp`; WebM and MKV are both EBML and are
 * distinguished by the doctype, which is far enough into the header that it is
 * simpler and honest to report the one the Institute will overwhelmingly have.
 */
async function sniffVideo(path: string): Promise<string | null> {
  const handle = await open(path, "r");
  try {
    const buf = Buffer.alloc(64);
    const { bytesRead } = await handle.read(buf, 0, 64, 0);
    if (bytesRead < 12) return null;

    // ISO base media: 4 bytes size, then "ftyp".
    if (buf.subarray(4, 8).toString("ascii") === "ftyp") {
      const brand = buf.subarray(8, 12).toString("ascii");
      return brand.startsWith("qt") ? "video/quicktime" : "video/mp4";
    }

    // EBML — WebM and Matroska share it.
    if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) {
      const head = buf.toString("ascii");
      return head.includes("webm") ? "video/webm" : "video/x-matroska";
    }

    // AVI, still produced by older screen recorders.
    if (
      buf.subarray(0, 4).toString("ascii") === "RIFF" &&
      buf.subarray(8, 12).toString("ascii") === "AVI "
    ) {
      return "video/x-msvideo";
    }

    return null;
  } finally {
    await handle.close();
  }
}

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

/**
 * An empty string REMOVES the link, which is why neither field is optional:
 * undefined would be indistinguishable from a caller that forgot it, and the
 * class would keep a link nobody meant to keep.
 */
const meetingLinkSchema = z.object({
  meetingUrl: z.string().trim().max(1000),
  note: z.string().trim().max(500).default(""),
});

@Controller()
export class ContentController {
  constructor(
    private readonly content: ContentService,
    private readonly storage: StorageRegistry,
    private readonly lectureSync: LectureSyncService,
    private readonly lectureStorage: LectureStorageService,
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

  /**
   * THE FOLDER INDEX — every class folder the Institute keeps, by name and id.
   *
   * `lecture_storage_index`, which ONLY a Super Admin and an Admin hold, and
   * that is the whole reason the resource exists rather than reusing
   * `recorded_lecture`. A teacher legitimately holds `recorded_lecture:create`
   * at ASSIGNED scope so they can catalogue a recording for their own class.
   * It does not follow that they should be handed the identifier of every
   * OTHER class's folder — a folder id is close to a bearer token for that
   * folder's contents, and with one a teacher can point their class at another
   * cohort's recordings.
   *
   * The endpoint above stays on `recorded_lecture:create` because it lists
   * FILES inside a folder somebody already has, which is the act of
   * cataloguing. This lists the tree.
   */
  @RequirePermission("lecture_storage_index", "read")
  @Get("storage/folders")
  folders(@Query("parent") parent?: string) {
    return this.lectureStorage.folderIndex(parent);
  }

  /**
   * Where a recording for this class would go, and whether it would be taken.
   *
   * Asked BEFORE the file picker, because the answer is sometimes no for a
   * reason no amount of retrying fixes — a Google service account has no Drive
   * storage quota, so a folder in an ordinary My Drive refuses every upload
   * however it is shared. Finding that out after a 300 MB transfer is the
   * failure this prevents.
   */
  @RequirePermission("recorded_lecture", "create")
  @Get("section-subjects/:id/lecture-upload-target")
  uploadTarget(@Param("id") id: string) {
    return this.lectureStorage.uploadTarget(id);
  }

  /**
   * FR-VID-002 — a recording from somebody's own device.
   *
   * DISK, NOT MEMORY. `dest` makes multer stream the upload to a temporary
   * file; the default is an in-memory buffer, and the Institute's recordings
   * are 130–360 MB each. One upload buffered in this process is the whole
   * application tier, and two are an outage.
   *
   * The service removes the temporary file in a `finally`, on every path.
   */
  @RequirePermission("recorded_lecture", "create")
  @Post("section-subjects/:id/lectures/upload")
  @UseInterceptors(
    FileInterceptor("file", {
      dest: tmpdir(),
      limits: { fileSize: MAX_LECTURE_BYTES, files: 1 },
    }),
  )
  async uploadLecture(
    @Param("id") id: string,
    @Body() body: Record<string, string>,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) {
      throw new AppError("VALIDATION_FAILED", {
        message: "No recording was received.",
        details: [{ field: "file", code: "REQUIRED", message: "Choose a video file to upload." }],
      });
    }

    const parsed = lectureUploadSchema.safeParse(body);
    if (!parsed.success) {
      // The temporary file is this method's responsibility until the service
      // takes it. Refusing without removing it leaves a 300 MB orphan.
      await unlink(file.path).catch(() => undefined);
      throw new AppError("VALIDATION_FAILED", {
        message: "That upload could not be accepted.",
        details: parsed.error.issues.map((i) => ({
          field: i.path.join("."),
          code: "INVALID",
          message: i.message,
        })),
      });
    }

    // SEC-FIL-003 — the CONTENT decides the type, never the name or whatever
    // content-type the browser chose to send.
    const sniffed = await sniffVideo(file.path);
    if (!sniffed) {
      await unlink(file.path).catch(() => undefined);
      throw new AppError("FILE_TYPE_NOT_ALLOWED", {
        message: "That file is not a video the System can store.",
        details: [
          {
            field: "file",
            code: "UNSUPPORTED_TYPE",
            message:
              "Upload an MP4, WebM, QuickTime (.mov) or Matroska (.mkv) file. A screen recording " +
              "or a phone video is normally one of these already.",
          },
        ],
      });
    }

    return this.lectureStorage.uploadLecture({
      sectionSubjectId: id,
      ...(parsed.data.lessonId ? { lessonId: parsed.data.lessonId } : {}),
      title: parsed.data.title,
      recordedOn: parsed.data.recordedOn,
      tempPath: file.path,
      originalName: file.originalname,
      contentType: sniffed,
      ...(parsed.data.storeIn ? { storeIn: parsed.data.storeIn } : {}),
    });
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
  async stream(
    @Param("ticketId") ticketId: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const resolved = await this.content.resolveTicket(ticketId);

    if (resolved.mode === "redirect") {
      // 302 rather than 301: the target expires, and a permanent redirect
      // would be cached by the browser long after the signature is dead.
      res.redirect(302, resolved.redirectTo);
      return;
    }

    /*
     * Proxied, because Google Drive has no signed URL — see resolveTicket.
     *
     * The Range header is passed through and Drive's answer mirrored back, so
     * seeking works and a player fetches only what it plays. The body is
     * PIPED: a 363 MB recording collected into memory per viewer would end the
     * application tier at four concurrent students.
     */
    const range = parseRangeHeader(req.headers.range);
    const stream = await resolved.provider.openStream!(resolved.storageRef, range);

    res.status(stream.status);
    if (stream.contentType) res.setHeader("Content-Type", stream.contentType);
    if (stream.contentLength !== null) res.setHeader("Content-Length", String(stream.contentLength));
    if (stream.contentRange) res.setHeader("Content-Range", stream.contentRange);
    res.setHeader("Accept-Ranges", "bytes");
    // One person's, for fifteen minutes. A shared cache holding this would
    // serve a paid recording to whoever asked next.
    res.setHeader("Cache-Control", "private, max-age=0, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");

    // If the student closes the tab mid-lecture, stop pulling from Drive
    // rather than streaming the rest of the file into a socket nobody is
    // reading — which would keep the connection and the quota busy for the
    // length of the recording.
    res.on("close", () => stream.body.destroy?.());
    stream.body.pipe(res);
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


  /**
   * FR-LIV — the class's standing meeting room.
   *
   * `section_subject:update`, which the office and a teacher hold — a teacher
   * for the classes they teach, decided by the scope predicate rather than by
   * a check here. Set it once at the start of term and every student in the
   * class has the same link every week, in the place they already look.
   */
  /*
   * `live_session:update`, NOT `section_subject:update`.
   *
   * A teacher holds only READ on section_subject, and rightly: writing one
   * changes the shape of the class — its dates, its status, whether it is
   * compulsory — and that is the office's. But the MEETING ROOM is about
   * running the class, which is exactly what a teacher does, and they hold
   * live_session at ASSIGNED scope for their own classes.
   *
   * The same reasoning the lecture-folder route uses one screen away: pick the
   * permission that matches the ACT, rather than the table the column happens
   * to live in.
   */
  @RequirePermission("live_session", "update")
  @Put("section-subjects/:id/meeting-link")
  setMeetingLink(
    @Param("id") id: string,
    @Body(zodBody(meetingLinkSchema)) dto: z.infer<typeof meetingLinkSchema>,
  ) {
    return this.content.setMeetingLink(id, dto.meetingUrl, dto.note);
  }
}

/**
 * The Range header, as the byte range a provider is asked for.
 *
 * Deliberately NOT the media route`s parseRange, which clamps against a known
 * file size. Nothing here knows the size — only the provider does — so this
 * cannot clamp, and a suffix range ("the last N bytes") is handed on untouched
 * for the provider to resolve. Conflating the two would mean guessing a length.
 */
export function parseRangeHeader(header: string | undefined): ByteRange | undefined {
  if (!header) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return undefined;
  const [, rawStart, rawEnd] = match;

  /*
   * A SUFFIX RANGE IS PASSED ON, AND USED TO BE DROPPED ON THE FLOOR.
   *
   * The comment here said it was "handed on as written". It was not: the
   * function returned `undefined`, which means "no range at all", so the
   * request became a plain 200 with the WHOLE FILE.
   *
   * That is the bug behind "the videos do not play". An MP4 keeps its index —
   * the `moov` atom — at the end unless somebody deliberately moved it, which
   * is true of every recording Google Meet produces. A browser opening one
   * asks for the tail first with `bytes=-N` to read that index. Getting 200
   * and a 247 MB body instead, the player has to download the entire lecture
   * before it can find out how to play any of it: on a class connection it
   * looks like a video that spins and never starts, and on a fast one like a
   * video that takes a minute to begin.
   *
   * Measured on this Institute's own recording: `bytes=-2048` answered 200 and
   * began streaming all 247 MB.
   *
   * It cannot be converted to a start here, because nothing on this side knows
   * the file's length. Only the provider does, so the provider resolves it —
   * which for Drive means passing the header straight through, since Drive
   * honours suffix ranges itself.
   */
  if (rawStart === "") {
    const suffix = Number(rawEnd);
    if (!Number.isFinite(suffix) || suffix <= 0) return undefined;
    return { suffix };
  }

  const start = Number(rawStart);
  if (!Number.isFinite(start) || start < 0) return undefined;
  const end = rawEnd === "" ? undefined : Number(rawEnd);
  return end !== undefined && Number.isFinite(end) ? { start, end } : { start };

}
