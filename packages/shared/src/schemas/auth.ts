/**
 * Authentication contracts — SRS §9.3, Figure 9-2.
 *
 * These Zod schemas are the single definition of the API contract: the server
 * validates with them (SEC-VAL-001) and the web client builds its forms from
 * them. §3.11 requires this so the contract cannot drift between tiers.
 */

import { z } from "zod";
import { ROLES } from "../rbac";

/**
 * SEC-AUT-007 / R-07 (NIST SP 800-63B): enforce length, check against known
 * breached passwords, and do NOT impose composition rules that push users
 * toward predictable substitutions. Per-role minimums are §4.6; 8 is the
 * floor (Student).
 */
export const passwordSchema = z
  .string()
  .min(8, "Use at least 8 characters.")
  .max(128, "Use no more than 128 characters.");

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
  deviceLabel: z.string().max(200).optional(),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});
export type RefreshInput = z.infer<typeof refreshSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password."),
    newPassword: passwordSchema,
  })
  .refine((v) => v.currentPassword !== v.newPassword, {
    path: ["newPassword"],
    message: "Choose a password different from your current one.",
  });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const forgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: passwordSchema,
});

/** SEC-AUZ-011 — re-authentication immediately before a privileged operation. */
export const stepUpSchema = z.object({
  password: z.string().min(1),
});

export const mfaVerifySchema = z.object({
  mfaToken: z.string().min(1),
  code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code.").or(z.string().min(8)),
});

// ------------------------------------------------------------- responses ---

export const authUserSchema = z.object({
  id: z.string().uuid(),
  fullName: z.string(),
  email: z.string().email(),
  roles: z.array(z.enum(ROLES)),
  photoUrl: z.string().nullable().optional(),
  student: z
    .object({
      registrationNo: z.string(),
      rollNo: z.number().int().nullable(),
      sectionId: z.string().uuid().nullable(),
      sectionName: z.string().nullable(),
    })
    .nullable()
    .optional(),
});
export type AuthUser = z.infer<typeof authUserSchema>;

export const loginResponseSchema = z.union([
  z.object({
    mfaRequired: z.literal(true),
    mfaToken: z.string(),
    methods: z.array(z.string()),
  }),
  z.object({
    accessToken: z.string(),
    tokenType: z.literal("Bearer"),
    expiresIn: z.number().int(),
    refreshToken: z.string(),
    refreshExpiresIn: z.number().int(),
    mustChangePassword: z.boolean(),
    user: authUserSchema,
  }),
]);
export type LoginResponse = z.infer<typeof loginResponseSchema>;

/** Claims carried in the access token (RFC 7519). */
export interface AccessTokenClaims {
  sub: string;
  roles: string[];
  subPerms: string[];
  /** Epoch seconds of the last step-up, if any (SEC-AUZ-011). */
  sua?: number;
  sid: string;
  iss: string;
  aud: string;
  iat: number;
  exp: number;
}
