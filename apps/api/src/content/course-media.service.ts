import { Injectable, Logger } from "@nestjs/common";
import { createHash } from "node:crypto";
import { AppError } from "@lms/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { StorageRegistry } from "./storage/storage.registry";
import { getActor } from "../prisma/actor-context";

/**
 * Course pictures — the one file in this System a stranger may read.
 *
 * EVERYTHING ELSE IS DELIBERATELY NOT PUBLIC. A payment slip, a submission, a
 * lecture recording: each is reached through an authenticated request and a
 * storage key that never leaves the server (SEC-FIL-009, ARC-041). A course
 * thumbnail is the exact opposite of that — it appears on the landing page, to
 * people who have never signed in and never will. Serving it through the same
 * machinery would mean either a broken image for every visitor or an exception
 * carved into the rule that protects everything else, so it has its own model,
 * its own service and its own endpoint.
 *
 * WHAT MAKES THAT SAFE IS THAT NOTHING PRIVATE CAN REACH IT. A media asset is
 * created only by this service, only by staff holding `course_media:create`,
 * and only from a buffer that passed the image sniff below. There is no path
 * by which a payment slip becomes a MediaAsset row, which is what the public
 * endpoint relies on when it serves any id it is given.
 */

/**
 * IMAGES ONLY, AND DECIDED BY CONTENT (SEC-FIL-003).
 *
 * No PDF, unlike a payment slip — this is rendered in an `<img>` on a public
 * page, and the browser's content sniffing is the last thing that should be
 * deciding what a file is. SVG is deliberately absent: it is a document that
 * can carry script, and serving one from the Institute's own origin is a
 * stored cross-site scripting hole wearing a picture's clothes.
 */
const SIGNATURES: Array<{ mime: string; ext: string; test: (b: Buffer) => boolean }> = [
  { mime: "image/jpeg", ext: "jpg", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    mime: "image/png",
    ext: "png",
    test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  },
  {
    mime: "image/webp",
    ext: "webp",
    test: (b) =>
      b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP",
  },
];

/**
 * A course cover, not a photograph album.
 *
 * Three megabytes is already far more than a card 400px wide needs, and the
 * ceiling matters more here than elsewhere: this image is fetched by every
 * visitor to the landing page, most of them on a phone, and an administrator
 * who uploads a 12MB camera original makes the front page slow for everybody
 * without ever seeing it themselves on the office connection.
 */
export const MAX_THUMBNAIL_BYTES = 3 * 1024 * 1024;

@Injectable()
export class CourseMediaService {
  private readonly logger = new Logger(CourseMediaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageRegistry,
  ) {}

  /**
   * Accept one picture and return the id a course will point at.
   *
   * DEDUPLICATED BY CONTENT. An institute uses one cover for a programme and
   * its four subjects; uploading it five times should not store it five times,
   * and the hash makes that free. It also means re-uploading the same file
   * after a mistake elsewhere is harmless rather than another copy.
   */
  async upload(file: { buffer: Buffer; originalname: string; size: number } | undefined) {
    const actor = getActor();
    if (!actor) throw new AppError("AUTH_TOKEN_INVALID");

    if (!file || file.size === 0) {
      throw new AppError("VALIDATION_FAILED", {
        message: "No picture was received.",
        details: [{ field: "file", code: "REQUIRED", message: "Choose a picture to upload." }],
      });
    }

    if (file.size > MAX_THUMBNAIL_BYTES) {
      throw new AppError("FILE_TOO_LARGE", {
        message: "That picture is too large.",
        details: [
          {
            field: "file",
            code: "TOO_LARGE",
            message:
              `The limit is ${MAX_THUMBNAIL_BYTES / 1024 / 1024} MB. This picture is shown on a ` +
              "card a few hundred pixels wide, so a large one costs every visitor time and shows " +
              "them nothing extra.",
          },
        ],
      });
    }

    const kind = SIGNATURES.find((s) => s.test(file.buffer));
    if (!kind) {
      throw new AppError("FILE_TYPE_NOT_ALLOWED", {
        message: "That file is not a picture the System can show.",
        details: [
          {
            field: "file",
            code: "UNSUPPORTED_TYPE",
            // Named formats, and the two exclusions explained, because "invalid
            // file" sends somebody to try the same SVG three more times.
            message:
              "Use a JPEG, PNG or WebP. PDFs and SVGs are not accepted — a PDF is not an image, " +
              "and an SVG can carry script.",
          },
        ],
      });
    }

    const contentHash = createHash("sha256").update(file.buffer).digest("hex");

    const existing = await this.prisma.asSystem((db) =>
      db.mediaAsset.findFirst({
        where: { contentHash, deletedAt: null },
        select: { id: true, contentType: true, sizeBytes: true },
      }),
    );
    if (existing) {
      return {
        id: existing.id,
        url: this.urlFor(existing.id),
        contentType: existing.contentType,
        sizeBytes: Number(existing.sizeBytes),
        deduplicated: true,
      };
    }

    // The stored NAME IS NEVER THE UPLOADER'S (SEC-FIL-005). The key given to
    // put() is a PREFIX; the provider appends its own generated name, and the
    // returned ref is what must be stored — storing the prefix records a
    // directory and reading it back fails with EISDIR.
    const stored = await this.storage
      .forDocuments()
      .put(`course-media/${contentHash}.${kind.ext}`, file.buffer, kind.mime);

    const created = await this.prisma.asSystem((db) =>
      db.mediaAsset.create({
        data: {
          kind: "COURSE_THUMBNAIL",
          storageKey: stored.storageRef,
          originalFilename: safeLabel(file.originalname),
          contentType: kind.mime,
          sizeBytes: BigInt(file.size),
          contentHash,
          createdBy: actor.userId,
        },
        select: { id: true },
      }),
    );

    await this.audit.record({
      action: "course_media.upload",
      entityType: "MediaAsset",
      entityId: created.id,
      after: { contentType: kind.mime, sizeBytes: file.size },
    });

    return {
      id: created.id,
      url: this.urlFor(created.id),
      contentType: kind.mime,
      sizeBytes: file.size,
      deduplicated: false,
    };
  }

  /**
   * The bytes, for the public endpoint.
   *
   * Returns null rather than throwing for anything missing. This is called for
   * an `<img>` on a page a stranger is looking at; the honest answer to an id
   * that is not there is 404, and an exception filter turning it into a JSON
   * error envelope inside an image tag helps nobody.
   */
  async read(id: string): Promise<{ body: Buffer; contentType: string } | null> {
    const asset = await this.prisma.asSystem((db) =>
      db.mediaAsset.findFirst({
        where: { id, deletedAt: null },
        select: { storageKey: true, contentType: true },
      }),
    );
    if (!asset) return null;

    try {
      const body = await this.storage.forDocuments().get(asset.storageKey);
      return { body, contentType: asset.contentType };
    } catch (err) {
      // The row exists and the file does not — somebody cleared storage, or a
      // provider was switched. Logged, because it means the landing page has a
      // broken image nobody has reported.
      this.logger.warn(
        `Course media ${id} is catalogued but unreadable: ` +
          (err instanceof Error ? err.message : "unknown error"),
      );
      return null;
    }
  }

  /** What a course row stores, and what the browser asks for. */
  urlFor(id: string): string {
    return `/api/v1/public/course-media/${id}`;
  }

  /**
   * Forget a picture.
   *
   * SOFT, and the courses using it are left pointing at nothing rather than
   * blocked from being edited — the foreign keys are ON DELETE SET NULL for
   * exactly this. A course with no picture falls back to its generated cover,
   * which is what it had before anybody uploaded one, so the worst outcome of
   * deleting the wrong file is a card that looks like it did last week.
   */
  async remove(id: string) {
    const asset = await this.prisma.asSystem((db) =>
      db.mediaAsset.findFirst({ where: { id, deletedAt: null }, select: { id: true } }),
    );
    if (!asset) throw new AppError("RESOURCE_NOT_FOUND");

    await this.prisma.asSystem((db) =>
      db.$transaction(async (tx) => {
        await tx.programme.updateMany({
          where: { thumbnailAssetId: id },
          data: { thumbnailAssetId: null },
        });
        await tx.subject.updateMany({
          where: { thumbnailAssetId: id },
          data: { thumbnailAssetId: null },
        });
        await tx.mediaAsset.update({ where: { id }, data: { deletedAt: new Date() } });
      }),
    );

    await this.audit.record({
      action: "course_media.delete",
      entityType: "MediaAsset",
      entityId: id,
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
      .slice(0, 120) || "picture"
  );
}
