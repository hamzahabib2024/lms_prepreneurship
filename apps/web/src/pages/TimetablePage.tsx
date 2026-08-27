import { useCallback, useEffect, useMemo, useState } from "react";
import { Skeleton } from "../components/Ui";
import { MonthView, WeekView } from "../components/CalendarViews";
import { HowItWorks } from "../components/HowItWorks";
import { Icon } from "../components/Icon";
import { ApiError, api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Field } from "../components/Field";

/**
 * The timetable — SRS §13.12, FR-LIV-030..036.
 *
 * THE NEXT CLASS IS THE POINT OF THE PAGE. Almost everybody who opens a
 * timetable wants one fact: what is next, and when. It is stated once at the
 * top, in words, before any grid — a student who has to read a week to find
 * Tuesday has been given a document rather than an answer.
 *
 * Days are listed rather than laid out as a grid. A grid needs a week to be
 * legible and this is read on a phone as often as not; a list of days, each
 * with its classes in time order, degrades to a narrow screen without losing
 * anything.
 *
 * Whose timetable it is comes from the token, not from a parameter, so the
 * page cannot be pointed at somebody else's.
 */

interface Entry {
  id: string;
  title: string;
  subject: string;
  section: string;
  teacher: string | null;
  scheduledStart: string;
  scheduledEnd: string;
  status: string;
}

interface Day {
  date: string;
  entries: Entry[];
}

interface Timetable {
  from: string;
  to: string;
  days: Day[];
  nextClass: Entry | null;
  message: string | null;
}

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

const dayName = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

/** "in 2 hours", "tomorrow at 09:00" — the form somebody actually wants. */
function whenNext(iso: string): string {
  const start = new Date(iso).getTime();
  const minutes = Math.round((start - Date.now()) / 60_000);
  if (minutes < 0) return "now";
  if (minutes < 60) return `in ${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `in ${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.round(hours / 24);
  return days === 1 ? "tomorrow" : `in ${days} days`;
}

export function TimetablePage() {
  const { hasRole } = useAuth();
  const canGenerate = hasRole("super_admin", "admin", "teacher");
  const [timetable, setTimetable] = useState<Timetable | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * WHICH SHAPE OF THE SAME WEEK — agenda, week or month.
   *
   * The agenda is the default and stays the default. It answers "what is
   * next", which is what almost everybody opens a timetable for, and it is the
   * only one of the three that is genuinely usable on a phone. Month is for
   * the other question — how does this look — which a list of twenty-eight
   * days cannot answer.
   *
   * Remembered, because somebody who prefers the month view prefers it every
   * time, and making them choose again each visit is a small daily tax.
   */
  const [view, setView] = useState<"agenda" | "week" | "month">(() => {
    try {
      const saved = window.localStorage.getItem("lms.timetable.view");
      return saved === "week" || saved === "month" ? saved : "agenda";
    } catch {
      return "agenda";
    }
  });

  /**
   * The period being looked at, as a date inside it. Not a range: a range has
   * to be recomputed on every move and the two ends drift apart. One anchor
   * plus the view decides both ends, every time, the same way.
   */
  const [anchor, setAnchor] = useState(() => new Date());

  const range = useMemo(() => {
    const start = new Date(anchor);
    const end = new Date(anchor);
    if (view === "month") {
      start.setDate(1);
      // The grid shows the days either side of the month, so the data has to
      // cover them or those cells lie about being empty.
      start.setDate(start.getDate() - 7);
      end.setMonth(end.getMonth() + 1, 0);
      end.setDate(end.getDate() + 7);
    } else if (view === "week") {
      const lead = (start.getDay() + 6) % 7;
      start.setDate(start.getDate() - lead);
      end.setTime(start.getTime());
      end.setDate(start.getDate() + 6);
    } else {
      // Agenda looks FORWARD from today rather than at a calendar period:
      // "the next fortnight" is what somebody scanning a list wants, and a
      // list that starts on Monday of a week half gone is mostly history.
      end.setDate(end.getDate() + 14);
    }
    return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
  }, [anchor, view]);

  const load = useCallback(() => {
    api
      .get<Timetable>(`/timetable/me?from=${range.from}&to=${range.to}`)
      .then(setTimetable)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load the timetable."));
  }, [range.from, range.to]);

  useEffect(load, [load]);

  const chooseView = (next: "agenda" | "week" | "month") => {
    setView(next);
    /*
     * LET GO OF THE RADIO.
     *
     * A radio group owns the arrow keys — that is correct and expected, and it
     * is also the opposite of what the hint under the heading promises, which
     * is that the arrows page through the calendar. While the switcher keeps
     * focus they change the VIEW instead, so somebody follows the instruction
     * and watches the screen do something else. Releasing focus after the
     * choice makes the promise true; a keyboard user can still tab back to the
     * switcher and use the arrows there in the ordinary way.
     */
    (document.activeElement as HTMLElement | null)?.blur?.();
    try {
      window.localStorage.setItem("lms.timetable.view", next);
    } catch {
      // The choice still holds for this visit; only the memory is lost.
    }
  };

  const move = useCallback(
    (direction: -1 | 1) => {
      setAnchor((current) => {
        const d = new Date(current);
        if (view === "month") d.setMonth(d.getMonth() + direction);
        else d.setDate(d.getDate() + direction * (view === "week" ? 7 : 14));
        return d;
      });
    },
    [view],
  );

  /*
   * KEYBOARD, because a calendar is paged through repeatedly. Bound only when
   * nothing is being typed into — a shortcut that fires inside the class-title
   * box of the generate panel would page the calendar mid-word.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "ArrowLeft") move(-1);
      else if (e.key === "ArrowRight") move(1);
      else if (e.key === "t" || e.key === "T") setAnchor(new Date());
      else if (e.key === "m" || e.key === "M") chooseView("month");
      else if (e.key === "w" || e.key === "W") chooseView("week");
      else if (e.key === "a" || e.key === "A") chooseView("agenda");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [move]);

  const periodLabel =
    view === "month"
      ? anchor.toLocaleDateString(undefined, { month: "long", year: "numeric" })
      : view === "week"
        ? `Week of ${new Date(range.from).toLocaleDateString(undefined, { day: "numeric", month: "long" })}`
        : "The next fortnight";

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Timetable</h1>
          <p className="muted small">Your classes. Times are local.</p>
        </div>
        <div className="row-actions cal-controls">
          <button type="button" className="btn btn-sm" onClick={() => move(-1)} aria-label="Previous">
            <Icon name="chevron-left" />
          </button>
          <button type="button" className="btn btn-sm" onClick={() => setAnchor(new Date())}>
            Today
          </button>
          <button type="button" className="btn btn-sm" onClick={() => move(1)} aria-label="Next">
            <Icon name="chevron-right" />
          </button>

          {/* Three shapes of the same information. A radio group, so a screen
              reader announces one choice of three. */}
          <fieldset className="cal-views">
            <legend className="visually-hidden">How to show the timetable</legend>
            {(["agenda", "week", "month"] as const).map((v) => (
              <label key={v} className={view === v ? "cal-view is-on" : "cal-view"}>
                <input
                  type="radio"
                  name="cal-view"
                  checked={view === v}
                  onChange={() => chooseView(v)}
                />
                {v === "agenda" ? "List" : v === "week" ? "Week" : "Month"}
              </label>
            ))}
          </fieldset>
        </div>
      </header>

      <p className="muted small cal-period">
        {periodLabel} · arrow keys move, T for today
      </p>

      <HowItWorks
        id="timetable"
        title="Reading your timetable"
        intro="Three shapes of the same information. Start with whichever answers your question."
        steps={[
          { icon: "clock", title: "What is next", body: "Stated at the top in words, before any grid. Most people came for this one fact." },
          { icon: "calendar", title: "List, week or month", body: "The list is best on a phone. The month shows the shape of a period — three assessments in one week, for instance." },
          { icon: "chevron-right", title: "Move around", body: "The arrows page back and forth, Today returns. The arrow keys and T do the same." },
          { icon: "play", title: "Join a class", body: "For an online class a Join button appears shortly before it starts." },
        ]}
        note="Times are shown in your own timezone, not the Institute's. If a class looks an hour out, check your device clock before reporting it."
      />

      {error && (
        <div className="alert alert-error" role="alert">
          <p>{error}</p>
        </div>
      )}

      {/* The one fact most people came for, before anything else. */}
      {timetable?.nextClass && (
        <section className="card">
          <h2>
            Next: {timetable.nextClass.subject} — {whenNext(timetable.nextClass.scheduledStart)}
          </h2>
          <p className="muted small">
            {dayName(timetable.nextClass.scheduledStart.slice(0, 10))} at{" "}
            {time(timetable.nextClass.scheduledStart)}
            {timetable.nextClass.teacher ? ` · ${timetable.nextClass.teacher}` : ""}
            {timetable.nextClass.section ? ` · ${timetable.nextClass.section}` : ""}
          </p>
        </section>
      )}

      {canGenerate && <GeneratePanel onGenerated={load} />}

      {/*
        THE EMPTY CASE IS PER VIEW, and it used to be checked before them.
        That meant a free week rendered as a sentence instead of a calendar:
        the grid never got the chance to draw, so paging into a quiet week
        looked like the page had lost its timetable.
        A LIST with nothing in it is genuinely nothing to show, so it still
        says so in words. A GRID with nothing in it is the answer — an empty
        month IS the shape of that month — so it draws, with the sentence
        above it.
      */}
      {!timetable ? (
        <Skeleton lines={2} />
      ) : timetable.days.length === 0 && view === "agenda" ? (
        <div className="card">
          {/* In words. An empty page is ambiguous between "no classes" and
              "something failed". */}
          <p>{timetable.message ?? "No classes scheduled in this period."}</p>
        </div>
      ) : view === "month" ? (
        <section className="card cal-card">
          {timetable.days.length === 0 && (
            <p className="muted small">No classes scheduled in this month.</p>
          )}
          <MonthView
            anchor={anchor}
            days={timetable.days}
            /* Choosing a day drops into the list for it — the month answers
               "how does this look", and the moment somebody wants detail they
               want the view that carries detail. */
            onPickDay={(date) => {
              setAnchor(new Date(`${date}T12:00:00`));
              chooseView("agenda");
            }}
          />
        </section>
      ) : view === "week" ? (
        <section className="card cal-card">
          {timetable.days.length === 0 && (
            <p className="muted small">No classes scheduled in this week.</p>
          )}
          <WeekView
            anchor={anchor}
            days={timetable.days}
            onPickDay={(date) => {
              setAnchor(new Date(`${date}T12:00:00`));
              chooseView("agenda");
            }}
          />
        </section>
      ) : (
        timetable.days.map((d) => (
          <section className="card" key={d.date}>
            <h2>{dayName(d.date)}</h2>
            <ul className="list">
              {d.entries.map((e) => (
                <li key={e.id}>
                  <span>
                    <strong>
                      {time(e.scheduledStart)}–{time(e.scheduledEnd)}
                    </strong>{" "}
                    {e.subject}
                    <br />
                    <span className="muted small">
                      {e.title}
                      {e.teacher ? ` · ${e.teacher}` : ""}
                      {e.section ? ` · ${e.section}` : ""}
                    </span>
                  </span>
                  {/* LIVE is worth saying as a word: it means join now. */}
                  {e.status === "LIVE" && <span className="pill">Live now</span>}
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </>
  );
}

const DAYS = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 0, label: "Sun" },
];

interface Preview {
  count: number;
  message: string;
  occurrences: Array<{ scheduledStart: string; scheduledEnd: string }>;
}

interface GenerateReport {
  total: number;
  succeeded: number;
  failed: number;
  summary: string;
  rows: Array<{ studentId: string; name?: string; outcome: string; message?: string }>;
}

/**
 * FR-LIV-031/032 — describe a term once.
 *
 * PREVIEW BEFORE GENERATE, and the generate button is unreachable until the
 * pattern has been checked. Creating thirty classes is not all-or-nothing: a
 * clash produces twenty-nine and a line about the thirtieth, and looking first
 * is how somebody avoids reconciling two lists afterwards.
 */
function GeneratePanel({ onGenerated }: { onGenerated: () => void }) {
  const [open, setOpen] = useState(false);
  const [offerings, setOfferings] = useState<
    Array<{ id: string; label: string; hostTeacherId: string | null }>
  >([]);
  const [form, setForm] = useState({
    sectionSubjectId: "",
    days: [1, 3] as number[],
    startTime: "09:00",
    endTime: "11:00",
    fromDate: "",
    toDate: "",
  });
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<GenerateReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    void (async () => {
      try {
        const sections = await api.get<Array<{ id: string; code: string }>>("/sections");
        const found: Array<{ id: string; label: string; hostTeacherId: string | null }> = [];
        for (const s of sections) {
          const subs = await api.get<
            Array<{ id: string; subject: { code: string; name: string }; hasTeacher?: boolean }>
          >(`/sections/${s.id}/subjects`);
          for (const o of subs) {
            found.push({
              id: o.id,
              label: `${s.code} — ${o.subject.code} ${o.subject.name}`,
              hostTeacherId: null,
            });
          }
        }
        setOfferings(found);
      } catch {
        setOfferings([]);
      }
    })();
  }, [open]);

  const run = async (path: string, then: (r: never) => void) => {
    setBusy(true);
    setError(null);
    try {
      const teachers = await api.get<Array<{ teacherId?: string; id?: string }>>(
        "/teachers/workload",
      );
      const hostTeacherId = teachers[0]?.teacherId ?? teachers[0]?.id;
      then(
        (await api.post(path, {
          ...form,
          hostTeacherId,
          fromDate: new Date(form.fromDate).toISOString(),
          toDate: new Date(form.toDate).toISOString(),
        })) as never,
      );
    } catch (e) {
      // The server's sentences: "Choose at least one day of the week", "That
      // would create 300 classes." They say what to do; a generic message does
      // not.
      setError(
        e instanceof ApiError
          ? (e.details?.map((d) => d.message).join(" ") ?? e.message)
          : "That did not work.",
      );
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <section className="card">
        <button className="btn btn-primary" onClick={() => setOpen(true)}>
          Set up a term's classes
        </button>
      </section>
    );
  }

  const ready = form.sectionSubjectId && form.fromDate && form.toDate && form.days.length > 0;

  return (
    <section className="card">
      <div className="modal-head">
        <h2>Set up a term's classes</h2>
        <button className="btn btn-quiet" onClick={() => setOpen(false)}>
          Close
        </button>
      </div>

      {error && (
        <div className="alert alert-error" role="alert">
          <p>{error}</p>
        </div>
      )}

      <Field label="Which class" required><select
          value={form.sectionSubjectId}
          onChange={(e) => {
            setForm({ ...form, sectionSubjectId: e.target.value });
            setPreview(null);
          }}
        >
          <option value="">Choose…</option>
          {offerings.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </Field>

      <fieldset className="field">
        <legend>Which days</legend>
        <span className="row-actions">
          {DAYS.map((d) => (
            <label key={d.value} className="inline-field">
              <input
                type="checkbox"
                checked={form.days.includes(d.value)}
                onChange={(e) => {
                  const days = e.target.checked
                    ? [...form.days, d.value]
                    : form.days.filter((x) => x !== d.value);
                  setForm({ ...form, days });
                  setPreview(null);
                }}
              />
              <span>{d.label}</span>
            </label>
          ))}
        </span>
      </fieldset>

      <div className="field-row">
        <label className="field">
          <span>From</span><input
            type="time"
            value={form.startTime}
            onChange={(e) => {
              setForm({ ...form, startTime: e.target.value });
              setPreview(null);
            }}
          />
        
        </label>
        <label className="field">
          <span>To</span><input
            type="time"
            value={form.endTime}
            onChange={(e) => {
              setForm({ ...form, endTime: e.target.value });
              setPreview(null);
            }}
          />
        
        </label>
        <Field label="Term starts" required><input
            type="date"
            value={form.fromDate}
            onChange={(e) => {
              setForm({ ...form, fromDate: e.target.value });
              setPreview(null);
            }}
          />
        </Field>
        <Field label="Term ends" required><input
            type="date"
            value={form.toDate}
            onChange={(e) => {
              setForm({ ...form, toDate: e.target.value });
              setPreview(null);
            }}
          />
        </Field>
      </div>

      <span className="row-actions">
        <button
          className="btn btn-primary"
          disabled={busy || !ready}
          onClick={() =>
            void run("/timetable/preview", (r) => {
              setPreview(r as unknown as Preview);
              setResult(null);
            })
          }
        >
          {busy ? "Checking…" : "Check what this would create"}
        </button>
        <button
          className="btn btn-quiet"
          disabled={busy || !preview || preview.count === 0}
          onClick={() =>
            void run("/timetable/generate", (r) => {
              setResult(r as unknown as GenerateReport);
              setPreview(null);
              onGenerated();
            })
          }
        >
          Create {preview?.count ?? ""} classes
        </button>
      </span>

      {preview && (
        <p className="muted small">
          {preview.message}
          {preview.count > 0 &&
            ` First on ${dayName(preview.occurrences[0]?.scheduledStart.slice(0, 10) ?? "")}.`}
        </p>
      )}

      {result && (
        <div className={result.failed > 0 ? "alert alert-warn" : "alert"}>
          {/* The server's own sentence, which says whether it was all of them. */}
          <p>
            <strong>{result.summary}</strong>
          </p>
          {result.failed > 0 && (
            <ul className="list small">
              {result.rows
                .filter((r) => r.outcome === "FAILED")
                .map((r) => (
                  <li key={r.studentId}>
                    <span>
                      {r.name} — {r.message}
                    </span>
                  </li>
                ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
