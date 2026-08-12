import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiError, api, tokens } from "../api/client";
import { StudentNotes } from "../components/StudentNotes";

/**
 * Grading — SRS §13.6, FR-ASG-025/026/028, FR-TCH-019.
 *
 * Ordered so the work that needs doing comes first: unmarked submissions, then
 * marked ones, then students who have not submitted. A roll-number ordering
 * buries the twelve submissions a teacher must get through among the
 * twenty-eight they have already dealt with.
 *
 * The teacher enters the RAW mark only. BR-ASG-03 has the System compute the
 * late penalty, because a teacher deducting by hand produces a figure nobody
 * can reproduce and nobody can defend if the student challenges it. What the
 * penalty will be is shown before they save.
 */

interface RosterStudent {
  studentId: string;
  rollNo: number | null;
  name: string;
  submissionId: string | null;
  submitted: boolean;
  submittedAt: string | null;
  isLate: boolean;
  minutesLate: number;
  version: number;
  textResponse: string | null;
  files: Array<{ id: string; filename: string }>;
  graded: boolean;
  rawMarks: number | null;
  penaltyApplied: number | null;
  finalMarks: number | null;
  feedback: string | null;
  internalNotes: string | null;
  releasedAt: string | null;
}

interface Roster {
  assignment: {
    id: string;
    title: string;
    /** The class this marking belongs to — a staff note is anchored to it. */
    sectionSubjectId: string;
    marksAvailable: number;
    gradesReleased: boolean;
    dueAt: string;
    latePolicy: string;
  };
  summary: {
    enrolled: number;
    submitted: number;
    notSubmitted: number;
    late: number;
    graded: number;
    ungraded: number;
  };
  students: RosterStudent[];
}

export function GradingPage() {
  const { assignmentId = "" } = useParams();
  const [roster, setRoster] = useState<Roster | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [releasing, setReleasing] = useState(false);

  const load = useCallback(() => {
    api
      .get<Roster>(`/assignments/${assignmentId}/submissions`)
      .then(setRoster)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load submissions."));
  }, [assignmentId]);

  useEffect(load, [load]);

  const release = async () => {
    setReleasing(true);
    setError(null);
    try {
      await api.post(`/assignments/${assignmentId}/release-grades`);
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Grades could not be released.");
    } finally {
      setReleasing(false);
    }
  };

  if (error && !roster) {
    return (
      <div className="alert alert-error">
        <strong>Could not load this assignment</strong>
        <p>{error}</p>
      </div>
    );
  }
  if (!roster) return <p className="muted">Loading…</p>;

  const { assignment: a, summary } = roster;

  // Unmarked work first — that is the queue. Then marked, then absentees.
  const ordered = [...roster.students].sort((x, y) => {
    const rank = (s: RosterStudent) => (s.submitted && !s.graded ? 0 : s.submitted ? 1 : 2);
    return rank(x) - rank(y) || (x.rollNo ?? 9999) - (y.rollNo ?? 9999);
  });

  return (
    <>
      <header className="page-head">
        <div>
          <h1>{a.title}</h1>
          <p className="muted small">
            Out of {a.marksAvailable} · due {new Date(a.dueAt).toLocaleDateString()}
          </p>
        </div>
        <Link className="btn btn-quiet" to="/attendance">
          Back
        </Link>
      </header>

      <section className="card">
        <ul className="list">
          <li>
            <span>Submitted</span>
            <strong>
              {summary.submitted} of {summary.enrolled}
            </strong>
          </li>
          <li className={summary.ungraded > 0 ? "warn" : ""}>
            <span>Still to mark</span>
            <strong>{summary.ungraded}</strong>
          </li>
          <li>
            <span>Late</span>
            <strong>{summary.late}</strong>
          </li>
        </ul>

        {error && (
          <div className="alert alert-error">
            <p>{error}</p>
          </div>
        )}

        {a.gradesReleased ? (
          <p className="small">✓ Grades have been released to students.</p>
        ) : (
          <>
            <button
              className="btn btn-primary"
              onClick={() => void release()}
              disabled={releasing || summary.graded === 0}
            >
              {releasing ? "Releasing…" : `Release ${summary.graded} grades`}
            </button>
            {/* FR-ASG-028 — the cohort is released together so nobody learns
                their mark before their classmates. Saying so removes the
                temptation to release early "just for one student". */}
            <p className="muted small">
              Students see nothing until you release. The whole class is released at
              once.
              {summary.ungraded > 0 &&
                ` ${summary.ungraded} submission${summary.ungraded === 1 ? " is" : "s are"} still unmarked.`}
            </p>
          </>
        )}
      </section>

      <section className="card">
        <h2>Students</h2>
        <ul className="list">
          {ordered.map((s) => (
            <StudentRow
              key={s.studentId}
              student={s}
              marksAvailable={a.marksAvailable}
              sectionSubjectId={a.sectionSubjectId}
              expanded={openId === s.studentId}
              onToggle={() => setOpenId(openId === s.studentId ? null : s.studentId)}
              onGraded={load}
            />
          ))}
        </ul>
      </section>
    </>
  );
}

function StudentRow({
  student: s,
  marksAvailable,
  sectionSubjectId,
  expanded,
  onToggle,
  onGraded,
}: {
  student: RosterStudent;
  marksAvailable: number;
  sectionSubjectId: string;
  expanded: boolean;
  onToggle: () => void;
  onGraded: () => void;
}) {
  return (
    <li className="assignment">
      <div className="assignment-head">
        {s.submitted ? (
          <button className="link-button" onClick={onToggle} aria-expanded={expanded}>
            {s.rollNo}. {s.name}
          </button>
        ) : (
          <span className="muted">
            {s.rollNo}. {s.name}
          </span>
        )}
        <span className="row-actions">
          {!s.submitted && <span className="muted small">Not submitted</span>}
          {s.submitted && s.isLate && <span className="warn small">Late</span>}
          {s.graded ? (
            <strong className="small">
              {s.finalMarks}/{marksAvailable}
            </strong>
          ) : (
            s.submitted && <span className="small">To mark</span>
          )}
        </span>
      </div>

      {expanded && s.submissionId && (
        <GradeForm
          student={s}
          marksAvailable={marksAvailable}
          onGraded={onGraded}
        />
      )}

      {/* Separate from the grade form on purpose. Feedback goes TO the
          student; a staff note is ABOUT them and they never see it, so the two
          must not read as one box with two labels. */}
      {expanded && (
        <StudentNotes
          studentId={s.studentId}
          studentName={s.name}
          sectionSubjectId={sectionSubjectId}
        />
      )}
    </li>
  );
}

function GradeForm({
  student: s,
  marksAvailable,
  onGraded,
}: {
  student: RosterStudent;
  marksAvailable: number;
  onGraded: () => void;
}) {
  const [marks, setMarks] = useState(s.rawMarks?.toString() ?? "");
  const [feedback, setFeedback] = useState(s.feedback ?? "");
  const [notes, setNotes] = useState(s.internalNotes ?? "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const isReleased = s.releasedAt != null;

  const save = async () => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await api.post(`/submissions/${s.submissionId}/grade`, {
        rawMarks: Number(marks),
        feedback: feedback || undefined,
        internalNotes: notes || undefined,
        revisionReason: reason || undefined,
      });
      setSaved(true);
      onGraded();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "That grade could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="assignment-body">
      <p className="muted small">
        Submitted {s.submittedAt ? new Date(s.submittedAt).toLocaleString() : ""}
        {s.version > 1 ? ` · version ${s.version}` : ""}
        {s.isLate ? ` · ${describeLateness(s.minutesLate)} late` : ""}
      </p>

      {s.textResponse && <blockquote className="response">{s.textResponse}</blockquote>}

      {s.files.length > 0 && (
        <ul className="list small">
          {s.files.map((f) => (
            <li key={f.id}>
              <span>{f.filename}</span>
              <button className="btn btn-quiet" onClick={() => void downloadFile(f.id, f.filename)}>
                Download
              </button>
            </li>
          ))}
        </ul>
      )}

      {isReleased && (
        <div className="alert alert-warn">
          <p>
            This grade has been released to the student. Changing it needs a reason,
            which is recorded (BR-ASG-11).
          </p>
        </div>
      )}

      <div className="field-row">
        <label className="field">
          <span>Marks out of {marksAvailable}</span>
          <input
            type="number"
            min={0}
            max={marksAvailable}
            step="0.5"
            value={marks}
            onChange={(e) => setMarks(e.target.value)}
          />
        </label>
        {s.isLate && (
          <div className="field">
            <span>Late penalty</span>
            {/* BR-ASG-03 — computed, not typed. Shown so the teacher knows what
                the student will actually receive before saving. */}
            <p className="muted small">
              {s.penaltyApplied != null && s.penaltyApplied > 0
                ? `−${s.penaltyApplied} applied`
                : "Applied automatically on save."}
            </p>
          </div>
        )}
      </div>

      <label className="field">
        <span>Feedback for the student</span>
        <textarea rows={3} value={feedback} onChange={(e) => setFeedback(e.target.value)} />
      </label>

      <label className="field">
        <span>Internal notes</span>
        <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        {/* BR-ASG-08 — stated in the interface, because a teacher who is unsure
            will simply not use the field, and moderation notes are the reason
            it exists. */}
        <span className="muted small">Never shown to the student.</span>
      </label>

      {isReleased && (
        <label className="field">
          <span>Reason for the change</span>
          <input value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
      )}

      {error && (
        <div className="alert alert-error">
          <p>{error}</p>
        </div>
      )}
      {saved && <p className="small">✓ Saved.</p>}

      <button
        className="btn btn-primary"
        onClick={() => void save()}
        disabled={busy || marks === "" || (isReleased && reason.trim() === "")}
      >
        {busy ? "Saving…" : s.graded ? "Update grade" : "Save grade"}
      </button>
    </div>
  );
}

/**
 * Downloads through fetch rather than a plain link.
 *
 * The endpoint needs an Authorization header, which an <a href> cannot send.
 * Putting a token in the query string instead would put it in server logs and
 * browser history (SEC-AUT-014).
 */
async function downloadFile(fileId: string, filename: string): Promise<void> {
  const res = await fetch(`/api/v1/submission-files/${fileId}/download`, {
    headers: { Authorization: `Bearer ${tokens.getAccess() ?? ""}` },
  });
  if (!res.ok) return;

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  // Revoked immediately: the click has already taken a reference, and leaving
  // it alive holds the whole file in memory for the life of the tab.
  URL.revokeObjectURL(url);
}

function describeLateness(minutes: number): string {
  if (minutes < 60) return `${minutes} minutes`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"}`;
  return `${Math.round(hours / 24)} days`;
}
