import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { encodeQr, qrPath } from "@lms/shared";
import { SkeletonCards } from "../components/Ui";
import { Icon } from "../components/Icon";
import { ApiError, api } from "../api/client";
import { DownloadReceipt, money } from "./FeesSubmissions";

/**
 * THE FEE RECEIPT — SRS §13.11, FR-PAY-039..042.
 *
 * A DOCUMENT, NOT A DASHBOARD CARD. This is the Institute's written admission
 * that it holds somebody's money, and it is read by people who were not in the
 * room: a parent, an employer, a scholarship office, a visa officer. So it is
 * laid out as a financial document — a masthead, a numbered reference, fields
 * in a fixed order, one figure in words as well as digits, an account, a
 * signature block — and not as a card with rounded corners and a status chip.
 *
 * ITS OWN ROUTE. Somebody opens it, presses Print, and hands over the paper. A
 * modal would print the screen around it and would have no address to reopen
 * it at. Because it is a route, a student prints their own without an
 * administrator doing it for them — which is what `payment:read` at OWN scope
 * is for, and the difference between a record they hold and a favour they ask.
 *
 * THE PDF IS THE ARTEFACT, THE PAGE IS THE VIEW. Print works and is kept, but
 * what a student attaches to an application has to be a FILE that looks the
 * same everywhere — so Download fetches the server-rendered A4 document, laid
 * out in points by the same code that produced the copy already emailed to
 * them. The two are the same document; this one is just readable on a phone.
 *
 * FOUR THINGS IT REFUSES TO HIDE, because each is the reason somebody would
 * later say the document lied:
 *
 *   a REPRINT says so, prominently — two papers bearing one number will meet
 *   on a desk, and only one of them is the first
 *
 *   a REVERSED payment still prints, and says it was reversed. Refusing would
 *   leave the student holding the only record of a transaction the Institute
 *   has since undone
 *
 *   the BALANCE is on the face of it. "We received 25,000" leaves the one
 *   question its holder actually has — "so what do I still owe?" — to a
 *   telephone call
 *
 *   the VERIFICATION line names who confirmed it and when. A receipt nobody
 *   is named on is a receipt nobody stands behind.
 */

interface Receipt {
  receiptNo: string;
  issuedAt: string;
  reprint: boolean;
  status: "VERIFIED" | "REVERSED";
  institute: {
    name: string;
    campus: string;
    phone: string;
    email: string;
    website: string;
  };
  student: {
    fullName: string;
    registrationNo: string;
    programme: string | null;
    section: string | null;
    rollNo: number | null;
  };
  payment: {
    id: string;
    amount: number;
    currency: string;
    amountInWords: string;
    paidOn: string;
    method: string;
    methodLabel: string;
    bankReference: string | null;
    submissionReference: string | null;
  };
  verification: { verifiedBy: string; verifiedAt: string; note: string | null };
  reversal: { reversedAt: string; reason: string | null } | null;
  ledger: {
    totalFee: number;
    previouslyPaid: number;
    thisPayment: number;
    balanceAfter: number;
  } | null;
  verifyUrl: string | null;
  note: string;
}

/** A date on a document is spelled out. "03/04/26" is three different days. */
const longDate = (iso: string): string =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

export function ReceiptPage() {
  const { paymentId } = useParams<{ paymentId: string }>();
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!paymentId) return;
    api
      .get<Receipt>(`/payments/${paymentId}/receipt`)
      .then(setReceipt)
      .catch((e) =>
        setError(e instanceof ApiError ? e.message : "That receipt could not be found."),
      );
  }, [paymentId]);

  // The QR is the expensive part of this render and depends on one string.
  const qr = useMemo(() => {
    if (!receipt?.verifyUrl) return null;
    try {
      const matrix = encodeQr(receipt.verifyUrl);
      return { modules: matrix.length, path: qrPath(matrix, 1) };
    } catch {
      // A verification URL long enough to overflow the symbol is a
      // misconfiguration, not a receipt problem. The document still prints,
      // with its number and its written verification line.
      return null;
    }
  }, [receipt?.verifyUrl]);

  if (error) {
    return (
      <>
        <div className="alert alert-error" role="alert">
          <p>{error}</p>
        </div>
        <Link className="btn no-print" to="/fees">
          Back to Fees
        </Link>
      </>
    );
  }
  if (!receipt || !paymentId) return <SkeletonCards count={2} />;

  const c = receipt.payment.currency;
  const reversed = receipt.status === "REVERSED";

  return (
    <>
      {/* Hidden when printing. The document below is what goes on paper. */}
      <div className="row-actions no-print receipt-toolbar">
        <button className="btn btn-primary" onClick={() => window.print()}>
          <Icon name="print" /> Print
        </button>
        <DownloadReceipt paymentId={paymentId} receiptNo={receipt.receiptNo} />
        <Link className="btn btn-quiet" to="/fees">
          Back to Fees
        </Link>
      </div>

      <article className={reversed ? "receipt is-reversed" : "receipt"}>
        {/*
          THE MASTHEAD. The Institute's name is the largest thing on the page
          because the document's whole authority is that it comes from them.
        */}
        <header className="receipt-head">
          <div className="receipt-issuer">
            <img
              className="receipt-logo"
              src="/brand/ppship-emblem.png"
              alt=""
              aria-hidden="true"
            />
            <div>
              <h1>{receipt.institute.name}</h1>
              {receipt.institute.campus && <p className="receipt-campus">{receipt.institute.campus}</p>}
              <p className="receipt-contact">
                {[receipt.institute.phone, receipt.institute.email, receipt.institute.website]
                  .filter(Boolean)
                  .join("  ·  ")}
              </p>
            </div>
          </div>

          <div className="receipt-no">
            <p className="receipt-doctype">Fee payment receipt</p>
            <p className="receipt-number">{receipt.receiptNo}</p>
            <p className="receipt-issued">Issued {longDate(receipt.issuedAt)}</p>
          </div>
        </header>

        <div className="receipt-rule" aria-hidden="true" />

        {receipt.reprint && (
          <p className="receipt-stamp">DUPLICATE — this receipt has been printed before</p>
        )}

        {receipt.reversal && (
          <p className="receipt-stamp receipt-void">
            REVERSED on {longDate(receipt.reversal.reversedAt)}
            {receipt.reversal.reason ? ` — ${receipt.reversal.reason}` : ""}
          </p>
        )}

        <section className="receipt-block">
          <h2 className="receipt-block-title">Received from</h2>
          <dl className="receipt-fields">
            <div>
              <dt>Student</dt>
              <dd>{receipt.student.fullName}</dd>
            </div>
            <div>
              <dt>Registration no.</dt>
              <dd>{receipt.student.registrationNo}</dd>
            </div>
            {receipt.student.programme && (
              <div>
                <dt>Programme</dt>
                <dd>{receipt.student.programme}</dd>
              </div>
            )}
            {receipt.student.section && (
              <div>
                <dt>Batch</dt>
                <dd>
                  {receipt.student.section}
                  {receipt.student.rollNo === null ? "" : ` · roll no. ${receipt.student.rollNo}`}
                </dd>
              </div>
            )}
          </dl>
        </section>

        <section className="receipt-block">
          <h2 className="receipt-block-title">Payment</h2>
          <dl className="receipt-fields">
            <div>
              <dt>Date of payment</dt>
              <dd>{longDate(receipt.payment.paidOn)}</dd>
            </div>
            <div>
              <dt>Method</dt>
              <dd>{receipt.payment.methodLabel}</dd>
            </div>
            <div>
              <dt>Transaction no.</dt>
              <dd>{receipt.payment.bankReference ?? "—"}</dd>
            </div>
            {receipt.payment.submissionReference && (
              <div>
                <dt>Submitted as</dt>
                <dd>{receipt.payment.submissionReference}</dd>
              </div>
            )}
          </dl>
        </section>

        {/* THE FIGURE. One line, larger than anything else on the page. */}
        <div className="receipt-amount">
          <span>Amount received</span>
          <strong>{money(receipt.payment.amount, c)}</strong>
        </div>

        {/* The ordinary defence against a digit being added to a printed line. */}
        <p className="receipt-words">{receipt.payment.amountInWords}</p>

        {/*
          THE ACCOUNT. Four lines answering "what did I owe, and what do I owe
          now" — the question the holder of this paper actually has. Omitted
          entirely when the server could not state it, because a receipt must
          never print a confident zero it did not compute.
        */}
        {receipt.ledger && (
          <section className="receipt-block">
            <h2 className="receipt-block-title">Fee account at the date of this receipt</h2>
            <table className="receipt-ledger">
              <tbody>
                <tr>
                  <th scope="row">Total fee</th>
                  <td>{money(receipt.ledger.totalFee, c)}</td>
                </tr>
                <tr>
                  <th scope="row">Previously paid</th>
                  <td>{money(receipt.ledger.previouslyPaid, c)}</td>
                </tr>
                <tr>
                  <th scope="row">This payment</th>
                  <td>{money(receipt.ledger.thisPayment, c)}</td>
                </tr>
                <tr className="receipt-ledger-total">
                  <th scope="row">Balance outstanding</th>
                  <td>{money(receipt.ledger.balanceAfter, c)}</td>
                </tr>
              </tbody>
            </table>
          </section>
        )}

        <footer className="receipt-foot">
          <div className="receipt-verification">
            <p className="receipt-block-title">Verified by</p>
            <p className="receipt-verifier">{receipt.verification.verifiedBy}</p>
            <p className="receipt-issued">{longDate(receipt.verification.verifiedAt)}</p>
            {receipt.verification.note && (
              <p className="receipt-issued">{receipt.verification.note}</p>
            )}
          </div>

          {qr && receipt.verifyUrl && (
            <div className="receipt-qr">
              <svg
                viewBox={`0 0 ${qr.modules} ${qr.modules}`}
                width="88"
                height="88"
                role="img"
                aria-label="Scan to check this receipt against the Institute's record"
              >
                <rect width={qr.modules} height={qr.modules} fill="#fff" />
                <path d={qr.path} fill="#111827" />
              </svg>
              <p className="receipt-issued">Scan to verify</p>
            </div>
          )}

          <div className="receipt-sign">
            <p className="receipt-issued">Signature and stamp</p>
          </div>
        </footer>

        <p className="receipt-note">{receipt.note}</p>
      </article>
    </>
  );
}
