import { CERTIFICATE_STATUS_LABEL, type CertificateDocument } from "@lms/shared";
import { CertificateArtwork } from "./CertificateDocument";
import { Icon } from "./Icon";

/**
 * One certificate, small — the tile in a list of them.
 *
 * THE THUMBNAIL IS THE REAL DOCUMENT. It is the same SVG the export
 * rasterises, scaled by CSS rather than redrawn, so a card can never show
 * something the download does not. A generic paper-with-a-ribbon placeholder
 * would have been less code and would have made every certificate look
 * identical, which is precisely what a student is not looking at a list for.
 *
 * IT IS INERT to assistive technology (`aria-hidden`) and the card's own
 * button carries the name: a screen reader reading out fifty SVG text nodes
 * per tile is how a list of four certificates becomes unusable (NFR-ACC-005).
 */
export function CertificateCard({
  certificate: c,
  caption,
  onOpen,
  footer,
}: {
  certificate: CertificateDocument;
  /** The line under the title. The kind for a student, the holder for staff. */
  caption: string;
  onOpen: () => void;
  /** Extra controls for the register — revoke, archive. */
  footer?: React.ReactNode;
}) {
  const status = c.status;

  return (
    <article className={`certificate-card is-${status.toLowerCase()}`}>
      <button
        type="button"
        className="certificate-thumb"
        onClick={onOpen}
        aria-label={`Open the certificate for ${c.award.title}`}
      >
        <span className="certificate-thumb-inner" aria-hidden="true">
          <CertificateArtwork certificate={c} />
        </span>
        <span className="certificate-thumb-hint" aria-hidden="true">
          <Icon name="search" /> View
        </span>
      </button>

      <div className="certificate-card-body">
        <div className="certificate-card-head">
          <h3>{c.award.title}</h3>
          {/* A word, never colour alone (NFR-ACC-007). */}
          <span
            className={
              status === "ISSUED" ? "pill pill-ok" : status === "REVOKED" ? "pill pill-danger" : "pill"
            }
          >
            {CERTIFICATE_STATUS_LABEL[status]}
          </span>
        </div>

        <p className="muted small">{caption}</p>

        <p className="certificate-card-meta">
          <span className="certificate-no">{c.certificateNo}</span>
          <span aria-hidden="true"> · </span>
          <span>Issued {new Date(c.issuedAt).toLocaleDateString()}</span>
        </p>

        {c.status === "REVOKED" && c.revocationReason && (
          <p className="warn small">{c.revocationReason}</p>
        )}

        <div className="row-actions">
          <button type="button" className="btn btn-sm btn-primary" onClick={onOpen}>
            Open
          </button>
          {footer}
        </div>
      </div>
    </article>
  );
}
