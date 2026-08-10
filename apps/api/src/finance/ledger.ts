/**
 * The fee ledger — SRS §5.16, FR-PAY-020..032.
 *
 * What a student owes, what they have paid, and what is left.
 *
 * THE INSTITUTE HAS HAD NO LEDGER. `Student.outstandingBalance` has existed
 * since the first migration and NOTHING HAS EVER WRITTEN TO IT: it is read by
 * the personal-data export, which therefore tells every student they owe
 * nothing, and by the erasure refusal, which therefore never fires. Payments
 * were recorded at admission and never set against anything.
 *
 * A ledger is arithmetic, so it lives here, pure and tested. Three rules decide
 * every figure, and each exists because getting it wrong produces a number that
 * is confidently wrong rather than obviously broken:
 *
 *   A REVERSED PAYMENT IS SHOWN, NOT REMOVED. BR-RPT-05 already says so for
 *   revenue and it matters more here: a student holding a receipt for a payment
 *   that was later reversed must find both on their statement. Netting it away
 *   makes the Institute look as though it lost the money.
 *
 *   A WAIVED CHARGE IS SHOWN, NOT DELETED (BR-DAT-02). Somebody decided to
 *   write it off, and that decision is part of the record.
 *
 *   THE RUNNING BALANCE NEEDS A STABLE ORDER. Two entries on the same day, or
 *   two payments with the same timestamp, must sort the same way every time —
 *   otherwise two people reading one statement see different running totals and
 *   neither is wrong.
 */

export interface Charge {
  id: string;
  description: string;
  amount: number;
  dueDate: Date;
  createdAt: Date;
  waivedAt: Date | null;
  waiverReason: string | null;
}

export interface LedgerPayment {
  id: string;
  amount: number;
  paidOn: Date;
  method: string;
  reference: string | null;
  isReversed: boolean;
  reversedAt: Date | null;
  reversalReason: string | null;
}

export interface Balance {
  /** Everything ever charged, waivers included. */
  charged: number;
  /** Written off, and therefore not owed. */
  waived: number;
  /** Received and not reversed. */
  paid: number;
  /** Received and later taken back. */
  reversed: number;
  /** What the student actually owes. Negative means they are in credit. */
  outstanding: number;
}

export function balanceOf(charges: Charge[], payments: LedgerPayment[]): Balance {
  const charged = sum(charges.map((c) => c.amount));
  const waived = sum(charges.filter((c) => c.waivedAt).map((c) => c.amount));
  const paid = sum(payments.filter((p) => !p.isReversed).map((p) => p.amount));
  const reversed = sum(payments.filter((p) => p.isReversed).map((p) => p.amount));

  return {
    charged: round2(charged),
    waived: round2(waived),
    paid: round2(paid),
    reversed: round2(reversed),
    // A reversed payment is not subtracted here because it was never added:
    // `paid` excludes it. Subtracting it as well would double-count the loss.
    outstanding: round2(charged - waived - paid),
  };
}

export type LineKind = "CHARGE" | "WAIVER" | "PAYMENT" | "REVERSAL";

export interface StatementLine {
  date: Date;
  kind: LineKind;
  description: string;
  /** Increases what is owed. */
  debit: number | null;
  /** Reduces what is owed. */
  credit: number | null;
  /** Owed after this line. */
  balance: number;
}

/**
 * FR-PAY-026 — the statement, in the order things happened.
 *
 * Every event is its own line, including the ones that undo another. A
 * statement that shows a payment and silently omits its reversal is a statement
 * that disagrees with the bank.
 */
export function statement(charges: Charge[], payments: LedgerPayment[]): StatementLine[] {
  const events: Array<Omit<StatementLine, "balance"> & { tie: string }> = [];

  for (const c of charges) {
    events.push({
      date: c.createdAt,
      kind: "CHARGE",
      description: c.description,
      debit: c.amount,
      credit: null,
      tie: `1:${c.id}`,
    });
    if (c.waivedAt) {
      events.push({
        date: c.waivedAt,
        kind: "WAIVER",
        description: c.waiverReason
          ? `Written off — ${c.waiverReason}`
          : `Written off — ${c.description}`,
        debit: null,
        credit: c.amount,
        tie: `2:${c.id}`,
      });
    }
  }

  for (const p of payments) {
    events.push({
      date: p.paidOn,
      kind: "PAYMENT",
      description: p.reference ? `${p.method} — ${p.reference}` : p.method,
      debit: null,
      credit: p.amount,
      tie: `3:${p.id}`,
    });
    if (p.isReversed) {
      events.push({
        // A reversal recorded without a date is placed at the payment it
        // undoes rather than at the epoch, which would put it before the
        // Institute existed.
        date: p.reversedAt ?? p.paidOn,
        kind: "REVERSAL",
        description: p.reversalReason ? `Reversed — ${p.reversalReason}` : "Payment reversed",
        debit: p.amount,
        credit: null,
        tie: `4:${p.id}`,
      });
    }
  }

  // Date first, then kind, then id. The tie-breaker is what makes two readings
  // of one statement agree: without it, entries sharing a timestamp sort by
  // whatever order the database happened to return.
  events.sort((a, b) => a.date.getTime() - b.date.getTime() || a.tie.localeCompare(b.tie));

  let balance = 0;
  return events.map((e) => {
    balance = round2(balance + (e.debit ?? 0) - (e.credit ?? 0));
    return {
      date: e.date,
      kind: e.kind,
      description: e.description,
      debit: e.debit,
      credit: e.credit,
      balance,
    };
  });
}

export interface Aging {
  /** Not yet due. */
  current: number;
  overdue30: number;
  overdue60: number;
  overdue90Plus: number;
  /** The oldest unpaid charge, in days overdue. Null when nothing is overdue. */
  oldestOverdueDays: number | null;
}

/**
 * FR-PAY-028 — how old the debt is.
 *
 * APPORTIONED OLDEST-FIRST, which is the convention and also the fair one: a
 * student who owes three instalments and pays one has paid the oldest, not the
 * newest. Applying payments to the newest would keep the oldest charge
 * perpetually overdue and make a paying student look like a defaulter.
 */
export function aging(charges: Charge[], payments: LedgerPayment[], now: Date): Aging {
  const owed = charges
    .filter((c) => !c.waivedAt)
    .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());

  let credit = sum(payments.filter((p) => !p.isReversed).map((p) => p.amount));

  const buckets: Aging = {
    current: 0,
    overdue30: 0,
    overdue60: 0,
    overdue90Plus: 0,
    oldestOverdueDays: null,
  };

  for (const c of owed) {
    const settled = Math.min(credit, c.amount);
    credit -= settled;
    const remaining = round2(c.amount - settled);
    if (remaining <= 0) continue;

    const days = Math.floor((now.getTime() - c.dueDate.getTime()) / 86_400_000);
    if (days <= 0) {
      buckets.current = round2(buckets.current + remaining);
      continue;
    }

    if (buckets.oldestOverdueDays === null || days > buckets.oldestOverdueDays) {
      buckets.oldestOverdueDays = days;
    }
    if (days <= 30) buckets.overdue30 = round2(buckets.overdue30 + remaining);
    else if (days <= 60) buckets.overdue60 = round2(buckets.overdue60 + remaining);
    else buckets.overdue90Plus = round2(buckets.overdue90Plus + remaining);
  }

  return buckets;
}

function sum(values: number[]): number {
  return values.reduce((total, v) => total + v, 0);
}

/** Money, to two places, and never 0.30000000000000004. */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
