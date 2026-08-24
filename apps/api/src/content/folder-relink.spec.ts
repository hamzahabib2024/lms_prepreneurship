import { ContentService } from "./content.service";
import type { ConfigService } from "@nestjs/config";

/**
 * RE-POINTING A CLASS AT A DIFFERENT DRIVE FOLDER.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IT USED TO DO: change one column. The recordings catalogued from the
 * OLD folder stayed exactly where they were, and the hourly sweep then marked
 * them MISSING one at a time as it noticed each was no longer in the folder it
 * was now looking at. To anybody watching, the Institute was losing files.
 * Meanwhile nothing from the NEW folder appeared until the next sweep, up to an
 * hour later — so the administrator pointed at the right folder, saw an empty
 * class, and concluded the folder was wrong.
 *
 * THE THREE RULES THAT MATTER, and each is a way to lose somebody's work:
 *
 *   NOTHING IS DESTROYED. The old recordings are soft-deleted. A student's
 *   watch progress hangs off those rows and is their record of their own work;
 *   it is not ours to erase because an administrator corrected a folder.
 *
 *   NOTHING HAPPENS WHEN NOTHING CHANGED. Saving the same folder again is a
 *   common accident, and it must not sweep the catalogue aside and rebuild it.
 *
 *   THE NEW FOLDER IS PROVED READABLE FIRST. Otherwise a mistyped or unshared
 *   folder leaves the class with its old recordings already put aside and
 *   nothing to replace them.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Built against fakes rather than a database, because what is being pinned is
 * the ORDER OF OPERATIONS — and the order is the whole of the correctness.
 */

interface Harness {
  service: ContentService;
  /** Every recordedLecture.updateMany the service performed. */
  softDeletes: Array<Record<string, unknown>>;
  syncedFor: string[];
  listedFolders: Array<string | null>;
  savedRef: string | null | undefined;
}

function harness(options: {
  currentRef: string | null;
  listFails?: boolean;
}): Harness {
  const softDeletes: Array<Record<string, unknown>> = [];
  const syncedFor: string[] = [];
  const listedFolders: Array<string | null> = [];
  let savedRef: string | null | undefined;

  const offering = { id: "ss-1", lectureFolderRef: options.currentRef };

  const prisma = {
    scoped: {
      sectionSubject: {
        findFirst: () => Promise.resolve(offering),
        update: ({ data }: { data: { lectureFolderRef: string | null } }) => {
          savedRef = data.lectureFolderRef;
          return Promise.resolve({ id: "ss-1", lectureFolderRef: data.lectureFolderRef });
        },
      },
    },
    asSystem: <T>(fn: (db: unknown) => Promise<T> | T) =>
      Promise.resolve(
        fn({
          recordedLecture: {
            updateMany: ({ where, data }: { where: unknown; data: unknown }) => {
              softDeletes.push({ where, data });
              return Promise.resolve({ count: 3 });
            },
          },
        }),
      ),
  };

  const storage = {
    forLectures: () => ({
      key: "google_drive",
      listFolder: (ref: string | null) => {
        listedFolders.push(ref);
        if (options.listFails) return Promise.reject(new Error("folder not shared"));
        return Promise.resolve([]);
      },
    }),
  };

  const lectureSync = {
    sync: (id: string) => {
      syncedFor.push(id);
      return Promise.resolve({
        added: 2,
        restored: 1,
        missing: 0,
        scanned: 3,
        blocked: 0,
        folderRef: "new-folder",
      });
    },
  };

  const service = new ContentService(
    prisma as never,
    { record: () => Promise.resolve(undefined) } as never,
    storage as never,
    { get: (_k: string, d?: string) => d } as unknown as ConfigService,
    lectureSync as never,
  );

  return {
    service,
    softDeletes,
    syncedFor,
    listedFolders,
    get savedRef() {
      return savedRef;
    },
  } as Harness;
}

describe("changing the folder a class is connected to", () => {
  it("puts the old recordings aside and imports the new folder", async () => {
    const h = harness({ currentRef: "old-folder" });
    const result = (await h.service.setLectureFolder("ss-1", "new-folder")) as Record<string, unknown>;

    expect(h.savedRef).toBe("new-folder");
    expect(h.softDeletes).toHaveLength(1);
    expect(h.syncedFor).toEqual(["ss-1"]);
    expect(result["cleared"]).toBe(3);
    expect(result["imported"]).toMatchObject({ added: 2, restored: 1 });
  });

  it("soft-deletes rather than destroying — watch history outlives the change", async () => {
    const h = harness({ currentRef: "old-folder" });
    await h.service.setLectureFolder("ss-1", "new-folder");

    const [call] = h.softDeletes;
    // A `deletedAt`, not a delete. If this ever becomes a real deletion, every
    // student's watch progress for that class goes with it.
    expect((call!["data"] as Record<string, unknown>)["deletedAt"]).toBeInstanceOf(Date);
    expect((call!["where"] as Record<string, unknown>)["sectionSubjectId"]).toBe("ss-1");
    expect((call!["where"] as Record<string, unknown>)["deletedAt"]).toBeNull();
  });

  it("reads the new folder BEFORE touching the old catalogue", async () => {
    const h = harness({ currentRef: "old-folder", listFails: true });

    await expect(h.service.setLectureFolder("ss-1", "unshared-folder")).rejects.toThrow();

    // The whole point of the ordering: a folder that cannot be read must
    // change nothing at all, rather than leaving the class emptied.
    expect(h.softDeletes).toHaveLength(0);
    expect(h.savedRef).toBeUndefined();
    expect(h.syncedFor).toEqual([]);
  });

  it("does nothing at all when the folder has not changed", async () => {
    const h = harness({ currentRef: "same-folder" });
    const result = (await h.service.setLectureFolder("ss-1", "same-folder")) as Record<string, unknown>;

    expect(h.softDeletes).toHaveLength(0);
    expect(h.syncedFor).toEqual([]);
    expect(result["cleared"]).toBe(0);
    expect(result["imported"]).toBeNull();
  });

  it("treats whitespace around the same reference as no change", async () => {
    // The form submits what was typed. Trimming happens before comparison, or
    // a stray space would sweep the catalogue aside and rebuild it.
    const h = harness({ currentRef: "same-folder" });
    await h.service.setLectureFolder("ss-1", "  same-folder  ");
    expect(h.softDeletes).toHaveLength(0);
  });

  it("clearing the folder puts the recordings aside and imports nothing", async () => {
    const h = harness({ currentRef: "old-folder" });
    const result = (await h.service.setLectureFolder("ss-1", "")) as Record<string, unknown>;

    expect(h.savedRef).toBeNull();
    expect(h.softDeletes).toHaveLength(1);
    // Nothing to list and nothing to sync — there is no new folder.
    expect(h.listedFolders).toEqual([]);
    expect(h.syncedFor).toEqual([]);
    expect(result["imported"]).toBeNull();
  });

  it("connecting a folder for the first time imports without clearing anything real", async () => {
    const h = harness({ currentRef: null });
    const result = (await h.service.setLectureFolder("ss-1", "first-folder")) as Record<string, unknown>;

    expect(h.savedRef).toBe("first-folder");
    expect(h.syncedFor).toEqual(["ss-1"]);
    expect(result["imported"]).toMatchObject({ added: 2 });
  });

  it("reports an import failure without undoing the connection", async () => {
    // The folder listed fine a moment ago, so the connection is right; if the
    // import then fails, throwing would tell the administrator their correct
    // change did not save. The hourly sweep picks it up regardless.
    const h = harness({ currentRef: "old-folder" });
    (h.service as unknown as { lectureSync: { sync: () => Promise<never> } }).lectureSync = {
      sync: () => Promise.reject(new Error("Drive timed out")),
    };

    const result = (await h.service.setLectureFolder("ss-1", "new-folder")) as Record<string, unknown>;

    expect(h.savedRef).toBe("new-folder");
    expect(result["importError"]).toContain("Drive timed out");
  });
});
