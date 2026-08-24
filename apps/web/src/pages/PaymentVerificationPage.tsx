import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, api } from "../api/client";
import { EmptyState, SkeletonTable } from "../components/Ui";
import { Icon } from "../components/Icon";
import { ProofFile } from "../components/SlipViewer";
import { StepUpPrompt, needsStepUp } from "../components/StepUpPrompt";
import { DownloadReceipt, OFFICE_STATUS, money, shortDate, statusPill } from "./FeesSubmissions";

/**
 * THE FEE DESK — FR-PAY-021.
 *
 * ONE SCREEN, WORKED TOP TO BOTTOM. What an administrator does here is decide,
 * forty times in a sitting, whether money named on a photograph actually
 * reached the Institute's account. Everything on the page is arranged around
 * making that decision quickly and making it correctly, in that order of
 * frequency but never in that order of importance.
 *
 * THE QUEUE DEFAULTS TO PENDING, OLDEST FIRST, because that is the order it
 * has to be worked in — a queue that opens on "everything, newest first" has
 * an oldest item nobody ever sees. The server decides that, not this page.
 *
 * THE ARITHMETIC IS SHOWN, NOT LEFT TO THE REVIEWER. "Total required,
 * previously verified, this submission, total after, remaining" comes from the
 * server, computed by the same code that writes the student's own summary, so
 * a reviewer never has to hold a second screen open and never has to do the
 * subtraction in their head. Verifying the wrong figure is the expensive
 * mistake here, and every part of the review panel exists to prevent it.
 *
 * STEP-UP IS EXPECTED, NOT AN ERROR. §4.5 puts `payment_submission` behind a
 * password for staff — reading included, because a queue of bank references
 * left open on an unattended desk is the risk. So the prompt is on the way IN,
 * and the refusal becomes a password box rather than a red banner about a
 * policy working exactly as intended.
 */

interface QueueRow {
  id: string;
  reference: string;
  status: "PENDING" | "VERIFIED" | "REJECTED" | "CANCELLED";
  studentId: string;
  studentName: string;
  registrationNo: string;
  programme: string | null;
  section: string | null;
  amount: number;
  verifiedAmount: number | null;
  currency: string;
  method: string;
  methodLabel: string;
  bankReference: string | null;
  paidOn: string;
  submittedAt: string;
  reviewedAt: string | null;
  receiptNo: string | null;
  proofCount: number;
}

interface Stats {
  pendingCount: number;
  pendingAmount: number;
  oldestPendingDays: number | null;
  rejectedThisMonth: number;
  verifiedTodayCount: number;
  verifiedTodayAmount: number;
  verifiedThisMonthCount: number;
  verifiedThisMonthAmount: number;
  totalCollected: number;
  studentsOwing: number;
  totalOutstanding: number;
}

interface Detail {
  id: string;
  reference: string;
  status: QueueRow["status"];
  student: {
    id: string;
    fullName: string;
    email: string;
    phone: string | null;
    registrationNo: string;
    rollNo: number | null;
    programme: string | null;
    section: string | null;
  };
  snapshot: {
    studentName: string;
    registrationNo: string;
    programme: string | null;
    section: string | null;
    rollNo: number | null;
  };
  payment: {
    claimedAmount: number;
    verifiedAmount: number | null;
    currency: string;
    method: string;
    methodLabel: string;
    bankReference: string | null;
    paidOn: string;
    submittedAt: string;
    studentNote: string | null;
    outstandingAtSubmission: number | null;
  };
  proof: Array<{
    id: string;
    filename: string;
    contentType: string;
    sizeBytes: number;
    scanStatus: string;
    uploadedAt: string;
  }>;
  calculation: {
    currency: string;
    totalRequired: number;
    previouslyVerified: number;
    thisSubmission: number;
    totalAfter: number;
    remainingAfter: number;
    otherPending: number;
    wouldOverpay: boolean;
  };
  review: { reviewedBy: string | null; reviewedAt: string | null; note: string | null };
  receipt: {
    paymentId: string;
    receiptNo: string;
    isReversed: boolean;
    issuedAt: string | null;
  } | null;
}

interface Verified {
  receiptNo: string;
  verifiedAmount: number;
  currency: string;
  paymentId: string;
  student: { id: string; name: string };
  done: string[];
  message: string;
}

const STATUSES = [
  { value: "PENDING", label: "Pending" },
  { value: "VERIFIED", label: "Verified" },
  { value: "REJECTED", label: "Rejected" },
  { value: "CANCELLED", label: "Withdrawn" },
  { value: "ALL", label: "All" },
];

const METHODS = [
  { value: "", label: "Any method" },
  { value: "BANK_TRANSFER", label: "Bank transfer" },
  { value: "EASYPAISA", label: "EasyPaisa" },
  { value: "JAZZCASH", label: "JazzCash" },
  { value: "CASH_DEPOSIT", label: "Cash deposit" },
  { value: "CHEQUE", label: "Cheque" },
  { value: "OTHER", label: "Other" },
];

export function PaymentVerificationPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [rows, setRows] = useState<QueueRow[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);

  const [status, setStatus] = useState("PENDING");
  const [q, setQ] = useState("");
  const [method, setMethod] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const load = useCallback(() => {
    const params = new URLSearchParams({ status });
    if (q.trim()) params.set("q", q.trim());
    if (method) params.set("method", method);
    if (from) params.set("from", from);
    if (to) params.set("to", to);

    setError(null);
    Promise.all([
      api.list<QueueRow>(`/fees/submissions?${params.toString()}`),
      api.get<Stats>("/fees/submissions/stats"),
    ])
      .then(([queue, s]) => {
        setRows(queue.data);
        setStats(s);
        setLocked(false);
      })
      .catch((e) => {
        if (needsStepUp(e)) setLocked(true);
        else setError(e instanceof ApiError ? e.message : "The payment queue could not be loaded.");
      });
  }, [status, q, method, from, to]);

  useEffect(load, [load]);

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Payment verification</h1>
          <p className="muted small">
            Payments students say they have made. Nothing here counts as money until it is
            verified against the bank record.
          </p>
        </div>
        <Link className="btn btn-quiet" to="/fees">
          Fee statements
        </Link>
      </header>

      {error && (
        <div className="alert alert-error" role="alert">
          <p>{error}</p>
        </div>
      )}

      {locked && (
        <StepUpPrompt
          what="review payment submissions"
          onCancel={() => setError("Payment records need you to confirm your password.")}
          onDone={load}
        />
      )}

      {!locked && stats && <StatBand stats={stats} />}

      {!locked && (
        <section className="card">
          <div className="payfilters">
            <label className="field">
              <span>Search</span>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                // Every identifier somebody might be holding, because a student
                // telephones quoting whatever is in front of them.
                placeholder="Name, registration no., transaction no., reference or receipt"
              />
            </label>
            <label className="field">
              <span>Status</span>
              <select value={status} onChange={(e) => setStatus(e.target.value)}>
                {STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Method</span>
              <select value={method} onChange={(e) => setMethod(e.target.value)}>
                {METHODS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Submitted from</span>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label className="field">
              <span>to</span>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </label>
          </div>

          <Queue rows={rows} status={status} onOpen={setOpenId} />
        </section>
      )}

      {openId && (
        <ReviewPanel
          id={openId}
          onClose={() => setOpenId(null)}
          onDecided={() => {
            setOpenId(null);
            load();
          }}
        />
      )}
    </>
  );
}

/**
 * The figures on the desk.
 *
 * DELIBERATELY FEW. What somebody opening this page needs in order to decide
 * what to do next is how many are waiting, how long the oldest has waited, and
 * what has been taken. Anything more is a chart nobody acts on.
 */
function StatBand({ stats }: { stats: Stats }) {
  return (
    <div className="kpis">
      <div className={stats.pendingCount > 0 ? "card kpi is-warn" : "card kpi"}>
        <span className="kpi-label">Waiting to be checked</span>
        <strong className="kpi-value">{stats.pendingCount}</strong>
        <span className="kpi-note">
          {money(stats.pendingAmount)} claimed
          {/* HOW LONG THE OLDEST HAS WAITED is the number that says whether
              this desk is keeping up. A count alone never does. */}
          {stats.oldestPendingDays !== null &&
            ` · oldest ${stats.oldestPendingDays === 0 ? "today" : `${stats.oldestPendingDays} day${stats.oldestPendingDays === 1 ? "" : "s"} old`}`}
        </span>
      </div>
      <div className="card kpi">
        <span className="kpi-label">Verified today</span>
        <strong className="kpi-value">{money(stats.verifiedTodayAmount)}</strong>
        <span className="kpi-note">
          {stats.verifiedTodayCount} payment{stats.verifiedTodayCount === 1 ? "" : "s"}
        </span>
      </div>
      <div className="card kpi">
        <span className="kpi-label">Verified this month</span>
        <strong className="kpi-value">{money(stats.verifiedThisMonthAmount)}</strong>
        <span className="kpi-note">
          {stats.verifiedThisMonthCount} payment{stats.verifiedThisMonthCount === 1 ? "" : "s"} ·{" "}
          {stats.rejectedThisMonth} rejected
        </span>
      </div>
      <div className="card kpi">
        <span className="kpi-label">Collected in total</span>
        <strong className="kpi-value">{money(stats.totalCollected)}</strong>
        <span className="kpi-note">Verified, less anything reversed</span>
      </div>
      <div className={stats.totalOutstanding > 0 ? "card kpi is-warn" : "card kpi"}>
        <span className="kpi-label">Still owed</span>
        <strong className="kpi-value">{money(stats.totalOutstanding)}</strong>
        <span className="kpi-note">
          across {stats.studentsOwing} student{stats.studentsOwing === 1 ? "" : "s"}
        </span>
      </div>
    </div>
  );
}

function Queue({
  rows,
  status,
  onOpen,
}: {
  rows: QueueRow[] | null;
  status: string;
  onOpen: (id: string) => void;
}) {
  if (!rows) return <SkeletonTable rows={6} columns={6} />;

  if (rows.length === 0) {
    return status === "PENDING" ? (
      // Said in words. An empty table is ambiguous between "nothing to do" and
      // "the filter is wrong", and only one of those is worth celebrating.
      <EmptyState icon="tick" title="Nothing waiting">
        Every payment students have submitted has been reviewed. New ones appear here as soon as
        they are sent.
      </EmptyState>
    ) : (
      <EmptyState icon="search" title="Nothing matches">
        No payment submissions match these filters. Try widening the dates or clearing the search.
      </EmptyState>
    );
  }

  return (
    <div className="table-scroll">
      <table className="table">
        <thead>
          <tr>
            <th>Student</th>
            <th className="num">Amount</th>
            <th>Method</th>
            <th>Paid on</th>
            <th>Submitted</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>
                <button className="link-button" onClick={() => onOpen(r.id)}>
                  {r.studentName}
                </button>
                <br />
                <span className="muted small">
                  {r.registrationNo}
                  {r.section ? ` · ${r.section}` : ""}
                </span>
              </td>
              <td className="num">
                <strong>{money(r.amount, r.currency)}</strong>
                {r.verifiedAmount !== null && Math.abs(r.verifiedAmount - r.amount) > 0.005 && (
                  <>
                    <br />
                    <span className="muted small">
                      verified {money(r.verifiedAmount, r.currency)}
                    </span>
                  </>
                )}
              </td>
              <td className="small">
                {r.methodLabel}
                {r.bankReference && (
                  <>
                    <br />
                    <span className="muted small">{r.bankReference}</span>
                  </>
                )}
              </td>
              <td className="small">{shortDate(r.paidOn)}</td>
              <td className="small">{shortDate(r.submittedAt)}</td>
              <td>
                <span className={statusPill(r.status)}>{OFFICE_STATUS[r.status]}</span>
                {r.receiptNo && (
                  <>
                    <br />
                    <span className="muted small">{r.receiptNo}</span>
                  </>
                )}
              </td>
              <td className="num">
                <button className="btn btn-sm" onClick={() => onOpen(r.id)}>
                  {r.status === "PENDING" ? "Review" : "Open"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * One submission, and the decision.
 *
 * A MODAL RATHER THAN A ROUTE, deliberately, and it is the one place on this
 * screen where that is the right answer: the reviewer is working a queue, and
 * closing the panel must put them back exactly where they were, on the same
 * page of the same filter, with the row they just decided gone from it.
 */
function ReviewPanel({
  id,
  onClose,
  onDecided,
}: {
  id: string;
  onClose: () => void;
  onDecided: () => void;
}) {
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [locked, setLocked] = useState<(() => void) | null>(null);
  const [verified, setVerified] = useState<Verified | null>(null);

  // The two decisions, each behind a confirmation. Money is where an
  // accidental click is expensive in both directions.
  const [confirming, setConfirming] = useState<"verify" | "reject" | null>(null);
  const [verifiedAmount, setVerifiedAmount] = useState("");
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");

  useEffect(() => {
    setD(null);
    api
      .get<Detail>(`/fees/submissions/${id}`)
      .then(setD)
      .catch((e) =>
        setError(
          e instanceof ApiError ? e.message : "That submission could not be opened.",
        ),
      );
  }, [id]);

  const run = async (act: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await act();
    } catch (e) {
      if (needsStepUp(e)) setLocked(() => () => void run(act));
      else
        setError(
          e instanceof ApiError
            ? (e.details?.map((dd) => dd.message).join(" ") ?? e.message)
            : "That did not work.",
        );
    } finally {
      setBusy(false);
    }
  };

  const doVerify = () =>
    run(async () => {
      const typed = verifiedAmount.trim() === "" ? undefined : Number(verifiedAmount.replace(/,/g, ""));
      const result = await api.post<Verified>(`/fees/submissions/${id}/verify`, {
        ...(typed !== undefined ? { verifiedAmount: typed } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      setConfirming(null);
      setVerified(result);
    });

  const doReject = () =>
    run(async () => {
      await api.post(`/fees/submissions/${id}/reject`, { reason: reason.trim() });
      setConfirming(null);
      onDecided();
    });

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Payment submission">
      <div className="modal payreview">
        <div className="modal-head">
          <h2>{d ? d.snapshot.studentName : "Payment submission"}</h2>
          <button className="btn btn-quiet" onClick={verified ? onDecided : onClose}>
            Close
          </button>
        </div>

        {error && (
          <div className="alert alert-error" role="alert">
            <p>{error}</p>
          </div>
        )}

        {locked && (
          <StepUpPrompt
            what="verify payments"
            onCancel={() => setLocked(null)}
            onDone={() => {
              const retry = locked;
              setLocked(null);
              retry();
            }}
          />
        )}

        {/* What actually happened, in the order it happened, because the
            administrator is about to tell the student and needs to know which
            parts they can promise. */}
        {verified ? (
          <VerifiedResult result={verified} onDone={onDecided} />
        ) : !d ? (
          <p className="muted">Loading…</p>
        ) : (
          <>
            <section className="payreview-section">
              <h3 className="section-label">Student</h3>
              <dl className="paydetails">
                <div>
                  <dt>Name</dt>
                  <dd>{d.student.fullName}</dd>
                </div>
                <div>
                  <dt>Registration number</dt>
                  <dd>{d.student.registrationNo}</dd>
                </div>
                {d.student.programme && (
                  <div>
                    <dt>Programme</dt>
                    <dd>{d.student.programme}</dd>
                  </div>
                )}
                {d.student.section && (
                  <div>
                    <dt>Batch</dt>
                    <dd>
                      {d.student.section}
                      {d.student.rollNo === null ? "" : ` · roll no. ${d.student.rollNo}`}
                    </dd>
                  </div>
                )}
                <div>
                  <dt>Contact</dt>
                  <dd>
                    {d.student.email}
                    {d.student.phone ? ` · ${d.student.phone}` : ""}
                  </dd>
                </div>
              </dl>
              {/* BR-DAT-02 — what the receipt will say, when it differs from
                  what the record says today. */}
              {d.snapshot.studentName !== d.student.fullName && (
                <p className="muted small">
                  Submitted as “{d.snapshot.studentName}” ({d.snapshot.registrationNo}). The
                  receipt carries the name as it was at the time of payment.
                </p>
              )}
            </section>

            <section className="payreview-section">
              <h3 className="section-label">What the student claims</h3>
              <dl className="paydetails">
                <div>
                  <dt>Amount</dt>
                  <dd>
                    <strong>{money(d.payment.claimedAmount, d.payment.currency)}</strong>
                  </dd>
                </div>
                <div>
                  <dt>Method</dt>
                  <dd>{d.payment.methodLabel}</dd>
                </div>
                <div>
                  <dt>Transaction number</dt>
                  <dd>{d.payment.bankReference ?? "— none given —"}</dd>
                </div>
                <div>
                  <dt>Date paid</dt>
                  <dd>{shortDate(d.payment.paidOn)}</dd>
                </div>
                <div>
                  <dt>Submitted</dt>
                  <dd>
                    {shortDate(d.payment.submittedAt)} · {d.reference}
                  </dd>
                </div>
              </dl>
              {d.payment.studentNote && (
                <p className="small">
                  <strong>Student's note:</strong> {d.payment.studentNote}
                </p>
              )}
            </section>

            <section className="payreview-section">
              <h3 className="section-label">Proof of payment</h3>
              {d.proof.length === 0 ? (
                <div className="alert alert-warn">
                  <strong>No proof is attached</strong>
                  <p className="small">
                    Do not verify this on the strength of the claimed amount alone — check the
                    bank record yourself, or ask the student to send the receipt.
                  </p>
                </div>
              ) : (
                d.proof.map((p) => (
                  <ProofFile
                    key={p.id}
                    path={`/fees/submissions/${d.id}/proof/${p.id}`}
                    doc={{
                      originalFilename: p.filename,
                      contentType: p.contentType,
                      sizeBytes: p.sizeBytes,
                      scanStatus: p.scanStatus,
                    }}
                  />
                ))
              )}
            </section>

            {/*
              THE ARITHMETIC OF VERIFYING THIS ONE. Done on the server by the
              same code that writes the student's own summary, so the reviewer
              and the student cannot be shown different figures.
            */}
            <section className="payreview-section">
              <h3 className="section-label">
                {d.status === "VERIFIED" ? "What this payment did" : "What verifying will do"}
              </h3>
              <dl className="paycalc">
                <div>
                  <dt>Total required</dt>
                  <dd>{money(d.calculation.totalRequired, d.calculation.currency)}</dd>
                </div>
                <div>
                  <dt>Previously verified</dt>
                  <dd>{money(d.calculation.previouslyVerified, d.calculation.currency)}</dd>
                </div>
                <div>
                  <dt>This submission</dt>
                  <dd>+ {money(d.calculation.thisSubmission, d.calculation.currency)}</dd>
                </div>
                <div className="paycalc-total">
                  <dt>Verified {d.status === "VERIFIED" ? "in total" : "after this"}</dt>
                  <dd>{money(d.calculation.totalAfter, d.calculation.currency)}</dd>
                </div>
                <div>
                  <dt>Remaining</dt>
                  <dd>{money(d.calculation.remainingAfter, d.calculation.currency)}</dd>
                </div>
                {d.calculation.otherPending > 0.005 && (
                  <div className="paycalc-aside">
                    <dt>Other claims still waiting</dt>
                    <dd>{money(d.calculation.otherPending, d.calculation.currency)}</dd>
                  </div>
                )}
              </dl>
              {d.calculation.wouldOverpay && (
                <div className="alert alert-warn">
                  <p className="small">
                    This would take the student past their total fee. That may be right — a
                    prepayment or a round figure — but check the slip before verifying.
                  </p>
                </div>
              )}
            </section>

            {d.status !== "PENDING" && (
              <section className="payreview-section">
                <h3 className="section-label">Decision</h3>
                <dl className="paydetails">
                  <div>
                    <dt>Outcome</dt>
                    <dd>
                      <span className={statusPill(d.status)}>{OFFICE_STATUS[d.status]}</span>
                    </dd>
                  </div>
                  {d.review.reviewedBy && (
                    <div>
                      <dt>Decided by</dt>
                      <dd>
                        {d.review.reviewedBy}
                        {d.review.reviewedAt ? ` · ${shortDate(d.review.reviewedAt)}` : ""}
                      </dd>
                    </div>
                  )}
                  {d.review.note && (
                    <div>
                      <dt>{d.status === "REJECTED" ? "Reason given" : "Note"}</dt>
                      <dd>{d.review.note}</dd>
                    </div>
                  )}
                </dl>
                {d.receipt && (
                  <div className="row-actions">
                    <Link className="btn btn-sm" to={`/receipts/${d.receipt.paymentId}`}>
                      <Icon name="clipboard" /> Receipt {d.receipt.receiptNo}
                    </Link>
                    <DownloadReceipt
                      paymentId={d.receipt.paymentId}
                      receiptNo={d.receipt.receiptNo}
                    />
                  </div>
                )}
              </section>
            )}

            {d.status === "PENDING" && confirming === null && (
              <div className="form-actions payreview-actions">
                <button className="btn btn-primary" onClick={() => setConfirming("verify")}>
                  <Icon name="tick" /> Verify payment
                </button>
                <button className="btn btn-danger" onClick={() => setConfirming("reject")}>
                  Reject payment
                </button>
              </div>
            )}

            {confirming === "verify" && (
              <section className="payreview-confirm">
                <h3>Verify this payment?</h3>
                <p className="small">
                  This records {money(d.payment.claimedAmount, d.payment.currency)} against{" "}
                  {d.student.fullName}'s account, issues a receipt and emails it to them. It is
                  the point at which this becomes money the Institute has.
                </p>

                <label className="field">
                  <span>Amount actually received</span>
                  <input
                    inputMode="decimal"
                    value={verifiedAmount}
                    onChange={(e) => setVerifiedAmount(e.target.value)}
                    placeholder={String(d.payment.claimedAmount)}
                  />
                  <span className="muted small">
                    Leave blank to accept the {money(d.payment.claimedAmount, d.payment.currency)}{" "}
                    claimed. Change it only if the slip shows a different figure — and say why
                    below, which the student will see.
                  </span>
                </label>

                <label className="field">
                  <span>Note (required if the amount differs)</span>
                  <textarea
                    rows={2}
                    maxLength={1000}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="e.g. Slip shows Rs 24,900 after the transfer charge."
                  />
                </label>

                <div className="form-actions">
                  <button className="btn btn-primary" onClick={() => void doVerify()} disabled={busy}>
                    {busy ? "Verifying…" : "Yes, verify and issue the receipt"}
                  </button>
                  <button className="btn btn-quiet" onClick={() => setConfirming(null)} disabled={busy}>
                    Go back
                  </button>
                </div>
              </section>
            )}

            {confirming === "reject" && (
              <section className="payreview-confirm">
                <h3>Reject this payment?</h3>
                <p className="small">
                  The student will be emailed the reason you give, word for word, and can submit
                  again. Nothing is deleted — the submission stays on the record as rejected.
                </p>

                <label className="field">
                  <span>Why can this payment not be verified?</span>
                  <textarea
                    rows={3}
                    maxLength={1000}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="e.g. The screenshot does not show the transaction number. Please send the full receipt from your banking app."
                  />
                  <span className="muted small">
                    Write it as an instruction the student can act on. Most of these are fixable
                    in five minutes by somebody who is simply told what was wrong.
                  </span>
                </label>

                <div className="form-actions">
                  <button
                    className="btn btn-danger"
                    onClick={() => void doReject()}
                    disabled={busy || reason.trim().length < 10}
                  >
                    {busy ? "Rejecting…" : "Reject and email the reason"}
                  </button>
                  <button className="btn btn-quiet" onClick={() => setConfirming(null)} disabled={busy}>
                    Go back
                  </button>
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** Confirmation that names each thing the System did, and admits what failed. */
function VerifiedResult({ result, onDone }: { result: Verified; onDone: () => void }) {
  return (
    <section className="payconfirm">
      <div className="payconfirm-mark" aria-hidden="true">
        <Icon name="tick" />
      </div>
      <h3>Payment verified</h3>
      <p>
        <strong>{money(result.verifiedAmount, result.currency)}</strong> from {result.student.name},
        receipt <strong>{result.receiptNo}</strong>.
      </p>
      <ul className="checklist">
        {result.done.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <div className="form-actions">
        <Link className="btn" to={`/receipts/${result.paymentId}`}>
          <Icon name="clipboard" /> Open the receipt
        </Link>
        <button className="btn btn-primary" onClick={onDone}>
          Back to the queue
        </button>
      </div>
    </section>
  );
}
