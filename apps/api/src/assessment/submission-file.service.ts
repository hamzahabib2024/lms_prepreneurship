import { Injectable, Logger } from "@nestjs/common";
import { createHash } from "node:crypto";
import { AppError } from "@lms/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { StorageRegistry } from "../content/storage/storage.registry";
import { getActor } from "../prisma/actor-context";
import { validateUpload, type FilePolicy } from "./file-validation";

/** Appendix H — the institute-wide ceiling a teacher may narrow but not widen. */
const INSTITUTE_FILE_TYPES = [
  "pdf", "docx", "doc", "pptx", "ppt", "xlsx",
  "jpg", "jpeg", "png", "mp3", "zip", "txt",
];
const INSTITUTE_MAX_MB = 10;
const INSTITUTE_MAX_FILES = 5;

export interface IncomingFile {
  originalname: string;
  buffer: Buffer;
  size: number;
  mimetype: string;
}

/**
 * Submission files — SRS §5.9, FR-ASG-013/021.
 *
 * Upload and attachment are separate steps. A student adds files one at a time,
 * sees them listed, and only then presses Submit — so a file has to exist
 * before any submission row does. That is why SubmissionFile.submissionId is
 * nullable, and why every uploaded file records its owner and the assignment it
 * was uploaded for.
 *
 * Those two columns are the whole security story. Attaching by file id alone
 * would let a student name someone else's file and pull it into their own
 * submission — which, because a file has one parent, would simultaneously
 * REMOVE it from the victim's work.
 */
@Injectable()
export class SubmissionFileService {
  private readonly logger = new Logger(SubmissionFileService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageRegistry,
  ) {}

  /** The effective policy: the teacher's choice, bounded by Appendix H. */
  private policyFor(assignment: {
    allowedFileTypes: unknown;
    maxFileSizeMb: number;
    maxFileCount: number;
  }): FilePolicy {
    const configured = Array.isArray(assignment.allowedFileTypes)
      ? (assignment.allowedFileTypes as unknown[]).filter(
          (t): t is string => typeof t === "string",
        )
      : [];

    // Intersected, never trusted wholesale. A stored policy that somehow names
    // a type outside Appendix H must not widen what is accepted.
    const allowedTypes = (configured.length > 0 ? configured : INSTITUTE_FILE_TYPES)
      .map((t) => t.toLowerCase().replace(/^\./, ""))
      .filter((t) => INSTITUTE_FILE_TYPES.includes(t));

    return {
      allowedTypes: allowedTypes.length > 0 ? allowedTypes : INSTITUTE_FILE_TYPES,
      maxSizeBytes: Math.min(assignment.maxFileSizeMb, INSTITUTE_MAX_MB) * 1024 * 1024,
      maxFileCount: Math.min(assignment.maxFileCount, INSTITUTE_MAX_FILES),
    };
  }

  /**
   * FR-ASG-013 — stores one file against an assignment, unattached.
   *
   * The submission window is checked here as well as at submit. Accepting an
   * upload after the hard close and refusing it at the final step wastes the
   * student's time on a slow connection and tells them nothing until the end.
   */
  async upload(assignmentId: string, file: IncomingFile) {
    const actor = getActor();
    if (!actor?.studentId) {
      throw new AppError("AUTH_FORBIDDEN", { message: "Only a student can upload work." });
    }
    const studentId = actor.studentId;

    // Scoped: the policy denies a student any assignment outside their sections
    // or still in draft, so this is genuinely "an assignment I can submit to".
    const assignment = await this.prisma.scoped.assignment.findFirst({
      where: { id: assignmentId, deletedAt: null },
    });
    if (!assignment) throw new AppError("RESOURCE_NOT_FOUND");

    const now = new Date();
    if (now < assignment.opensAt) {
      throw new AppError("SUBMISSION_WINDOW_CLOSED", {
        message: `This assignment opens on ${assignment.opensAt.toISOString()}.`,
      });
    }
    if (assignment.hardCloseAt && now > assignment.hardCloseAt) {
      throw new AppError("SUBMISSION_WINDOW_CLOSED", {
        message: "This assignment has closed and no longer accepts files.",
      });
    }

    // Only files not yet attached count towards the limit. A previous
    // submission's files belong to that submission, not to this draft.
    const existingCount = await this.prisma.scoped.submissionFile.count({
      where: { studentId, assignmentId, submissionId: null },
    });

    const rejection = validateUpload({
      filename: file.originalname,
      sizeBytes: file.size,
      bytes: file.buffer,
      policy: this.policyFor(assignment),
      existingCount,
    });

    if (rejection) {
      // SEC-LOG — a rejected upload is recorded without the bytes. Repeated
      // CONTENT_MISMATCH from one account is worth noticing.
      this.logger.warn(
        JSON.stringify({
          event: "submission.file_rejected",
          reason: rejection.code,
          studentId,
          assignmentId,
          correlationId: actor.correlationId,
        }),
      );
      throw new AppError("VALIDATION_FAILED", {
        message: rejection.message,
        details: [{ field: "file", message: rejection.message }],
      });
    }

    // FR-ASG-021 — a content hash, for duplicate detection now and an external
    // plagiarism service later.
    const contentHash = createHash("sha256").update(file.buffer).digest("hex");

    const stored = await this.storage
      .forDocuments()
      .put(`submissions/${assignmentId}`, file.buffer, file.mimetype);

    const record = await this.prisma.scoped.submissionFile.create({
      data: {
        studentId,
        assignmentId,
        submissionId: null,
        storageKey: stored.storageRef,
        originalFilename: file.originalname,
        contentType: file.mimetype,
        sizeBytes: BigInt(file.size),
        contentHash,
        // Never CLEAN. Nothing has scanned this, and claiming otherwise would
        // make a future scanner's verdict look like a downgrade.
        scanStatus: "PENDING",
      },
    });

    await this.audit.record({
      action: "submission.file_upload",
      entityType: "SubmissionFile",
      entityId: record.id,
      after: { assignmentId, filename: file.originalname, sizeBytes: file.size, contentHash },
    });

    return this.present(record);
  }

  /** The student's not-yet-submitted files for this assignment. */
  async listPending(assignmentId: string) {
    const actor = getActor();
    if (!actor?.studentId) throw new AppError("AUTH_FORBIDDEN");

    const files = await this.prisma.scoped.submissionFile.findMany({
      where: { studentId: actor.studentId, assignmentId, submissionId: null },
      orderBy: { createdAt: "asc" },
    });
    return files.map((f: (typeof files)[number]) => this.present(f));
  }

  /**
   * FR-ASG-014 — removes a file the student has not submitted yet.
   *
   * A file already attached to a submission cannot be removed this way. The
   * submitted version is the record of what was handed in (BR-ASG-07), and
   * deleting from it would let a student quietly alter work after the deadline.
   */
  async removePending(fileId: string) {
    const actor = getActor();
    if (!actor?.studentId) throw new AppError("AUTH_FORBIDDEN");

    const file = await this.prisma.scoped.submissionFile.findFirst({
      where: { id: fileId, studentId: actor.studentId },
    });
    if (!file) throw new AppError("RESOURCE_NOT_FOUND");

    if (file.submissionId !== null) {
      throw new AppError("RESOURCE_CONFLICT", {
        message: "This file has already been submitted and cannot be removed.",
      });
    }

    await this.prisma.scoped.submissionFile.delete({ where: { id: file.id } });
    // Storage last: an orphaned row pointing at nothing is worse than a stored
    // object with no row, which the sweep can find.
    await this.storage.forDocuments().delete(file.storageKey);

    await this.audit.record({
      action: "submission.file_remove",
      entityType: "SubmissionFile",
      entityId: file.id,
      before: { assignmentId: file.assignmentId, filename: file.originalFilename },
    });

    return { removed: true };
  }

  /**
   * Streams a file back.
   *
   * The scope policy decides who may: a student reaches only their own, a
   * teacher only files for assignments in the sections they teach. Neither is
   * re-checked here, because a second copy of the rule is a second place for it
   * to be wrong (ARC-051).
   */
  async download(fileId: string) {
    const file = await this.prisma.scoped.submissionFile.findFirst({ where: { id: fileId } });
    if (!file) throw new AppError("RESOURCE_NOT_FOUND");

    const body = await this.storage
      .forDocuments()
      .get(file.storageKey)
      .catch(() => {
        throw new AppError("STORAGE_UNAVAILABLE", {
          message: "That file could not be retrieved. Please tell your teacher.",
        });
      });

    return {
      body,
      filename: file.originalFilename,
      contentType: file.contentType,
      sizeBytes: Number(file.sizeBytes),
    };
  }

  /** BigInt does not survive JSON, and the storage key never leaves the System. */
  private present(f: {
    id: string;
    originalFilename: string;
    contentType: string;
    sizeBytes: bigint;
    scanStatus: string;
    createdAt: Date;
  }) {
    return {
      id: f.id,
      filename: f.originalFilename,
      contentType: f.contentType,
      sizeBytes: Number(f.sizeBytes),
      scanStatus: f.scanStatus,
      uploadedAt: f.createdAt,
    };
  }
}
