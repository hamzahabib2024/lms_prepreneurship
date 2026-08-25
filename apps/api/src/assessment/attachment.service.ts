import { Injectable, Logger } from "@nestjs/common";
import { createHash } from "node:crypto";
import { AppError } from "@lms/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { SettingsService } from "../settings/settings.service";
import { StorageRegistry } from "../content/storage/storage.registry";
import { getActor } from "../prisma/actor-context";
import { validateUpload } from "./file-validation";

/**
 * FILES THAT COME WITH THE BRIEF — FR-ASG.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The third way a teacher sets a task. Written instructions say what to do, a
 * spoken brief says it in their own voice, and this is the thing most briefs
 * actually need: the logo to work from, the passage to read, the trial balance
 * to reconcile.
 *
 * Without somewhere to put them the teacher sends them on WhatsApp, and every
 * student who joins the class in week three has to ask for the attachment
 * again — which the teacher answers individually, thirty times a term.
 *
 * VALIDATED EXACTLY LIKE A STUDENT'S SUBMISSION, and that is deliberate rather
 * than lazy. It is tempting to trust a teacher's upload: they are staff, they
 * are known, they are not the threat model. But the FILE is the threat model,
 * not the person — a teacher forwards a document somebody sent them, and the
 * question of whether its contents match its extension is exactly as open as
 * it is for a student. The same check runs, against the same institute policy.
 *
 * DEDUPLICATED BY CONTENT WITHIN AN ASSIGNMENT. A teacher who uploads the
 * brief, spots a typo, corrects it and uploads again would otherwise leave two
 * files with different names and identical contents, and a student has to
 * guess which is current.
 * ─────────────────────────────────────────────────────────────────────────────
 */
@Injectable()
export class AttachmentService {
  private readonly logger = new Logger(AttachmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly storage: StorageRegistry,
  ) {}

  /**
   * Attach one file to an assignment.
   *
   * Scoped through the assignment: a teacher reaches only the assignments in
   * the classes they teach, and the predicate is what enforces that.
   */
  async upload(
    assignmentId: string,
    file: { originalname: string; buffer: Buffer; size: number; mimetype: string } | undefined,
  ) {
    const actor = getActor();
    if (!actor) throw new AppError("AUTH_TOKEN_INVALID");

    if (!file || file.size === 0) {
      throw new AppError("VALIDATION_FAILED", {
        message: "No file was received.",
        details: [{ field: "file", code: "REQUIRED", message: "Choose a file to attach." }],
      });
    }

    const assignment = await this.prisma.scoped.assignment.findFirst({
      where: { id: assignmentId, deletedAt: null },
      select: { id: true, title: true },
    });
    if (!assignment) throw new AppError("RESOURCE_NOT_FOUND");

    /*
     * THE INSTITUTE'S OWN POLICY, read from the setting rather than a constant
     * — the same list a student's submission is checked against, so a type the
     * Institute has forbidden cannot arrive by the other door.
     */
    const [allowedTypes, maxMb] = await Promise.all([
      this.settings.list("upload.allowedFileTypes"),
      this.settings.number("upload.maxFileSizeMb"),
    ]);

    const existing = await this.prisma.asSystem((db) =>
      db.assignmentAttachment.count({ where: { assignmentId } }),
    );

    const problem = validateUpload({
      filename: file.originalname,
      sizeBytes: file.size,
      bytes: file.buffer,
      policy: {
        allowedTypes: allowedTypes.map((t) => t.toLowerCase().replace(/^\./, "")),
        maxSizeBytes: maxMb * 1024 * 1024,
        // A brief with more than ten files is a brief nobody reads.
        maxFileCount: 10,
      },
      existingCount: existing,
    });
    if (problem) {
      throw new AppError("VALIDATION_FAILED", {
        message: problem.message,
        details: [{ field: "file", code: problem.code, message: problem.message }],
      });
    }

    const contentHash = createHash("sha256").update(file.buffer).digest("hex");

    /*
     * Already attached — returned as success rather than refused. The teacher
     * wanted this file on this assignment; it is. Reporting a duplicate as an
     * error makes somebody re-check whether the first upload worked.
     */
    const duplicate = await this.prisma.asSystem((db) =>
      db.assignmentAttachment.findFirst({
        where: { assignmentId, contentHash },
        select: { id: true, originalFilename: true, sizeBytes: true },
      }),
    );
    if (duplicate) {
      return {
        id: duplicate.id,
        filename: duplicate.originalFilename,
        sizeBytes: Number(duplicate.sizeBytes),
        alreadyAttached: true,
      };
    }

    // SEC-FIL-005 — the stored name is NEVER the uploader's. put() is given a
    // prefix and the provider appends its own generated name.
    const stored = await this.storage
      .forDocuments()
      .put(`assignment-briefs/${assignmentId}`, file.buffer, file.mimetype);

    const created = await this.prisma.asSystem((db) =>
      db.assignmentAttachment.create({
        data: {
          assignmentId,
          storageKey: stored.storageRef,
          originalFilename: safeLabel(file.originalname),
          contentType: file.mimetype,
          sizeBytes: BigInt(file.size),
          contentHash,
          uploadedBy: actor.userId,
        },
        select: { id: true, originalFilename: true, sizeBytes: true },
      }),
    );

    await this.audit.record({
      action: "assignment_attachment.upload",
      entityType: "Assignment",
      entityId: assignmentId,
      after: { filename: created.originalFilename, sizeBytes: file.size },
    });

    return {
      id: created.id,
      filename: created.originalFilename,
      sizeBytes: Number(created.sizeBytes),
      alreadyAttached: false,
    };
  }

  /** What is attached, for the teacher editing it and the student reading it. */
  async list(assignmentId: string) {
    const assignment = await this.prisma.scoped.assignment.findFirst({
      where: { id: assignmentId, deletedAt: null },
      select: { id: true },
    });
    if (!assignment) throw new AppError("RESOURCE_NOT_FOUND");

    const rows = await this.prisma.asSystem((db) =>
      db.assignmentAttachment.findMany({
        where: { assignmentId },
        orderBy: { createdAt: "asc" },
        select: { id: true, originalFilename: true, contentType: true, sizeBytes: true },
      }),
    );
    return rows.map((r) => ({
      id: r.id,
      filename: r.originalFilename,
      contentType: r.contentType,
      sizeBytes: Number(r.sizeBytes),
    }));
  }

  /**
   * The bytes, read server-side.
   *
   * The storage reference never reaches a browser (ARC-041), and the scope
   * check is the assignment's: a student not enrolled in the class cannot
   * reach the assignment, so cannot reach its files.
   */
  async download(attachmentId: string) {
    /*
     * ONE SCOPED QUERY, and the predicate is the whole authorisation.
     *
     * This was a system-wide lookup followed by a second query re-checking
     * that the caller could reach the assignment. That worked, and it put the
     * rule in two places — the second of which somebody eventually forgets on
     * a new route. AssignmentAttachment is nested through Assignment in
     * scope.extension.ts now, so a student reaches an attachment exactly when
     * they reach its assignment: published, and in a class they are enrolled
     * in. An id alone gets nobody anything.
     */
    const row = await this.prisma.scoped.assignmentAttachment.findFirst({
      where: { id: attachmentId },
      select: {
        assignmentId: true,
        storageKey: true,
        originalFilename: true,
        contentType: true,
        sizeBytes: true,
      },
    });
    if (!row) throw new AppError("RESOURCE_NOT_FOUND");

    const body = await this.storage
      .forDocuments()
      .get(row.storageKey)
      .catch(() => null);
    if (!body) {
      this.logger.warn(`Attachment ${attachmentId} is recorded but unreadable.`);
      throw new AppError("RESOURCE_NOT_FOUND", { message: "That file could not be read." });
    }

    return {
      body,
      filename: row.originalFilename,
      contentType: row.contentType,
      sizeBytes: Number(row.sizeBytes),
    };
  }

  /** Remove one. The file goes with the row — nothing else points at it. */
  async remove(attachmentId: string) {
    // Scoped, as above: a teacher removes only from the classes they teach.
    const row = await this.prisma.scoped.assignmentAttachment.findFirst({
      where: { id: attachmentId },
      select: { id: true, assignmentId: true, storageKey: true, originalFilename: true },
    });
    if (!row) throw new AppError("RESOURCE_NOT_FOUND");

    await this.prisma.asSystem((db) =>
      db.assignmentAttachment.delete({ where: { id: attachmentId } }),
    );
    // After the row, so a failure here leaves an orphaned file rather than a
    // row pointing at bytes that are gone — the first is tidy-up, the second
    // is a broken download for every student.
    await this.storage
      .forDocuments()
      .delete(row.storageKey)
      .catch(() => undefined);

    await this.audit.record({
      action: "assignment_attachment.delete",
      entityType: "Assignment",
      entityId: row.assignmentId,
      before: { filename: row.originalFilename },
    });

    return { deleted: true };
  }
}

/** SEC-FIL-005 — a label for a human, never a path. */
function safeLabel(name: string): string {
  return (
    name
      .replace(/[\\/]/g, "_")
      .replace(/^\.+/, "")
      .replace(/[^\w.\- ]/g, "")
      .slice(0, 200) || "attachment"
  );
}
