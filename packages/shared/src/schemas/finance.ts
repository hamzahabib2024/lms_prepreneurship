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
