import { Injectable, Logger } from "@nestjs/common";
import { AppError } from "@lms/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { StorageRegistry } from "../content/storage/storage.registry";
import { getActor } from "../prisma/actor-context";
import { AUDIO_SIGNATURES } from "./voice-brief.service";

/**
 * SPOKEN FEEDBACK ON ONE STUDENT'S WORK — FR-ASG-027.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ANSWERING HALF OF THE SPOKEN BRIEF. A teacher already records a brief to
 * explain a task, for the reason that speech carries what text cannot: for
 * design and language work a marker says in forty seconds what takes ten
 * minutes to write, tone carries encouragement a written line does not, and
 * "this bit here" said over a drawing is clearer than any description of where
 * it is. None of that stops being true when the work comes back.
 *
 * IT NEVER REPLACES THE WRITTEN FEEDBACK, and the interface says so. A
 * recording is unusable to a deaf student, unsearchable, and unreadable on a
 * metered connection — so it is an addition to the written mark and never a
 * substitute. The same rule the spoken brief follows.
 *
 * IT ATTACHES TO THE SUBMISSION, NOT TO THE GRADE, and that is a corrected
 * decision rather than the first one. On the grade, a teacher had to award a
 * mark before they could say anything out loud — so the commonest thing a
 * marker wants to record ("this is the wrong export, send me a PDF and I will
 * mark it") was the one thing they could not. The barrier was invisible until
 * somebody opened an unmarked student and found the recorder replaced by an
 * instruction to go and mark first.
 *
 * SO IT IS IMMEDIATE, exactly like the written comment thread beside it: the
 * student hears it as soon as it is recorded. A spoken note is a conversation
 * about the work, and the System already lets a teacher say the same thing in
 * writing without waiting for release. THE MARK is still released together
 * (BR-ASG-09) — this is not the mark, and a teacher who wants to keep
 * something back until then has the written feedback box for it.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** A minute or two of speech. Well under the brief's ceiling, deliberately. */
export const MAX_FEEDBACK_BYTES = 8 * 1024 * 1024;
const MAX_FEEDBACK_SECONDS = 300;

@Injectable()
export class VoiceFeedbackService {
  private readonly logger = new Logger(VoiceFeedbackService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageRegistry,
  ) {}

  /** Attach or replace the recording on one submission's grade. */
  async set(
    submissionId: string,
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

    if (file.size > MAX_FEEDBACK_BYTES) {
      throw new AppError("FILE_TOO_LARGE", {
        message: "That recording is too long for feedback on one submission.",
        details: [
          {
            field: "file",
            code: "TOO_LARGE",
            message:
              "Spoken feedback is a minute or two on this student's work. If there is more to " +
              "say than that, it belongs in the written feedback where they can re-read it.",
          },
        ],
      });
    }

    // SEC-FIL-003 — the CONTENT decides the type, using the same table the
    // spoken brief is sniffed with.
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

    /*
     * SCOPED, which is the whole authorisation: a teacher reaches a submission
     * only in a subject they are assigned to teach. There is deliberately no
     * second check here, because a second place for that answer is a second
     * place for it to be wrong.
     */
    const submission = await this.prisma.scoped.assignmentSubmission.findFirst({
      where: { id: submissionId },
      select: { id: true, studentId: true, feedbackAudioKey: true },
    });
    if (!submission) throw new AppError("RESOURCE_NOT_FOUND");

    const stored = await this.storage
      .forDocuments()
      .put(`feedback-audio/${submissionId}`, file.buffer, kind.type);

    const seconds =
      typeof reportedSeconds === "number" && Number.isFinite(reportedSeconds)
        ? Math.max(1, Math.min(Math.round(reportedSeconds), MAX_FEEDBACK_SECONDS))
        : // The CHECK constraint refuses a catalogued recording with no
          // duration: a player with no length cannot draw a progress bar.
          1;

    await this.prisma.asSystem((db) =>
      db.assignmentSubmission.update({
        where: { id: submission.id },
        data: {
          feedbackAudioKey: stored.storageRef,
          feedbackAudioType: kind.type,
          feedbackAudioSeconds: seconds,
          feedbackAudioAt: new Date(),
        },
      }),
    );

    /*
     * The OLD file goes after the row points at the new one, never before. The
     * other order leaves a window where the grade names bytes that are already
     * gone, and a student pressing play in that window is told the feedback is
     * missing when it is merely being replaced.
     */
    if (submission.feedbackAudioKey) {
      await this.storage
        .forDocuments()
        .delete(submission.feedbackAudioKey)
        .catch((err: unknown) =>
          this.logger.warn(
            `Replaced feedback audio for ${submissionId} but could not remove the old file: ` +
              (err instanceof Error ? err.message : "unknown error"),
          ),
        );
    }

    await this.audit.record({
      action: "submission.feedback_audio.set",
      entityType: "AssignmentSubmission",
      entityId: submission.id,
      after: { contentType: kind.type, sizeBytes: file.size, seconds, by: actor.userId },
    });

    return {
      attached: true,
      contentType: kind.type,
      seconds,
      sizeBytes: file.size,
      // Immediate, like the written comment thread. Said plainly, because a
      // teacher recording a remark needs to know whether it has already gone.
      message: "Saved. The student can hear this now.",
    };
  }

  /**
   * The bytes, for playback.
   *
   * READ SERVER-SIDE so no storage reference and no durable link ever reaches a
   * browser (ARC-041). Scoped, so a student reaches only their own.
   *
   * NOT GATED ON RELEASE, which is the corrected position — see the note on
   * the class. The scope predicate is the whole authorisation: a student
   * reaches only their own submission, a teacher only one they are assigned to
   * mark, and neither needs a second opinion here.
   */
  async read(submissionId: string) {
    const actor = getActor();
    if (!actor) throw new AppError("AUTH_TOKEN_INVALID");

    const submission = await this.prisma.scoped.assignmentSubmission.findFirst({
      where: { id: submissionId },
      select: { studentId: true, feedbackAudioKey: true, feedbackAudioType: true },
    });
    if (!submission?.feedbackAudioKey) throw new AppError("RESOURCE_NOT_FOUND");

    const body = await this.storage
      .forDocuments()
      .get(submission.feedbackAudioKey)
      .catch(() => null);

    if (!body) {
      this.logger.warn(`Feedback audio for ${submissionId} is recorded but unreadable.`);
      throw new AppError("RESOURCE_NOT_FOUND", { message: "That recording could not be read." });
    }

    return { body, contentType: submission.feedbackAudioType ?? "audio/webm" };
  }

  /** Remove it. The written feedback and the mark are untouched. */
  async clear(submissionId: string) {
    const submission = await this.prisma.scoped.assignmentSubmission.findFirst({
      where: { id: submissionId },
      select: { id: true, feedbackAudioKey: true },
    });
    if (!submission) throw new AppError("RESOURCE_NOT_FOUND");
    if (!submission.feedbackAudioKey) return { removed: false };

    const key = submission.feedbackAudioKey;

    await this.prisma.asSystem((db) =>
      db.assignmentSubmission.update({
        where: { id: submission.id },
        data: {
          feedbackAudioKey: null,
          feedbackAudioType: null,
          feedbackAudioSeconds: null,
          feedbackAudioAt: null,
        },
      }),
    );

    await this.storage
      .forDocuments()
      .delete(key)
      .catch(() => undefined);

    await this.audit.record({
      action: "submission.feedback_audio.clear",
      entityType: "AssignmentSubmission",
      entityId: submission.id,
    });

    return { removed: true };
  }
}
