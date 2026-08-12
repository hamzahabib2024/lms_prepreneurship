import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "../api/client";
import { useAuth } from "../auth/AuthContext";

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
  const [weeks, setWeeks] = useState(2);

  const load = useCallback(() => {
    const from = new Date().toISOString().slice(0, 10);
    const to = new Date(Date.now() + weeks * 7 * 86_400_000).toISOString().slice(0, 10);
    api
      .get<Timetable>(`/timetable/me?from=${from}&to=${to}`)
      .then(setTimetable)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load the timetable."));
  }, [weeks]);

  useEffect(load, [load]);

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Timetable</h1>
          <p className="muted small">Your classes. Times are local.</p>
        </div>
        <span className="row-actions">
          {[1, 2, 4].map((w) => (
            <button
              key={w}
              className={weeks === w ? "btn btn-primary" : "btn btn-quiet"}
              onClick={() => setWeeks(w)}
            >
              {w} week{w === 1 ? "" : "s"}
            </button>
          ))}
        </span>
      </header>

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

      {!timetable ? (
        <p className="muted">Loading…</p>
      ) : timetable.days.length === 0 ? (
        <div className="card">
          {/* In words. An empty page is ambiguous between "no classes" and
              "something failed". */}
          <p>{timetable.message ?? "No classes scheduled in this period."}</p>
        </div>
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

      <label className="field">
        <span>Which class</span>
        <select
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
      </label>

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
          <span>From</span>
          <input
            type="time"
            value={form.startTime}
            onChange={(e) => {
              setForm({ ...form, startTime: e.target.value });
              setPreview(null);
            }}
          />
        </label>
        <label className="field">
          <span>To</span>
          <input
            type="time"
            value={form.endTime}
            onChange={(e) => {
              setForm({ ...form, endTime: e.target.value });
              setPreview(null);
            }}
          />
        </label>
        <label className="field">
          <span>Term starts</span>
          <input
            type="date"
            value={form.fromDate}
            onChange={(e) => {
              setForm({ ...form, fromDate: e.target.value });
              setPreview(null);
            }}
          />
        </label>
        <label className="field">
          <span>Term ends</span>
          <input
            type="date"
            value={form.toDate}
            onChange={(e) => {
              setForm({ ...form, toDate: e.target.value });
              setPreview(null);
            }}
          />
        </label>
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
