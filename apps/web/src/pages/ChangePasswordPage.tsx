import { useState, type FormEvent } from "react";
import { ApiError, api } from "../api/client";
import { useAuth } from "../auth/AuthContext";

/**
 * Set a new password — SRS FR-REG-040, SEC-AUT-013.
 *
 * A provisioned account arrives with a temporary password that an
 * administrator has read aloud or sent over WhatsApp. Until it is replaced,
 * that password is known to at least two people, so this screen blocks
 * navigation rather than merely suggesting a change.
 *
 * It also serves the voluntary case from the profile menu, where the user is
 * not blocked and can cancel.
 */
export function ChangePasswordPage({ forced }: { forced: boolean }) {
  const { completePasswordChange, signOut } = useAuth();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const mismatch = confirmPassword.length > 0 && newPassword !== confirmPassword;
  const tooShort = newPassword.length > 0 && newPassword.length < 8;
  const sameAsCurrent = newPassword.length > 0 && newPassword === currentPassword;

  const canSubmit =
    currentPassword.length > 0 &&
    newPassword.length >= 8 &&
    !mismatch &&
    !sameAsCurrent &&
    !busy;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.post("/auth/password/change", { currentPassword, newPassword });
      setDone(true);
      // SEC-SES-008 — the server has just ended every other session. Saying so
      // explains why the user's other device will ask them to sign in again.
      setTimeout(() => completePasswordChange(), 1600);
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, { message: "Could not reach the server." }));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="auth-shell">
        <div className="card auth-card">
          <h1 className="auth-title">Password changed</h1>
          <p className="muted">
            You are signed in on this device. Any other device you were signed in on will ask you to
            sign in again.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-shell">
      <form className="card auth-card" onSubmit={onSubmit} noValidate>
        <h1 className="auth-title">{forced ? "Set your password" : "Change your password"}</h1>
        <p className="muted">
          {forced
            ? "Your account was created with a temporary password. Choose your own before continuing."
            : "Choose a new password for your account."}
        </p>

        {error && (
          <div className="alert alert-error" role="alert">
            <strong>Could not change your password</strong>
            {/* The server reports every failing field at once (NFR-ERR-005). */}
            <p>{error.fieldError("newPassword") ?? error.message}</p>
            {error.reference && <p className="muted small">Reference: {error.reference}</p>}
          </div>
        )}

        <label className="field">
          <span>{forced ? "Temporary password" : "Current password"}</span>
          <input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            autoComplete="current-password"
            required
            autoFocus
          />
        </label>

        <label className="field">
          <span>New password</span>
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            autoComplete="new-password"
            aria-describedby="pw-help"
            required
          />
          {/* NFR-ACC-006 — guidance is associated with the field, and states
              the requirement rather than only complaining after the fact. */}
          <span id="pw-help" className={`small ${tooShort ? "warn" : "muted"}`}>
            {tooShort
              ? "Use at least 8 characters."
              : "At least 8 characters. Longer is better than complicated."}
          </span>
          {sameAsCurrent && (
            <span className="small warn">Choose something different from your current password.</span>
          )}
        </label>

        <label className="field">
          <span>Confirm new password</span>
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            autoComplete="new-password"
            aria-invalid={mismatch}
            required
          />
          {mismatch && <span className="small warn">The two passwords do not match.</span>}
        </label>

        <button className="btn btn-primary" type="submit" disabled={!canSubmit}>
          {busy ? "Saving…" : "Save password"}
        </button>

        {forced && (
          // There is no way past this screen except changing the password or
          // signing out — which is the point of a forced change.
          <button className="btn btn-quiet" type="button" onClick={() => void signOut()}>
            Sign out instead
          </button>
        )}
      </form>
    </div>
  );
}
