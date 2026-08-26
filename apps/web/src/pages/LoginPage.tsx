import { Link } from "react-router-dom";
import { useState, type FormEvent } from "react";
import { ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";

/**
 * Sign in — SRS §13.11, Figure 9-2.
 *
 * NFR-USE-007: every error says what happened and what to do. SEC-AUT-009
 * requires the wrong-password message to be identical whether or not the
 * account exists, so the server sends one message for both and this screen
 * shows it verbatim rather than trying to be more helpful.
 */
export function LoginPage() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await signIn(email.trim(), password);
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, { message: "Could not reach the server." }));
    } finally {
      setBusy(false);
    }
  }

  const lockedOut = error?.code === "AUTH_ACCOUNT_LOCKED";
  const suspended = error?.code === "AUTH_ACCOUNT_SUSPENDED";
  /*
   * When a new password would actually help. A suspended account is excluded
   * on purpose — see the note where this is used.
   */
  const canReset = Boolean(error) && !suspended;

  return (
    <div className="auth-shell">
      {/*
        The panel is the brand. For most students this is the only
        Prepreneurship screen they will ever describe to somebody else, and a
        sign-in box floating on grey is a form from nowhere.

        What it claims is deliberately modest and TRUE. "Trusted by thousands"
        on a system with eight seeded students is the kind of copy that makes
        everything else on the page suspect; these three lines describe what
        the software actually does.
      */}
      <aside className="auth-brand">
        {/*
          THE LOCKUP, ON THE BRAND'S OWN DARK GROUND.

          §2.3 wants the full lockup — emblem, wordmark, tagline — on
          institutional surfaces, and a sign-in screen is the most
          institutional surface this product has: it is the one screen every
          student describes to somebody else.

          The MASTER PNG IS NOT USED HERE and that is deliberate. Its wordmark
          is Wordmark Black #1a1a1a, and §2.2 calls for "the reversed light
          version" on deep navy — an asset we have not been given. Placing the
          black-wordmark file on navy would be using the logo wrongly, which is
          worse than setting the wordmark in type beside the emblem. The full
          master file is used where it belongs, on white.
        */}
        <div className="auth-logo">
          <img
            className="brand-mark brand-mark-lg"
            src="/brand/ppship-emblem.png"
            alt=""
            width="48"
            height="48"
          />
          <span className="brand-words">
            Prepreneurship
            <span className="brand-sub">Dream. Learn. Earn.</span>
          </span>
        </div>

        <h1>Everything your institute runs on, in one place.</h1>
        <p>
          Admissions, attendance, coursework, fees and certificates — kept in step, so nobody has
          to reconcile two spreadsheets at the end of the month.
        </p>

        <ul className="auth-points">
          <li>Registers, marking and progress that agree with each other</li>
          <li>Fees, receipts and instalment plans on one ledger</li>
          <li>Certificates an employer can verify without an account</li>
        </ul>
      </aside>

      <div className="auth-panel">
        <form className="auth-card" onSubmit={(e) => void onSubmit(e)} noValidate>
          <h1 className="auth-title">Welcome back</h1>
          <p className="muted">Sign in to continue</p>

        {error && (
          <div className={`alert ${lockedOut || suspended ? "alert-warn" : "alert-error"}`} role="alert">
            <strong>{lockedOut ? "Account locked" : suspended ? "Account suspended" : "Could not sign in"}</strong>
            <p>{error.message}</p>
            {/*
              THE WAY OUT, OFFERED ONLY ONCE SOMEBODY NEEDS IT.

              It used to sit under the sign-in button at all times, which is a
              line every person who knows their password reads past — and a
              standing invitation to type somebody else's address into a form
              that sends mail.

              It appears on a wrong password and on a locked account, because
              those are the two states a new password actually solves. NOT on a
              suspended account: resetting the password of an account the
              Institute has suspended changes nothing, and offering it sends
              somebody round a loop instead of to the office.
            */}
            {canReset && (
              <p className="small">
                <Link to="/forgot-password">
                  {lockedOut
                    ? "Set a new password instead of waiting"
                    : "I have forgotten my password"}
                </Link>
              </p>
            )}
            {/* NFR-ERR-003 — a reference the user can quote to support. */}
            {error.reference && <p className="muted small">Reference: {error.reference}</p>}
          </div>
        )}

        <label className="field">
          <span>Email address</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            required
            autoFocus
          />
        </label>

        <label className="field">
          <span>Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>

          <button
            className="btn btn-primary"
            type="submit"
            disabled={busy || !email || !password}
            style={{ width: "100%" }}
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>


          <p className="muted small dev-note">
            Development accounts: <code>admin@institute.local</code> ·{" "}
            <code>sana@institute.local</code> — password <code>ChangeMe!Admin2026</code> /{" "}
            <code>ChangeMe!Teacher2026</code>
          </p>
        </form>
      </div>
    </div>
  );
}
