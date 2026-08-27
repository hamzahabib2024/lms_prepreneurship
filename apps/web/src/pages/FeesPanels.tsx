import { useState } from "react";
import { ApiError, api } from "../api/client";
import type { Statement } from "./FeesPage";
import { Field } from "../components/Field";

/**
 * The three panels that write to a student's ledger — SRS §13.11.
 *
 * Kept out of FeesPage because that file is already the statement, the debtor
 * list and the charge form, and a screen nobody can read is a screen nobody
 * corrects.
 *
 * The Statement type comes back FROM that page, as `import type`. It is a
 * cycle on paper and none at runtime — type imports are erased — and the
 * alternative, a second copy of the interface, is how the two drift apart
 * until a field the server stopped sending is still being rendered.
 */
// `void | Promise<void>`, because the page's handler IS async — it awaits
// the write and then replaces the statement. Typing it as `void` and making
// every caller wrap the call in `void` would be the type lying about what it
// accepts, and hiding a rejection nobody handles.
type Act = (run: () => Promise<Statement>, what: string) => void | Promise<void>;

const money = (n: number) =>
  new Intl.NumberFormat("en-PK", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n);

/**
 * Recording a payment the Institute has received.
 *
 * Until this existed a Payment could only be created by approving an
 * admission, so a second instalment had nowhere to go and the ledger showed
 * every student owing their full fee forever.
 *
 * IT IS NOT ALLOCATED TO A CHARGE, deliberately. A student hands over 30,000
 * rupees; they are not paying "instalment 2", they are paying the Institute,
 * and the balance is charges minus payments. Asking the clerk to pick a charge
 * would make them guess, and a guess recorded as fact is worse than the
 * arithmetic it replaces.
 */
export function RecordPayment({
  studentId,
  busy,
  onDone,
}: {
  studentId: string;
  busy: boolean;
  onDone: Act;
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState("CASH_DEPOSIT");
  const [reference, setReference] = useState("");

  if (!open) {
    return (
      <section className="card">
        <button className="btn btn-primary" onClick={() => setOpen(true)}>
          Record a payment
        </button>
      </section>
    );
  }

  const value = Number(amount);
  const valid = Number.isFinite(value) && value > 0;

  return (
    <section className="card">
      <h2>Record a payment</h2>
      <p className="muted small">
        What the Institute has received. It reduces the balance; it is not tied to a particular
        charge.
      </p>

      <div className="field-row">
        <Field label="Amount" required><input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="30000"
          />
        </Field>
        <Field label="Date received" required><input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
        </Field>
      </div>

      <div className="field-row">
        <Field label="Method" required><select value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="CASH_DEPOSIT">Cash deposit</option>
            <option value="BANK_TRANSFER">Bank transfer</option>
            <option value="CHEQUE">Cheque</option>
            <option value="OTHER">Other</option>
          </select>
        </Field>
        <Field label="Reference (optional)"><input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="Slip or transaction number"
          />
        </Field>
      </div>

      <span className="row-actions">
        <button
          className="btn btn-primary"
          disabled={busy || !valid}
          onClick={() =>
            void onDone(
              () =>
                api.post<Statement>("/fees/payments", {
                  studentId,
                  amount: value,
                  paymentDate,
                  method,
                  ...(reference.trim() ? { bankReference: reference.trim() } : {}),
                }),
              "record a payment",
            )
          }
        >
          Record it
        </button>
        <button className="btn btn-quiet" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </span>
    </section>
  );
}

/**
 * Undoing a payment recorded in error.
 *
 * Marked, never deleted. A student may be holding its receipt, and the
 * statement shows reversed payments precisely so that receipt can be
 * reconciled against the record rather than contradicting it.
 */
export function ReverseButton({
  paymentId,
  busy,
  onDone,
}: {
  paymentId: string;
  busy: boolean;
  onDone: Act;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");

  if (!open) {
    return (
      <button className="btn btn-quiet" onClick={() => setOpen(true)}>
        Reverse…
      </button>
    );
  }

  return (
    <span className="danger-zone">
      <Field label="Why is this being reversed?" required><input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Recorded against the wrong student"
        />
      </Field>
      <p className="muted small">
        The payment stays on the statement, marked as reversed, and its receipt stays valid as a
        record — it will say so on its face.
      </p>
      <span className="row-actions">
        <button
          className="btn btn-primary"
          disabled={busy || reason.trim().length < 10}
          onClick={() =>
            void onDone(
              () => api.post<Statement>(`/fees/payments/${paymentId}/reverse`, { reason: reason.trim() }),
              "reverse a payment",
            )
          }
        >
          Reverse it
        </button>
        <button className="btn btn-quiet" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </span>
    </span>
  );
}

interface PreviewedPlan {
  instalments: Array<{ number: number; amount: number; dueDate: string; description: string }>;
  problem: { code: string; message: string } | null;
  message: string;
}

/**
 * An instalment plan.
 *
 * THE SCHEDULE IS SHOWN BEFORE IT IS WRITTEN, every row of it. The arithmetic
 * has two traps — an amount that does not divide, and a plan starting on the
 * 31st of a month — and both produce figures and dates that look perfectly
 * plausible. Showing the schedule means the operator checks the Institute's
 * answer rather than trusting it, and the server states in words when the
 * instalments are not all equal so that an odd paisa does not read as a bug.
 */
export function PlanBuilder({
  studentId,
  busy,
  onDone,
}: {
  studentId: string;
  busy: boolean;
  onDone: Act;
}) {
  const [open, setOpen] = useState(false);
  const [total, setTotal] = useState("");
  const [count, setCount] = useState("3");
  const [firstDueDate, setFirstDueDate] = useState("");
  const [cadence, setCadence] = useState("MONTHLY");
  const [label, setLabel] = useState("");
  const [preview, setPreview] = useState<PreviewedPlan | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <section className="card">
        <button className="btn btn-quiet" onClick={() => setOpen(true)}>
          Set up an instalment plan…
        </button>
      </section>
    );
  }

  const body = {
    totalRupees: Number(total),
    count: Number(count),
    firstDueDate,
    cadence,
    label: label.trim(),
  };
  const ready =
    Number.isFinite(body.totalRupees) &&
    body.totalRupees > 0 &&
    Number.isFinite(body.count) &&
    firstDueDate !== "" &&
    body.label.length >= 3;

  // Any change throws the schedule away. Leaving a stale one on screen would
  // let somebody read the plan for one amount and then write another.
  const invalidate = () => {
    setPreview(null);
    setError(null);
  };

  return (
    <section className="card">
      <h2>Instalment plan</h2>
      <p className="muted small">
        Splits a total into charges on the student's statement. The instalments always add up to
        the total exactly.
      </p>

      {error && <p className="warn">{error}</p>}

      <div className="field-row">
        <Field label="Total" required><input
            inputMode="decimal"
            value={total}
            onChange={(e) => {
              setTotal(e.target.value);
              invalidate();
            }}
            placeholder="90000"
          />
        </Field>
        <Field label="Instalments" required><input
            inputMode="numeric"
            value={count}
            onChange={(e) => {
              setCount(e.target.value);
              invalidate();
            }}
          />
        </Field>
      </div>

      <div className="field-row">
        <Field label="First one due" required><input
            type="date"
            value={firstDueDate}
            onChange={(e) => {
              setFirstDueDate(e.target.value);
              invalidate();
            }}
          />
        </Field>
        <Field label="Then every" required><select
            value={cadence}
            onChange={(e) => {
              setCadence(e.target.value);
              invalidate();
            }}
          >
            <option value="MONTHLY">Month</option>
            <option value="FORTNIGHTLY">Fortnight</option>
            <option value="WEEKLY">Week</option>
          </select>
        </Field>
      </div>

      <Field label="What it is for" required><input
          value={label}
          onChange={(e) => {
            setLabel(e.target.value);
            invalidate();
          }}
          placeholder="e.g. Spring 2026 tuition"
        />
      </Field>

      <span className="row-actions">
        <button
          className="btn btn-quiet"
          disabled={busy || !ready}
          onClick={() => {
            setError(null);
            api
              .post<PreviewedPlan>("/fees/plans/preview", body)
              .then(setPreview)
              .catch((e) =>
                setError(
                  e instanceof ApiError
                    ? (e.details?.map((d) => d.message).join(" ") ?? e.message)
                    : "Could not work out the schedule.",
                ),
              );
          }}
        >
          Work out the schedule
        </button>
        <button className="btn btn-quiet" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </span>

      {preview && (
        <>
          <p className={preview.problem ? "warn" : ""}>{preview.message}</p>

          {preview.instalments.length > 0 && (
            <>
              <ul className="list small">
                {preview.instalments.map((i) => (
                  <li key={i.number}>
                    <strong>{money(i.amount)}</strong> — due{" "}
                    {new Date(i.dueDate).toLocaleDateString()}
                    <span className="muted"> · {i.description}</span>
                  </li>
                ))}
              </ul>

              <button
                className="btn btn-primary"
                disabled={busy}
                onClick={() =>
                  void onDone(async () => {
                    await api.post("/fees/plans", { ...body, studentId });
                    setOpen(false);
                    setPreview(null);
                    // The plan endpoint returns its own summary; the page wants
                    // the statement, so it is re-read rather than reconstructed.
                    return api.get<Statement>(`/students/${studentId}/fees`);
                  }, "create an instalment plan")
                }
              >
                Create these {preview.instalments.length} charges
              </button>
            </>
          )}
        </>
      )}
    </section>
  );
}
