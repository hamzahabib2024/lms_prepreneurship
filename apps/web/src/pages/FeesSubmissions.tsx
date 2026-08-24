import { useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, api } from "../api/client";
import { Icon } from "../components/Icon";
import { ProofFile } from "../components/SlipViewer";

/**
 * THE FOUR NUMBERS, AND A STUDENT'S OWN CLAIMS.
 *
 * Shared between the student's Fees page and the administrator looking at one
 * student's record, so that neither can tell somebody a different figure from
 * the other. The arithmetic itself is not here and never should be: it is done
 * once on the server (fee-summary.ts) and these components only lay it out.
 *
 * THE ONE THING THE LAYOUT IS RESPONSIBLE FOR is the distinction the whole
 * feature exists to hold — that a payment SUBMITTED is not a payment RECEIVED.
 * So "Awaiting checking" is never placed in the running total, never coloured
 * like money, and always carries a sentence saying it does not count yet. The
 * single most likely misreading of this screen is that sending a screenshot
 * settles a fee, and every choice below is made against that.
 */

export interface FeeSummary {
  currency: string;
  totalFee: number;
  charged: number;
  waived: number;
  verified: number;
  reversed: number;
  pending: number;
  pendingCount: number;
  remaining: number;
  remainingIfAllVerified: number;
  credit: number;
  standing:
    | "NOTHING_DUE"
    | "AWAITING_VERIFICATION"
    | "PARTIALLY_PAID"
    | "FULLY_PAID"
    | "IN_CREDIT"
    | "UNPAID";
  headline: string;
}

export interface Submission {
  id: string;
  reference: string;
  status: "PENDING" | "VERIFIED" | "REJECTED" | "CANCELLED";
  amount: number;
  verifiedAmount: number | null;
  currency: string;
  method: string;
  methodLabel: string;
  bankReference: string | null;
  paidOn: string;
  submittedAt: string;
  reviewedAt: string | null;
  reviewNote: string | null;
  studentNote: string | null;
  paymentId: string | null;
  receiptNo: string | null;
  receiptReversed: boolean;
  proof: Array<{ id: string; filename: string; contentType: string }>;
}

/**
 * Money, exactly, with its currency said out loud.
 *
 * NEVER ABBREVIATED. "45k" on a fee statement is an invitation to a dispute,
 * and the exact figure is the entire point of the screen. The currency is
 * printed rather than assumed because a student comparing this against a bank
 * app should not have to.
 */
export const money = (n: number, currency = "PKR"): string => {
  const body = Math.abs(n).toLocaleString("en-PK", {
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 2,
  });
  const sign = n < 0 ? "−" : "";
  return currency === "PKR" ? `${sign}Rs ${body}` : `${sign}${currency} ${body}`;
};

export const shortDate = (iso: string): string =>
  new Date(iso).toLocaleDateString("en-PK", { year: "numeric", month: "short", day: "numeric" });

/**
 * What a status is CALLED, in the Institute's own words.
 *
 * "Rejected" and "Verification pending" are database states. A student reading
 * their own screen gets a sentence about what is happening and, where it
 * matters, what they should do — NFR-USE. The office sees shorter labels,
 * because a queue of forty rows is read by scanning rather than by reading.
 */
export const STUDENT_STATUS: Record<Submission["status"], string> = {
  PENDING: "Waiting to be checked",
  VERIFIED: "Verified",
  REJECTED: "Could not be verified",
  CANCELLED: "Withdrawn",
};

export const OFFICE_STATUS: Record<Submission["status"], string> = {
  PENDING: "Pending",
  VERIFIED: "Verified",
  REJECTED: "Rejected",
  CANCELLED: "Withdrawn",
};

/** The pill class for a status. A word as well as a colour (NFR-ACC-003). */
export const statusPill = (status: Submission["status"]): string =>
  status === "VERIFIED"
    ? "pill pill-ok"
    : status === "REJECTED"
      ? "pill pill-danger"
      : status === "CANCELLED"
        ? "pill"
        : "pill pill-warn";

const STANDING_PILL: Record<FeeSummary["standing"], string> = {
  NOTHING_DUE: "pill",
  AWAITING_VERIFICATION: "pill pill-warn",
  PARTIALLY_PAID: "pill pill-warn",
  FULLY_PAID: "pill pill-ok",
  IN_CREDIT: "pill pill-ok",
  UNPAID: "pill pill-warn",
};

const STANDING_WORD: Record<FeeSummary["standing"], string> = {
  NOTHING_DUE: "Nothing charged yet",
  AWAITING_VERIFICATION: "Payment being checked",
  PARTIALLY_PAID: "Partly paid",
  FULLY_PAID: "Paid in full",
  IN_CREDIT: "Overpaid",
  UNPAID: "Not paid",
};

/**
 * The fee summary — the one thing a student opens this page to find out.
 *
 * FOUR FIGURES AND A SENTENCE, in that order of prominence, and the sentence
 * is written by the server so that the wording and the arithmetic cannot drift
 * apart. "Still to pay" is the largest because it is the answer to the
 * question actually being asked.
 */
export function FeeSummaryPanel({
  summary,
  action,
}: {
  summary: FeeSummary;
  /** The submit button, when the viewer is the student themselves. */
  action?: React.ReactNode;
}) {
  const c = summary.currency;

  return (
    <section className="card fee-standing">
      <div className="fee-standing-head">
        <div>
          <h2>Fee summary</h2>
          <p className="fee-headline">{summary.headline}</p>
        </div>
        <span className={STANDING_PILL[summary.standing]}>{STANDING_WORD[summary.standing]}</span>
      </div>

      <div className="fee-figures">
        <div className="fee-figure">
          <span className="fee-figure-label">Total fee</span>
          <strong className="fee-figure-value">{money(summary.totalFee, c)}</strong>
          <span className="fee-figure-note">
            {summary.waived > 0
              ? `${money(summary.charged, c)} charged, ${money(summary.waived, c)} written off`
              : "Charged to you"}
          </span>
        </div>

        <div className="fee-figure is-ok">
          <span className="fee-figure-label">Paid and verified</span>
          <strong className="fee-figure-value">{money(summary.verified, c)}</strong>
          <span className="fee-figure-note">
            {summary.reversed > 0
              ? `${money(summary.reversed, c)} was later reversed`
              : "Confirmed by the office"}
          </span>
        </div>

        {/*
          EVIDENCE, NOT MONEY — and the note says so in words rather than by
          being a different shade. This tile is the one a student is most
          likely to read as "already paid".
        */}
        <div className={summary.pending > 0 ? "fee-figure is-pending" : "fee-figure"}>
          <span className="fee-figure-label">Awaiting checking</span>
          <strong className="fee-figure-value">{money(summary.pending, c)}</strong>
          <span className="fee-figure-note">
            {summary.pendingCount === 0
              ? "Nothing waiting"
              : `${summary.pendingCount} submission${summary.pendingCount === 1 ? "" : "s"} — not counted yet`}
          </span>
        </div>

        <div className={summary.remaining > 0 ? "fee-figure is-due" : "fee-figure is-ok"}>
          <span className="fee-figure-label">
            {summary.credit > 0 ? "In credit" : "Still to pay"}
          </span>
          <strong className="fee-figure-value">
            {money(summary.credit > 0 ? summary.credit : summary.remaining, c)}
          </strong>
          <span className="fee-figure-note">
            {summary.credit > 0
              ? "Paid more than was charged"
              : summary.pending > 0
                ? `${money(Math.max(0, summary.remainingIfAllVerified), c)} if everything waiting is verified`
                : "Total fee less verified payments"}
          </span>
        </div>
      </div>

      {action && <div className="fee-standing-action">{action}</div>}
    </section>
  );
}

/**
 * The payment history.
 *
 * A TABLE ON A DESK AND CARDS ON A PHONE — the same rows either way, because a
 * student checks this on the device the payment screenshot came from. The
 * mobile layout is CSS on the same markup rather than a second component, so
 * the two cannot fall out of step.
 *
 * A REJECTION SHOWS ITS REASON IN THE ROW, not behind a click. The reason is
 * the only actionable thing on this screen, and hiding it is what makes a
 * student telephone the office — which is the cost this feature exists to
 * remove.
 */
export function SubmissionHistory({
  submissions,
  audience,
  onCancel,
  emptyHint,
}: {
  submissions: Submission[];
  audience: "student" | "office";
  /** Withdrawing a claim nobody has looked at. Student's own screen only. */
  onCancel?: (id: string) => void;
  emptyHint?: React.ReactNode;
}) {
  const labels = audience === "student" ? STUDENT_STATUS : OFFICE_STATUS;

  if (submissions.length === 0) {
    return (
      <section className="card">
        <h2>Payment history</h2>
        {emptyHint ?? (
          <p className="muted">
            No payments have been submitted yet. Once you send one it appears here with its
            receipt.
          </p>
        )}
      </section>
    );
  }

  return (
    <section className="card">
      <h2>Payment history</h2>
      <p className="muted small">
        Every payment you have submitted, including any we could not verify. Nothing is ever
        removed from this list.
      </p>

      <ul className="paylist">
        {submissions.map((s) => (
          <li key={s.id} className="payrow">
            <div className="payrow-main">
              <div className="payrow-amount">
                <strong>{money(s.verifiedAmount ?? s.amount, s.currency)}</strong>
                {/*
                  WHEN THE OFFICE VERIFIED A DIFFERENT FIGURE, both are shown.
                  A student whose 25,000 was verified as 24,900 must find that
                  out here rather than from a balance that will not settle.
                */}
                {s.verifiedAmount !== null && Math.abs(s.verifiedAmount - s.amount) > 0.005 && (
                  <span className="payrow-claimed">you submitted {money(s.amount, s.currency)}</span>
                )}
              </div>

              <div className="payrow-meta">
                <span className={statusPill(s.status)}>{labels[s.status]}</span>
                <span className="muted small">
                  {s.methodLabel} · paid {shortDate(s.paidOn)}
                  {s.bankReference ? ` · ref. ${s.bankReference}` : ""}
                </span>
                <span className="muted small">
                  {s.reference} · submitted {shortDate(s.submittedAt)}
                  {s.reviewedAt ? ` · reviewed ${shortDate(s.reviewedAt)}` : ""}
                </span>
              </div>
            </div>

            {/* The office's answer, verbatim, where it is needed. */}
            {s.status === "REJECTED" && s.reviewNote && (
              <div className="alert alert-error payrow-note" role="alert">
                <strong>Why this could not be verified</strong>
                <p className="small">{s.reviewNote}</p>
                {audience === "student" && (
                  <p className="small">
                    Fix what is described above and submit the payment again — your earlier
                    submission stays on the record.
                  </p>
                )}
              </div>
            )}
            {s.status === "VERIFIED" && s.reviewNote && (
              <p className="muted small payrow-note">Office note: {s.reviewNote}</p>
            )}
            {s.status === "PENDING" && audience === "student" && (
              <p className="muted small payrow-note">
                We are checking this against the bank record. You do not need to do anything —
                we will email you when it is done.
              </p>
            )}
            {s.receiptReversed && (
              <p className="warn small payrow-note">
                This payment was later reversed. The receipt remains on the record and says so.
              </p>
            )}

            <div className="payrow-actions">
              {s.proof.length > 0 && (
                <ProofToggle
                  submissionId={s.id}
                  proof={s.proof}
                  label={s.proof.length === 1 ? "View my receipt photo" : `View ${s.proof.length} files`}
                />
              )}

              {s.paymentId && (
                <>
                  <Link className="btn btn-sm" to={`/receipts/${s.paymentId}`}>
                    <Icon name="clipboard" /> Fee receipt
                  </Link>
                  <DownloadReceipt paymentId={s.paymentId} receiptNo={s.receiptNo} />
                </>
              )}

              {audience === "student" && s.status === "PENDING" && onCancel && (
                <button className="btn btn-sm btn-quiet" onClick={() => onCancel(s.id)}>
                  Withdraw
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The proof, opened in place.
 *
 * COLLAPSED BY DEFAULT, deliberately. Each file is fetched with the session
 * and held as an object URL; rendering ten of them because a student has ten
 * payments would download ten bank receipts nobody asked to see.
 */
function ProofToggle({
  submissionId,
  proof,
  label,
}: {
  submissionId: string;
  proof: Array<{ id: string; filename: string; contentType: string }>;
  label: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button className="btn btn-sm btn-quiet" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Icon name="image" /> {open ? "Hide receipt" : label}
      </button>
      {open && (
        <div className="payrow-proof">
          {proof.map((d) => (
            <ProofFile
              key={d.id}
              path={`/fees/submissions/${submissionId}/proof/${d.id}`}
              doc={{ originalFilename: d.filename, contentType: d.contentType }}
            />
          ))}
        </div>
      )}
    </>
  );
}

/**
 * The receipt as a file.
 *
 * FETCHED WITH THE SESSION AND SAVED, never a plain link: the endpoint needs a
 * bearer token, so an `<a href>` would download a JSON error page named
 * FEE-2026-000001.pdf. The object URL is revoked immediately — the browser has
 * already taken its copy by then.
 */
export function DownloadReceipt({
  paymentId,
  receiptNo,
}: {
  paymentId: string;
  receiptNo: string | null;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const blob = await api.download(`/payments/${paymentId}/receipt.pdf`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${receiptNo ?? "fee-receipt"}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "The receipt could not be downloaded.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button className="btn btn-sm" onClick={() => void save()} disabled={busy}>
        <Icon name="download" /> {busy ? "Preparing…" : "Download PDF"}
      </button>
      {error && <span className="warn small">{error}</span>}
    </>
  );
}
