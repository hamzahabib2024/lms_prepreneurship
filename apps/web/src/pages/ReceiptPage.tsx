import { useEffect, useState } from "react";
import { SkeletonCards } from "../components/Ui";
import { useParams } from "react-router-dom";
import { ApiError, api } from "../api/client";

/**
 * A printed receipt — SRS §13.11, FR-PAY-039..042.
 *
 * ITS OWN ROUTE, NOT A MODAL. A receipt is a document: somebody opens it,
 * presses Ctrl-P, and hands over the paper. A modal would print the whole
 * screen around it, and there would be no address to reopen it at. Because it
 * is a route, a student can print their own without an administrator doing it
 * for them — which is exactly what `payment:read` at OWN scope is for.
 *
 * THE PRINT RULES ARE THE POINT of the styling. Everything that is not the
 * document is hidden when printing: the navigation, the buttons, the page
 * chrome. What is left has to survive being photocopied and stapled to a file.
 *
 * A REPRINT SAYS SO, prominently. Two pieces of paper carrying one receipt
 * number will end up on a desk together, and the only honest thing is for the
 * second to admit what it is.
 */

interface Receipt {
  receiptNo: string;
  issuedAt: string;
  reprint: boolean;
  institute: { name: string; campus: string };
  student: {
    fullName: string;
    registrationNo: string;
    programme: string | null;
    section: string | null;
  };
  payment: {
    id: string;
    amount: number;
    currency: string;
    amountInWords: string;
    paidOn: string;
    method: string;
    bankReference: string | null;
    receivedBy: string;
  };
  reversal: { reversedAt: string; reason: string | null } | null;
  note: string;
}

const money = (n: number) =>
  new Intl.NumberFormat("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

const date = (iso: string) => new Date(iso).toLocaleDateString("en-PK", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

const METHOD: Record<string, string> = {
  BANK_TRANSFER: "Bank transfer",
  CASH_DEPOSIT: "Cash deposit",
  CHEQUE: "Cheque",
  OTHER: "Other",
};

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
        setError(
          e instanceof ApiError ? e.message : "That receipt could not be found.",
        ),
      );
  }, [paymentId]);

  if (error) {
    return (
      <div className="alert alert-error" role="alert">
        <p>{error}</p>
      </div>
    );
  }
  if (!receipt) return <SkeletonCards count={2} />;

  return (
    <>
      {/* Hidden when printing. The document below is what goes on paper. */}
      <div className="row-actions no-print">
        <button className="btn btn-primary" onClick={() => window.print()}>
          Print
        </button>
      </div>

      <article className="receipt">
        <header className="receipt-head">
          <div>
            <h1>{receipt.institute.name}</h1>
            {receipt.institute.campus && <p className="muted">{receipt.institute.campus}</p>}
          </div>
          <div className="receipt-no">
            <p className="muted small">Receipt no.</p>
            <p className="stat">
              <strong>{receipt.receiptNo}</strong>
            </p>
            <p className="muted small">{date(receipt.issuedAt)}</p>
          </div>
        </header>

        {/* Prominent, because two papers with one number will meet on a desk. */}
        {receipt.reprint && (
          <p className="receipt-stamp">DUPLICATE — this receipt has been printed before</p>
        )}

        {receipt.reversal && (
          <p className="receipt-stamp receipt-void">
            REVERSED on {date(receipt.reversal.reversedAt)}
            {receipt.reversal.reason ? ` — ${receipt.reversal.reason}` : ""}
          </p>
        )}

        <dl className="receipt-fields">
          <div>
            <dt>Received from</dt>
            <dd>{receipt.student.fullName}</dd>
          </div>
          <div>
            <dt>Registration no.</dt>
            <dd>{receipt.student.registrationNo}</dd>
          </div>
          {receipt.student.programme && (
            <div>
              <dt>Programme</dt>
              <dd>
                {receipt.student.programme}
                {receipt.student.section ? ` — ${receipt.student.section}` : ""}
              </dd>
            </div>
          )}
          <div>
            <dt>Date of payment</dt>
            <dd>{date(receipt.payment.paidOn)}</dd>
          </div>
          <div>
            <dt>Method</dt>
            <dd>
              {METHOD[receipt.payment.method] ?? receipt.payment.method}
              {receipt.payment.bankReference ? ` — ref. ${receipt.payment.bankReference}` : ""}
            </dd>
          </div>
        </dl>

        <div className="receipt-amount">
          <span>Amount received</span>
          <strong>
            {receipt.payment.currency} {money(receipt.payment.amount)}
          </strong>
        </div>

        {/* The ordinary defence against a digit being added to a printed line. */}
        <p className="receipt-words">{receipt.payment.amountInWords}</p>

        <footer className="receipt-foot">
          <div>
            <p className="muted small">Received by</p>
            <p>{receipt.payment.receivedBy}</p>
          </div>
          <div className="receipt-sign">
            <p className="muted small">Signature and stamp</p>
          </div>
        </footer>

        <p className="muted small">{receipt.note}</p>
      </article>
    </>
  );
}
