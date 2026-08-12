import { useEffect, useState } from "react";
import { ApiError, api } from "../api/client";

/**
 * A student's certificates — SRS §13.5, FR-CRT-015.
 *
 * Shows revoked ones too. A student may be holding the printed copy, and hiding
 * the record would leave them unable to find out why it no longer verifies
 * (BR-ENR-08 keeps this readable even after withdrawal).
 *
 * The verification link is the useful part: it is what a student sends to an
 * employer, so it is presented as something to copy rather than buried.
 */

interface Certificate {
  id: string;
  certificateNo: string;
  type: string;
  status: string;
  issuedAt: string;
  revokedAt: string | null;
  revocationReason: string | null;
  progressPercent: number;
  verificationCode: string;
  subject: { code: string; name: string } | null;
  programme: { code: string; name: string } | null;
}

export function CertificatePanel() {
  const [items, setItems] = useState<Certificate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<Certificate[]>("/me/certificates")
      .then(setItems)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load certificates."));
  }, []);

  if (error) {
    return (
      <section className="card">
        <h2>Certificates</h2>
        <div className="alert alert-error" role="alert">
          <p>{error}</p>
        </div>
      </section>
    );
  }

  // Nothing yet is the normal state for most of a course, so this stays quiet
  // rather than showing an empty panel on every subject page.
  if (!items || items.length === 0) return null;

  const verifyUrl = (code: string) =>
    `${window.location.origin}/verify/${code}`;

  return (
    <section className="card">
      <h2>Certificates</h2>
      <ul className="list">
        {items.map((c) => (
          <li key={c.id} className="assignment">
            <div className="assignment-head">
              <strong>{c.subject?.name ?? c.programme?.name ?? "Certificate"}</strong>
              {/* A word, never colour alone (NFR-ACC-003). */}
              <span className={c.status === "REVOKED" ? "warn small" : "small"}>
                {c.status === "REVOKED" ? "Revoked" : "✓ Valid"}
              </span>
            </div>

            <p className="muted small">
              {c.certificateNo} · issued {new Date(c.issuedAt).toLocaleDateString()}
            </p>

            {c.status === "REVOKED" ? (
              // The reason, plainly. A student who cannot find out why has no
              // way to challenge it (NFR-USE-007).
              <div className="alert alert-warn">
                <p>
                  Revoked {c.revokedAt ? new Date(c.revokedAt).toLocaleDateString() : ""}.{" "}
                  {c.revocationReason}
                </p>
              </div>
            ) : (
              <div className="row-actions">
                <button
                  className="btn btn-quiet"
                  onClick={() => {
                    void navigator.clipboard?.writeText(verifyUrl(c.verificationCode));
                    setCopied(c.id);
                  }}
                >
                  {copied === c.id ? "Link copied" : "Copy verification link"}
                </button>
                <span className="muted small">Give this to an employer to confirm it.</span>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
