/**
 * What a student owes, at a glance — the four numbers, and the one rule.
 *
 * PURE, AND SEPARATE FROM THE SERVICE, exactly like ledger.ts beside it. These
 * figures decide whether somebody believes they still owe money, so they are
 * arithmetic that can be tested rather than a query that has to be trusted.
 *
 * THE RULE, WHICH IS THE WHOLE POINT OF THIS FILE:
 *
 *   A PENDING SUBMISSION IS NEVER SUBTRACTED FROM WHAT IS OWED.
 *
 * A student saying they transferred 25,000 is evidence, not money. If it were
 * netted off, a screen would tell them they owe nothing on the strength of
 * their own claim — and the Institute's own figure for what it is owed would
 * be a number the students control. Pending is reported BESIDE the balance,
 * never inside it, and the labels say so in words:
 *
 *   Total fee            everything charged, less anything written off
 *   Verified             payments the office has confirmed, less reversals
 *   Awaiting checking    claims submitted and not yet reviewed  ← not money
 *   Still to pay         total − verified                       ← ignores the above
 *
 * The one place the two are combined is `remainingIfAllVerified`, and it is
 * named at that length so that nothing can print it under a shorter label.
 */

export type FeeStanding =
  | "NOTHING_DUE"
  | "AWAITING_VERIFICATION"
  | "PARTIALLY_PAID"
  | "FULLY_PAID"
  | "IN_CREDIT"
  | "UNPAID";

export interface FeeSummary {
  currency: string;
  /** Charged, less waivers. What the student is actually being asked for. */
  totalFee: number;
  /** Raised against them in total, waivers included. */
  charged: number;
  waived: number;
  /** Confirmed by the office and not reversed. The only figure that is money. */
  verified: number;
  /** Confirmed and later taken back. Shown, never netted away (BR-RPT-05). */
  reversed: number;
  /** Claimed and not yet reviewed. EVIDENCE, NOT MONEY. */
  pending: number;
  /** How many claims that is, so "Rs 0 awaiting" and "none awaiting" differ. */
  pendingCount: number;
  /** totalFee − verified. Never touched by `pending`. */
  remaining: number;
  /** What would be left if every pending claim were verified as submitted. */
  remainingIfAllVerified: number;
  /** Overpaid, when verified exceeds the total. Positive means we owe them. */
  credit: number;
  standing: FeeStanding;
  /** The standing in the Institute's own words, for a student to read. */
  headline: string;
}

export interface SummaryCharge {
  amount: number;
  waivedAt: Date | null;
}

export interface SummaryPayment {
  amount: number;
  isReversed: boolean;
}

export interface SummarySubmission {
  claimedAmount: number;
  status: string;
}

/** Money rounds to the paisa. Compared with a tolerance, never with `===`. */
const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

/** Within half a paisa. Floating point does not do equality. */
const isZero = (n: number): boolean => Math.abs(n) < 0.005;

export function summarise(
  charges: SummaryCharge[],
  payments: SummaryPayment[],
  submissions: SummarySubmission[],
  currency = "PKR",
): FeeSummary {
  const charged = round2(sum(charges.map((c) => c.amount)));
  const waived = round2(sum(charges.filter((c) => c.waivedAt !== null).map((c) => c.amount)));
  const totalFee = round2(charged - waived);

  const verified = round2(sum(payments.filter((p) => !p.isReversed).map((p) => p.amount)));
  const reversed = round2(sum(payments.filter((p) => p.isReversed).map((p) => p.amount)));

  const awaiting = submissions.filter((s) => s.status === "PENDING");
  const pending = round2(sum(awaiting.map((s) => s.claimedAmount)));

  const remaining = round2(totalFee - verified);
  const remainingIfAllVerified = round2(remaining - pending);

  return {
    currency,
    totalFee,
    charged,
    waived,
    verified,
    reversed,
    pending,
    pendingCount: awaiting.length,
    // Clamped at zero. "Still to pay: −5,000" is not a sentence anybody can
    // act on; an overpayment is reported as credit, which is what it is.
    remaining: Math.max(0, remaining),
    remainingIfAllVerified,
    credit: remaining < 0 ? round2(-remaining) : 0,
    standing: standingOf({ totalFee, verified, remaining, pending }),
    headline: headlineFor({ totalFee, verified, remaining, pending, currency }),
  };
}

function standingOf(f: {
  totalFee: number;
  verified: number;
  remaining: number;
  pending: number;
}): FeeStanding {
  if (isZero(f.totalFee) && isZero(f.verified) && isZero(f.pending)) return "NOTHING_DUE";
  if (f.remaining < -0.005) return "IN_CREDIT";
  if (isZero(f.remaining)) return "FULLY_PAID";
  // A student who has paid something is PARTIALLY_PAID even while another
  // claim waits — the money already confirmed is the more important fact
  // about them, and AWAITING is reserved for somebody with nothing verified.
  if (f.verified > 0.005) return "PARTIALLY_PAID";
  if (f.pending > 0.005) return "AWAITING_VERIFICATION";
  return "UNPAID";
}

/**
 * The standing as a sentence.
 *
 * WRITTEN FOR A STUDENT, not for a bookkeeper — NFR-USE. "Verification
 * pending" tells somebody nothing about what to do; "we are checking it, and
 * you do not need to do anything" does. Every branch that mentions a pending
 * claim says explicitly that it is not counted yet, because the single most
 * likely misreading of this screen is that submitting a payment settles it.
 */
function headlineFor(f: {
  totalFee: number;
  verified: number;
  remaining: number;
  pending: number;
  currency: string;
}): string {
  const m = (n: number) => format(n, f.currency);

  if (isZero(f.totalFee) && isZero(f.verified) && isZero(f.pending)) {
    return "No fee has been charged to you yet.";
  }
  if (f.remaining < -0.005) {
    return `You have paid ${m(-f.remaining)} more than was charged. The Institute owes this back — speak to the office.`;
  }
  if (isZero(f.remaining)) {
    return f.pending > 0.005
      ? `Your fee is paid in full. You also have ${m(f.pending)} waiting to be checked.`
      : "Your fee is paid in full. Nothing is outstanding.";
  }
  if (f.pending > 0.005) {
    const after = round2(f.remaining - f.pending);
    if (after <= 0.005) {
      return `${m(f.remaining)} is still to pay, and you have submitted ${m(f.pending)} that we are checking. Once it is verified your fee will be settled.`;
    }
    return `${m(f.remaining)} is still to pay. ${m(f.pending)} of that has been submitted and is being checked; it does not count until we have verified it.`;
  }
  return `${m(f.remaining)} is still to pay.`;
}

/**
 * Money as the Institute writes it — the same shape as fee-structure.ts.
 *
 * Repeated rather than imported so that this file stays free of everything
 * else in the module; it is four lines, and the two must agree because a
 * student sees both on one screen.
 */
export function format(amount: number, currency = "PKR"): string {
  const whole = Number.isInteger(amount);
  const body = Math.abs(amount).toLocaleString("en-PK", {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  });
  const sign = amount < 0 ? "−" : "";
  return currency === "PKR" ? `${sign}Rs ${body}` : `${sign}${currency} ${body}`;
}
