import { useEffect, useRef, useState } from "react";
import { CERTIFICATE_KIND_COPY, type CertificateDocument } from "@lms/shared";
import { CertificateArtwork } from "./CertificateDocument";
import {
  certificateAsPdf,
  certificateAsPng,
  certificateFileName,
  loadCertificateAssets,
  printCertificate,
  saveBlob,
  type CertificateAssets,
} from "./certificate-export";
import { Icon } from "./Icon";

/**
 * The certificate, large, with everything a person wants to do with it.
 *
 * THE PREVIEW IS THE DOCUMENT, not a picture of it. The same SVG is what gets
 * rasterised for the PNG and the PDF, so there is no "the download looked
 * different" failure available — the thing on screen is the thing in the file.
 *
 * THE ACTIONS ARE THE POINT OF THE SCREEN. A student who has just earned a
 * qualification wants to send it to somebody within the minute, and the four
 * ways they will want to do that — a PDF for an application, an image for
 * WhatsApp, paper for a file, a link for an employer — are all one press.
 */

type Job = "pdf" | "png" | "print" | null;

export function CertificateViewer({
  certificate,
  compact = false,
}: {
  certificate: CertificateDocument;
  /** Drops the surrounding card, for use inside a panel that has its own. */
  compact?: boolean;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [assets, setAssets] = useState<CertificateAssets | null>(null);
  const [job, setJob] = useState<Job>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  /*
   * The fonts and the mark are fetched as soon as the certificate is on
   * screen, not when somebody presses Download.
   *
   * They are about 150 kB and they are cached for the whole page load, so
   * doing it now costs nothing anybody notices — and doing it later would put
   * a network round trip between pressing a button and anything happening,
   * which is exactly where a wait feels like a fault.
   */
  useEffect(() => {
    let live = true;
    loadCertificateAssets()
      .then((loaded) => live && setAssets(loaded))
      .catch(() => live && setError("The certificate's fonts could not be loaded. Downloads may not look right."));
    return () => {
      live = false;
    };
  }, []);

  const run = async (which: Exclude<Job, null>, work: (svg: SVGSVGElement, a: CertificateAssets) => Promise<void>) => {
    const svg = svgRef.current;
    if (!svg) return;

    setError(null);
    setJob(which);
    try {
      const ready = assets ?? (await loadCertificateAssets());
      setAssets(ready);
      await work(svg, ready);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work. Please try again.");
    } finally {
      setJob(null);
    }
  };

  const copyLink = () => {
    void navigator.clipboard?.writeText(certificate.verification.url);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2500);
  };

  const kind = CERTIFICATE_KIND_COPY[certificate.kind];
  const title = `${kind.label} — ${certificate.student.name}`;

  return (
    <div className={compact ? "certificate-viewer is-compact" : "certificate-viewer"}>
      {/* The stage holds the aspect ratio, so the document never distorts and
          never overflows sideways on a phone. */}
      <div className="certificate-stage">
        <CertificateArtwork ref={svgRef} certificate={certificate} />
      </div>

      {error && (
        <div className="alert alert-error" role="alert">
          <p>{error}</p>
        </div>
      )}

      {certificate.status === "REVOKED" && (
        <div className="alert alert-warn">
          <p>
            <strong>This certificate has been withdrawn.</strong>{" "}
            {certificate.revocationReason}
            {" It can still be downloaded, and every copy is marked as revoked."}
          </p>
        </div>
      )}

      <div className="certificate-actions no-print">
        <button
          type="button"
          className="btn btn-primary"
          disabled={job !== null}
          onClick={() =>
            void run("pdf", async (svg, a) =>
              saveBlob(
                await certificateAsPdf(svg, a, {
                  title: `${certificate.certificateNo} ${certificate.award.title}`,
                  author: certificate.institute.name,
                }),
                certificateFileName(certificate.certificateNo, certificate.student.name, "pdf"),
              ),
            )
          }
        >
          <Icon name="download" />
          {job === "pdf" ? "Preparing PDF…" : "Download PDF"}
        </button>

        <button
          type="button"
          className="btn"
          disabled={job !== null}
          onClick={() =>
            void run("png", async (svg, a) =>
              saveBlob(
                await certificateAsPng(svg, a),
                certificateFileName(certificate.certificateNo, certificate.student.name, "png"),
              ),
            )
          }
        >
          <Icon name="image" />
          {job === "png" ? "Preparing image…" : "Download image"}
        </button>

        <button
          type="button"
          className="btn"
          disabled={job !== null}
          onClick={() => void run("print", (svg, a) => printCertificate(svg, a, title))}
        >
          <Icon name="print" />
          {job === "print" ? "Opening…" : "Print"}
        </button>

        <button type="button" className="btn btn-quiet" onClick={copyLink}>
          <Icon name="link" />
          {copied ? "Link copied" : "Copy verification link"}
        </button>

        {/* An ordinary link, because it leaves the application: the public page
            is what an employer sees, and opening it in a tab is how somebody
            checks that their own link works. */}
        <a
          className="btn btn-quiet"
          href={certificate.verification.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          <Icon name="shield" />
          Open verification page
        </a>
      </div>

      <p className="muted small certificate-note">
        The PDF is A4 landscape at print resolution. The image is for sharing —
        WhatsApp, LinkedIn, or a portfolio.
      </p>
    </div>
  );
}
