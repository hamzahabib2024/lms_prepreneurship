import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "../api/client";
import { Icon } from "../components/Icon";

/**
 * THE CONVERSATION ABOUT A PIECE OF WORK — FR-ASG-027.
 *
 * ONE COMPONENT, BOTH SIDES. The teacher sees it on the grading screen and the
 * student sees it on their assignment card, and it is deliberately the same
 * component reading the same endpoint: two implementations of one thread is
 * two chances for the teacher's copy and the student's copy to disagree about
 * what was said, which is the one thing a record of feedback must never do.
 *
 * WHY THIS IS NOT THE FEEDBACK BOX ABOVE IT. Grade feedback is welded to a
 * mark and released with the cohort. This is not: a teacher can say "your
 * second file is a .PSD, I need a PDF" the moment they open the work, and the
 * student sees it immediately — which is the whole value, because it arrives
 * while there is still time to act on it.
 *
 * ANCHORED TO A FILE WHERE THAT HELPS. A student who handed in four files and
 * is told "this one is the wrong format" should not have to guess which. The
 * picker defaults to the whole submission, because most remarks are about the
 * work rather than about one artefact.
 *
 * A PERSON CAN CHANGE OR WITHDRAW THEIR OWN AND NOBODY ELSE'S. An edited
 * comment says it was edited. A withdrawn one disappears from the thread and
 * stays in the database, for the same reason a rejected fee claim does:
 * somebody who was told something and later disputes it is entitled to find
 * the record rather than an absence.
 */

export interface SubmissionComment {
  id: string;
  fileId: string | null;
  filename: string | null;
  body: string;
  authorName: string;
  authorRole: string;
  isMine: boolean;
  editedAt: string | null;
  createdAt: string;
}

const when = (iso: string): string =>
  new Date(iso).toLocaleString("en-PK", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

/** The role as a word a person recognises, not the database's. */
const ROLE_WORD: Record<string, string> = {
  teacher: "Teacher",
  student: "Student",
  admin: "Office",
  super_admin: "Office",
};

export function SubmissionComments({
  submissionId,
  files = [],
  /**
   * What the empty state should say. A teacher opening an unremarked
   * submission and a student opening one are looking at the same absence for
   * completely different reasons, and one sentence cannot serve both.
   */
  audience,
  onChanged,
}: {
  submissionId: string;
  files?: Array<{ id: string; filename: string }>;
  audience: "teacher" | "student";
  /** So a card showing "2 comments" can update its own count. */
  onChanged?: () => void;
}) {
  const [comments, setComments] = useState<SubmissionComment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [body, setBody] = useState(() => readDraft(submissionId));
  const [about, setAbout] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);

  const load = useCallback(() => {
    api
      .get<SubmissionComment[]>(`/submissions/${submissionId}/comments`)
      .then((c) => {
        setComments(c);
        setError(null);
      })
      .catch((e) =>
        setError(e instanceof ApiError ? e.message : "The comments could not be loaded."),
      );
  }, [submissionId]);

  useEffect(load, [load]);

  /*
   * THE HALF-TYPED COMMENT SURVIVES.
   *
   * This component is unmounted by things a marker does constantly and does
   * not think of as leaving: switching from Comments to Mark, stepping to the
   * next student, a stray Escape. Without this, three sentences of careful
   * feedback go with it — which is the bug nobody forgives and everybody
   * reports as "it deleted my work".
   *
   * Kept per submission, so drafts for two students cannot be confused, and in
   * localStorage rather than in a parent's state so it also survives a reload
   * and a closed tab. Cleared the moment the comment is actually posted.
   */
  useEffect(() => {
    setBody(readDraft(submissionId));
  }, [submissionId]);

  useEffect(() => {
    writeDraft(submissionId, body);
  }, [submissionId, body]);

  const post = async () => {
    if (!body.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/submissions/${submissionId}/comments`, {
        body: body.trim(),
        ...(about ? { fileId: about } : {}),
      });
      setBody("");
      clearDraft(submissionId);
      setAbout("");
      load();
      onChanged?.();
    } catch (e) {
      setError(
        e instanceof ApiError
          ? (e.details?.map((d) => d.message).join(" ") ?? e.message)
          : "That comment could not be posted.",
      );
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async () => {
    if (!editing || !editing.body.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/submission-comments/${editing.id}`, { body: editing.body.trim() });
      setEditing(null);
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "That change could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      await api.del(`/submission-comments/${id}`);
      load();
      onChanged?.();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "That comment could not be withdrawn.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="comments">
      <h3 className="section-label">
        <Icon name="chat" /> Comments on this work
        {comments && comments.length > 0 ? ` (${comments.length})` : ""}
      </h3>

      {error && (
        <div className="alert alert-error" role="alert">
          <p className="small">{error}</p>
        </div>
      )}

      {!comments ? (
        <p className="muted small">Loading…</p>
      ) : comments.length === 0 ? (
        <p className="muted small">
          {audience === "teacher"
            ? "Nothing said yet. Tell the student what is good and what needs changing — they see it straight away, without waiting for the marks to be released."
            : "Your teacher has not commented on this work yet. Anything they write appears here, and you can reply."}
        </p>
      ) : (
        <ul className="commentlist">
          {comments.map((c) => (
            <li key={c.id} className={c.isMine ? "comment is-mine" : "comment"}>
              <div className="comment-head">
                <span className="comment-author">
                  {c.authorName}
                  <span className="pill">{ROLE_WORD[c.authorRole] ?? c.authorRole}</span>
                </span>
                <span className="muted small">
                  {when(c.createdAt)}
                  {/* An edited comment says so. What a person is reading may
                      not be what was first written, and hiding that is how a
                      thread stops being a record. */}
                  {c.editedAt ? " · edited" : ""}
                </span>
              </div>

              {/* Which file this is about, where it is about one. */}
              {c.filename && (
                <p className="comment-anchor">
                  <Icon name="clipboard" /> {c.filename}
                </p>
              )}

              {editing?.id === c.id ? (
                <>
                  <textarea
                    className="comment-edit"
                    rows={3}
                    value={editing.body}
                    onChange={(e) => setEditing({ id: c.id, body: e.target.value })}
                  />
                  <div className="row-actions">
                    <button
                      className="btn btn-sm btn-primary"
                      onClick={() => void saveEdit()}
                      disabled={busy || !editing.body.trim()}
                    >
                      Save
                    </button>
                    <button className="btn btn-sm btn-quiet" onClick={() => setEditing(null)}>
                      Cancel
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className="comment-body">{c.body}</p>
                  {c.isMine && (
                    <div className="comment-actions">
                      <button
                        className="btn btn-sm btn-quiet"
                        onClick={() => setEditing({ id: c.id, body: c.body })}
                      >
                        Edit
                      </button>
                      <button
                        className="btn btn-sm btn-quiet"
                        onClick={() => void withdraw(c.id)}
                        disabled={busy}
                      >
                        Withdraw
                      </button>
                    </div>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="comment-compose">
        <textarea
          rows={2}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={10000}
          placeholder={
            audience === "teacher"
              ? "e.g. Good structure, but the second file is a .PSD — send a PDF and I will mark it."
              : "Ask a question or reply to your teacher…"
          }
        />

        <div className="comment-compose-foot">
          {/* Only offered when there is more than one thing it could be about. */}
          {files.length > 0 && (
            <label className="field-inline">
              <span className="small">About</span>
              <select value={about} onChange={(e) => setAbout(e.target.value)}>
                <option value="">the whole submission</option>
                {files.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.filename}
                  </option>
                ))}
              </select>
            </label>
          )}

          <button
            className="btn btn-primary btn-sm"
            onClick={() => void post()}
            disabled={busy || !body.trim()}
          >
            {busy ? "Posting…" : audience === "teacher" ? "Post comment" : "Send reply"}
          </button>
        </div>

        <p className="muted small">
          {audience === "teacher"
            ? "The student sees this straight away — it is not held back until grades are released. Anything you want kept private belongs in Internal notes."
            : "Your teacher will be notified and can reply here."}
        </p>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------- drafts -- */

/**
 * Where an unposted comment waits.
 *
 * EVERY ACCESS IS WRAPPED. `localStorage` is not merely empty in a private
 * window or with site data blocked — reading it THROWS, and an exception here
 * would take down the whole marking panel over a feature whose entire purpose
 * is convenience. A lost draft is a nuisance; a blank screen is an outage.
 */
const draftKey = (submissionId: string): string => `lms.comment-draft.${submissionId}`;

function readDraft(submissionId: string): string {
  try {
    return window.localStorage.getItem(draftKey(submissionId)) ?? "";
  } catch {
    return "";
  }
}

function writeDraft(submissionId: string, body: string): void {
  try {
    // An empty draft is a removal, not a stored empty string: otherwise every
    // submission a marker so much as opens leaves a key behind for ever.
    if (body.trim() === "") window.localStorage.removeItem(draftKey(submissionId));
    else window.localStorage.setItem(draftKey(submissionId), body);
  } catch {
    // Storage full, or blocked. The comment box still works; it just will not
    // survive being closed.
  }
}

function clearDraft(submissionId: string): void {
  try {
    window.localStorage.removeItem(draftKey(submissionId));
  } catch {
    // See above.
  }
}
