import { Injectable, Logger } from "@nestjs/common";
import { createHash } from "node:crypto";
import { AppError } from "@lms/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { getActor } from "../prisma/actor-context";
import { StorageRegistry } from "./storage/storage.registry";
import { validateUpload } from "../assessment/file-validation";
import { SettingsService } from "../settings/settings.service";

export interface IncomingFile {
  originalname: string;
  size: number;
  buffer: Buffer;
}

/**
 * Lesson resources — SRS §5.8, FR-CRS-035..039.
 *
 * The files that go with a lesson: slides, a handout, a worksheet.
 * `lesson_resource` has been in the §4.5 matrix since the first commit with no
 * endpoint behind it and no table to put anything in.
 *
 * DISTINCT FROM A RECORDED LECTURE, which is the video and belongs to one
 * OFFERING. A lesson belongs to a module and a module to a SUBJECT, so a
 * handout is subject-level: every section studying that subject gets it, and
 * uploading it once is the point.
 *
 * TWO PUBLICATION GATES, enforced by the scope policy. The resource has its own
 * status so a teacher can upload next week's worksheet to an already-published
 * lesson without it appearing immediately, and the lesson's status is checked
 * as well so a published handout inside a draft lesson stays invisible
 * (BR-CNT-01).
 *
 * THE STORAGE KEY NEVER LEAVES THE SYSTEM (ARC-041, SEC-FIL-009). A student is
 * given bytes through a download route, never a location they could share.
 */
@Injectable()
export class LessonResourceService {
  private readonly logger = new Logger(LessonResourceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageRegistry,
    private readonly settings: SettingsService,
  ) {}

  /** FR-CRS-036 — attach a file to a lesson. */
  async upload(lessonId: string, title: string, file: IncomingFile) {
    const actor = getActor();
    if (!actor) throw new AppError("AUTH_TOKEN_INVALID");

    // Scoped: a teacher's policy denies a lesson outside the subjects they
    // teach, so this is genuinely "a lesson I may add to".
    const lesson = await this.prisma.scoped.lesson.findFirst({
      where: { id: lessonId, deletedAt: null },
      select: { id: true, title: true },
    });
    if (!lesson) throw new AppError("RESOURCE_NOT_FOUND");

    // The institute's own limits, not constants. An institute that allows 8 MB
    // submissions should not silently allow 50 MB handouts.
    const [maxMb, allowed] = await Promise.all([
      this.settings.number("upload.maxFileSizeMb"),
      this.settings.list("upload.allowedFileTypes"),
    ]);

    const rejection = validateUpload({
      filename: file.originalname,
      sizeBytes: file.size,
      bytes: file.buffer,
      policy: {
        allowedTypes: allowed,
        maxSizeBytes: maxMb * 1024 * 1024,
        // A lesson can carry a set of handouts; the cap is on any one file.
        maxFileCount: 100,
      },
      existingCount: 0,
    });
    if (rejection) {
      this.logger.warn(
        JSON.stringify({
          event: "lesson_resource.rejected",
          reason: rejection.code,
          lessonId,
          correlationId: actor.correlationId,
        }),
      );
      throw new AppError("VALIDATION_FAILED", {
        details: [{ field: "file", code: rejection.code, message: rejection.message }],
      });
    }

    // Determined from the BYTES. validateUpload has already refused anything
    // whose content disagrees with its extension (SEC-FIL-003), so the two
    // agree by now — it is read from the signature anyway, because "we checked
    // earlier" is how a mismatch eventually gets stored.
    const contentType = detectType(file.buffer, file.originalname);
    const contentHash = createHash("sha256").update(file.buffer).digest("hex");
    const stored = await this.storage
      .forDocuments()
      .put(`lesson-resources/${lessonId}/${contentHash}`, file.buffer, contentType);

    const last = await this.prisma.asSystem((db) =>
      db.lessonResource.findFirst({
        where: { lessonId, deletedAt: null },
        orderBy: { displayOrder: "desc" },
        select: { displayOrder: true },
      }),
    );

    const created = await this.prisma.asSystem((db) =>
      db.lessonResource.create({
        data: {
          lessonId,
          title: title.trim(),
          storageKey: stored.storageRef,
          originalFilename: file.originalname,
          contentType,
          sizeBytes: BigInt(file.size),
          contentHash,
          displayOrder: (last?.displayOrder ?? -1) + 1,
          createdBy: actor.userId,
        },
      }),
    );

    await this.audit.record({
      action: "lesson_resource.upload",
      entityType: "LessonResource",
      entityId: created.id,
      after: { lessonId, title: created.title, filename: file.originalname, sizeBytes: file.size },
    });

    return this.present(created);
  }

  /** FR-CRS-037 — what is attached to a lesson. */
  async list(lessonId: string) {
    // Scoped both ways: the lesson must be reachable, and the resources under
    // it are filtered by their own policy — a student sees published ones
    // inside a published lesson and nothing else.
    const lesson = await this.prisma.scoped.lesson.findFirst({
      where: { id: lessonId, deletedAt: null },
      select: { id: true },
    });
    if (!lesson) throw new AppError("RESOURCE_NOT_FOUND");

    const resources = await this.prisma.scoped.lessonResource.findMany({
      where: { lessonId, deletedAt: null },
      orderBy: { displayOrder: "asc" },
    });

    return resources.map((r: (typeof resources)[number]) => this.present(r));
  }

  /** FR-CRS-038 — make it visible to students, or hide it again. */
  async setPublication(resourceId: string, status: "DRAFT" | "PUBLISHED") {
    const resource = await this.prisma.scoped.lessonResource.findFirst({
      where: { id: resourceId, deletedAt: null },
    });
    if (!resource) throw new AppError("RESOURCE_NOT_FOUND");

    const updated = await this.prisma.asSystem((db) =>
      db.lessonResource.update({ where: { id: resourceId }, data: { publicationStatus: status } }),
    );

    await this.audit.record({
      action: "lesson_resource.publication",
      entityType: "LessonResource",
      entityId: resourceId,
      before: { publicationStatus: resource.publicationStatus },
      after: { publicationStatus: status },
    });

    // Said plainly. Publishing a resource inside a lesson nobody has released
    // changes nothing a student can see, and somebody pressing "publish" and
    // seeing no effect deserves to know why rather than assume it is broken.
    const lesson = await this.prisma.asSystem((db) =>
      db.lesson.findUnique({
        where: { id: resource.lessonId },
        select: { publicationStatus: true, title: true },
      }),
    );

    return {
      ...this.present(updated),
      message:
        status === "PUBLISHED" && lesson?.publicationStatus !== "PUBLISHED"
          ? `Published — but "${lesson?.title}" is still a draft, so students cannot see it yet.`
          : status === "PUBLISHED"
            ? "Published. Students studying this subject can download it now."
            : "Hidden from students.",
    };
  }

  /** FR-CRS-039 — remove it. Soft, per BR-DAT-02. */
  async remove(resourceId: string) {
    const resource = await this.prisma.scoped.lessonResource.findFirst({
      where: { id: resourceId, deletedAt: null },
    });
    if (!resource) throw new AppError("RESOURCE_NOT_FOUND");

    await this.prisma.asSystem((db) =>
      db.lessonResource.update({ where: { id: resourceId }, data: { deletedAt: new Date() } }),
    );

    await this.audit.record({
      action: "lesson_resource.delete",
      entityType: "LessonResource",
      entityId: resourceId,
      before: { title: resource.title, deletedAt: null },
      after: { deletedAt: new Date().toISOString() },
    });

    // The stored object is left where it is. BR-DAT-02 keeps the record, and a
    // resource restored after an accidental delete with no bytes behind it
    // would be worse than one that takes disk space.
    return { id: resourceId, removed: true };
  }

  /**
   * FR-CRS-039 — the bytes.
   *
   * Read through the SCOPED client, so the two publication gates decide whether
   * this student may have it. Nothing about the storage location is returned;
   * ARC-041 keeps that inside the System.
   */
  async download(resourceId: string) {
    const resource = await this.prisma.scoped.lessonResource.findFirst({
      where: { id: resourceId, deletedAt: null },
    });
    if (!resource) throw new AppError("RESOURCE_NOT_FOUND");

    const body = await this.storage
      .forDocuments()
      .get(resource.storageKey)
      .catch(() => {
        // ARC-045 — a missing file is not an internal error to the person who
        // wanted it. It is something their teacher has to fix.
        throw new AppError("STORAGE_UNAVAILABLE", {
          message: "That file could not be retrieved. Please tell your teacher.",
        });
      });

    return {
      body,
      filename: resource.originalFilename,
      contentType: resource.contentType,
      sizeBytes: Number(resource.sizeBytes),
    };
  }

  /** BigInt does not survive JSON, and the storage key never leaves. */
  private present(r: {
    id: string;
    title: string;
    originalFilename: string;
    contentType: string;
    sizeBytes: bigint;
    displayOrder: number;
    publicationStatus: string;
    createdAt: Date;
  }) {
    return {
      id: r.id,
      title: r.title,
      filename: r.originalFilename,
      contentType: r.contentType,
      sizeBytes: Number(r.sizeBytes),
      displayOrder: r.displayOrder,
      publicationStatus: r.publicationStatus,
      uploadedAt: r.createdAt,
    };
  }
}

/** The type, from the bytes. */
function detectType(bytes: Buffer, filename: string): string {
  const head = bytes.subarray(0, 8);
  if (head.subarray(0, 4).toString("hex") === "25504446") return "application/pdf";
  if (head.subarray(0, 2).toString("hex") === "504b") {
    // A zip container: docx, xlsx, pptx and plain zip all look like this.
    const ext = filename.split(".").pop()?.toLowerCase();
    if (ext === "docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    if (ext === "xlsx") return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    if (ext === "pptx") return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    return "application/zip";
  }
  if (head.subarray(0, 3).toString("hex") === "ffd8ff") return "image/jpeg";
  if (head.subarray(0, 8).toString("hex") === "89504e470d0a1a0a") return "image/png";
  return "application/octet-stream";
}
