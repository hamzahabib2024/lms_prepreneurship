import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "../api/client";
import { useAuth } from "../auth/AuthContext";

/**
 * Announcements — SRS §13.2, FR-COM-002/008.
 *
 * One page for reading and, for those who may, for posting. A teacher who has
 * to go somewhere else to write is a teacher who writes less, and the whole
 * point of this module is that the Institute stops relying on WhatsApp groups
 * nobody can search.
 */

interface Announcement {
  id: string;
  audience: string;
  title: string;
  body: string;
  isPinned: boolean;
  isUrgent: boolean;
  publishedAt: string;
  authorName: string;
  about: string;
}

interface TeacherSection {
  sectionSubjectId: string;
  subject: { name: string };
  section: { code: string };
}

export function AnnouncementsPage() {
  const { hasRole } = useAuth();
  const [items, setItems] = useState<Announcement[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .get<Announcement[]>("/announcements")
      .then(setItems)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load announcements."));
  }, []);

  useEffect(load, [load]);

  const mayPost = hasRole("super_admin", "admin", "teacher");

  return (
    <>
      <header className="page-head">
        <h1>Announcements</h1>
      </header>

      {error && (
        <div className="alert alert-error">
          <p>{error}</p>
        </div>
      )}

      {mayPost && <Composer onPosted={load} />}

      {!items ? (
        <p className="muted">Loading…</p>
      ) : items.length === 0 ? (
        <div className="card">
          <p className="muted">Nothing has been announced yet.</p>
        </div>
      ) : (
        items.map((a) => (
          <section className="card" key={a.id}>
            <div className="assignment-head">
              <h2>
                {/* Pinned and urgent are stated, not just styled
                    (NFR-ACC-003). */}
                {a.isPinned && <span className="small">📌 Pinned · </span>}
                {a.isUrgent && <span className="warn small">Urgent · </span>}
                {a.title}
              </h2>
              <span className="muted small">
                {new Date(a.publishedAt).toLocaleDateString()}
              </span>
            </div>
            <p className="muted small">
              {a.authorName} · {a.about}
            </p>
            <p className="announcement-body">{a.body}</p>
          </section>
        ))
      )}
    </>
  );
}

function Composer({ onPosted }: { onPosted: () => void }) {
  const { hasRole } = useAuth();
  const [sections, setSections] = useState<TeacherSection[]>([]);
  const [audience, setAudience] = useState<"INSTITUTE" | "SECTION_SUBJECT">("SECTION_SUBJECT");
  const [sectionSubjectId, setSectionSubjectId] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [isUrgent, setIsUrgent] = useState(false);
  const [isPinned, setIsPinned] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [posted, setPosted] = useState<string | null>(null);

  const mayAddressInstitute = hasRole("super_admin", "admin");

  useEffect(() => {
    api
      .get<{ widgets: { mySections?: TeacherSection[] } }>("/dashboards/me")
      .then((d) => setSections(d.widgets.mySections ?? []))
      .catch(() => setSections([]));
  }, []);

  const post = async () => {
    setBusy(true);
    setError(null);
    setPosted(null);
    try {
      const result = await api.post<{ notified: number }>("/announcements", {
        audience,
        ...(audience === "SECTION_SUBJECT" ? { sectionSubjectId } : {}),
        title,
        body,
        isUrgent,
        isPinned,
      });
      // The count matters: a teacher should know whether they just reached
      // thirty people or nobody.
      setPosted(
        result.notified === 0
          ? "Posted, but nobody is currently in that audience."
          : `Posted. ${result.notified} ${result.notified === 1 ? "person was" : "people were"} notified.`,
      );
      setTitle("");
      setBody("");
      setIsUrgent(false);
      setIsPinned(false);
      onPosted();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "That could not be posted.");
    } finally {
      setBusy(false);
    }
  };

  const targetChosen = audience === "INSTITUTE" || sectionSubjectId !== "";

  return (
    <section className="card">
      <h2>Post an announcement</h2>

      <div className="field-row">
        <label className="field">
          <span>Audience</span>
          <select
            value={audience}
            onChange={(e) => setAudience(e.target.value as typeof audience)}
          >
            <option value="SECTION_SUBJECT">One of my subjects</option>
            {mayAddressInstitute && <option value="INSTITUTE">Everyone at the Institute</option>}
          </select>
        </label>

        {audience === "SECTION_SUBJECT" && (
          <label className="field">
            <span>Subject</span>
            <select
              value={sectionSubjectId}
              onChange={(e) => setSectionSubjectId(e.target.value)}
            >
              <option value="">Choose…</option>
              {sections.map((s) => (
                <option key={s.sectionSubjectId} value={s.sectionSubjectId}>
                  {s.subject.name} — {s.section.code}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <label className="field">
        <span>Title</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
      </label>

      <label className="field">
        <span>Message</span>
        <textarea rows={4} value={body} onChange={(e) => setBody(e.target.value)} />
      </label>

      <div className="row-actions">
        <label className="option">
          <input type="checkbox" checked={isPinned} onChange={(e) => setIsPinned(e.target.checked)} />
          <span>Pin to the top</span>
        </label>
        <label className="option">
          <input type="checkbox" checked={isUrgent} onChange={(e) => setIsUrgent(e.target.checked)} />
          <span>Urgent</span>
        </label>
      </div>
      {isUrgent && (
        // BR-COM-02 — urgency has a cost, and the person choosing it should
        // know what it is before they do.
        <p className="muted small">
          An urgent announcement reaches people during their quiet hours and ignores
          their muted topics. Use it when waiting until morning would be worse.
        </p>
      )}

      {error && (
        <div className="alert alert-error">
          <p>{error}</p>
        </div>
      )}
      {posted && <p className="small">{posted}</p>}

      <button
        className="btn btn-primary"
        onClick={() => void post()}
        disabled={busy || title.trim() === "" || body.trim() === "" || !targetChosen}
      >
        {busy ? "Posting…" : "Post"}
      </button>
    </section>
  );
}
