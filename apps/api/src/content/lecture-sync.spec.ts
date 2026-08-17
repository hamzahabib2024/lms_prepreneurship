import { LectureSyncService } from "./lecture-sync.service";

/**
 * The filename rules and the file filter — the two parts of the sync that
 * decide what a student ends up looking at, and the two that can be pinned
 * without a database.
 */

/** The private title cleaner, reached the way the sync reaches it. */
const titleOf = (filename: string) =>
  (
    Object.create(LectureSyncService.prototype) as unknown as {
      titleFrom: (f: string) => string;
    }
  ).titleFrom.call(Object.create(LectureSyncService.prototype), filename);

const VIDEO = LectureSyncService.__testing.VIDEO;

/** The private filter, reached the way the sync reaches it. */
const isVideo = (entry: { name: string; contentType: string | null }) =>
  (
    Object.create(LectureSyncService.prototype) as unknown as {
      isVideo: (e: { name: string; contentType: string | null }) => boolean;
    }
  ).isVideo.call(Object.create(LectureSyncService.prototype), entry);

describe("which files become lectures", () => {
  /**
   * THE BUG THIS SUITE MISSED, and why the filter no longer reads a name.
   *
   * These are the Institute's real recordings. Every one of them is
   * `video/mp4` in Drive and every one has NO EXTENSION, so the extension test
   * below — which passes, and is still correct about what it tests — answered
   * "not a video" for all eighteen recordings in a single class folder. The
   * sweep ran, reported nothing added, and the course page stayed empty.
   *
   * The old suite could not have caught it: it tested the regex against names
   * a teacher would type, and no fixture looked like what Meet actually
   * produces. That is the difference between testing the rule and testing the
   * data.
   */
  describe("Google Meet recordings, which have no extension at all", () => {
    it.each([
      "(Sec D) Graphic & UI/UX Class - 2026/08/13 20:58 PKT - Recording",
      "(Sec I) English Class - 2026/08/13 20:28 PKT - Recording",
      "Sec-H Graphic Class - 2026/08/13 10:29 PKT - Recording",
      "Sec D - UI UX CLASS - 2026-06-16- recording",
    ])("catalogues %s", (name) => {
      expect(isVideo({ name, contentType: "video/mp4" })).toBe(true);
      // And the proof that the old rule could not: the name alone says no.
      expect(VIDEO.test(name)).toBe(false);
    });
  });

  it("believes the content type over the name", () => {
    // A .txt that Drive reports as video is a renamed video; a .mp4 that Drive
    // reports as a PDF is a renamed PDF. The provider knows, the name guesses.
    expect(isVideo({ name: "notes.txt", contentType: "video/mp4" })).toBe(true);
    expect(isVideo({ name: "class.mp4", contentType: "application/pdf" })).toBe(false);
  });

  it("falls back to the extension when the provider cannot tell", () => {
    // Local disk has nothing but the name, and must keep working.
    for (const name of ["class.mp4", "class.MOV", "lecture.webm", "a.mkv", "b.avi", "c.m4v"]) {
      expect(isVideo({ name, contentType: null })).toBe(true);
    }
    for (const name of ["notes.pdf", "slides.pptx", "photo.jpg", "thumbs.db"]) {
      expect(isVideo({ name, contentType: null })).toBe(false);
    }
  });

  it("still ignores everything else in a Drive folder", () => {
    // A class folder holds the recording, a chat log, and the transcript Meet
    // writes beside it. Only the video is a lecture.
    expect(isVideo({ name: "Chat.txt", contentType: "text/plain" })).toBe(false);
    expect(
      isVideo({ name: "Transcript", contentType: "application/vnd.google-apps.document" }),
    ).toBe(false);
    expect(isVideo({ name: "notes.pdf", contentType: "application/pdf" })).toBe(false);
  });

  it("takes the video formats a teacher actually uploads", () => {
    for (const name of ["class.mp4", "class.MOV", "lecture.webm", "a.mkv", "b.avi", "c.m4v"]) {
      expect(VIDEO.test(name)).toBe(true);
    }
  });

  it("IGNORES everything else in the folder", () => {
    // A shared folder holds notes, slides, a stray screenshot and somebody's
    // CV. Cataloguing those as lectures would put them on the course page.
    for (const name of ["notes.pdf", "slides.pptx", "photo.jpg", "thumbs.db", "readme.txt"]) {
      expect(VIDEO.test(name)).toBe(false);
    }
  });

  it("is not fooled by an extension in the middle of a name", () => {
    expect(VIDEO.test("about.mp4.txt")).toBe(false);
  });
});

describe("turning a filename into a title", () => {
  it("drops the extension", () => {
    expect(titleOf("typography.mp4")).toBe("Typography");
  });

  it("drops a leading date, which is how the file sorts and not what it is", () => {
    expect(titleOf("2026-03-14_typography-basics.mp4")).toBe("Typography basics");
    expect(titleOf("2026_03_14 colour theory.mov")).toBe("Colour theory");
  });

  it("drops a leading lecture number", () => {
    expect(titleOf("lecture-04-grid-systems.mp4")).toBe("Grid systems");
    expect(titleOf("Class 2 - kerning.mp4")).toBe("Kerning");
    expect(titleOf("session_11_final_review.webm")).toBe("Final review");
  });

  it("drops both, in the order they arrive", () => {
    expect(titleOf("2026-03-14_lecture-04_typography-basics.mp4")).toBe("Typography basics");
  });

  it("turns separators into spaces and capitalises once", () => {
    // Not title case: "Grid Systems And The Baseline" reads like a headline
    // somebody typed by holding shift, and the teacher's own wording is
    // usually right.
    expect(titleOf("grid-systems-and-the-baseline.mp4")).toBe("Grid systems and the baseline");
  });

  it("leaves a name that is already readable alone", () => {
    expect(titleOf("Colour Theory.mp4")).toBe("Colour Theory");
  });

  it("NEVER returns an empty title", () => {
    // A card with no title is a card nobody can identify, and the cleaning
    // rules above can strip a name down to nothing: "2026-03-14.mp4" is a
    // date and nothing else.
    for (const name of ["2026-03-14.mp4", "lecture-04.mp4", "____.mp4", "-.mp4"]) {
      expect(titleOf(name).length).toBeGreaterThan(0);
    }
  });

  it("falls back to the filename rather than inventing one", () => {
    expect(titleOf("2026-03-14.mp4")).toBe("2026-03-14");
  });
});
