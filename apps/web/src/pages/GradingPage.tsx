import { useCallback, useEffect, useState } from "react";
import { EmptyState, SkeletonList } from "../components/Ui";
import { Link, useParams } from "react-router-dom";
import { ApiError, api, tokens } from "../api/client";
import { StudentNotes } from "../components/StudentNotes";
import { Icon } from "../components/Icon";
import { BriefAttachments } from "../components/BriefAttachments";
import { BriefAudio } from "../components/AssignmentPanel";
import { SubmissionComments } from "../components/SubmissionComments";
import { SubmissionDocument } from "../components/SubmissionDocument";
import { FeedbackVoice } from "../components/FeedbackVoice";
import { Field } from "../components/Field";

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
  files: Array<{ id: string; filename: string; contentType: string; sizeBytes: number }>;
  graded: boolean;
  rawMarks: number | null;
  penaltyApplied: number | null;
  finalMarks: number | null;
  feedback: string | null;
  /** Whether the marker recorded a spoken note. Never where it lives. */
  hasFeedbackAudio: boolean;
  feedbackAudioSeconds: number | null;
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
    /** The task the work is judged against. Was missing entirely until now. */
    instructions: string;
    opensAt: string;
    hardCloseAt: string | null;
    isOpen: boolean;
    hasBriefAudio: boolean;
    briefAudioSeconds: number | null;
    attachmentCount: number;
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
      {/*
        THE PAGE HEADING STANDS DOWN WHILE MARKING.

        It repeats what the workspace's own sticky bar already says — the title,
        the marks, the deadline — and it costs the document pane about a fifth
        of its height to do it. On a laptop that is the difference between
        seeing a page of an essay and seeing two thirds of one. The heading
        comes back the moment the marker returns to the list.
      */}
      {focusIndex === null && (
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
      )}

      {/*
        WHY THERE IS NOTHING TO PRESS.

        The two gates that hide the Mark button are right — a button that opens
        an empty marking screen is a button that lies — but hiding it silently
        left a roster of "Not submitted" rows, no control, and no explanation,
        which reads as a screen that failed to load. The reasons are separated
        because the useful next action differs: one waits on students, the
        other waits on the teacher pressing Release.
      */}
      {focusIndex === null && markable.length === 0 && (
        summary.submitted === 0 ? (
          <EmptyState icon="clipboard" title="Nothing to mark yet">
            {summary.enrolled === 0
              ? "Nobody is enrolled in this class yet, so there is nothing to hand in."
              : `None of the ${summary.enrolled} enrolled student${summary.enrolled === 1 ? " has" : "s have"} handed this in yet. ` +
                (a.isOpen
                  ? `It is due ${new Date(a.dueAt).toLocaleDateString()} and is still open for submissions.`
                  : "Submissions are closed.")}
          </EmptyState>
        ) : (
          <EmptyState icon="tick" title="Everything is marked">
            {`All ${summary.submitted} submission${summary.submitted === 1 ? " has" : "s have"} been marked. ` +
              (a.gradesReleased
                ? "The grades have been released to students."
                : "Release them below when you are ready — the whole class goes at once.")}
          </EmptyState>
        )
      )}

      {current && (
        <FocusMarker
          student={current}
          assignment={a}
          position={(focusIndex ?? 0) + 1}
          total={markable.length}
          remaining={markable.filter((x) => !x.graded).length}
          marksAvailable={a.marksAvailable}
          // The Notes tab carries a staff note about the student, which is
          // anchored to the class rather than to this one submission.
          sectionSubjectId={a.sectionSubjectId}
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
        {/* THE TASK, not only its attachments. A teacher opening this screen
            could previously see the title and the total marks and never what
            was actually set — which is the wrong way round, because the brief
            is the thing the work is being judged against. */}
        <Brief assignment={a} canManage />
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
              /*
               * STRAIGHT INTO THE WORKSPACE, AT THIS STUDENT.
               *
               * The header button starts at the first unmarked one, which is
               * right when working a set from the top. This is the other way
               * people mark: a student asks about their mark, or a moderator
               * wants one particular paper, and starting at somebody else's
               * work and pressing Next eleven times is not an answer.
               *
               * The index is into `markable`, not into the list on screen —
               * the walk skips students with nothing to mark, so the two
               * orderings are not the same and using the wrong one opens a
               * different student's submission.
               */
              onMark={() => {
                const i = markable.findIndex((m) => m.studentId === s.studentId);
                if (i >= 0) setFocusIndex(i);
              }}
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

/**
 * THE TASK THAT WAS SET — written, attached, and spoken.
 *
 * ONE COMPONENT, TWO PLACES. It sits on the roster, where a teacher reads it
 * before starting, and in the workspace's Brief tab, where they read it beside
 * one student's work. A second copy would be a second thing to keep in step
 * with what the assignment actually says.
 *
 * `canManage` is the difference between the two: the roster lets a teacher add
 * a file to the brief after the fact — the assignment was set on Monday and
 * somebody asks for the spreadsheet on Wednesday — while the marking panel is
 * for reading, not for editing the paper mid-mark.
 */
function Brief({
  assignment: a,
  canManage = false,
}: {
  assignment: Roster["assignment"];
  canManage?: boolean;
}) {
  return (
    <>
      {/* Whitespace preserved: a brief written as three numbered points is
          three points, and reflowing it into a paragraph loses the list. */}
      <p className="brief-text">{a.instructions}</p>

      <p className="muted small">
        Out of {a.marksAvailable} · due {new Date(a.dueAt).toLocaleString()}
        {a.hardCloseAt ? ` · closes ${new Date(a.hardCloseAt).toLocaleString()}` : ""}
        {a.isOpen ? "" : " · closed"}
      </p>

      {/* The teacher's own voice, where they recorded one. Under the written
          brief, because the written brief is the record. */}
      {a.hasBriefAudio && <BriefAudio assignmentId={a.id} seconds={a.briefAudioSeconds} />}

      {/* Rendered only when there are any, so an assignment without files
          costs no request — the count came down with the roster. */}
      {(a.attachmentCount > 0 || canManage) && (
        <BriefAttachments assignmentId={a.id} canManage={canManage} />
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
  onMark,
  onGraded,
}: {
  student: RosterStudent;
  marksAvailable: number;
  sectionSubjectId: string;
  expanded: boolean;
  onToggle: () => void;
  onMark: () => void;
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
          {/* Only where there is something to open. A Mark button on a student
              who handed nothing in leads to an empty screen. */}
          {s.submitted && s.submissionId && (
            <button type="button" className="btn btn-sm" onClick={onMark}>
              <Icon name="pen" />
              {s.graded ? "Review" : "Mark"}
            </button>
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

      <Field label="Feedback for the student"><textarea rows={3} value={feedback} onChange={(e) => setFeedback(e.target.value)} />
      </Field>

      {/*
        THE CONVERSATION, ABOVE THE PRIVATE NOTES AND BELOW THE MARK.
        Placed here on purpose: it is the last thing a marker reads before
        deciding, and the first thing they reach for when the answer is "this
        cannot be marked as it stands". Unlike the feedback box above, what is
        written here reaches the student immediately.
      */}
      {s.submissionId && (
        <SubmissionComments submissionId={s.submissionId} files={s.files} audience="teacher" />
      )}

      <Field label="Internal notes" hint={<>Never shown to the student.</>}><textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        {/* BR-ASG-08 — stated in the interface, because a teacher who is unsure
            will simply not use the field, and moderation notes are the reason
            it exists. */}
      </Field>

      {isReleased && (
        <Field label="Reason for the change"><input value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
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
/**
 * THE MARKING WORKSPACE — the work on one side, the mark on the other.
 *
 * WHAT IT REPLACES. The overview is the right shape for deciding where to
 * start and the wrong shape for the work: marking thirty submissions from a
 * list meant thirty rounds of find-the-row, expand, DOWNLOAD THE FILE, open it
 * in another application, alt-tab back, type a mark, collapse. The mark and the
 * thing being marked were never on screen together, which is the one thing a
 * marking screen exists to arrange.
 *
 * THE SPLIT IS NOT SYMMETRICAL, deliberately. The document takes about
 * two-thirds because it holds A4 pages that stop being readable when squeezed;
 * the panel holds a mark box and short text and does not need the room. Below
 * 1000px the split collapses to tabs — a horizontally scrolling marking screen
 * on a tablet is worse than no split at all.
 *
 * THE PANEL IS TABBED, AND ALL THREE TABS ARE ONE FORM. Mark, Comments and
 * Notes are views onto the same submission, and Mark and Notes save together in
 * a single request — a teacher who types a mark, switches to Notes and presses
 * Save must not discover the mark was left behind on the other tab. Comments
 * are their own thing entirely: they post immediately and are NOT held back
 * until grades are released, which is the whole reason they exist.
 *
 * WHY THE DOCUMENT PANE IS MOUNTED ONCE AND NOT PER TAB. Switching from Mark to
 * Comments must not re-fetch the PDF and throw away the marker's scroll
 * position half-way down an essay. So the tabs change only the panel; the
 * document sits outside them and is remounted for a new STUDENT and nothing
 * else.
 */
function FocusMarker({
  student: s,
  assignment,
  position,
  total,
  remaining,
  marksAvailable,
  sectionSubjectId,
  onPrevious,
  onNext,
  onClose,
  onGraded,
}: {
  student: RosterStudent;
  /** The task being marked against — read on the Brief tab. */
  assignment: Roster["assignment"];
  position: number;
  total: number;
  remaining: number;
  marksAvailable: number;
  sectionSubjectId: string;
  onPrevious: () => void;
  onNext: () => void;
  onClose: () => void;
  onGraded: () => void;
}) {
  const [tab, setTab] = useState<"mark" | "comments" | "notes" | "brief">("mark");
  /** Which pane a narrow screen is showing, where they cannot both fit. */
  const [narrowPane, setNarrowPane] = useState<"document" | "panel">("document");

  /*
   * THE MARK STARTS FRESH FOR EACH STUDENT.
   *
   * `useState(initial)` only reads its argument on the first render, and this
   * component is deliberately NOT remounted between students — that is what
   * keeps the layout from flickering. So without this the second student
   * inherits the first one's mark and feedback, sitting in the boxes looking
   * like their own work. Keyed on the submission rather than the student
   * because a resubmission is a different piece of work.
   */
  const [marks, setMarks] = useState(s.rawMarks?.toString() ?? "");
  const [feedback, setFeedback] = useState(s.feedback ?? "");
  const [notes, setNotes] = useState(s.internalNotes ?? "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setMarks(s.rawMarks?.toString() ?? "");
    setFeedback(s.feedback ?? "");
    setNotes(s.internalNotes ?? "");
    setReason("");
    setError(null);
    setSaved(false);
    setTab("mark");
    setNarrowPane("document");
  }, [s.submissionId, s.rawMarks, s.feedback, s.internalNotes]);

  const isReleased = s.releasedAt != null;
  const canSave = !busy && marks !== "" && !(isReleased && reason.trim() === "");

  const save = useCallback(
    async (thenAdvance: boolean) => {
      if (!s.submissionId || marks === "" || (isReleased && reason.trim() === "")) return;
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
        // The parent reloads and steps to the next thing still to mark. Both
        // are its decision, not this component's.
        if (thenAdvance) onGraded();
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "That grade could not be saved.");
      } finally {
        setBusy(false);
      }
    },
    [s.submissionId, marks, feedback, notes, reason, isReleased, onGraded],
  );

  /*
   * THE KEYBOARD, because this screen is used thirty times in a row.
   *
   * A teacher who never reaches for the mouse gets through a class in half the
   * time, so the shortcuts cover the whole loop: move, mark, save, move on.
   * J and K are the vi bindings people who mark a lot already have in their
   * fingers; the arrows do the same thing for everybody else.
   *
   * NOTHING FIRES WHILE SOMEBODY IS TYPING. A bare J that jumps to the next
   * student while a teacher is half-way through the word "justify" is a
   * shortcut that eats work. Ctrl+Enter is the exception and is meant to be
   * pressed from inside the feedback box — it is the one shortcut whose whole
   * purpose is to save what you are typing.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing =
        !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);

      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        void save(true);
        return;
      }

      if (typing) return;

      if (e.key === "ArrowLeft" || e.key === "j" || e.key === "J") onPrevious();
      else if (e.key === "ArrowRight" || e.key === "k" || e.key === "K") onNext();
      else if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onPrevious, onNext, onClose, save]);

  return (
    <section className="marker">
      <header className="focus-bar">
        <button type="button" className="btn btn-quiet btn-sm" onClick={onClose}>
          <Icon name="chevron-left" />
          All submissions
        </button>

        <span className="focus-position">
          <strong>
            {s.rollNo}. {s.name}
          </strong>
          {/* The number that decides whether a teacher keeps going or stops
              for the evening, so it is on screen rather than a page away. */}
          <span className="muted small">
            {position} of {total} ·{" "}
            {remaining === 0 ? "all marked" : `${remaining} still to mark`}
            {s.isLate ? " · handed in late" : ""}
          </span>
        </span>

        <span className="row-actions">
          {/* A word as well as a colour (NFR-ACC-007). */}
          <span className={s.graded ? "pill pill-ok" : "pill pill-warn"}>
            {s.graded ? `Marked ${s.finalMarks}/${marksAvailable}` : "To mark"}
          </span>
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

      {/*
        THE NARROW-SCREEN SWITCH. Hidden above 1000px by CSS, where both panes
        are on screen at once and a switch between them would be a control that
        does nothing.
      */}
      <div className="marker-switch" role="tablist" aria-label="What to show">
        <button
          role="tab"
          aria-selected={narrowPane === "document"}
          className={narrowPane === "document" ? "doc-tab is-active" : "doc-tab"}
          onClick={() => setNarrowPane("document")}
        >
          The work
        </button>
        <button
          role="tab"
          aria-selected={narrowPane === "panel"}
          className={narrowPane === "panel" ? "doc-tab is-active" : "doc-tab"}
          onClick={() => setNarrowPane("panel")}
        >
          Marking
        </button>
      </div>

      <div className={`marker-split is-showing-${narrowPane}`}>
        {/*
          THE PANEL, on the left. Remounted per student by the effect above
          rather than by a key, so the layout does not flash between students.
        */}
        <div className="marker-panel">
          <div className="marker-tabs" role="tablist" aria-label="Marking">
            <button
              role="tab"
              aria-selected={tab === "mark"}
              className={tab === "mark" ? "marker-tab is-active" : "marker-tab"}
              onClick={() => setTab("mark")}
            >
              Mark
            </button>
            <button
              role="tab"
              aria-selected={tab === "comments"}
              className={tab === "comments" ? "marker-tab is-active" : "marker-tab"}
              onClick={() => setTab("comments")}
            >
              Comments
            </button>
            <button
              role="tab"
              aria-selected={tab === "notes"}
              className={tab === "notes" ? "marker-tab is-active" : "marker-tab"}
              onClick={() => setTab("notes")}
            >
              Notes
            </button>
            {/* IN THE LEFT PANEL AND NOT THE RIGHT. The right-hand pane is the
                student's work; a marker who switched it to re-read the task
                would lose their place in a twelve-page essay. */}
            <button
              role="tab"
              aria-selected={tab === "brief"}
              className={tab === "brief" ? "marker-tab is-active" : "marker-tab"}
              onClick={() => setTab("brief")}
            >
              Brief
            </button>
          </div>

          <div className="marker-panel-body">
            {tab === "mark" && (
              <>
                {isReleased && (
                  <div className="alert alert-warn">
                    <p className="small">
                      This grade has been released to the student. Changing it needs a reason,
                      which is recorded (BR-ASG-11).
                    </p>
                  </div>
                )}

                <div className="field-row">
                  {/* The browser already knows 0..marksAvailable from min and
                      max, so the range is checked without a rule of our own —
                      a mark of 120 out of 100 is caught before it can be
                      saved, where before it reached the server. */}
                  <Field label={`Marks out of ${marksAvailable}`} required>
                    <input
                      type="number"
                      min={0}
                      max={marksAvailable}
                      step="0.5"
                      value={marks}
                      onChange={(e) => setMarks(e.target.value)}
                      required
                      autoFocus
                    />
                  </Field>
                  {s.isLate && (
                    <div className="field">
                      <span className="field-label">Late penalty</span>
                      {/* BR-ASG-03 — computed, not typed. Shown so the teacher
                          knows what the student will actually receive. */}
                      <p className="muted small">
                        {s.penaltyApplied != null && s.penaltyApplied > 0
                          ? `−${s.penaltyApplied} applied`
                          : "Applied automatically on save."}
                      </p>
                    </div>
                  )}
                </div>

                <Field label="Feedback for the student" hint={<>Released with the mark, together with the rest of the class.</>}><textarea rows={6} value={feedback} onChange={(e) => setFeedback(e.target.value)} />
                </Field>

                {/*
                  THE SAME FEEDBACK, SPOKEN — and only once a mark exists for it
                  to belong to. UNDER the written box rather than beside it,
                  because that ordering is the argument: the written feedback is
                  the record, and the recording is what is added to it.

                  Saved on its own the moment it is recorded, not with the Save
                  button. It is a file upload, and folding it into the grade
                  save would lose a teacher's recording because a mark failed
                  validation.
                */}
                {/*
                  NO MARK REQUIRED. It was gated on `s.graded` at first, which
                  hid the recorder on exactly the student a teacher most wants
                  to record for: the one whose work cannot be marked as it
                  stands. The commonest spoken remark — "this is the wrong
                  export, send me a PDF and I will mark it" — is one that has
                  to come BEFORE a grade exists.
                */}
                {s.submissionId && (
                  <FeedbackVoice
                    submissionId={s.submissionId}
                    hasRecording={s.hasFeedbackAudio}
                    seconds={s.feedbackAudioSeconds}
                    onChanged={onGraded}
                  />
                )}

                {isReleased && (
                  <Field label="Reason for the change"><input value={reason} onChange={(e) => setReason(e.target.value)} />
                  </Field>
                )}
              </>
            )}

            {tab === "comments" && s.submissionId && (
              <SubmissionComments
                submissionId={s.submissionId}
                files={s.files}
                audience="teacher"
              />
            )}

            {tab === "brief" && <Brief assignment={assignment} />}

            {tab === "notes" && (
              <>
                <Field label="Internal notes on this submission" hint={<>Never shown to the student. Saved with the mark.</>}><textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} />
                  {/* BR-ASG-08 — stated in the interface, because a teacher who
                      is unsure will simply not use the field, and moderation
                      notes are the reason it exists. */}
                </Field>

                {/* Separate from the note above on purpose: one is ABOUT this
                    piece of work, the other is about the student across the
                    whole subject, and reading as one box with two labels is
                    how the wrong thing gets written in the wrong place. */}
                <StudentNotes
                  studentId={s.studentId}
                  studentName={s.name}
                  sectionSubjectId={sectionSubjectId}
                />
              </>
            )}
          </div>

          {/*
            THE SAVE BAR IS OUTSIDE THE TABS AND PINNED.
            A marker on the Comments tab must still be able to save the mark
            they typed a moment ago without hunting for the tab it lives on.
          */}
          <div className="marker-save">
            {error && (
              <div className="alert alert-error" role="alert">
                <p className="small">{error}</p>
              </div>
            )}
            {saved && !error && <p className="small">✓ Saved.</p>}

            <div className="row-actions">
              <button
                className="btn btn-primary"
                onClick={() => void save(true)}
                disabled={!canSave}
              >
                {busy ? "Saving…" : s.graded ? "Update and go to next" : "Save and go to next"}
              </button>
              <button className="btn" onClick={() => void save(false)} disabled={!canSave}>
                Save
              </button>
            </div>
            <p className="muted small">
              J and K move between submissions, Ctrl+Enter saves and moves on, Escape goes back
              to the list.
            </p>
          </div>
        </div>

        {/*
          THE WORK, on the right, mounted OUTSIDE the tabs so that switching
          from Mark to Comments does not re-fetch the file or lose the
          marker's place in a twelve-page essay. Keyed on the submission so a
          new student gets a new document and the same student does not.
        */}
        <div className="marker-doc">
          <SubmissionDocument
            key={s.submissionId ?? s.studentId}
            files={s.files}
            textResponse={s.textResponse}
          />
        </div>
      </div>
    </section>
  );
}
