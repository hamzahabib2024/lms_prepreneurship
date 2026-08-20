import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

/**
 * "What is happening with my application?" — SRS §13.2, FR-REG-020.
 *
 * THE MISSING HALF OF THE APPLICATION FLOW. The endpoint has always been there
 * and public; the email has always told applicants to keep their reference; the
 * landing page has always promised "a tracking reference you can check at any
 * time". Nothing in the web app could check one. So an applicant with a
 * reference in their hand had exactly one way to use it — telephone the office
 * — which is the cost FR-REG-020 exists to remove.
 *
 * OUTSIDE THE APPLICATION SHELL, like /verify and /apply. Somebody waiting on
 * an admission decision has no account and cannot be given one; a page that
 * offers them a sign-in form is asking for a password they do not have and
 * suggesting they have done something wrong.
 *
 * IT CALLS THE API DIRECTLY rather than through the client, for the same reason
 * VerifyPage does: that client exists to attach a bearer token and refresh it,
 * and neither applies to someone who has never signed in. A 401 handler that
 * redirects to /login would be actively harmful here.
 *
 * A REFERENCE IS NOT A CREDENTIAL, and the server treats it that way — the
 * endpoint is rate-limited to twenty an hour per address so guessing is
 * impractical, and it discloses only the state, when it last changed, and any
 * message written to the applicant (SEC-PRV-012). Nothing on this page shows a
 * name, a programme or a payment, because the person holding the reference is
 * not necessarily the person who applied.
 */

interface StatusResult {
  status: string;
  lastUpdatedAt: string;
  message: string | null;
  reasonCode: string | null;
}

/**
 * What each state means TO THE APPLICANT, in the words they need.
 *
 * The enum values are for the office. "PENDING_REVIEW" tells an applicant
 * nothing about whether they should be worried, whether to do something, or
 * when to look again — and those are the only three questions they have.
 */
const EXPLANATION: Record<
  string,
  { tone: "wait" | "act" | "good" | "bad"; heading: string; body: string }
> = {
  PENDING_REVIEW: {
    tone: "wait",
    heading: "We have your application",
    body:
      "It is in the queue to be reviewed. The office checks payment slips against the bank " +
      "record, which usually takes about 48 hours. There is nothing you need to do, and we " +
      "will email you as soon as there is a decision.",
  },
  UNDER_REVIEW: {
    tone: "wait",
    heading: "Somebody is looking at it now",
    body:
      "A member of the office has your application open. You should hear from us shortly. " +
      "There is nothing you need to do.",
  },
  NEEDS_INFO: {
    tone: "act",
    heading: "We need one more thing from you",
    body:
      "Your application is being held for you — nothing you have already sent has been lost. " +
      "What we need is below. Contact the office and quote your reference.",
  },
  APPROVED: {
    tone: "good",
    heading: "You have a place",
    body:
      "Your application was accepted. We have emailed your registration number and a temporary " +
      "password to the address you applied with — check your spam folder if it is not there. " +
      "Sign in with those, and you will be asked to choose your own password straight away.",
  },
  REJECTED: {
    tone: "bad",
    heading: "This application was not accepted",
    body:
      "The reason is below. Several of these can be put right and applied for again, and " +
      "everything you sent us has been kept.",
  },
  WITHDRAWN: {
    tone: "bad",
    heading: "This application was withdrawn",
    body: "It is closed and will not be reviewed. You are welcome to apply again.",
  },
};

/**
 * The rejection reasons, translated — the same wording the email uses.
 *
 * A code an applicant reads on their phone teaches them nothing and gives them
 * nothing to do. Several of these are fixable in an afternoon, so the text
 * says which and says that reapplying is genuinely open.
 */
const REASON: Record<string, string> = {
  PAYMENT_NOT_RECEIVED:
    "We could not find your payment in the bank record. If you have paid, please apply again and attach the slip showing the transaction reference.",
  AMOUNT_INSUFFICIENT:
    "The amount received was less than the fee for this programme. You are welcome to apply again once the balance is paid.",
  SLIP_ILLEGIBLE:
    "We could not read the payment slip you sent. A clearer photograph, with the date and amount visible, is all we need — please apply again.",
  DUPLICATE_APPLICATION:
    "We already hold an application from you, so this one has been closed. The first one is still being reviewed.",
  INELIGIBLE: "This programme's entry requirements were not met.",
  SECTION_FULL:
    "The class you chose filled before your application was reviewed. Other classes may still have places — please apply again and choose another.",
  OTHER: "",
};

const TONE_PILL: Record<string, string> = {
  wait: "pill",
  act: "pill pill-warn",
  good: "pill pill-ok",
  bad: "pill pill-danger",
};

/** REG-2026-137895 — the shape submit() mints, matched loosely on purpose. */
function normalise(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, "");
}

export function TrackPage() {
  const { trackingRef: fromUrl } = useParams();
  const navigate = useNavigate();

  const [entered, setEntered] = useState(fromUrl ?? "");
  const [result, setResult] = useState<StatusResult | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [tooMany, setTooMany] = useState(false);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const lookUp = useCallback(async (ref: string) => {
    const clean = normalise(ref);
    if (!clean) return;

    setBusy(true);
    setResult(null);
    setNotFound(false);
    setTooMany(false);
    setFailed(false);

    try {
      const res = await fetch(
        `/api/v1/public/registrations/${encodeURIComponent(clean)}/status`,
      );
      if (res.status === 404) {
        setNotFound(true);
      } else if (res.status === 429) {
        // Said plainly rather than as a generic failure. The limit exists so
        // references cannot be guessed, and somebody who hits it by retrying
        // needs to know waiting will fix it.
        setTooMany(true);
      } else if (!res.ok) {
        setFailed(true);
      } else {
        const body = (await res.json()) as { data?: StatusResult };
        setResult(body.data ?? (body as unknown as StatusResult));
      }
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }, []);

  // A reference in the URL is looked up on arrival: the link in the
  // confirmation email lands here, and asking somebody to retype the reference
  // they just clicked is the sort of thing that makes a link not worth sending.
  useEffect(() => {
    if (fromUrl) void lookUp(fromUrl);
  }, [fromUrl, lookUp]);

  const explanation = result ? EXPLANATION[result.status] : undefined;

  return (
    <div className="landing">
      <header className="landing-nav">
        <Link className="auth-logo" to="/">
          <img className="brand-mark" src="/brand/ppship-emblem.png" alt="" width="32" height="32" />
          Prepreneurship
        </Link>
        <nav className="row-actions">
          <Link className="btn btn-quiet" to="/login">
            Sign in
          </Link>
          <Link className="btn btn-primary" to="/apply">
            Apply
          </Link>
        </nav>
      </header>

      <div className="apply-shell">
        <div className="card">
          <h1>Track your application</h1>
          <p className="muted">
            Enter the reference we emailed you when you applied. It looks like
            <strong> REG-2026-000123</strong>.
          </p>

          <form
            className="track-form"
            onSubmit={(e) => {
              e.preventDefault();
              const clean = normalise(entered);
              if (!clean) return;
              // Put it in the address bar so the result can be bookmarked and
              // reloaded — this is a page people come back to for days.
              navigate(`/track/${encodeURIComponent(clean)}`, { replace: true });
              void lookUp(clean);
            }}
          >
            <label className="field">
              <span>Your reference</span>
              <input
                value={entered}
                onChange={(e) => setEntered(e.target.value)}
                placeholder="REG-2026-000123"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                aria-label="Your application reference"
              />
            </label>
            <button className="btn btn-primary" type="submit" disabled={busy || !entered.trim()}>
              {busy ? "Checking…" : "Check"}
            </button>
          </form>

          {notFound && (
            <div className="alert alert-warn" role="alert">
              <strong>No application matches that reference.</strong>
              <p className="small">
                Check it against the email we sent — it is easy to mistype. If you never received
                one, contact the office rather than applying again, so you do not end up with two
                applications.
              </p>
            </div>
          )}

          {tooMany && (
            <div className="alert alert-warn" role="alert">
              <strong>Too many checks from this connection.</strong>
              <p className="small">
                Please wait a little while and try once more. The limit is there so nobody can
                guess at other people&rsquo;s references.
              </p>
            </div>
          )}

          {failed && (
            <div className="alert alert-error" role="alert">
              <p>
                We could not check that just now. Your application is unaffected — please try
                again shortly.
              </p>
            </div>
          )}

          {result && explanation && (
            <div className="track-result">
              <span className={TONE_PILL[explanation.tone] ?? "pill"}>{explanation.heading}</span>
              <p>{explanation.body}</p>

              {/* The office's own message, when there is one. For NEEDS_INFO it
                  IS the point of the page; for a rejection it is the detail
                  behind the reason code. */}
              {result.message && (
                <blockquote className="track-note">
                  <strong>From the office</strong>
                  <p>{result.message}</p>
                </blockquote>
              )}

              {result.reasonCode && REASON[result.reasonCode] && (
                <p className="small">{REASON[result.reasonCode]}</p>
              )}

              <p className="muted small">
                Last updated {new Date(result.lastUpdatedAt).toLocaleString()}.
              </p>

              {result.status === "APPROVED" && (
                <div className="row-actions">
                  <Link className="btn btn-primary" to="/login">
                    Sign in
                  </Link>
                </div>
              )}

              {(result.status === "REJECTED" || result.status === "WITHDRAWN") && (
                <div className="row-actions">
                  <Link className="btn btn-primary" to="/apply">
                    Apply again
                  </Link>
                </div>
              )}
            </div>
          )}

          <div className="row-actions">
            <Link className="btn" to="/">
              Back to the home page
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
