/**
 * Academic structure and enrolment contracts — SRS §5.3 and §5.4.
 */

import { z } from "zod";
import {
  ACADEMIC_SESSION_STATUS,
  ASSIGNMENT_ROLE,
  DELIVERY_MODE,
  GENDER_RESTRICTION,
  SHIFT,
} from "../enums";

// ------------------------------------------------------------ programmes ---

/** Used in registration numbering (Appendix B), so the charset is constrained. */
const shortCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{2,10}$/, "Use 2–10 letters or digits, with no spaces or punctuation.");

export const programmeCreateSchema = z.object({
  name: z.string().trim().min(3).max(200),
  code: shortCode,
  description: z.string().trim().max(2000).optional(),
  durationWeeks: z.coerce.number().int().positive().max(520).optional(),
});
export type ProgrammeCreateInput = z.infer<typeof programmeCreateSchema>;

export const academicSessionCreateSchema = z
  .object({
    programmeId: z.string().uuid(),
    name: z.string().trim().min(3).max(100),
    code: shortCode, // SP26, FA26 — part of the number series key
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
  })
  .refine((v) => v.endDate > v.startDate, {
    path: ["endDate"],
    message: "The end date must be after the start date.",
  });

export type AcademicSessionCreateInput = z.infer<typeof academicSessionCreateSchema>;

/**
 * The programme is deliberately NOT changeable. A session's code is unique
 * within its programme and feeds the registration number series, so moving a
 * session between programmes would either collide with an existing code or
 * orphan numbers already issued under the old one.
 */
export const academicSessionUpdateSchema = z
  .object({
    name: z.string().trim().min(3).max(100).optional(),
    startDate: z.coerce.date().optional(),
    endDate: z.coerce.date().optional(),
    status: z.enum(ACADEMIC_SESSION_STATUS).optional(),
  })
  .refine((v) => !v.startDate || !v.endDate || v.endDate > v.startDate, {
    path: ["endDate"],
    message: "The end date must be after the start date.",
  });
export type AcademicSessionUpdateInput = z.infer<typeof academicSessionUpdateSchema>;

export const batchCreateSchema = z.object({
  academicSessionId: z.string().uuid(),
  name: z.string().trim().min(3).max(150),
  deliveryPattern: z.string().trim().min(2).max(50),
});
export type BatchCreateInput = z.infer<typeof batchCreateSchema>;

/** The session is fixed for the same reason a session's programme is. */
export const batchUpdateSchema = z.object({
  name: z.string().trim().min(3).max(150).optional(),
  deliveryPattern: z.string().trim().min(2).max(50).optional(),
});
export type BatchUpdateInput = z.infer<typeof batchUpdateSchema>;

// -------------------------------------------------------------- sections ---

export const sectionCreateSchema = z.object({
  batchId: z.string().uuid(),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{3,40}$/, "Use letters, digits and hyphens only."),
  name: z.string().trim().min(3).max(150),
  capacity: z.coerce.number().int().positive().max(500),
  // FR-CRS-009 — absolute once students are admitted. No override exists.
  genderRestriction: z.enum(GENDER_RESTRICTION).default("MIXED"),
  shift: z.enum(SHIFT),
  deliveryMode: z.enum(DELIVERY_MODE).default("ONLINE"),
  /** FR-CRS-007 — extensible tags rather than fixed columns. */
  attributes: z.record(z.string(), z.unknown()).optional(),
  whatsappChannelUrl: z.string().url().max(500).optional(),
  whatsappGroupUrl: z.string().url().max(500).optional(),
});
export type SectionCreateInput = z.infer<typeof sectionCreateSchema>;

export const sectionUpdateSchema = sectionCreateSchema
  .partial()
  .omit({ batchId: true })
  .extend({
    status: z.enum(["PLANNED", "ACTIVE", "CLOSED_FOR_ADMISSION", "ARCHIVED"]).optional(),
    /** ARC-027 — per-section provider, so migration can proceed gradually. */
    liveProviderKey: z.string().trim().max(50).nullable().optional(),
  });
export type SectionUpdateInput = z.infer<typeof sectionUpdateSchema>;

// -------------------------------------------------------------- subjects ---

export const subjectCreateSchema = z.object({
  name: z.string().trim().min(2).max(200),
  code: shortCode,
  description: z.string().trim().max(2000).optional(),
  credits: z.coerce.number().int().positive().max(20).optional(),
});
export type SubjectCreateInput = z.infer<typeof subjectCreateSchema>;

/** FR-CRS-016 — offering a subject to a section. */
export const offeringCreateSchema = z.object({
  subjectId: z.string().uuid(),
  isCompulsory: z.boolean().default(true),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
});
export type OfferingCreateInput = z.infer<typeof offeringCreateSchema>;

// ---------------------------------------------------------- assignments ----

/**
 * FR-CRS-021. The assignment is the SOLE source of ASSIGNED scope
 * (BR-ACC-04), so it is deliberately explicit: a teacher is bound to a
 * subject WITHIN a section, never to a subject globally.
 */
export const assignmentCreateSchema = z
  .object({
    teacherId: z.string().uuid(),
    sectionSubjectId: z.string().uuid(),
    assignmentRole: z.enum(ASSIGNMENT_ROLE).default("PRIMARY"),
    startDate: z.coerce.date(),
    /** FR-CRS-025 — an end date withdraws scope automatically on expiry. */
    endDate: z.coerce.date().optional(),
  })
  .refine((v) => !v.endDate || v.endDate > v.startDate, {
    path: ["endDate"],
    message: "The end date must be after the start date.",
  });
export type AssignmentCreateInput = z.infer<typeof assignmentCreateSchema>;

export const assignmentEndSchema = z.object({
  endDate: z.coerce.date().optional(),
  reason: z.string().trim().max(500).optional(),
});

// ------------------------------------------------------------ enrolment ----

export const enrolmentCreateSchema = z.object({
  studentId: z.string().uuid(),
  sectionSubjectId: z.string().uuid(),
});

/**
 * FR-ENR-005. The System requires an EXPLICIT decision on history rather than
 * choosing for the administrator, because both answers are legitimate and the
 * wrong one is hard to undo: mid-session transfers usually retain history
 * against the prior section so the previous teacher's records stay intact.
 */
export const transferSchema = z.object({
  toSectionId: z.string().uuid(),
  carryHistory: z.boolean(),
  reason: z.string().trim().min(3, "Record why the student is being moved.").max(500),
  capacityOverride: z.boolean().default(false),
});
export type TransferInput = z.infer<typeof transferSchema>;

/** FR-ENR-008 — suspension requires a reason; the student is told why. */
export const suspendSchema = z.object({
  reason: z.string().trim().min(3, "Record why this account is being suspended.").max(500),
});

export const withdrawSchema = z.object({
  reason: z.string().trim().min(3, "Record why this student is withdrawing.").max(500),
});

export const reinstateSchema = z.object({
  sectionId: z.string().uuid().optional(),
  reason: z.string().trim().max(500).optional(),
});
