import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ApiError, api } from "../api/client";
import { Field } from "../components/Field";

/**
 * SETTING THE NEW PASSWORD, from the emailed link — FR-AUT.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The token arrives in the address bar and is sent straight back; nothing is
 * stored, and it is never put in localStorage. It is a credential for the next
 * few minutes, and a credential that outlives the tab it arrived in is one
 * somebody finds later in a browser they had forgotten they were signed into.
 *
 * THE PASSWORD IS TYPED TWICE. A single box plus a reveal button is the
 * fashionable arrangement and it is the wrong one here: there is no "current
 * password" to fall back on if a typo goes through, so the account would be
 * locked out by a slip. Two boxes catch that before it costs anybody a second
 * email.
 *
 * THE LENGTH RULE COMES FROM THE SERVER. It depends on the account's roles — a
 * Super Administrator has a longer minimum than a student — and this page does
 * not know whose account the token belongs to. Guessing a number here would be
 * a rule that disagrees with the real one, which is worse than not showing one.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get("token") ?? "";

  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const mismatch = again.length > 0 && password !== again;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/auth/password/reset", { token, newPassword: password });
      setDone(true);
      // Straight to signing in, but only after they have read that it worked —
      // landing on the login form with no explanation looks like a failure.
      setTimeout(() => navigate("/login"), 2500);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? (err.details?.map((d) => d.message).join(" ") ?? err.message)
          : "That could not be done. Ask for a new link.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-panel">
        <form className="auth-card" onSubmit={(e) => void submit(e)} noValidate>
          <h1 className="auth-title">Choose a new password</h1>

          {/* A link with no token is somebody who pasted half of it, or a mail
              client that broke the line. Say so, rather than showing a form
              that cannot possibly work. */}
          {!token ? (
            <>
              <div className="alert alert-error" role="alert">
                <strong>That link is incomplete</strong>
                <p>
                  It may have been cut short by your email program. Copy the whole address from
                  the message, or ask for a new link.
                </p>
              </div>
              <Link className="btn" to="/forgot-password" style={{ width: "100%" }}>
                Ask for a new link
              </Link>
            </>
          ) : done ? (
            <div className="alert alert-ok" role="status">
              <strong>Your password has been changed</strong>
              <p>Taking you to the sign-in page. Use the new password there.</p>
            </div>
          ) : (
            <>
              {error && (
                <div className="alert alert-error" role="alert">
                  <p>{error}</p>
                  <p className="muted small">
                    <Link to="/forgot-password">Ask for a new link</Link>
                  </p>
                </div>
              )}

              <Field label="New password"><input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  required
                  autoFocus
                />
              </Field>

              {/* The mismatch is handed to the field rather than drawn beside
                  it: the component already owns the cross, the red edge and the
                  announced message, and a second bespoke warning next to them
                  would say the same thing twice in two different voices. */}
              <Field
                label="Type it again"
                required
                error={mismatch ? "The two do not match." : null}
              >
                <input
                  type="password"
                  value={again}
                  onChange={(e) => setAgain(e.target.value)}
                  autoComplete="new-password"
                  required
                />
              </Field>

              <button
                className="btn btn-primary"
                type="submit"
                disabled={busy || !password || password !== again}
                style={{ width: "100%" }}
              >
                {busy ? "Saving…" : "Set this password"}
              </button>

              <p className="muted small">
                Everything signed in to this account elsewhere is signed out when you do this.
              </p>
            </>
          )}
        </form>
      </div>
    </div>
  );
}
