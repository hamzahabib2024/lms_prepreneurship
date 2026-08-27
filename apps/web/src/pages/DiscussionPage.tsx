import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { Skeleton } from "../components/Ui";
import { Icon } from "../components/Icon";
import { useParams } from "react-router-dom";
import { ApiError, api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Field } from "../components/Field";

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
  /** Asked or answered without the class seeing who. Staff always see. */
  isAnonymous: boolean;
  /** Whether THIS reader may see who wrote it — the server decides, not us. */
  identityVisible: boolean;
  /** A reply a teacher marked as the answer worth reading. */
  endorsedAt: string | null;
  endorsedBy: string | null;
  /** A question somebody marked settled. */
  resolvedAt: string | null;
  resolvedBy: string | null;
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
          <Field label="Which class" required><select
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
          </Field>
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
            <Skeleton lines={2} />
          ) : threads.length === 0 ? (
            <div className="card">
              <p className="muted">
                No questions yet. Asking one is how the rest of the class finds out they had the
                same problem.
              </p>
            </div>
          ) : (
            /*
              THE LIST OF CONVERSATIONS, arranged the way a messaging app
              arranges one: an initial, who asked and what about, and the
              answer count on the right where an unread badge would be. The
              whole row is the target — a title-only link is a small thing to
              hit on a phone, which is where these are read.
            */
            <section className="card chat-list-card">
              <ul className="chat-list">
                {threads.map((t) => (
                  <li key={t.id}>
                    <button className="chat-list-row" onClick={() => void openThread(t.id)}>
                      <span className="chat-avatar" aria-hidden="true">
                        {(t.removed || (t.isAnonymous && !t.identityVisible) ? "?" : (t.author ?? "?")).trim().charAt(0).toUpperCase()}
                      </span>
                      <span className="chat-list-text">
                        <span className="chat-list-title">
                          {t.isPinned && <Icon name="panel" />}
                          {t.removed ? "Question removed" : (t.title ?? "Untitled")}
                        </span>
                        <span className="muted small">
                          {t.removed ? "—" : t.isAnonymous && !t.identityVisible ? "Anonymous" : t.isAnonymous ? `Anonymous — ${t.author ?? "Unknown"}` : (t.author ?? "Unknown")} ·{" "}
                          {new Date(t.createdAt).toLocaleDateString(undefined, {
                            day: "numeric",
                            month: "short",
                          })}
                          {t.isLocked && " · Closed"}
                        </span>
                      </span>
                      {/* Where the unread badge sits in every messaging app.
                          Zero shows as a dash rather than a 0 in a circle,
                          which would read as an unread nobody can clear. */}
                      <span className={t.replyCount > 0 ? "chat-count has-any" : "chat-count"}>
                        {t.replyCount > 0 ? t.replyCount : "—"}
                      </span>
                    </button>
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
      <Field label="Question" required><input
          value={form.title}
          autoFocus
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          placeholder="How do I export at 300dpi?"
        />
      </Field>
      <Field label="Anything else worth knowing"><textarea
          rows={4}
          value={form.body}
          onChange={(e) => setForm({ ...form, body: e.target.value })}
          placeholder="What you have tried, and what happened."
        />
      </Field>
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

/**
 * A thread, as a conversation.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT LOOKS LIKE A CHAT. The people using this have a messaging app open on
 * the same phone, and the shape of a conversation — who said it, on which
 * side, in what order, with the box to reply pinned at the bottom — is the one
 * interface pattern every single student already knows. The previous rendering
 * was a card headed "3 answers" above a bulleted list, which is a forum from
 * 2004: it reads as a document rather than a conversation, and nothing about
 * it invites a reply.
 *
 * WHAT IS NOT COPIED FROM A MESSAGING APP, and deliberately:
 *
 *   NO DELIVERY OR READ RECEIPTS. This is a class discussion, not a private
 *   message, and "seen by 14" would turn a question into an attendance check.
 *
 *   NOTHING DISAPPEARS. A removed post keeps its place and says it was removed
 *   — a thread that silently loses its question reads as answers to nothing.
 *
 *   MODERATION IS VISIBLE. Pin, close, edit and remove stay exactly where they
 *   were and mean exactly what they did; chat styling is presentation, and the
 *   rules underneath it are unchanged.
 * ─────────────────────────────────────────────────────────────────────────────
 */
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
  const [anon, setAnon] = useState(false);
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);

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

  /*
   * THE NEWEST MESSAGE, IN VIEW. A conversation opened at the top is one where
   * the answer somebody came for is below the fold — which is the whole reason
   * messaging apps open at the bottom. `auto` rather than `smooth` on first
   * paint: watching a long thread scroll past on arrival is slower than being
   * there.
   */
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [thread.id, thread.replies.length]);

  const messages = [thread, ...thread.replies];

  return (
    <section className="card chat">
      <header className="chat-head">
        <div className="chat-head-text">
          <h2>{thread.removed ? "Question removed" : (thread.title ?? "Untitled")}</h2>
          <p className="muted small">
            {thread.replies.length === 0
              ? "No answers yet"
              : `${thread.replies.length} ${thread.replies.length === 1 ? "answer" : "answers"}`}
            {thread.isPinned && " · Pinned"}
            {thread.isLocked && " · Closed"}
            {thread.resolvedAt && ` · Answered${thread.resolvedBy ? ` by ${thread.resolvedBy}` : ""}`}
          </p>
        </div>
        {isTeacher && !thread.removed && (
          <span className="row-actions">
            {/*
              WHICH QUESTIONS HAS NOBODY DEALT WITH is the one thing a teacher
              opens a forum to find out, and it is unanswerable without a way
              to say a question is settled. A thread with forty replies and no
              resolution looks exactly like one nobody has touched — and the
              busiest threads are where a teacher stops looking.
            */}
            <button
              className={thread.resolvedAt ? "btn btn-quiet btn-sm" : "btn btn-sm"}
              disabled={busy}
              onClick={() =>
                act(api.post(`/discussions/${thread.id}/resolve`, { on: !thread.resolvedAt }))
              }
            >
              {thread.resolvedAt ? "Reopen" : "Mark answered"}
            </button>
            <button
              className="btn btn-quiet btn-sm"
              disabled={busy}
              onClick={() =>
                act(api.post(`/discussions/${thread.id}/moderate`, { isPinned: !thread.isPinned }))
              }
            >
              {thread.isPinned ? "Unpin" : "Pin"}
            </button>
            <button
              className="btn btn-quiet btn-sm"
              disabled={busy}
              onClick={() =>
                act(api.post(`/discussions/${thread.id}/moderate`, { isLocked: !thread.isLocked }))
              }
            >
              {thread.isLocked ? "Reopen" : "Close"}
            </button>
          </span>
        )}
      </header>

      <div className="chat-transcript">
        {messages.map((m, i) => {
          const previous = messages[i - 1];
          const newDay =
            !previous || dayOf(previous.createdAt) !== dayOf(m.createdAt);
          return (
            <Fragment key={m.id}>
              {/* A date rule, as every messaging app has: without it a thread
                  spanning a fortnight reads as one afternoon. */}
              {newDay && (
                <p className="chat-day">
                  <span>{dayLabel(m.createdAt)}</span>
                </p>
              )}
              <Bubble
                post={m}
                isQuestion={i === 0}
                myUserId={myUserId}
                isTeacher={isTeacher}
                onAct={act}
                busy={busy}
              />
            </Fragment>
          );
        })}
        <div ref={endRef} />
      </div>

      {thread.isLocked ? (
        <p className="chat-closed muted small">
          This thread is closed. Start a new question if yours is still open.
        </p>
      ) : (
        /* PINNED AT THE BOTTOM, which is where a reply box belongs and where
           every person using this has been trained to look for one. */
        <div className="chat-composer">
          {/*
            ASK WITHOUT THE CLASS SEEING WHO.
            The reason a course forum goes quiet is not untidiness — it is
            students afraid of looking ignorant in front of people they sit
            next to. This is the single change with the largest effect on
            whether it is used at all, and it says plainly that staff can
            still see, because a promise of anonymity that turns out to be
            partial is worse than none.
          */}
          <label className="chat-anon" title="Your teacher can still see who you are">
            <input
              type="checkbox"
              checked={anon}
              onChange={(e) => setAnon(e.target.checked)}
            />
            Hide my name
          </label>
          <textarea
            rows={1}
            value={reply}
            placeholder="Write an answer…"
            onChange={(e) => setReply(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends, Shift+Enter breaks the line — the messaging
              // convention. A textarea is kept rather than an input so a long
              // answer with paragraphs is still possible.
              if (e.key === "Enter" && !e.shiftKey && reply.trim().length >= 2) {
                e.preventDefault();
                act(api.post(`/discussions/${thread.id}/replies`, { body: reply, isAnonymous: anon }));
                setReply("");
              }
            }}
          />
          <button
            className="btn btn-primary chat-send"
            disabled={busy || reply.trim().length < 2}
            aria-label="Send"
            onClick={() => {
              act(api.post(`/discussions/${thread.id}/replies`, { body: reply, isAnonymous: anon }));
              setReply("");
            }}
          >
            <Icon name="chevron-right" />
          </button>
        </div>
      )}
    </section>
  );
}

/** The day a message was sent, for grouping. Local, because the reader is. */
function dayOf(iso: string): string {
  return new Date(iso).toDateString();
}

/**
 * "Today", "Yesterday", or the date.
 *
 * The two relative words carry almost all the traffic in a class discussion and
 * are what a reader actually wants; a bare date for those makes them work out
 * whether a question is live.
 */
function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "long" });
}

/** The clock time under a bubble. Nobody needs the seconds. */
function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/**
 * One message.
 *
 * MINE ON THE RIGHT, everyone else's on the left, which is the arrangement that
 * makes a conversation readable without reading the names. The author's name is
 * shown only on other people's — on your own it is you, and repeating it down
 * the right-hand side is noise.
 */
function Bubble({
  post: p,
  isQuestion,
  myUserId,
  isTeacher,
  onAct,
  busy,
}: {
  post: Post;
  isQuestion: boolean;
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
      <div className={mine ? "chat-row is-mine" : "chat-row"}>
        <p className="chat-bubble is-removed muted small">
          {p.removedByModerator ? "Removed by a teacher." : "Removed by the person who wrote it."}
        </p>
      </div>
    );
  }

  return (
    <div className={mine ? "chat-row is-mine" : "chat-row"}>
      {/* The initial, not a photograph: there is no avatar in this System and
          a coloured circle with a letter is honest about that. */}
      {!mine && <span className="chat-avatar" aria-hidden="true">{initial(p.author)}</span>}

      <div className={isQuestion ? "chat-bubble is-question" : "chat-bubble"}>
        {!mine && <span className="chat-author">{p.author ?? "Unknown"}</span>}

        {/*
          THE ANSWER WORTH READING, marked as such.

          The reason a forum beats a chat log is that somebody arriving with
          the same question next term reads ONE good answer instead of sifting
          forty replies. Nothing in a thread says which reply that is, and the
          loudest is not reliably the best — so a teacher says so, and it is
          marked wherever the reply appears.

          A TEACHER, NOT A VOTE: a student upvote measures agreement among
          people who do not yet know the answer.
        */}
        {p.endorsedAt && !isQuestion && (
          <span className="chat-endorsed">
            <Icon name="tick" />
            Answer{p.endorsedBy ? ` — endorsed by ${p.endorsedBy}` : ""}
          </span>
        )}

        {editing === null ? (
          <p className="chat-text">{p.body}</p>
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
                className="btn btn-primary btn-sm"
                disabled={busy || editing.trim().length < 2}
                onClick={() => {
                  onAct(api.patch(`/discussions/${p.id}`, { body: editing }));
                  setEditing(null);
                }}
              >
                Save
              </button>
              <button className="btn btn-quiet btn-sm" onClick={() => setEditing(null)}>
                Cancel
              </button>
            </span>
          </>
        )}

        {isTeacher && !isQuestion && !p.removed && (
          <button
            className="btn btn-quiet btn-sm chat-endorse-btn"
            disabled={busy}
            onClick={() => onAct(api.post(`/discussions/${p.id}/endorse`, { on: !p.endorsedAt }))}
          >
            {p.endorsedAt ? "Remove endorsement" : "Mark as the answer"}
          </button>
        )}

        <span className="chat-meta">
          {timeOf(p.createdAt)}
          {/* Wherever the post appears. It is why the server records it. */}
          {p.editedAt && <span> · edited</span>}
        </span>

        {editing === null && (mine || isTeacher) && (
          <span className="chat-actions">
            {mine && (
              <button
                className="link-button small"
                disabled={busy}
                onClick={() => setEditing(p.body ?? "")}
              >
                Edit
              </button>
            )}
            <button
              className="link-button small"
              disabled={busy}
              onClick={() => {
                // A teacher removing somebody else's post gives a reason; the
                // author is told what it was.
                const reason =
                  !mine && isTeacher
                    ? (window.prompt("Why is this being removed? The author is told.") ?? undefined)
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
    </div>
  );
}

/** One letter, for a System that holds no photographs. */
function initial(name: string | null): string {
  return (name ?? "?").trim().charAt(0).toUpperCase() || "?";
}
