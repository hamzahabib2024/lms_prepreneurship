import { useState } from "react";
import { ApiError, api, tokens } from "../api/client";
import { Field } from "./Field";

/**
 * SEC-AUZ-011 — confirm your password again.
 *
 * A handful of operations demand recent re-authentication: granting an
 * administrator sub-permissions, acting as another user, erasing personal data,
 * restoring a backup. The server refuses them with AUTH_STEP_UP_REQUIRED until
 * the token carries a fresh `sua` claim.
 *
 * WITHOUT THIS THE INTERFACE COULD NOT DO ANY OF THEM. The server would say
 * "please confirm your password to continue" and the screen had no way to let
 * anybody confirm anything — the same shape of gap as an API nothing reaches,
 * one layer up.
 *
 * The new token replaces the old one in place. It keeps the same session, so
 * signing out still ends it; only its freshness changes.
 */
export function StepUpPrompt({
  what,
  onDone,
  onCancel,
}: {
  /** Named so the password box says what it is unlocking. */
  what: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ accessToken: string }>("/auth/step-up", { password });
      tokens.setAccess(r.accessToken);
      setPassword("");
      onDone();
    } catch (e) {
      setError(
        e instanceof ApiError && e.status === 401
          ? "That password is not right."
          : e instanceof ApiError
            ? e.message
            : "Could not confirm it.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="alert alert-warn">
      <p>
        <strong>Confirm your password to {what}.</strong>
      </p>
      <p className="muted small">
        You stay signed in either way. This is asked because the action is one somebody could do
        from an unattended screen.
      </p>
      {error && <p className="warn">{error}</p>}
      <Field label="Your password" required><input
          type="password"
          value={password}
          autoFocus
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && password) void confirm();
          }}
        />
      </Field>
      <span className="row-actions">
        <button className="btn btn-primary" disabled={busy || !password} onClick={() => void confirm()}>
          {busy ? "Confirming…" : "Confirm"}
        </button>
        <button className="btn btn-quiet" onClick={onCancel}>
          Cancel
        </button>
      </span>
    </div>
  );
}

/** True when the server refused for want of a recent re-authentication. */
export function needsStepUp(e: unknown): boolean {
  return e instanceof ApiError && e.code === "AUTH_STEP_UP_REQUIRED";
}
