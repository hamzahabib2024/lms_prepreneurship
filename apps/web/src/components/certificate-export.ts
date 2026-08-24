import { CERT_HEIGHT, CERT_WIDTH } from "./CertificateDocument";

/**
 * Turning the certificate into a file somebody can keep — SRS §5.15.
 *
 * WHY THIS IS NOT A LIBRARY. Three were considered and each brings a build-time
 * dependency for something this file does in two hundred lines: html2canvas
 * re-implements a layout engine to photograph the DOM, jsPDF carries a font
 * subsetter and a vector API we would use one call of, and a headless browser on
 * the server is a container three times the size of the API for one endpoint.
 * This app draws its own icons and writes its own CSS for the same reason —
 * what is written down can be checked.
 *
 * WHAT IT ACTUALLY DOES, and why it is not a screenshot:
 *
 *   The certificate is already an SVG, so exporting it is rasterising known
 *   markup at a chosen density — 3,508 pixels across for the PDF, which is 300
 *   dpi on A4 — rather than capturing whatever the browser happened to paint.
 *   Nothing of the application appears in the output: not the sidebar, not the
 *   scroll position, not the reader's theme. The file is the document.
 *
 *   The fonts and the Institute's mark are inlined as data URIs before
 *   rasterising, because an SVG loaded into an <img> is an isolated document
 *   that may not fetch anything. Without that step the certificate renders in
 *   Times New Roman with a hole where the logo was — and it renders that way
 *   SILENTLY, which is exactly the kind of defect that ships.
 */

const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";

/** A4 landscape in PostScript points, which is what a PDF page is measured in. */
const PAGE_WIDTH_PT = 841.89;
const PAGE_HEIGHT_PT = 595.28;

/** 297 mm at 300 dpi. Below this, printed hairlines start to break up. */
const PRINT_WIDTH_PX = 3508;
/** Twice the design size: plenty for a phone, a timeline, or a LinkedIn post. */
const SHARE_WIDTH_PX = 2828;

export interface CertificateAssets {
  /** The Institute's mark as a data URI. */
  logoHref: string;
  /** @font-face rules with the woff2 files inlined. */
  fontCss: string;
}

const FONTS = [
  { family: "Sora", file: "/fonts/sora.woff2", weight: "300 700", style: "normal" },
  { family: "Inter", file: "/fonts/inter.woff2", weight: "400 700", style: "normal" },
  {
    family: "Instrument Serif",
    file: "/fonts/instrument-serif.woff2",
    weight: "400",
    style: "italic",
  },
];

const LOGO = "/brand/ppship-emblem.png";

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  // Chunked, because String.fromCharCode(...bytes) on a 48 kB font blows the
  // argument limit and throws a RangeError that reads like a network failure.
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function dataUri(path: string, mime: string): Promise<string> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Could not load ${path}`);
  return `data:${mime};base64,${toBase64(await response.arrayBuffer())}`;
}

let assetsPromise: Promise<CertificateAssets> | null = null;

/**
 * The fonts and the mark, fetched once per page load.
 *
 * Cached as the PROMISE rather than the result, so a viewer and three cards
 * asking at the same moment share one fetch of each file instead of four.
 */
export function loadCertificateAssets(): Promise<CertificateAssets> {
  if (assetsPromise) return assetsPromise;

  assetsPromise = (async () => {
    const [logoHref, ...fontData] = await Promise.all([
      dataUri(LOGO, "image/png"),
      ...FONTS.map((f) => dataUri(f.file, "font/woff2")),
    ]);

    const fontCss = FONTS.map(
      (f, i) => `@font-face{font-family:'${f.family}';font-style:${f.style};font-weight:${f.weight};src:url(${fontData[i]}) format('woff2');}`,
    ).join("");

    return { logoHref, fontCss };
  })().catch((error) => {
    // Do not cache a failure: a certificate that could not be downloaded
    // because of one dropped request should download on the second press.
    assetsPromise = null;
    throw error;
  });

  return assetsPromise;
}

/**
 * A copy of the live certificate that can survive on its own.
 *
 * Everything the browser was quietly supplying — the stylesheet's fonts, the
 * image at a same-origin path — is written into the markup here, because the
 * copy is about to be loaded as an isolated image with no access to either.
 */
function standalone(source: SVGSVGElement, assets: CertificateAssets, width: number): SVGSVGElement {
  const clone = source.cloneNode(true) as SVGSVGElement;
  const height = Math.round((width * CERT_HEIGHT) / CERT_WIDTH);

  clone.setAttribute("xmlns", SVG_NS);
  clone.setAttribute("xmlns:xlink", XLINK_NS);
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  // The app's class would style nothing here and would only confuse anybody
  // who opened the file.
  clone.removeAttribute("class");

  const style = document.createElementNS(SVG_NS, "style");
  style.textContent = assets.fontCss;
  clone.insertBefore(style, clone.firstChild);

  for (const image of Array.from(clone.querySelectorAll("image"))) {
    image.setAttribute("href", assets.logoHref);
    // Both spellings. `href` is SVG 2 and is what every current browser reads,
    // but a standalone file may also be opened by an older renderer, a design
    // tool or a printer's RIP — and those want xlink.
    image.setAttributeNS(XLINK_NS, "xlink:href", assets.logoHref);
  }

  return clone;
}

const serialize = (svg: SVGSVGElement): string => new XMLSerializer().serializeToString(svg);

/** Rasterises the certificate at a chosen width. */
async function toCanvas(
  source: SVGSVGElement,
  assets: CertificateAssets,
  width: number,
): Promise<HTMLCanvasElement> {
  const height = Math.round((width * CERT_HEIGHT) / CERT_WIDTH);
  const markup = serialize(standalone(source, assets, width));

  // A blob URL rather than a data URL: the markup carries ~100 kB of embedded
  // font, and percent-encoding all of it into a URL is both slower and closer
  // to the length limits some browsers still keep.
  const blobUrl = URL.createObjectURL(new Blob([markup], { type: "image/svg+xml;charset=utf-8" }));

  try {
    const image = new Image();
    image.width = width;
    image.height = height;

    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("The certificate could not be drawn."));
      image.src = blobUrl;
    });

    // decode() waits for the fonts inside the SVG to be applied as well as the
    // pixels to be ready; onload alone can fire a frame early and produce a
    // certificate set in the fallback face.
    if (typeof image.decode === "function") {
      await image.decode().catch(() => undefined);
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser cannot render the certificate.");

    // The paper colour first. A transparent PNG is fine; a JPEG with no
    // background is black, and a certificate that downloads black is the
    // failure this line exists to prevent.
    context.fillStyle = "#fffdf8";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);

    return canvas;
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

const canvasBlob = (canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> =>
  new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("The image could not be encoded."))),
      type,
      quality,
    );
  });

// ------------------------------------------------------------------ PDF ----

const latin1 = (text: string): Uint8Array<ArrayBuffer> => {
  const bytes = new Uint8Array(new ArrayBuffer(text.length));
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0xff;
  return bytes;
};

/** PDF strings are parenthesised, so the three structural characters escape. */
const pdfText = (value: string): string =>
  value
    // Held to printable ASCII. A PDF string literal is PDFDocEncoded, and a
    // character outside it would be written as a WRONG character rather than
    // refused. Only file metadata passes through here — the visible
    // certificate is an image and keeps every mark in the student's name.
    .replace(/[^ -~]/g, "")
    .replace(/([\\()])/g, "\\$1");

const pdfDate = (date: Date): string => {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `D:${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(
    date.getUTCHours(),
  )}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
};

/**
 * A one-page PDF holding one JPEG, written by hand.
 *
 * THE FORMAT IS SIMPLER THAN ITS REPUTATION for this one shape. A PDF is a set
 * of numbered objects, a cross-reference table giving each object's BYTE OFFSET
 * from the start of the file, and a trailer pointing at the table. Six objects
 * are enough: catalogue, page tree, page, content stream, image, metadata.
 *
 * The image is embedded with /DCTDecode, which means "the bytes are a JPEG" —
 * so the JPEG the canvas already produced goes in untouched, with no decoding,
 * no re-encoding and no colour conversion. That is the whole trick, and it is
 * why this needs no library.
 *
 * The offsets are computed from BYTE lengths rather than string lengths, which
 * is the one thing that has to be right: a cross-reference table off by the
 * length of one multi-byte character produces a file that some readers open
 * and others refuse, which is the worst possible way to be wrong.
 */
function buildPdf(
  jpeg: Uint8Array<ArrayBuffer>,
  pixelWidth: number,
  pixelHeight: number,
  meta: { title: string; author: string },
): Blob {
  const objects: Uint8Array<ArrayBuffer>[] = [];
  const push = (body: string): void => {
    objects.push(latin1(body));
  };

  push(`1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`);
  push(`2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n`);
  push(
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH_PT} ${PAGE_HEIGHT_PT}] ` +
      `/Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>\nendobj\n`,
  );

  // Scale the unit image square up to the whole page, then draw it. `q`/`Q`
  // bracket the transform so nothing after it inherits the scale.
  const content = `q\n${PAGE_WIDTH_PT} 0 0 ${PAGE_HEIGHT_PT} 0 0 cm\n/Im0 Do\nQ\n`;
  push(`4 0 obj\n<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`);

  // The image object is built in three pieces because the middle one is binary.
  const imageHeader = latin1(
    `5 0 obj\n<< /Type /XObject /Subtype /Image /Width ${pixelWidth} /Height ${pixelHeight} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
  );
  const imageFooter = latin1(`\nendstream\nendobj\n`);
  const imageObject = new Uint8Array(
    new ArrayBuffer(imageHeader.length + jpeg.length + imageFooter.length),
  );
  imageObject.set(imageHeader, 0);
  imageObject.set(jpeg, imageHeader.length);
  imageObject.set(imageFooter, imageHeader.length + jpeg.length);
  objects.push(imageObject);

  push(
    `6 0 obj\n<< /Title (${pdfText(meta.title)}) /Author (${pdfText(meta.author)}) ` +
      `/Creator (${pdfText(meta.author)}) /Producer (LMS Certificate Service) ` +
      `/CreationDate (${pdfDate(new Date())}) >>\nendobj\n`,
  );

  const header = latin1(`%PDF-1.4\n%\xe2\xe3\xcf\xd3\n`);

  // Where each object starts, in bytes from the beginning of the file.
  const offsets: number[] = [];
  let cursor = header.length;
  for (const object of objects) {
    offsets.push(cursor);
    cursor += object.length;
  }

  const xrefStart = cursor;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) xref += `${String(offset).padStart(10, "0")} 00000 n \n`;
  xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

  return new Blob([header, ...objects, latin1(xref)], { type: "application/pdf" });
}

// -------------------------------------------------------------- exports ----

/** Filesystem-safe, and still recognisable in a downloads folder. */
export function certificateFileName(certificateNo: string, holder: string, extension: string): string {
  const slug = holder
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 48);
  return slug ? `${certificateNo}-${slug}.${extension}` : `${certificateNo}.${extension}`;
}

/** Hands the file to the browser, then lets go of it. */
export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Not revoked immediately: Safari has not finished reading the blob when
  // click() returns, and revoking too early saves a zero-byte file.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export async function certificateAsPng(
  svg: SVGSVGElement,
  assets: CertificateAssets,
): Promise<Blob> {
  return canvasBlob(await toCanvas(svg, assets, SHARE_WIDTH_PX), "image/png");
}

export async function certificateAsPdf(
  svg: SVGSVGElement,
  assets: CertificateAssets,
  meta: { title: string; author: string },
): Promise<Blob> {
  const canvas = await toCanvas(svg, assets, PRINT_WIDTH_PX);
  // 0.95 rather than 1.0: at this density the difference is invisible and the
  // file is a third of the size, which matters for something people email.
  const jpeg = await canvasBlob(canvas, "image/jpeg", 0.95);
  return buildPdf(new Uint8Array(await jpeg.arrayBuffer()), canvas.width, canvas.height, meta);
}

/**
 * Prints the certificate ALONE.
 *
 * Through a hidden iframe rather than window.print() with a print stylesheet,
 * and the reason is `@page`. A certificate is landscape A4 with no margin; the
 * application's own print rules are portrait with an 18 mm margin, and a
 * document cannot declare two page setups. Printing the application would put
 * the certificate on a portrait sheet at 60% of its size with white bands top
 * and bottom, which is not the same object.
 *
 * The iframe carries its own document with its own @page, so what comes out of
 * the printer is the certificate edge to edge.
 */
export async function printCertificate(
  svg: SVGSVGElement,
  assets: CertificateAssets,
  title: string,
): Promise<void> {
  const markup = serialize(standalone(svg, assets, CERT_WIDTH));

  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.setAttribute("title", "Certificate for printing");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:1px;height:1px;opacity:0;border:0;";
  document.body.appendChild(frame);

  const cleanUp = () => frame.remove();

  try {
    const doc = frame.contentDocument;
    if (!doc) throw new Error("This browser would not open a print view.");

    doc.open();
    doc.write(
      `<!doctype html><html><head><meta charset="utf-8"><title>${title.replace(/[<&]/g, "")}</title>` +
        `<style>@page{size:A4 landscape;margin:0}` +
        `html,body{margin:0;padding:0;background:#fffdf8;}` +
        `svg{display:block;width:100%;height:auto;}</style></head><body>${markup}</body></html>`,
    );
    doc.close();

    /*
     * The fonts are inside the markup, so this resolves as soon as they are
     * parsed — but it does have to resolve, or the sheet prints in Times.
     *
     * THE GUARD USED TO TEST `doc.fonts?.ready`, WHICH IS A PROMISE and
     * therefore always truthy. It read as "wait for the fonts if this browser
     * can", and it actually meant "always wait" — harmless where FontFaceSet
     * exists, and a TypeError on any browser without it, which is the exact
     * case the `?.` was written to survive. The thing to test is whether the
     * API is there; what to await is its promise.
     */
    if (doc.fonts) await doc.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    frame.contentWindow?.focus();
    frame.contentWindow?.print();
  } finally {
    // print() is synchronous in some browsers and returns immediately in
    // others, so the frame is kept alive well past the dialog rather than
    // removed underneath it.
    setTimeout(cleanUp, 60_000);
  }
}
