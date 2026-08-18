import { parseMeetRecording, titleFromFilename } from "./meet-recording";

/**
 * EVERY NAME IN THIS FILE IS REAL.
 *
 * They were read out of the Institute's own Google Drive folders — the same
 * recordings students will be watching — rather than invented from what Meet's
 * documentation says it produces. The awkward ones are the point: the double
 * space, the missing time, the dash-formatted date, the organiser's notes to
 * themselves. Fixtures written from the documentation would have all been the
 * first shape, and three of the five parsers below would be wrong.
 */
describe("reading a Google Meet recording's name", () => {
  describe("the Institute's actual recordings", () => {
    it.each([
      [
        "(Sec D) Graphic & UI/UX Class - 2026/08/13 20:58 PKT - Recording",
        { title: "Graphic & UI/UX", date: "2026-08-13", time: "20:58", section: "Sec D" },
      ],
      [
        "(Sec I) English Class - 2026/08/13 20:28 PKT - Recording",
        { title: "English", date: "2026-08-13", time: "20:28", section: "Sec I" },
      ],
      [
        "Sec-H Graphic Class - 2026/08/13 10:29 PKT - Recording",
        { title: "Graphic", date: "2026-08-13", time: "10:29", section: "Sec H" },
      ],
      [
        "Kids Summer Camp Tech Class - 2026/08/10 16:16 PKT - Recording",
        { title: "Kids Summer Camp Tech", date: "2026-08-10", time: "16:16", section: null },
      ],
      [
        "Master Class - 2026/08/09 21:53 PKT - Recording",
        { title: "Master", date: "2026-08-09", time: "21:53", section: null },
      ],
    ])("%s", (name, expected) => {
      const parsed = parseMeetRecording(name);
      expect(parsed.title).toBe(expected.title);
      expect(parsed.recordedOn?.toISOString().slice(0, 10)).toBe(expected.date);
      expect(parsed.localTime).toBe(expected.time);
      expect(parsed.sectionHint).toBe(expected.section);
      expect(parsed.isMeetRecording).toBe(true);
    });
  });

  describe("the awkward ones, which are also real", () => {
    it("handles a note the organiser wrote to themselves", () => {
      // "Recorded for (Sec D) Tech Class" — they recorded section I's class
      // for section D. The subject is Tech; everything else is a memo.
      const parsed = parseMeetRecording(
        "Recorded for (Sec D) Tech Class - 2026/08/13 10:13 PKT - Recording",
      );
      expect(parsed.title).toBe("Tech");
      expect(parsed.recordedOn?.toISOString().slice(0, 10)).toBe("2026-08-13");
    });

    it("handles the same note written as a bracket", () => {
      const parsed = parseMeetRecording(
        "(For Sec D Recording) Tech Class - 2026/08/11 10:13 PKT - Recording",
      );
      expect(parsed.title).toBe("Tech");
      expect(parsed.recordedOn?.toISOString().slice(0, 10)).toBe("2026-08-11");
    });

    it("handles a date with no time after it", () => {
      const parsed = parseMeetRecording("(Sec D) Graphic & UI/UX Class - 2026/06/18 - Recording");
      expect(parsed.title).toBe("Graphic & UI/UX");
      expect(parsed.recordedOn?.toISOString().slice(0, 10)).toBe("2026-06-18");
      expect(parsed.localTime).toBeNull();
    });

    it("handles the double space where the time should have been", () => {
      const parsed = parseMeetRecording("(Sec D) Graphic & UI/UX Class - 2026/06/19  - Recording");
      expect(parsed.title).toBe("Graphic & UI/UX");
      expect(parsed.recordedOn?.toISOString().slice(0, 10)).toBe("2026-06-19");
    });

    it.each([
      "Sec D - UI UX CLASS - 2026-06-16- recording",
      "Sec D - UI UX CLASS - 2026-06-15 - recording",
    ])("handles a hand-typed name with dashes and lower case: %s", (name) => {
      const parsed = parseMeetRecording(name);
      expect(parsed.title).toBe("UI UX");
      expect(parsed.recordedOn).not.toBeNull();
      expect(parsed.sectionHint).toBe("Sec D");
      expect(parsed.isMeetRecording).toBe(true);
    });
  });

  describe("the date is the CLASS's date, not the upload's", () => {
    it("takes the day from the name", () => {
      // Meet finished writing this at 17:08 UTC on the 13th, which is 22:08 in
      // Pakistan — the class itself started at 20:58. Same day here, but the
      // 21:53 class below is the one that proves why the name is read at all.
      const parsed = parseMeetRecording(
        "(Sec D) Graphic & UI/UX Class - 2026/08/13 20:58 PKT - Recording",
      );
      expect(parsed.recordedOn?.toISOString().slice(0, 10)).toBe("2026-08-13");
    });

    it("is stable across timezones", () => {
      // Stored at midday UTC on purpose. At midnight, this date renders as the
      // 9th in Karachi and the 8th in New York, and two people reading the
      // same course page would disagree about when the class was.
      const parsed = parseMeetRecording("Master Class - 2026/08/09 21:53 PKT - Recording");
      expect(parsed.recordedOn?.getUTCHours()).toBe(12);
      const inKarachi = parsed.recordedOn!.toLocaleDateString("en-CA", {
        timeZone: "Asia/Karachi",
      });
      const inNewYork = parsed.recordedOn!.toLocaleDateString("en-CA", {
        timeZone: "America/New_York",
      });
      expect(inKarachi).toBe("2026-08-09");
      expect(inNewYork).toBe("2026-08-09");
    });
  });

  describe("what it refuses to treat as a Meet recording", () => {
    it("a phone video from the same Drive", () => {
      // Also real, and in the same account. It must not be dated 2025-05-18
      // from its filename and dressed up as a class.
      const parsed = parseMeetRecording("VID_20250518_180224.mp4");
      expect(parsed.isMeetRecording).toBe(false);
      expect(parsed.recordedOn).toBeNull();
    });

    it("a file somebody simply called Recording", () => {
      const parsed = parseMeetRecording("Recording");
      expect(parsed.isMeetRecording).toBe(false);
    });

    it("a name whose date is impossible", () => {
      const parsed = parseMeetRecording("Tech Class - 2026/13/40 10:13 PKT - Recording");
      expect(parsed.recordedOn).toBeNull();
      expect(parsed.isMeetRecording).toBe(false);
    });

    it("handles the number Meet appends to a second recording of one class", () => {
      // Real, from the Institute's English folder: one session recorded twice.
      // Without this the whole name survives as the title, and the card reads
      // "(Sec D) English Class 2026/07/03 19:46 PKT Recording 2" beside eleven
      // that read "English".
      const parsed = parseMeetRecording(
        "(Sec D) English Class - 2026/07/03 19:46 PKT - Recording 2",
      );
      expect(parsed.title).toBe("English");
      expect(parsed.recordedOn?.toISOString().slice(0, 10)).toBe("2026-07-03");
      expect(parsed.isMeetRecording).toBe(true);
    });

    it("never produces an empty title", () => {
      // A card headed by nothing is worse than one headed by the raw name.
      for (const name of ["Class - 2026/08/13 10:00 PKT - Recording", "(Sec D) Class", "- -"]) {
        expect(parseMeetRecording(name).title.length).toBeGreaterThan(0);
      }
    });
  });

  describe("ordinary filenames still read the way they did", () => {
    it.each([
      ["2026-03-14_lecture-04_typography-basics.mp4", "Typography basics"],
      ["lecture-02-grid-systems.mp4", "Grid systems"],
      ["colour_theory.mp4", "Colour theory"],
    ])("%s → %s", (file, expected) => {
      expect(titleFromFilename(file)).toBe(expected);
    });

    it("uses the Meet reading when the name is one", () => {
      expect(titleFromFilename("(Sec I) English Class - 2026/08/13 20:28 PKT - Recording")).toBe(
        "English",
      );
    });

    it("keeps a name it cannot improve", () => {
      expect(titleFromFilename("VID_20250518_180224.mp4")).toBe("VID 20250518 180224");
    });

    /**
     * The Institute's OTHER naming pattern, found the day Drive was connected.
     *
     * Their recorder writes "2026-07-28 11-05 - (Sec D) Digital Marketing.mp4"
     * — a date AND a time, where the Meet folders carry neither. The date was
     * stripped and the time was not, so every card in that class read
     * "11 05 (Sec D) Digital Marketing": perfectly sortable and meaningless.
     *
     * Written from the real folder rather than guessed, again, and it is the
     * second time a naming pattern nobody would have invented turned up in
     * data that was there all along.
     */
    it.each([
      ["2026-07-28 11-05 - (Sec D) Digital Marketing.mp4", "(Sec D) Digital Marketing"],
      ["2026-07-27 11-05 - (Sec D) Digital Marketing.mp4", "(Sec D) Digital Marketing"],
      ["2026-08-02 09-30-15 - Web Development.mp4", "Web Development"],
    ])("%s → %s", (file, expected) => {
      expect(titleFromFilename(file)).toBe(expected);
    });

    it("does not eat a time-like number that is part of the title", () => {
      // Only a LEADING time is a timestamp. "10-05 Revision" at the start is
      // ambiguous and treated as one; a number inside the title is not.
      expect(titleFromFilename("Sprint 10-05 planning.mp4")).toBe("Sprint 10 05 planning");
    });
  });
});
