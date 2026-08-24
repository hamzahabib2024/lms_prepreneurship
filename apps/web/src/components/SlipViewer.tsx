import { useEffect, useState } from "react";
import { ApiError, api } from "../api/client";

/**
 * The payment slips attached to an application — FR-REG-024.
 *
 * THIS IS THE DECISION. A reviewer approving an admission is saying "the money
 * arrived", and the slip is the evidence. Until now the screen told them slip
 * previews were waiting on the Google Drive credentials and to verify against
 * the bank as they always had — which stopped being true the day slips started
 * being stored locally.
 *
 * FETCHED, NOT LINKED. The endpoint needs a bearer token, so `<img src>` would
 * send no credentials and render a broken image. The bytes come through the
 * api client and become an object URL, which is also what keeps the slip out
 * of the browser's cache and history.
 *
 * `ProofFile` BELOW IS EXPORTED, and that is the whole reason this file is
 * worth reading twice. A student's payment proof is the same object as an
 * applicant's admission slip — a photograph of a bank receipt, behind a bearer
 * token, at a different address — so the fee screens render it with this
 * component rather than a second copy of the object-URL lifecycle. Getting
 * that lifecycle wrong does not fail visibly; it leaks a file's worth of
 * memory per slip, and a clerk works through fifty in a sitting.
 */

export interface SlipDocument {
  id: string;
  documentType: string;
  originalFilename: string;
  contentType: string;
  sizeBytes: number;
  scanStatus: string;
  createdAt: string;
}

export function SlipViewer({ requestId }: { requestId: string }) {
  const [docs, setDocs] = useState<SlipDocument[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDocs(null);
    setError(null);
    api
      .get<{ documents: SlipDocument[] }>(`/registration-requests/${requestId}`)
      .then((r) => setDocs(r.documents ?? []))
      .catch((e) =>
        setError(e instanceof ApiError ? e.message : "Could not load the payment slips."),
      );
  }, [requestId]);

  if (error) {
    return (
      <div className="alert alert-error" role="alert">
        <p>{error}</p>
      </div>
    );
  }

  if (!docs) return <p className="muted small">Loading the payment slip…</p>;

  if (docs.length === 0) {
    // FR-REG-008 requires at least one, so none means something went wrong on
    // the way in. Said as a warning rather than an empty space, because a
    // reviewer must not approve a payment they have no evidence of.
    return (
      <div className="alert alert-warn">
        <strong>No payment slip is attached</strong>
        <p className="small">
          This application carries no evidence of payment. Do not approve it on the strength of the
          claimed amount alone — ask the applicant to send the slip, or check the bank record
          yourself.
        </p>
      </div>
    );
  }

  return (
    <>
      <h3 className="section-label">
        Payment {docs.length === 1 ? "slip" : "slips"}
      </h3>
      {docs.map((d) => (
        <ProofFile
          key={d.id}
          path={`/registration-requests/${requestId}/documents/${d.id}`}
          doc={d}
        />
      ))}
    </>
  );
}

/**
 * One photographed receipt, fetched with the session and shown.
 *
 * TAKES A PATH RATHER THAN AN ID because the two callers reach the same kind
 * of object through different doors — an application's slip is scoped by the
 * application, a payment proof by the submission — and the component has no
 * business knowing which. What it does know is the part that is easy to get
 * wrong: authenticate, make an object URL, and revoke it on unmount.
 */
export function ProofFile({
  path,
  doc,
}: {
  path: string;
  doc: Pick<SlipDocument, "originalFilename" | "contentType"> &
    Partial<Pick<SlipDocument, "sizeBytes" | "scanStatus">>;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let objectUrl: string | null = null;
    api
      .download(path)
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => setFailed(true));

    // Released on unmount. An object URL that is never revoked keeps the whole
    // file in memory for as long as the tab lives, and a reviewer works
    // through fifty of these in a sitting.
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path]);

  const isPdf = doc.contentType === "application/pdf";

  return (
    <div className="slip">
      <div className="slip-meta">
        <span className="muted small">
          {doc.originalFilename}
          {doc.sizeBytes === undefined
            ? ""
            : ` · ${Math.max(1, Math.round(doc.sizeBytes / 1024))} KB`}
        </span>
        {/* SEC-FIL-004 — said plainly. No scanner is wired up yet, and a
            reviewer opening an attachment from a stranger should know that
            rather than assume the System checked it. */}
        {doc.scanStatus !== undefined && doc.scanStatus !== "CLEAN" && (
          <span className="pill pill-warn">Not virus-scanned</span>
        )}
      </div>

      {failed ? (
        <div className="alert alert-error" role="alert">
          <p className="small">
            The file could not be loaded. It may have been removed from storage — the record of it
            remains.
          </p>
        </div>
      ) : !url ? (
        <div className="skeleton" style={{ height: 180 }} aria-hidden="true" />
      ) : isPdf ? (
        <object data={url} type="application/pdf" className="slip-frame" aria-label="Payment receipt">
          <p className="small">
            <a href={url} target="_blank" rel="noreferrer">
              Open the slip
            </a>
          </p>
        </object>
      ) : (
        <>
          {/* Opening full size in a tab, because a bank reference printed
              small on a phone photograph is exactly what has to be read. */}
          <a href={url} target="_blank" rel="noreferrer" title="Open full size">
            <img className="slip-image" src={url} alt={`Payment receipt: ${doc.originalFilename}`} />
          </a>
        </>
      )}
    </div>
  );
}
