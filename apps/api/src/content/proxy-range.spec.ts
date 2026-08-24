import { parseRangeHeader } from "./content.controller";

/**
 * THE RANGE A PROXIED PROVIDER IS ASKED FOR — and the one that was thrown away.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS IS THE DEFECT BEHIND "THE VIDEOS DO NOT PLAY".
 *
 * An MP4 keeps its index — the `moov` atom — at the END of the file unless
 * somebody has deliberately moved it to the front. Every recording Google Meet
 * produces is of that kind. So a browser opening one asks for the TAIL first,
 * with `Range: bytes=-2048`, to read the index before fetching any video.
 *
 * `parseRangeHeader` returned `undefined` for that shape. Undefined means "no
 * range", so the request became a plain 200 carrying the whole file: the player
 * asked for two kilobytes and was handed 247 MB. It then has to download an
 * entire lecture before it can discover how to play the first second of it,
 * which presents as a video that spins forever.
 *
 * The comment above the line claimed the suffix was "handed on as written". It
 * was not, and the gap between the comment and the code is why this went
 * unnoticed: reading the function told you it worked.
 *
 * MEASURED, NOT ASSUMED. Against the Institute's own 247 MB recording,
 * `bytes=-2048` answered `200` and began streaming the whole file; it now
 * answers `206` with `Content-Range: bytes 247235381-247237428/247237429`.
 *
 * media.controller.ts has always handled this correctly for local storage —
 * its own `parseRange` has a comment explaining exactly this case. Only the
 * PROXIED path, which is the one Google Drive uses, dropped it. So every
 * Drive-hosted lecture was affected and every locally-hosted one was fine,
 * which is the worst possible split for noticing it.
 * ─────────────────────────────────────────────────────────────────────────────
 */
describe("the range a proxied provider is asked for", () => {
  it("keeps a suffix range instead of discarding it", () => {
    // The regression. `undefined` here is what caused a 200 and a whole file.
    expect(parseRangeHeader("bytes=-2048")).toEqual({ suffix: 2048 });
  });

  it("reads an ordinary offset range", () => {
    expect(parseRangeHeader("bytes=0-1023")).toEqual({ start: 0, end: 1023 });
  });

  it("reads an open-ended range", () => {
    // What a player sends to stream on from a seek point.
    expect(parseRangeHeader("bytes=1000-")).toEqual({ start: 1000 });
  });

  it("treats a nonsensical suffix as no range at all", () => {
    // `bytes=-0` asks for nothing. Passing it on would have Drive answer 416
    // and the player treat a playable file as broken; no range is the honest
    // reading, and the whole file is a valid answer to it.
    expect(parseRangeHeader("bytes=-0")).toBeUndefined();
    expect(parseRangeHeader("bytes=-abc")).toBeUndefined();
  });

  it("ignores headers it does not understand", () => {
    expect(parseRangeHeader(undefined)).toBeUndefined();
    expect(parseRangeHeader("")).toBeUndefined();
    expect(parseRangeHeader("items=0-10")).toBeUndefined();
    // Multipart ranges are legal and no browser asks for one to play video.
    expect(parseRangeHeader("bytes=0-99,200-299")).toBeUndefined();
  });

  it("never returns both a start and a suffix", () => {
    // The two forms are mutually exclusive, and a provider building a header
    // from both would produce something Drive rejects outright.
    for (const header of ["bytes=-500", "bytes=0-", "bytes=5-10"]) {
      const r = parseRangeHeader(header);
      expect(r).toBeDefined();
      const hasStart = r!.start !== undefined;
      const hasSuffix = r!.suffix !== undefined;
      expect(hasStart && hasSuffix).toBe(false);
      expect(hasStart || hasSuffix).toBe(true);
    }
  });
});
