import { useCallback, useEffect, useState } from "react";
import { EmptyState, Skeleton } from "../components/Ui";
import { Icon } from "../components/Icon";
import { ApiError, api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { HowItWorks } from "../components/HowItWorks";

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
  /** NORMAL | IMPORTANT | URGENT. See PRIORITY below for what each one does. */
  priority?: string;
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

      <HowItWorks
        id="announcements"
        title="Telling people things"
        intro="Notices that reach students in the System, and — if you choose — visitors on the public page."
        steps={[
          { icon: "users", title: "Choose who it reaches", body: "The whole Institute, one section, or one class." },
          { icon: "pen", title: "Write it", body: "A clear title. Many people read only that." },
          { icon: "clock", title: "Set when it stops", body: "An expiry takes it down by itself. An event that has happened is not news." },
          { icon: "megaphone", title: "Post it", body: "It appears immediately for everybody it was addressed to." },
        ]}
        note="Only a notice addressed to the whole Institute can be shown publicly. One written for a section was written for those students, and the System will not put it on the public page."
      />

      {error && (
        <div className="alert alert-error" role="alert">
          <p>{error}</p>
        </div>
      )}

      {mayPost && <Composer onPosted={load} />}

      {!items ? (
        <Skeleton lines={2} />
      ) : items.length === 0 ? (
        <EmptyState icon="megaphone" title="No announcements yet">
          Notices from the Institute appear here. There is nothing you need to do — you
          will be notified when something is posted.
        </EmptyState>
      ) : (
        items.map((a) => {
          const level = PRIORITY[a.priority ?? (a.isUrgent ? "URGENT" : "NORMAL")] ?? PRIORITY["NORMAL"]!;
          return (
            <section
              className={`card announcement announcement-${level.key.toLowerCase()}`}
              key={a.id}
            >
              {/*
                THE BAND IS THE POINT, and it is a WORD on a colour rather
                than a colour alone (NFR-ACC-007). Urgent used to render as
                "Urgent · " in small text before the title — the same weight as
                the date beside it — which is not a way of saying something
                matters, it is a way of mentioning it.
              */}
              {level.key !== "NORMAL" && (
                <p className="announcement-band">
                  <Icon name={level.icon} />
                  <strong>{level.label}</strong>
                  <span>{level.note}</span>
                </p>
              )}

              <div className="assignment-head">
                <h2>
                  {a.isPinned && (
                    <span className="pill announcement-pin" title="Kept at the top of the list">
                      <Icon name="panel" /> Pinned
                    </span>
                  )}
                  {a.title}
                </h2>
                <span className="muted small">
                  {new Date(a.publishedAt).toLocaleDateString(undefined, {
                    day: "numeric",
                    month: "short",
                  })}
                </span>
              </div>
              <p className="muted small">
                {a.authorName} · {a.about}
              </p>
              <p className="announcement-body">{a.body}</p>
            </section>
          );
        })
      )}
    </>
  );
}

/**
 * HOW MUCH AN ANNOUNCEMENT MATTERS, in one table read by the card and the
 * composer alike.
 *
 * THREE LEVELS AND NOT MORE. Two is not enough — everything between a room
 * change and an emergency had to be dressed as an emergency or lost in the
 * list, and a notice board where everything is urgent is one nobody reads.
 * Four would mean an author having to decide between "important" and "very
 * important", which is a decision with no consequence attached to it.
 *
 * URGENT IS THE ONLY ONE THAT DOES ANYTHING BEYOND LOOK DIFFERENT: BR-COM-02
 * makes it ignore a recipient's quiet hours. The note on each level says so,
 * because an author choosing red should know they are waking somebody up.
 */
const PRIORITY: Record<
  string,
  { key: string; label: string; icon: string; note: string; help: string }
> = {
  NORMAL: {
    key: "NORMAL",
    label: "Normal",
    icon: "megaphone",
    note: "",
    help: "Appears in the list and the inbox. Held back during quiet hours.",
  },
  IMPORTANT: {
    key: "IMPORTANT",
    label: "Important",
    icon: "alert",
    note: "Please read this one.",
    help: "Stands out in amber. Still respects quiet hours.",
  },
  URGENT: {
    key: "URGENT",
    label: "Urgent",
    icon: "alert",
    note: "Needs attention now.",
    help: "Red, and the only level that IGNORES quiet hours — it reaches people at night. Use it when that is genuinely warranted.",
  },
};

function Composer({ onPosted }: { onPosted: () => void }) {
  const { hasRole } = useAuth();
  const [sections, setSections] = useState<TeacherSection[]>([]);
  const [audience, setAudience] = useState<"INSTITUTE" | "SECTION_SUBJECT">("SECTION_SUBJECT");
  const [sectionSubjectId, setSectionSubjectId] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [priority, setPriority] = useState<"NORMAL" | "IMPORTANT" | "URGENT">("NORMAL");
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
        priority,
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
      setPriority("NORMAL");
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

      {/*
        HOW MUCH IT MATTERS — three buttons rather than a checkbox called
        "Urgent".

        A checkbox offers two states and no middle, so everything that was more
        than routine and less than an emergency got ticked. Shown as a row, the
        levels are visible at once and each carries the consequence of choosing
        it — which is what an author needs before they pick red, not after.
      */}
      <fieldset className="field priority-picker">
        <legend>How much does this matter?</legend>
        <div className="priority-options">
          {(["NORMAL", "IMPORTANT", "URGENT"] as const).map((key) => {
            const level = PRIORITY[key]!;
            return (
              <label
                key={key}
                className={
                  priority === key
                    ? `priority-option is-on priority-${key.toLowerCase()}`
                    : "priority-option"
                }
              >
                <input
                  type="radio"
                  name="priority"
                  checked={priority === key}
                  onChange={() => setPriority(key)}
                />
                <span>
                  <strong>
                    {key !== "NORMAL" && <Icon name={level.icon} />}
                    {level.label}
                  </strong>
                  <span className="muted small">{level.help}</span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="row-actions">
        <label className="option">
          <input type="checkbox" checked={isPinned} onChange={(e) => setIsPinned(e.target.checked)} />
          {/* A SEPARATE AXIS from priority, and the label says so: the term
              dates are worth keeping at the top and are not urgent, and an
              urgent notice usually passes. */}
          <span>Keep at the top of the list</span>
        </label>
      </div>

      {priority === "URGENT" && (
        // BR-COM-02 — urgency has a cost, and the person choosing it should
        // know what it is before they do.
        // NOT `alert-error`, deliberately. It carries the error PALETTE
        // because the consequence is serious, and it is not an error: nothing
        // has gone wrong, and `role="alert"` would interrupt a screen reader
        // the moment somebody tabs onto the radio. `role="status"` announces
        // it politely, which is what a consequence notice should do.
        <div className="alert alert-consequence" role="status">
          <strong>This will reach people during their quiet hours.</strong>
          <p className="small">
            An urgent announcement ignores muted topics and night-time suppression. Use it when
            waiting until morning would be worse.
          </p>
        </div>
      )}

      {error && (
        <div className="alert alert-error" role="alert">
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
