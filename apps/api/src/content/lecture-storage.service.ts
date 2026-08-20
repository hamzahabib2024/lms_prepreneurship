import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createReadStream } from "node:fs";
import { stat, unlink } from "node:fs/promises";
import { AppError } from "@lms/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { StorageRegistry } from "./storage/storage.registry";
import { assertOwnsSectionSubject } from "../rbac/ownership";
import type { UploadCapability } from "./storage/storage.provider";

/**
 * The Institute's lecture folders, and putting a recording into one.
 *
 * TWO THINGS THAT WERE ONLY POSSIBLE OUTSIDE THE SYSTEM.
 *
 * Connecting a class to its Drive folder has always meant opening Drive in
 * another tab, finding the folder among a dozen with similar names, copying
 * the address bar and pasting it back. The System could list that folder the
 * whole time — it simply never showed anybody the list. `folderIndex()` is
 * that list, with the id beside each name so it can be copied without leaving.
 *
 * And a recording that was not made by Google Meet — something recorded on a
 * phone, an old file, a screen capture — could not be added at all. It had to
 * be uploaded to Drive by hand first, which means the person adding it needs
 * Drive access to the Institute's account, which most staff should not have.
 *
 * WHY THE INDEX IS OFFICE-ONLY. A folder id is close to a bearer token for
 * that folder's contents. A teacher holding `recorded_lecture:create` may
 * catalogue a recording for their own class, and it does not follow that they
 * should be handed the identifier of every other class's folder — with one, a
 * teacher can point their own class at another cohort's recordings.
 */
@Injectable()
export class LectureStorageService {
  private readonly logger = new Logger(LectureStorageService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageRegistry,
    private readonly config: ConfigService,
  ) {}

  /**
   * Every folder under the configured root, by name and by id.
   *
   * ONE LEVEL DEEP BY DEFAULT, because that is how the Institute's Drive is
   * actually arranged — one folder per class under `Recordings` — and walking
   * the whole tree on a page load would be a Drive round trip per folder for
   * a depth nobody uses. `parent` lets somebody go deeper deliberately.
   *
   * ALSO REPORTS WHICH CLASS ALREADY USES EACH FOLDER. Without it the choice
   * is twelve folders with near-identical names and no way to tell which are
   * spoken for — and connecting a class to a folder another class is already
   * reading is silent, and shows one cohort another's recordings.
   */
  async folderIndex(parent?: string) {
    const provider = this.storage.forLectures();
    const root = parent?.trim() || this.rootFolder();

    if (!root) {
      throw new AppError("VALIDATION_FAILED", {
        message:
          "No lecture folder root is configured. Set GOOGLE_DRIVE_ROOT_FOLDER_ID to the folder " +
          "your class folders live in, or pass one explicitly.",
      });
    }

    const entries = await provider.listFolder(root);
    const folders = entries.filter((e) => e.isFolder);

    // Which folders are already spoken for. One query rather than one per
    // folder — this list is a dozen long today and should not be a dozen round
    // trips.
    const inUse = await this.prisma.asSystem((db) =>
      db.sectionSubject.findMany({
        where: { lectureFolderRef: { in: folders.map((f) => f.storageRef) }, deletedAt: null },
        select: {
          lectureFolderRef: true,
          subject: { select: { name: true, code: true } },
          section: { select: { code: true } },
        },
      }),
    );
    const usedBy = new Map(
      inUse.map((s) => [
        s.lectureFolderRef,
        `${s.subject.name} · ${s.section.code}`,
      ]),
    );

    return {
      provider: provider.key,
      root,
      folders: folders.map((f) => ({
        id: f.storageRef,
        name: f.name,
        modifiedAt: f.modifiedAt,
        // The address an administrator would otherwise go and copy by hand.
        // Only meaningful for Drive; null elsewhere rather than a made-up link.
        url:
          provider.key === "google_drive"
            ? `https://drive.google.com/drive/folders/${f.storageRef}`
            : null,
        usedBy: usedBy.get(f.storageRef) ?? null,
      })),
      // Files sitting loose in the root, which usually means somebody uploaded
      // a recording to the wrong place. Worth showing rather than hiding.
      looseFiles: entries.filter((e) => !e.isFolder).length,
    };
  }

  private rootFolder(): string {
    return (this.config.get<string>("GOOGLE_DRIVE_ROOT_FOLDER_ID", "") ?? "").trim();
  }

  /**
   * Would an upload for this class succeed? Asked before the bytes are sent.
   *
   * The answer is not always yes and the reason is not always fixable in code
   * — see canAcceptUploads on the Drive adapter, and the service-account quota
   * constraint it documents. A panel that offers a file picker without knowing
   * this makes somebody wait for a 300 MB transfer to be told it was never
   * going to work.
   */
  async uploadTarget(sectionSubjectId: string): Promise<
    UploadCapability & { folderRef: string | null; provider: string; fallback: string }
  > {
    assertOwnsSectionSubject(sectionSubjectId);

    const ss = await this.prisma.scoped.sectionSubject.findFirst({
      where: { id: sectionSubjectId, deletedAt: null },
      select: { lectureFolderRef: true },
    });
    if (!ss) throw new AppError("RESOURCE_NOT_FOUND");

    const provider = this.storage.forLectures();
    const capability = provider.canAcceptUploads
      ? await provider.canAcceptUploads(ss.lectureFolderRef)
      : {
          accepted: false,
          reason: `${provider.key} storage cannot accept uploads through the System.`,
        };

    return {
      ...capability,
      folderRef: ss.lectureFolderRef,
      provider: provider.key,
      // Always available, and named so the panel can offer it when the
      // preferred destination refuses.
      fallback: "local",
    };
  }

  /**
   * Take the recording and catalogue it — FR-VID-002, FR-VID-003.
   *
   * THE FILE ARRIVES AS A PATH ON DISK, not as a Buffer, and multer put it
   * there rather than in memory. A 360 MB recording read into this process to
   * be written straight back out is the whole application tier gone on one
   * upload, and the Institute's own files are that size.
   *
   * `storeIn` lets the caller choose the System's own storage when Drive has
   * refused — which it does for a folder in an ordinary Google Drive, because
   * a service account has no quota there. The lecture still reaches the class;
   * only its address is different.
   *
   * THE TEMPORARY FILE IS ALWAYS REMOVED. On success, on refusal, and on a
   * crash in between — an upload directory that fills with abandoned 300 MB
   * files takes a server down a week later for reasons nobody connects to this.
   */
  async uploadLecture(input: {
    sectionSubjectId: string;
    lessonId?: string;
    title: string;
    recordedOn: Date;
    tempPath: string;
    originalName: string;
    contentType: string;
    storeIn?: "auto" | "local";
  }) {
    assertOwnsSectionSubject(input.sectionSubjectId);

    try {
      const ss = await this.prisma.scoped.sectionSubject.findFirst({
        where: { id: input.sectionSubjectId, deletedAt: null },
        select: { id: true, lectureFolderRef: true },
      });
      if (!ss) throw new AppError("RESOURCE_NOT_FOUND");

      const preferred = this.storage.forLectures();
      const local = this.storage.forDocuments();

      // Which provider actually gets it.
      let provider = preferred;
      let folderRef = ss.lectureFolderRef;
      let usedFallback = false;

      if (input.storeIn === "local" || !preferred.putStream) {
        provider = local;
        folderRef = `lectures/${ss.id}`;
        usedFallback = preferred.key !== local.key;
      } else if (preferred.canAcceptUploads) {
        const can = await preferred.canAcceptUploads(ss.lectureFolderRef);
        if (!can.accepted) {
          // Refused, and the caller did not ask for the fallback. Say why
          // rather than silently storing it somewhere else — where a recording
          // lives is something the Institute has a view about.
          throw new AppError("STORAGE_UNAVAILABLE", {
            message: can.reason ?? "That recording cannot be uploaded to the configured storage.",
          });
        }
      }

      if (!provider.putStream) {
        throw new AppError("STORAGE_UNAVAILABLE", {
          message: `${provider.key} storage cannot accept uploads.`,
        });
      }

      const { size } = await stat(input.tempPath);
      const stored = await provider.putStream({
        folderRef,
        filename: safeName(input.originalName, input.title),
        contentType: input.contentType,
        sizeBytes: size,
        body: createReadStream(input.tempPath),
      });

      /*
       * THE BYTES ARE STORED AND THE ROW IS NOT — the one window where this
       * can leave rubbish behind, and it is not hypothetical: the first real
       * upload through this path failed at exactly this line and left a 3 MB
       * file in storage that nothing referenced and nothing would ever
       * collect. Repeated by anybody retrying a failing upload, that fills a
       * disk with files no screen can see.
       *
       * So a failure after the write removes what was written. Best effort and
       * deliberately so: if the cleanup itself fails there is nothing useful to
       * do about it, and it must not replace the real error with its own.
       *
       * NOT DONE FOR DRIVE, and that is the SYSTEM NEVER DESTROYS ANYTHING IN
       * THE INSTITUTE'S DRIVE rule holding: `delete()` on that adapter makes no
       * request at all. An orphan there is a file in a folder somebody can see
       * and remove, which is a far better failure than this code deleting from
       * the Institute's only copy of its recordings.
       */
      let created;
      try {
        created = await this.prisma.scoped.recordedLecture.create({
          data: {
            sectionSubjectId: input.sectionSubjectId,
            ...(input.lessonId ? { lessonId: input.lessonId } : {}),
            title: input.title.trim(),
            storageProvider: provider.key,
            storageRef: stored.storageRef,
            recordedOn: input.recordedOn,
            durationSeconds: stored.durationSeconds,
            // DRAFT, always. An upload is not a publication: somebody who picks
            // the wrong file must not have put it in front of a cohort by doing
            // so (BR-CNT-05).
            publicationStatus: "DRAFT",
            // It was just written and read back, so it is there. The weekly
            // sweep (ARC-045) will say otherwise if that ever stops being true.
            availabilityStatus: "AVAILABLE",
            lastVerifiedAt: new Date(),
          },
          select: { id: true, title: true, storageRef: true },
        });
      } catch (err) {
        await provider.delete(stored.storageRef).catch(() => undefined);
        this.logger.error(
          `Cataloguing failed after the bytes were stored; removed ${stored.storageRef} from ` +
            `${provider.key}`,
          err as Error,
        );
        throw err;
      }

      await this.audit.record({
        action: "recorded_lecture.upload",
        entityType: "RecordedLecture",
        entityId: created.id,
        after: {
          sectionSubjectId: input.sectionSubjectId,
          provider: provider.key,
          sizeBytes: size,
          usedFallback,
        },
      });

      this.logger.log(
        `Uploaded "${created.title}" (${Math.round(size / 1048576)} MB) to ${provider.key}`,
      );

      return {
        id: created.id,
        title: created.title,
        provider: provider.key,
        sizeBytes: stored.sizeBytes,
        durationSeconds: stored.durationSeconds,
        usedFallback,
        publicationStatus: "DRAFT" as const,
        message: usedFallback
          ? "Stored by the System rather than in Google Drive, and added as a draft. Publish it when you are ready."
          : "Uploaded and added as a draft. Publish it when you are ready.",
      };
    } finally {
      await unlink(input.tempPath).catch(() => undefined);
    }
  }
}

/**
 * SEC-FIL-005 — a label, never a path.
 *
 * The name is what appears in the Institute's Drive folder beside recordings
 * Google made, so it is worth keeping something human: the title the person
 * typed, with the original extension so the file opens in Drive's own player.
 */
function safeName(originalName: string, title: string): string {
  const ext = /\.([A-Za-z0-9]{2,5})$/.exec(originalName)?.[1] ?? "mp4";
  const base =
    title
      .trim()
      .replace(/[\\/:*?"<>|]/g, "")
      .slice(0, 120) || "Lecture";
  return `${base}.${ext.toLowerCase()}`;
}
