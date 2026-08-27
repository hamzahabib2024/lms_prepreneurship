import { Injectable, Logger } from "@nestjs/common";
import { AppError } from "@lms/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { StorageRegistry } from "../content/storage/storage.registry";
import { getActor } from "../prisma/actor-context";

/**
 * A SPOKEN ASSIGNMENT BRIEF — the teacher's half of voice.
 *
 * WHY IT EXISTS. An assignment's instructions have always been text, and for
 * design and language work that is the wrong medium for the part that matters.
 * A tutor explaining what they want from a logo says it in forty seconds and
 * says it better than four paragraphs, because the emphasis is the brief. The
 * same is true in reverse for the student, which is why a spoken ANSWER goes
 * through the ordinary submission-file path beside it.
 *
 * THE WRITTEN INSTRUCTIONS STAY REQUIRED. Audio is an addition, never a
 * replacement: a deaf student needs the words, a student on a metered
 * connection needs the words, and so does anybody scanning six assignments to
 * find the one about grids. A System that let a brief exist only as sound
 * would have made the course inaccessible to reach a nicer demo.
 *
 * NOTHING HERE IS PUBLIC. A brief belongs to the students enrolled in that
 * class; playback runs through an authenticated route that reads the bytes
 * server-side, so the storage reference never reaches a browser (ARC-041).
 * That is the whole difference between this and a course thumbnail.
 */

/**
 * WHAT A BROWSER CAN ACTUALLY RECORD, checked by content rather than by name.
 *
 * MediaRecorder writes webm/Opus on Chrome, Edge and Firefox, and mp4/AAC on
 * Safari and every iPhone. Neither is a choice the student or the teacher
 * makes, so both must be accepted or the feature works on half the devices.
 *
 * The signatures are repeated here rather than borrowed from file-validation,
 * and deliberately: that module answers "may a STUDENT attach this to THIS
 * assignment", which depends on institute policy and the teacher's own narrower
 * list. This answers a fixed question with a fixed answer — is this a sound
 * file a browser produced — and making it depend on a configurable list would
 * mean a teacher narrowing an assignment to `pdf` silently disabled their own
 * microphone.
 */
/**
 * Exported so spoken FEEDBACK is sniffed by the same table as the spoken
 * BRIEF. Two lists of accepted audio formats is two lists to keep in step,
 * and the one that drifts is the one that rejects a teacher's recording on a
 * browser the other would have accepted.
 */
export const AUDIO_SIGNATURES: Array<{ type: string; ext: string; test: (b: Buffer) => boolean }> = [
  {
    type: "audio/webm",
    ext: "webm",
    // EBML — WebM is a Matroska profile, so this is the container, not the codec.
    test: (b) => b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3,
  },
  {
    type: "audio/mp4",
    ext: "m4a",
    // `ftyp` at offset 4, after the box length. Safari's recorder writes this.
    test: (b) => b.subarray(4, 8).toString("ascii") === "ftyp",
  },
  {
    type: "audio/ogg",
    ext: "ogg",
    test: (b) => b.subarray(0, 4).toString("ascii") === "OggS",
  },
];

/**
 * Five minutes at the Opus bitrate a browser picks is well under a megabyte,
 * so this is not really a size limit — it is a limit on the ACT. A brief is a
 * teacher talking over a task; anything past a few minutes is a lecture, and a
 * lecture belongs in the recordings where it can be catalogued, published and
 * watched with progress rather than buried in an assignment.
 */
export const MAX_BRIEF_BYTES = 12 * 1024 * 1024;
/** The recorder's own count, clamped. Nothing is decided by it — see schema. */
const MAX_BRIEF_SECONDS = 900;

@Injectable()
export class VoiceBriefService {
  private readonly logger = new Logger(VoiceBriefService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageRegistry,
  ) {}

  /**
   * Attach a recording to an assignment, replacing any previous one.
   *
   * SCOPED, so a teacher can only reach an assignment in a subject they
   * actually teach — the scope predicate does that, not this method.
   */
  async set(
    assignmentId: string,
    file: { buffer: Buffer; size: number } | undefined,
    reportedSeconds: number | undefined,
  ) {
    const actor = getActor();
    if (!actor) throw new AppError("AUTH_TOKEN_INVALID");

    if (!file || file.size === 0) {
      throw new AppError("VALIDATION_FAILED", {
        message: "No recording was received.",
        details: [{ field: "file", code: "REQUIRED", message: "Record something first." }],
      });
    }

    if (file.size > MAX_BRIEF_BYTES) {
      throw new AppError("FILE_TOO_LARGE", {
        message: "That recording is too long to attach to an assignment.",
        details: [
          {
            field: "file",
            code: "TOO_LARGE",
            message:
              "A spoken brief is a minute or two explaining the task. Something this size is a " +
              "lecture, and a lecture belongs in the class recordings, where students can find " +
              "it again and their watching counts towards their progress.",
          },
        ],
      });
    }

    const kind = AUDIO_SIGNATURES.find((s) => s.test(file.buffer));
    if (!kind) {
      throw new AppError("FILE_TYPE_NOT_ALLOWED", {
        message: "That file is not a recording this System can play.",
        details: [
          {
            field: "file",
            code: "UNSUPPORTED_TYPE",
            message:
              "Use the recorder on this page. It produces the format your browser supports — " +
              "WebM on Chrome and Firefox, M4A on Safari — and both are accepted.",
          },
        ],
      });
    }

    // Scoped: the teacher must be able to reach this assignment at all.
    const assignment = await this.prisma.scoped.assignment.findFirst({
      where: { id: assignmentId, deletedAt: null },
      select: { id: true, briefAudioKey: true, title: true },
    });
    if (!assignment) throw new AppError("RESOURCE_NOT_FOUND");

    const stored = await this.storage
      .forDocuments()
      .put(`assignment-briefs/${assignmentId}`, file.buffer, kind.type);

    const seconds =
      typeof reportedSeconds === "number" && Number.isFinite(reportedSeconds)
        ? Math.max(1, Math.min(Math.round(reportedSeconds), MAX_BRIEF_SECONDS))
        : null;

    await this.prisma.asSystem((db) =>
      db.assignment.update({
        where: { id: assignmentId },
        data: {
          briefAudioKey: stored.storageRef,
          briefAudioType: kind.type,
          briefAudioSeconds: seconds,
        },
      }),
    );

    /*
     * The OLD file is removed after the row points at the new one, never
     * before. The other order leaves a window where the assignment names bytes
     * that are already gone, and a student pressing play in that window is
     * told the brief is missing when it is merely being replaced.
     */
    if (assignment.briefAudioKey) {
      await this.storage
        .forDocuments()
        .delete(assignment.briefAudioKey)
        .catch((err: unknown) =>
          // Logged, not thrown: the replacement succeeded, and failing the
          // request now would tell the teacher their recording did not save.
          this.logger.warn(
            `Replaced brief audio for ${assignmentId} but could not remove the old file: ` +
              (err instanceof Error ? err.message : "unknown error"),
          ),
        );
    }

    await this.audit.record({
      action: "assignment.brief_audio.set",
      entityType: "Assignment",
      entityId: assignmentId,
      after: { contentType: kind.type, sizeBytes: file.size, seconds },
    });

    return { attached: true, contentType: kind.type, seconds, sizeBytes: file.size };
  }

  /**
   * The bytes, for playback — read server-side so no storage reference and no
   * durable link ever reaches a browser.
   *
   * SCOPED, which is the whole authorisation: a student reaches this only for
   * an assignment in a subject they are enrolled in, and a teacher only for one
   * they teach. There is no separate check here because there must not be a
   * second place for that answer to be wrong.
   */
  async read(assignmentId: string) {
    const assignment = await this.prisma.scoped.assignment.findFirst({
      where: { id: assignmentId, deletedAt: null },
      select: { briefAudioKey: true, briefAudioType: true },
    });
    if (!assignment?.briefAudioKey) throw new AppError("RESOURCE_NOT_FOUND");

    const body = await this.storage
      .forDocuments()
      .get(assignment.briefAudioKey)
      .catch(() => null);

    if (!body) {
      // Catalogued and unreadable — somebody cleared storage, or a provider
      // was switched. Worth a log, because the assignment looks fine.
      this.logger.warn(`Brief audio for ${assignmentId} is recorded but unreadable.`);
      throw new AppError("RESOURCE_NOT_FOUND", {
        message: "That recording could not be read.",
      });
    }

    return { body, contentType: assignment.briefAudioType ?? "audio/webm" };
  }

  /** Remove it. The written instructions are untouched — they always exist. */
  async clear(assignmentId: string) {
    const assignment = await this.prisma.scoped.assignment.findFirst({
      where: { id: assignmentId, deletedAt: null },
      select: { id: true, briefAudioKey: true },
    });
    if (!assignment) throw new AppError("RESOURCE_NOT_FOUND");
    if (!assignment.briefAudioKey) return { removed: false };

    await this.prisma.asSystem((db) =>
      db.assignment.update({
        where: { id: assignmentId },
        data: { briefAudioKey: null, briefAudioType: null, briefAudioSeconds: null },
      }),
    );

    await this.storage
      .forDocuments()
      .delete(assignment.briefAudioKey)
      .catch(() => undefined);

    await this.audit.record({
      action: "assignment.brief_audio.clear",
      entityType: "Assignment",
      entityId: assignmentId,
    });

    return { removed: true };
  }
}
