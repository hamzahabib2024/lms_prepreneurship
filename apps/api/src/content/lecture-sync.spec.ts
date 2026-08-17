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

describe("which files become lectures", () => {
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
