/**
 * Upload validation — SRS §5.9, FR-ASG-006, Appendix H.
 *
 * A pure module, so the rules that decide what may be stored can be tested
 * exhaustively without a filesystem, a database or an HTTP request.
 *
 * The central decision here is that an EXTENSION IS NOT EVIDENCE. A student
 * renaming payload.exe to essay.pdf changes nothing about the bytes, and a
 * check that trusts the name is a check that passes for exactly the file you
 * did not want. So the declared extension must be consistent with what the
 * leading bytes actually say the file is.
 *
 * This is deliberately not a virus scanner. It cannot tell a malicious PDF from
 * an innocent one; it only ensures the thing claiming to be a PDF is one. Real
 * scanning is a separate concern, which is why every stored file starts at
 * scanStatus PENDING rather than being asserted CLEAN.
 */

export interface FilePolicy {
  /** Lower-case, no dot. Narrowed by the teacher, bounded by Appendix H. */
  allowedTypes: string[];
  maxSizeBytes: number;
  maxFileCount: number;
}

export type RejectionCode =
  | "EMPTY_FILE"
  | "TOO_LARGE"
  | "TOO_MANY_FILES"
  | "EXTENSION_NOT_ALLOWED"
  | "NO_EXTENSION"
  | "CONTENT_MISMATCH"
  | "FILENAME_UNSAFE";

export interface Rejection {
  code: RejectionCode;
  /** Written for the student, not for a log. */
  message: string;
}

/**
 * Signatures for every type Appendix H permits.
 *
 * ZIP-family formats (docx, pptx, xlsx) are all genuinely ZIP containers and
 * share one signature, so this cannot tell them apart. That is a real limit,
 * stated rather than hidden: the check proves the file is a ZIP container, not
 * which Office format it holds.
 */
const SIGNATURES: Array<{ extensions: string[]; bytes: number[]; offset?: number }> = [
  { extensions: ["pdf"], bytes: [0x25, 0x50, 0x44, 0x46] }, // %PDF
  { extensions: ["docx", "pptx", "xlsx", "zip"], bytes: [0x50, 0x4b, 0x03, 0x04] }, // PK..
  // An empty or spanned ZIP archive. Rare, but a valid container.
  { extensions: ["docx", "pptx", "xlsx", "zip"], bytes: [0x50, 0x4b, 0x05, 0x06] },
  { extensions: ["docx", "pptx", "xlsx", "zip"], bytes: [0x50, 0x4b, 0x07, 0x08] },
  // OLE2 compound file — the pre-2007 Office formats.
  { extensions: ["doc", "ppt", "xls"], bytes: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] },
  { extensions: ["jpg", "jpeg"], bytes: [0xff, 0xd8, 0xff] },
  { extensions: ["png"], bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { extensions: ["mp3"], bytes: [0x49, 0x44, 0x33] }, // ID3 tag
  { extensions: ["mp3"], bytes: [0xff, 0xfb] }, // bare MPEG frame
  { extensions: ["mp3"], bytes: [0xff, 0xf3] },
  { extensions: ["mp3"], bytes: [0xff, 0xf2] },
];

/** Plain text has no signature, so it is verified by what it must NOT contain. */
const SIGNATURELESS = new Set(["txt"]);

export function extensionOf(filename: string): string | null {
  const dot = filename.lastIndexOf(".");
  if (dot <= 0 || dot === filename.length - 1) return null;
  return filename.slice(dot + 1).toLowerCase();
}

/**
 * Codepoints a filename may never contain.
 *
 * Checked by number rather than by regex on purpose. A character class holding
 * C0 controls and bidirectional overrides has to carry those characters
 * literally or as escapes, and both forms are fragile: literal control bytes in
 * a source file survive editors, diffs and copy-paste badly, and escapes get
 * silently normalised back into literals by tooling. Numbers survive
 * everything, and the intent is legible without decoding anything.
 */
function isForbiddenCodepoint(code: number): boolean {
  if (code <= 0x1f) return true; // C0 controls, including NUL
  if (code === 0x7f) return true; // DEL
  // U+202A..U+202E and U+2066..U+2069 reorder text when rendered. A file named
  // with U+202E can display to a teacher as "evilexe.png" while actually being
  // "evil<override>gnp.exe".
  if (code >= 0x202a && code <= 0x202e) return true;
  if (code >= 0x2066 && code <= 0x2069) return true;
  return false;
}

/**
 * Rejects a filename that could be dangerous once it leaves the System.
 *
 * The stored name is System-generated (SEC-FIL-005), so none of this affects
 * where bytes land. It matters because the ORIGINAL name is shown to teachers
 * and used as the download filename, and a name containing a path separator, a
 * control character or a right-to-left override can misrepresent what a teacher
 * is about to open.
 */
export function isFilenameSafe(filename: string): boolean {
  if (filename.length === 0 || filename.length > 255) return false;
  if (filename.includes("/") || filename.includes("\\")) return false;
  if (filename === "." || filename === "..") return false;
  for (const char of filename) {
    if (isForbiddenCodepoint(char.codePointAt(0) ?? 0)) return false;
  }
  return true;
}

/**
 * The extensions the leading bytes are consistent with.
 *
 * `null` means "no signature recognised", which is not the same as "invalid" —
 * a .txt legitimately has none.
 */
export function sniffExtensions(bytes: Uint8Array): string[] | null {
  for (const sig of SIGNATURES) {
    const offset = sig.offset ?? 0;
    if (bytes.length < offset + sig.bytes.length) continue;
    let matches = true;
    for (let i = 0; i < sig.bytes.length; i++) {
      if (bytes[offset + i] !== sig.bytes[i]) {
        matches = false;
        break;
      }
    }
    if (matches) return sig.extensions;
  }
  return null;
}

/** A NUL byte is the clearest sign that "text" is really something else. */
export function looksLikeText(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, 8192);
  for (const b of sample) {
    if (b === 0x00) return false;
  }
  return true;
}

/**
 * Validates one upload against the assignment's policy.
 *
 * Returns a rejection rather than throwing, so the caller decides the transport
 * (an HTTP status, a per-file error in a batch, a queued retry) and so every
 * branch is trivially testable.
 */
export function validateUpload(input: {
  filename: string;
  sizeBytes: number;
  bytes: Uint8Array;
  policy: FilePolicy;
  /** How many the student has already uploaded for this assignment. */
  existingCount: number;
}): Rejection | null {
  const { filename, sizeBytes, bytes, policy, existingCount } = input;

  if (!isFilenameSafe(filename)) {
    return {
      code: "FILENAME_UNSAFE",
      message: "That filename contains characters we cannot accept. Please rename the file.",
    };
  }

  if (sizeBytes <= 0) {
    return { code: "EMPTY_FILE", message: "That file is empty." };
  }

  if (sizeBytes > policy.maxSizeBytes) {
    const limitMb = Math.round(policy.maxSizeBytes / (1024 * 1024));
    return {
      code: "TOO_LARGE",
      // States the limit, because "too large" alone does not tell a student
      // whether to compress the file or split it (NFR-USE-007).
      message: `That file is ${formatBytes(sizeBytes)}. The limit for this assignment is ${limitMb} MB.`,
    };
  }

  if (existingCount >= policy.maxFileCount) {
    return {
      code: "TOO_MANY_FILES",
      message: `You may attach at most ${policy.maxFileCount} file${
        policy.maxFileCount === 1 ? "" : "s"
      } to this assignment. Remove one first.`,
    };
  }

  const ext = extensionOf(filename);
  if (!ext) {
    return {
      code: "NO_EXTENSION",
      message: "That file has no extension, so we cannot tell what type it is.",
    };
  }

  const allowed = policy.allowedTypes.map((t) => t.toLowerCase().replace(/^\./, ""));
  if (!allowed.includes(ext)) {
    return {
      code: "EXTENSION_NOT_ALLOWED",
      message: `This assignment accepts ${formatList(allowed)}. Yours is a .${ext} file.`,
    };
  }

  // The content check. An extension the policy allows still has to be backed up
  // by the bytes.
  const sniffed = sniffExtensions(bytes);

  if (SIGNATURELESS.has(ext)) {
    if (sniffed !== null || !looksLikeText(bytes)) {
      return {
        code: "CONTENT_MISMATCH",
        message: "That file is named .txt but does not contain plain text.",
      };
    }
    return null;
  }

  if (sniffed === null || !sniffed.includes(ext)) {
    return {
      code: "CONTENT_MISMATCH",
      // Deliberately does not say what the file REALLY is. Naming the detected
      // signature would turn this into an oracle for probing the check.
      message: `That file is named .${ext} but its contents are not a valid ${ext.toUpperCase()} file.`,
    };
  }

  return null;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} bytes`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatList(items: string[]): string {
  const pretty = items.map((i) => `.${i}`);
  if (pretty.length === 0) return "no file types";
  if (pretty.length === 1) return pretty[0] as string;
  return `${pretty.slice(0, -1).join(", ")} and ${pretty[pretty.length - 1]}`;
}
