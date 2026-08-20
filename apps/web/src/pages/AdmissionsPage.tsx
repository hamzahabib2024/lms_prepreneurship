import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { SkeletonList } from "../components/Ui";
import { ApiError, api } from "../api/client";
import { SlipViewer } from "../components/SlipViewer";

/**
 * Admission queue and review — SRS UC-02, §13.5.
 *
 * The Institute's highest-value workflow: OBJ-01 targets a fall from about
 * 22 minutes of staff time per admission to under 5, and NFR-USE-003 makes
 * "review and decide without training, in under 3 minutes" an acceptance
 * criterion.
 *
 * The design follows from that. One screen shows the queue and the selected
 * application together, so a reviewer never loses their place; the claim is
 * taken on open so two administrators cannot collide (FR-REG-026); and after
 * a decision the next application is selected automatically, because
 * admissions are processed in batches at intake (FR-REG-037).
 */

interface QueueRow {
  id: string;
  trackingRef: string;
  status: string;
  fullName: string;
  gender: string;
  phone: string;
  email: string;
  claimedAmount: string;
  acquisitionSource: string;
  createdAt: string;
  isOverdue: boolean;
  isClaimed: boolean;
  desiredSection: { id: string; code: string; name: string } | null;
}

interface SectionRow {
  id: string;
  code: string;
  name: string;
  capacity: number;
  enrolledCount: number;
  placesRemaining: number;
  isFull: boolean;
  genderRestriction: string;
}

interface ApprovalResult {
  student: { registrationNo: string; rollNo: number; sectionName: string; returningStudent: boolean };
  // Null for a returning student — their account was not touched, so there is
  // no new password. Typing it `string` printed an empty warning box.
  account: { temporaryPassword: string | null; note?: string };
  enrolments: { count: number };
  whatsappLinks: { channel: string | null; group: string | null };
  /** What the System managed to send, in words — see the receipt below. */
  notificationsSent: string[];
}

export function AdmissionsPage() {
  /**
   * `?overdue=1` — arrived at from the dashboard.
   *
   * The dashboard says "3 waiting over 48 hours" and that figure is now a
   * link. Sending it to the unfiltered queue would make the reader find those
   * three again by eye among forty, which is exactly the work the figure
   * existed to save. The filter is in the ADDRESS rather than in component
   * state so the link carries it and the view can be shared or bookmarked.
   */
  const [params, setParams] = useSearchParams();
  const overdueOnly = params.get("overdue") === "1";

  const [queue, setQueue] = useState<QueueRow[] | null>(null);
  const [sections, setSections] = useState<SectionRow[]>([]);
  const [selected, setSelected] = useState<QueueRow | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [approved, setApproved] = useState<ApprovalResult | null>(null);

  const load = useCallback(async () => {
    try {
      const [q, s] = await Promise.all([
        api.list<QueueRow>("/registration-requests"),
        api.list<SectionRow>("/sections"),
      ]);
      setQueue(q.data);
      setSections(s.data);
    } catch (e) {
      setError(e instanceof ApiError ? e : null);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error && !queue) {
    return (
      <div className="alert alert-error" role="alert">
        <strong>Could not load the admission queue</strong>
        <p>{error.message}</p>
      </div>
    );
  }
  if (!queue) return <SkeletonList rows={6} />;

  const overdue = queue.filter((r) => r.isOverdue).length;
  const shown = overdueOnly ? queue.filter((r) => r.isOverdue) : queue;

  return (
    <>
      <header className="page-head">
        <h1>Admissions</h1>
        <span className="muted small">
          {queue.length} waiting
          {/* FR-REG-038 — an application nobody has looked at is surfaced,
              not left to be discovered. */}
          {overdue > 0 && <strong className="warn"> · {overdue} over 48 hours</strong>}
        </span>
      </header>

      {/* A filter arrived at from elsewhere SAYS SO and offers the way out.
          Landing on a filtered list with no sign that it is filtered is how
          somebody concludes the other thirty applications have vanished. */}
      {overdueOnly && (
        <div className="alert alert-warn" role="status">
          <strong>Showing only the {overdue} waiting over 48 hours.</strong>
          <div className="row-actions">
            <button
              className="btn btn-sm"
              onClick={() => {
                params.delete("overdue");
                setParams(params, { replace: true });
              }}
            >
              Show all {queue.length}
            </button>
          </div>
        </div>
      )}

      {approved && <ApprovalReceipt result={approved} onDismiss={() => setApproved(null)} />}

      {shown.length === 0 ? (
        <div className="card">
          <p className="muted">
            No applications are waiting for review. New applications appear here as soon as they are
            submitted.
          </p>
        </div>
      ) : (
        <div className="split">
          <div className="card queue">
            <h2>Queue</h2>
            <p className="muted small">Oldest first — nobody waits unnoticed.</p>
            <ul className="list queue-list">
              {shown.map((r) => (
                <li key={r.id}>
                  <button
                    className={`queue-item ${selected?.id === r.id ? "is-selected" : ""}`}
                    onClick={() => {
                      setSelected(r);
                      setError(null);
                    }}
                  >
                    <span className="queue-name">
                      {r.fullName}
                      {r.isOverdue && <span className="pill pill-warn">waiting</span>}
                    </span>
                    <span className="muted small">
                      {r.trackingRef} · {r.desiredSection?.code ?? "no section"} ·{" "}
                      {daysAgo(r.createdAt)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div className="review">
            {selected ? (
              <ReviewPanel
                key={selected.id}
                request={selected}
                sections={sections}
                onDone={async (result) => {
                  if (result) setApproved(result);
                  setSelected(null);
                  await load();
                }}
              />
            ) : (
              <div className="card">
                <p className="muted">Choose an application from the queue to review it.</p>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function ReviewPanel({
  request,
  sections,
  onDone,
}: {
  request: QueueRow;
  sections: SectionRow[];
  onDone: (result: ApprovalResult | null) => void | Promise<void>;
}) {
  const [sectionId, setSectionId] = useState(request.desiredSection?.id ?? "");
  const [verifiedAmount, setVerifiedAmount] = useState(String(request.claimedAmount ?? ""));
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState("BANK_TRANSFER");
  const [bankReference, setBankReference] = useState("");
  const [varianceReason, setVarianceReason] = useState("");
  const [capacityOverride, setCapacityOverride] = useState(false);
  const [rejectReason, setRejectReason] = useState("PAYMENT_NOT_RECEIVED");
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const section = sections.find((s) => s.id === sectionId);

  // Both rules are enforced server-side; showing them here means the reviewer
  // learns before clicking rather than from a refusal.
  const genderBlocked =
    !!section &&
    section.genderRestriction !== "MIXED" &&
    section.genderRestriction !== request.gender;
  const atCapacity = !!section?.isFull;

  // FR-REG-028 — a variance between claim and verification needs a reason.
  const claimed = Number(request.claimedAmount ?? 0);
  const verified = Number(verifiedAmount || 0);
  const hasVariance = Number.isFinite(verified) && verified !== claimed;
  const varianceMissing = hasVariance && varianceReason.trim().length === 0;

  const canApprove =
    !!sectionId &&
    verified > 0 &&
    !genderBlocked &&
    (!atCapacity || capacityOverride) &&
    !varianceMissing &&
    busy === null;

  async function approve() {
    setBusy("approve");
    setError(null);
    try {
      const result = await api.post<ApprovalResult>(
        `/registration-requests/${request.id}/approve`,
        {
          payment: {
            verifiedAmount: verified,
            currency: "PKR",
            paymentDate,
            method,
            ...(bankReference ? { bankReference } : {}),
            ...(varianceReason ? { varianceReason } : {}),
          },
          sectionId,
          capacityOverride,
        },
      );
      await onDone(result);
    } catch (e) {
      setError(e instanceof ApiError ? e : null);
    } finally {
      setBusy(null);
    }
  }

  async function reject() {
    setBusy("reject");
    setError(null);
    try {
      await api.post(`/registration-requests/${request.id}/reject`, { reasonCode: rejectReason });
      await onDone(null);
    } catch (e) {
      setError(e instanceof ApiError ? e : null);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="card">
      <h2>{request.fullName}</h2>
      <p className="muted small">
        {request.trackingRef} · applied {daysAgo(request.createdAt)} · via{" "}
        {request.acquisitionSource.replace(/_/g, " ").toLowerCase()}
      </p>

      {error && (
        <div className="alert alert-error" role="alert">
          <strong>Could not complete that</strong>
          <p>{error.message}</p>
          {error.details?.map((d) => (
            <p key={d.field} className="small">
              {d.field}: {d.message}
            </p>
          ))}
        </div>
      )}

      <dl className="facts">
        <div><dt>Gender</dt><dd>{request.gender.toLowerCase()}</dd></div>
        <div><dt>Phone</dt><dd>{request.phone}</dd></div>
        <div><dt>Email</dt><dd>{request.email}</dd></div>
        <div><dt>Claimed</dt><dd>PKR {claimed.toLocaleString()}</dd></div>
      </dl>

      {/* The evidence the decision rests on. This said "preview not available,
          pending the Google Drive credentials" long after that stopped being
          true — slips are stored and streamed now, and telling a reviewer to
          go and check the bank instead is telling them to ignore the System. */}
      <SlipViewer requestId={request.id} />

      <h3 className="section-label">Verify payment</h3>
      <div className="field-row">
        <label className="field">
          <span>Amount received</span>
          <input
            type="number"
            value={verifiedAmount}
            onChange={(e) => setVerifiedAmount(e.target.value)}
            min="1"
          />
        </label>
        <label className="field">
          <span>Date received</span>
          <input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
        </label>
      </div>
      <div className="field-row">
        <label className="field">
          <span>Method</span>
          <select value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="BANK_TRANSFER">Bank transfer</option>
            <option value="CASH_DEPOSIT">Cash deposit</option>
            <option value="CHEQUE">Cheque</option>
            <option value="OTHER">Other</option>
          </select>
        </label>
        <label className="field">
          <span>Bank reference</span>
          <input value={bankReference} onChange={(e) => setBankReference(e.target.value)} />
        </label>
      </div>

      {hasVariance && (
        <label className="field">
          <span>
            Why does this differ from the PKR {claimed.toLocaleString()} claimed?{" "}
            <strong className="warn">required</strong>
          </span>
          <input
            value={varianceReason}
            onChange={(e) => setVarianceReason(e.target.value)}
            placeholder="e.g. first instalment only"
          />
        </label>
      )}

      <h3 className="section-label">Section</h3>
      <label className="field">
        <span>Assign to</span>
        <select value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
          <option value="">Choose a section…</option>
          {sections.map((s) => (
            <option key={s.id} value={s.id}>
              {s.code} — {s.enrolledCount}/{s.capacity}
              {s.isFull ? " (full)" : ""}
            </option>
          ))}
        </select>
      </label>

      {/* FR-CRS-009 / BR-ENR-05 — absolute. No override exists, so none is
          offered; the approve button simply cannot be used. */}
      {genderBlocked && (
        <div className="alert alert-error" role="alert">
          <strong>This section admits {section?.genderRestriction.toLowerCase()} students only</strong>
          <p className="small">Choose a different section. This restriction cannot be overridden.</p>
        </div>
      )}

      {/* FR-REG-031 — capacity CAN be exceeded, but only deliberately, and the
          override is recorded in the audit entry. */}
      {atCapacity && !genderBlocked && (
        <div className="alert alert-warn">
          <strong>
            {section?.code} is full ({section?.enrolledCount} of {section?.capacity})
          </strong>
          <label className="check">
            <input
              type="checkbox"
              checked={capacityOverride}
              onChange={(e) => setCapacityOverride(e.target.checked)}
            />
            <span>Admit anyway, exceeding capacity. This is recorded against your name.</span>
          </label>
        </div>
      )}

      <div className="row-actions">
        <button className="btn btn-primary" onClick={() => void approve()} disabled={!canApprove}>
          {busy === "approve" ? "Approving…" : "Approve and create account"}
        </button>
        <select value={rejectReason} onChange={(e) => setRejectReason(e.target.value)}>
          <option value="PAYMENT_NOT_RECEIVED">Payment not received</option>
          <option value="AMOUNT_INSUFFICIENT">Amount insufficient</option>
          <option value="SLIP_ILLEGIBLE">Slip illegible</option>
          <option value="DUPLICATE_APPLICATION">Duplicate application</option>
          <option value="INELIGIBLE">Ineligible</option>
          <option value="SECTION_FULL">Section full</option>
          <option value="OTHER">Other</option>
        </select>
        <button className="btn" onClick={() => void reject()} disabled={busy !== null}>
          {busy === "reject" ? "Rejecting…" : "Reject"}
        </button>
      </div>
    </div>
  );
}

/**
 * FR-REG-042 — the credentials are shown ONCE, on screen, in a form the
 * administrator can read out or paste into WhatsApp. Email delivery may be
 * delayed or may fail, and the student is usually still on the phone.
 */
function ApprovalReceipt({
  result,
  onDismiss,
}: {
  result: ApprovalResult;
  onDismiss: () => void;
}) {
  return (
    <div className="card receipt">
      <h2>Admitted — {result.student.registrationNo}</h2>
      <dl className="facts">
        <div><dt>Registration no.</dt><dd><code>{result.student.registrationNo}</code></dd></div>
        <div><dt>Roll no.</dt><dd>{result.student.rollNo}</dd></div>
        <div><dt>Section</dt><dd>{result.student.sectionName}</dd></div>
        <div><dt>Subjects</dt><dd>{result.enrolments.count} enrolled</dd></div>
      </dl>

      {/* A returning student has no new password — their existing sign-in is
          unchanged. Printing an empty box here read as "the password failed to
          generate", which is a support call about nothing. */}
      {result.account.temporaryPassword ? (
        <div className="alert alert-warn">
          <strong>Temporary password — shown once</strong>
          <p className="password">{result.account.temporaryPassword}</p>
          <p className="small">
            They will be asked to set their own password when they first sign in.
          </p>
        </div>
      ) : (
        <p className="small muted">{result.account.note}</p>
      )}

      {/* Whether the email actually left. This is why the password is still
          printed above: the office needs to know when to read it out instead. */}
      {result.notificationsSent.map((line) => (
        <p key={line} className={line.startsWith("Could NOT") ? "alert alert-warn" : "small muted"}>
          {line}
          {line.startsWith("Could NOT") && (
            <>
              {" "}
              <strong>Send the password above to the student yourself.</strong>
            </>
          )}
        </p>
      ))}

      {(result.whatsappLinks.channel || result.whatsappLinks.group) && (
        <p className="small muted">
          {/* FR-REG-044 — the community links, so onboarding finishes here
              rather than in a second conversation. */}
          WhatsApp:{" "}
          {result.whatsappLinks.group && <a href={result.whatsappLinks.group}>class group</a>}
          {result.whatsappLinks.group && result.whatsappLinks.channel && " · "}
          {result.whatsappLinks.channel && <a href={result.whatsappLinks.channel}>channel</a>}
        </p>
      )}

      <button className="btn" onClick={onDismiss}>
        Done — next application
      </button>
    </div>
  );
}

function daysAgo(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}
