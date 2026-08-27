import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api } from "../api/client";
import { Field } from "./Field";

/**
 * WHO SIGNS THE INSTITUTE'S CERTIFICATES — FR-CRT.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The foot of every certificate used to carry exactly two names: one from a
 * settings key and one from whoever happened to be the subject's teacher. An
 * Institute with a Principal, a Director and a Programme Head could not print
 * all three, and a promotion meant editing a setting.
 *
 * THE SIGNATURE IMAGE IS OPTIONAL, AND SAYING SO MATTERS. A name printed over
 * a ruled line is an ordinary certificate; demanding a scan would stop the
 * Institute issuing anything until three people had found a scanner. Upload one
 * when there is one.
 *
 * NOTHING HERE CHANGES A CERTIFICATE THAT HAS ALREADY BEEN ISSUED. Each one
 * carries a snapshot of the panel as it was signed, so renaming somebody or
 * taking them out of the list leaves every document they signed exactly as it
 * was. That is worth saying on the screen, because the opposite is what people
 * reasonably fear when they press Remove.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export interface Signatory {
  id: string;
  name: string;
  designation: string;
  signatureAssetId: string | null;
  isActive: boolean;
  sortOrder: number;
}

/** The public route, because a certificate is shown to people with no account. */
export const signatureUrl = (assetId: string | null | undefined) =>
  assetId ? `/api/v1/public/course-media/${assetId}` : null;

export function SignatoriesPanel() {
  const [rows, setRows] = useState<Signatory[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ name: "", designation: "" });

  const load = useCallback(() => {
    void api
      .get<Signatory[]>("/signatories")
      .then(setRows)
      .catch((e) => {
        setRows([]);
        setError(e instanceof ApiError ? e.message : "Could not load the signatories.");
      });
  }, []);

  useEffect(load, [load]);

  const run = async (work: () => Promise<unknown>, said: string) => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await work();
      setNote(said);
      load();
      return true;
    } catch (e) {
      setError(
        e instanceof ApiError
          ? (e.details?.map((d) => d.message).join(" ") ?? e.message)
          : "That could not be done.",
      );
      return false;
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    const ok = await run(
      () => api.post("/signatories", { name: draft.name.trim(), designation: draft.designation.trim() }),
      `${draft.name.trim()} added.`,
    );
    if (ok) {
      setDraft({ name: "", designation: "" });
      setAdding(false);
    }
  };

  if (!rows) return null;

  return (
    <section className="card">
      <div className="card-head">
        <h2>Who signs a certificate</h2>
        <button type="button" className="btn btn-quiet" onClick={() => setAdding((a) => !a)}>
          {adding ? "Close" : "Add somebody"}
        </button>
      </div>
      <p className="muted small">
        Their names print across the foot of every certificate, in this order. Up to four fit on
        the sheet. Changing anything here leaves certificates already issued exactly as they were
        signed.
      </p>

      {error && (
        <div className="alert alert-error" role="alert">
          <p>{error}</p>
        </div>
      )}
      {note && (
        <div className="alert alert-ok" role="status">
          <p>{note}</p>
        </div>
      )}

      {adding && (
        <div className="form-row">
          <Field label="Their name" required><input
              value={draft.name}
              placeholder="Dr Ayesha Rahman"
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            />
          </Field>
          <Field label="What they are" required><input
              value={draft.designation}
              placeholder="Principal"
              onChange={(e) => setDraft((d) => ({ ...d, designation: e.target.value }))}
            />
          </Field>
          <div className="field">
            <span>&nbsp;</span>
            <button
              className="btn btn-primary"
              disabled={busy || !draft.name.trim() || !draft.designation.trim()}
              onClick={() => void add()}
            >
              Add
            </button>
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="muted small">
          Nobody yet. Certificates print with the Institute&rsquo;s name and the class teacher
          until somebody is added here.
        </p>
      ) : (
        <ul className="list signatory-list">
          {rows.map((s, i) => (
            <SignatoryRow
              key={s.id}
              signatory={s}
              first={i === 0}
              last={i === rows.length - 1}
              busy={busy}
              onChanged={run}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function SignatoryRow({
  signatory: s,
  first,
  last,
  busy,
  onChanged,
}: {
  signatory: Signatory;
  first: boolean;
  last: boolean;
  busy: boolean;
  onChanged: (work: () => Promise<unknown>, said: string) => Promise<boolean>;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const url = signatureUrl(s.signatureAssetId);

  /**
   * The scanned signature.
   *
   * Uploaded through the same route as a course thumbnail — it is the same
   * kind of thing, a small image the Institute owns — and then pointed at.
   * Two steps rather than one because the upload endpoint already exists and
   * already validates; a second one that did the same checks slightly
   * differently is how two upload paths come to disagree.
   */
  const upload = async (file: File) => {
    setUploading(true);
    /*
     * BOTH STEPS INSIDE ONE `run`, so a failure in either is reported the same
     * way and in the same place. Doing the upload outside it meant catching an
     * `unknown` and pushing it back through a rejected promise purely to reach
     * the error display — which the linter was right to object to, and which
     * would have shown "[object Object]" the first time an upload failed.
     */
    await onChanged(async () => {
      const body = new FormData();
      body.append("file", file);
      const asset = await api.upload<{ id: string }>("/course-media", body);
      await api.patch(`/signatories/${s.id}`, { signatureAssetId: asset.id });
    }, `Signature added for ${s.name}.`);
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  const remove = () => {
    if (
      !window.confirm(
        `Remove ${s.name} from the list?\n\nCertificates they have already signed keep their ` +
          `name and signature exactly as they were issued. This only stops them appearing on ` +
          `new ones.`,
      )
    )
      return;
    void onChanged(() => api.del(`/signatories/${s.id}`), `${s.name} removed.`);
  };

  return (
    <li className={s.isActive ? "signatory-row" : "signatory-row is-off"}>
      <span className="signatory-who">
        {/* The signature itself, where there is one. Seeing it is the only way
            to know it uploaded the right way up and with its background gone. */}
        {url ? (
          <img className="signatory-mark" src={url} alt={`${s.name}'s signature`} />
        ) : (
          <span className="signatory-mark signatory-mark-empty" aria-hidden="true" />
        )}
        <span>
          <strong>{s.name}</strong>
          <span className="muted small"> {s.designation}</span>
          {!s.isActive && <span className="pill"> not in use</span>}
        </span>
      </span>

      <span className="row-actions">
        {/* Order matters — it is the order they print, left to right. */}
        <button
          type="button"
          className="btn btn-quiet btn-sm"
          disabled={busy || first}
          aria-label={`Move ${s.name} earlier`}
          onClick={() =>
            void onChanged(
              () => api.patch(`/signatories/${s.id}`, { sortOrder: s.sortOrder - 1 }),
              "Order changed.",
            )
          }
        >
          Earlier
        </button>
        <button
          type="button"
          className="btn btn-quiet btn-sm"
          disabled={busy || last}
          aria-label={`Move ${s.name} later`}
          onClick={() =>
            void onChanged(
              () => api.patch(`/signatories/${s.id}`, { sortOrder: s.sortOrder + 1 }),
              "Order changed.",
            )
          }
        >
          Later
        </button>

        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/webp,image/jpeg"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
          }}
        />
        <button
          type="button"
          className="btn btn-quiet btn-sm"
          disabled={busy || uploading}
          onClick={() => fileRef.current?.click()}
        >
          {uploading ? "Uploading…" : url ? "Replace signature" : "Add signature"}
        </button>

        <button
          type="button"
          className="btn btn-quiet btn-sm"
          disabled={busy}
          onClick={() =>
            void onChanged(
              () => api.patch(`/signatories/${s.id}`, { isActive: !s.isActive }),
              s.isActive ? `${s.name} will not appear on new certificates.` : `${s.name} is back in use.`,
            )
          }
        >
          {s.isActive ? "Take out of use" : "Put back in use"}
        </button>

        <button type="button" className="btn btn-quiet btn-sm" disabled={busy} onClick={remove}>
          Remove
        </button>
      </span>
    </li>
  );
}
