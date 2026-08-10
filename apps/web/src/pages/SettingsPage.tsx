import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "../api/client";
import { useAuth } from "../auth/AuthContext";

/**
 * Institute settings — SRS §13.9, FR-CFG-001..005.
 *
 * These values decide when a student is warned, what counts as complete and
 * what a certificate requires. The screen is built around three things a
 * settings page usually gets wrong:
 *
 *   WHERE THE VALUE CAME FROM is shown on every row. An administrator who
 *   changes the institute figure and sees nothing happen has almost always hit
 *   a more specific override; without being told, they conclude the feature is
 *   broken and change it again.
 *
 *   WHAT CHANGING IT DOES is written next to it, not in a manual. "0.15" and
 *   "attendance.lateWeight" together tell nobody anything.
 *
 *   NOTHING SAVES UNTIL IT IS PRESSED, and the default is always visible, so
 *   the way back is never lost.
 *
 * An Admin may read this and not change it (§4.5): the inputs are disabled
 * rather than the page refused, because seeing the Institute's policy is
 * legitimately part of administering it.
 */

type SettingType = "number" | "percent" | "boolean" | "string" | "string[]" | "weights";

interface Setting {
  key: string;
  type: SettingType;
  description: string;
  default: unknown;
  value?: unknown;
  source: string;
  isOverridden: boolean;
  overridableAt: string[];
  min?: number;
  max?: number;
  allowed?: string[];
  isSecret?: boolean;
  isSet?: boolean;
}

interface Group {
  group: string;
  settings: Setting[];
}

export function SettingsPage() {
  const { hasRole } = useAuth();
  const mayConfigure = hasRole("super_admin");
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .get<Group[]>("/settings")
      .then(setGroups)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load settings."));
  }, []);

  useEffect(load, [load]);

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Settings</h1>
          <p className="muted small">
            Institute policy. A change applies from now on — decisions already made are
            unchanged.
          </p>
        </div>
      </header>

      {!mayConfigure && (
        <div className="alert alert-warn">
          <p>
            You can read these. Changing them is reserved to a Super Admin, because they
            decide when a student is warned and what a certificate requires.
          </p>
        </div>
      )}

      {error && (
        <div className="alert alert-error">
          <p>{error}</p>
        </div>
      )}

      {saved && (
        <div className="alert">
          <p>{saved}</p>
        </div>
      )}

      {!groups ? (
        <p className="muted">Loading…</p>
      ) : (
        groups.map((g) => (
          <section className="card" key={g.group}>
            <h2>{g.group}</h2>
            <ul className="list">
              {g.settings.map((s) => (
                <SettingRow
                  key={s.key}
                  setting={s}
                  canEdit={mayConfigure}
                  onSaved={(message) => {
                    setSaved(message);
                    setError(null);
                    load();
                  }}
                  onError={(message) => {
                    setError(message);
                    setSaved(null);
                  }}
                />
              ))}
            </ul>
          </section>
        ))
      )}
    </>
  );
}

function SettingRow({
  setting,
  canEdit,
  onSaved,
  onError,
}: {
  setting: Setting;
  canEdit: boolean;
  onSaved: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [draft, setDraft] = useState(() => toDraft(setting));
  const [busy, setBusy] = useState(false);

  // A reload after saving must not leave the box showing what was typed on a
  // row that failed, nor stale text on one that succeeded.
  useEffect(() => setDraft(toDraft(setting)), [setting]);

  const dirty = draft !== toDraft(setting);

  const save = async () => {
    setBusy(true);
    try {
      const value = fromDraft(setting, draft);
      await api.put(`/settings/${setting.key}`, { value });
      onSaved(`${setting.key} saved. It applies from now on.`);
    } catch (e) {
      onError(
        e instanceof ApiError
          ? (e.details?.[0]?.message ?? e.message)
          : e instanceof Error
            ? e.message
            : "Could not save it.",
      );
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    setBusy(true);
    try {
      await api.del(`/settings/${setting.key}`);
      onSaved(`${setting.key} restored to its default.`);
    } catch (e) {
      onError(e instanceof ApiError ? e.message : "Could not restore it.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="assignment">
      <div className="assignment-head">
        <span>
          <strong>{label(setting.key)}</strong>
          <br />
          <span className="muted small">{setting.key}</span>
        </span>
        <span className="row-actions">
          {/* The whole reason a no-op change is explicable. */}
          {setting.source === "default" ? (
            <span className="muted small">default</span>
          ) : (
            <span className="pill">set at {setting.source.toLowerCase()}</span>
          )}
        </span>
      </div>

      <p className="muted small">{setting.description}</p>

      {setting.isSecret ? (
        // SEC-CRY-010 — never read back. Not masked: absent.
        <p className="muted small">
          {setting.isSet ? "A value is set. It cannot be shown, only replaced." : "Not set."}
        </p>
      ) : (
        <div className="field-row">
          <label className="field">
            <span>Value</span>
            {setting.type === "boolean" ? (
              <select value={draft} disabled={!canEdit} onChange={(e) => setDraft(e.target.value)}>
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
            ) : setting.type === "number" || setting.type === "percent" ? (
              <input
                type="number"
                value={draft}
                disabled={!canEdit}
                {...(setting.min !== undefined ? { min: setting.min } : {})}
                {...(setting.max !== undefined ? { max: setting.max } : {})}
                step="any"
                onChange={(e) => setDraft(e.target.value)}
              />
            ) : (
              <input
                value={draft}
                disabled={!canEdit}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={hint(setting)}
              />
            )}
          </label>
          <span className="muted small">
            default {format(setting.default)}
            {setting.min !== undefined && setting.max !== undefined
              ? ` · ${setting.min}–${setting.max}`
              : ""}
          </span>
        </div>
      )}

      {canEdit && (
        <div className="row-actions">
          <button className="btn btn-primary" onClick={save} disabled={busy || !dirty}>
            {busy ? "Saving…" : "Save"}
          </button>
          {setting.isOverridden && (
            <button className="btn btn-quiet" onClick={reset} disabled={busy}>
              Restore the default
            </button>
          )}
        </div>
      )}
    </li>
  );
}

/** "attendance.warningThreshold" -> "Warning threshold". */
function label(key: string): string {
  const last = key.split(".").pop() ?? key;
  const spaced = last.replace(/([A-Z])/g, " $1").toLowerCase().trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function hint(setting: Setting): string {
  if (setting.type === "string[]") return "Comma separated, e.g. pdf, docx, png";
  if (setting.type === "weights") return "video 30, assignment 30, quiz 25, attendance 15";
  return "";
}

function format(value: unknown): string {
  if (Array.isArray(value)) return value.join(", ");
  if (value && typeof value === "object") {
    return Object.entries(value)
      .map(([k, v]) => `${k} ${Math.round(Number(v) * 100)}%`)
      .join(", ");
  }
  return String(value);
}

/** The value as text a person can edit. */
function toDraft(setting: Setting): string {
  const value = setting.value ?? setting.default;
  if (setting.type === "weights") {
    // Shown and typed as PERCENTAGES. The API stores fractions summing to 1,
    // and "0.25" is a worse thing to ask somebody to type than "25".
    return Object.entries((value ?? {}) as Record<string, number>)
      .map(([k, v]) => `${k} ${Math.round(v * 100)}`)
      .join(", ");
  }
  if (Array.isArray(value)) return value.join(", ");
  return String(value ?? "");
}

/** Back to what the API expects. Throws with a readable message on nonsense. */
function fromDraft(setting: Setting, draft: string): unknown {
  switch (setting.type) {
    case "number":
    case "percent": {
      const n = Number(draft);
      if (!Number.isFinite(n)) throw new Error(`${setting.key} must be a number.`);
      return n;
    }
    case "boolean":
      return draft === "true";
    case "string[]":
      return draft
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
    case "weights": {
      // "video 30, assignment 30, quiz 25, attendance 15" -> fractions.
      const out: Record<string, number> = {};
      for (const part of draft.split(",")) {
        const [name, amount] = part.trim().split(/\s+/);
        if (!name) continue;
        const n = Number(amount);
        if (!Number.isFinite(n)) {
          throw new Error(`"${part.trim()}" should be a component and a percentage, e.g. quiz 25.`);
        }
        out[name] = n / 100;
      }
      return out;
    }
    default:
      return draft;
  }
}
