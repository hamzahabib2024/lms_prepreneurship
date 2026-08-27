import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api } from "../api/client";
import { Field } from "./Field";

/**
 * FILES THAT COME WITH THE BRIEF — FR-ASG.
 *
 * The third way a teacher sets a task. Written instructions say what to do, a
 * spoken brief says it in their own voice, and this is the thing most briefs
 * actually need beside both: the logo to work from, the passage to read, the
 * trial balance to reconcile.
 *
 * ONE COMPONENT FOR BOTH SIDES, because the list is the same list. A teacher
 * additionally uploads and removes; a student downloads. Writing it twice
 * would give two renderings of the same rows that drift apart — the classic
 * result being a size shown in KB on one screen and MB on the other, and a
 * student who thinks they have the wrong file.
 *
 * DOWNLOADED, NEVER LINKED. `api.download` fetches the bytes on an
 * authenticated request and hands the browser a blob. An <a href> to the API
 * would send no Authorization header, and a URL that worked without one would
 * be a URL a student could forward to somebody who left the course.
 */

export interface BriefAttachment {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
}

export function BriefAttachments({
  assignmentId,
  canManage = false,
  onChanged,
}: {
  assignmentId: string;
  /** A teacher on their own assignment. Adds the upload box and Remove. */
  canManage?: boolean;
  onChanged?: () => void;
}) {
  const [files, setFiles] = useState<BriefAttachment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    void api
      .get<BriefAttachment[]>(`/assignments/${assignmentId}/attachments`)
      .then(setFiles)
      .catch(() => setFiles([]));
  }, [assignmentId]);

  useEffect(load, [load]);

  const upload = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const body = new FormData();
      body.append("file", file);
      // Not api.post: that sets a JSON content-type, and multipart needs the
      // browser to write its own boundary.
      await api.upload(`/assignments/${assignmentId}/attachments`, body);
      load();
      onChanged?.();
    } catch (e) {
      // The server says exactly why — wrong type, too large, contents do not
      // match the extension. Read from `details` first: a validation failure
      // puts the useful sentence there and a generic one on the top line
      // (NFR-USE-007).
      setError(
        e instanceof ApiError
          ? (e.details?.map((d) => d.message).join(" ") ?? e.message)
          : "That file could not be attached.",
      );
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const remove = async (id: string) => {
    setError(null);
    try {
      await api.del(`/assignment-attachments/${id}`);
      load();
      onChanged?.();
    } catch (e) {
      setError(
        e instanceof ApiError
          ? (e.details?.map((d) => d.message).join(" ") ?? e.message)
          : "That file could not be removed.",
      );
    }
  };

  const download = async (f: BriefAttachment) => {
    setDownloading(f.id);
    setError(null);
    try {
      const blob = await api.download(`/assignment-attachments/${f.id}/download`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = f.filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // ARC-045 — a file the System has lost is the Institute's problem, and
      // saying so is more useful than a status code.
      setError("That file could not be downloaded. Please tell your teacher.");
    } finally {
      setDownloading(null);
    }
  };

  if (files === null) return null;

  // A student sees nothing at all when there is nothing attached. An empty
  // "Files" heading on every assignment is noise on the screen they read most.
  if (!canManage && files.length === 0) return null;

  return (
    <div className="brief-files">
      <strong className="small">
        {canManage ? "Files that come with this brief" : "Files from your teacher"}
      </strong>

      {files.length > 0 && (
        <ul className="list small">
          {files.map((f) => (
            <li key={f.id}>
              <span>
                {f.filename} <span className="muted">({formatSize(f.sizeBytes)})</span>
              </span>
              <span className="brief-files-actions">
                <button
                  className="btn btn-quiet"
                  disabled={downloading === f.id}
                  onClick={() => void download(f)}
                >
                  {downloading === f.id ? "Opening…" : "Download"}
                </button>
                {canManage && (
                  <button className="btn btn-quiet" onClick={() => void remove(f.id)}>
                    Remove
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {canManage && (
        <>
          <Field label="Attach a file"><input ref={inputRef} type="file" disabled={busy} onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void upload(file);
            }} />
          </Field>
          <p className="muted small">
            Checked against the Institute's rules for uploads, the same as a student's — a file
            whose contents do not match its name is refused. Attaching the same file twice keeps
            one copy.
          </p>
        </>
      )}

      {files.length === 0 && canManage && (
        <p className="muted small">Nothing attached yet.</p>
      )}

      {error && (
        <div className="alert alert-error" role="alert">
          <p>{error}</p>
        </div>
      )}
    </div>
  );
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
