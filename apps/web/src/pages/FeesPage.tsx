import { useCallback, useEffect, useState } from "react";
import { EmptyState, SkeletonTable } from "../components/Ui";
import { ApiError, api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { StepUpPrompt, needsStepUp } from "../components/StepUpPrompt";
import { PlanBuilder, RecordPayment, ReverseButton } from "./FeesPanels";

/**
 * Fees — SRS §13.11, FR-PAY-020..032.
 *
 * ONE ROUTE, TWO AUDIENCES. A student opening /fees sees their own statement;
 * staff see who owes what and can open any of them. The server decides what
 * each may read, so the page asks for what it is entitled to rather than
 * branching on a role it could be wrong about.
 *
 * A STATEMENT IS A LEDGER, NOT A TOTAL. Every event has a line — including a
 * waiver and including a reversed payment — because a student holding a receipt
 * for a payment that was later reversed must find both. Showing only the net
 * figure makes the Institute look as though it lost the money.
 *
 * MONEY IS RIGHT-ALIGNED AND NEVER ABBREVIATED. "45k" on a fee statement is an
 * invitation to a dispute; the exact figure is the whole point of the document.
 */

interface Balance {
  charged: number;
  waived: number;
  paid: number;
  reversed: number;
  outstanding: number;
}

interface Line {
  date: string;
  kind: "CHARGE" | "WAIVER" | "PAYMENT" | "REVERSAL";
  description: string;
  debit: number | null;
  credit: number | null;
  balance: number;
}

export interface Statement {
  student: { id: string; name: string; registrationNo: string };
  balance: Balance;
  aging: {
    current: number;
    overdue30: number;
    overdue60: number;
    overdue90Plus: number;
    oldestOverdueDays: number | null;
  };
  lines: Line[];
  charges: Array<{
    id: string;
    description: string;
    amount: number;
    dueDate: string;
    waived: boolean;
  }>;
  payments: Array<{
    id: string;
    amount: number;
    paidOn: string;
    method: string;
    reference: string | null;
    isReversed: boolean;
    reversedAt: string | null;
    reversalReason: string | null;
  }>;
  note: string;
}

interface Debtor {
  studentId: string;
  name: string;
  registrationNo: string;
  outstanding: number;
  oldestOverdueDays: number | null;
  overdue90Plus: number;
}

const METHOD: Record<string, string> = {
  BANK_TRANSFER: "Bank transfer",
  CASH_DEPOSIT: "Cash deposit",
  CHEQUE: "Cheque",
  OTHER: "Other",
};

/** Exact, grouped, never abbreviated. */
const money = (n: number) =>
  new Intl.NumberFormat("en-PK", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n);

export function FeesPage() {
  const { hasRole } = useAuth();
  const isStaff = hasRole("super_admin", "admin");
  const [debtors, setDebtors] = useState<Debtor[] | null>(null);
  const [open, setOpen] = useState<Statement | null>(null);
  const [error, setError] = useState<string | null>(null);
  // §4.5 marks the whole `payment` resource requiresStepUp — READING included,
  // not only writing. Money is the one area where the matrix asks somebody to
  // prove who they are before they even look. So the prompt has to be on the
  // way IN, not merely before a charge: without this the page's first request
  // fails and the screen shows an error for a policy working as intended.
  const [locked, setLocked] = useState(false);

  const loadDebtors = useCallback(() => {
    if (!isStaff) return;
    api
      .get<Debtor[]>("/fees/debtors")
      .then((d) => {
        setDebtors(d);
        setLocked(false);
      })
      .catch((e) => {
        if (needsStepUp(e)) setLocked(true);
        else setError(e instanceof ApiError ? e.message : "Could not load the list.");
      });
  }, [isStaff]);

  const openStatement = useCallback((studentId?: string) => {
    const path = studentId ? `/students/${studentId}/fees` : "/me/fees";
    api
      .get<Statement>(path)
      .then((st) => {
        setOpen(st);
        setLocked(false);
      })
      .catch((e) => {
        if (needsStepUp(e)) setLocked(true);
        else setError(e instanceof ApiError ? e.message : "Could not load the statement.");
      });
  }, []);

  const load = useCallback(() => {
    if (isStaff) loadDebtors();
    else openStatement();
  }, [isStaff, loadDebtors, openStatement]);

  useEffect(load, [load]);

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Fees</h1>
          <p className="muted small">
            {isStaff
              ? "What each student owes, and what they have paid."
              : "Your statement. Every charge and payment, in the order they happened."}
          </p>
        </div>
        {isStaff && open && (
          <button className="btn btn-quiet" onClick={() => setOpen(null)}>
            Back to the list
          </button>
        )}
      </header>

      {error && (
        <div className="alert alert-error" role="alert">
          <p>{error}</p>
        </div>
      )}

      {locked && (
        <StepUpPrompt
          what="see fee records"
          onCancel={() => setError("Fee records need you to confirm your password.")}
          onDone={() => {
            setLocked(false);
            load();
          }}
        />
      )}

      {isStaff && !locked && !open && (
        <DebtorList
          debtors={debtors}
          onOpen={(id) => openStatement(id)}
        />
      )}

      {open && (
        <StatementView
          statement={open}
          canEdit={isStaff}
          onChanged={(next) => {
            setOpen(next);
            loadDebtors();
          }}
        />
      )}
    </>
  );
}

function DebtorList({
  debtors,
  onOpen,
}: {
  debtors: Debtor[] | null;
  onOpen: (studentId: string) => void;
}) {
  if (!debtors) return <SkeletonTable rows={6} columns={5} />;

  if (debtors.length === 0) {
    // Said in words. An empty table here is ambiguous between "nobody owes
    // anything" and "the query is broken".
    return (
      <div className="card">
        <p>Nobody owes anything.</p>
      </div>
    );
  }

  return (
    <section className="card">
      <h2>
        {debtors.length} {debtors.length === 1 ? "student owes" : "students owe"} money
      </h2>
      <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th>Student</th>
              <th>Registration</th>
              <th className="num">Outstanding</th>
              <th>Oldest debt</th>
            </tr>
          </thead>
          <tbody>
            {debtors.map((d) => (
              <tr key={d.studentId}>
                <td>
                  <button className="link-button" onClick={() => onOpen(d.studentId)}>
                    {d.name}
                  </button>
                </td>
                <td className="small">{d.registrationNo}</td>
                <td className="num">{money(d.outstanding)}</td>
                <td className="small">
                  {d.oldestOverdueDays === null ? (
                    "Not yet due"
                  ) : (
                    // Over ninety days is the one worth marking, and it is
                    // marked with a WORD as well as a colour (NFR-ACC-003).
                    <span className={d.overdue90Plus > 0 ? "warn" : undefined}>
                      {d.oldestOverdueDays} days
                      {d.overdue90Plus > 0 ? " — over 90" : ""}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function StatementView({
  statement: s,
  canEdit,
  onChanged,
}: {
  statement: Statement;
  canEdit: boolean;
  onChanged: (next: Statement) => void;
}) {
  const [pending, setPending] = useState<{ what: string; run: () => Promise<Statement> } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const act = async (run: () => Promise<Statement>, what: string) => {
    setBusy(true);
    setError(null);
    try {
      onChanged(await run());
    } catch (e) {
      // `payment` demands recent re-authentication (§4.5): money is where an
      // unattended screen is a real risk. The refusal becomes a prompt.
      if (needsStepUp(e)) setPending({ what, run });
      else
        setError(
          e instanceof ApiError
            ? (e.details?.map((d) => d.message).join(" ") ?? e.message)
            : "That did not work.",
        );
    } finally {
      setBusy(false);
    }
  };

  const inCredit = s.balance.outstanding < 0;

  return (
    <>
      <section className="card">
        <div className="assignment-head">
          <span>
            <h2>{s.student.name}</h2>
            <span className="muted small">{s.student.registrationNo}</span>
          </span>
          <span className={inCredit ? "stat" : s.balance.outstanding > 0 ? "stat warn" : "stat"}>
            <strong>{money(Math.abs(s.balance.outstanding))}</strong>{" "}
            {inCredit ? "in credit" : "outstanding"}
          </span>
        </div>
        <p className="muted small">{s.note}</p>

        <div className="facts">
          <span className="stat">
            <strong>{money(s.balance.charged)}</strong> charged
          </span>
          <span className="stat">
            <strong>{money(s.balance.paid)}</strong> paid
          </span>
          {s.balance.waived > 0 && (
            <span className="stat">
              <strong>{money(s.balance.waived)}</strong> written off
            </span>
          )}
          {/* Shown only when it happened, but never hidden when it did. */}
          {s.balance.reversed > 0 && (
            <span className="stat warn">
              <strong>{money(s.balance.reversed)}</strong> reversed
            </span>
          )}
        </div>

        {s.aging.oldestOverdueDays !== null && (
          <p className="warn small">
            Oldest unpaid charge is {s.aging.oldestOverdueDays} days overdue.
            {s.aging.overdue90Plus > 0 && ` ${money(s.aging.overdue90Plus)} is over 90 days old.`}
          </p>
        )}
      </section>

      {error && (
        <div className="alert alert-error" role="alert">
          <p>{error}</p>
        </div>
      )}

      {pending && (
        <StepUpPrompt
          what={pending.what}
          onCancel={() => setPending(null)}
          onDone={() => {
            const retry = pending.run;
            setPending(null);
            void act(retry, pending.what);
          }}
        />
      )}

      {canEdit && <AddCharge studentId={s.student.id} onDone={act} busy={busy} />}

      <section className="card">
        <h2>Statement</h2>
        {s.lines.length === 0 ? (
          <EmptyState icon="money" title="No charges yet">
          Nothing has been billed to this student, so there is nothing owing. Charges
          appear here as soon as a fee is raised.
        </EmptyState>
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>What</th>
                  <th className="num">Charged</th>
                  <th className="num">Paid</th>
                  <th className="num">Balance</th>
                </tr>
              </thead>
              <tbody>
                {s.lines.map((l, i) => (
                  <tr key={`${l.date}-${i}`}>
                    <td className="small">{new Date(l.date).toLocaleDateString()}</td>
                    <td>
                      {/* The kind as a word. A reversal that reads like an
                          ordinary payment is how a statement misleads. */}
                      <span className={l.kind === "REVERSAL" ? "warn" : undefined}>
                        {l.description}
                      </span>
                    </td>
                    <td className="num">{l.debit === null ? "" : money(l.debit)}</td>
                    <td className="num">{l.credit === null ? "" : money(l.credit)}</td>
                    <td className="num">{money(l.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Shown to the STUDENT as well as to staff. A student holds
          `payment:read` at OWN scope, so they can print their own receipt
          without asking an administrator to do it — which is the difference
          between a record they hold and a favour they request. */}
      {s.payments.length > 0 && (
        <section className="card">
          <h2>Payments</h2>
          <ul className="list">
            {s.payments.map((p) => (
              <li key={p.id} className="assignment">
                <div className="assignment-head">
                  <span>
                    <strong>{money(p.amount)}</strong>
                    <br />
                    <span className="muted small">
                      {new Date(p.paidOn).toLocaleDateString()} · {METHOD[p.method] ?? p.method}
                      {p.reference ? ` · ref. ${p.reference}` : ""}
                    </span>
                    {/* Shown, never netted away: a student holding a receipt
                        for this must find it here rather than nowhere. */}
                    {p.isReversed && (
                      <>
                        <br />
                        <span className="warn small">
                          Reversed{p.reversedAt ? ` on ${new Date(p.reversedAt).toLocaleDateString()}` : ""}
                          {p.reversalReason ? ` — ${p.reversalReason}` : ""}
                        </span>
                      </>
                    )}
                  </span>
                  <span className="row-actions">
                    {/* A new tab, because printing a receipt should not lose
                        the statement the operator was working through. */}
                    <a
                      className="btn btn-quiet"
                      href={`/receipts/${p.id}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Receipt
                    </a>
                    {canEdit && !p.isReversed && (
                      <ReverseButton paymentId={p.id} busy={busy} onDone={act} />
                    )}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {canEdit && <RecordPayment studentId={s.student.id} busy={busy} onDone={act} />}
      {canEdit && <PlanBuilder studentId={s.student.id} busy={busy} onDone={act} />}

      {canEdit && (
        <section className="card">
          <h2>Charges</h2>
          <ul className="list">
            {s.charges.map((c) => (
              <li key={c.id} className="assignment">
                <div className="assignment-head">
                  <span>
                    {c.description}
                    <br />
                    <span className="muted small">
                      {money(c.amount)} · due {new Date(c.dueDate).toLocaleDateString()}
                    </span>
                  </span>
                  {c.waived ? (
                    <span className="muted small">Written off</span>
                  ) : (
                    <WaiveButton
                      chargeId={c.id}
                      description={c.description}
                      busy={busy}
                      onDone={act}
                    />
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function AddCharge({
  studentId,
  onDone,
  busy,
}: {
  studentId: string;
  onDone: (run: () => Promise<Statement>, what: string) => Promise<void>;
  busy: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ description: "", amount: "", dueDate: "" });

  if (!open) {
    return (
      <section className="card">
        <button className="btn btn-primary" onClick={() => setOpen(true)}>
          Add a charge
        </button>
      </section>
    );
  }

  return (
    <section className="card">
      <h2>Add a charge</h2>
      <div className="field-row">
        <label className="field">
          <span>What for</span>
          <input
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="Tuition — Spring 2026"
          />
        </label>
        <label className="field">
          <span>Amount</span>
          <input
            type="number"
            min="1"
            step="0.01"
            value={form.amount}
            onChange={(e) => setForm({ ...form, amount: e.target.value })}
          />
        </label>
        <label className="field">
          <span>Due</span>
          <input
            type="date"
            value={form.dueDate}
            onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
          />
        </label>
      </div>
      <span className="row-actions">
        <button
          className="btn btn-primary"
          disabled={busy || !form.description.trim() || !(Number(form.amount) > 0) || !form.dueDate}
          onClick={() =>
            void onDone(
              () =>
                api.post<Statement>("/fees/charges", {
                  studentId,
                  description: form.description.trim(),
                  amount: Number(form.amount),
                  dueDate: new Date(form.dueDate).toISOString(),
                }),
              "add a charge",
            ).then(() => {
              setForm({ description: "", amount: "", dueDate: "" });
              setOpen(false);
            })
          }
        >
          Add
        </button>
        <button className="btn btn-quiet" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </span>
      <p className="muted small">
        To reduce what somebody owes, write off an existing charge rather than adding a negative
        one — that keeps who decided, and why, on the record.
      </p>
    </section>
  );
}

function WaiveButton({
  chargeId,
  description,
  onDone,
  busy,
}: {
  chargeId: string;
  description: string;
  onDone: (run: () => Promise<Statement>, what: string) => Promise<void>;
  busy: boolean;
}) {
  const [reason, setReason] = useState<string | null>(null);

  if (reason === null) {
    return (
      <button className="btn btn-quiet" onClick={() => setReason("")}>
        Write off
      </button>
    );
  }

  return (
    <span className="row-actions">
      <input
        value={reason}
        autoFocus
        placeholder="Why — this stays on the statement"
        onChange={(e) => setReason(e.target.value)}
      />
      <button
        className="btn btn-quiet"
        disabled={busy || reason.trim().length < 10}
        onClick={() =>
          void onDone(
            () => api.post<Statement>(`/fees/charges/${chargeId}/waive`, { reason }),
            `write off ${description}`,
          )
        }
      >
        Confirm
      </button>
      <button className="btn btn-quiet" onClick={() => setReason(null)}>
        Cancel
      </button>
    </span>
  );
}
