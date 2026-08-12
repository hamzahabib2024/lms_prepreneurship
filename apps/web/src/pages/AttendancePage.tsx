import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api } from "../api/client";

/**
 * Attendance register — SRS §5.11, §13.6, UC-15.
 *
 * FR-ATT-007 makes "a full 40-student register in under 60 seconds" an
 * acceptance criterion, and RSK-01 explains why: a teacher who finds this
 * slower than their spreadsheet stops using it, at which point the attendance
 * data is incomplete and every report built on it is worthless.
 *
 * Everything here follows from that budget. Mark-all sets the majority in one
 * action and the teacher touches only the exceptions. The roll is in roll-
 * number order because that is the order a class is called in. The whole grid
 * is keyboard-driven, because reaching for a mouse forty times is the
 * difference between forty seconds and four minutes.
 */

type Status = "PRESENT" | "ABSENT" | "LATE" | "EXCUSED" | "NOT_MARKED";

interface RegisterStudent {
  studentId: string;
  rollNo: number | null;
  registrationNo: string;
  name: string;
  status: Status;
  markingSource: string;
  participationSeconds: number | null;
  markedAt: string | null;
}

interface Register {
  session: {
    id: string;
    title: string;
    scheduledStart: string;
    status: string;
    subject: { code: string; name: string };
    section: { code: string; name: string };
  };
  students: RegisterStudent[];
  summary: Record<string, number>;
  isComplete: boolean;
}

interface SessionRow {
  id: string;
  title: string;
  scheduledStart: string;
  status: string;
  subject: { code: string; name: string };
  section: { code: string; name: string };
}

const STATUSES: Array<{ key: Status; label: string; short: string; hotkey: string }> = [
  { key: "PRESENT", label: "Present", short: "P", hotkey: "p" },
  { key: "ABSENT", label: "Absent", short: "A", hotkey: "a" },
  { key: "LATE", label: "Late", short: "L", hotkey: "l" },
  { key: "EXCUSED", label: "Excused", short: "E", hotkey: "e" },
];

export function AttendancePage() {
  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);

  useEffect(() => {
    // Past sessions matter most here: an unmarked register is work the teacher
    // still owes, and it is what the action queue counts.
    api
      .list<SessionRow>("/live-sessions?days=7&pastDays=30")
      .then((r) => {
        setSessions(r.data);
        if (r.data.length > 0) setSessionId(r.data[0]!.id);
      })
      .catch(() => setSessions([]));
  }, []);

  if (!sessions) return <p className="muted">Loading…</p>;

  if (sessions.length === 0) {
    return (
      <>
        <header className="page-head">
          <h1>Attendance</h1>
        </header>
        <div className="card">
          <p className="muted">
            No classes are scheduled in the next 30 days for the subjects you teach.
          </p>
        </div>
      </>
    );
  }

  return (
    <>
      <header className="page-head">
        <h1>Attendance</h1>
        <label className="field inline-field">
          <span className="visually-hidden">Class</span>
          <select value={sessionId ?? ""} onChange={(e) => setSessionId(e.target.value)}>
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {new Date(s.scheduledStart).toLocaleDateString()} · {s.subject.code} ·{" "}
                {s.section.code} — {s.title}
              </option>
            ))}
          </select>
        </label>
      </header>

      {sessionId && <RegisterGrid key={sessionId} sessionId={sessionId} />}
    </>
  );
}

function RegisterGrid({ sessionId }: { sessionId: string }) {
  const [register, setRegister] = useState<Register | null>(null);
  const [marks, setMarks] = useState<Record<string, Status>>({});
  const [error, setError] = useState<ApiError | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [cursor, setCursor] = useState(0);
  const rowRefs = useRef<Array<HTMLTableRowElement | null>>([]);

  useEffect(() => {
    api
      .get<Register>(`/live-sessions/${sessionId}/attendance`)
      .then((r) => {
        setRegister(r);
        setMarks(Object.fromEntries(r.students.map((s) => [s.studentId, s.status])));
      })
      .catch((e) => setError(e instanceof ApiError ? e : null));
  }, [sessionId]);

  const setOne = useCallback((studentId: string, status: Status) => {
    setMarks((prev) => ({ ...prev, [studentId]: status }));
  }, []);

  /** FR-ATT-004 — the whole point: state the majority once. */
  const markAll = useCallback(
    (status: Status) => {
      if (!register) return;
      setMarks(Object.fromEntries(register.students.map((s) => [s.studentId, status])));
    },
    [register],
  );

  /**
   * FR-ATT-005 — full keyboard operation.
   *
   * P/A/L/E set the current row and advance, so a teacher can call the roll
   * and type without ever looking at the screen. Arrow keys move without
   * marking, for correcting a mistake.
   */
  useEffect(() => {
    if (!register) return;

    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      // Do not hijack typing in a real input.
      if (["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)) return;

      const students = register!.students;
      const status = STATUSES.find((s) => s.hotkey === e.key.toLowerCase());

      if (status) {
        e.preventDefault();
        const student = students[cursor];
        if (student) {
          setOne(student.studentId, status.key);
          setCursor((c) => Math.min(c + 1, students.length - 1));
        }
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setCursor((c) => Math.min(c + 1, students.length - 1));
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setCursor((c) => Math.max(c - 1, 0));
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [register, cursor, setOne]);

  useEffect(() => {
    rowRefs.current[cursor]?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  async function save() {
    if (!register) return;
    setSaving(true);
    setError(null);

    // The API takes a default plus exceptions (FR-ATT-004), so send the most
    // common status as the default and only the rest individually. On a
    // typical day that is one value and three exceptions rather than forty.
    const counts = new Map<Status, number>();
    for (const status of Object.values(marks)) {
      counts.set(status, (counts.get(status) ?? 0) + 1);
    }
    const defaultStatus =
      [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "PRESENT";

    const exceptions = Object.entries(marks)
      .filter(([, status]) => status !== defaultStatus)
      .map(([studentId, status]) => ({ studentId, status }));

    try {
      const result = await api.post<{ summary: Record<string, number>; thresholdWarningsRaised: unknown[] }>(
        `/live-sessions/${sessionId}/attendance`,
        { defaultStatus, exceptions },
      );
      setSavedAt(new Date());
      setRegister((r) => (r ? { ...r, summary: result.summary } : r));
    } catch (e) {
      setError(e instanceof ApiError ? e : null);
    } finally {
      setSaving(false);
    }
  }

  if (error && !register) {
    return (
      <div className="alert alert-error" role="alert">
        <strong>Could not load the register</strong>
        <p>{error.message}</p>
      </div>
    );
  }
  if (!register) return <p className="muted">Loading…</p>;

  const unmarked = register.students.filter((s) => marks[s.studentId] === "NOT_MARKED").length;
  const tally = STATUSES.map((s) => ({
    ...s,
    count: register.students.filter((st) => marks[st.studentId] === s.key).length,
  }));

  return (
    <>
      <div className="card register-head">
        <div>
          <h2>{register.session.title}</h2>
          <p className="muted small">
            {register.session.subject.name} · {register.session.section.code} ·{" "}
            {new Date(register.session.scheduledStart).toLocaleString()}
          </p>
        </div>
        <div className="row-actions">
          <button className="btn" onClick={() => markAll("PRESENT")}>
            Mark all present
          </button>
          <button className="btn" onClick={() => markAll("ABSENT")}>
            Mark all absent
          </button>
        </div>
      </div>

      {/*
        HOW FAR THROUGH THE ROLL. A teacher calling thirty names wants to know
        they are at nineteen without counting the rows they have already done,
        and the bar is readable from across a desk while they are looking at
        the class rather than the screen.
      */}
      <div className="card register-progress">
        <div className="register-progress-head">
          <strong>
            {register.students.length - unmarked} of {register.students.length} marked
          </strong>
          {unmarked === 0 ? (
            <span className="pill pill-ok">Every student marked</span>
          ) : (
            <span className="pill pill-warn">{unmarked} still to go</span>
          )}
        </div>
        <div className="bar">
          <div
            className="bar-fill"
            style={{
              width: `${register.students.length === 0 ? 0 : ((register.students.length - unmarked) / register.students.length) * 100}%`,
            }}
          />
        </div>
      </div>

      {error && (
        <div className="alert alert-error" role="alert">
          <strong>Could not save</strong>
          <p>{error.message}</p>
        </div>
      )}

      <p className="muted small keyboard-hint">
        Keyboard: <kbd>P</kbd> present · <kbd>A</kbd> absent · <kbd>L</kbd> late · <kbd>E</kbd>{" "}
        excused — each marks the highlighted row and moves to the next. <kbd>↑</kbd> <kbd>↓</kbd> move
        without marking.
      </p>

      <div className="table-scroll">
        <table className="table register">
          <thead>
            <tr>
              <th className="num">Roll</th>
              <th>Student</th>
              {STATUSES.map((s) => (
                <th key={s.key} className="center">
                  {s.label}
                </th>
              ))}
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {register.students.map((student, i) => {
              const current = marks[student.studentId] ?? "NOT_MARKED";
              return (
                <tr
                  key={student.studentId}
                  ref={(el) => {
                    rowRefs.current[i] = el;
                  }}
                  className={`${i === cursor ? "is-cursor" : ""} ${current === "NOT_MARKED" ? "is-unmarked" : ""}`}
                  onClick={() => setCursor(i)}
                >
                  <td className="num">{student.rollNo ?? "—"}</td>
                  <td>
                    {student.name}
                    <span className="muted small block">{student.registrationNo}</span>
                  </td>
                  {STATUSES.map((s) => (
                    <td key={s.key} className="center">
                      {/*
                        The status is on the class so a marked cell can be
                        coloured by WHAT it means. Every checked cell was the
                        same indigo, so a register of forty read as a wall of
                        one colour and a teacher scanning for absences had to
                        read the column headings to tell them apart — on the
                        screen they use most, in a hurry, half watching the
                        room. The letter underneath means it is never colour
                        alone (NFR-ACC-007).
                      */}
                      <label className={`radio-cell mark-${s.key.toLowerCase()}`}>
                        <span className="visually-hidden">
                          {s.label} for {student.name}
                        </span>
                        <span className="mark-letter" aria-hidden="true">
                          {s.short}
                        </span>
                        <input
                          type="radio"
                          name={`att-${student.studentId}`}
                          checked={current === s.key}
                          onChange={() => {
                            setOne(student.studentId, s.key);
                            setCursor(i);
                          }}
                        />
                      </label>
                    </td>
                  ))}
                  <td className="muted small">
                    {/* ARC-033 — the SOURCE of the evidence, never a vendor name. */}
                    {student.markingSource === "MANUAL" ? "—" : student.markingSource.toLowerCase()}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="card register-foot">
        <div className="tally">
          {tally.map((t) => (
            // NFR-ACC-007 — the WORD carries the meaning. The colour is a
            // second signal for somebody scanning, never the only one.
            <span key={t.key} className={`tally-item tally-${t.key.toLowerCase()}`}>
              <strong>{t.count}</strong> {t.label.toLowerCase()}
            </span>
          ))}
          {unmarked > 0 && (
            <span className="tally-item tally-unmarked">
              <strong>{unmarked}</strong> not yet marked
            </span>
          )}
        </div>
        <div className="row-actions">
          {savedAt && (
            <span className="muted small">Saved at {savedAt.toLocaleTimeString()}</span>
          )}
          <button className="btn btn-primary" onClick={() => void save()} disabled={saving}>
            {saving ? "Saving…" : "Save register"}
          </button>
        </div>
      </div>
    </>
  );
}
