import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiError, api } from "../api/client";
import { Icon } from "../components/Icon";
import { SkeletonCards } from "../components/Ui";
import { Field } from "../components/Field";
import { money, shortDate, type FeeSummary } from "./FeesSubmissions";

/**
 * TELLING THE INSTITUTE YOU HAVE PAID — FR-PAY-021.
 *
 * THE PROBLEM THIS SCREEN REPLACES. A student who transferred their second
 * instalment had nowhere in the System to say so. The slip went to somebody's
 * personal WhatsApp, the ledger went on saying the money was owed, and the
 * record of the payment began whenever a human got round to typing it in.
 *
 * FOUR DECISIONS SHAPE THE FORM:
 *
 * 1. IT ASKS FOR WHAT THE SYSTEM CANNOT KNOW, and nothing else. The name, the
 *    registration number, the programme and the balance are already ours; a
 *    student retyping them is a student introducing a mistake into a financial
 *    record. Five fields are left, and one of them is a photograph.
 *
 * 2. THE BALANCE IS SHOWN BEFORE THE AMOUNT BOX, not after. "Rs 25,000 is
 *    still to pay" placed above the field is what makes the figure typed into
 *    it correct; the same sentence underneath is a correction after the fact.
 *
 * 3. THE PROOF IS NOT OPTIONAL AND THE SCREEN SAYS WHY. A claim with no
 *    evidence cannot be verified, so it would sit in the queue until somebody
 *    rejected it — which is a worse outcome for the student than being asked
 *    for the photograph now.
 *
 * 4. IT PROMISES NOTHING IT CANNOT KEEP. Submitting does not pay the fee, and
 *    every sentence on the way through says so. The confirmation at the end is
 *    about what happens NEXT rather than about what was saved.
 */

interface Context {
  student: {
    id: string;
    fullName: string;
    email: string;
    registrationNo: string;
    rollNo: number | null;
    programme: string | null;
    section: string | null;
  };
  summary: FeeSummary;
  bank: {
    bankName: string | null;
    accountName: string | null;
    accountNumber: string | null;
    iban: string | null;
    instructions: string | null;
    configured: boolean;
  };
  methods: Array<{ value: string; label: string }>;
}

interface Submitted {
  id: string;
  reference: string;
  amount: number;
  currency: string;
  methodLabel: string;
  bankReference: string | null;
  paidOn: string;
  emailed: boolean;
  message: string;
}

/** What the server will accept, said here so a phone is told before it uploads. */
const ACCEPTED = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
const MAX_BYTES = 5 * 1024 * 1024;

/** A file that has reached the server and has an id the submission can name. */
interface Proof {
  documentId: string;
  name: string;
  contentType: string;
  /** For the preview. Revoked when the file is removed or the page unmounts. */
  previewUrl: string | null;
}

/** Today, as the date input wants it, in the student's own zone rather than UTC. */
const todayLocal = (): string => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export function PaymentSubmitPage() {
  const navigate = useNavigate();
  const [context, setContext] = useState<Context | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("");
  const [paidOn, setPaidOn] = useState(todayLocal);
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [proof, setProof] = useState<Proof[]>([]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Submitted | null>(null);

  useEffect(() => {
    api
      .get<Context>("/fees/submissions/context")
      .then((c) => {
        setContext(c);
        // The first method is BANK_TRANSFER, which is the commonest. Chosen for
        // them rather than left empty, so the form has one fewer decision on a
        // phone — and still changeable in one tap.
        setMethod((m) => m || (c.methods[0]?.value ?? "BANK_TRANSFER"));
      })
      .catch((e) =>
        setLoadError(
          e instanceof ApiError ? e.message : "Your fee details could not be loaded.",
        ),
      );
  }, []);

  // Object URLs live as long as the tab unless released. A student who
  // attaches, removes and re-attaches four photographs would otherwise hold
  // all of them in memory.
  useEffect(
    () => () => {
      proof.forEach((p) => p.previewUrl && URL.revokeObjectURL(p.previewUrl));
    },
    [proof],
  );

  if (loadError) {
    return (
      <>
        <header className="page-head">
          <h1>Submit a fee payment</h1>
        </header>
        <div className="alert alert-error" role="alert">
          <p>{loadError}</p>
        </div>
        <Link className="btn" to="/fees">
          Back to Fees
        </Link>
      </>
    );
  }

  if (!context) return <SkeletonCards count={2} />;

  if (done) return <Confirmation submitted={done} />;

  const s = context.summary;
  const typed = Number(amount.replace(/,/g, ""));
  const valid = Number.isFinite(typed) && typed > 0;
  // A figure larger than the balance is ALLOWED — a student may prepay or pay
  // a round number, and refusing it sends the money back to being unrecorded.
  // It is remarked on, not blocked.
  const overpaying = valid && typed > s.remaining + 0.005 && s.remaining > 0;

  const submit = async () => {
    setError(null);

    if (!valid) return setError("Enter the amount you paid, in numbers.");
    if (proof.length === 0)
      return setError("Attach a photo or PDF of your payment receipt before submitting.");

    setBusy(true);
    try {
      const created = await api.post<Submitted>("/fees/submissions", {
        amount: typed,
        method,
        paymentDate: paidOn,
        ...(reference.trim() ? { bankReference: reference.trim() } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
        documentIds: proof.map((p) => p.documentId),
      });
      setDone(created);
    } catch (e) {
      setError(
        e instanceof ApiError
          ? (e.details?.map((d) => d.message).join(" ") ?? e.message)
          : "Your payment could not be submitted. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Submit a fee payment</h1>
          <p className="muted small">
            Pay into the Institute's account first, then tell us about it here and attach the
            receipt.
          </p>
        </div>
        <button className="btn btn-quiet" onClick={() => navigate("/fees")}>
          Cancel
        </button>
      </header>

      {/* WHERE TO PAY comes first, because for a student who has not paid yet
          this is the reason they opened the screen. */}
      {context.bank.configured && <BankDetails bank={context.bank} />}

      <section className="card">
        <h2>Your details</h2>
        <p className="muted small">
          Taken from your student record — you do not need to type these, and they will appear on
          your receipt exactly as shown.
        </p>
        <dl className="paydetails">
          <div>
            <dt>Name</dt>
            <dd>{context.student.fullName}</dd>
          </div>
          <div>
            <dt>Registration number</dt>
            <dd>{context.student.registrationNo}</dd>
          </div>
          {context.student.programme && (
            <div>
              <dt>Programme</dt>
              <dd>{context.student.programme}</dd>
            </div>
          )}
          {context.student.section && (
            <div>
              <dt>Batch</dt>
              <dd>
                {context.student.section}
                {context.student.rollNo === null ? "" : ` · roll no. ${context.student.rollNo}`}
              </dd>
            </div>
          )}
        </dl>
      </section>

      {/*
        THE ARITHMETIC, BEFORE THE BOX. Three lines and then the field, so the
        number a student types is the number they have just been shown.
      */}
      <section className="card">
        <h2>How much is outstanding</h2>
        <dl className="paycalc">
          <div>
            <dt>Total fee</dt>
            <dd>{money(s.totalFee, s.currency)}</dd>
          </div>
          <div>
            <dt>Already verified</dt>
            <dd>− {money(s.verified, s.currency)}</dd>
          </div>
          {s.pending > 0 && (
            <div className="paycalc-aside">
              <dt>Submitted, still being checked</dt>
              <dd>{money(s.pending, s.currency)}</dd>
            </div>
          )}
          <div className="paycalc-total">
            <dt>Still to pay</dt>
            <dd>{money(s.remaining, s.currency)}</dd>
          </div>
        </dl>
        {s.pending > 0 && (
          <p className="muted small">
            The {money(s.pending, s.currency)} you have already submitted is not subtracted above.
            It counts once the office has verified it.
          </p>
        )}
      </section>

      <section className="card">
        <h2>What you paid</h2>

        {/* NOT the Field component: this is a composite control — a currency
            prefix and an input inside one bordered box — and Field clones a
            single element. The :user-invalid rules in the stylesheet give it
            the same red edge without the tick. */}
        <label className="field">
          <span>Amount you are submitting</span>
          <div className="amount-input">
            <span className="amount-currency">{s.currency === "PKR" ? "Rs" : s.currency}</span>
            <input
              // `inputMode` rather than type=number: a numeric keypad on a
              // phone, without the scroll-wheel and spinner behaviour that
              // silently changes a figure on a desktop.
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={s.remaining > 0 ? String(s.remaining) : "0"}
              aria-describedby="amount-help"
              required
            />
          </div>
          <span className="muted small" id="amount-help">
            Enter the exact amount that left your account, even if it is not the full balance.
          </span>
        </label>

        {overpaying && (
          <div className="alert alert-warn">
            <p className="small">
              That is more than the {money(s.remaining, s.currency)} outstanding. You can still
              submit it — check the figure against your receipt first.
            </p>
          </div>
        )}

        <div className="field-row">
          <Field label="How you paid"><select value={method} onChange={(e) => setMethod(e.target.value)}>
              {context.methods.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </Field>

          {/* The amount box above keeps its bespoke currency control and is
              covered by the :user-invalid rules in the stylesheet; these two
              have the standard shape, so they take the component and get the
              tick, the cross and the message with it. */}
          <Field label="Date you paid" required>
            <input
              type="date"
              value={paidOn}
              max={todayLocal()}
              onChange={(e) => setPaidOn(e.target.value)}
              required
            />
          </Field>
        </div>

        {/* OPTIONAL, and the component knows the difference: left blank it
            shows nothing at all, because leaving a box empty is not an
            achievement worth a green tick. Filled in, it confirms. */}
        <Field
          label="Transaction number"
          hint="The reference on your EasyPaisa, JazzCash or bank receipt. Leave it blank if your slip does not show one — it helps us find your payment faster."
        >
          <input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            maxLength={100}
            placeholder="e.g. TID 4417829903"
          />
        </Field>

        <Field label="Anything we should know (optional)"><textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={1000}
            rows={2}
            placeholder="For example: paid by my father from his account."
          />
        </Field>
      </section>

      <ProofUpload proof={proof} onChange={setProof} />

      {error && (
        <div className="alert alert-error" role="alert">
          <p>{error}</p>
        </div>
      )}

      <section className="card">
        <h2>Before you submit</h2>
        <ul className="checklist">
          <li>
            You are telling us you paid{" "}
            <strong>{valid ? money(typed, s.currency) : "—"}</strong>{" "}
            {method && `by ${context.methods.find((m) => m.value === method)?.label ?? method}`} on{" "}
            {paidOn ? shortDate(paidOn) : "—"}.
          </li>
          <li>
            {proof.length === 0
              ? "No receipt is attached yet."
              : `${proof.length} file${proof.length === 1 ? "" : "s"} attached as proof.`}
          </li>
          <li>
            This does <strong>not</strong> pay your fee straight away. The office checks your
            receipt against the bank record, and you will get an email either way.
          </li>
        </ul>

        <div className="form-actions">
          <button
            className="btn btn-primary"
            onClick={() => void submit()}
            disabled={busy || !valid || proof.length === 0}
          >
            {busy ? "Submitting…" : "Submit payment"}
          </button>
          <Link className="btn btn-quiet" to="/fees">
            Back to Fees
          </Link>
        </div>
      </section>
    </>
  );
}

/** Where the money goes. The reason a student opened this page at all. */
function BankDetails({ bank }: { bank: Context["bank"] }) {
  const [copied, setCopied] = useState<string | null>(null);

  const copy = (label: string, value: string) => {
    void navigator.clipboard?.writeText(value).then(
      () => {
        setCopied(label);
        window.setTimeout(() => setCopied(null), 2000);
      },
      () => undefined,
    );
  };

  const rows: Array<[string, string]> = [
    ...(bank.bankName ? ([["Bank", bank.bankName]] as Array<[string, string]>) : []),
    ...(bank.accountName ? ([["Account name", bank.accountName]] as Array<[string, string]>) : []),
    ...(bank.accountNumber
      ? ([["Account number", bank.accountNumber]] as Array<[string, string]>)
      : []),
    ...(bank.iban ? ([["IBAN", bank.iban]] as Array<[string, string]>) : []),
  ];

  return (
    <section className="card paybank">
      <h2>Where to pay</h2>
      <dl className="paydetails">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>
              <span className="paybank-value">{value}</span>
              {/* An account number copied by hand from a screen is how money
                  reaches the wrong account. */}
              <button className="btn btn-sm btn-quiet" onClick={() => copy(label, value)}>
                {copied === label ? "Copied" : "Copy"}
              </button>
            </dd>
          </div>
        ))}
      </dl>
      {bank.instructions && <p className="small">{bank.instructions}</p>}
    </section>
  );
}

/**
 * The payment proof.
 *
 * DRAG AND DROP ON A DESK, THE CAMERA ON A PHONE, and the same handler behind
 * both. Most of these arrive from a phone — the screenshot is already in the
 * gallery of the device the student is holding — so the tap target is large,
 * the file picker accepts images directly, and nothing about the layout
 * assumes a mouse.
 *
 * EACH FILE IS UPLOADED THE MOMENT IT IS CHOSEN, not held until the form is
 * submitted. A slow upload discovered at the end of a form is a form the
 * student abandons; this way the wait happens while they are still typing the
 * transaction number, and a file that is refused is refused while they still
 * have the gallery open.
 */
function ProofUpload({
  proof,
  onChange,
}: {
  proof: Proof[];
  onChange: (next: Proof[]) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accept = async (files: FileList) => {
    if (files.length === 0) return;
    setError(null);

    for (const file of Array.from(files)) {
      if (proof.length >= 5) {
        setError("You can attach at most five files.");
        return;
      }
      // Checked here as well as on the server, so somebody on a slow
      // connection is told immediately rather than after a 5MB upload.
      if (!ACCEPTED.includes(file.type)) {
        setError(
          `"${file.name}" is not a photo or a PDF. Attach a JPEG, PNG, WebP or PDF — a photo taken with a phone camera is fine.`,
        );
        continue;
      }
      if (file.size > MAX_BYTES) {
        setError(`"${file.name}" is larger than 5 MB. A photo from a phone is usually well under it.`);
        continue;
      }

      setBusy(true);
      try {
        const form = new FormData();
        form.append("file", file);
        const r = await api.upload<{ documentId: string }>("/fees/submissions/proof", form);
        onChange([
          ...proof,
          {
            documentId: r.documentId,
            name: file.name,
            contentType: file.type,
            previewUrl: file.type === "application/pdf" ? null : URL.createObjectURL(file),
          },
        ]);
      } catch (e) {
        setError(
          e instanceof ApiError
            ? (e.details?.map((d) => d.message).join(" ") ?? e.message)
            : "That file could not be uploaded. Please try again.",
        );
      } finally {
        setBusy(false);
      }
    }
  };

  const remove = (documentId: string) => {
    const going = proof.find((p) => p.documentId === documentId);
    if (going?.previewUrl) URL.revokeObjectURL(going.previewUrl);
    onChange(proof.filter((p) => p.documentId !== documentId));
  };

  return (
    <section className="card">
      <h2>Your payment receipt</h2>
      <p className="muted small">
        Upload a clear screenshot or photo showing that the payment went through — the amount, the
        date and the transaction number should all be readable. This is what the office checks, so
        a blurred photograph is the commonest reason a payment cannot be verified.
      </p>

      <div
        className={over ? "dropzone is-over" : "dropzone"}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void accept(e.dataTransfer.files);
        }}
      >
        <Icon name="upload" className="dropzone-icon" />
        <p>
          <button className="link-button" onClick={() => input.current?.click()} disabled={busy}>
            Choose a file
          </button>{" "}
          or drag it here
        </p>
        <p className="muted small">JPEG, PNG, WebP or PDF · up to 5 MB · up to five files</p>
        <input
          ref={input}
          type="file"
          className="visually-hidden"
          accept={ACCEPTED.join(",")}
          multiple
          onChange={(e) => {
            if (e.target.files) void accept(e.target.files);
            // Cleared so choosing the SAME file again still fires a change —
            // which is exactly what somebody does after removing it by mistake.
            e.target.value = "";
          }}
        />
        {busy && <p className="muted small">Uploading…</p>}
      </div>

      {error && (
        <div className="alert alert-error" role="alert">
          <p className="small">{error}</p>
        </div>
      )}

      {proof.length > 0 && (
        <ul className="proofgrid">
          {proof.map((p) => (
            <li key={p.documentId} className="proofitem">
              {p.previewUrl ? (
                <img src={p.previewUrl} alt={`Your payment receipt: ${p.name}`} />
              ) : (
                <div className="proofitem-pdf">
                  <Icon name="clipboard" />
                  <span className="small">PDF</span>
                </div>
              )}
              <div className="proofitem-foot">
                <span className="small" title={p.name}>
                  {p.name}
                </span>
                <button className="btn btn-sm btn-quiet" onClick={() => remove(p.documentId)}>
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * What happened, and what happens next.
 *
 * NOT A TOAST. A student who has just told the Institute they paid 25,000
 * rupees deserves a page confirming the figures they sent, the reference to
 * quote, and — most importantly — that this is not yet a settled payment.
 */
function Confirmation({ submitted }: { submitted: Submitted }) {
  return (
    <>
      <header className="page-head">
        <h1>Payment submitted</h1>
      </header>

      <section className="card payconfirm">
        <div className="payconfirm-mark" aria-hidden="true">
          <Icon name="tick" />
        </div>
        <h2>Thank you — we have your submission</h2>
        <p>{submitted.message}</p>

        <dl className="paydetails">
          <div>
            <dt>Amount submitted</dt>
            <dd>
              <strong>{money(submitted.amount, submitted.currency)}</strong>
            </dd>
          </div>
          <div>
            <dt>Payment method</dt>
            <dd>{submitted.methodLabel}</dd>
          </div>
          {submitted.bankReference && (
            <div>
              <dt>Transaction number</dt>
              <dd>{submitted.bankReference}</dd>
            </div>
          )}
          <div>
            <dt>Paid on</dt>
            <dd>{shortDate(submitted.paidOn)}</dd>
          </div>
          <div>
            <dt>Your reference</dt>
            <dd>
              <strong>{submitted.reference}</strong>
            </dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>
              <span className="pill pill-warn">Waiting to be checked</span>
            </dd>
          </div>
        </dl>

        {/* Honest about the email, because a student who was told one is
            coming and gets none will assume the payment was lost. */}
        <p className="muted small">
          {submitted.emailed
            ? "A confirmation has been emailed to you. Keep your reference number safe."
            : "We could not send the confirmation email just now, but your submission is safely recorded. Quote your reference number if you contact the office."}
        </p>

        <div className="form-actions">
          <Link className="btn btn-primary" to="/fees">
            View my payments
          </Link>
        </div>
      </section>
    </>
  );
}
