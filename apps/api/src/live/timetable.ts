/**
 * The timetable — SRS §5.13, FR-LIV-030..036.
 *
 * "Graphic Designing runs Monday and Wednesday, 09:00 to 11:00, for the term."
 * Thirty classes, described once.
 *
 * THE TIMETABLE IS THE SESSIONS. There is no separate recurrence table, and
 * that is a decision rather than an omission: a stored pattern and the sessions
 * generated from it are two records of the same fact, and they diverge the
 * first time somebody moves a single class. What a student needs to know is
 * when their next class is, and that is a session.
 *
 * So this module does one thing — turn a weekly pattern into dated occurrences
 * — and the service feeds each one through the ORDINARY scheduling path, so the
 * teacher-clash rule applies to every generated class exactly as it would to
 * one created by hand. A generator that wrote rows directly would be the
 * fastest way to double-book a teacher thirty times.
 *
 * TIMES ARE LOCAL TO THE INSTITUTE. "09:00" means nine in the morning where the
 * students are, and is converted with a fixed offset because Pakistan does not
 * observe daylight saving. An institute that does would need a real timezone
 * database, and this would be the wrong function.
 */

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface WeeklyPattern {
  /** 0 = Sunday, matching Date.getUTCDay(). */
  days: Weekday[];
  /** Local wall-clock, "HH:mm". */
  startTime: string;
  endTime: string;
  /** Inclusive, as local dates. */
  fromDate: Date;
  toDate: Date;
  /** Dates to skip: holidays, an exam week. Compared by calendar day. */
  exclusions?: Date[];
  /** Minutes east of UTC. Pakistan is +05:00, so 300. */
  offsetMinutes: number;
}

export interface Occurrence {
  scheduledStart: Date;
  scheduledEnd: Date;
}

export interface PatternProblem {
  code:
    | "NO_DAYS"
    | "BAD_TIME"
    | "END_BEFORE_START"
    | "RANGE_INVERTED"
    | "RANGE_TOO_LONG"
    | "TOO_MANY";
  message: string;
}

/** A year of twice-weekly classes is 104; beyond that it is not a term. */
export const MAX_OCCURRENCES = 200;
const MAX_RANGE_DAYS = 400;

export function validatePattern(p: WeeklyPattern): PatternProblem | null {
  if (p.days.length === 0) {
    return { code: "NO_DAYS", message: "Choose at least one day of the week." };
  }

  const start = parseTime(p.startTime);
  const end = parseTime(p.endTime);
  if (start === null || end === null) {
    return { code: "BAD_TIME", message: "Times must look like 09:00." };
  }
  if (end <= start) {
    // A class ending before it starts is a typo; one ending exactly when it
    // starts is a class of no length. Neither is a timetable entry.
    return {
      code: "END_BEFORE_START",
      message: "The class must end after it starts.",
    };
  }

  if (p.toDate < p.fromDate) {
    return { code: "RANGE_INVERTED", message: "The last date is before the first." };
  }
  const days = Math.round((p.toDate.getTime() - p.fromDate.getTime()) / 86_400_000);
  if (days > MAX_RANGE_DAYS) {
    return {
      code: "RANGE_TOO_LONG",
      message: `${days} days is longer than a year. Generate one term at a time.`,
    };
  }

  const count = expand(p).length;
  if (count > MAX_OCCURRENCES) {
    return {
      code: "TOO_MANY",
      message: `That would create ${count} classes. Generate one term at a time.`,
    };
  }

  return null;
}

/**
 * FR-LIV-031 — the dated classes a pattern describes.
 *
 * Walks calendar days rather than adding seven days repeatedly: adding 7×24
 * hours drifts across a daylight-saving boundary, and although this institute
 * has none, a function that is only correct in one country is a trap for
 * whoever reuses it.
 */
export function expand(p: WeeklyPattern): Occurrence[] {
  const start = parseTime(p.startTime);
  const end = parseTime(p.endTime);
  if (start === null || end === null || p.days.length === 0) return [];

  const wanted = new Set<number>(p.days);
  const skip = new Set((p.exclusions ?? []).map(dayKey));
  const out: Occurrence[] = [];

  const cursor = new Date(
    Date.UTC(p.fromDate.getUTCFullYear(), p.fromDate.getUTCMonth(), p.fromDate.getUTCDate()),
  );
  const last = Date.UTC(p.toDate.getUTCFullYear(), p.toDate.getUTCMonth(), p.toDate.getUTCDate());

  while (cursor.getTime() <= last) {
    if (wanted.has(cursor.getUTCDay()) && !skip.has(dayKey(cursor))) {
      // The local wall-clock time, converted to the instant it names.
      const base = cursor.getTime() - p.offsetMinutes * 60_000;
      out.push({
        scheduledStart: new Date(base + start * 60_000),
        scheduledEnd: new Date(base + end * 60_000),
      });
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (out.length > MAX_OCCURRENCES) break;
  }

  return out;
}

/** Occurrences that have not already happened. */
export function upcoming(occurrences: Occurrence[], now: Date): Occurrence[] {
  return occurrences.filter((o) => o.scheduledEnd > now);
}

export interface DayGroup {
  /** The local calendar date, as YYYY-MM-DD. */
  date: string;
  entries: Array<{
    id: string;
    title: string;
    subject: string;
    section: string;
    teacher: string | null;
    scheduledStart: Date;
    scheduledEnd: Date;
    status: string;
  }>;
}

/**
 * FR-LIV-034 — sessions grouped into the days a person recognises.
 *
 * Grouped by LOCAL date, not UTC. A class at 09:00 in Karachi is 04:00 UTC the
 * same morning, but an evening class at 23:30 local is 18:30 UTC — and one at
 * 02:00 local would be the previous UTC day. Grouping by UTC would file
 * somebody's Tuesday evening class under Wednesday.
 */
export function groupByDay(
  entries: DayGroup["entries"],
  offsetMinutes: number,
): DayGroup[] {
  const byDate = new Map<string, DayGroup["entries"]>();

  for (const e of entries) {
    const local = new Date(e.scheduledStart.getTime() + offsetMinutes * 60_000);
    const date = local.toISOString().slice(0, 10);
    const list = byDate.get(date) ?? [];
    list.push(e);
    byDate.set(date, list);
  }

  return [...byDate.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, list]) => ({
      date,
      entries: [...list].sort(
        (a, b) => a.scheduledStart.getTime() - b.scheduledStart.getTime(),
      ),
    }));
}

/** "09:00" -> minutes past local midnight, or null. */
function parseTime(value: string): number | null {
  const match = /^([0-9]{1,2}):([0-9]{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function dayKey(d: Date): string {
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
}
