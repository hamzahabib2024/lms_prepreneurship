import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, api } from "../api/client";
import { Skeleton } from "../components/Ui";
import { Icon, ICON_NAMES } from "../components/Icon";
import { EditorSection } from "../components/EditorPage";

/**
 * The public page, edited — FR-PUB, SRS §13.2.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS WRONG BEFORE THIS SCREEN EXISTED.
 *
 * The landing page is the only screen a stranger ever sees, and almost none of
 * it could be changed by anybody who works at the Institute:
 *
 *   THE WORDS WERE IN THE SOURCE. The headline, the paragraph under it, the two
 *   buttons, the six claims about what the Institute does well, the heading
 *   over the programme list and the closing band were string literals in
 *   LandingPage.tsx. Changing "Learn the craft" needed a developer, a build and
 *   a deployment — so it said whatever it said on the day it was written.
 *
 *   THE REST WAS BEHIND THE WRONG DOOR. Videos, photographs, the tagline and
 *   the social links WERE settings, and writing a setting is Super Admin only
 *   (§4.5), because settings decide when a student is warned and what a
 *   certificate requires. The person who runs admissions — who knows a new reel
 *   went up this morning — could look at those values and not touch them.
 *
 *   AND THE ONE SCREEN THAT COULD REACH THEM CORRUPTED THEM. The settings
 *   editor treats every `string[]` as a comma-separated, LOWERCASED list,
 *   which is right for `pdf, docx, png` and wrong for a URL: YouTube ids are
 *   case-sensitive, so pasting a link and saving it there produced a video that
 *   silently would not play.
 *
 * WHAT THIS SCREEN IS. One page holding everything a visitor sees, in the order
 * they see it, editable by an Admin as well as a Super Admin, with the default
 * beside every field so the way back is never lost. It writes through
 * `public_page:configure` — a door that reaches the Public page settings and
 * nothing else (public-page.keys.ts on the server).
 *
 * WHAT IT REFUSES TO OWN, and each refusal is deliberate:
 *
 *   THE PROGRAMME LIST is the Institute's real records. A section is advertised
 *   because it is open. Typing it here is how a front page comes to take
 *   applications for a course that closed last year.
 *
 *   THE NOTICES are real announcements somebody marked "show publicly". A
 *   second list here would drift from what the Institute actually told its
 *   students. They are shown, read-only, with the way to change them.
 *
 *   THE INSTITUTE'S NAME is printed on receipts and certificates, so it is
 *   governance rather than a heading.
 *
 * NOTHING SAVES UNTIL IT IS PRESSED, and then it all saves together — the
 * server refuses the whole set if any one field is wrong, because a front page
 * half-updated is a state nobody chose and cannot tell by looking at.
 * ─────────────────────────────────────────────────────────────────────────────
 */

type FieldType = "number" | "percent" | "boolean" | "string" | "string[]" | "weights";

interface PublicField {
  key: string;
  type: FieldType;
  description: string;
  default: unknown;
  value: unknown;
  isOverridden: boolean;
  maxLength?: number;
  multiline?: boolean;
}

interface PublicNotice {
  id: string;
  title: string;
  publishedAt: string;
  isPinned: boolean;
  expiresAt: string | null;
}

interface PublicDocument {
  fields: PublicField[];
  instituteName: string;
  news: PublicNotice[];
  previewPath: string;
}

/**
 * A draft entry is the value being typed, or `null` meaning "put this back to
 * what it was before anybody touched it" — which is a DELETE on the server, not
 * a write of the default. The distinction matters: a deleted override lets a
 * later change to the default reach this Institute; an identical stored value
 * would not.
 */
type Draft = Record<string, unknown>;

export function PublicPageEditorPage() {
  const [doc, setDoc] = useState<PublicDocument | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  /** Bumped after a save so the preview frame reloads rather than showing the
   *  page as it was before. */
  const [previewNonce, setPreviewNonce] = useState(0);

  const load = useCallback(() => {
    setLoadError(null);
    api
      .get<PublicDocument>("/public-page")
      .then((d) => {
        setDoc(d);
        // Anything typed and not saved is discarded on a reload, which is the
        // honest behaviour: the screen now shows what the page actually says.
        setDraft({});
        setFieldErrors({});
      })
      .catch((e) =>
        setLoadError(e instanceof ApiError ? e.message : "The public page could not be loaded."),
      );
  }, []);

  useEffect(load, [load]);

  const byKey = useMemo(() => {
    const map = new Map<string, PublicField>();
    for (const f of doc?.fields ?? []) map.set(f.key, f);
    return map;
  }, [doc]);

  /** What the box should show: the draft if there is one, else what is saved. */
  const current = useCallback(
    (key: string): unknown => {
      const field = byKey.get(key);
      if (key in draft) {
        // `null` means restore, and while it is pending the box shows the
        // default — which is exactly what the page will say once it is saved.
        return draft[key] === null ? field?.default : draft[key];
      }
      return field?.value;
    },
    [byKey, draft],
  );

  const setValue = useCallback((key: string, value: unknown) => {
    setDraft((d) => ({ ...d, [key]: value }));
    // A field the server complained about stops complaining as soon as it is
    // touched; leaving the message under a box somebody has since corrected is
    // how a form starts looking broken.
    setFieldErrors((e) => {
      if (!(key in e)) return e;
      const next = { ...e };
      delete next[key];
      return next;
    });
    setSaved(null);
  }, []);

  /** The changes that would actually be sent — nothing that matches what is
   *  already stored, so pressing Save twice sends nothing the second time. */
  const changes = useMemo(() => {
    const out: Draft = {};
    for (const [key, value] of Object.entries(draft)) {
      const field = byKey.get(key);
      if (!field) continue;
      if (value === null) {
        // Nothing to remove if the field was never overridden.
        if (field.isOverridden) out[key] = null;
        continue;
      }
      if (JSON.stringify(value) !== JSON.stringify(field.value)) out[key] = value;
    }
    return out;
  }, [draft, byKey]);

  const dirtyCount = Object.keys(changes).length;

  /**
   * LEAVING WITH UNSAVED WORK IS WORTH A QUESTION.
   *
   * This form is long, the Save is at the foot, and the thing being edited is
   * the Institute's front page — so closing the tab after ten minutes of typing
   * is a real loss rather than an inconvenience. The browser's own prompt is
   * used because a custom one cannot block navigation reliably.
   */
  useEffect(() => {
    if (dirtyCount === 0) return undefined;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirtyCount]);

  const save = async () => {
    if (dirtyCount === 0) return;
    setBusy(true);
    setSaveError(null);
    setFieldErrors({});
    try {
      const result = await api.put<{ changed: string[]; restored: string[]; note: string }>(
        "/public-page",
        { values: changes },
      );
      setSaved(result.note);
      setPreviewNonce((n) => n + 1);
      load();
    } catch (e) {
      if (e instanceof ApiError) {
        // The server keys each message by the setting it belongs to, so it can
        // be put under the box rather than in a banner nobody can act on.
        const perField: Record<string, string> = {};
        for (const d of e.details ?? []) {
          if (d.field && !(d.field in perField)) perField[d.field] = d.message;
        }
        setFieldErrors(perField);
        setSaveError(e.message);
      } else {
        setSaveError("Those changes could not be saved.");
      }
    } finally {
      setBusy(false);
    }
  };

  if (loadError) {
    return (
      <>
        <header className="page-head">
          <div>
            <h1>Public page</h1>
          </div>
        </header>
        <div className="alert alert-error" role="alert">
          <p>{loadError}</p>
          <div className="row-actions">
            <button type="button" className="btn btn-sm" onClick={load}>
              Try again
            </button>
          </div>
        </div>
      </>
    );
  }

  if (!doc) {
    return (
      <>
        <header className="page-head">
          <div>
            <h1>Public page</h1>
            <p className="muted small">What a visitor sees before they have an account.</p>
          </div>
        </header>
        <Skeleton lines={4} />
      </>
    );
  }

  /** Props every plain box needs, gathered once so a row is one line. */
  const bind = (key: string) => ({
    field: byKey.get(key),
    value: current(key),
    error: fieldErrors[key],
    onChange: (v: unknown) => setValue(key, v),
    onRestore: () => setValue(key, null),
  });

  const placed = new Set([
    "public.heroPill",
    "public.heroHeadline",
    "public.heroBody",
    "public.heroPrimaryCta",
    "public.heroSecondaryCta",
    "public.showStats",
    "public.showFeatures",
    "public.features",
    "public.videosHeading",
    "public.videosBlurb",
    "public.videoUrls",
    "public.imageUrls",
    "public.newsHeading",
    "public.newsBlurb",
    "public.programmesHeading",
    "public.programmesBlurb",
    "public.closingHeading",
    "public.closingBody",
    "public.closingCta",
    "public.tagline",
    "public.youtubeUrl",
    "public.tiktokUrl",
    "public.facebookUrl",
    "public.instagramUrl",
  ]);
  /*
   * ANYTHING THE LAYOUT ABOVE DOES NOT MENTION still gets a box.
   *
   * The sections below are hand-arranged, in the order a visitor meets them,
   * because that is what makes the screen usable. The cost of hand-arranging is
   * that a setting added to the catalogue later would be editable by the API
   * and invisible here — reachable by nobody, which is the exact silent failure
   * the settings guards exist to prevent. So the leftovers are listed rather
   * than dropped.
   */
  const leftovers = doc.fields.filter((f) => !placed.has(f.key));

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Public page</h1>
          <p className="muted small">
            What a visitor sees before they have an account. Changes here are live the moment they
            are saved.
          </p>
        </div>
        <div className="row-actions">
          <button
            type="button"
            className="btn"
            aria-pressed={showPreview}
            onClick={() => setShowPreview((s) => !s)}
          >
            <Icon name="monitor" />
            {showPreview ? "Hide the preview" : "Show the preview"}
          </button>
          {/*
            A real link to the real page, opened in its own tab. The address
            comes from the server rather than being written here, so the one
            place that decides where the public page lives is the one that
            serves it.
          */}
          <a className="btn btn-quiet" href={doc.previewPath} target="_blank" rel="noreferrer">
            Open the live page
          </a>
        </div>
      </header>

      {saveError && (
        <div className="alert alert-error" role="alert">
          <p>{saveError}</p>
          {Object.keys(fieldErrors).length > 0 && (
            <p className="small">
              Nothing was changed. The fields with a problem are marked below.
            </p>
          )}
        </div>
      )}

      {saved && (
        <div className="alert alert-ok">
          <p>{saved}</p>
        </div>
      )}

      <div className={showPreview ? "publicpage-split" : "publicpage-single"}>
        <div className="editor-body publicpage-form">
          {/* ─────────────────────────────────────────── the first screen ── */}
          <EditorSection
            step={1}
            title="The first screen"
            hint="The headline, the sentence under it and the two buttons. This is the whole of what most visitors read, so it is the part worth arguing about."
          >
            <TextField label="Label above the headline" {...bind("public.heroPill")} />
            <TextField label="Headline" {...bind("public.heroHeadline")} />
            <TextField label="The sentence under it" {...bind("public.heroBody")} />
            <div className="field-row">
              <TextField label="Main button" {...bind("public.heroPrimaryCta")} />
              <TextField label="Second button" {...bind("public.heroSecondaryCta")} />
            </div>
            <p className="muted small">
              Both buttons keep going where they go — the first to the application form, the second
              down to the programme list. Only the wording is yours.
            </p>
            <SwitchField label="Show the counted band" {...bind("public.showStats")} />
          </EditorSection>

          {/* ──────────────────────────────────────────────── the claims ── */}
          <EditorSection
            step={2}
            title="What the Institute does well"
            hint="The grid of cards under the first screen. Six is what fits; fewer reads better than six weak ones."
          >
            <SwitchField label="Show this section" {...bind("public.showFeatures")} />
            <FeatureListField {...bind("public.features")} />
          </EditorSection>

          {/* ───────────────────────────────────────────────── the videos ── */}
          <EditorSection
            step={3}
            title="Videos"
            hint="Paste the ordinary share link from YouTube, Shorts, TikTok, Facebook or Instagram. Nothing loads until a visitor presses play, so a long list costs them nothing until they choose to watch."
          >
            <div className="field-row">
              <TextField label="Heading" {...bind("public.videosHeading")} />
            </div>
            <TextField label="The line under it" {...bind("public.videosBlurb")} />
            <LinkListField
              label="The videos"
              addLabel="Add a video"
              placeholder="https://www.youtube.com/watch?v=…"
              emptyNote="No videos. The whole section disappears from the page rather than showing an empty shelf."
              {...bind("public.videoUrls")}
            />
          </EditorSection>

          {/* ────────────────────────────────────────── the photographs ── */}
          <EditorSection
            step={4}
            title="Photographs"
            hint="Upload pictures of the Institute — a classroom, a graduation, students working. A visitor recognises stock photography and stops believing the rest of the page."
          >
            <PhotoListField {...bind("public.imageUrls")} />
          </EditorSection>

          {/* ───────────────────────────────────────────────── the news ─── */}
          <EditorSection
            step={5}
            title="Notices"
            hint="Real announcements, not a second list. A notice reaches this page when its author marks it to show publicly — which is why it cannot be typed here."
          >
            <div className="field-row">
              <TextField label="Heading" {...bind("public.newsHeading")} />
            </div>
            <TextField label="The line under it" {...bind("public.newsBlurb")} />
            <NoticeList news={doc.news} />
          </EditorSection>

          {/* ─────────────────────────────────────────── the programmes ── */}
          <EditorSection
            step={6}
            title="Programmes"
            hint="The list itself comes from the Institute's own records: if a section is listed, it is open. Only the heading above it is written here."
          >
            <div className="field-row">
              <TextField label="Heading" {...bind("public.programmesHeading")} />
            </div>
            <TextField label="The line under it" {...bind("public.programmesBlurb")} />
            <p className="muted small">
              To change what is listed, open <Link to="/courses-admin">Courses &amp; fees</Link> —
              a programme closed there stops being advertised the same afternoon.
            </p>
          </EditorSection>

          {/* ───────────────────────────────────────── the closing band ── */}
          <EditorSection
            step={7}
            title="The last thing on the page"
            hint="For somebody who has read the whole thing and decided. It repeats one instruction and nothing else — a closing band that restates the page is a page nobody finished."
          >
            <TextField label="Heading" {...bind("public.closingHeading")} />
            <TextField label="The sentence under it" {...bind("public.closingBody")} />
            <div className="field-row">
              <TextField label="Button" {...bind("public.closingCta")} />
            </div>
          </EditorSection>

          {/* ──────────────────────────────────────────────── the footer ── */}
          <EditorSection
            step={8}
            title="Name and channels"
            hint="The foot of the page, and the one line under the Institute's name. An icon is shown only where a link is actually set — a row of dead social buttons is the mark of a template."
          >
            <div className="field">
              <span>The Institute's name</span>
              <input value={doc.instituteName} readOnly />
              <span className="muted small">
                Printed on receipts and certificates too, so it is changed in{" "}
                <Link to="/settings">Settings</Link> by a Super Admin rather than here.
              </span>
            </div>
            <TextField label="Tagline" {...bind("public.tagline")} />
            <div className="field-row">
              <TextField label="YouTube" {...bind("public.youtubeUrl")} />
              <TextField label="TikTok" {...bind("public.tiktokUrl")} />
            </div>
            <div className="field-row">
              <TextField label="Facebook" {...bind("public.facebookUrl")} />
              <TextField label="Instagram" {...bind("public.instagramUrl")} />
            </div>
          </EditorSection>

          {leftovers.length > 0 && (
            <EditorSection
              title="Also on this page"
              hint="Settings that belong to the public page and have no place of their own on this screen yet. They are shown here rather than being unreachable."
            >
              {leftovers.map((f) => (
                <GenericField key={f.key} {...bind(f.key)} />
              ))}
            </EditorSection>
          )}
        </div>

        {showPreview && (
          <aside className="publicpage-preview">
            <div className="publicpage-preview-head">
              <strong className="small">The page as it stands</strong>
              <button
                type="button"
                className="btn btn-sm btn-quiet"
                onClick={() => setPreviewNonce((n) => n + 1)}
              >
                Refresh
              </button>
            </div>
            {/*
              THE SAVED PAGE, NOT THE DRAFT, and it says so above. Rebuilding
              the landing page here from what is being typed would be a second
              implementation of it — and a preview that is a near-copy is worse
              than none, because the one thing a preview must never do is
              differ from the page.
            */}
            <iframe
              className="publicpage-frame"
              title="The public page as visitors currently see it"
              src={`${doc.previewPath}?preview=${previewNonce}`}
            />
            <p className="muted small">
              This is what is live. It catches up when you save.
            </p>
          </aside>
        )}
      </div>

      {/* THE SAVE STAYS IN VIEW. This form is far longer than a screen, and a
          save button that has scrolled away is one people assume is not there. */}
      <div className="editor-actions">
        <span className="muted small">
          {dirtyCount === 0
            ? "Nothing changed yet."
            : `${dirtyCount} ${dirtyCount === 1 ? "change" : "changes"} not saved.`}
        </span>
        <div className="row-actions">
          <button
            type="button"
            className="btn btn-quiet"
            disabled={busy || dirtyCount === 0}
            onClick={load}
          >
            Discard
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || dirtyCount === 0}
            onClick={() => void save()}
          >
            {busy ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════ fields ═══

interface Bound {
  field: PublicField | undefined;
  value: unknown;
  error: string | undefined;
  onChange: (v: unknown) => void;
  onRestore: () => void;
}

/**
 * The line under every box: what it does, how long it may be, and the way back.
 *
 * "Restore the default" appears only where there is something to restore, so
 * the row is not offering an action that would do nothing.
 */
function FieldFooter({
  field,
  value,
  error,
  onRestore,
}: {
  field: PublicField;
  value: unknown;
  error: string | undefined;
  onRestore: () => void;
}) {
  const length = typeof value === "string" ? value.length : 0;
  const over = field.maxLength !== undefined && length > field.maxLength;

  return (
    <>
      <span className="publicpage-foot">
        <span className="muted small">{field.description}</span>
        <span className="row-actions">
          {field.maxLength !== undefined && typeof value === "string" && (
            // A word as well as a colour: over-length is refused on save, and a
            // reader who cannot see red would otherwise get no warning at all.
            <span className={over ? "small publicpage-over" : "muted small"}>
              {over ? `${length} of ${field.maxLength} — too long` : `${length}/${field.maxLength}`}
            </span>
          )}
          {field.isOverridden && (
            <button type="button" className="btn btn-sm btn-quiet" onClick={onRestore}>
              Restore the default
            </button>
          )}
        </span>
      </span>
      {error && (
        <span className="publicpage-error" role="alert">
          {error}
        </span>
      )}
    </>
  );
}

/** One box of text. A textarea where the catalogue says the value is prose. */
function TextField({ label, field, value, error, onChange, onRestore }: Bound & { label: string }) {
  if (!field) return null;
  const text = typeof value === "string" ? value : "";

  return (
    <label className={error ? "field publicpage-field is-wrong" : "field publicpage-field"}>
      <span>{label}</span>
      {field.multiline ? (
        <textarea rows={3} value={text} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input value={text} onChange={(e) => onChange(e.target.value)} />
      )}
      <FieldFooter field={field} value={value} error={error} onRestore={onRestore} />
    </label>
  );
}

/** A yes or no. A section that is off is hidden from visitors entirely. */
function SwitchField({ label, field, value, error, onChange, onRestore }: Bound & { label: string }) {
  if (!field) return null;
  return (
    <label className="field publicpage-field">
      <span>{label}</span>
      <select value={value === true ? "true" : "false"} onChange={(e) => onChange(e.target.value === "true")}>
        <option value="true">Shown</option>
        <option value="false">Hidden</option>
      </select>
      <FieldFooter field={field} value={value} error={error} onRestore={onRestore} />
    </label>
  );
}

/**
 * A field the layout has no place for yet — rendered from its declared type.
 *
 * Deliberately plain. It exists so that a setting added to the Public page
 * group is reachable on the day it is added rather than on the day somebody
 * remembers to give it a row here.
 */
function GenericField(bound: Bound) {
  const { field } = bound;
  if (!field) return null;
  const label = humanise(field.key);

  if (field.type === "boolean") return <SwitchField label={label} {...bound} />;
  if (field.type === "string[]") {
    return (
      <LinkListField
        label={label}
        addLabel="Add an entry"
        placeholder=""
        emptyNote="Nothing set."
        {...bound}
      />
    );
  }
  return <TextField label={label} {...bound} />;
}

// ══════════════════════════════════════════════════════════════ the lists ═══

/** The list helpers. Three editors need all three, and none needs more. */
const asList = (value: unknown): string[] =>
  Array.isArray(value) && value.every((v) => typeof v === "string") ? (value as string[]) : [];

function moved(list: string[], from: number, to: number): string[] {
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item ?? "");
  return next;
}

/**
 * The up, down and remove that every row carries.
 *
 * ORDER IS CONTENT HERE. The first video is the one most visitors watch and the
 * first photograph is the one on screen when the page loads, so moving a row is
 * an edit rather than tidying — and the alternative, retyping the list in a
 * different order, is how a URL gets mangled.
 */
function RowControls({
  index,
  count,
  onMove,
  onRemove,
  what,
}: {
  index: number;
  count: number;
  onMove: (to: number) => void;
  onRemove: () => void;
  what: string;
}) {
  return (
    <span className="publicpage-row-controls">
      <button
        type="button"
        className="btn btn-sm btn-quiet"
        disabled={index === 0}
        aria-label={`Move this ${what} up`}
        onClick={() => onMove(index - 1)}
      >
        ↑
      </button>
      <button
        type="button"
        className="btn btn-sm btn-quiet"
        disabled={index === count - 1}
        aria-label={`Move this ${what} down`}
        onClick={() => onMove(index + 1)}
      >
        ↓
      </button>
      <button
        type="button"
        className="btn btn-sm btn-quiet"
        aria-label={`Remove this ${what}`}
        onClick={onRemove}
      >
        Remove
      </button>
    </span>
  );
}

/**
 * A list of links, one per row.
 *
 * ONE PER ROW RATHER THAN ONE TEXTAREA, which is the whole reason this exists
 * instead of reusing the settings screen. A URL in a comma-separated box is a
 * URL somebody eventually breaks by adding a space or losing a character, and
 * the failure shows up as a video that does not play rather than as an error.
 */
function LinkListField({
  label,
  addLabel,
  placeholder,
  emptyNote,
  field,
  value,
  error,
  onChange,
  onRestore,
}: Bound & { label: string; addLabel: string; placeholder: string; emptyNote: string }) {
  if (!field) return null;
  const list = asList(value);

  return (
    <div className={error ? "field publicpage-field is-wrong" : "field publicpage-field"}>
      <span>{label}</span>

      {list.length === 0 ? (
        <p className="muted small">{emptyNote}</p>
      ) : (
        <ul className="publicpage-rows">
          {list.map((entry, i) => (
            <li className="publicpage-row" key={`${i}-${entry.slice(0, 24)}`}>
              <input
                className="publicpage-row-main"
                value={entry}
                placeholder={placeholder}
                aria-label={`${label}, entry ${i + 1}`}
                onChange={(e) => onChange(list.map((v, j) => (j === i ? e.target.value : v)))}
              />
              <RowControls
                index={i}
                count={list.length}
                what="link"
                onMove={(to) => onChange(moved(list, i, to))}
                onRemove={() => onChange(list.filter((_, j) => j !== i))}
              />
            </li>
          ))}
        </ul>
      )}

      <div className="row-actions">
        <button type="button" className="btn btn-sm" onClick={() => onChange([...list, ""])}>
          {addLabel}
        </button>
      </div>

      <FieldFooter field={field} value={value} error={error} onRestore={onRestore} />
    </div>
  );
}

/**
 * The photographs — uploaded, not pasted.
 *
 * THE UPLOAD IS THE POINT. Every other way of getting a picture onto this page
 * asks somebody to host it somewhere else first and paste a link, which is why
 * the gallery was empty: it is three steps and a second service before anything
 * appears. `POST /course-media` already exists, already checks the file is
 * genuinely an image by its bytes, already refuses SVG, and already serves the
 * result to strangers — so a picture is chosen and it is on the page.
 *
 * A pasted https link still works, because an institute with a CDN should not
 * have to re-upload what it already hosts.
 *
 * THE CAPTION IS NOT DECORATION. It becomes the alt text, and a gallery
 * announced as "image, image, image" is a gallery a blind visitor cannot use
 * (NFR-ACC-002).
 */
function PhotoListField({ field, value, error, onChange, onRestore }: Bound) {
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  if (!field) return null;
  const list = asList(value);

  const rows = list.map((raw) => {
    const [url, ...rest] = raw.split("|");
    return { url: (url ?? "").trim(), caption: rest.join("|").trim() };
  });

  const write = (next: Array<{ url: string; caption: string }>) =>
    onChange(next.map((r) => (r.caption ? `${r.url} | ${r.caption}` : r.url)));

  const upload = async (file: File) => {
    setUploading(true);
    setUploadError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const r = await api.upload<{ id: string }>("/course-media", form);
      write([...rows, { url: `/api/v1/public/course-media/${r.id}`, caption: "" }]);
    } catch (e) {
      // The server's own words: too large, not an image, an SVG. Each has a
      // different thing to do about it, and "upload failed" has none.
      setUploadError(
        e instanceof ApiError
          ? (e.details?.[0]?.message ?? e.message)
          : "That picture could not be uploaded.",
      );
    } finally {
      setUploading(false);
      // So choosing the same file again after a failure still fires.
      if (input.current) input.current.value = "";
    }
  };

  return (
    <div className={error ? "field publicpage-field is-wrong" : "field publicpage-field"}>
      <span>The photographs</span>

      {rows.length === 0 ? (
        <p className="muted small">
          No photographs. The gallery disappears from the page rather than showing placeholders.
        </p>
      ) : (
        <ul className="publicpage-rows">
          {rows.map((row, i) => (
            <li className="publicpage-row publicpage-photo" key={`${i}-${row.url.slice(0, 24)}`}>
              <span className="thumb-preview publicpage-thumb">
                {row.url ? (
                  <img src={row.url} alt="" />
                ) : (
                  <span className="muted small">Empty</span>
                )}
              </span>
              <span className="publicpage-photo-fields">
                <input
                  value={row.url}
                  placeholder="https://…/classroom.jpg"
                  aria-label={`Photograph ${i + 1}, address`}
                  onChange={(e) =>
                    write(rows.map((r, j) => (j === i ? { ...r, url: e.target.value } : r)))
                  }
                />
                <input
                  value={row.caption}
                  placeholder="What is in the picture — read aloud to a blind visitor"
                  aria-label={`Photograph ${i + 1}, caption`}
                  onChange={(e) =>
                    write(rows.map((r, j) => (j === i ? { ...r, caption: e.target.value } : r)))
                  }
                />
              </span>
              <RowControls
                index={i}
                count={rows.length}
                what="photograph"
                onMove={(to) => onChange(moved(list, i, to))}
                onRemove={() => write(rows.filter((_, j) => j !== i))}
              />
            </li>
          ))}
        </ul>
      )}

      <div className="row-actions">
        <input
          ref={input}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="visually-hidden"
          aria-label="Choose a photograph to upload"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
          }}
        />
        <button
          type="button"
          className="btn btn-sm"
          disabled={uploading}
          onClick={() => input.current?.click()}
        >
          <Icon name="upload" />
          {uploading ? "Uploading…" : "Upload a photograph"}
        </button>
        <button
          type="button"
          className="btn btn-sm btn-quiet"
          onClick={() => write([...rows, { url: "", caption: "" }])}
        >
          Paste a link instead
        </button>
        <span className="muted small">JPEG, PNG or WebP, up to 3 MB.</span>
      </div>

      {uploadError && (
        <div className="alert alert-error" role="alert">
          <p className="small">{uploadError}</p>
        </div>
      )}

      <FieldFooter field={field} value={value} error={error} onRestore={onRestore} />
    </div>
  );
}

/**
 * The six claims, as six rows rather than six pipe-separated lines.
 *
 * The stored form is `icon | title | body`, which is what the settings screen
 * shows and what the page parses. Nobody should have to type a pipe to change
 * a sentence, so this splits and rejoins it — and the icon becomes a list of
 * the shapes the app can actually draw, because a name it cannot draw renders
 * as a dashboard grid and says nothing about why.
 */
function FeatureListField({ field, value, error, onChange, onRestore }: Bound) {
  if (!field) return null;
  const list = asList(value);

  const rows = list.map((raw) => {
    const parts = raw.split("|").map((p) => p.trim());
    return parts.length >= 3
      ? { icon: parts[0] ?? "layers", title: parts[1] ?? "", body: parts.slice(2).join(" | ") }
      : { icon: "layers", title: parts[0] ?? "", body: parts[1] ?? "" };
  });

  const write = (next: Array<{ icon: string; title: string; body: string }>) =>
    onChange(next.map((r) => `${r.icon} | ${r.title} | ${r.body}`));

  return (
    <div className={error ? "field publicpage-field is-wrong" : "field publicpage-field"}>
      <span>The cards</span>

      {rows.length === 0 ? (
        <p className="muted small">No cards. The section is hidden rather than left empty.</p>
      ) : (
        <ul className="publicpage-rows">
          {rows.map((row, i) => (
            <li className="publicpage-row publicpage-feature" key={`${i}-${row.title.slice(0, 24)}`}>
              <span className="publicpage-feature-icon" aria-hidden="true">
                <Icon name={row.icon} />
              </span>
              <span className="publicpage-feature-fields">
                <select
                  value={ICON_NAMES.includes(row.icon as (typeof ICON_NAMES)[number]) ? row.icon : "layers"}
                  aria-label={`Card ${i + 1}, picture`}
                  onChange={(e) => write(rows.map((r, j) => (j === i ? { ...r, icon: e.target.value } : r)))}
                >
                  {ICON_NAMES.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
                <input
                  value={row.title}
                  placeholder="A timetable that is true"
                  aria-label={`Card ${i + 1}, title`}
                  onChange={(e) => write(rows.map((r, j) => (j === i ? { ...r, title: e.target.value } : r)))}
                />
                <textarea
                  rows={2}
                  value={row.body}
                  placeholder="One or two sentences saying what it means in practice."
                  aria-label={`Card ${i + 1}, description`}
                  onChange={(e) => write(rows.map((r, j) => (j === i ? { ...r, body: e.target.value } : r)))}
                />
              </span>
              <RowControls
                index={i}
                count={rows.length}
                what="card"
                onMove={(to) => onChange(moved(list, i, to))}
                onRemove={() => write(rows.filter((_, j) => j !== i))}
              />
            </li>
          ))}
        </ul>
      )}

      <div className="row-actions">
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => write([...rows, { icon: "layers", title: "", body: "" }])}
        >
          Add a card
        </button>
        <span className="muted small">A card with no title is dropped rather than shown blank.</span>
      </div>

      <FieldFooter field={field} value={value} error={error} onRestore={onRestore} />
    </div>
  );
}

/**
 * What the page is currently saying, and no way to change it here.
 *
 * A read-only list looks like an oversight unless it says why it is read-only,
 * so it does — and it links to the screen that does own them.
 */
function NoticeList({ news }: { news: PublicNotice[] }) {
  if (news.length === 0) {
    return (
      <p className="muted small">
        Nothing is showing publicly, so the section is hidden. A notice reaches it when it is
        addressed to the whole Institute and marked to show publicly on the{" "}
        <Link to="/announcements">Announcements</Link> screen.
      </p>
    );
  }

  return (
    <>
      <ul className="list small publicpage-notices">
        {news.map((n) => (
          <li key={n.id}>
            <strong>{n.title}</strong>
            <br />
            <span className="muted">
              {new Date(n.publishedAt).toLocaleDateString(undefined, {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
              {n.isPinned && " · pinned"}
              {n.expiresAt &&
                ` · drops off ${new Date(n.expiresAt).toLocaleDateString(undefined, {
                  day: "numeric",
                  month: "long",
                })}`}
            </span>
          </li>
        ))}
      </ul>
      <p className="muted small">
        These come from <Link to="/announcements">Announcements</Link>. Withdrawing one there takes
        it off the public page as well.
      </p>
    </>
  );
}

/** "public.heroHeadline" -> "Hero headline". Only for the leftovers. */
function humanise(key: string): string {
  const last = key.split(".").pop() ?? key;
  const spaced = last.replace(/([A-Z])/g, " $1").toLowerCase().trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
