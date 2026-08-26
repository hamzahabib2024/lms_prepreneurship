import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { ApiError, api } from "../api/client";

/**
 * "I HAVE FORGOTTEN MY PASSWORD" — FR-AUT.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Two steps on one screen: say who you are, confirm you meant it, and then be
 * told to go and look in your email. The confirmation is not ceremony — asking
 * for a reset ENDS EVERY SESSION on that account once it is used, and somebody
 * who pressed it by accident on a shared computer should get the chance to
 * stop.
 *
 * IT NEVER SAYS WHETHER THE ADDRESS IS REGISTERED, and neither does the server.
 * The reader gets the same sentence either way. That reads as slightly unhelpful
 * and it is the correct behaviour: a page that says "no such account" is a
 * membership test anybody can run against a list of email addresses, and at an
 * institute that list is the student roster.
 *
 * WHAT THE EMAIL CARRIES IS A LINK, NOT A PASSWORD. That is worth saying on the
 * screen, because the office's own habit is to read a temporary password down
 * the telephone and people will expect one. A link expires; a password sits in
 * the mailbox until somebody changes it.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ message: string }>("/auth/password/forgot", {
        email: email.trim(),
      });
      setSent(r.message);
      setConfirming(false);
    } catch (e) {
      /*
       * The one thing that CAN legitimately fail is the rate limit, and it is
       * worth saying plainly rather than as a status code — somebody pressing
       * this repeatedly is somebody who has not received the first email and
       * needs to be told to wait rather than to keep trying.
       */
      setError(
        e instanceof ApiError && e.status === 429
          ? "That has been asked for several times already. Wait an hour before trying again, " +
            "and check the spam folder in the meantime."
          : e instanceof ApiError
            ? e.message
            : "That could not be sent. Try again in a moment.",
      );
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-panel">
        <form
          className="auth-card"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            setConfirming(true);
          }}
          noValidate
        >
          <h1 className="auth-title">Forgotten your password</h1>
          <p className="muted">We will email you a link for setting a new one.</p>

          {sent ? (
            <>
              <div className="alert alert-ok" role="status">
                <strong>Check your email</strong>
                <p>{sent}</p>
              </div>
              <p className="muted small">
                It may take a minute to arrive, and it may land in the spam folder. The link
                works once and stops working after 30 minutes — ask again from here if it
                expires.
              </p>
              <Link className="btn" to="/login" style={{ width: "100%" }}>
                Back to signing in
              </Link>
            </>
          ) : confirming ? (
            <>
              {/* The confirmation, in words that say what will actually happen
                  rather than "are you sure?". */}
              <div className="alert alert-warn" role="alert">
                <strong>Send the link to {email.trim()}?</strong>
                <p>
                  If that address belongs to an account, an email arrives with a link for
                  choosing a new password. Using it signs that account out everywhere.
                </p>
              </div>
              <div className="row-actions">
                <button
                  className="btn btn-primary"
                  type="button"
                  disabled={busy}
                  onClick={() => void send()}
                >
                  {busy ? "Sending…" : "Yes, send it"}
                </button>
                <button
                  className="btn btn-quiet"
                  type="button"
                  disabled={busy}
                  onClick={() => setConfirming(false)}
                >
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <>
              {error && (
                <div className="alert alert-error" role="alert">
                  <p>{error}</p>
                </div>
              )}

              <label className="field">
                <span>Your email address</span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="username"
                  required
                  autoFocus
                />
                <span className="muted small">
                  The address the Institute has for you. If you are not sure which it is, ask
                  the office.
                </span>
              </label>

              <button
                className="btn btn-primary"
                type="submit"
                disabled={busy || !email.trim()}
                style={{ width: "100%" }}
              >
                Continue
              </button>

              <p className="muted small">
                <Link to="/login">Back to signing in</Link>
              </p>
            </>
          )}
        </form>
      </div>
    </div>
  );
}
