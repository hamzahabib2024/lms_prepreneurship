import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Icon } from "../components/Icon";

/**
 * Public certificate verification — SRS §13.8, FR-CRT-015.
 *
 * WHO OPENS THIS. An employer with a printed certificate in one hand and a
 * phone in the other, who has just scanned a QR code. They have no account,
 * they will never have one, and they have exactly one question. So the page
 * answers it in the first line, in a word, before anything else is read.
 *
 * IT RENDERS OUTSIDE THE APPLICATION SHELL — no sidebar, no sign-out, nothing
 * suggesting they should log in — and calls the API directly rather than
 * through the client, because that client exists to attach a bearer token and
 * refresh it, neither of which applies to somebody who has never signed in.
 *
 * NOTHING PRIVATE IS ON THIS PAGE, and that is a server decision rather than a
 * screen one: the endpoint returns only what is already printed on the paper
 * the reader is holding. No marks, no attendance, no registration number, no
 * contact details. This screen could not leak them if it tried.
 */

interface VerifyResult {
  found: boolean;
  certificateNo?: string;
  holderName?: string;
  awardedFor?: string;
  programme?: string | null;
  instructorName?: string | null;
  instituteName?: string;
  type?: string;
  kind?: string;
  kindLabel?: string;
  status?: string;
  issuedAt?: string;
  completionDate?: string | null;
  valid?: boolean;
  archived?: boolean;
  revokedAt?: string | null;
  message?: string;
}

const longDate = (iso?: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString(undefined, {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : "";

export function VerifyPage() {
  const { code = "" } = useParams();
  const navigate = useNavigate();
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [failed, setFailed] = useState(false);
  const [typed, setTyped] = useState("");

  const check = useCallback((value: string) => {
    setResult(null);
    setFailed(false);
    fetch(`/api/v1/public/certificates/${encodeURIComponent(value)}/verify`)
      .then((r) => r.json())
      .then((body) => setResult(body.data ?? body))
      .catch(() => setFailed(true));
  }, []);

  useEffect(() => {
    if (code) check(code);
  }, [code, check]);

  /*
   * Three outcomes, and they are genuinely different answers rather than
   * shades of one. ARCHIVED is the one that gets forgotten: the document is
   * real, the Institute has simply withdrawn it from circulation, and telling
   * an employer "revoked" would be a false accusation against the holder.
   */
  const verdict = !result?.found
    ? "unknown"
    : result.status === "REVOKED"
      ? "revoked"
      : result.archived
        ? "archived"
        : "valid";

  return (
    <div className="landing">
      <header className="landing-nav">
        <Link className="auth-logo" to="/">
          <img className="brand-mark" src="/brand/ppship-emblem.png" alt="" width="32" height="32" />
          Prepreneurship
        </Link>
        <Link className="btn btn-quiet" to="/login">
          Sign in
        </Link>
      </header>

      <div className="apply-shell verify-shell">
        <header className="page-head">
          <div>
            <h1>Certificate verification</h1>
            <p className="muted">
              Checked against the Institute&rsquo;s own register. Nothing on this page comes from
              the document you are holding — it is read back from the record that issued it.
            </p>
          </div>
        </header>

        {failed && (
          <div className="alert alert-error" role="alert">
            <p>We could not check that certificate just now. Please try again shortly.</p>
          </div>
        )}

        {code && !result && !failed && (
          <div className="card verify-card">
            <p className="muted">Checking the register…</p>
          </div>
        )}

        {result && (
          <div className={`card verify-card is-${verdict}`}>
            {/* THE VERDICT, FIRST AND IN WORDS. The mark and the colour are
                ornament; the sentence is the answer, and it is the part that
                survives a monochrome print and a screen reader (NFR-ACC-007). */}
            <div className="verify-verdict" role="status">
              <span className="verify-mark" aria-hidden="true">
                <Icon
                  name={verdict === "valid" ? "shield" : verdict === "unknown" ? "search" : "alert"}
                />
              </span>
              <div>
                <strong>
                  {verdict === "valid" && "Certificate verified"}
                  {verdict === "archived" && "Genuine, but withdrawn from circulation"}
                  {verdict === "revoked" && "This certificate has been revoked"}
                  {verdict === "unknown" && "No certificate matches that code"}
                </strong>
                <p>
                  {verdict === "valid" &&
                    `Issued by ${result.instituteName} and standing at the moment of this check.`}
                  {verdict === "archived" &&
                    "The Institute issued this certificate and does not dispute it, but has since superseded or retired it. Ask the holder for the current one."}
                  {verdict === "revoked" &&
                    "The Institute has withdrawn this certificate. It should not be relied on as evidence of the qualification."}
                  {verdict === "unknown" &&
                    "Check it against the printed document — the line beginning CERT — or ask the holder to send the verification link again."}
                </p>
              </div>
            </div>

            {result.found && (
              <>
                <dl className="verify-facts">
                  <div>
                    <dt>Awarded to</dt>
                    <dd className="verify-holder">{result.holderName}</dd>
                  </div>
                  <div>
                    <dt>For</dt>
                    <dd>
                      {result.awardedFor}
                      {result.programme && <span className="muted"> · {result.programme}</span>}
                    </dd>
                  </div>
                  <div>
                    <dt>Certificate</dt>
                    <dd>{result.kindLabel}</dd>
                  </div>
                  <div>
                    <dt>Issued by</dt>
                    <dd>{result.instituteName}</dd>
                  </div>
                  {result.instructorName && (
                    <div>
                      <dt>Instructor</dt>
                      <dd>{result.instructorName}</dd>
                    </div>
                  )}
                  <div>
                    <dt>Issued on</dt>
                    <dd>{longDate(result.issuedAt)}</dd>
                  </div>
                  {result.completionDate && (
                    <div>
                      <dt>Completed</dt>
                      <dd>{longDate(result.completionDate)}</dd>
                    </div>
                  )}
                  <div>
                    <dt>Certificate number</dt>
                    <dd className="verify-no">{result.certificateNo}</dd>
                  </div>
                </dl>

                {verdict === "revoked" && (
                  <div className="alert alert-warn">
                    <p>
                      Withdrawn by the Institute
                      {result.revokedAt ? ` on ${longDate(result.revokedAt)}` : ""}. The reason is
                      held on the Institute&rsquo;s record and is not published here; contact the
                      Institute if you need to know more.
                    </p>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* SOMEBODY WITH PAPER AND NO CAMERA. The QR code is the fast path, but
            a printed certificate is often photocopied or scanned flat, and the
            number under it is then the only way in. */}
        <section className="card verify-lookup">
          <h2>Check another certificate</h2>
          <p className="muted small">
            Type the certificate number printed on the document. It looks like CERT-2026-000001.
          </p>
          <form
            className="track-form"
            onSubmit={(e) => {
              e.preventDefault();
              const value = typed.trim();
              if (!value) return;
              navigate(`/verify/certificate/${encodeURIComponent(value)}`);
              check(value);
            }}
          >
            <label className="field">
              <span>Certificate number</span>
              <input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder="CERT-2026-000001"
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <button className="btn btn-primary" type="submit" disabled={!typed.trim()}>
              Verify
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
