/**
 * Instalment plans — SRS §5.16, FR-PAY-033..038.
 *
 * A fee of 90,000 paid in three instalments. The Institute's students mostly
 * pay this way, so this is not a convenience.
 *
 * TWO THINGS GO WRONG HERE, and both produce numbers that look right.
 *
 * ROUNDING. 100,000 in three does not divide. Rounding each instalment
 * independently gives 33,333.33 three times, which is 99,999.99 — the Institute
 * is a paisa short and nobody notices until a student with a zero balance is
 * still shown as owing. So the arithmetic is done in PAISA as integers, never
 * in floating point, and the remainder is given to specific instalments rather
 * than left to fall where it may. The instalments always sum to the total
 * EXACTLY; there is a test asserting it over hundreds of awkward amounts.
 *
 * MONTH ENDS. A plan starting on the 31st of January, monthly: the second
 * instalment is not the 3rd of March. Adding a month to a date naively rolls
 * over the short month and every later date is wrong by two or three days,
 * which matters because these are due dates that decide who is a debtor. The
 * 31st clamps to the 28th, 29th or 30th, and — this is the part usually missed
 * — the month AFTER that goes back to the 31st, because the plan is "the 31st
 * of each month" and not "three days before the end of each month".
 */

export interface Instalment {
  /** 1-based, as the student sees it: "instalment 2 of 3". */
  number: number;
  amount: number;
  dueDate: Date;
  description: string;
}

export interface PlanProblem {
  code: "AMOUNT" | "COUNT" | "START" | "TOO_SMALL";
  message: string;
}

/**
 * More than this and it is not a plan, it is a subscription. Twenty-four
 * monthly instalments already outlasts most programmes here.
 */
export const MAX_INSTALMENTS = 24;

/** Below this an instalment is not worth the paperwork of collecting it. */
export const MIN_INSTALMENT_PAISA = 10_000; // Rs 100

export type Cadence = "MONTHLY" | "FORTNIGHTLY" | "WEEKLY";

/**
 * Rupees to paisa, after which nothing else touches a float.
 *
 * Rounding rather than truncating: 0.1 + 0.2 arrives as 0.30000000000000004 and
 * truncating would lose a paisa on a value the Institute wrote down as exact.
 *
 * THIS IS ONLY EXACT FOR AMOUNTS OF MONEY, meaning at most two decimals. 1.005
 * is not one: it is stored as 1.00499999999999989, so this returns 100 rather
 * than 101 and no amount of cleverness here fixes that. Rather than pretend
 * otherwise, `hasWholePaisa` below refuses such a value at the edge, where it
 * can be reported to somebody who can retype it.
 */
export function toPaisa(rupees: number): number {
  return Math.round(rupees * 100);
}

/**
 * Is this a real amount of money — whole paisa, nothing finer?
 *
 * The tolerance is for float representation, not for rounding: 35.7 arrives as
 * 3570.0000000000005 paisa and is a perfectly good amount, while 1.005 arrives
 * as 100.49999999999999 and is not an amount at all.
 */
export function hasWholePaisa(rupees: number): boolean {
  const paisa = rupees * 100;
  return Math.abs(paisa - Math.round(paisa)) < 1e-6;
}

export function toRupees(paisa: number): number {
  return paisa / 100;
}

/**
 * Splits a total into `count` parts that sum to it EXACTLY.
 *
 * The remainder goes to the EARLIEST instalments, one paisa each, not to the
 * last. Two reasons, and the second is the real one: a plan whose final payment
 * is larger than the others reads as a penalty, and a student who pays every
 * instalment but the last has then underpaid by more than they expected. Paying
 * the odd paisa first also means the outstanding balance is never larger than
 * the student thinks it is.
 */
export function split(totalPaisa: number, count: number): number[] {
  const base = Math.floor(totalPaisa / count);
  const remainder = totalPaisa - base * count;
  return Array.from({ length: count }, (_, i) => base + (i < remainder ? 1 : 0));
}

/**
 * Adds months while keeping the DAY OF MONTH the plan started on.
 *
 * Clamping is per-step against the ORIGINAL day, not cumulative: from the 31st
 * of January, +1 month is the 28th of February and +2 months is the 31st of
 * March. Carrying the clamp forward would give the 28th of March and every
 * later date would drift.
 */
export function addMonthsKeepingDay(start: Date, months: number, dayOfMonth: number): Date {
  const y = start.getUTCFullYear();
  const m = start.getUTCMonth() + months;
  // Day 0 of the following month is the last day of this one.
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(dayOfMonth, lastDay)));
}

function addDays(start: Date, days: number): Date {
  return new Date(start.getTime() + days * 24 * 3600 * 1000);
}

export function refusePlan(
  totalRupees: number,
  count: number,
  firstDueDate: Date,
): PlanProblem | null {
  if (!Number.isFinite(totalRupees) || totalRupees <= 0) {
    return { code: "AMOUNT", message: "Enter the total amount to spread over the instalments." };
  }
  if (!hasWholePaisa(totalRupees)) {
    // Refused rather than rounded. Rounding here would write a plan that does
    // not add up to the figure the operator typed, and they would have no way
    // of knowing which one the Institute is actually owed.
    return {
      code: "AMOUNT",
      message: `Rs ${totalRupees} is not an amount of money — use at most two decimal places.`,
    };
  }
  if (!Number.isInteger(count) || count < 2) {
    return {
      code: "COUNT",
      // Not "must be at least 2": one instalment is a charge, and the
      // Institute already has a way to create one of those.
      message: "A plan needs at least two instalments. For a single payment, add a charge.",
    };
  }
  if (count > MAX_INSTALMENTS) {
    return {
      code: "COUNT",
      message: `${count} instalments is more than the ${MAX_INSTALMENTS} this allows.`,
    };
  }
  if (Number.isNaN(firstDueDate.getTime())) {
    return { code: "START", message: "Enter the date the first instalment is due." };
  }

  const each = Math.floor(toPaisa(totalRupees) / count);
  if (each < MIN_INSTALMENT_PAISA) {
    return {
      code: "TOO_SMALL",
      message:
        `${count} instalments of about Rs ${toRupees(each).toFixed(2)} each is too small to be ` +
        `worth collecting. Use fewer instalments.`,
    };
  }
  return null;
}

/**
 * The schedule, or the reason there is not one.
 *
 * Returns the problem rather than throwing, because every caller — the preview
 * on the screen and the endpoint that writes — needs to say the same sentence.
 */
export function planInstalments(input: {
  totalRupees: number;
  count: number;
  firstDueDate: Date;
  cadence: Cadence;
  /** e.g. "Spring 2026 tuition". Each instalment is named from it. */
  label: string;
}): { instalments: Instalment[]; problem: null } | { instalments: []; problem: PlanProblem } {
  const problem = refusePlan(input.totalRupees, input.count, input.firstDueDate);
  if (problem) return { instalments: [], problem };

  const amounts = split(toPaisa(input.totalRupees), input.count);
  const dayOfMonth = input.firstDueDate.getUTCDate();

  const instalments = amounts.map((paisa, i) => ({
    number: i + 1,
    amount: toRupees(paisa),
    dueDate:
      input.cadence === "MONTHLY"
        ? addMonthsKeepingDay(input.firstDueDate, i, dayOfMonth)
        : addDays(input.firstDueDate, i * (input.cadence === "WEEKLY" ? 7 : 14)),
    // The number is in the description because it ends up on a statement line
    // and on a receipt, where "Spring 2026 tuition" three times over is not
    // something anybody can reconcile.
    description: `${input.label} — instalment ${i + 1} of ${input.count}`,
  }));

  return { instalments, problem: null };
}

/**
 * What the operator is told before the charges are written.
 *
 * Names the uneven instalment explicitly. A schedule where one row differs by
 * a paisa looks like a mistake unless it is claimed as deliberate.
 */
export function describeSchedule(instalments: Instalment[]): string {
  if (instalments.length === 0) return "No instalments.";

  const total = instalments.reduce((sum, i) => sum + toPaisa(i.amount), 0);
  const distinct = [...new Set(instalments.map((i) => i.amount))];
  const first = instalments[0]!;
  const last = instalments[instalments.length - 1]!;
  const span =
    `${first.dueDate.toISOString().slice(0, 10)} to ${last.dueDate.toISOString().slice(0, 10)}`;

  if (distinct.length === 1) {
    return (
      `${instalments.length} instalments of Rs ${first.amount.toFixed(2)}, ` +
      `totalling Rs ${toRupees(total).toFixed(2)}, due ${span}.`
    );
  }
  return (
    `${instalments.length} instalments totalling Rs ${toRupees(total).toFixed(2)}, due ${span}. ` +
    `They are not all equal because the amount does not divide exactly — the odd paisa is ` +
    `added to the earliest instalments so the balance is never more than expected.`
  );
}
