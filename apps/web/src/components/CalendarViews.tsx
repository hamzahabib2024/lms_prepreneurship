import { useMemo } from "react";

/**
 * MONTH AND WEEK, beside the agenda the timetable already had.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE AGENDA WAS NOT WRONG, WHICH IS WHY IT STAYS. A list of days, each with
 * its classes in time order, is what every calendar worth using falls back to
 * on a phone — a grid below about 360px is too small to be actionable, and
 * this timetable is read on a phone as often as not. It answers "what is next"
 * better than a grid ever does.
 *
 * What it cannot answer is the OTHER question: "how does this month look?"
 * Somebody deciding whether to take on extra work, or spotting that three
 * assessments land in one week, is reading shape rather than detail, and a
 * list of twenty-eight days is not a shape. So the two views are kept and
 * switched between, which is the arrangement every serious calendar has
 * converged on: a compressed month for context, a detailed week or day for
 * planning, and a list for the phone.
 *
 * COLOUR IS BY SUBJECT AND IS NEVER THE ONLY SIGNAL. The subject's name is on
 * every entry in every view. Colour makes a pattern visible at a glance —
 * three of the same colour in one week — and a reader who cannot distinguish
 * them loses the glance, not the information (NFR-ACC-007).
 *
 * OVERFLOW IS COUNTED, NOT HIDDEN. A month cell shows what fits and says how
 * many more there are, because a cell that silently truncates is a cell that
 * lies about a day.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export interface CalEntry {
  id: string;
  title: string;
  subject: string;
  section: string;
  teacher: string | null;
  scheduledStart: string;
  scheduledEnd: string;
  status: string;
}

export interface CalDay {
  date: string;
  entries: CalEntry[];
}

const HHMM = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

const iso = (d: Date) => d.toISOString().slice(0, 10);

const isToday = (date: string) => date === iso(new Date());

/**
 * A stable colour per subject, derived from its name.
 *
 * NOT random and not assigned in order: the same subject must be the same
 * colour every time the page loads, or the pattern a reader learned last week
 * is noise this week. Six hues, far enough apart to tell apart, and the
 * lightness is fixed so every one of them carries dark text legibly.
 */
export function subjectHue(subject: string): number {
  let h = 0;
  for (let i = 0; i < subject.length; i++) h = (h * 31 + subject.charCodeAt(i)) % 360;
  // Six bands rather than 360, so two subjects are either clearly the same
  // colour or clearly different — never almost the same, which is worse.
  return Math.round(h / 60) * 60;
}

const chipStyle = (subject: string) => ({
  "--chip-hue": String(subjectHue(subject)),
}) as React.CSSProperties;

// ══════════════════════════════════════════════════════════════ month ══════

/**
 * A whole month, six rows of seven, Monday first.
 *
 * SIX ROWS ALWAYS, even when five would do. A grid that changes height as you
 * page through the year makes everything below it jump, and the eye loses the
 * cell it was looking at.
 */
export function MonthView({
  anchor,
  days,
  onPickDay,
}: {
  /** Any date inside the month to show. */
  anchor: Date;
  days: CalDay[];
  onPickDay: (date: string) => void;
}) {
  const byDate = useMemo(() => new Map(days.map((d) => [d.date, d.entries])), [days]);

  const cells = useMemo(() => {
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    // Monday-first: getDay() is 0 for Sunday, so shift it.
    const lead = (first.getDay() + 6) % 7;
    const start = new Date(first);
    start.setDate(first.getDate() - lead);
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [anchor]);

  const month = anchor.getMonth();

  return (
    <div className="cal-month" role="grid" aria-label="Month">
      {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
        <div key={d} className="cal-weekday" role="columnheader">
          {d}
        </div>
      ))}

      {cells.map((d) => {
        const key = iso(d);
        const entries = byDate.get(key) ?? [];
        // Two fit; the rest are counted. A cell that truncates silently lies
        // about how busy a day is.
        const shown = entries.slice(0, 2);
        const more = entries.length - shown.length;

        const classes = [
          "cal-cell",
          d.getMonth() === month ? "" : "cal-outside",
          isToday(key) ? "is-today" : "",
        ]
          .filter(Boolean)
          .join(" ");

        return (
          <button
            type="button"
            key={key}
            className={classes}
            role="gridcell"
            onClick={() => onPickDay(key)}
            aria-label={`${d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}, ${entries.length} ${entries.length === 1 ? "class" : "classes"}`}
          >
            <span className="cal-date">{d.getDate()}</span>
            {shown.map((e) => (
              <span key={e.id} className="cal-chip" style={chipStyle(e.subject)}>
                <span className="cal-chip-time">{HHMM(e.scheduledStart)}</span>
                {e.subject}
              </span>
            ))}
            {more > 0 && <span className="cal-more">+{more} more</span>}
          </button>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════ week ══════

/**
 * Seven days side by side, each a column of its classes in time order.
 *
 * DELIBERATELY NOT AN HOUR GRID. A true time grid — 24 rows, events positioned
 * and sized by duration — is what a calendar full of half-hour meetings needs.
 * A teaching timetable is three or four blocks a day at the same times every
 * week, and rendering it against 24 hourly rows means a screen that is
 * nine-tenths empty ruled lines. The columns carry the time on each entry,
 * which is the fact anybody actually reads off it.
 */
export function WeekView({
  anchor,
  days,
  onPickDay,
}: {
  /**
   * Any date inside the week to draw.
   *
   * THE WEEK IS DERIVED FROM THIS, NOT FROM THE DATA, and that is the fix for
   * a week with no classes in it rendering as nothing at all. The API returns
   * only days that HAVE entries, so a free week came back empty and the view
   * had no first date to anchor on — an empty screen, which reads as a
   * failure rather than as a quiet week.
   */
  anchor: Date;
  days: CalDay[];
  onPickDay: (date: string) => void;
}) {
  const byDate = useMemo(() => new Map(days.map((d) => [d.date, d.entries])), [days]);

  const columns = useMemo(() => {
    const lead = (anchor.getDay() + 6) % 7;
    const start = new Date(anchor);
    start.setDate(anchor.getDate() - lead);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [anchor]);

  return (
    <div className="cal-week">
      {columns.map((d) => {
        const key = iso(d);
        const entries = byDate.get(key) ?? [];
        return (
          <div key={key} className={`cal-col${isToday(key) ? " is-today" : ""}`}>
            <button type="button" className="cal-col-head" onClick={() => onPickDay(key)}>
              <span className="cal-col-day">
                {d.toLocaleDateString(undefined, { weekday: "short" })}
              </span>
              <span className="cal-col-date">{d.getDate()}</span>
            </button>
            <div className="cal-col-body">
              {entries.length === 0 ? (
                <span className="cal-free">—</span>
              ) : (
                entries.map((e) => (
                  <div key={e.id} className="cal-event" style={chipStyle(e.subject)}>
                    <strong>{HHMM(e.scheduledStart)}</strong>
                    <span className="cal-event-subject">{e.subject}</span>
                    <span className="muted small">{e.section}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
