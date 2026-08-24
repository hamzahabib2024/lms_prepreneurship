import { useEffect, useState } from "react";
import { CERTIFICATE_KIND_COPY, type CertificateDocument } from "@lms/shared";
import { ApiError, api } from "../api/client";
import { CertificateCard } from "../components/CertificateCard";
import { CertificateModal } from "../components/CertificateModal";
import { EmptyState, ErrorState, SkeletonCards } from "../components/Ui";

/**
 * My certificates — SRS §13.5, FR-CRT-015.
 *
 * A STUDENT'S TROPHY SHELF, not a table of rows. The thing they came for is
 * the document, so the document is what is on screen: each card carries the
 * real certificate, drawn from the same component that prints it, rather than
 * a filename and a download icon.
 *
 * REVOKED ONES ARE SHOWN (BR-ENR-08). A student may be holding the printed
 * copy and be about to send it somewhere; hiding the record would leave them
 * unable to find out why it stopped verifying, which is the one thing they
 * need to know.
 */

export function MyCertificatesPage() {
  const [items, setItems] = useState<CertificateDocument[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<CertificateDocument | null>(null);

  const load = () => {
    setError(null);
    api
      .get<CertificateDocument[]>("/me/certificates")
      .then(setItems)
      .catch((e) =>
        setError(e instanceof ApiError ? e.message : "Could not load your certificates."),
      );
  };

  useEffect(load, []);

  const valid = items?.filter((c) => c.status === "ISSUED").length ?? 0;

  return (
    <>
      <header className="page-head">
        <div>
          <h1>My certificates</h1>
          <p className="muted">
            {items === null
              ? "Everything the Institute has awarded you."
              : items.length === 0
                ? "Everything the Institute has awarded you."
                : `${valid} valid certificate${valid === 1 ? "" : "s"}${
                    items.length > valid ? ` · ${items.length - valid} no longer current` : ""
                  }. Download, print, or send the verification link to an employer.`}
          </p>
        </div>
      </header>

      {error && <ErrorState message={error} onRetry={load} />}

      {!error && items === null && <SkeletonCards count={2} />}

      {!error && items?.length === 0 && (
        <EmptyState icon="award" title="No certificates yet">
          A certificate is issued once you finish a subject and meet its requirements — the
          coursework, the attendance and the pass mark. Your subject pages show how close you are.
          When one is awarded it appears here straight away, ready to download.
        </EmptyState>
      )}

      {items && items.length > 0 && (
        <div className="certificate-grid">
          {items.map((c) => (
            <CertificateCard
              key={c.id}
              certificate={c}
              caption={CERTIFICATE_KIND_COPY[c.kind].label}
              onOpen={() => setOpen(c)}
            />
          ))}
        </div>
      )}

      {open && <CertificateModal certificate={open} onClose={() => setOpen(null)} />}
    </>
  );
}
