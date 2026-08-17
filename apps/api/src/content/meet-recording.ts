/**
 * Reading a Google Meet recording's name — FR-VID-005.
 *
 * WRITTEN AGAINST THE INSTITUTE'S OWN FILES, not against a specification.
 * These are real names from real class folders, and the variation between
 * them is the whole reason this is a module with tests rather than one regex
 * inside the sync:
 *
 *   (Sec D) Graphic & UI/UX Class - 2026/08/13 20:58 PKT - Recording
 *   (Sec I) English Class - 2026/08/13 20:28 PKT - Recording
 *   Sec-H Graphic Class - 2026/08/13 10:29 PKT - Recording
 *   Recorded for (Sec D) Tech Class - 2026/08/13 10:13 PKT - Recording
 *   (For Sec D Recording) Tech Class - 2026/08/11 10:13 PKT - Recording
 *   Kids Summer Camp Tech Class - 2026/08/10 16:16 PKT - Recording
 *   Master Class - 2026/08/09 21:53 PKT - Recording
 *   (Sec D) Graphic & UI/UX Class - 2026/06/19  - Recording      ← no time
 *   (Sec D) Graphic & UI/UX Class - 2026/06/18 - Recording       ← no time
 *   Sec D - UI UX CLASS - 2026-06-16- recording                  ← dashes, no space
 *   Sec D - UI UX CLASS - 2026-06-15 - recording                 ← dashes
 *
 * TWO THINGS ARE EXTRACTED AND ONE IS DISCARDED.
 *
 *   THE DATE, because it is the date of the CLASS. The file's timestamps are
 *   the date of the UPLOAD, and Meet finishes writing a long recording well
 *   after midnight — a 20:58 class on the 13th lands in Drive at 17:08 UTC,
 *   and an evening class starting at 21:53 lands the next day. Dating cards by
 *   upload time puts Monday's class on Tuesday, which is exactly the kind of
 *   small wrongness that makes students stop trusting the list.
 *
 *   THE TITLE, cleaned. "Class", "Recording", the section marker and the
 *   organiser's own notes to themselves — "Recorded for", "(For Sec D
 *   Recording)" — are noise on a card that already sits inside the section
 *   it belongs to. What is left is the subject.
 *
 *   THE TIME IS DISCARDED once the date is taken. Meet writes it in the
 *   ORGANISER'S timezone with an abbreviation (PKT) and no offset, so it
 *   cannot be converted to an instant without knowing where they were sitting.
 *   A local date is the honest reading; a UTC timestamp built by guessing the
 *   offset would be wrong by five hours and look precise.
 */

export interface MeetRecording {
  /** The class's own name, with the boilerplate removed. */
  title: string;
  /** The day the class happened, from the NAME. Null when it has no date. */
  recordedOn: Date | null;
  /** As written — "20:58". Kept for display only, never parsed to an instant. */
  localTime: string | null;
  /** "Sec D", "Sec-H" — as written, when the name carries one. */
  sectionHint: string | null;
  /** True when this looks like Meet's own naming rather than an upload. */
  isMeetRecording: boolean;
}

/**
 * `2026/08/13` or `2026-08-13`, optionally followed by `20:58` and a timezone
 * abbreviation. Anchored to a dash-delimited segment so a date inside a class
 * name — "Web Design 2026" — cannot be mistaken for one.
 */
const DATE_AND_TIME =
  /[-–]\s*(\d{4})[/-](\d{1,2})[/-](\d{1,2})\s*(?:(\d{1,2}):(\d{2}))?\s*([A-Z]{2,5})?\s*[-–]?/;

/** The trailing "- Recording", in any case, with or without a space before it. */
const TRAILING_RECORDING = /[-–]?\s*recording\s*$/i;

/**
 * Noise around the subject. Ordered: the organiser's notes first, because
 * "(For Sec D Recording)" contains a section marker that the later rule would
 * otherwise strip on its own, leaving "(For  )" behind.
 */
const NOISE: Array<[RegExp, string]> = [
  [/^\s*recorded\s+for\s+/i, ""],
  [/^\s*\(\s*for\s+[^)]*\)\s*/i, ""],
  [/^\s*\(\s*sec[\s-]*[a-z0-9]+\s*\)\s*/i, ""],
  [/^\s*sec[\s-]*[a-z0-9]+\s*[-–]\s*/i, ""],
  [/^\s*sec[\s-]*[a-z0-9]+\s+/i, ""],
  [/\s*\bclass\b\s*$/i, ""],
];

/** "(Sec D)", "Sec-H", "Sec I" — whichever way it was written. */
const SECTION = /\bsec[\s-]*([a-z0-9]+)\b/i;

export function parseMeetRecording(name: string): MeetRecording {
  const original = name.trim();

  const sectionMatch = SECTION.exec(original);
  // "Recording" itself matches nothing here, but "(For Sec D Recording)" would
  // yield "D" — which is right, and is the organiser telling us the section.
  const sectionHint = sectionMatch ? `Sec ${sectionMatch[1]!.toUpperCase()}` : null;

  const dateMatch = DATE_AND_TIME.exec(original);
  let recordedOn: Date | null = null;
  let localTime: string | null = null;

  if (dateMatch) {
    const [, y, m, d, hh, mm] = dateMatch;
    const year = Number(y);
    const month = Number(m);
    const day = Number(d);
    // A DATE, at midday UTC. Not midnight: a date stored at midnight UTC
    // renders as the previous day everywhere west of Greenwich, and Pakistan
    // is east — so the two would disagree about which day a class happened
    // depending on where the reader is. Midday is the same date in every
    // timezone on earth.
    const candidate = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
    // Rejects 2026/13/40 rather than letting Date roll it into next year.
    const valid =
      candidate.getUTCFullYear() === year &&
      candidate.getUTCMonth() === month - 1 &&
      candidate.getUTCDate() === day;
    if (valid) recordedOn = candidate;
    if (hh && mm) localTime = `${hh.padStart(2, "0")}:${mm}`;
  }

  // Everything before the date is the name; if there is no date, drop the
  // trailing "- Recording" and keep the rest.
  let title = dateMatch
    ? original.slice(0, dateMatch.index)
    : original.replace(TRAILING_RECORDING, "");

  for (const [pattern, replacement] of NOISE) title = title.replace(pattern, replacement);

  title = title
    .replace(/[\s-]+$/, "")
    .replace(/^\s*[-–]\s*/, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  return {
    // Never empty. A card headed "" is worse than one headed by the raw
    // filename, which at least tells somebody what to look for in Drive.
    title: title || original.replace(TRAILING_RECORDING, "").trim() || original,
    recordedOn,
    localTime,
    sectionHint,
    // Meet's naming always ends in "Recording" and always carries a date.
    // Both, so a lecture somebody uploaded and called "Recording" is not
    // mistaken for one — and neither is a Meet file with the word stripped.
    isMeetRecording: TRAILING_RECORDING.test(original) && recordedOn !== null,
  };
}

/**
 * The title shown on a card, for anything at all — Meet recording or a file a
 * teacher uploaded by hand.
 *
 * The old behaviour is kept for ordinary filenames: strip the extension, drop
 * a leading date and lecture number, and turn separators into spaces, so
 * "2026-03-14_lecture-04_typography-basics.mp4" reads "Typography basics".
 */
export function titleFromFilename(name: string): string {
  const meet = parseMeetRecording(name);
  if (meet.isMeetRecording) return meet.title;

  const base = name.replace(/\.[a-z0-9]{2,5}$/i, "");
  const cleaned = base
    .replace(/^\s*\d{4}[-_/]\d{1,2}[-_/]\d{1,2}\s*[-_ ]*/, "")
    .replace(/^\s*(lecture|lec|class|session)[-_ ]*\d+\s*[-_ ]*/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();

  if (!cleaned) return base || name;
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}
