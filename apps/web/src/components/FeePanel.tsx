/**
 * What a course costs, to the person about to pay for it — FR-PAY-033.
 *
 * THE PAGE THIS APPEARS ON USED TO SAY "pay the fee into the Institute's
 * account" AND NAME NEITHER. The applicant was asked for "the amount you paid"
 * with no way to find out what that should be, and no account number to send
 * it to. In practice they telephoned the office to ask, or they guessed — and
 * a guess becomes an AMOUNT_INSUFFICIENT rejection of somebody who was trying
 * to do exactly what was asked.
 *
 * SO THE NUMBER TO PAY TODAY IS THE LOUDEST THING HERE. Everything else on
 * this panel is context for it: the whole fee so they know what they are
 * committing to, the breakdown so it is not a mystery figure, the schedule so
 * they can plan, and the account so they can act. A reader in a hurry who
 * takes away one number must take away the right one.
 */

export interface FeeLine {
  label: string;
  amount: number;
}

export interface FeeInstalment extends FeeLine {
  dueAfterDays: number;
}

export interface Fee {
  currency: string;
  totalAmount: number;
  dueAtApplication: number;
  notes: string | null;
  components: FeeLine[];
  instalments: FeeInstalment[];
}

export interface PaymentDetails {
  bankName: string | null;
  accountName: string | null;
  accountNumber: string | null;
  iban: string | null;
  instructions: string | null;
  configured: boolean;
}

/**
 * Money as the Institute writes it.
 *
 * Grouped, because 90000 and 900000 are indistinguishable at a glance and the
 * difference is somebody's year. Whole rupees show no decimals; a fractional
 * amount shows both places, because "Rs 90,000.5" is not how anybody writes
 * money. This mirrors format() in the API — the same figure has to read the
 * same way on the page and in the email about it.
 */
export function money(amount: number, currency = "PKR"): string {
  const whole = Number.isInteger(amount);
  const body = amount.toLocaleString("en-PK", {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  });
  return currency === "PKR" ? `Rs ${body}` : `${currency} ${body}`;
}

/**
 * "30 days after you enrol", in words somebody can plan around.
 *
 * NOT A DATE, because the offset is relative to an enrolment that has not
 * happened yet — printing a date would be inventing one. Months rather than
 * days once it is past a month, because "due 90 days after you enrol" is
 * arithmetic the reader has to do and "3 months" is not.
 */
export function whenDue(days: number): string {
  if (days <= 0) return "On admission";
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} after enrolling`;
  const months = Math.round(days / 30);
  return `${months} month${months === 1 ? "" : "s"} after enrolling`;
}

/**
 * The panel.
 *
 * `fee` is null when the programme has no published price. That is a real
 * state, not an error: a course whose fee the office has not set yet must say
 * so and tell the applicant to ask, rather than showing "Rs 0" — which is a
 * price, and one no institute charges.
 */
export function FeePanel({
  fee,
  payment,
  programmeName,
}: {
  fee: Fee | null;
  payment: PaymentDetails | null;
  programmeName?: string;
}) {
  if (!fee) {
    return (
      <div className="alert alert-warn">
        <strong>The fee for this course is not published yet.</strong>
        <p className="small">
          Please contact the office to ask what to pay before you transfer anything. You can still
          finish this application — attach your slip once you have paid.
        </p>
      </div>
    );
  }

  const laterInstalments = fee.instalments.slice(1);

  return (
    <div className="fee-panel">
      {/* The one number that decides what they do in the next ten minutes. */}
      <div className="fee-headline">
        <span className="fee-headline-label">Pay now to apply</span>
        <strong className="fee-headline-amount">{money(fee.dueAtApplication, fee.currency)}</strong>
        {fee.dueAtApplication < fee.totalAmount && (
          <span className="muted small">
            of {money(fee.totalAmount, fee.currency)} in total
            {programmeName ? ` for ${programmeName}` : ""}
          </span>
        )}
      </div>

      {fee.components.length > 0 && (
        <div className="fee-block">
          <h4>What the fee covers</h4>
          <ul className="fee-lines">
            {fee.components.map((c, i) => (
              <li key={`${c.label}-${i}`}>
                <span>{c.label}</span>
                <span className="fee-amount">{money(c.amount, fee.currency)}</span>
              </li>
            ))}
            <li className="fee-total">
              <span>Total</span>
              <span className="fee-amount">{money(fee.totalAmount, fee.currency)}</span>
            </li>
          </ul>
        </div>
      )}

      {fee.instalments.length > 1 && (
        <div className="fee-block">
          <h4>How it is paid</h4>
          <ul className="fee-lines">
            {fee.instalments.map((inst, i) => (
              <li key={`${inst.label}-${i}`} className={i === 0 ? "fee-now" : undefined}>
                <span>
                  {inst.label}
                  <br />
                  <span className="muted small">{whenDue(inst.dueAfterDays)}</span>
                </span>
                <span className="fee-amount">
                  {money(inst.amount, fee.currency)}
                  {/* Marked, so the reader can see at a glance which row is the
                      one they act on today. */}
                  {i === 0 && <span className="pill pill-ok fee-now-pill">now</span>}
                </span>
              </li>
            ))}
          </ul>
          {laterInstalments.length > 0 && (
            <p className="muted small">
              You only pay the first instalment to apply. The rest are due after you enrol, and the
              System will show them on your fee statement.
            </p>
          )}
        </div>
      )}

      {/* Where the money goes. Without this the fee is a number they cannot
          act on, which is the state this whole panel exists to end. */}
      {payment?.configured ? (
        <div className="fee-block fee-bank">
          <h4>Where to pay</h4>
          <dl className="fee-bank-list">
            {payment.bankName && (
              <div>
                <dt>Bank</dt>
                <dd>{payment.bankName}</dd>
              </div>
            )}
            {payment.accountName && (
              <div>
                <dt>Account name</dt>
                {/* Selectable and monospaced: these get copied, and a digit
                    misread is a transfer into somebody else's account. */}
                <dd className="fee-account">{payment.accountName}</dd>
              </div>
            )}
            {payment.accountNumber && (
              <div>
                <dt>Account number</dt>
                <dd className="fee-account">{payment.accountNumber}</dd>
              </div>
            )}
            {payment.iban && (
              <div>
                <dt>IBAN</dt>
                <dd className="fee-account">{payment.iban}</dd>
              </div>
            )}
          </dl>
          {payment.instructions && <p className="small">{payment.instructions}</p>}
        </div>
      ) : (
        <div className="alert alert-warn">
          <strong>Ask the office where to send the payment.</strong>
          <p className="small">
            The Institute has not published its account details here yet.
          </p>
        </div>
      )}

      {fee.notes && <p className="muted small fee-notes">{fee.notes}</p>}
    </div>
  );
}
