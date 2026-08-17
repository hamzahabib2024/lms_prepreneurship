import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { AppError } from "@lms/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { StorageRegistry } from "./storage/storage.registry";

/**
 * A lecture appears on the course page when the file appears in the folder.
 *
 * WHAT THIS IS FOR. A teacher records a class and puts it in the shared folder.
 * Before this, somebody then had to open the System and create a matching
 * lecture by hand — so the recording existed and the card did not, and the gap
 * was discovered by a student who could not find last Tuesday's class.
 *
 * IT IS PROVIDER-AGNOSTIC. It reads through the storage registry, so it works
 * against Google Drive when DEP-01 is resolved and against local storage today,
 * with no code change — only LECTURE_STORAGE. That is deliberate: a sync that
 * could only be tested against Drive could not be tested at all right now.
 *
 * WHAT IT WILL NOT DO:
 *
 *   It never PUBLISHES. A new lecture arrives as a DRAFT, because a file in a
 *   folder is not a decision to show it to students — BR-CNT-01 gives that
 *   decision to a person, and a sweep that published automatically would put
 *   an unedited recording in front of a class at four in the morning.
 *
 *   It never DELETES. A file missing from the folder marks the lecture
 *   unavailable (ARC-045); it does not remove the catalogue entry, because the
 *   watch history hanging off it is a student's record of work.
 *
 *   It never renames or reorders what a person has edited. Only the storage
 *   reference and the availability are refreshed on a lecture that already
 *   exists, so a title somebody tidied up stays tidied.
 */
@Injectable()
export class LectureSyncService {
  private readonly logger = new Logger(LectureSyncService.name);

  /** Extensions worth cataloguing. A folder also holds notes and stray files. */
  private static readonly VIDEO = /\.(mp4|m4v|mov|webm|mkv|avi)$/i;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageRegistry,
  ) {}

  /**
   * Hourly. Not every minute: a recording is uploaded after a class and nobody
   * is waiting on the same minute, and an hourly sweep of every configured
   * folder is a cost the Institute pays whether or not anything changed.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async sweepAll(): Promise<void> {
    const offerings = await this.prisma.asSystem((db) =>
      db.sectionSubject.findMany({
        where: { deletedAt: null, lectureFolderRef: { not: null } },
        select: { id: true, lectureFolderRef: true },
      }),
    );

    for (const offering of offerings) {
      try {
        await this.sync(offering.id);
      } catch (err) {
        // One unreachable folder must not stop the rest. A Drive share that
        // was revoked is a normal Tuesday.
        this.logger.warn(
          `Lecture sync failed for section-subject ${offering.id}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  }

  /**
   * Sync one class's folder. Returns what changed, so the screen that asked
   * can say so rather than claiming success in general.
   */
  async sync(sectionSubjectId: string): Promise<{
    added: number;
    restored: number;
    missing: number;
    scanned: number;
    folderRef: string;
  }> {
    const offering = await this.prisma.scoped.sectionSubject.findFirst({
      where: { id: sectionSubjectId, deletedAt: null },
      select: { id: true, lectureFolderRef: true, subjectId: true },
    });
    if (!offering) throw new AppError("RESOURCE_NOT_FOUND");
    if (!offering.lectureFolderRef) {
      throw new AppError("VALIDATION_FAILED", {
        details: [
          {
            field: "lectureFolderRef",
            code: "NOT_SET",
            message:
              "This class has no lecture folder yet. Set one so recordings put in it appear here.",
          },
        ],
      });
    }

    const provider = this.storage.forLectures();
    const entries = await provider.listFolder(offering.lectureFolderRef);
    const videos = entries.filter((e) => !e.isFolder && LectureSyncService.VIDEO.test(e.name));

    // Everything already catalogued for this class, by storage reference —
    // which is the identity that survives a rename in the folder.
    const existing = await this.prisma.asSystem((db) =>
      db.recordedLecture.findMany({
        where: { sectionSubjectId, deletedAt: null },
        select: { id: true, storageRef: true, availabilityStatus: true },
      }),
    );
    const byRef = new Map(existing.map((l) => [l.storageRef, l]));
    const seen = new Set<string>();

    let added = 0;
    let restored = 0;

    for (const entry of videos) {
      seen.add(entry.storageRef);
      const already = byRef.get(entry.storageRef);

      if (already) {
        // It came back. ARC-045 — a lecture marked MISSING whose file returns
        // becomes playable again without anybody re-uploading anything.
        if (already.availabilityStatus !== "AVAILABLE") {
          await this.prisma.asSystem((db) =>
            db.recordedLecture.update({
              where: { id: already.id },
              data: { availabilityStatus: "AVAILABLE" },
            }),
          );
          restored++;
        }
        continue;
      }

      await this.prisma.asSystem((db) =>
        db.recordedLecture.create({
          data: {
            sectionSubjectId,
            title: this.titleFrom(entry.name),
            storageRef: entry.storageRef,
            storageProvider: provider.key,
            // Null rather than 0 when the provider cannot tell us: local
            // storage does no media probing, and "0 seconds" printed on a card
            // is a wrong fact where "—" is an honest absence.
            durationSeconds: entry.durationSeconds,
            recordedOn: entry.modifiedAt ?? new Date(),
            // DRAFT, always. A file in a folder is not a decision to show it.
            publicationStatus: "DRAFT",
            availabilityStatus: "AVAILABLE",
          },
        }),
      );
      added++;
    }

    // Gone from the folder: marked, never deleted. The watch history hanging
    // off a lecture is a student's record of their own work.
    const vanished = existing.filter(
      (l) => !seen.has(l.storageRef) && l.availabilityStatus === "AVAILABLE",
    );
    if (vanished.length > 0) {
      await this.prisma.asSystem((db) =>
        db.recordedLecture.updateMany({
          where: { id: { in: vanished.map((l) => l.id) } },
          data: { availabilityStatus: "MISSING" },
        }),
      );
    }

    if (added > 0 || restored > 0 || vanished.length > 0) {
      await this.audit.record({
        action: "lecture.sync",
        entityType: "SectionSubject",
        entityId: sectionSubjectId,
        after: { added, restored, missing: vanished.length, scanned: videos.length },
      });
    }

    return {
      added,
      restored,
      missing: vanished.length,
      scanned: videos.length,
      folderRef: offering.lectureFolderRef,
    };
  }

  /**
   * A filename made readable.
   *
   * "2026-03-14_lecture-04_typography-basics.mp4" becomes "Typography basics".
   * Teachers name files for sorting, not for reading, and a card titled with
   * the raw filename looks like the System did not finish. Whatever this
   * produces is a STARTING point — the title is editable afterwards and the
   * sync never touches it again.
   */
  private titleFrom(filename: string): string {
    const withoutExtension = filename.replace(/\.[^.]+$/, "");
    const cleaned = withoutExtension
      // Leading dates and lecture numbers: how the file sorts, not what it is.
      .replace(/^\d{4}[-_]\d{2}[-_]\d{2}[-_\s]*/, "")
      .replace(/^(lecture|lec|class|session)[-_\s]*\d+[-_\s]*/i, "")
      .replace(/[-_]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (cleaned === "") return withoutExtension;
    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }

  /** Exposed for the tests, which is where the filename rules are pinned. */
  static readonly __testing = { VIDEO: LectureSyncService.VIDEO };
}
