import { useRef, useState } from "react";
import { ApiError, api } from "../api/client";
import { Icon } from "./Icon";

/**
 * Choose a picture, and see it immediately.
 *
 * THE PREVIEW IS THE POINT. An upload field that reports "uploaded" and shows
 * nothing leaves the administrator to save, navigate to the public page and
 * look — three steps to find out they picked the wrong file. It uploads on
 * selection and shows the result at the size it will actually appear.
 */
export function ThumbnailField({
  assetId,
  onChange,
  hint,
}: {
  assetId: string | null;
  onChange: (id: string | null) => void;
  hint: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const pick = async (file: File) => {
    setBusy(true);
    setProblem(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const r = await api.upload<{ id: string; deduplicated: boolean }>("/course-media", form);
      onChange(r.id);
    } catch (e) {
      // The server's own words. It knows why — too large, not an image, an SVG
      // — and each of those has a different thing to do about it.
      setProblem(
        e instanceof ApiError
          ? (e.details?.[0]?.message ?? e.message)
          : "That picture could not be uploaded.",
      );
    } finally {
      setBusy(false);
      // So choosing the SAME file again after a failure still fires onChange.
      if (input.current) input.current.value = "";
    }
  };

  return (
    <div className="field thumb-field">
      <span>Picture</span>

      <div className="thumb-row">
        <div className="thumb-preview">
          {assetId ? (
            <img src={`/api/v1/public/course-media/${assetId}`} alt="" />
          ) : (
            <span className="muted small">No picture</span>
          )}
        </div>

        <div className="thumb-actions">
          <input
            ref={input}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void pick(file);
            }}
          />
          <div className="row-actions">
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => input.current?.click()}
            >
              <Icon name="upload" />
              {busy ? "Uploading…" : assetId ? "Replace" : "Choose a picture"}
            </button>
            {assetId && (
              <button type="button" className="btn btn-quiet" onClick={() => onChange(null)}>
                Remove
              </button>
            )}
          </div>
          <span className="muted small">{hint}</span>
          <span className="muted small">JPEG, PNG or WebP, up to 3 MB.</span>
        </div>
      </div>

      {problem && (
        <div className="alert alert-error" role="alert">
          <p className="small">{problem}</p>
        </div>
      )}
    </div>
  );
}
