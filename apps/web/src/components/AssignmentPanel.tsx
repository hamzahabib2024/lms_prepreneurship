import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api } from "../api/client";
import { VoiceRecorder, VoiceNote, clock, type Recording } from "./VoiceRecorder";
import { Icon } from "./Icon";
import { BriefAttachments } from "./BriefAttachments";
import { SubmissionComments } from "./SubmissionComments";
import { Field } from "./Field";

/**
 * Assignments for one subject — SRS §13.5, FR-ASG-011/013/014.
 *
 * The deadline is the thing a student is here for, so it is stated in plain
 * words ("due in 3 days", "2 days overdue") rather than only as a date. A date
 * alone makes the reader do arithmetic under time pressure, which is exactly
 * when they get it wrong.
 *
 * Upload and submit are separate, matching the API: files are added one at a
 * time and listed, and nothing is handed in until Submit is pressed. A student
 * can see what they are about to submit before they commit to it.
 */

interface StudentAssignment {
  id: string;
  title: string;
  instructions: string;
  /** FR-ASG — whether the teacher also recorded the brief. */
  hasBriefAudio?: boolean;
  briefAudioSeconds?: number | null;
  /** FR-ASG — how many files came with the brief. The names arrive on open. */
  attachmentCount?: number;
  marksAvailable: number;
  opensAt: string;
  dueAt: string;
  extendedTo: string | null;
  hardCloseAt: string | null;
  submissionType: "FILE" | "TEXT" | "BOTH";
  allowedFileTypes: string[];
  maxFileSizeMb: number;
  maxFileCount: number;
  resubmissionPolicy: "NONE" | "UNLIMITED_UNTIL_DUE" | "LIMITED";
  latePolicy: string;
  isOpen: boolean;
  isOverdue: boolean;
  submitted: boolean;
  submittedAt: string | null;
  version: number;
  wasLate: boolean;
  fileCount: number;
  /** Their own submission, so the comment thread has something to open. */
  submissionId: string | null;
  commentCount: number;
  /** Spoken feedback from the teacher. Arrives without waiting for the mark. */
  hasFeedbackAudio: boolean;
  feedbackAudioSeconds: number | null;
  grade:
    | {
        status: "RELEASED";
        finalMarks: number;
        penaltyApplied: number;
        feedback: string | null;
      }
    | { status: "AWAITING_GRADE" }
    | { status: "NOT_SUBMITTED" };
}

interface PendingFile {
  id: string;
  filename: string;
  sizeBytes: number;
  scanStatus: string;
}

export function AssignmentPanel({ sectionSubjectId }: { sectionSubjectId: string }) {
  const [items, setItems] = useState<StudentAssignment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .get<StudentAssignment[]>(`/section-subjects/${sectionSubjectId}/my-assignments`)
      .then(setItems)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load assignments."));
  }, [sectionSubjectId]);

  useEffect(load, [load]);

  if (error) {
    return (
      <section className="card">
        <h2>Assignments</h2>
        <div className="alert alert-error" role="alert">
          <p>{error}</p>
        </div>
      </section>
    );
  }

  if (!items) return null;

  return (
    <section className="card">
      <h2>Assignments</h2>
      {items.length === 0 ? (
        <p className="muted">
          No assignments have been set for this subject yet.
        </p>
      ) : (
        <ul className="list">
          {items.map((a) => (
            <AssignmentRow
              key={a.id}
              assignment={a}
              expanded={openId === a.id}
              onToggle={() => setOpenId(openId === a.id ? null : a.id)}
              onChanged={load}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function AssignmentRow({
  assignment: a,
  expanded,
  onToggle,
  onChanged,
}: {
  assignment: StudentAssignment;
  expanded: boolean;
  onToggle: () => void;
  onChanged: () => void;
}) {
  return (
    <li className="assignment">
      <div className="assignment-head">
        <button
          className="link-button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-controls={`assignment-${a.id}`}
        >
          {a.title}
        </button>
        <span className="row-actions">
          <Status a={a} />
          <span className="muted small">{a.marksAvailable} marks</span>
        </span>
      </div>

      <p className={`small ${a.isOverdue && !a.submitted ? "warn" : "muted"}`}>
        {deadlineText(a)}
      </p>

      {expanded && (
        <div id={`assignment-${a.id}`} className="assignment-body">
          <p className="small">{a.instructions}</p>
          {/* The teacher's own voice, where they recorded one. Under the
              written brief, because the written brief is the record. */}
          {a.hasBriefAudio && <BriefAudio assignmentId={a.id} seconds={a.briefAudioSeconds} />}
          {/*
            THE FILES THE TASK IS ABOUT — the logo to work from, the passage
            to read. Rendered only where the list says there are some, so an
            assignment without them costs no request: the count comes down
            with the assignment, and the names only when it is opened.

            Above the submit panel deliberately. A student who has to scroll
            PAST the box they hand work into to find the file they were meant
            to start from has been given the two things in the wrong order.
          */}
          {(a.attachmentCount ?? 0) > 0 && <BriefAttachments assignmentId={a.id} />}
          <SubmitPanel assignment={a} onChanged={onChanged} />
          {/*
            WHAT THE TEACHER SAID ABOUT IT — FR-ASG-027.
            Only once there is a submission to talk about, and BELOW the submit
            panel because the thread is about work already handed in. It is not
            gated on the grade being released: "this is the wrong file type" is
            worth nothing if it arrives with the marks a week later.
          */}
          {/*
            THE MARK, AND WHAT THE TEACHER SAID ABOUT IT.

            Only in the RELEASED branch, which is where the server puts it:
            an unreleased grade tells a student nothing at all, and "there is a
            recording waiting for you" would itself be part of the mark.
          */}
          {/*
            WHAT THE TEACHER SAID.

            The written feedback comes with the mark and waits for release; the
            RECORDING does not, for the same reason the comment thread does not
            — it is a remark about the work rather than the mark itself, and
            "send me a PDF" is no use a week after the grades go out.
          */}
          {((a.grade.status === "RELEASED" && a.grade.feedback) || a.hasFeedbackAudio) && (
            <div className="graded-feedback">
              <h4 className="section-label">Your feedback</h4>
              {a.grade.status === "RELEASED" && a.grade.feedback && (
                <p className="small">{a.grade.feedback}</p>
              )}
              {a.hasFeedbackAudio && a.submissionId && (
                <FeedbackAudio
                  submissionId={a.submissionId}
                  seconds={a.feedbackAudioSeconds}
                />
              )}
            </div>
          )}

          {a.submissionId && (
            <SubmissionComments
              submissionId={a.submissionId}
              audience="student"
              onChanged={onChanged}
            />
          )}
        </div>
      )}
    </li>
  );
}

/** Never colour alone — every state is a word (NFR-ACC-003). */
function Status({ a }: { a: StudentAssignment }) {
  if (a.grade.status === "RELEASED") {
    return (
      <strong className="small">
        {a.grade.finalMarks}/{a.marksAvailable}
        {a.grade.penaltyApplied > 0 && (
          // FR-ASG-026 — a student must be able to see what lateness cost them,
          // not just a lower number than they expected.
          <span className="warn"> (−{a.grade.penaltyApplied} late)</span>
        )}
      </strong>
    );
  }
  if (a.submitted) {
    return (
      <span className="small">
        ✓ Submitted{a.wasLate ? " (late)" : ""}
        {a.grade.status === "AWAITING_GRADE" ? " · being marked" : ""}
        {/* A student should not have to open every assignment to discover
            their teacher wrote something on one of them. */}
        {a.commentCount > 0 && (
          <span className="pill">
            {a.commentCount} comment{a.commentCount === 1 ? "" : "s"}
          </span>
        )}
      </span>
    );
  }
  if (!a.isOpen) return <span className="muted small">Closed</span>;
  return <span className="muted small">Not submitted</span>;
}

function SubmitPanel({
  assignment: a,
  onChanged,
}: {
  assignment: StudentAssignment;
  onChanged: () => void;
}) {
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const loadFiles = useCallback(() => {
    api
      .get<PendingFile[]>(`/assignments/${a.id}/files`)
      .then(setFiles)
      .catch(() => undefined);
  }, [a.id]);

  useEffect(loadFiles, [loadFiles]);

  const canSubmit =
    a.isOpen && (!a.submitted || a.resubmissionPolicy !== "NONE");

  const upload = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const body = new FormData();
      body.append("file", file);
      // Not api.post: that sets a JSON content-type, and multipart needs the
      // browser to write its own boundary.
      await api.upload<PendingFile>(`/assignments/${a.id}/files`, body);
      loadFiles();
    } catch (e) {
      // The server explains exactly why — wrong type, too large, contents do
      // not match. Replacing that with a generic message would throw away the
      // one thing the student needs (NFR-USE-007).
      setError(e instanceof ApiError ? e.message : "That file could not be uploaded.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  /**
   * A recording, uploaded as a file, because that is what it is.
   *
   * The blob is wrapped in a File with a generated name and the container's
   * own extension. The name matters: the server checks the extension against
   * what the assignment accepts AND verifies the leading bytes really are that
   * container, so a mismatch here would be refused — correctly — as tampering.
   */
  const uploadRecording = async (r: Recording) => {
    const ext = EXT_FOR_TYPE[r.contentType] ?? "webm";
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
    await upload(new File([r.blob], `spoken-answer-${stamp}.${ext}`, { type: r.contentType }));
  };

  const remove = async (fileId: string) => {
    setError(null);
    try {
      await api.del(`/submission-files/${fileId}`);
      loadFiles();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "That file could not be removed.");
    }
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<{ isLate?: boolean; version?: number }>(
        `/assignments/${a.id}/submissions`,
        { textResponse: text || undefined, fileIds: files.map((f) => f.id) },
      );
      setDone(
        result.isLate
          ? "Submitted, but after the deadline. A late penalty may apply."
          : "Submitted.",
      );
      setText("");
      loadFiles();
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "That could not be submitted.");
    } finally {
      setBusy(false);
    }
  };

  if (!canSubmit) {
    return (
      <p className="muted small">
        {a.submitted
          ? "You have submitted this assignment and it cannot be changed."
          : "This assignment is not open for submission."}
      </p>
    );
  }

  const accept = a.allowedFileTypes.map((t) => `.${t}`).join(",");

  /*
   * Whether a spoken answer is even possible for THIS assignment.
   *
   * The teacher may narrow the accepted types per assignment and never widen
   * them, so an assignment set to accept only `pdf` cannot take a recording
   * however the institute is configured. Asked here rather than at the server,
   * because the useful moment to know is before somebody records.
   */
  const canRecord = a.allowedFileTypes.some((t) =>
    ["webm", "m4a", "ogg", "oga", "mp4", "mp3"].includes(t.toLowerCase()),
  );

  return (
    <div className="submit-panel">
      {a.submissionType !== "FILE" && (
        <Field label="Your response"><textarea
            rows={4}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Type your answer here."
          />
        </Field>
      )}

      {a.submissionType !== "TEXT" && (
        <>
          <Field label="Attach a file"><input
              ref={inputRef}
              type="file"
              accept={accept}
              disabled={busy || files.length >= a.maxFileCount}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void upload(file);
              }}
            />
          </Field>
          {/* Stated up front. A student should not discover the rules by
              having an upload refused. */}
          <p className="muted small">
            {a.allowedFileTypes.map((t) => `.${t}`).join(", ")} · up to {a.maxFileSizeMb} MB each ·
            at most {a.maxFileCount} file{a.maxFileCount === 1 ? "" : "s"}
          </p>

          {/*
            A SPOKEN ANSWER — FR-ASG.
            Offered only where the teacher's own list of accepted types
            includes something a browser can record. A recorder that appears
            on a "PDF only" assignment invites a student to spend two minutes
            recording an answer that the upload will then refuse, which is a
            worse experience than never offering it.

            It uploads through exactly the same route as a chosen file, so it
            inherits the size limit, the count limit, the content check and
            the removal button below without any of them being written twice.
          */}
          {canRecord && (
            <VoiceRecorder
              label="Or record your answer"
              hint="Speak your answer instead of typing it. It is added to the list below like any other file, and you can re-record before you submit."
              busy={busy || files.length >= a.maxFileCount}
              maxSeconds={300}
              onRecorded={(r) => void uploadRecording(r)}
            />
          )}

          {files.length > 0 && (
            <ul className="list small">
              {files.map((f) => (
                <li key={f.id}>
                  <span>
                    {f.filename} <span className="muted">({formatSize(f.sizeBytes)})</span>
                  </span>
                  <button className="btn btn-quiet" onClick={() => void remove(f.id)}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {error && (
        <div className="alert alert-error" role="alert">
          <p>{error}</p>
        </div>
      )}
      {done && <p className="small">{done}</p>}

      <button
        className="btn btn-primary"
        onClick={() => void submit()}
        disabled={busy || (files.length === 0 && text.trim() === "")}
      >
        {busy ? "Working…" : a.submitted ? "Submit again" : "Submit"}
      </button>

      {a.isOverdue && (
        // FR-ASG-026 — told BEFORE they submit, not discovered when marked.
        <p className="warn small">
          This is past the deadline. {latePolicyText(a.latePolicy)}
        </p>
      )}
    </div>
  );
}

function deadlineText(a: StudentAssignment): string {
  const due = new Date(a.extendedTo ?? a.dueAt);
  const extended = a.extendedTo ? " (your extension)" : "";
  const days = Math.round((due.getTime() - Date.now()) / 86_400_000);

  if (a.submitted && a.submittedAt) {
    return `Submitted ${new Date(a.submittedAt).toLocaleDateString()}${
      a.version > 1 ? ` · version ${a.version}` : ""
    }`;
  }
  if (days < 0) return `${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} overdue${extended}`;
  if (days === 0) return `Due today${extended}`;
  return `Due in ${days} day${days === 1 ? "" : "s"}${extended} · ${due.toLocaleDateString()}`;
}

function latePolicyText(policy: string): string {
  switch (policy) {
    case "NOT_ACCEPTED":
      return "Late work is not accepted.";
    case "FIXED_DEDUCTION":
      return "A fixed deduction will apply.";
    case "PER_DAY_PERCENT":
      return "A penalty applies for each day late.";
    default:
      return "It will be marked as late.";
  }
}

/**
 * The extension for each container a browser records in.
 *
 * The server proves the bytes match the extension, so this table being wrong
 * shows up as a refused upload rather than as a corrupt file — which is the
 * right way round, and the reason the check exists.
 */
/**
 * The teacher's spoken brief, fetched rather than linked.
 *
 * `<audio src="/api/v1/...">` sends no Authorization header, so pointing it at
 * a guarded route answers 401 and renders as a player that will not play —
 * which is exactly the failure the lecture streaming route was built to avoid.
 * The blob is fetched through the API client, which carries the token and
 * refreshes it, and turned into an object URL the element can use.
 *
 * ON DEMAND, not on render. A class list showing eight assignments should not
 * pull eight audio files nobody has asked to hear.
 */
/**
 * The teacher's spoken feedback on THIS student's work, played on demand.
 *
 * Fetched rather than linked, like every other file in this System: the route
 * needs a bearer token, and a URL a student could forward would be one that
 * outlives their enrolment. The server refuses it entirely until the grade is
 * released, so there is no moment at which this can leak a mark early.
 */
function FeedbackAudio({
  submissionId,
  seconds,
}: {
  submissionId: string;
  seconds?: number | null;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  if (url) return <VoiceNote src={url} seconds={seconds} label="What your teacher said" />;

  return (
    <div className="voice-note">
      <span className="voice-note-mark" aria-hidden="true">
        <Icon name="megaphone" />
      </span>
      <div className="voice-note-body">
        <strong className="small">Your teacher recorded feedback for you</strong>
        {failed && <span className="muted small">It could not be loaded. Try again.</span>}
      </div>
      <button
        type="button"
        className="btn btn-sm"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setFailed(false);
          api
            .download(`/submissions/${submissionId}/feedback-audio`)
            .then((blob) => setUrl(URL.createObjectURL(blob)))
            .catch(() => setFailed(true))
            .finally(() => setBusy(false));
        }}
      >
        {busy ? "Loading…" : "Listen"}
      </button>
    </div>
  );
}

/**
 * The teacher's spoken brief, played on demand.
 *
 * EXPORTED so the marking screen can use it too. A marker needs the brief as
 * much as the student does — more, arguably, since they are judging work
 * against it — and a second copy of the fetch-and-revoke lifecycle is a second
 * place to leak an object URL.
 */
export function BriefAudio({
  assignmentId,
  seconds,
}: {
  assignmentId: string;
  seconds?: number | null;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  // An object URL outlives the component unless it is revoked.
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  if (url) return <VoiceNote src={url} seconds={seconds} label="Spoken brief" />;

  return (
    <div className="voice-note">
      <span className="voice-note-mark" aria-hidden="true">
        <Icon name="megaphone" />
      </span>
      <div className="voice-note-body">
        <strong className="small">The teacher recorded a brief</strong>
        {failed && <span className="muted small">It could not be loaded. Try again.</span>}
      </div>
      <button
        type="button"
        className="btn btn-sm"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setFailed(false);
          api
            .download(`/assignments/${assignmentId}/brief-audio`)
            .then((b) => setUrl(URL.createObjectURL(b)))
            .catch(() => setFailed(true))
            .finally(() => setBusy(false));
        }}
      >
        {busy ? "Loading…" : "Listen"}
      </button>
      {typeof seconds === "number" && seconds > 0 && (
        <span className="muted small">{clock(seconds)}</span>
      )}
    </div>
  );
}

const EXT_FOR_TYPE: Record<string, string> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
