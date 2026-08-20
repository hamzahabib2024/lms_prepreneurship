/**
 * A course's published price — the arithmetic, with nothing else attached.
 *
 * PURE, AND SEPARATE FROM THE SERVICE, because these numbers are shown to
 * members of the public who are about to transfer money on the strength of
 * them. A fee table that does not add up is worse than no fee table: an
 * applicant pays what the instalments told them, the office checks it against
 * the total, and the difference becomes an AMOUNT_INSUFFICIENT rejection of
 * somebody who did exactly what they were asked.
 *
 * IN PAISA, AS INTEGERS, for the reason instalments.ts already documents at
 * length: 100,000 in three does not divide, and three independently-rounded
 * thirds come to 99,999.99. Every comparison here happens in the smallest unit
 * so that "adds up" means adds up, not adds up to within a rounding error.
 */

export type LineKind = "COMPONENT" | "INSTALMENT";

export interface FeeLineInput {
  kind: LineKind;
  label: string;
  amount: number;
  /** INSTALMENT only. Days after enrolment; 0 is "on admission". */
  dueAfterDays?: number | null;
  sortOrder?: number;
}

export interface FeeStructureInput {
  name: string;
  currency: string;
  totalAmount: number;
  dueAtApplication: number;
  lines: FeeLineInput[];
}

export interface FeeProblem {
  /** Which field on the form to point at. */
  field: string;
  code: string;
  message: string;
}

/** Rupees to paisa. Rounded, never truncated — see instalments.ts. */
export function toPaisa(rupees: number): number {
  return Math.round(rupees * 100);
}

export function fromPaisa(paisa: number): number {
  return paisa / 100;
}

/** More than this and it is a price list, not a fee structure. */
export const MAX_LINES = 40;

/**
 * Everything wrong with this table, at once.
 *
 * ALL THE PROBLEMS, NOT THE FIRST ONE. An administrator typing a fee table
 * gets three things wrong at a time — a component that does not belong, an
 * instalment short by the registration fee, and a first instalment that does
 * not match what the form will ask for. Reporting them one per save is three
 * round trips to learn what one screen could have said at once.
 *
 * PUBLISHING IS WHAT THIS GUARDS, not typing. A half-entered table is
 * unfinished rather than wrong, so the editor saves drafts without complaint
 * and this runs when somebody says the price is final.
 */
export function validateForPublication(input: FeeStructureInput): FeeProblem[] {
  const problems: FeeProblem[] = [];

  if (!input.name.trim()) {
    problems.push({ field: "name", code: "REQUIRED", message: "Give this fee structure a name." });
  }

  if (!/^[A-Z]{3}$/.test(input.currency)) {
    problems.push({
      field: "currency",
      code: "INVALID",
      message: "The currency must be a three-letter code, such as PKR.",
    });
  }

  const total = toPaisa(input.totalAmount);
  const dueNow = toPaisa(input.dueAtApplication);

  if (!Number.isFinite(total) || total <= 0) {
    problems.push({
      field: "totalAmount",
      code: "INVALID",
      message: "The total fee must be more than zero.",
    });
  }

  if (dueNow < 0) {
    problems.push({
      field: "dueAtApplication",
      code: "INVALID",
      message: "The amount due on application cannot be negative.",
    });
  }

  if (total > 0 && dueNow > total) {
    problems.push({
      field: "dueAtApplication",
      code: "EXCEEDS_TOTAL",
      message:
        `The amount due on application (${format(input.dueAtApplication, input.currency)}) is more ` +
        `than the whole fee (${format(input.totalAmount, input.currency)}).`,
    });
  }

  if (input.lines.length > MAX_LINES) {
    problems.push({
      field: "lines",
      code: "TOO_MANY",
      message: `A fee structure may have at most ${MAX_LINES} lines.`,
    });
  }

  const components = input.lines.filter((l) => l.kind === "COMPONENT");
  const instalments = input.lines.filter((l) => l.kind === "INSTALMENT");

  for (const [i, line] of input.lines.entries()) {
    if (!line.label.trim()) {
      problems.push({
        field: `lines.${i}.label`,
        code: "REQUIRED",
        message: "Every line needs a label — it is what the applicant reads.",
      });
    }
    if (!Number.isFinite(line.amount) || line.amount < 0) {
      problems.push({
        field: `lines.${i}.amount`,
        code: "INVALID",
        message: `"${line.label || "This line"}" needs an amount of zero or more.`,
      });
    }
    // Refused at the edge rather than silently rounded, because a third of a
    // paisa cannot be paid and the applicant would be told a number that
    // cannot appear on a bank slip.
    if (Number.isFinite(line.amount) && !hasWholePaisa(line.amount)) {
      problems.push({
        field: `lines.${i}.amount`,
        code: "SUB_PAISA",
        message: `"${line.label || "This line"}" has more than two decimal places.`,
      });
    }
    if (line.kind === "INSTALMENT") {
      const days = line.dueAfterDays ?? 0;
      if (!Number.isInteger(days) || days < 0) {
        problems.push({
          field: `lines.${i}.dueAfterDays`,
          code: "INVALID",
          message: `"${line.label || "This instalment"}" needs a whole number of days, zero or more.`,
        });
      }
    }
  }

  // ---------------------------------------------------------- the sums ----
  // Only worth checking once the individual lines are sane; otherwise the
  // administrator is told the table does not add up AND that a line is
  // negative, and the first is merely a consequence of the second.
  const linesAreSane = problems.every((p) => !p.field.startsWith("lines."));

  if (linesAreSane && total > 0) {
    if (components.length > 0) {
      const sum = components.reduce((n, l) => n + toPaisa(l.amount), 0);
      if (sum !== total) {
        problems.push({
          field: "lines",
          code: "COMPONENTS_MISMATCH",
          message:
            `What the fee is made up of comes to ${format(fromPaisa(sum), input.currency)}, but the ` +
            `total says ${format(input.totalAmount, input.currency)}. ` +
            differenceHint(sum, total, input.currency),
        });
      }
    }

    if (instalments.length === 0) {
      problems.push({
        field: "lines",
        code: "NO_INSTALMENTS",
        message:
          "Add at least one instalment. Applicants are shown when each payment falls due, and " +
          "a fee with no schedule tells them only that they owe money.",
      });
    } else {
      const sum = instalments.reduce((n, l) => n + toPaisa(l.amount), 0);
      if (sum !== total) {
        problems.push({
          field: "lines",
          code: "INSTALMENTS_MISMATCH",
          message:
            `The instalments come to ${format(fromPaisa(sum), input.currency)}, but the total says ` +
            `${format(input.totalAmount, input.currency)}. ` +
            differenceHint(sum, total, input.currency),
        });
      }

      /*
       * THE FIRST INSTALMENT AND THE AMOUNT DUE ON APPLICATION MUST AGREE.
       *
       * These are two numbers for one thing: what the applicant transfers
       * before they submit the form. Left free to differ, the fee table says
       * "First instalment 25,000" and the payment step asks for 30,000, and
       * whichever the applicant believes, one of them makes their slip wrong.
       */
      const first = [...instalments].sort(byDue)[0];
      if (first && toPaisa(first.amount) !== dueNow) {
        problems.push({
          field: "dueAtApplication",
          code: "FIRST_INSTALMENT_MISMATCH",
          message:
            `The amount due on application is ${format(input.dueAtApplication, input.currency)}, but ` +
            `the first instalment ("${first.label}") is ${format(first.amount, input.currency)}. ` +
            "An applicant is shown both, so they must be the same number.",
        });
      }
    }
  }

  return problems;
}

/**
 * Which way the table is out, and by how much.
 *
 * "does not add up" sends somebody to re-add twelve numbers by hand. The
 * difference is almost always one line they forgot or one they typed twice,
 * and naming it is usually enough to find it on sight.
 */
function differenceHint(sum: number, total: number, currency: string): string {
  const diff = Math.abs(sum - total);
  return sum < total
    ? `It is ${format(fromPaisa(diff), currency)} short.`
    : `It is ${format(fromPaisa(diff), currency)} over.`;
}

/** Instalments in the order the applicant will pay them. */
export function byDue(a: FeeLineInput, b: FeeLineInput): number {
  const ad = a.dueAfterDays ?? 0;
  const bd = b.dueAfterDays ?? 0;
  if (ad !== bd) return ad - bd;
  return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
}

/** At most two decimals — see instalments.ts on why 1.005 cannot be trusted. */
export function hasWholePaisa(amount: number): boolean {
  return Math.abs(amount * 100 - Math.round(amount * 100)) < 1e-6;
}

/**
 * Money as the Institute writes it.
 *
 * Grouped, because 90000 and 900000 are indistinguishable at a glance and the
 * difference is somebody's year. No decimals when there are none to show: fees
 * here are whole rupees, and "Rs 90,000.00" reads like a machine wrote it.
 */
export function format(amount: number, currency = "PKR"): string {
  const whole = Number.isInteger(amount);
  const body = amount.toLocaleString("en-PK", {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  });
  return currency === "PKR" ? `Rs ${body}` : `${currency} ${body}`;
}

/**
 * When each instalment actually falls due, for one student.
 *
 * The structure stores offsets because one table serves every applicant; this
 * turns them into the dates that particular student will be chased for.
 */
export function dueDatesFrom(
  enrolledOn: Date,
  instalments: FeeLineInput[],
): Array<{ label: string; amount: number; dueDate: Date }> {
  return [...instalments].sort(byDue).map((l) => {
    const due = new Date(enrolledOn);
    // UTC arithmetic, so a plan made in Karachi does not shift by a day when
    // the server is somewhere else.
    due.setUTCDate(due.getUTCDate() + (l.dueAfterDays ?? 0));
    return { label: l.label, amount: l.amount, dueDate: due };
  });
}
