/**
 * A PDF writer — enough of ISO 32000-1 to set a financial document on A4.
 *
 * WRITTEN HERE RATHER THAN INSTALLED, which is the same decision this
 * repository already made for the QR encoder in @lms/shared and for the icon
 * set: a receipt is the Institute's written admission that it holds somebody's
 * money, and the code that produces it should be something this repository can
 * read and test. The alternative was a dependency — pdfkit pulls a font
 * subsetting library, a zlib binding and a stream shim — in the path of every
 * receipt ever issued, for a document that uses no image, no transparency and
 * no font the specification does not already require every reader to have.
 *
 * DELIBERATELY NARROW. One page size, the base-14 fonts, uncompressed content
 * streams, no images, no encryption, no outlines. That is exactly what an A4
 * receipt needs and nothing beyond it. Anything this cannot express is a sign
 * the document is trying to be a web page.
 *
 * WHY UNCOMPRESSED. A receipt is about four kilobytes of text. Deflating it
 * would save perhaps two, at the cost of a zlib dependency and of making the
 * output unreadable in a text editor — and being able to open a generated file
 * and see the words is worth more than two kilobytes when a receipt prints
 * wrong and somebody has to find out why.
 *
 * THE COORDINATE SYSTEM IS PDF'S: the origin is bottom-left and y grows
 * upwards. Every caller above this file uses a top-down y, because that is how
 * anybody laying out a document thinks, so `Page` converts once at the edge and
 * nothing else has to remember.
 */

/** A4 in points, at 72 per inch. */
export const A4 = { width: 595.28, height: 841.89 } as const;

export type FontName = "Helvetica" | "Helvetica-Bold" | "Helvetica-Oblique" | "Times-Italic";

/**
 * Character widths, in 1/1000 em, for codes 32..126.
 *
 * FROM THE ADOBE AFM METRICS, not measured or guessed. They are here so text
 * can be centred and — much more importantly — so money can be RIGHT-ALIGNED.
 * A column of figures that does not align at the decimal point is a column
 * somebody has to add up twice, and this is a document whose whole purpose is
 * to be checked.
 */
const WIDTHS: Readonly<Record<FontName, readonly number[]>> = {
  Helvetica: [
    278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556,
    556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667,
    611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667,
    667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500,
    222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
  ],
  "Helvetica-Bold": [
    278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556,
    556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667,
    611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667,
    667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556,
    278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
  ],
  "Helvetica-Oblique": [
    278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556,
    556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667,
    611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667,
    667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500,
    222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
  ],
  "Times-Italic": [
    250, 333, 420, 500, 500, 833, 778, 214, 333, 333, 500, 675, 250, 333, 250, 278, 500, 500, 500,
    500, 500, 500, 500, 500, 500, 500, 333, 333, 675, 675, 675, 500, 920, 611, 611, 667, 722, 611,
    611, 722, 722, 333, 444, 667, 556, 833, 667, 722, 611, 722, 611, 500, 556, 722, 611, 833, 611,
    556, 556, 389, 278, 389, 422, 500, 333, 500, 500, 444, 500, 444, 278, 500, 500, 278, 278, 444,
    278, 722, 500, 500, 500, 500, 389, 389, 278, 500, 444, 667, 444, 444, 389, 400, 275, 400, 541,
  ],
};

/**
 * The width of a string, in points.
 *
 * Anything outside 32..126 is charged at the width of a space. The escaping
 * below folds those characters to ASCII before they are drawn, so this is
 * measuring what will actually appear rather than what was passed in.
 */
export function textWidth(text: string, font: FontName, size: number): number {
  const table = WIDTHS[font];
  let mils = 0;
  for (const ch of toWinAnsi(text)) {
    const code = ch.charCodeAt(0);
    mils += code >= 32 && code <= 126 ? (table[code - 32] ?? 0) : (table[0] ?? 278);
  }
  return (mils / 1000) * size;
}

/**
 * ASCII, deliberately.
 *
 * A PDF using a base-14 font with WinAnsiEncoding can carry Latin-1, but this
 * document is generated from settings and student names that may hold anything
 * at all — an em dash pasted out of Word, a rupee sign, a name in Urdu. A
 * character the font cannot draw appears as a blank or a wrong glyph on the
 * PRINTED receipt, where nobody will notice until a student is holding it.
 *
 * So the handful that actually occur are folded to something a reader can
 * read, and everything else becomes a question mark rather than a silent gap:
 * honestly wrong rather than invisibly wrong. The typographic dashes and
 * quotes this codebase uses in its own prose are all covered.
 */
function toWinAnsi(text: string): string {
  return text
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    // U+2010..U+2015 and U+2212. The one that actually reached a receipt was
    // U+2011, the non-breaking hyphen Word inserts into "G-11" — invisible in
    // every editor and a question mark on the printed page.
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/…/g, "...")
    .replace(/\u00a0/g, " ") // a non-breaking space, written as an escape
    .replace(/[₨₹]/g, "Rs")
    .replace(/[^\x20-\x7E]/g, "?");
}

/** A string literal in a content stream. */
function pdfString(text: string): string {
  const escaped = toWinAnsi(text)
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
  return "(" + escaped + ")";
}

export type Align = "left" | "center" | "right";

export interface TextOptions {
  font?: FontName;
  size?: number;
  /** 0..1 per channel. Black when absent. */
  colour?: readonly [number, number, number];
  align?: Align;
  /** Required for centre and right alignment; ignored for left. */
  width?: number;
  /** Extra space between characters — used for the small tracked-out labels. */
  tracking?: number;
}

/**
 * One page, drawn top-down.
 *
 * Holds the content stream as an array of operator strings rather than one
 * growing string: a receipt emits a few hundred of them, and repeated
 * concatenation of a large string is the one performance mistake that is
 * genuinely easy to make here.
 */
export class Page {
  private readonly ops: string[] = [];
  readonly width = A4.width;
  readonly height = A4.height;

  /** Top-down y to PDF's bottom-up y. The only place this conversion happens. */
  private flip(top: number): number {
    return this.height - top;
  }

  private setColour(c: readonly [number, number, number] | undefined, stroking: boolean): void {
    const [r, g, b] = c ?? [0, 0, 0];
    this.ops.push(`${fmt(r)} ${fmt(g)} ${fmt(b)} ${stroking ? "RG" : "rg"}`);
  }

  /**
   * A line of text, positioned by its BASELINE.
   *
   * Baseline rather than top, because that is what a reader means by "these
   * two things line up", and it is what the PDF operator takes.
   */
  text(content: string, x: number, baselineTop: number, options: TextOptions = {}): void {
    if (content === "") return;
    const font = options.font ?? "Helvetica";
    const size = options.size ?? 10;
    const tracking = options.tracking ?? 0;

    let drawX = x;
    if (options.align && options.align !== "left" && options.width !== undefined) {
      const w = textWidth(content, font, size) + tracking * Math.max(0, content.length - 1);
      drawX = options.align === "center" ? x + (options.width - w) / 2 : x + options.width - w;
    }

    this.ops.push("BT");
    this.setColour(options.colour, false);
    this.ops.push(`/${fontKey(font)} ${fmt(size)} Tf`);
    if (tracking !== 0) this.ops.push(`${fmt(tracking)} Tc`);
    this.ops.push(`1 0 0 1 ${fmt(drawX)} ${fmt(this.flip(baselineTop))} Tm`);
    this.ops.push(`${pdfString(content)} Tj`);
    if (tracking !== 0) this.ops.push("0 Tc");
    this.ops.push("ET");
  }

  /**
   * Text wrapped to a width, returning the baseline just past the last line.
   *
   * Wraps on WORDS and never mid-word: a break in the middle of a bank
   * reference makes the reference unusable, and this is a document people copy
   * numbers off.
   */
  paragraph(
    content: string,
    x: number,
    topBaseline: number,
    width: number,
    options: TextOptions & { leading?: number } = {},
  ): number {
    const font = options.font ?? "Helvetica";
    const size = options.size ?? 9.5;
    const leading = options.leading ?? size * 1.45;

    let line = "";
    let y = topBaseline;
    for (const word of content.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (textWidth(candidate, font, size) > width && line) {
        this.text(line, x, y, { ...options, font, size });
        y += leading;
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) {
      this.text(line, x, y, { ...options, font, size });
      y += leading;
    }
    return y;
  }

  /**
   * How many lines `paragraph` will take, without drawing any of them.
   *
   * EXISTS BECAUSE A FRAMED NOTICE HAS TO BE THE SIZE OF ITS TEXT. The reversal
   * notice was drawn at a fixed height and its third line fell outside the box
   * — a receipt whose most important warning is half outside its own frame.
   * A caller measures first, draws the frame, then fills it.
   */
  countLines(content: string, width: number, font: FontName = "Helvetica", size = 9.5): number {
    let line = "";
    let lines = 0;
    for (const word of content.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (textWidth(candidate, font, size) > width && line) {
        lines += 1;
        line = word;
      } else {
        line = candidate;
      }
    }
    return line ? lines + 1 : lines;
  }

  /** A filled rectangle, given its top-left corner. */
  rect(
    x: number,
    top: number,
    w: number,
    h: number,
    colour: readonly [number, number, number],
  ): void {
    this.setColour(colour, false);
    this.ops.push(`${fmt(x)} ${fmt(this.flip(top + h))} ${fmt(w)} ${fmt(h)} re f`);
  }

  /** A stroked rectangle — a border, not a fill. */
  frame(
    x: number,
    top: number,
    w: number,
    h: number,
    colour: readonly [number, number, number],
    lineWidth = 0.75,
  ): void {
    this.setColour(colour, true);
    this.ops.push(`${fmt(lineWidth)} w`);
    this.ops.push(`${fmt(x)} ${fmt(this.flip(top + h))} ${fmt(w)} ${fmt(h)} re S`);
  }

  line(
    x1: number,
    top1: number,
    x2: number,
    top2: number,
    colour: readonly [number, number, number],
    lineWidth = 0.5,
  ): void {
    this.setColour(colour, true);
    this.ops.push(`${fmt(lineWidth)} w`);
    this.ops.push(`${fmt(x1)} ${fmt(this.flip(top1))} m ${fmt(x2)} ${fmt(this.flip(top2))} l S`);
  }

  /**
   * A QR matrix as filled squares.
   *
   * One `re f` per dark module rather than one combined path, because the grid
   * is at most 57 by 57 and being able to read the generated file is worth more
   * than the few hundred bytes a path would save.
   */
  qr(
    matrix: readonly (readonly boolean[])[],
    x: number,
    top: number,
    size: number,
    colour: readonly [number, number, number] = [0, 0, 0],
  ): void {
    const n = matrix.length;
    if (n === 0) return;
    const module = size / n;
    this.setColour(colour, false);
    for (let r = 0; r < n; r += 1) {
      const row = matrix[r]!;
      for (let c = 0; c < n; c += 1) {
        if (!row[c]) continue;
        // A hair of overlap. Squares that meet exactly can leave a white seam
        // at some rasterisations, and a seam through a finder pattern is a
        // code that will not scan.
        const px = x + c * module;
        const py = this.flip(top + (r + 1) * module);
        this.ops.push(`${fmt(px)} ${fmt(py)} ${fmt(module + 0.12)} ${fmt(module + 0.12)} re f`);
      }
    }
  }

  /** Rotated text, for a diagonal watermark. Degrees, anticlockwise. */
  rotatedText(
    content: string,
    x: number,
    baselineTop: number,
    angleDegrees: number,
    options: TextOptions = {},
  ): void {
    const font = options.font ?? "Helvetica-Bold";
    const size = options.size ?? 48;
    const rad = (angleDegrees * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    this.ops.push("BT");
    this.setColour(options.colour, false);
    this.ops.push(`/${fontKey(font)} ${fmt(size)} Tf`);
    this.ops.push(
      `${fmt(cos)} ${fmt(sin)} ${fmt(-sin)} ${fmt(cos)} ${fmt(x)} ${fmt(this.flip(baselineTop))} Tm`,
    );
    this.ops.push(`${pdfString(content)} Tj`);
    this.ops.push("ET");
  }

  contentStream(): string {
    return this.ops.join("\n");
  }
}

const FONT_KEYS: Readonly<Record<FontName, string>> = {
  Helvetica: "F1",
  "Helvetica-Bold": "F2",
  "Helvetica-Oblique": "F3",
  "Times-Italic": "F4",
};
const fontKey = (f: FontName): string => FONT_KEYS[f];

/** Three decimals is a thousandth of a point. Trailing zeroes are noise. */
function fmt(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return String(Math.round(n * 1000) / 1000);
}

/**
 * Assembles the pages into a PDF file.
 *
 * THE CROSS-REFERENCE TABLE IS THE PART THAT HAS TO BE EXACT. Every entry is a
 * BYTE offset from the start of the file, so the document is built as buffers
 * and measured as bytes. Building it as a string and measuring `.length` would
 * be correct only while every character is ASCII — which `toWinAnsi` does make
 * true, but a cross-reference table that is right by luck is a table that
 * breaks silently the first time that changes.
 */
export function buildPdf(pages: Page[], meta: { title: string; author: string }): Buffer {
  const chunks: Buffer[] = [];
  let length = 0;
  const offsets: number[] = [];

  const push = (text: string): void => {
    const b = Buffer.from(text, "latin1");
    chunks.push(b);
    length += b.length;
  };

  // 1 is the catalogue, 2 the page tree, 3..6 the fonts, then a page object
  // and a content stream per page, then the document information dictionary.
  const firstPageObj = 7;
  const pageIds = pages.map((_, i) => firstPageObj + i * 2);
  const contentIds = pages.map((_, i) => firstPageObj + i * 2 + 1);
  const infoId = firstPageObj + pages.length * 2;

  const begin = (id: number): void => {
    offsets[id] = length;
    push(`${id} 0 obj\n`);
  };
  const end = (): void => push("endobj\n");

  push("%PDF-1.4\n");
  // A comment of high bytes. This is what tells a transfer program the file is
  // binary, and it is the reason a PDF survives being emailed.
  push("%\xE2\xE3\xCF\xD3\n");

  begin(1);
  push("<< /Type /Catalog /Pages 2 0 R >>\n");
  end();

  begin(2);
  push(
    `<< /Type /Pages /Count ${pages.length} /Kids [${pageIds
      .map((id) => `${id} 0 R`)
      .join(" ")}] >>\n`,
  );
  end();

  const fontObjects: Array<[number, FontName]> = [
    [3, "Helvetica"],
    [4, "Helvetica-Bold"],
    [5, "Helvetica-Oblique"],
    [6, "Times-Italic"],
  ];
  for (const [id, name] of fontObjects) {
    begin(id);
    push(`<< /Type /Font /Subtype /Type1 /BaseFont /${name} /Encoding /WinAnsiEncoding >>\n`);
    end();
  }

  const resources = `<< /Font << ${fontObjects
    .map(([id, name]) => `/${fontKey(name)} ${id} 0 R`)
    .join(" ")} >> >>`;

  pages.forEach((page, i) => {
    begin(pageIds[i]!);
    push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${fmt(A4.width)} ${fmt(A4.height)}] ` +
        `/Resources ${resources} /Contents ${contentIds[i]} 0 R >>\n`,
    );
    end();

    const stream = page.contentStream();
    begin(contentIds[i]!);
    push(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n`);
    push(stream);
    push("\nendstream\n");
    end();
  });

  begin(infoId);
  push(
    `<< /Title ${pdfString(meta.title)} /Author ${pdfString(meta.author)} ` +
      `/Producer (Prepreneurship LMS) /CreationDate (${pdfDate(new Date())}) >>\n`,
  );
  end();

  const xrefAt = length;
  const objectCount = infoId + 1;
  push(`xref\n0 ${objectCount}\n`);
  push("0000000000 65535 f \n");
  for (let id = 1; id < objectCount; id += 1) {
    push(`${String(offsets[id] ?? 0).padStart(10, "0")} 00000 n \n`);
  }
  push(
    `trailer\n<< /Size ${objectCount} /Root 1 0 R /Info ${infoId} 0 R >>\n` +
      `startxref\n${xrefAt}\n%%EOF\n`,
  );

  return Buffer.concat(chunks);
}

/** The date format §7.9.4 specifies. UTC, so it does not depend on the host. */
function pdfDate(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, "0");
  return (
    `D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
  );
}
