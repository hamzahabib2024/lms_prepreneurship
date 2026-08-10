import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

/**
 * Public certificate verification — SRS §13.8, FR-CRT-015.
 *
 * Reached by an employer holding a printed certificate, with no account and no
 * interest in the rest of the System. So it renders outside the application
 * shell: no navigation, no sign-out, nothing suggesting they should log in.
 *
 * It calls the API directly rather than through the client, because that client
 * exists to attach a bearer token and refresh it — neither of which applies to
 * someone who has never signed in.
 */

interface VerifyResult {
  found: boolean;
  certificateNo?: string;
  holderName?: string;
  awardedFor?: string;
  type?: string;
  issuedAt?: string;
  valid?: boolean;
  revokedAt?: string | null;
  message?: string;
}

export function VerifyPage() {
  const { code = "" } = useParams();
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetch(`/api/v1/public/certificates/${encodeURIComponent(code)}/verify`)
      .then((r) => r.json())
      .then((body) => setResult(body.data ?? body))
      .catch(() => setFailed(true));
  }, [code]);

  return (
    <div className="auth-shell">
      <div className="card">
        <h1>Certificate verification</h1>

        {failed && (
          <div className="alert alert-error">
            <p>We could not check that certificate just now. Please try again shortly.</p>
          </div>
        )}

        {!result && !failed && <p className="muted">Checking…</p>}

        {result && !result.found && (
          <div className="alert alert-error">
            <p>
              No certificate matches that code. Check it against the printed document,
              or ask the holder for the link again.
            </p>
          </div>
        )}

        {result?.found && (
          <>
            {/* The verdict first and in words. Someone checking a qualification
                wants one answer, not a form to read (NFR-ACC-003). */}
            {result.valid ? (
              <p className="stat">✓ Valid</p>
            ) : (
              <p className="stat warn">Revoked</p>
            )}

            <ul className="list">
              <li>
                <span>Holder</span>
                <strong>{result.holderName}</strong>
              </li>
              <li>
                <span>Awarded for</span>
                <strong>{result.awardedFor}</strong>
              </li>
              <li>
                <span>Certificate number</span>
                <strong>{result.certificateNo}</strong>
              </li>
              <li>
                <span>Issued</span>
                <strong>
                  {result.issuedAt ? new Date(result.issuedAt).toLocaleDateString() : ""}
                </strong>
              </li>
            </ul>

            {!result.valid && (
              <div className="alert alert-warn">
                <p>
                  This certificate was withdrawn by the Institute
                  {result.revokedAt
                    ? ` on ${new Date(result.revokedAt).toLocaleDateString()}`
                    : ""}
                  . It should not be relied on. Contact the Institute if you need to know
                  more.
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
