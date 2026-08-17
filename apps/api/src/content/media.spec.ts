import { parseRange } from "./media.controller";

/**
 * Byte ranges — ARC-042, and the reason seeking works at all.
 *
 * Without 206 responses a browser can only play a video from the beginning:
 * dragging the scrubber on an hour-long class does nothing, and a recording
 * whose MP4 index sits at the end of the file — which is most of them, straight
 * out of a camera or a meeting — may not start playing at all, because the
 * player's first act is to ask for the last few hundred bytes.
 */
describe("Range requests", () => {
  const SIZE = 1000;

  it("is absent when the player did not ask", () => {
    expect(parseRange(undefined, SIZE)).toBeNull();
  });

  it("reads an open-ended range, which is what a player opens with", () => {
    expect(parseRange("bytes=0-", SIZE)).toEqual({ start: 0, end: 999 });
  });

  it("reads a closed range", () => {
    expect(parseRange("bytes=200-499", SIZE)).toEqual({ start: 200, end: 499 });
  });

  it("reads a SUFFIX range — the last N bytes", () => {
    // "bytes=-500". Players ask for this to read the moov atom of an MP4 that
    // keeps it at the end. Treating the leading empty group as a start of 0
    // would serve the first 500 bytes instead, and the video would never load.
    expect(parseRange("bytes=-500", SIZE)).toEqual({ start: 500, end: 999 });
  });

  it("clamps an end past the file rather than refusing", () => {
    // A player asking for more than there is wants what is there. Answering
    // 416 would stop playback on the last chunk of every single file.
    expect(parseRange("bytes=900-5000", SIZE)).toEqual({ start: 900, end: 999 });
  });

  it("refuses a start past the end of the file", () => {
    expect(parseRange("bytes=2000-", SIZE)).toBe("unsatisfiable");
  });

  it("refuses a backwards range", () => {
    expect(parseRange("bytes=500-100", SIZE)).toBe("unsatisfiable");
  });

  it("refuses a suffix of nothing", () => {
    expect(parseRange("bytes=-0", SIZE)).toBe("unsatisfiable");
  });

  it("ignores a header it does not understand rather than failing the request", () => {
    // Multipart ranges are legal and no browser asks for one to play video.
    // Serving the whole file is right; refusing would break a player that
    // sends something unusual.
    for (const header of ["bytes=0-99,200-299", "items=0-10", "bytes=abc-def", "bytes=-"]) {
      expect(parseRange(header, SIZE)).toBeNull();
    }
  });

  it("handles the whole file being one byte", () => {
    expect(parseRange("bytes=0-", 1)).toEqual({ start: 0, end: 0 });
  });
});
