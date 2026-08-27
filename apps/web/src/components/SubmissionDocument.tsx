import { useEffect, useState } from "react";
import { ApiError, api } from "../api/client";
import { Icon } from "./Icon";

/**
 * THE WORK ITSELF, BESIDE THE MARK BOX — FR-ASG-025.
 *
 * WHAT THIS REPLACES. Until now the only thing a marker could do with a
 * submitted file was download it: click, wait, find it in Downloads, open it in
 * another application, alt-tab back, type a mark, repeat thirty times. The mark
 * and the thing being marked were never on screen together.
 *
 * NO PDF LIBRARY, AND THAT IS A DECISION. The browser already has a PDF viewer
 * with scrolling, zoom, search and print in it, and `<object>` hands the file
 * to it. Rendering the pages ourselves would mean ~1 MB of pdf.js, a worker, a
 * CSP exception and a text layer — for a worse viewer than the one already
 * installed. The cost of this choice is that we cannot draw on the page; that
 * is understood and is why comments carry their own text rather than pins.
 *
 * A CSP NOTE FOR WHOEVER COMES NEXT. This works today because helmet's
 * `object-src 'none'` is applied to API RESPONSES only — the SPA is served
 * without a policy of its own. If a CSP is ever added to the web app, this pane
 * goes blank and nothing in the console will point at this file. Allow
 * `object-src 'self' blob:` when that day comes.
 *
 * NOTHING IS ASSUMED ABOUT THE FILE. A .psd, a .docx and a .zip are all
 * legitimate submissions and none of them can be shown. Each gets a panel that
 * says so and offers the download, because a blank half-screen reads as a
 * broken page and sends the marker to support rather than to the file.
 */

export interface SubmissionFileRef {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
}

/** What a browser will actually render. Everything else is offered for download. */
const VIEWABLE = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

const kb = (bytes: number): string =>
  bytes >= 1_048_576
    ? `${(bytes / 1_048_576).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

export function SubmissionDocument({
  files,
  textResponse,
}: {
  files: SubmissionFileRef[];
  /** A typed answer is work too, and for a TEXT assignment it is all of it. */
  textResponse: string | null;
}) {
  const [activeId, setActiveId] = useState<string | null>(files[0]?.id ?? null);

  /*
   * FOLLOW THE SUBMISSION WHEN IT CHANGES.
   *
   * The pane is mounted once and reused as the marker walks the class, so
   * without this the file selected for student 4 stays selected for student 5 —
   * where that id does not exist, and the pane empties. Keyed on the ids
   * themselves rather than a count, because two students with two files each
   * would not change the count.
   */
  const fileIds = files.map((f) => f.id).join(",");
  const firstId = files[0]?.id ?? null;
  useEffect(() => {
    // Depends on the ids as a STRING, not on `files` — the array is a new
    // object every render, which would reset the selection on each keystroke
    // in the panel beside it.
    setActiveId(firstId);
  }, [fileIds, firstId]);

  const active = files.find((f) => f.id === activeId) ?? null;

  if (files.length === 0 && !textResponse) {
    return (
      <div className="doc-pane doc-empty">
        <Icon name="clipboard" />
        <p className="muted">Nothing was handed in with this submission.</p>
      </div>
    );
  }

  return (
    <div className="doc-pane">
      {/*
        THE FILE SWITCHER, only when there is a choice. One file with a tab
        above it saying "1 of 1" is chrome that costs vertical space on the
        thing the screen exists to show.
      */}
      {files.length > 1 && (
        <div className="doc-tabs" role="tablist" aria-label="Submitted files">
          {files.map((f) => (
            <button
              key={f.id}
              role="tab"
              aria-selected={f.id === activeId}
              className={f.id === activeId ? "doc-tab is-active" : "doc-tab"}
              onClick={() => setActiveId(f.id)}
              title={f.filename}
            >
              {f.filename}
            </button>
          ))}
        </div>
      )}

      {active && <FileView key={active.id} file={active} />}

      {/*
        THE TYPED ANSWER, under the files. For a TEXT assignment it is the whole
        submission; for a BOTH assignment it is usually the note that explains
        the attachment, and a marker who never sees it marks without it.
      */}
      {textResponse && (
        <div className="doc-text">
          <h3 className="section-label">Typed answer</h3>
          <blockquote className="response">{textResponse}</blockquote>
        </div>
      )}
    </div>
  );
}

/**
 * One file, fetched with the session and shown.
 *
 * NOT `ProofFile`, and the difference is the reason this exists. ProofFile is
 * built for a bank slip on a fee screen: a small preview, capped height,
 * sitting in the flow of a card. A marker needs the OPPOSITE — the file filling
 * a full-height pane it can scroll and zoom inside, for as long as it takes to
 * read an essay. The two share the part that is easy to get wrong (authenticate,
 * make an object URL, revoke it) and disagree about everything else, so this is
 * the same lifecycle in a different frame rather than a second copy of a
 * component doing a different job.
 */
function FileView({ file }: { file: SubmissionFileRef }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const viewable = VIEWABLE.has(file.contentType);

  useEffect(() => {
    if (!viewable) return;

    let objectUrl: string | null = null;
    let cancelled = false;

    api
      .download(`/submission-files/${file.id}/download`)
      .then((blob) => {
        // The marker may have moved on while this was in flight. Creating the
        // URL anyway leaks it, because the cleanup below has already run.
        if (cancelled) return;
        /*
         * RE-TYPED FROM THE ROW, not trusted from the response.
         *
         * A blob URL carries the blob's OWN media type, and the viewer that
         * opens it believes that and nothing else — the `type` attribute on
         * the element is only a hint. If the response ever arrives as
         * octet-stream, through a proxy or a misconfigured header, the PDF
         * viewer refuses a file it would otherwise have rendered. The server
         * already recorded what this file is; use that.
         */
        const typed =
          blob.type === file.contentType ? blob : new Blob([blob], { type: file.contentType });
        objectUrl = URL.createObjectURL(typed);
        setUrl(objectUrl);
      })
      .catch((e) => {
        if (!cancelled) {
          setFailed(e instanceof ApiError ? e.message : "That file could not be opened.");
        }
      });

    /*
     * REVOKED ON THE WAY OUT, ALWAYS.
     *
     * A marker works through thirty submissions in a sitting. An object URL
     * that is never released holds the whole file in memory for the life of the
     * tab, so thirty unreleased PDFs is a tab that has to be closed and a
     * teacher who blames the System for being slow.
     */
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file.id, file.contentType, viewable]);

  if (!viewable) {
    return (
      <div className="doc-frame doc-unviewable">
        <Icon name="clipboard" />
        <p>
          <strong>{file.filename}</strong>
        </p>
        <p className="muted small">
          This kind of file ({file.contentType || "unknown type"}, {kb(file.sizeBytes)}) cannot be
          shown in the browser. Download it to open it in the right application — the mark box
          stays where it is.
        </p>
        <button
          className="btn"
          onClick={() => void saveAs(file)}
        >
          <Icon name="download" /> Download {file.filename}
        </button>
      </div>
    );
  }

  if (failed) {
    return (
      <div className="doc-frame doc-unviewable">
        <div className="alert alert-error" role="alert">
          <p className="small">{failed}</p>
        </div>
      </div>
    );
  }

  if (!url) {
    return (
      <div className="doc-frame doc-loading">
        <p className="muted small">Opening {file.filename} ({kb(file.sizeBytes)})…</p>
      </div>
    );
  }

  if (file.contentType === "application/pdf") {
    return (
      <div className="doc-pdf">
        {/*
          AN <iframe>, NOT AN <object>, AND THAT IS THE WHOLE FIX.

          `<object data="blob:…" type="application/pdf">` is the textbook way to
          embed a PDF and it FAILS in Edge and in some Chrome builds, which
          answer with their own error page — "We can't open this file /
          Something went wrong / Refresh". It is not our error and there is
          nothing in the console: the browser's PDF viewer simply declines a
          blob URL delivered through <object>. An <iframe> with the same blob
          renders it every time.

          The blob is re-typed below with the content type the SERVER recorded,
          so the viewer is never asked to guess.

          FOR WHOEVER ADDS A CSP LATER: this now needs `frame-src 'self' blob:`
          rather than `object-src`. The API already sends `object-src 'none'`
          on its own responses; the SPA has no policy today, which is the only
          reason either version worked.
        */}
        <iframe src={url} className="doc-frame" title={file.filename} />
        {/*
          ALWAYS OFFERED, not only on failure. An iframe that fails to render a
          PDF reports nothing a script can catch, so there is no moment at which
          a fallback could be shown — the honest answer is a way out that is
          always there.
        */}
        <p className="doc-pdf-escape small">
          <a href={url} target="_blank" rel="noreferrer">
            Open {file.filename} in a new tab
          </a>
        </p>
      </div>
    );
  }

  return (
    <div className="doc-frame doc-image">
      {/* Full size in a new tab, because detail in a photographed page is
          exactly what has to be read and the pane is not always big enough. */}
      <a href={url} target="_blank" rel="noreferrer" title="Open full size">
        <img src={url} alt={`Submitted work: ${file.filename}`} />
      </a>
    </div>
  );
}

/**
 * Saves a file the browser cannot display.
 *
 * Fetched with the session rather than linked: the endpoint needs a bearer
 * token, so a plain `<a href>` would download a JSON error page under the
 * student's filename.
 */
async function saveAs(file: SubmissionFileRef): Promise<void> {
  try {
    const blob = await api.download(`/submission-files/${file.id}/download`);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch {
    // The panel above already tells the marker what the file is; a failed
    // download is better reported by the browser than by replacing the pane.
  }
}
