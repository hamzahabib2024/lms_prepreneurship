import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { ApiError, api } from "../api/client";
import { Field } from "../components/Field";

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
 * IT SAYS WHEN THE ADDRESS IS NOT OURS. The Institute chose that, knowing the
 * trade-off: it means somebody can test whether an address is on the roster,
 * and it means a person who mistypes their own address is told so instead of
 * waiting for mail that is never coming. The rate limit and the security log
 * are what stand against the first; see the service.
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
          ? "A link has already been sent to that address a few times in the last hour. " +
            "Check the inbox and the spam folder — the most recent one is the one that " +
            "works. If none arrived, ask the office to reset it for you rather than waiting."
          : e instanceof ApiError
            ? e.message
            : "That could not be sent. Try again in a moment.",
      );
      /*
       * Back to the address box, not to the confirmation. Every failure here is
       * something about the ADDRESS — a typo, an account that is not ours, too
       * many attempts — so the reader is returned to the one field they can do
       * anything about, with what they typed still in it.
       */
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
              {/* Whose mailbox, in as many words. It is the only proof of
                  identity in this whole flow — the link goes there and nowhere
                  else — and saying so is what tells the reader why nobody else
                  can use it. */}
              <p className="small">
                Sent to <strong>{email.trim()}</strong>.
              </p>
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
                  We will check that address belongs to an account and, if it does, email a
                  link for choosing a new password. Using it signs that account out
                  everywhere.
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

              <Field
                label="Your email address"
                required
                hint="The address the Institute has for you. If you are not sure which it is, ask the office."
              >
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="username"
                  required
                  autoFocus
                />
              </Field>

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
