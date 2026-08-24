/**
 * A QR encoder — ISO/IEC 18004, byte mode, error correction level M.
 *
 * WRITTEN HERE RATHER THAN INSTALLED, for the same reason Icon.tsx draws its
 * own shapes and styles.css is plain CSS: a certificate is a printed legal-ish
 * document, and the code that puts a machine-readable link on it should be
 * something this repository can read, test and reason about. The alternative
 * was a transitive dependency in the path of every certificate ever issued.
 *
 * DELIBERATELY NARROW. Versions 1 to 10 at level M — up to 213 bytes, which is
 * three times the longest verification URL the System can produce — and one
 * error-correction level. Level M recovers 15% of a damaged symbol, which is
 * the level every printed URL code uses; L is too fragile for paper that gets
 * folded, and Q and H buy robustness nobody needs at the cost of a denser
 * symbol. Asking for more than 213 bytes throws rather than silently
 * truncating, because a QR code that encodes half a URL scans perfectly and
 * goes to the wrong place.
 *
 * The output is a matrix of booleans. Turning that into an SVG path, a canvas,
 * or anything else is the caller's business — see `qrPath`.
 */

/** Level-M block structure per version: [ecPerBlock, g1Blocks, g1Data, g2Blocks, g2Data]. */
const EC_BLOCKS_M: Readonly<Record<number, readonly [number, number, number, number, number]>> = {
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

/** Row/column centres of the alignment patterns, per version. */
const ALIGNMENT: Readonly<Record<number, readonly number[]>> = {
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

const MIN_VERSION = 1;
const MAX_VERSION = 10;

// ------------------------------------------------------------- GF(256) -----

/*
 * The field the Reed–Solomon codewords live in: GF(2^8) modulo the primitive
 * polynomial x^8 + x^4 + x^3 + x^2 + 1 (0x11D), which is what the standard
 * specifies. EXP is doubled in length so a log-sum never needs a modulo.
 */
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);

{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]!;
}

const gfMul = (a: number, b: number): number =>
  a === 0 || b === 0 ? 0 : EXP[LOG[a]! + LOG[b]!]!;

/** The generator polynomial for `degree` error-correction codewords. */
function generatorPoly(degree: number): number[] {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array<number>(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] = next[j]! ^ poly[j]!;
      next[j + 1] = next[j + 1]! ^ gfMul(poly[j]!, EXP[i]!);
    }
    poly = next;
  }
  return poly;
}

/** The `ecLen` error-correction codewords for one data block. */
function reedSolomon(data: readonly number[], ecLen: number): number[] {
  const gen = generatorPoly(ecLen);
  const buffer = new Array<number>(data.length + ecLen).fill(0);
  for (let i = 0; i < data.length; i++) buffer[i] = data[i]!;

  for (let i = 0; i < data.length; i++) {
    const factor = buffer[i]!;
    if (factor === 0) continue;
    // gen[0] is 1, so this always clears buffer[i].
    for (let j = 0; j < gen.length; j++) {
      buffer[i + j] = buffer[i + j]! ^ gfMul(gen[j]!, factor);
    }
  }
  return buffer.slice(data.length);
}

// --------------------------------------------------------------- input -----

/**
 * UTF-8 bytes, written out rather than taken from TextEncoder.
 *
 * This package compiles against `lib: ["ES2022"]` with no DOM, and is consumed
 * by both the API and the browser. Twenty lines here is cheaper than making
 * the whole shared package depend on an ambient global.
 */
function utf8(text: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i++) {
    let code = text.charCodeAt(i);

    // A surrogate pair is one character in two units.
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const low = text.charCodeAt(i + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00);
        i++;
      }
    }

    if (code < 0x80) bytes.push(code);
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    else if (code < 0x10000)
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    else
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
  }
  return bytes;
}

/** Byte-mode character-count indicator width. 16 bits from version 10 up. */
const countBits = (version: number): number => (version < 10 ? 8 : 16);

const dataCodewords = (version: number): number => {
  const [, g1Blocks, g1Data, g2Blocks, g2Data] = EC_BLOCKS_M[version]!;
  return g1Blocks * g1Data + g2Blocks * g2Data;
};

/** The smallest version that will hold this many bytes, or null. */
function chooseVersion(byteLength: number): number | null {
  for (let v = MIN_VERSION; v <= MAX_VERSION; v++) {
    const capacityBits = dataCodewords(v) * 8;
    if (4 + countBits(v) + byteLength * 8 <= capacityBits) return v;
  }
  return null;
}

/** Mode indicator, length, payload, terminator and padding — one bit array. */
function dataBits(bytes: readonly number[], version: number): number[] {
  const bits: number[] = [];
  const push = (value: number, width: number) => {
    for (let i = width - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };

  push(0b0100, 4); // byte mode
  push(bytes.length, countBits(version));
  for (const byte of bytes) push(byte, 8);

  const capacityBits = dataCodewords(version) * 8;
  // Terminator: up to four zero bits, fewer if the symbol is nearly full.
  push(0, Math.min(4, capacityBits - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);

  // Alternating pad bytes, which is what the standard names.
  const pad = [0xec, 0x11];
  for (let i = 0; bits.length < capacityBits; i++) push(pad[i % 2]!, 8);

  return bits;
}

/** Interleaves the data and error-correction blocks into the final codewords. */
function codewords(bits: readonly number[], version: number): number[] {
  const [ecLen, g1Blocks, g1Data, g2Blocks, g2Data] = EC_BLOCKS_M[version]!;

  const flat: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j]!;
    flat.push(byte);
  }

  const blocks: number[][] = [];
  const ecBlocks: number[][] = [];
  let offset = 0;
  for (let b = 0; b < g1Blocks + g2Blocks; b++) {
    const size = b < g1Blocks ? g1Data : g2Data;
    const block = flat.slice(offset, offset + size);
    offset += size;
    blocks.push(block);
    ecBlocks.push(reedSolomon(block, ecLen));
  }

  const out: number[] = [];
  const longest = Math.max(g1Data, g2Data);
  for (let i = 0; i < longest; i++) {
    for (const block of blocks) if (i < block.length) out.push(block[i]!);
  }
  for (let i = 0; i < ecLen; i++) {
    for (const block of ecBlocks) out.push(block[i]!);
  }
  return out;
}

// -------------------------------------------------------------- symbol -----

interface Canvas {
  size: number;
  modules: boolean[][];
  /** Function patterns, which the mask must not touch. */
  fixed: boolean[][];
}

function blank(version: number): Canvas {
  const size = version * 4 + 17;
  const grid = () => Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  return { size, modules: grid(), fixed: grid() };
}

function setFixed(c: Canvas, row: number, col: number, dark: boolean): void {
  if (row < 0 || col < 0 || row >= c.size || col >= c.size) return;
  c.modules[row]![col] = dark;
  c.fixed[row]![col] = true;
}

function drawFinder(c: Canvas, row: number, col: number): void {
  // The 7×7 eye plus its one-module separator, in a single distance test.
  for (let dr = -4; dr <= 4; dr++) {
    for (let dc = -4; dc <= 4; dc++) {
      const ring = Math.max(Math.abs(dr), Math.abs(dc));
      setFixed(c, row + dr, col + dc, ring !== 2 && ring !== 4);
    }
  }
}

function drawAlignment(c: Canvas, row: number, col: number): void {
  for (let dr = -2; dr <= 2; dr++) {
    for (let dc = -2; dc <= 2; dc++) {
      setFixed(c, row + dr, col + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
    }
  }
}

/** BCH(15,5), then the mask the standard applies so an all-zero format is not blank. */
export function formatBits(mask: number): number {
  const data = (0b00 << 3) | mask; // 0b00 is level M
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

/** BCH(18,6) — only versions 7 and up carry this. */
export function versionBits(version: number): number {
  let rem = version;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return (version << 12) | rem;
}

function drawFormat(c: Canvas, mask: number): void {
  const bits = formatBits(mask);
  const bit = (i: number) => ((bits >>> i) & 1) === 1;

  // First copy, wrapped around the top-left eye.
  for (let i = 0; i <= 5; i++) setFixed(c, i, 8, bit(i));
  setFixed(c, 7, 8, bit(6));
  setFixed(c, 8, 8, bit(7));
  setFixed(c, 8, 7, bit(8));
  for (let i = 9; i < 15; i++) setFixed(c, 8, 14 - i, bit(i));

  // Second copy, split between the other two eyes.
  for (let i = 0; i < 8; i++) setFixed(c, 8, c.size - 1 - i, bit(i));
  for (let i = 8; i < 15; i++) setFixed(c, c.size - 15 + i, 8, bit(i));

  // The module that is always dark.
  setFixed(c, c.size - 8, 8, true);
}

function drawFunctionPatterns(c: Canvas, version: number): void {
  // Timing first; the eyes overwrite its ends.
  for (let i = 0; i < c.size; i++) {
    setFixed(c, 6, i, i % 2 === 0);
    setFixed(c, i, 6, i % 2 === 0);
  }

  drawFinder(c, 3, 3);
  drawFinder(c, 3, c.size - 4);
  drawFinder(c, c.size - 4, 3);

  const centres = ALIGNMENT[version]!;
  for (let i = 0; i < centres.length; i++) {
    for (let j = 0; j < centres.length; j++) {
      // The three that would sit on an eye are omitted.
      const onEye =
        (i === 0 && j === 0) ||
        (i === 0 && j === centres.length - 1) ||
        (i === centres.length - 1 && j === 0);
      if (!onEye) drawAlignment(c, centres[i]!, centres[j]!);
    }
  }

  // Reserved now with mask 0; rewritten once the mask is chosen.
  drawFormat(c, 0);

  if (version >= 7) {
    const bits = versionBits(version);
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) === 1;
      const a = c.size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      setFixed(c, b, a, dark);
      setFixed(c, a, b, dark);
    }
  }
}

/** The zigzag walk up and down each pair of columns, skipping the timing column. */
function drawCodewords(c: Canvas, data: readonly number[]): void {
  let bit = 0;
  const total = data.length * 8;

  for (let right = c.size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5; // column 6 is the vertical timing pattern
    for (let step = 0; step < c.size; step++) {
      for (let j = 0; j < 2; j++) {
        const col = right - j;
        const upward = ((right + 1) & 2) === 0;
        const row = upward ? c.size - 1 - step : step;
        if (c.fixed[row]![col]) continue;
        // Past the end of the data are the remainder bits, which are light.
        if (bit < total) {
          c.modules[row]![col] = ((data[bit >>> 3]! >>> (7 - (bit & 7))) & 1) === 1;
          bit++;
        }
      }
    }
  }
}

function maskAt(mask: number, row: number, col: number): boolean {
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
}

function applyMask(c: Canvas, mask: number): void {
  for (let row = 0; row < c.size; row++) {
    for (let col = 0; col < c.size; col++) {
      if (c.fixed[row]![col]) continue;
      if (maskAt(mask, row, col)) c.modules[row]![col] = !c.modules[row]![col];
    }
  }
}

/** The finder-lookalike the third penalty rule hunts for, and its mirror. */
const FINDER_RUN = [true, false, true, true, true, false, true, false, false, false, false];

/**
 * The standard's four penalty rules. Lower is better.
 *
 * A symbol is legible under any mask, so this is not correctness — it is the
 * difference between a code a phone reads instantly and one it reads on the
 * third try.
 */
function penalty(c: Canvas): number {
  const size = c.size;
  const at = (row: number, col: number) => c.modules[row]![col]!;
  let score = 0;

  // Rule 1 — runs of five or more of one colour.
  for (let a = 0; a < size; a++) {
    for (const horizontal of [true, false]) {
      let colour = false;
      let run = 0;
      for (let b = 0; b < size; b++) {
        const dark = horizontal ? at(a, b) : at(b, a);
        if (dark === colour) {
          run++;
          if (run === 5) score += 3;
          else if (run > 5) score += 1;
        } else {
          colour = dark;
          run = 1;
        }
      }
    }
  }

  // Rule 2 — every 2×2 block of one colour.
  for (let row = 0; row < size - 1; row++) {
    for (let col = 0; col < size - 1; col++) {
      const dark = at(row, col);
      if (dark === at(row, col + 1) && dark === at(row + 1, col) && dark === at(row + 1, col + 1)) {
        score += 3;
      }
    }
  }

  // Rule 3 — anything that looks like a finder pattern in the data.
  for (let a = 0; a < size; a++) {
    for (let b = 0; b + FINDER_RUN.length <= size; b++) {
      // Both directions, because the pattern is only symmetric about its
      // middle if the four light modules are ignored — and they are the half
      // that makes it look like a finder.
      const rowForward = FINDER_RUN.every((want, k) => at(a, b + k) === want);
      const rowBack = FINDER_RUN.every((want, k) => at(a, b + FINDER_RUN.length - 1 - k) === want);
      if (rowForward || rowBack) score += 40;

      const colForward = FINDER_RUN.every((want, k) => at(b + k, a) === want);
      const colBack = FINDER_RUN.every((want, k) => at(b + FINDER_RUN.length - 1 - k, a) === want);
      if (colForward || colBack) score += 40;
    }
  }

  // Rule 4 — how far the dark proportion strays from half.
  let dark = 0;
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) if (at(row, col)) dark++;
  }
  const total = size * size;
  score += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;

  return score;
}

/**
 * Encodes `text` and returns the module matrix, row-major, `true` for dark.
 *
 * Throws for text too long to fit version 10 at level M (213 bytes), rather
 * than truncating: a QR code holding half a URL scans perfectly and sends the
 * reader somewhere else.
 */
export function encodeQr(text: string): boolean[][] {
  const bytes = utf8(text);
  const version = chooseVersion(bytes.length);
  if (version === null) {
    throw new Error(
      `That is ${bytes.length} bytes; a version-10 level-M QR code holds 213.`,
    );
  }

  const data = codewords(dataBits(bytes, version), version);

  let best: Canvas | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (let mask = 0; mask < 8; mask++) {
    const canvas = blank(version);
    drawFunctionPatterns(canvas, version);
    drawCodewords(canvas, data);
    applyMask(canvas, mask);
    drawFormat(canvas, mask);

    const score = penalty(canvas);
    if (score < bestScore) {
      bestScore = score;
      best = canvas;
    }
  }

  return best!.modules;
}

/**
 * The matrix as one SVG path, drawn at `scale` units per module.
 *
 * ONE PATH RATHER THAN A RECT PER MODULE. A version-6 symbol is 41×41, so a
 * naive rendering is up to 1,681 elements inside a certificate that is itself
 * an SVG — which is slow to serialise, slow to rasterise, and enormous. Each
 * run of adjacent dark modules in a row becomes a single subpath instead.
 */
export function qrPath(matrix: readonly (readonly boolean[])[], scale = 1): string {
  const parts: string[] = [];
  for (let row = 0; row < matrix.length; row++) {
    const line = matrix[row]!;
    let col = 0;
    while (col < line.length) {
      if (!line[col]) {
        col++;
        continue;
      }
      let run = 1;
      while (col + run < line.length && line[col + run]) run++;
      parts.push(
        `M${col * scale} ${row * scale}h${run * scale}v${scale}h${-run * scale}z`,
      );
      col += run;
    }
  }
  return parts.join("");
}

/** The width of the symbol in modules, for laying out a quiet zone. */
export const qrSize = (matrix: readonly (readonly boolean[])[]): number => matrix.length;
