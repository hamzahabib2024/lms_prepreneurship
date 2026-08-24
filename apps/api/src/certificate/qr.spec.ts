import { encodeQr, formatBits, qrPath, qrSize, versionBits } from "@lms/shared";

/**
 * The QR encoder, checked by READING ITS OUTPUT BACK.
 *
 * A hand-copied reference matrix would test my typing rather than the encoder,
 * and every "known vector" I could quote from memory is exactly the kind of
 * thing that is subtly wrong and then enshrined by the test that quotes it. So
 * the main assertion here is a decoder: it walks the symbol the way a scanner
 * does — format bits, mask, zigzag, de-interleave, mode header — and recovers
 * the original string. If any stage of the encoder is wrong the text comes
 * back wrong or not at all.
 *
 * The two things a decoder CANNOT catch are anchored separately: the format
 * information is checked against the value the standard prints, and the
 * error-correction codewords are checked to be present and non-trivial.
 */

const EC_BLOCKS_M: Record<number, [number, number, number, number, number]> = {
  1: [10, 1, 16, 0, 0],
  2: [16, 1, 28, 0, 0],
  3: [26, 1, 44, 0, 0],
  4: [18, 2, 32, 0, 0],
  5: [24, 2, 43, 0, 0],
  6: [16, 4, 27, 0, 0],
  7: [18, 4, 31, 0, 0],
  8: [22, 2, 38, 2, 39],
  9: [22, 3, 36, 2, 37],
  10: [26, 4, 43, 1, 44],
};

/** Reverses everything encodeQr did, and returns the text. */
function decodeQr(matrix: boolean[][]): string {
  const size = matrix.length;
  const version = (size - 17) / 4;
  expect(Number.isInteger(version)).toBe(true);

  // --- which mask was used ---------------------------------------------
  // Read the first copy of the format information and find the mask whose
  // encoded form matches it. A scanner does the same thing by BCH correction.
  let read = 0;
  const bitAt = (row: number, col: number) => (matrix[row]![col]! ? 1 : 0);
  for (let i = 0; i <= 5; i++) read |= bitAt(i, 8) << i;
  read |= bitAt(7, 8) << 6;
  read |= bitAt(8, 8) << 7;
  read |= bitAt(8, 7) << 8;
  for (let i = 9; i < 15; i++) read |= bitAt(8, 14 - i) << i;

  let mask = -1;
  for (let m = 0; m < 8; m++) if (formatBits(m) === read) mask = m;
  expect(mask).toBeGreaterThanOrEqual(0);

  // --- which modules are function patterns ------------------------------
  // Rebuilt by encoding a throwaway string at the same version: the function
  // patterns are identical for every symbol of a version, and the data area is
  // where the two differ. Comparing against a symbol that carries the SAME
  // fixed layout is what makes this reliable.
  const fixed = functionMap(version, size);

  // --- unmask and read the zigzag ---------------------------------------
  const maskAt = (row: number, col: number): boolean => {
    switch (mask) {
      case 0:
        return (row + col) % 2 === 0;
      case 1:
        return row % 2 === 0;
      case 2:
        return col % 3 === 0;
      case 3:
        return (row + col) % 3 === 0;
      case 4:
        return (Math.floor(col / 3) + Math.floor(row / 2)) % 2 === 0;
      case 5:
        return ((row * col) % 2) + ((row * col) % 3) === 0;
      case 6:
        return (((row * col) % 2) + ((row * col) % 3)) % 2 === 0;
      default:
        return ((((row + col) % 2) + ((row * col) % 3)) % 2) === 0;
    }
  };

  const bits: number[] = [];
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let step = 0; step < size; step++) {
      for (let j = 0; j < 2; j++) {
        const col = right - j;
        const upward = ((right + 1) & 2) === 0;
        const row = upward ? size - 1 - step : step;
        if (fixed[row]![col]) continue;
        const dark = matrix[row]![col]! !== maskAt(row, col);
        bits.push(dark ? 1 : 0);
      }
    }
  }

  const stream: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j]!;
    stream.push(byte);
  }

  // --- de-interleave ----------------------------------------------------
  const [ecLen, g1Blocks, g1Data, g2Blocks, g2Data] = EC_BLOCKS_M[version]!;
  const sizes: number[] = [];
  for (let b = 0; b < g1Blocks; b++) sizes.push(g1Data);
  for (let b = 0; b < g2Blocks; b++) sizes.push(g2Data);

  const blocks: number[][] = sizes.map(() => []);
  let cursor = 0;
  const longest = Math.max(g1Data, g2Data);
  for (let i = 0; i < longest; i++) {
    for (let b = 0; b < sizes.length; b++) {
      if (i < sizes[b]!) blocks[b]!.push(stream[cursor++]!);
    }
  }

  // The error-correction half must be there and must not be all zeroes — the
  // one thing the round trip alone would not notice.
  const ecStart = cursor;
  const ecTotal = sizes.length * ecLen;
  expect(stream.length).toBeGreaterThanOrEqual(ecStart + ecTotal);
  expect(stream.slice(ecStart, ecStart + ecTotal).some((b) => b !== 0)).toBe(true);

  const data = blocks.flat();

  // --- the mode header --------------------------------------------------
  let bitIndex = 0;
  const take = (count: number): number => {
    let value = 0;
    for (let i = 0; i < count; i++) {
      const byte = data[bitIndex >>> 3]!;
      value = (value << 1) | ((byte >>> (7 - (bitIndex & 7))) & 1);
      bitIndex++;
    }
    return value;
  };

  expect(take(4)).toBe(0b0100); // byte mode
  const length = take(version < 10 ? 8 : 16);

  const bytes: number[] = [];
  for (let i = 0; i < length; i++) bytes.push(take(8));

  return Buffer.from(bytes).toString("utf8");
}

/** The function-pattern map for a version, derived the same way the encoder does. */
function functionMap(version: number, size: number): boolean[][] {
  const fixed = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const mark = (row: number, col: number) => {
    if (row >= 0 && col >= 0 && row < size && col < size) fixed[row]![col] = true;
  };

  for (let i = 0; i < size; i++) {
    mark(6, i);
    mark(i, 6);
  }
  for (const [r, c] of [
    [3, 3],
    [3, size - 4],
    [size - 4, 3],
  ] as const) {
    for (let dr = -4; dr <= 4; dr++) for (let dc = -4; dc <= 4; dc++) mark(r + dr, c + dc);
  }

  const centres: Record<number, number[]> = {
    1: [],
    2: [6, 18],
    3: [6, 22],
    4: [6, 26],
    5: [6, 30],
    6: [6, 34],
    7: [6, 22, 38],
    8: [6, 24, 42],
    9: [6, 26, 46],
    10: [6, 28, 50],
  };
  const list = centres[version]!;
  for (let i = 0; i < list.length; i++) {
    for (let j = 0; j < list.length; j++) {
      const onEye =
        (i === 0 && j === 0) ||
        (i === 0 && j === list.length - 1) ||
        (i === list.length - 1 && j === 0);
      if (onEye) continue;
      for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) mark(list[i]! + dr, list[j]! + dc);
    }
  }

  for (let i = 0; i <= 5; i++) mark(i, 8);
  mark(7, 8);
  mark(8, 8);
  mark(8, 7);
  for (let i = 9; i < 15; i++) mark(8, 14 - i);
  for (let i = 0; i < 8; i++) mark(8, size - 1 - i);
  for (let i = 8; i < 15; i++) mark(size - 15 + i, 8);
  mark(size - 8, 8);

  if (version >= 7) {
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      mark(b, a);
      mark(a, b);
    }
  }
  return fixed;
}

describe("the QR encoder", () => {
  it("round-trips a verification URL", () => {
    const url = "https://lms.prepreneurship.pk/verify/certificate/CERT-2026-000042";
    expect(decodeQr(encodeQr(url))).toBe(url);
  });

  it("round-trips at every version it grows through", () => {
    // One string per version band, so a mistake in the 16-bit length
    // indicator, the two-group block split, or the version information
    // pattern shows up rather than hiding behind a single short input.
    for (const length of [1, 14, 26, 60, 100, 150, 213]) {
      const text = "A".repeat(length);
      expect(decodeQr(encodeQr(text))).toBe(text);
    }
  });

  it("round-trips non-ASCII text", () => {
    const text = "Muḥammad — Prepreneurship ✓";
    expect(decodeQr(encodeQr(text))).toBe(text);
  });

  it("grows the symbol as the text grows, and never shrinks it", () => {
    let previous = 0;
    for (const length of [10, 40, 90, 160, 213]) {
      const size = qrSize(encodeQr("x".repeat(length)));
      expect(size).toBeGreaterThanOrEqual(previous);
      expect((size - 17) % 4).toBe(0);
      previous = size;
    }
  });

  it("refuses text it cannot hold rather than truncating it", () => {
    // A code holding half a URL scans perfectly and goes somewhere else, which
    // is worse than no code at all.
    expect(() => encodeQr("x".repeat(214))).toThrow(/213/);
  });

  it("encodes the format information the standard prints", () => {
    // Level M, mask 0 — the one value in the whole encoder that can be checked
    // against the specification without decoding anything.
    expect(formatBits(0).toString(2).padStart(15, "0")).toBe("101010000010010");
    // The five data bits survive the BCH and the 0x5412 mask.
    for (let mask = 0; mask < 8; mask++) {
      const bits = formatBits(mask) ^ 0x5412;
      expect(bits >>> 10).toBe(mask); // level M contributes 0 to the top two bits
    }
  });

  it("encodes version information with its own BCH", () => {
    // The top six bits are the version; the rest is the code word.
    for (let version = 7; version <= 10; version++) {
      expect(versionBits(version) >>> 12).toBe(version);
    }
  });

  it("draws the three finder patterns", () => {
    const m = encodeQr("https://example.test/verify/certificate/CERT-2026-000001");
    const size = m.length;
    for (const [row, col] of [
      [0, 0],
      [0, size - 7],
      [size - 7, 0],
    ] as const) {
      // The eye: dark ring, light ring, dark 3×3 core.
      expect(m[row]![col]).toBe(true);
      expect(m[row + 1]![col + 1]).toBe(false);
      expect(m[row + 3]![col + 3]).toBe(true);
    }
  });

  it("draws timing patterns that alternate", () => {
    const m = encodeQr("verify");
    for (let i = 8; i < m.length - 8; i++) {
      expect(m[6]![i]).toBe(i % 2 === 0);
      expect(m[i]![6]).toBe(i % 2 === 0);
    }
  });

  it("collapses runs into one subpath rather than one rect per module", () => {
    const path = qrPath(
      [
        [true, true, true, false],
        [false, true, false, true],
      ],
      4,
    );
    // Row 0 is one run of three, row 1 is two runs of one: three subpaths.
    expect(path.match(/M/g)).toHaveLength(3);
    expect(path.startsWith("M0 0h12v4h-12z")).toBe(true);
  });
});
