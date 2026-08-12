import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "../api/client";

/**
 * The messages the System sends — SRS §13.13, FR-NOT-020..026.
 *
 * THE PREVIEW IS THE POINT OF THE SCREEN. Nobody can tell what
 * "Certificate {certificateNo} is ready for {subject}" becomes by reading it,
 * and the cost of finding out afterwards is a message a student already
 * received. So every message shows what it turns into, filled with invented
 * people, and the preview updates as you type.
 *
 * WHAT IS EDITED AND WHAT IS INHERITED IS VISIBLE AT A GLANCE. An Institute
 * that has reworded two of six messages needs to see which two — otherwise the
 * only way to know is to compare each against a default it cannot see.
 */

interface Rendered {
  title: string;
  body: string;
  missing: string[];
}

interface Template {
  kind: string;
  label: string;
  description: string;
  placeholders: string[];
  title: string;
  body: string;
  defaultTitle: string;
  defaultBody: string;
  source: "DEFAULT" | "INSTITUTE";
  updatedAt: string | null;
  preview: Rendered;
}

/** The same example values the server previews with, so the two agree. */
const EXAMPLES: Record<string, string> = {
  studentName: "Ayesha Khan",
  certificateNo: "CERT/2026/00042",
  subject: "Graphic Designing",
  programme: "Diploma in Graphic Designing",
  assignment: "Logo redesign",
  quiz: "Typography basics",
  percentage: "68",
  threshold: "75",
  amount: "Rs 30,000",
  dueDate: "30 September 2026",
  daysOverdue: "12",
};

/**
 * The same rule the server applies: a missing value collapses and never
 * appears as a brace.
 *
 * Duplicated here ON PURPOSE, and it is the one duplication on this screen.
 * The alternative is a request per keystroke, and a preview that lags behind
 * the typing is a preview nobody trusts. The server's version is the one that
 * decides what is sent; this one only has to agree closely enough to be
 * useful, and the saved result is re-read from the server afterwards.
 */
function previewLocally(text: string, placeholders: string[]): string {
  return text
    .replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g, (_, name: string) =>
      placeholders.includes(name) ? (EXAMPLES[name] ?? name) : "",
    )
    .replace(/""|''/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .replace(/^[\s.,;:!?]+/, "")
    .trim();
}

export function TemplatesPage() {
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .get<Template[]>("/notification-templates")
      .then(setTemplates)
      .catch((e) =>
        setError(e instanceof ApiError ? e.message : "Could not load the messages."),
      );
  }, []);

  useEffect(load, [load]);

  if (error && !templates) {
    return (
      <div className="alert alert-error" role="alert">
        <p>{error}</p>
      </div>
    );
  }
  if (!templates) return <p className="muted">Loading…</p>;

  const edited = templates.filter((t) => t.source === "INSTITUTE").length;

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Messages</h1>
          <p className="muted small">
            What the System says when it writes to a student. {edited === 0
              ? "None has been reworded yet — every one below is the System's own wording."
              : `${edited} of ${templates.length} reworded by the Institute.`}
          </p>
        </div>
      </header>

      {error && (
        <div className="alert alert-error" role="alert">
          <p>{error}</p>
        </div>
      )}
      {notice && (
        <div className="alert">
          <p>{notice}</p>
        </div>
      )}

      {templates.map((t) => (
        <TemplateCard
          key={t.kind}
          template={t}
          onSaved={(what) => {
            setNotice(what);
            setError(null);
            load();
          }}
          onError={(e) => {
            setError(e);
            setNotice(null);
          }}
        />
      ))}
    </>
  );
}

function TemplateCard({
  template: t,
  onSaved,
  onError,
}: {
  template: Template;
  onSaved: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [title, setTitle] = useState(t.title);
  const [body, setBody] = useState(t.body);
  const [busy, setBusy] = useState(false);

  // The card is remounted on reload because the list is keyed by kind and the
  // server's values come back as the new props; resetting here keeps a card
  // the user has not touched in step with them.
  useEffect(() => {
    setTitle(t.title);
    setBody(t.body);
  }, [t.title, t.body]);

  const changed = title !== t.title || body !== t.body;
  const previewTitle = previewLocally(title, t.placeholders);
  const previewBody = previewLocally(body, t.placeholders);

  const run = async (what: () => Promise<unknown>, said: string) => {
    setBusy(true);
    try {
      await what();
      onSaved(said);
    } catch (e) {
      onError(
        e instanceof ApiError
          ? (e.details?.map((d) => d.message).join(" ") ?? e.message)
          : "That did not work.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <div className="assignment-head">
        <span>
          <h2>{t.label}</h2>
          <span className="muted small">{t.description}</span>
        </span>
        {/* Which messages the Institute has actually changed, without having
            to compare each against a default it cannot see. */}
        <span className={t.source === "INSTITUTE" ? "stat" : "muted small"}>
          {t.source === "INSTITUTE" ? "Reworded by the Institute" : "System wording"}
        </span>
      </div>

      <label className="field">
        <span>Title</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>

      <label className="field">
        <span>Message</span>
        <textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} />
      </label>

      <p className="muted small">
        You can use:{" "}
        {t.placeholders.map((p) => (
          <button
            key={p}
            type="button"
            className="btn btn-quiet"
            // Inserting rather than only listing. Typing {certificateNo} by
            // hand is how {certificateNumber} gets saved and refused.
            onClick={() => setBody((b) => `${b}{${p}}`)}
          >
            {`{${p}}`}
          </button>
        ))}
      </p>

      {/* The whole point of the screen. */}
      <div className="alert">
        <p className="muted small">A student would receive:</p>
        <p>
          <strong>{previewTitle}</strong>
        </p>
        <p>{previewBody}</p>
      </div>

      <span className="row-actions">
        <button
          className="btn btn-primary"
          disabled={busy || !changed}
          onClick={() =>
            void run(
              () => api.put(`/notification-templates/${t.kind}`, { title, body }),
              `"${t.label}" saved.`,
            )
          }
        >
          {busy ? "Saving…" : "Save"}
        </button>

        {changed && (
          <button
            className="btn btn-quiet"
            onClick={() => {
              setTitle(t.title);
              setBody(t.body);
            }}
          >
            Discard changes
          </button>
        )}

        {/* Only when there is something to undo. Offering "reset" on a message
            that has never been changed is a button that does nothing. */}
        {t.source === "INSTITUTE" && !changed && (
          <button
            className="btn btn-quiet"
            disabled={busy}
            onClick={() =>
              void run(
                () => api.del(`/notification-templates/${t.kind}`),
                `"${t.label}" is back to the System's wording.`,
              )
            }
          >
            Use the System's wording
          </button>
        )}
      </span>
    </section>
  );
}
