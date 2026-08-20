import { useCallback, useEffect, useRef, useState } from "react";
import { tokens } from "../api/client";
import { Icon } from "../components/Icon";

/**
 * A recording from somebody's own device — FR-VID-002.
 *
 * WHAT THIS REPLACES. A recording that Google Meet did not make — a phone
 * video, an old file, a screen capture — could not be added at all. It had to
 * be put into the Institute's Drive by hand first, which means whoever adds it
 * needs access to the Drive account itself, which most staff should not have.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT ASKS WHETHER THE UPLOAD WOULD WORK BEFORE OFFERING THE FILE PICKER, and
 * that is not politeness. A Google service account HAS NO DRIVE STORAGE QUOTA:
 * it can read the Institute's folder, is even told `canAddChildren: true`, and
 * every upload into an ordinary My Drive is refused. Measured, not assumed.
 * The two ways out are a Shared Drive or domain-wide delegation, and both are
 * configuration. Discovering that after 300 MB has crossed somebody's
 * connection is the failure this avoids.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * XMLHttpRequest RATHER THAN fetch, for one reason: PROGRESS. `fetch` cannot
 * report upload progress at all, and a 300 MB transfer with no indication of
 * movement is one somebody cancels at the two-minute mark believing it has
 * hung. This is the one place in the app where that matters enough to reach
 * past the shared client.
 */

interface UploadTarget {
  accepted: boolean;
  reason?: string;
  destination?: string;
  folderRef: string | null;
  provider: string;
  fallback: string;
}

interface UploadResult {
  id: string;
  title: string;
  provider: string;
  usedFallback: boolean;
  message: string;
}

export function LectureUpload({
  sectionSubjectId,
  lessonId,
  onDone,
  onCancel,
}: {
  sectionSubjectId: string;
  lessonId?: string;
  onDone: () => void;
  onCancel?: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  /**
   * HOW TO STOP THE TRANSFER, rather than the request object itself.
   *
   * It is the only thing anything outside `upload()` needs — the Cancel button
   * and the unmount cleanup both want to abort and nothing else. Holding a
   * function also keeps a DOM type out of a `useRef` union, which the lint
   * configuration cannot resolve for this workspace and reports as `any`.
   */
  const abort = useRef<(() => void) | null>(null);

  const [target, setTarget] = useState<UploadTarget | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [recordedOn, setRecordedOn] = useState(new Date().toISOString().slice(0, 10));
  const [storeLocally, setStoreLocally] = useState(false);
  const [percent, setPercent] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<UploadResult | null>(null);

  const loadTarget = useCallback(async () => {
    try {
      const r = await fetch(
        `/api/v1/section-subjects/${sectionSubjectId}/lecture-upload-target`,
        { headers: authHeader() },
      );
      const body = (await r.json()) as { data?: UploadTarget };
      const t = body.data ?? null;
      setTarget(t);
      // Drive has already said no, so the fallback is pre-selected rather than
      // left for somebody to discover after a failed transfer.
      if (t && !t.accepted) setStoreLocally(true);
    } catch {
      setTarget(null);
    }
  }, [sectionSubjectId]);

  useEffect(() => {
    void loadTarget();
    return () => abort.current?.();
  }, [loadTarget]);

  const upload = () => {
    if (!file) return;
    setError(null);
    setPercent(0);

    const form = new FormData();
    form.append("file", file);
    form.append("title", title.trim() || file.name.replace(/\.[^.]+$/, ""));
    form.append("recordedOn", recordedOn);
    if (lessonId) form.append("lessonId", lessonId);
    if (storeLocally) form.append("storeIn", "local");

    const req = new XMLHttpRequest();
    abort.current = () => req.abort();
    req.open("POST", `/api/v1/section-subjects/${sectionSubjectId}/lectures/upload`);
    for (const [k, v] of Object.entries(authHeader())) req.setRequestHeader(k, v);

    req.upload.onprogress = (e) => {
      if (e.lengthComputable) setPercent(Math.round((e.loaded / e.total) * 100));
    };

    req.onload = () => {
      setPercent(null);
      try {
        const body = JSON.parse(req.responseText) as {
          data?: UploadResult;
          error?: { message: string; details?: Array<{ message: string }> };
        };
        if (req.status >= 200 && req.status < 300 && body.data) {
          setDone(body.data);
          return;
        }
        // The server's own words. It knows whether this was the quota
        // constraint, an unshared folder or the wrong sort of file, and each
        // has a different thing to do about it.
        setError(body.error?.details?.[0]?.message ?? body.error?.message ?? "The upload failed.");
      } catch {
        setError(`The upload failed (${req.status}).`);
      }
    };

    req.onerror = () => {
      setPercent(null);
      setError("The connection dropped during the upload. Nothing was saved — try again.");
    };
    req.onabort = () => setPercent(null);

    req.send(form);
  };

  // ------------------------------------------------------------- done ----
  if (done) {
    return (
      <div className="composer">
        <div className="alert alert-ok" role="status">
          <strong>{done.title} was uploaded.</strong>
          <p className="small">{done.message}</p>
        </div>
        <div className="row-actions">
          <button className="btn btn-primary" onClick={onDone}>
            Done
          </button>
          <button
            className="btn btn-quiet"
            onClick={() => {
              setDone(null);
              setFile(null);
              setTitle("");
            }}
          >
            Upload another
          </button>
        </div>
      </div>
    );
  }

  const busy = percent !== null;

  return (
    <div className="composer lecture-upload">
      {/* WHERE IT WILL GO, before a file is chosen. */}
      {target && (
        <div className={target.accepted ? "alert alert-ok" : "alert alert-warn"}>
          {target.accepted ? (
            <p className="small">
              This will be uploaded to <strong>{target.destination}</strong> in Google Drive, where
              the class already reads its recordings from.
            </p>
          ) : (
            <>
              <strong>This cannot go into Google Drive.</strong>
              <p className="small">{target.reason}</p>
              <p className="small">
                It can still be stored by the System itself — students watch it exactly the same
                way. That is selected below.
              </p>
            </>
          )}
        </div>
      )}

      {error && (
        <div className="alert alert-error" role="alert">
          <p className="small">{error}</p>
        </div>
      )}

      <div className="field">
        <span>Recording</span>
        <input
          ref={input}
          type="file"
          accept="video/mp4,video/webm,video/quicktime,video/x-matroska,.mp4,.webm,.mov,.mkv"
          disabled={busy}
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            setFile(f);
            if (f && !title) setTitle(f.name.replace(/\.[^.]+$/, ""));
          }}
        />
        <span className="muted small">
          MP4, WebM, QuickTime (.mov) or Matroska (.mkv). The file is checked by its contents, not
          its name.
        </span>
        {file && (
          <span className="muted small">
            {file.name} — {(file.size / 1048576).toFixed(1)} MB
          </span>
        )}
      </div>

      <label className="field">
        <span>Title students will see</span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={busy}
          placeholder="Colour theory — week 3"
        />
      </label>

      <label className="field">
        <span>Recorded on</span>
        <input
          type="date"
          value={recordedOn}
          onChange={(e) => setRecordedOn(e.target.value)}
          disabled={busy}
        />
      </label>

      {/* Only offered when Drive is genuinely an option. When it is not, the
          fallback is the only path and a checkbox implying a choice would be
          a lie. */}
      {target?.accepted && (
        <label className="field-inline">
          <input
            type="checkbox"
            checked={storeLocally}
            onChange={(e) => setStoreLocally(e.target.checked)}
            disabled={busy}
          />
          <span>Store it in the System instead of Google Drive</span>
        </label>
      )}

      {busy && (
        <div className="upload-progress">
          <div
            className="bar"
            role="progressbar"
            aria-valuenow={percent ?? 0}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Upload progress"
          >
            <div className="bar-fill" style={{ width: `${percent}%` }} />
          </div>
          <span className="muted small">
            {percent}% — leave this page open until it finishes.
          </span>
        </div>
      )}

      <span className="row-actions">
        <button
          className="btn btn-primary"
          onClick={upload}
          disabled={busy || !file || !title.trim()}
        >
          <Icon name="upload" />
          {busy ? `Uploading ${percent}%` : "Upload"}
        </button>
        {busy ? (
          <button className="btn btn-quiet" onClick={() => abort.current?.()}>
            Cancel upload
          </button>
        ) : (
          onCancel && (
            <button className="btn btn-quiet" onClick={onCancel}>
              Cancel
            </button>
          )
        )}
      </span>

      <p className="muted small">
        It arrives as a <strong>draft</strong>. Nothing is shown to the class until you publish it,
        so picking the wrong file cannot put it in front of a cohort.
      </p>
    </div>
  );
}

/**
 * The bearer token, for the one request that cannot go through the shared
 * client.
 *
 * READ FROM THE CLIENT'S OWN STORE rather than kept here, so the two cannot
 * disagree about who is signed in. The client owns refresh and this borrows
 * the access token it currently holds — which is the whole of what is reached
 * for. Everything else about this request is XHR only because `fetch` cannot
 * report upload progress, and a 300 MB transfer with no sign of movement is
 * one somebody cancels believing it has hung.
 *
 * The trade-off is honest and small: an access token that expires DURING a
 * long upload is not refreshed mid-flight, and the request comes back 401.
 * The panel reports it and the file is re-sent — which is the same thing the
 * shared client would do after a refresh, minus the retry.
 */
function authHeader(): Record<string, string> {
  const token = tokens.getAccess();
  return token ? { Authorization: `Bearer ${token}` } : {};
}
