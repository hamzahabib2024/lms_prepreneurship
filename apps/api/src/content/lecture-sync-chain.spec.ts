import { LectureSyncService } from "./lecture-sync.service";
import type { FolderEntry } from "./storage/storage.provider";

/**
 * THE WHOLE CHAIN, on the Institute's real folder.
 *
 * Everything from "what Drive returned" to "what rows were written", with only
 * the network and the database replaced. The parts either side of this are
 * tested on their own — google-drive.spec.ts proves the listing is read
 * correctly, meet-recording.spec.ts proves the names are read correctly — and
 * this is the test that proves they are JOINED correctly, which is where the
 * bug was.
 *
 * The bug: the filter asked whether the name ended in `.mp4`. Both neighbours
 * passed their own tests throughout, and the sweep still catalogued nothing.
 * A seam, again.
 *
 * The listing below is one of the Institute's Graphic & UI/UX folders, verbatim
 * — including the transcript and chat log Meet writes beside each recording,
 * which must NOT become lectures.
 */

/** Exactly what the Drive adapter returns for that folder. */
const DRIVE_FOLDER: FolderEntry[] = [
  {
    storageRef: "1Nkr4Vh",
    name: "(Sec D) Graphic & UI/UX Class - 2026/08/13 20:58 PKT - Recording",
    isFolder: false,
    sizeBytes: 133669985,
    durationSeconds: 4331,
    modifiedAt: new Date("2026-08-13T17:08:11.384Z"),
    contentType: "video/mp4",
  },
  {
    storageRef: "1y2QRJm",
    name: "(Sec D) Graphic & UI/UX Class - 2026/08/07 20:41 PKT - Recording",
    isFolder: false,
    sizeBytes: 151042569,
    durationSeconds: null,
    modifiedAt: new Date("2026-08-07T16:53:44.795Z"),
    contentType: "video/mp4",
  },
  {
    storageRef: "1FVqtV4",
    name: "Sec D - UI UX CLASS - 2026-06-16- recording",
    isFolder: false,
    sizeBytes: 117363895,
    durationSeconds: null,
    // Renamed later — the timestamp is the day somebody tidied the folder.
    modifiedAt: new Date("2026-06-16T18:08:28.073Z"),
    contentType: "video/mp4",
  },
  // Meet writes these beside every recording. They are not lectures.
  {
    storageRef: "1transcript",
    name: "(Sec D) Graphic & UI/UX Class - 2026/08/13 20:58 PKT - Transcript",
    isFolder: false,
    sizeBytes: 18400,
    durationSeconds: null,
    modifiedAt: new Date("2026-08-13T17:08:12Z"),
    contentType: "application/vnd.google-apps.document",
  },
  {
    storageRef: "1chat",
    name: "Chat",
    isFolder: false,
    sizeBytes: 812,
    durationSeconds: null,
    modifiedAt: new Date("2026-08-13T17:08:12Z"),
    contentType: "text/plain",
  },
];

const OFFERING_ID = "018f2b04-0000-7000-8000-000000000000";

/** The rows the service tried to create, and the queries it made. */
function harness(folder: FolderEntry[], existing: Array<{ id: string; storageRef: string }> = []) {
  const created: Array<Record<string, unknown>> = [];
  const updated: Array<Record<string, unknown>> = [];

  const db = {
    recordedLecture: {
      findMany: () =>
        Promise.resolve(
          existing.map((e) => ({ ...e, availabilityStatus: "AVAILABLE" as const })),
        ),
      create: ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return Promise.resolve({ id: `new-${created.length}` });
      },
      update: ({ data }: { data: Record<string, unknown> }) => {
        updated.push(data);
        return Promise.resolve({});
      },
      updateMany: ({ data }: { data: Record<string, unknown> }) => {
        updated.push(data);
        return Promise.resolve({ count: 1 });
      },
    },
  };

  const service = new LectureSyncService(
    {
      asSystem: <T>(fn: (client: typeof db) => Promise<T> | T) => Promise.resolve(fn(db)),
      scoped: {
        sectionSubject: {
          findFirst: () =>
            Promise.resolve({
              id: OFFERING_ID,
              lectureFolderRef: "1Yhkvn_G0bSrIVm70xnWrzqcyG6hooKWt",
              subjectId: "subject-1",
            }),
        },
      },
    } as never,
    { record: () => Promise.resolve(undefined) } as never,
    {
      forLectures: () => ({ key: "google_drive", listFolder: () => Promise.resolve(folder) }),
    } as never,
  );

  return { service, created, updated };
}

describe("syncing the Institute's own Drive folder", () => {
  it("catalogues every recording and nothing else", async () => {
    const { service, created } = harness(DRIVE_FOLDER);

    const result = await service.sync(OFFERING_ID);

    // THE ASSERTION THE OLD CODE FAILED. Three recordings, none of which has a
    // file extension; before the fix this was zero, and the sweep reported
    // success.
    expect(result.added).toBe(3);
    expect(result.scanned).toBe(3);
    expect(created).toHaveLength(3);

    // The transcript and the chat log stayed out.
    const refs = created.map((c) => c["storageRef"]);
    expect(refs).toEqual(["1Nkr4Vh", "1y2QRJm", "1FVqtV4"]);
  });

  it("titles them by the class, not by the filename", async () => {
    const { service, created } = harness(DRIVE_FOLDER);
    await service.sync(OFFERING_ID);

    expect(created.map((c) => c["title"])).toEqual([
      "Graphic & UI/UX",
      "Graphic & UI/UX",
      "UI UX",
    ]);
  });

  it("dates them by the day of the CLASS, from the name", async () => {
    const { service, created } = harness(DRIVE_FOLDER);
    await service.sync(OFFERING_ID);

    const dates = created.map((c) => (c["recordedOn"] as Date).toISOString().slice(0, 10));
    expect(dates).toEqual(["2026-08-13", "2026-08-07", "2026-06-16"]);
  });

  it("keeps the duration Drive reported, and stays silent about the ones it did not", async () => {
    const { service, created } = harness(DRIVE_FOLDER);
    await service.sync(OFFERING_ID);

    expect(created[0]!["durationSeconds"]).toBe(4331);
    // Null, not 0. "0:00" printed on a card is a wrong fact where a dash is an
    // honest unknown.
    expect(created[1]!["durationSeconds"]).toBeNull();
  });

  it("brings them in as DRAFTS, always", async () => {
    // BR-CNT-01. A file appearing in a folder is not a decision to show it to
    // a class, and the hourly sweep runs at four in the morning.
    const { service, created } = harness(DRIVE_FOLDER);
    await service.sync(OFFERING_ID);

    for (const row of created) expect(row["publicationStatus"]).toBe("DRAFT");
  });

  it("does not create a second row for one already catalogued", async () => {
    const { service, created } = harness(DRIVE_FOLDER, [
      { id: "existing-1", storageRef: "1Nkr4Vh" },
    ]);

    const result = await service.sync(OFFERING_ID);

    expect(result.added).toBe(2);
    expect(created.map((c) => c["storageRef"])).not.toContain("1Nkr4Vh");
  });

  it("marks a vanished recording MISSING rather than deleting it", async () => {
    // ARC-045. The watch history hanging off a lecture is a student's record of
    // their own work, and it must survive somebody tidying Drive.
    const { service, updated } = harness(DRIVE_FOLDER, [
      { id: "gone-1", storageRef: "1DeletedFromDrive" },
    ]);

    const result = await service.sync(OFFERING_ID);

    expect(result.missing).toBe(1);
    expect(updated).toContainEqual({ availabilityStatus: "MISSING" });
  });

  it("catalogues nothing at all when the folder holds no video", async () => {
    // The honest empty case, so the assertion above means something.
    const { service, created } = harness(DRIVE_FOLDER.slice(3));
    const result = await service.sync(OFFERING_ID);
    expect(result.added).toBe(0);
    expect(created).toHaveLength(0);
  });
});
