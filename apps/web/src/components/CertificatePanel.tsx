import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CERTIFICATE_KIND_COPY, type CertificateDocument } from "@lms/shared";
import { ApiError, api } from "../api/client";
import { CertificateCard } from "./CertificateCard";
import { CertificateModal } from "./CertificateModal";

/**
 * A student's certificates, beside their subjects — SRS §13.5, FR-CRT-015.
 *
 * A TASTER, NOT THE SHELF. The full list lives at /my-certificates; this is
 * the two most recent, on the page a student is already looking at, because
 * the moment a certificate appears is the moment they want to send it to
 * somebody. Anything more would push the subjects they came for off the
 * screen.
 *
 * Shows revoked ones too. A student may be holding the printed copy, and
 * hiding the record would leave them unable to find out why it no longer
 * verifies (BR-ENR-08 keeps this readable after withdrawal).
 */

const SHOWN = 2;

export function CertificatePanel() {
  const [items, setItems] = useState<CertificateDocument[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<CertificateDocument | null>(null);

  useEffect(() => {
    api
      .get<CertificateDocument[]>("/me/certificates")
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

  return (
    <section className="card">
      <div className="card-head">
        <h2>Certificates</h2>
        <Link className="btn btn-sm btn-quiet" to="/my-certificates">
          See all {items.length}
        </Link>
      </div>

      <div className="certificate-grid">
        {items.slice(0, SHOWN).map((c) => (
          <CertificateCard
            key={c.id}
            certificate={c}
            caption={CERTIFICATE_KIND_COPY[c.kind].label}
            onOpen={() => setOpen(c)}
          />
        ))}
      </div>

      {open && <CertificateModal certificate={open} onClose={() => setOpen(null)} />}
    </section>
  );
}
