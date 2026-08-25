import { useCallback, useEffect, useState } from "react";
import { SkeletonList } from "../components/Ui";
import { Link, useParams } from "react-router-dom";
import { ApiError, api, tokens } from "../api/client";
import { StudentNotes } from "../components/StudentNotes";
import { Icon } from "../components/Icon";
import { BriefAttachments } from "../components/BriefAttachments";

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
  /**
   * ONE SUBMISSION AT A TIME — the way marking is actually done.
   *
   * The list below is the OVERVIEW: who has handed in, who has not, what is
   * left. It is the right shape for deciding where to start and the wrong
   * shape for the work itself, because marking thirty submissions from a list
   * means thirty rounds of find-the-row, expand, mark, collapse, and losing
   * your place every time the list re-sorts under you.
   *
   * Every serious marking tool solves this the same way and has for years: put
   * the work, the marking guide and the mark box on one screen, and give the
   * teacher a Next. That is what this index is. Null means the overview.
   */
  const [focusIndex, setFocusIndex] = useState<number | null>(null);

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
      <div className="alert alert-error" role="alert">
        <strong>Could not load this assignment</strong>
        <p>{error}</p>
      </div>
    );
  }
  if (!roster) return <SkeletonList rows={7} />;

  const { assignment: a, summary } = roster;

  // Unmarked work first — that is the queue. Then marked, then absentees.
  const ordered = [...roster.students].sort((x, y) => {
    const rank = (s: RosterStudent) => (s.submitted && !s.graded ? 0 : s.submitted ? 1 : 2);
    return rank(x) - rank(y) || (x.rollNo ?? 9999) - (y.rollNo ?? 9999);
  });

  /*
   * ONLY WORK THERE IS SOMETHING TO DO WITH. A student who did not submit has
   * nothing to mark, and stepping through them is a Next that does nothing —
   * so focus mode walks the submissions, and the overview keeps everybody.
   *
   * Already-marked work stays in the walk on purpose: changing a mark you have
   * just given is a normal part of marking a set, and dropping them from the
   * sequence would make the one thing you want to go back to unreachable.
   */
  const markable = ordered.filter((s) => s.submitted && s.submissionId);
  const current = focusIndex === null ? null : markable[focusIndex] ?? null;

  const goTo = (i: number) => setFocusIndex(Math.max(0, Math.min(i, markable.length - 1)));

  /*
   * AFTER SAVING, GO TO THE NEXT THING THAT STILL NEEDS DOING — not simply the
   * next row. A teacher part-way through a set has already marked some of it,
   * and stepping onto work that is finished makes them check every time
   * whether they have already done it.
   *
   * When nothing is left the teacher stays where they are rather than being
   * thrown back to the list: the last mark they gave is still on screen, which
   * is what somebody wants to see at the end of a set.
   */
  const advance = () => {
    const from = (focusIndex ?? -1) + 1;
    const next = markable.findIndex((s, i) => i >= from && !s.graded);
    if (next >= 0) setFocusIndex(next);
  };

  return (
    <>
      <header className="page-head">
        <div>
          <h1>{a.title}</h1>
          <p className="muted small">
            Out of {a.marksAvailable} · due {new Date(a.dueAt).toLocaleDateString()}
          </p>
        </div>
        <div className="row-actions">
          {/* The way IN to the work. Offered only when there is work: a button
              that opens an empty marking screen is a button that lies. */}
          {focusIndex === null && markable.length > 0 && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                const firstUnmarked = markable.findIndex((x) => !x.graded);
                setFocusIndex(firstUnmarked >= 0 ? firstUnmarked : 0);
              }}
            >
              <Icon name="pen" />
              {summary.ungraded > 0 ? `Mark ${summary.ungraded} submission${summary.ungraded === 1 ? "" : "s"}` : "Review the marks"}
            </button>
          )}
          <Link className="btn btn-quiet" to="/marking">
            Back
          </Link>
        </div>
      </header>

      {current && (
        <FocusMarker
          student={current}
          position={(focusIndex ?? 0) + 1}
          total={markable.length}
          remaining={markable.filter((x) => !x.graded).length}
          marksAvailable={a.marksAvailable}
          onPrevious={() => goTo((focusIndex ?? 0) - 1)}
          onNext={() => goTo((focusIndex ?? 0) + 1)}
          onClose={() => setFocusIndex(null)}
          onGraded={() => {
            load();
            advance();
          }}
        />
      )}

      {/* The overview steps aside while a submission is in focus: two views of
          the same work on one screen is two places to lose your place. */}
      {focusIndex === null && (
        <>
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
          <div className="alert alert-error" role="alert">
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

      {/*
        THE BRIEF ITSELF, managed after the fact — FR-ASG.

        The builder takes files at the moment an assignment is created, which
        covers the teacher who has everything ready. It does not cover the far
        commoner case: the assignment was set on Monday, a student asks on
        Wednesday for the spreadsheet it refers to, and without this the answer
        is WhatsApp and a re-upload for every student who joins late.

        Files can be added and removed at any point in the assignment's life,
        including after marks are released — a corrected brief is worth having
        even then, and nothing here changes a mark.
      */}
      <section className="card">
        <h2>The brief</h2>
        <BriefAttachments assignmentId={a.id} canManage />
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
      )}
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
        <div className="alert alert-error" role="alert">
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


// ══════════════════════════════════════════════════ marking, one at a time ══

/**
 * ONE SUBMISSION, FILLING THE SCREEN — the shape marking actually has.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS BESIDE THE LIST RATHER THAN INSTEAD OF IT. The list answers
 * "where am I up to": who has handed in, who has not, what is left. That is a
 * question a teacher asks twice. Marking is the question they ask thirty
 * times, and answering it from a list means thirty rounds of find-the-row,
 * expand, mark, collapse — losing your place each time the list re-sorts
 * because the row you just marked moved out of the unmarked block.
 *
 * So the list stays as the overview and this is the work: the submission, the
 * mark box and the feedback on one screen, with a Next. It is the arrangement
 * every serious marking tool has converged on, for the same reason.
 *
 * WHAT MAKES IT FASTER IS THE COUNT AND THE NEXT, not the layout. A teacher
 * needs to know how many are left without going back, and needs the next piece
 * of work to arrive without choosing it. Both are here; neither was before.
 *
 * KEYBOARD, BECAUSE THIS IS REPETITIVE WORK. Left and right move, Escape
 * returns to the list. Deliberately NOT bound while a text box has focus —
 * somebody typing "the kerning is left→right inconsistent" must not be thrown
 * onto the next student mid-sentence, which is the classic way a shortcut
 * turns a good screen into an infuriating one.
 * ─────────────────────────────────────────────────────────────────────────────
 */
function FocusMarker({
  student: s,
  position,
  total,
  remaining,
  marksAvailable,
  onPrevious,
  onNext,
  onClose,
  onGraded,
}: {
  student: RosterStudent;
  position: number;
  total: number;
  remaining: number;
  marksAvailable: number;
  onPrevious: () => void;
  onNext: () => void;
  onClose: () => void;
  onGraded: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      // A shortcut that fires inside a textarea is a shortcut that eats work.
      const typing =
        !!el &&
        (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if (typing) return;

      if (e.key === "ArrowLeft") onPrevious();
      else if (e.key === "ArrowRight") onNext();
      else if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onPrevious, onNext, onClose]);

  return (
    <section className="focus-marker">
      <header className="focus-bar">
        <button type="button" className="btn btn-quiet btn-sm" onClick={onClose}>
          <Icon name="chevron-left" />
          All submissions
        </button>

        <span className="focus-position">
          <strong>
            {position} of {total}
          </strong>
          {/* The number that decides whether a teacher keeps going or stops
              for the evening, so it is on screen rather than a page away. */}
          <span className="muted small">
            {remaining === 0 ? "all marked" : `${remaining} still to mark`}
          </span>
        </span>

        <span className="row-actions">
          <button
            type="button"
            className="btn btn-sm"
            onClick={onPrevious}
            disabled={position <= 1}
            aria-label="Previous submission"
          >
            <Icon name="chevron-left" />
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={onNext}
            disabled={position >= total}
            aria-label="Next submission"
          >
            <Icon name="chevron-right" />
          </button>
        </span>
      </header>

      <div className="focus-who">
        <div>
          <h2>
            {s.rollNo}. {s.name}
          </h2>
          <p className="muted small">
            {s.graded ? (
              <>
                Already marked — {s.finalMarks}/{marksAvailable}. Saving again replaces it.
              </>
            ) : (
              <>Not marked yet.</>
            )}
            {s.isLate && " · Handed in late"}
          </p>
        </div>
        {/* A word as well as a colour (NFR-ACC-007). */}
        <span className={s.graded ? "pill pill-ok" : "pill pill-warn"}>
          {s.graded ? "Marked" : "To mark"}
        </span>
      </div>

      {s.submissionId && (
        <GradeForm student={s} marksAvailable={marksAvailable} onGraded={onGraded} />
      )}

      <p className="focus-hint muted small">
        Arrow keys move between submissions, Escape goes back to the list. Saving a mark takes
        you to the next one still to mark.
      </p>
    </section>
  );
}
