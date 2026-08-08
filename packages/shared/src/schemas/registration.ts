/**
 * Admission contracts — SRS §5.1 and §9.4.
 */

import { z } from "zod";
import { ACQUISITION_SOURCE, GENDER, PAYMENT_METHOD, REJECTION_REASON } from "../enums";

/** Pakistani CNIC: 13 digits, optionally hyphenated 5-7-1. */
export const cnicSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s-]/g, ""))
  .pipe(z.string().regex(/^\d{13}$/, "Enter the 13-digit CNIC number."));

/** Stored E.164. Accepts common local formats: 03001234567, +923001234567. */
export const phoneSchema = z
  .string()
  .trim()
  .transform((v) => {
    const digits = v.replace(/[\s()-]/g, "");
    if (digits.startsWith("+")) return digits;
    if (digits.startsWith("00")) return `+${digits.slice(2)}`;
    if (digits.startsWith("0")) return `+92${digits.slice(1)}`;
    return `+${digits}`;
  })
  .pipe(z.string().regex(/^\+\d{10,15}$/, "Enter a valid mobile number."));

/** FR-REG-003 — the public application form. */
export const registrationSubmitSchema = z
  .object({
    fullName: z.string().trim().min(2, "Enter your full name.").max(200),
    fatherName: z.string().trim().min(2, "Enter your father's or guardian's name.").max(200),
    dateOfBirth: z.coerce.date().refine(
      (d) => {
        const age = (Date.now() - d.getTime()) / (365.25 * 24 * 3600 * 1000);
        return age >= 10 && age <= 100;
      },
      { message: "Enter a valid date of birth." },
    ),
    gender: z.enum(GENDER),
    nationalId: cnicSchema,
    phone: phoneSchema,
    phoneIsWhatsapp: z.boolean().default(true),
    altPhone: phoneSchema.optional(),
    email: z.string().trim().toLowerCase().email("Enter a valid email address."),
    address: z.string().trim().min(5, "Enter your address.").max(500),
    city: z.string().trim().min(2).max(100),
    qualification: z.string().trim().min(2).max(120),
    occupation: z.string().trim().max(120).optional(),

    desiredProgrammeId: z.string().uuid(),
    desiredSectionId: z.string().uuid(),
    desiredSubjectIds: z.array(z.string().uuid()).optional(),

    acquisitionSource: z.enum(ACQUISITION_SOURCE),
    acquisitionDetail: z.string().trim().max(255).optional(),

    claimedAmount: z.coerce.number().positive("Enter the amount you paid."),
    claimedPaymentDate: z.coerce.date(),
    claimedBankRef: z.string().trim().max(100).optional(),

    /** SEC-PRV-003 — the notice version and timestamp are stored. */
    consentVersion: z.string().min(1),
    consentAccepted: z.literal(true, {
      errorMap: () => ({ message: "You must accept the data collection notice." }),
    }),

    /** Uploaded separately, then referenced here (FR-REG-008: 1–5 slips). */
    documentIds: z.array(z.string().uuid()).min(1, "Attach at least one payment slip.").max(5),
  })
  // FR-REG-005: Referral and Other require a detail.
  .refine((v) => !["REFERRAL", "OTHER"].includes(v.acquisitionSource) || !!v.acquisitionDetail, {
    path: ["acquisitionDetail"],
    message: "Please tell us who referred you, or give more detail.",
  });
export type RegistrationSubmitInput = z.infer<typeof registrationSubmitSchema>;

/**
 * FR-REG-027/028 — the reviewer's verified values. These, not the applicant's
 * claim, are the System's authoritative figures (BR-REG-10).
 */
export const registrationApproveSchema = z
  .object({
    payment: z.object({
      verifiedAmount: z.coerce.number().positive(),
      currency: z.string().length(3).default("PKR"),
      paymentDate: z.coerce.date(),
      method: z.enum(PAYMENT_METHOD),
      bankReference: z.string().trim().max(100).optional(),
      varianceReason: z.string().trim().max(500).optional(),
    }),
    sectionId: z.string().uuid(),
    /** FR-REG-031 — must be explicitly true to exceed section capacity. */
    capacityOverride: z.boolean().default(false),
    note: z.string().trim().max(1000).optional(),
  })
  .strict();
export type RegistrationApproveInput = z.infer<typeof registrationApproveSchema>;

/** FR-REG-034 — rejection requires a reason code. */
export const registrationRejectSchema = z.object({
  reasonCode: z.enum(REJECTION_REASON),
  note: z.string().trim().max(1000).optional(),
});
export type RegistrationRejectInput = z.infer<typeof registrationRejectSchema>;

/** FR-REG-035 — ask for more information without discarding the application. */
export const registrationRequestInfoSchema = z.object({
  message: z.string().trim().min(5, "Tell the applicant what is needed.").max(1000),
});
