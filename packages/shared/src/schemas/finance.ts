/**
 * Fee structure contracts — SRS §5.16, FR-PAY-033.
 *
 * These numbers end up on a public page telling somebody how much money to
 * transfer, so the validation here is deliberately strict about the two things
 * that produce a wrong figure rather than a rejected form: more decimal places
 * than a bank slip can carry, and an amount that is a string only because
 * somebody typed a comma into it.
 */

import { z } from "zod";

/**
 * Money, as a form sends it.
 *
 * `z.coerce.number()` alone accepts "" as 0, which is how an empty amount box
 * becomes a free instalment nobody notices. Rejecting the empty string first is
 * the difference between "enter an amount" and a silently wrong fee table.
 */
const money = z.preprocess(
  (v) => (typeof v === "string" ? v.trim().replace(/,/g, "") : v),
  z
    .number({ invalid_type_error: "Enter an amount in numbers." })
    .nonnegative("An amount cannot be negative.")
    .max(99_999_999, "That is larger than this System will hold.")
    // At most two decimals. instalments.ts explains why anything finer cannot
    // be trusted: 1.005 is stored as 1.00499999999999989 and no amount of
    // cleverness downstream recovers the intent.
    .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, {
      message: "Use at most two decimal places.",
    }),
);

export const FEE_LINE_KIND = ["COMPONENT", "INSTALMENT"] as const;
export type FeeLineKind = (typeof FEE_LINE_KIND)[number];

export const feeLineSchema = z.object({
  kind: z.enum(FEE_LINE_KIND),
  label: z.string().trim().min(1, "Every line needs a label.").max(120),
  amount: money,
  /**
   * INSTALMENT only: days after enrolment. An OFFSET rather than a date,
   * because one structure serves every applicant and each enrols on a
   * different day.
   */
  dueAfterDays: z.coerce.number().int().min(0).max(3650).optional(),
  sortOrder: z.coerce.number().int().min(0).max(999).optional(),
});
export type FeeLineDto = z.infer<typeof feeLineSchema>;

export const feeStructureUpsertSchema = z.object({
  programmeId: z.string().uuid(),
  /** Null or absent = the programme's standing fee, used by any term without
   *  one of its own. */
  academicSessionId: z.string().uuid().nullish(),
  name: z.string().trim().min(3, "Give this fee structure a name.").max(150),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .length(3, "Use a three-letter currency code, such as PKR.")
    .default("PKR"),
  totalAmount: money,
  dueAtApplication: money,
  notes: z.string().trim().max(4000).nullish(),
  lines: z.array(feeLineSchema).max(40, "A fee structure may have at most 40 lines."),
});
export type FeeStructureUpsertInput = z.infer<typeof feeStructureUpsertSchema>;

/* ======================================================================== *
 *  PAYMENT SUBMISSIONS — a student saying they have paid.
 *
 *  THE ONE RULE THESE SCHEMAS EXIST TO HOLD: nothing a student sends here is
 *  money. `amount` is a CLAIM, checked only for being a payable figure — the
 *  office decides what actually arrived by reading the slip. So the validation
 *  is about what a bank can carry and what a reviewer can act on, and never
 *  about what the ledger says is owed. A student who overpays, prepays or
 *  misreads their balance must still be able to tell the Institute what they
 *  sent; being refused by a form is how that money goes unrecorded.
 * ======================================================================== */

/**
 * How the money moved.
 *
 * EasyPaisa and JazzCash are named because that is how most of these payments
 * are actually made. Folding them into "Other" meant a reviewer could not tell
 * a wallet transfer from a counter deposit without opening the image.
 */
export const PAYMENT_METHODS = [
  "BANK_TRANSFER",
  "EASYPAISA",
  "JAZZCASH",
  "CASH_DEPOSIT",
  "CHEQUE",
  "OTHER",
] as const;
export type PaymentMethodValue = (typeof PAYMENT_METHODS)[number];

/** What each is called on screen and on a receipt. One place, so they agree. */
export const PAYMENT_METHOD_LABELS: Readonly<Record<PaymentMethodValue, string>> = {
  BANK_TRANSFER: "Bank transfer",
  EASYPAISA: "EasyPaisa",
  JAZZCASH: "JazzCash",
  CASH_DEPOSIT: "Cash deposit at the bank",
  CHEQUE: "Cheque",
  OTHER: "Other",
};

/**
 * A payment a student is claiming.
 *
 * `amount` uses the same `money` preprocessor as a fee line, plus a floor:
 * zero is not a payment, and a form that accepts one produces a submission a
 * reviewer has to open in order to reject.
 */
export const paymentSubmissionSchema = z.object({
  amount: z.preprocess(
    (v) => (typeof v === "string" ? v.trim().replace(/,/g, "") : v),
    z
      .number({ invalid_type_error: "Enter the amount you paid, in numbers." })
      .positive("Enter the amount you paid.")
      .max(99_999_999, "That is larger than this System will hold.")
      .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, {
        message: "Use at most two decimal places.",
      }),
  ),
  method: z.enum(PAYMENT_METHODS, {
    errorMap: () => ({ message: "Choose how you paid." }),
  }),
  /**
   * A DATE, NOT A TIMESTAMP, and never in the future.
   *
   * A future date is always a mistake — usually a mistyped year — and it
   * produces a receipt dated next January for money received today, which
   * lands in the wrong year's books and carries the wrong receipt series.
   */
  paymentDate: z.coerce
    .date({ invalid_type_error: "Enter the date you made the payment." })
    .refine((d) => d.getTime() <= Date.now() + 86_400_000, {
      message: "That date is in the future. Enter the day you actually paid.",
    }),
  /**
   * The transaction number. OPTIONAL, and that is deliberate: a cash deposit
   * slip may carry nothing a student can type, and refusing the submission
   * would send them back to WhatsApp — which is the state this replaces.
   */
  bankReference: z.string().trim().max(100).optional(),
  note: z.string().trim().max(1000).optional(),
  /**
   * The proof. AT LEAST ONE, because a claim with no evidence cannot be
   * verified and a reviewer opening one has nothing to decide with. Five is
   * the same ceiling an application's slips have.
   */
  documentIds: z
    .array(z.string().uuid())
    .min(1, "Attach a photo or PDF of your payment receipt.")
    .max(5, "Attach at most five files."),
});
export type PaymentSubmissionInput = z.infer<typeof paymentSubmissionSchema>;

/**
 * Verifying one.
 *
 * `verifiedAmount` is OPTIONAL and defaults to the claim. The common case is
 * that the slip says what the student said it does, and making the reviewer
 * retype the figure every time is how a digit gets dropped on the busy day.
 * When it differs, the difference is the whole point of the field.
 */
export const paymentVerifySchema = z.object({
  verifiedAmount: z
    .preprocess(
      (v) => (v === "" || v === null ? undefined : typeof v === "string" ? Number(v.replace(/,/g, "")) : v),
      z
        .number()
        .positive("A verified payment must be for more than zero.")
        .max(99_999_999)
        .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, {
          message: "Use at most two decimal places.",
        }),
    )
    .optional(),
  /**
   * Required when the verified amount differs from the claim — enforced in the
   * service, where both numbers are known. FR-REG-028 asks the same of an
   * admission, and for the same reason: a figure changed without a note is a
   * figure nobody can explain to the student who queries it.
   */
  note: z.string().trim().max(1000).optional(),
});
export type PaymentVerifyInput = z.infer<typeof paymentVerifySchema>;

/**
 * Rejecting one.
 *
 * THE REASON IS MANDATORY AND THE STUDENT READS IT. "Rejected" on its own is
 * an instruction to telephone the office, which is exactly the cost this
 * feature exists to remove. Ten characters is the same floor a fee waiver has.
 */
export const paymentRejectSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(10, "Say why, in a sentence the student can act on. They will read this.")
    .max(1000),
});
export type PaymentRejectInput = z.infer<typeof paymentRejectSchema>;
