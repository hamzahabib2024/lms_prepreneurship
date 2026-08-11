import { Injectable, Logger } from "@nestjs/common";
import { createHash } from "node:crypto";
import { AppError } from "@lms/shared";
import { PrismaService } from "../prisma/prisma.service";
import { StorageRegistry } from "../content/storage/storage.registry";

/**
 * Payment slips, uploaded by a stranger — FR-REG-008.
 *
 * THIS IS THE MOST EXPOSED ENDPOINT IN THE SYSTEM. Everything else needs a
 * token; this takes a file from anybody on the internet. So it is deliberately
 * narrow: a small number of image and PDF types, a small size, a hard cap on
 * how many an unattached applicant may leave lying about, and a name that is
 * never used as a path.
 *
 * WHY IT EXISTS AT ALL: the submit schema demands between one and five slip
 * ids, nothing in the System could create one, and `registration_request_id`
 * was NOT NULL so an unattached slip was impossible by construction. The
 * public application endpoint has therefore never been reachable by a member
 * of the public. This is the missing half.
 */

/** SEC-FIL-003 — decided by CONTENT, not by the name the browser sent. */
const SIGNATURES: Array<{ mime: string; ext: string; test: (b: Buffer) => boolean }> = [
  { mime: "image/jpeg", ext: "jpg", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    mime: "image/png",
    ext: "png",
    test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  },
  {
    mime: "application/pdf",
    ext: "pdf",
    test: (b) => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46,
  },
  {
    mime: "image/webp",
    ext: "webp",
    test: (b) =>
      b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP",
  },
];

/** A photograph of a slip from a phone. Five megabytes is generous for that. */
export const MAX_SLIP_BYTES = 5 * 1024 * 1024;

/** FR-REG-008 allows five per application; this is the unattached ceiling. */
export const MAX_UNATTACHED_PER_HOUR = 10;

@Injectable()
export class SlipService {
  private readonly logger = new Logger(SlipService.name);

  constructor(
    private readonly prisma: PrismaService,
    // Through the registry, so a slip lands wherever the Institute has
    // configured storage rather than always on local disk (ARC-043).
    private readonly storage: StorageRegistry,
  ) {}

  /**
   * Accepts one slip and returns the id the application will name.
   *
   * The id is the only thing the uploader gets back, and it is a bearer token
   * for exactly one thing: naming this slip on a submission. That is why the
   * submit step will only claim slips that are still UNATTACHED — otherwise a
   * guessed id would let somebody staple another applicant's bank slip to
   * their own application.
   */
  async upload(file: { buffer: Buffer; originalname: string; size: number } | undefined) {
    if (!file || file.size === 0) {
      throw new AppError("VALIDATION_FAILED", {
        message: "No file was received.",
        details: [{ field: "file", code: "REQUIRED", message: "Attach a photo of your payment slip." }],
      });
    }

    if (file.size > MAX_SLIP_BYTES) {
      // The System has a code for exactly this, and using VALIDATION_FAILED
      // instead would make it indistinguishable from a mistyped name.
      throw new AppError("FILE_TOO_LARGE", {
        message: "That file is too large.",
        details: [
          {
            field: "file",
            code: "TOO_LARGE",
            message: `The limit is ${MAX_SLIP_BYTES / 1024 / 1024} MB. A photo from a phone is usually well under it.`,
          },
        ],
      });
    }

    // SEC-FIL-003 — the CONTENT decides the type. A .jpg that is really an
    // executable is the oldest trick there is, and the browser's own
    // content-type is whatever the uploader chose to send.
    const kind = SIGNATURES.find((s) => s.test(file.buffer));
    if (!kind) {
      throw new AppError("FILE_TYPE_NOT_ALLOWED", {
        message: "That file is not a photo or a PDF.",
        details: [
          {
            field: "file",
            code: "UNSUPPORTED_TYPE",
            // Named types rather than "invalid file", so somebody with a HEIC
            // photograph from an iPhone knows what to do about it.
            message: "Attach a JPEG, PNG, WebP or PDF. A photo taken with a phone camera is fine.",
          },
        ],
      });
    }

    const contentHash = createHash("sha256").update(file.buffer).digest("hex");

    // An applicant who uploads the same slip twice — by pressing the button
    // again on a slow connection — gets the same row rather than two, so the
    // reviewer is not shown a duplicate they have to think about.
    const existing = await this.prisma.asSystem((db) =>
      db.registrationDocument.findFirst({
        where: { contentHash, registrationRequestId: null },
        select: { id: true, createdAt: true },
      }),
    );
    if (existing) return { documentId: existing.id, deduplicated: true };

    await this.refuseIfFlooding();

    // The stored NAME IS NEVER THE UPLOADER'S (SEC-FIL-005). The original is
    // kept as a label for the reviewer and never touches a path.
    // THE KEY PASSED TO put() IS A PREFIX, not the final path: the provider
    // appends its own generated name (SEC-FIL-005, so an uploader never
    // chooses where their file lands). Storing the prefix instead of the
    // returned ref recorded a DIRECTORY, and reading it back failed with
    // EISDIR the first time a reviewer opened a slip.
    const stored = await this.storage
      .forDocuments()
      .put(`registration-slips/${contentHash}.${kind.ext}`, file.buffer, kind.mime);
    const storageKey = stored.storageRef;

    const created = await this.prisma.asSystem((db) =>
      db.registrationDocument.create({
        data: {
          documentType: "PAYMENT_SLIP",
          storageKey,
          originalFilename: safeLabel(file.originalname),
          contentType: kind.mime,
          sizeBytes: BigInt(file.size),
          contentHash,
          // SEC-FIL-004 — no scanner is wired up yet, and PENDING is the
          // truthful state. Claiming CLEAN would be a lie the reviewer relies
          // on when they open the file.
          scanStatus: "PENDING",
        },
        select: { id: true },
      }),
    );

    return { documentId: created.id, deduplicated: false };
  }

  /**
   * A crude flood check on the unattached pile.
   *
   * The throttler already limits by address. This is the second line, and it
   * exists because the first one is per-IP: somebody on a mobile network
   * changes address freely, and a public endpoint that writes files needs a
   * limit that does not depend on who is asking.
   */
  private async refuseIfFlooding() {
    const anHourAgo = new Date(Date.now() - 3_600_000);
    const recent = await this.prisma.asSystem((db) =>
      db.registrationDocument.count({
        where: { registrationRequestId: null, createdAt: { gte: anHourAgo } },
      }),
    );
    if (recent >= MAX_UNATTACHED_PER_HOUR * 20) {
      this.logger.warn(
        JSON.stringify({ event: "slip.flood", unattachedLastHour: recent }),
      );
      throw new AppError("RESOURCE_CONFLICT", {
        message:
          "Too many uploads at the moment. Please try again shortly, or bring the slip to the office.",
      });
    }
  }
}

/**
 * A label, not a path.
 *
 * Kept for the reviewer to recognise, stripped of everything that could make
 * it behave as anything else: no directories, no leading dots, bounded length.
 */
function safeLabel(name: string): string {
  return (
    name
      .replace(/[\\/]/g, "_")
      .replace(/^\.+/, "")
      .replace(/[^\w.\- ]/g, "")
      .slice(0, 120) || "slip"
  );
}
