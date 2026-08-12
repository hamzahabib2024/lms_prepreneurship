import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api } from "../api/client";

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
  grade:
    | { status: "RELEASED"; finalMarks: number; penaltyApplied: number }
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
          <SubmitPanel assignment={a} onChanged={onChanged} />
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

  return (
    <div className="submit-panel">
      {a.submissionType !== "FILE" && (
        <label className="field">
          <span>Your response</span>
          <textarea
            rows={4}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Type your answer here."
          />
        </label>
      )}

      {a.submissionType !== "TEXT" && (
        <>
          <label className="field">
            <span>Attach a file</span>
            <input
              ref={inputRef}
              type="file"
              accept={accept}
              disabled={busy || files.length >= a.maxFileCount}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void upload(file);
              }}
            />
          </label>
          {/* Stated up front. A student should not discover the rules by
              having an upload refused. */}
          <p className="muted small">
            {a.allowedFileTypes.map((t) => `.${t}`).join(", ")} · up to {a.maxFileSizeMb} MB each ·
            at most {a.maxFileCount} file{a.maxFileCount === 1 ? "" : "s"}
          </p>

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

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
