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
  /** A MediaAsset id from POST /course-media. Null clears the picture. */
  thumbnailAssetId: z.string().uuid().nullish(),
});
export type ProgrammeCreateInput = z.infer<typeof programmeCreateSchema>;

/**
 * FR-CRS-004 — editing a programme after it exists.
 *
 * THE CODE IS NOT HERE, and its absence is deliberate. A programme code is
 * baked into every registration number ever issued against it (Appendix B):
 * changing GD to GRD would leave four hundred students holding numbers that
 * refer to a programme code no longer in use, and no migration can fix that
 * because the numbers are printed on certificates. Everything else about a
 * programme is a label and may be corrected freely.
 */
export const programmeUpdateSchema = z.object({
  name: z.string().trim().min(3).max(200).optional(),
  description: z.string().trim().max(2000).nullish(),
  durationWeeks: z.coerce.number().int().positive().max(520).nullish(),
  thumbnailAssetId: z.string().uuid().nullish(),
  isActive: z.boolean().optional(),
});
export type ProgrammeUpdateInput = z.infer<typeof programmeUpdateSchema>;

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

/**
 * ONE CALL THAT MAKES A BATCH — the shape the interface actually needs.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS BESIDE `sectionCreateSchema` RATHER THAN REPLACING IT.
 *
 * The System's real hierarchy is five deep:
 *
 *   Programme → AcademicSession → Batch → Section → Subject
 *
 * An administrator's is three:
 *
 *   Subjects → Course → Batches      "a female batch and a male batch"
 *
 * What they call a batch is a SECTION — that is where the gender restriction,
 * the capacity and the shift live. What the System calls a Batch is a fourth
 * layer between the term and the section, and in every piece of real data this
 * Institute has, each term contains exactly ONE of them. It is a grouping
 * nobody has ever needed to think about, and making somebody invent a term, a
 * delivery group and a section — in that order, on three different screens,
 * each refusing to start until the one above exists — is why creating a class
 * has needed somebody who already knew the model.
 *
 * So this takes the three things an administrator knows and fills in the two
 * they do not. The layers are still there and still editable under Structure;
 * they simply stop being a prerequisite for the common case.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const quickBatchCreateSchema = z.object({
  programmeId: z.string().uuid(),
  /**
   * The term this runs in. Omitted, the System uses the programme's current
   * term, or creates one — see the service. An administrator adding "Batch 2"
   * in March is not making a statement about academic terms.
   */
  academicSessionId: z.string().uuid().optional(),

  /** "Morning A (Female)", "Batch 2", "Evening — Male". Their words. */
  name: z.string().trim().min(2, "Give the batch a name students will recognise.").max(150),
  /**
   * Left out, the System derives one from the programme and the name. A code
   * is a filing detail; asking for it up front is asking somebody to invent an
   * identifier before they have decided what the thing is.
   */
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{3,40}$/, "Use letters, digits and hyphens only.")
    .optional(),

  capacity: z.coerce
    .number()
    .int()
    .positive("A batch needs at least one seat.")
    .max(500, "500 seats is the most a single batch may hold."),
  genderRestriction: z.enum(GENDER_RESTRICTION).default("MIXED"),
  shift: z.enum(SHIFT),
  deliveryMode: z.enum(DELIVERY_MODE).default("ONLINE"),

  /**
   * The subjects taught to this batch.
   *
   * OFFERED AT CREATION rather than afterwards, because a batch with no
   * subjects has no register, no attendance and nothing on a course page — it
   * looks created and does nothing, which is the state an inexperienced
   * administrator leaves it in when the two steps live on different screens.
   */
  subjectIds: z.array(z.string().uuid()).default([]),

  /**
   * FR-REG-044 — the links a student is given the moment they are admitted.
   *
   * These are shown on the approval screen and emailed, and until now there was
   * NO WAY TO SET ONE from the interface at all: the column existed, the API
   * accepted it, and no form offered it. Every batch created through the System
   * therefore admitted students and told them nothing about where the class
   * actually talks to each other.
   */
  whatsappChannelUrl: z.string().trim().url().max(500).optional().or(z.literal("")),
  whatsappGroupUrl: z.string().trim().url().max(500).optional().or(z.literal("")),

  /**
   * FR-CRS-021 — who teaches it, decided while the batch is being made.
   *
   * TWENTY OF TWENTY-FOUR subject-batches had no teacher, because assigning one
   * needed an endpoint no screen called. A batch with no teacher has nobody who
   * can mark its register or its work, and the dashboard could only report the
   * number — never fix it. One teacher for the whole batch is the ordinary
   * case; a subject taught by somebody else is changed afterwards.
   */
  teacherId: z.string().uuid().optional(),
});
export type QuickBatchCreateInput = z.infer<typeof quickBatchCreateSchema>;

// -------------------------------------------------------------- subjects ---

export const subjectCreateSchema = z.object({
  name: z.string().trim().min(2).max(200),
  code: shortCode,
  description: z.string().trim().max(2000).optional(),
  credits: z.coerce.number().int().positive().max(20).optional(),
  /** A MediaAsset id from POST /course-media. */
  thumbnailAssetId: z.string().uuid().nullish(),
  /** An EXTERNAL picture instead, pasted as a URL. The uploaded one wins. */
  thumbnailUrl: z.string().trim().url().max(500).nullish(),
});
export type SubjectCreateInput = z.infer<typeof subjectCreateSchema>;

/** FR-CRS-015 — editing a subject. The code is immutable for the same reason
 *  a programme's is: it appears on transcripts already issued. */
export const subjectUpdateSchema = z.object({
  name: z.string().trim().min(2).max(200).optional(),
  description: z.string().trim().max(2000).nullish(),
  credits: z.coerce.number().int().positive().max(20).nullish(),
  thumbnailAssetId: z.string().uuid().nullish(),
  thumbnailUrl: z.string().trim().url().max(500).nullish(),
  isActive: z.boolean().optional(),
});
export type SubjectUpdateInput = z.infer<typeof subjectUpdateSchema>;

/** FR-CRS-016 — offering a subject to a section. */
export const offeringCreateSchema = z.object({
  subjectId: z.string().uuid(),
  isCompulsory: z.boolean().default(true),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
});
export type OfferingCreateInput = z.infer<typeof offeringCreateSchema>;

// ------------------------------------------------------- internal notes ----

/**
 * FR-REG-046. The section-subject is required, not optional: a teacher's
 * authority is a subject WITHIN a section (BR-ACC-04), so a note that did not
 * record which class it came from could not later be shown to the right people.
 */
export const noteCreateSchema = z.object({
  sectionSubjectId: z.string().uuid(),
  body: z.string().trim().min(3).max(4000),
});
export type NoteCreateInput = z.infer<typeof noteCreateSchema>;

export const noteUpdateSchema = z.object({
  body: z.string().trim().min(3).max(4000),
});
export type NoteUpdateInput = z.infer<typeof noteUpdateSchema>;

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
