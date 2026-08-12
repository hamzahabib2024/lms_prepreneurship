import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { ApiError, api } from "../api/client";
import { useAuth } from "../auth/AuthContext";

/**
 * Discussion — SRS §13.13, FR-DSC-001..012.
 *
 * A REMOVED POST STILL OCCUPIES ITS PLACE, and the screen says what it is
 * rather than hiding it. A thread that silently loses its question reads as
 * answers to nothing; "This question was removed" is short and true, and it
 * keeps the replies making sense.
 *
 * AN EDIT MARKER IS SHOWN WHEREVER THE POST IS. It is the whole reason the
 * server records it: a thread whose answers changed after people read them is
 * unreadable without it.
 *
 * What somebody may do is not guessed at here. The buttons are offered on the
 * author's own posts and to a teacher, and the server refuses anything else
 * with a sentence the screen prints as written — "Posts can be edited for 30
 * minutes. After that, add a reply correcting yourself."
 */

interface Post {
  id: string;
  title: string | null;
  body: string | null;
  removed: boolean;
  removedByModerator: boolean;
  author: string | null;
  authorUserId: string | null;
  isPinned: boolean;
  isLocked: boolean;
  editedAt: string | null;
  createdAt: string;
  replyCount: number;
}

interface Thread extends Post {
  replies: Post[];
}

interface Offering {
  id: string;
  label: string;
}

export function DiscussionPage() {
  const { sectionSubjectId } = useParams();
  const { user, hasRole } = useAuth();
  const isTeacher = hasRole("super_admin", "admin", "teacher");

  const [offerings, setOfferings] = useState<Offering[]>([]);
  const [offeringId, setOfferingId] = useState(sectionSubjectId ?? "");
  const [threads, setThreads] = useState<Post[] | null>(null);
  const [open, setOpen] = useState<Thread | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const sections = await api.get<Array<{ id: string; code: string }>>("/sections");
        const found: Offering[] = [];
        for (const s of sections) {
          const subs = await api.get<Array<{ id: string; subject: { code: string; name: string } }>>(
            `/sections/${s.id}/subjects`,
          );
          for (const o of subs) {
            found.push({ id: o.id, label: `${o.subject.code} ${o.subject.name} — ${s.code}` });
          }
        }
        setOfferings(found);
        if (!offeringId && found[0]) setOfferingId(found[0].id);
      } catch {
        setOfferings([]);
      }
    })();
    // Deliberately once: the list of a person's classes does not change while
    // they read a thread.
  }, []);

  const loadThreads = useCallback(() => {
    if (!offeringId) return;
    api
      .get<Post[]>(`/section-subjects/${offeringId}/discussions`)
      .then(setThreads)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load the discussion."));
  }, [offeringId]);

  useEffect(loadThreads, [loadThreads]);

  const openThread = (id: string) =>
    api
      .get<Thread>(`/discussions/${id}`)
      .then(setOpen)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not open that thread."));

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Discussion</h1>
          <p className="muted small">Ask a question; your class and your teacher can answer.</p>
        </div>
        {open && (
          <button
            className="btn btn-quiet"
            onClick={() => {
              setOpen(null);
              loadThreads();
            }}
          >
            Back to the questions
          </button>
        )}
      </header>

      {error && (
        <div className="alert alert-error" role="alert">
          <p>{error}</p>
        </div>
      )}

      {!open && offerings.length > 1 && (
        <section className="card">
          <label className="field">
            <span>Which class</span>
            <select
              value={offeringId}
              onChange={(e) => {
                setOfferingId(e.target.value);
                setThreads(null);
              }}
            >
              {offerings.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        </section>
      )}

      {open ? (
        <ThreadView
          thread={open}
          myUserId={user?.id ?? ""}
          isTeacher={isTeacher}
          onChanged={() => void openThread(open.id)}
          onError={setError}
        />
      ) : (
        <>
          {offeringId && <Ask offeringId={offeringId} onAsked={loadThreads} onError={setError} />}
          {!threads ? (
            <p className="muted">Loading…</p>
          ) : threads.length === 0 ? (
            <div className="card">
              <p className="muted">
                No questions yet. Asking one is how the rest of the class finds out they had the
                same problem.
              </p>
            </div>
          ) : (
            <section className="card">
              <ul className="list">
                {threads.map((t) => (
                  <li key={t.id} className="assignment">
                    <div className="assignment-head">
                      <span>
                        <button className="link-button" onClick={() => void openThread(t.id)}>
                          {t.removed ? "Question removed" : (t.title ?? "Untitled")}
                        </button>
                        <br />
                        <span className="muted small">
                          {t.removed ? "—" : (t.author ?? "Unknown")} ·{" "}
                          {new Date(t.createdAt).toLocaleDateString()} · {t.replyCount}{" "}
                          {t.replyCount === 1 ? "answer" : "answers"}
                        </span>
                      </span>
                      <span className="row-actions">
                        {t.isPinned && <span className="pill">Pinned</span>}
                        {t.isLocked && <span className="muted small">Closed</span>}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </>
  );
}

function Ask({
  offeringId,
  onAsked,
  onError,
}: {
  offeringId: string;
  onAsked: () => void;
  onError: (m: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: "", body: "" });
  const [busy, setBusy] = useState(false);

  if (!open) {
    return (
      <section className="card">
        <button className="btn btn-primary" onClick={() => setOpen(true)}>
          Ask a question
        </button>
      </section>
    );
  }

  return (
    <section className="card">
      <label className="field">
        <span>Question</span>
        <input
          value={form.title}
          autoFocus
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          placeholder="How do I export at 300dpi?"
        />
      </label>
      <label className="field">
        <span>Anything else worth knowing</span>
        <textarea
          rows={4}
          value={form.body}
          onChange={(e) => setForm({ ...form, body: e.target.value })}
          placeholder="What you have tried, and what happened."
        />
      </label>
      <span className="row-actions">
        <button
          className="btn btn-primary"
          disabled={busy || form.body.trim().length < 2}
          onClick={() => {
            setBusy(true);
            api
              .post(`/section-subjects/${offeringId}/discussions`, form)
              .then(() => {
                setForm({ title: "", body: "" });
                setOpen(false);
                onAsked();
              })
              .catch((e) =>
                onError(
                  e instanceof ApiError
                    ? (e.details?.map((d) => d.message).join(" ") ?? e.message)
                    : "That did not post.",
                ),
              )
              .finally(() => setBusy(false));
          }}
        >
          {busy ? "Posting…" : "Post"}
        </button>
        <button className="btn btn-quiet" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </span>
    </section>
  );
}

function ThreadView({
  thread,
  myUserId,
  isTeacher,
  onChanged,
  onError,
}: {
  thread: Thread;
  myUserId: string;
  isTeacher: boolean;
  onChanged: () => void;
  onError: (m: string) => void;
}) {
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);

  const act = (run: Promise<unknown>) => {
    setBusy(true);
    run
      .then(onChanged)
      .catch((e) =>
        onError(
          e instanceof ApiError
            ? // The server's sentence, as written. "Posts can be edited for 30
              // minutes. After that, add a reply correcting yourself" says what
              // to do; a generic failure does not.
              (e.details?.map((d) => d.message).join(" ") ?? e.message)
            : "That did not work.",
        ),
      )
      .finally(() => setBusy(false));
  };

  return (
    <>
      <section className="card">
        <div className="assignment-head">
          <h2>{thread.removed ? "Question removed" : (thread.title ?? "Untitled")}</h2>
          <span className="row-actions">
            {isTeacher && !thread.removed && (
              <>
                <button
                  className="btn btn-quiet"
                  disabled={busy}
                  onClick={() =>
                    act(api.post(`/discussions/${thread.id}/moderate`, { isPinned: !thread.isPinned }))
                  }
                >
                  {thread.isPinned ? "Unpin" : "Pin"}
                </button>
                <button
                  className="btn btn-quiet"
                  disabled={busy}
                  onClick={() =>
                    act(api.post(`/discussions/${thread.id}/moderate`, { isLocked: !thread.isLocked }))
                  }
                >
                  {thread.isLocked ? "Reopen" : "Close"}
                </button>
              </>
            )}
          </span>
        </div>
        <PostBody post={thread} myUserId={myUserId} isTeacher={isTeacher} onAct={act} busy={busy} />
      </section>

      <section className="card">
        <h2>
          {thread.replies.length} {thread.replies.length === 1 ? "answer" : "answers"}
        </h2>
        {thread.replies.length === 0 ? (
          <p className="muted small">Nobody has answered yet.</p>
        ) : (
          <ul className="list">
            {thread.replies.map((r) => (
              <li key={r.id}>
                <PostBody post={r} myUserId={myUserId} isTeacher={isTeacher} onAct={act} busy={busy} />
              </li>
            ))}
          </ul>
        )}

        {thread.isLocked ? (
          <p className="muted small">
            This thread is closed. Start a new question if yours is still open.
          </p>
        ) : (
          <>
            <label className="field">
              <span>Your answer</span>
              <textarea rows={3} value={reply} onChange={(e) => setReply(e.target.value)} />
            </label>
            <button
              className="btn btn-primary"
              disabled={busy || reply.trim().length < 2}
              onClick={() => {
                act(api.post(`/discussions/${thread.id}/replies`, { body: reply }));
                setReply("");
              }}
            >
              Answer
            </button>
          </>
        )}
      </section>
    </>
  );
}

function PostBody({
  post: p,
  myUserId,
  isTeacher,
  onAct,
  busy,
}: {
  post: Post;
  myUserId: string;
  isTeacher: boolean;
  onAct: (run: Promise<unknown>) => void;
  busy: boolean;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const mine = p.authorUserId === myUserId;

  if (p.removed) {
    // Said, not hidden. A thread that silently loses its question reads as
    // answers to nothing.
    return (
      <p className="muted small">
        {p.removedByModerator ? "Removed by a teacher." : "Removed by the person who wrote it."}
      </p>
    );
  }

  return (
    <div>
      <p className="muted small">
        {p.author ?? "Unknown"} · {new Date(p.createdAt).toLocaleString()}
        {/* Wherever the post appears. It is why the server records it. */}
        {p.editedAt && <span> · edited {new Date(p.editedAt).toLocaleString()}</span>}
      </p>

      {editing === null ? (
        <p style={{ whiteSpace: "pre-wrap" }}>{p.body}</p>
      ) : (
        <>
          <textarea
            rows={4}
            className="field"
            value={editing}
            onChange={(e) => setEditing(e.target.value)}
          />
          <span className="row-actions">
            <button
              className="btn btn-primary"
              disabled={busy || editing.trim().length < 2}
              onClick={() => {
                onAct(api.patch(`/discussions/${p.id}`, { body: editing }));
                setEditing(null);
              }}
            >
              Save
            </button>
            <button className="btn btn-quiet" onClick={() => setEditing(null)}>
              Cancel
            </button>
          </span>
        </>
      )}

      {editing === null && (mine || isTeacher) && (
        <span className="row-actions">
          {mine && (
            <button className="btn btn-quiet" disabled={busy} onClick={() => setEditing(p.body ?? "")}>
              Edit
            </button>
          )}
          <button
            className="btn btn-quiet"
            disabled={busy}
            onClick={() => {
              // A teacher removing somebody else's post gives a reason; the
              // author is told what it was.
              const reason =
                !mine && isTeacher
                  ? window.prompt("Why is this being removed? The author is told.") ?? undefined
                  : undefined;
              if (!mine && isTeacher && !reason) return;
              onAct(api.del(`/discussions/${p.id}`, reason ? { reason } : {}));
            }}
          >
            {mine ? "Remove" : "Remove as moderator"}
          </button>
        </span>
      )}
    </div>
  );
}
