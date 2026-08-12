import { useEffect, useState } from "react";
import { ApiError, api } from "../api/client";
import { useAuth } from "../auth/AuthContext";

interface Note {
  id: string;
  body: string;
  createdAt: string;
  author: { id: string; fullName: string };
  sectionSubject: {
    id: string;
    subject: { code: string; name: string };
    section: { code: string };
  };
}

/**
 * Staff notes about one student — FR-REG-046.
 *
 * THE STUDENT CANNOT SEE THIS COMPONENT OR ITS DATA. That is enforced on the
 * server twice — §4.5 grants a student no action on `internal_note`, and the
 * scope policy denies them outright — and this is only the third place, which
 * protects nobody by itself. It is here so the interface does not offer
 * something that would be refused.
 *
 * THE WARNING IS NOT DECORATION. Somebody typing a sentence about a student's
 * home circumstances should be told, at that moment, who will read it: their
 * colleagues on this class, and the office. Saying it afterwards is too late,
 * so it sits above the box rather than below the button.
 */
export function StudentNotes({
  studentId,
  studentName,
  sectionSubjectId,
}: {
  studentId: string;
  studentName: string;
  sectionSubjectId: string;
}) {
  const { user, hasRole } = useAuth();
  const mayWrite = hasRole("teacher", "super_admin");

  const [notes, setNotes] = useState<Note[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [editBody, setEditBody] = useState("");

  async function load() {
    try {
      setNotes(await api.get<Note[]>(`/students/${studentId}/notes`));
    } catch (e) {
      setError(e instanceof ApiError ? e : null);
      setNotes([]);
    }
  }

  useEffect(() => {
    void load();
  }, [studentId]);

  async function run(work: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await work();
      await load();
      return true;
    } catch (e) {
      setError(e instanceof ApiError ? e : null);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function add() {
    const ok = await run(() =>
      api.post(`/students/${studentId}/notes`, { sectionSubjectId, body: draft }),
    );
    if (ok) setDraft("");
  }

  async function saveEdit(id: string) {
    const ok = await run(() => api.patch(`/student-notes/${id}`, { body: editBody }));
    if (ok) setEditing(null);
  }

  async function remove(id: string) {
    if (!window.confirm("Delete this note? Your colleagues will no longer see it.")) return;
    await run(() => api.del(`/student-notes/${id}`));
  }

  if (!notes) return <p className="muted small">Loading notes…</p>;

  return (
    <div className="notes-panel">
      <h4>Staff notes on {studentName}</h4>

      {error && (
        <p className="warn small" role="alert">
          {error.details?.map((d) => d.message).join(" ") ?? error.message}
        </p>
      )}

      {notes.length === 0 ? (
        <p className="muted small">No notes yet.</p>
      ) : (
        <ul className="note-list">
          {notes.map((n) => {
            const mine = n.author.id === user?.id;
            return (
              <li key={n.id}>
                {editing === n.id ? (
                  <>
                    <textarea
                      rows={3}
                      aria-label="Edit note"
                      value={editBody}
                      onChange={(e) => setEditBody(e.target.value)}
                    />
                    <div className="row-actions">
                      <button
                        className="btn btn-primary btn-sm"
                        disabled={busy}
                        onClick={() => void saveEdit(n.id)}
                      >
                        Save
                      </button>
                      <button className="btn btn-quiet btn-sm" onClick={() => setEditing(null)}>
                        Cancel
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <p>{n.body}</p>
                    <p className="muted small">
                      {n.author.fullName} · {new Date(n.createdAt).toLocaleDateString()} ·{" "}
                      {n.sectionSubject.section.code} {n.sectionSubject.subject.code}
                    </p>
                    {/* Only the author. Two teachers of the same class can both
                        READ each other's notes — they are colleagues — but
                        neither may rewrite the other's words. */}
                    {mine && (
                      <div className="row-actions">
                        <button
                          className="btn btn-quiet btn-sm"
                          onClick={() => {
                            setEditing(n.id);
                            setEditBody(n.body);
                          }}
                        >
                          Edit
                        </button>
                        <button
                          className="btn btn-quiet btn-sm"
                          disabled={busy}
                          onClick={() => void remove(n.id)}
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {mayWrite && (
        <>
          <p className="warn small">
            Visible to the staff who teach this class and to the office. Never to the student.
          </p>
          <textarea
            rows={3}
            aria-label={`Add a note about ${studentName}`}
            placeholder="What would help a colleague teaching this student?"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <button
            className="btn btn-sm"
            disabled={busy || draft.trim().length < 3}
            onClick={() => void add()}
          >
            {busy ? "Saving…" : "Add note"}
          </button>
        </>
      )}
    </div>
  );
}
