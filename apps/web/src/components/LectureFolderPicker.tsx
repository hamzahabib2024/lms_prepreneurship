import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "../api/client";
import { Icon } from "../components/Icon";
import { Skeleton } from "../components/Ui";

/**
 * The Institute's lecture folders, by name and by id — FR-VID-003.
 *
 * WHAT THIS REPLACES. Connecting a class to its recordings meant opening Drive
 * in another tab, finding the right folder among a dozen with names like
 * "(Sec D) English Class" and "(Sec I) English Class", copying the address bar
 * and pasting it back here. The System could list that folder the whole time;
 * it simply never showed anybody the list.
 *
 * OFFICE ONLY, enforced by the server on `lecture_storage_index` — a folder id
 * is close to a bearer token for that folder's contents, and a teacher holding
 * it could point their own class at another cohort's recordings. This
 * component is only rendered for staff who hold it, and a teacher who reaches
 * it anyway gets a 403 from the API rather than a list.
 *
 * IT SAYS WHICH FOLDERS ARE ALREADY SPOKEN FOR. Twelve near-identical names
 * with no indication of which are in use is how two classes end up reading one
 * folder — silently, and each cohort then sees the other's recordings.
 */

interface Folder {
  id: string;
  name: string;
  modifiedAt: string | null;
  url: string | null;
  usedBy: string | null;
}

interface FolderIndex {
  provider: string;
  root: string;
  folders: Folder[];
  looseFiles: number;
}

export function LectureFolderPicker({
  currentRef,
  onPick,
  onClose,
}: {
  /** The folder this class already uses, so it can be marked in the list. */
  currentRef?: string | null;
  /** Chosen — the caller saves it. */
  onPick: (folderId: string) => void;
  onClose?: () => void;
}) {
  const [index, setIndex] = useState<FolderIndex | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const load = useCallback(async () => {
    setError(null);
    try {
      setIndex(await api.get<FolderIndex>("/storage/folders"));
    } catch (e) {
      setError(
        e instanceof ApiError
          ? e.message
          : "The lecture folders could not be read. Check storage is connected.",
      );
      setIndex(null);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const copy = async (text: string, key: string) => {
    try {
      await navigator.clipboard?.writeText(text);
      setCopied(key);
      window.setTimeout(() => setCopied((c) => (c === key ? null : c)), 1600);
    } catch {
      // Clipboard access can be refused; the id is on screen and selectable,
      // so there is nothing to recover from and nothing worth alarming about.
    }
  };

  if (error) {
    return (
      <div className="alert alert-error" role="alert">
        <strong>Could not read the folders</strong>
        <p className="small">{error}</p>
        <div className="row-actions">
          <button className="btn btn-sm" onClick={() => void load()}>
            Try again
          </button>
          {onClose && (
            <button className="btn btn-sm btn-quiet" onClick={onClose}>
              Close
            </button>
          )}
        </div>
      </div>
    );
  }

  if (!index) return <Skeleton lines={4} />;

  const shown = filter.trim()
    ? index.folders.filter((f) => f.name.toLowerCase().includes(filter.trim().toLowerCase()))
    : index.folders;

  return (
    <div className="folder-picker">
      <div className="folder-picker-head">
        <div>
          <strong>{index.folders.length} folders</strong>{" "}
          <span className="muted small">
            in {index.provider === "google_drive" ? "Google Drive" : index.provider}
          </span>
        </div>
        {onClose && (
          <button className="btn btn-quiet btn-sm" onClick={onClose}>
            Close
          </button>
        )}
      </div>

      {index.folders.length > 6 && (
        <label className="field">
          <span className="visually-hidden">Filter folders</span>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by name…"
            aria-label="Filter folders by name"
          />
        </label>
      )}

      {/* A recording sitting loose in the root usually means somebody uploaded
          it to the wrong place, and it will never appear on any course page.
          Worth saying rather than hiding. */}
      {index.looseFiles > 0 && (
        <p className="muted small">
          {index.looseFiles} file{index.looseFiles === 1 ? "" : "s"} sit directly in the root
          folder rather than in a class folder. Those are not read by any class.
        </p>
      )}

      {index.folders.length === 0 ? (
        <p className="muted small">
          The root folder has no subfolders. Create one folder per class in Drive, then share the
          root with the System&rsquo;s service account.
        </p>
      ) : shown.length === 0 ? (
        <p className="muted small">No folder matches &ldquo;{filter}&rdquo;.</p>
      ) : (
        <ul className="folder-list">
          {shown.map((f) => {
            const isCurrent = f.id === currentRef;
            return (
              <li key={f.id} className={isCurrent ? "folder-row is-current" : "folder-row"}>
                <div className="folder-row-main">
                  <Icon name="folder" />
                  <div className="folder-row-text">
                    <strong>{f.name}</strong>
                    {/* THE ID, VISIBLE AND SELECTABLE. It is the thing this
                        panel exists to hand over, so it is not hidden behind a
                        button that may fail — clipboard access can be refused
                        and the value still has to be gettable. */}
                    <code className="folder-id">{f.id}</code>
                    <span className="muted small">
                      {isCurrent
                        ? "Used by this class"
                        : f.usedBy
                          ? `Already used by ${f.usedBy}`
                          : "Not connected to any class"}
                    </span>
                  </div>
                </div>

                <div className="folder-row-actions">
                  <button
                    className="btn btn-sm"
                    onClick={() => void copy(f.id, `id-${f.id}`)}
                    aria-label={`Copy the folder id for ${f.name}`}
                  >
                    {copied === `id-${f.id}` ? "Copied" : "Copy id"}
                  </button>
                  {f.url && (
                    <button
                      className="btn btn-sm btn-quiet"
                      onClick={() => void copy(f.url as string, `url-${f.id}`)}
                      aria-label={`Copy the Drive link for ${f.name}`}
                    >
                      {copied === `url-${f.id}` ? "Copied" : "Copy link"}
                    </button>
                  )}
                  {f.url && (
                    <a
                      className="btn btn-sm btn-quiet"
                      href={f.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open
                    </a>
                  )}
                  <button
                    className="btn btn-sm btn-primary"
                    disabled={isCurrent}
                    onClick={() => onPick(f.id)}
                  >
                    {isCurrent ? "In use" : "Use for this class"}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
