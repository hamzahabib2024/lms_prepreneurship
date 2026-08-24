import { useEffect, useRef } from "react";
import { CERTIFICATE_KIND_COPY, type CertificateDocument } from "@lms/shared";
import { CertificateViewer } from "./CertificateViewer";

/**
 * The certificate at full size, over the page — UI-011.
 *
 * A DIALOG RATHER THAN A ROUTE, because the reader is in the middle of
 * something: a student scanning their shelf, an administrator working down the
 * register. Sending them to another address and back loses their filters,
 * their scroll position and their place in the list.
 *
 * Escape closes it, the backdrop closes it, and focus moves into the dialog on
 * open and is not left behind the overlay (NFR-ACC-005).
 */
export function CertificateModal({
  certificate,
  onClose,
}: {
  certificate: CertificateDocument;
  onClose: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const copy = CERTIFICATE_KIND_COPY[certificate.kind];

  return (
    <div
      className="modal-backdrop"
      // The backdrop closes, but only when the backdrop itself was pressed:
      // without the target test, releasing a text selection that started
      // inside the dialog closes it, which reads as the app losing the file.
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal certificate-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`${copy.label} — ${certificate.student.name}`}
        tabIndex={-1}
        ref={panel}
      >
        <div className="modal-head card-head">
          <div>
            <h2>{certificate.award.title}</h2>
            <p className="muted small">
              {copy.label} · {certificate.student.name} · {certificate.certificateNo}
            </p>
          </div>
          <button type="button" className="btn btn-quiet" onClick={onClose}>
            Close
          </button>
        </div>

        <CertificateViewer certificate={certificate} compact />
      </div>
    </div>
  );
}
