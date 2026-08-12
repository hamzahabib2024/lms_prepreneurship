/**
 * Domain enumerations — SRS §8.
 *
 * DB-008: enumerations are stored as constrained strings, never bare integers,
 * so that a database row is readable without consulting application code.
 */

/** Account state machine — Figure 4-3. */
export const USER_STATUS = [
  "INVITED",
  "ACTIVE",
  "LOCKED",
  "SUSPENDED",
  "WITHDRAWN",
  "ARCHIVED",
] as const;
export type UserStatus = (typeof USER_STATUS)[number];

export const GENDER = ["MALE", "FEMALE"] as const;
export type Gender = (typeof GENDER)[number];

/** Registration request states — Figure 12-2. */
export const REGISTRATION_STATUS = [
  "PENDING_REVIEW",
  "UNDER_REVIEW",
  "NEEDS_INFO",
  "APPROVED",
  "REJECTED",
  "WITHDRAWN",
] as const;
export type RegistrationStatus = (typeof REGISTRATION_STATUS)[number];

/** FR-REG-005. */
export const ACQUISITION_SOURCE = [
  "FACEBOOK",
  "INSTAGRAM",
  "WHATSAPP",
  "WEBSITE",
  "REFERRAL",
  "WALK_IN",
  "OTHER",
] as const;
export type AcquisitionSource = (typeof ACQUISITION_SOURCE)[number];

/** FR-REG-034 — rejection requires one of these. */
export const REJECTION_REASON = [
  "PAYMENT_NOT_RECEIVED",
  "AMOUNT_INSUFFICIENT",
  "SLIP_ILLEGIBLE",
  "DUPLICATE_APPLICATION",
  "INELIGIBLE",
  "SECTION_FULL",
  "OTHER",
] as const;
export type RejectionReason = (typeof REJECTION_REASON)[number];

export const PAYMENT_METHOD = ["BANK_TRANSFER", "CASH_DEPOSIT", "CHEQUE", "OTHER"] as const;
export type PaymentMethod = (typeof PAYMENT_METHOD)[number];

export const DOCUMENT_TYPE = [
  "PAYMENT_SLIP",
  "ID_DOCUMENT",
  "QUALIFICATION",
  "OTHER",
] as const;
export type DocumentType = (typeof DOCUMENT_TYPE)[number];

/** SEC-FIL-004 — every upload is scanned before it is persisted. */
export const SCAN_STATUS = ["PENDING", "CLEAN", "INFECTED", "FAILED"] as const;
export type ScanStatus = (typeof SCAN_STATUS)[number];

/** FR-CRS-007 — section attributes are configurable tags, not fixed columns. */
export const SHIFT = ["MORNING", "AFTERNOON", "EVENING", "WEEKEND"] as const;
export type Shift = (typeof SHIFT)[number];

export const GENDER_RESTRICTION = ["MALE", "FEMALE", "MIXED"] as const;
export type GenderRestriction = (typeof GENDER_RESTRICTION)[number];

export const DELIVERY_MODE = ["ONLINE", "HYBRID", "ON_CAMPUS"] as const;
export type DeliveryMode = (typeof DELIVERY_MODE)[number];

export const SECTION_STATUS = [
  "PLANNED",
  "ACTIVE",
  "CLOSED_FOR_ADMISSION",
  "ARCHIVED",
] as const;
export type SectionStatus = (typeof SECTION_STATUS)[number];

/** FR-ENR-002 — enrolment states. Figure 12-10. */
export const ENROLMENT_STATUS = [
  "ACTIVE",
  "SUSPENDED",
  "COMPLETED",
  "WITHDRAWN",
  "TRANSFERRED",
] as const;
export type EnrolmentStatus = (typeof ENROLMENT_STATUS)[number];

/** FR-CRS-021 — assignment roles. */
export const ASSIGNMENT_ROLE = ["PRIMARY", "SUPPORTING", "SUBSTITUTE"] as const;
export type AssignmentRole = (typeof ASSIGNMENT_ROLE)[number];

/** BR-CNT-01 — draft content is invisible to students everywhere. */
export const PUBLICATION_STATUS = [
  "DRAFT",
  "SCHEDULED",
  "PUBLISHED",
  "UNPUBLISHED",
] as const;
export type PublicationStatus = (typeof PUBLICATION_STATUS)[number];

/** ARC-045 — a catalogue entry whose storage object has gone missing. */
export const AVAILABILITY_STATUS = ["AVAILABLE", "MISSING", "CHECKING"] as const;
export type AvailabilityStatus = (typeof AVAILABILITY_STATUS)[number];

/**
 * What an applicant has already studied — FR-REG-003.
 *
 * A LIST RATHER THAN FREE TEXT, because this is the field the Institute counts.
 * "FSc", "F.Sc", "F.Sc.", "fsc pre-eng" and "Intermediate" are one answer typed
 * five ways, and a report grouping them is a report nobody can trust.
 *
 * DARS_E_NIZAMI AND HIFZ_E_QURAN ARE FIRST-CLASS, not folded into OTHER. A
 * madrasah graduate applying for a web development track is a normal applicant
 * in Pakistan, and a form that files them under "other" tells them what it
 * thinks of their education before they have finished applying. They are also
 * the two the Institute most needs to count honestly, because a programme that
 * works for them is a different claim from one that works for FSc leavers.
 *
 * The free-text `qualification` stays alongside for the detail — the subject,
 * the board, the year — which is where variation belongs.
 */
export const EDUCATION_LEVEL = [
  "MATRIC",
  "FSC",
  "BACHELORS",
  "DARS_E_NIZAMI",
  "HIFZ_E_QURAN",
  "OTHER",
] as const;
export type EducationLevel = (typeof EDUCATION_LEVEL)[number];

/** What a person calls it, in the order a form should offer them. */
export const EDUCATION_LEVEL_LABEL: Record<EducationLevel, string> = {
  MATRIC: "Matric",
  FSC: "FSc / Intermediate",
  BACHELORS: "Bachelor's degree",
  DARS_E_NIZAMI: "Dars-e-Nizami",
  HIFZ_E_QURAN: "Hifz-e-Quran",
  OTHER: "Something else",
};

/**
 * An academic session — a term, e.g. Spring 2026.
 *
 * NOT the same thing as SESSION_STATUS below, which is a single live class on
 * a single afternoon. Two unrelated concepts arrived at the same English word,
 * so both are spelled out here rather than left to whichever one a reader
 * happens to think of first.
 *
 * COMPLETED is terminal and does not mean deleted: fee charges and issued
 * registration numbers still hang off a finished term, so it stays readable
 * forever (BR-DAT-04).
 */
export const ACADEMIC_SESSION_STATUS = ["PLANNED", "ACTIVE", "COMPLETED", "CANCELLED"] as const;
export type AcademicSessionStatus = (typeof ACADEMIC_SESSION_STATUS)[number];

/** Live session states — Figure 12-3. Provider-agnostic (ARC-023). */
export const SESSION_STATUS = ["SCHEDULED", "LIVE", "ENDED", "CANCELLED"] as const;
export type SessionStatus = (typeof SESSION_STATUS)[number];

export const SESSION_TYPE = ["ONLINE", "OFFLINE"] as const;
export type SessionType = (typeof SESSION_TYPE)[number];

export const ATTENDANCE_POLICY = [
  "MANUAL",
  "SELF_CHECKIN",
  "PROVIDER_DERIVED",
  "HYBRID",
] as const;
export type AttendancePolicy = (typeof ATTENDANCE_POLICY)[number];

export const BINDING_STATUS = ["PENDING", "ACTIVE", "FAILED", "REVOKED"] as const;
export type BindingStatus = (typeof BINDING_STATUS)[number];

/** §5.11.1 — attendance states. */
export const ATTENDANCE_STATUS = [
  "PRESENT",
  "ABSENT",
  "LATE",
  "EXCUSED",
  "NOT_MARKED",
] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUS)[number];

/**
 * ARC-033: attendance records the SOURCE of the evidence, never the vendor.
 * Adding a new source later is additive and needs no schema change.
 */
export const MARKING_SOURCE = [
  "MANUAL",
  "SELF_CHECKIN",
  "PROVIDER_DERIVED",
  "AUTOMATED",
  "IMPORTED",
] as const;
export type MarkingSource = (typeof MARKING_SOURCE)[number];

/** FR-ASG-003 — late submission policy. */
export const LATE_POLICY = [
  "NOT_ACCEPTED",
  "FLAG_ONLY",
  "FIXED_DEDUCTION",
  "PER_DAY_PERCENT",
] as const;
export type LatePolicy = (typeof LATE_POLICY)[number];

export const SUBMISSION_TYPE = ["FILE", "TEXT", "BOTH"] as const;
export type SubmissionType = (typeof SUBMISSION_TYPE)[number];

export const RESUBMISSION_POLICY = [
  "NONE",
  "UNLIMITED_UNTIL_DUE",
  "LIMITED",
] as const;
export type ResubmissionPolicy = (typeof RESUBMISSION_POLICY)[number];

/** §5.10.1 — the eight supported question types. */
export const QUESTION_TYPE = [
  "MCQ_SINGLE",
  "MCQ_MULTI",
  "TRUE_FALSE",
  "SHORT_ANSWER",
  "ESSAY",
  "NUMERIC",
  "MATCHING",
  "FILL_BLANK",
] as const;
export type QuestionType = (typeof QUESTION_TYPE)[number];

export const DIFFICULTY = ["EASY", "MEDIUM", "HARD"] as const;
export type Difficulty = (typeof DIFFICULTY)[number];

/** FR-QIZ-017 — applied to incorrect answers only, never unanswered (BR-QIZ-06). */
export const NEGATIVE_MARKING = ["NONE", "FIXED", "PROPORTIONAL"] as const;
export type NegativeMarking = (typeof NEGATIVE_MARKING)[number];

export const ATTEMPT_SCORING = ["HIGHEST", "LATEST", "FIRST", "AVERAGE"] as const;
export type AttemptScoring = (typeof ATTEMPT_SCORING)[number];

export const RESULT_RELEASE_POLICY = [
  "IMMEDIATE",
  "AFTER_CLOSE",
  "AFTER_GRADING",
  "MANUAL",
] as const;
export type ResultReleasePolicy = (typeof RESULT_RELEASE_POLICY)[number];

export const ANSWER_REVIEW_POLICY = ["NEVER", "AFTER_RELEASE", "AFTER_CLOSE"] as const;
export type AnswerReviewPolicy = (typeof ANSWER_REVIEW_POLICY)[number];

/** Figure 12-5 — quiz attempt states. */
export const ATTEMPT_STATUS = [
  "IN_PROGRESS",
  "SUBMITTED",
  "AUTO_SUBMITTED",
  "GRADING",
  "GRADED",
  "ABANDONED",
] as const;
export type AttemptStatus = (typeof ATTEMPT_STATUS)[number];

export const QUIZ_PRESENTATION = ["ONE_PER_PAGE", "ALL_ON_PAGE"] as const;
export type QuizPresentation = (typeof QUIZ_PRESENTATION)[number];

/** FR-COM-006 — drives both visual treatment and notification routing. */
export const ANNOUNCEMENT_PRIORITY = ["NORMAL", "IMPORTANT", "URGENT"] as const;
export type AnnouncementPriority = (typeof ANNOUNCEMENT_PRIORITY)[number];

export const NOTIFICATION_CHANNEL = [
  "IN_APP",
  "EMAIL",
  "SMS",
  "WHATSAPP",
  "PUSH",
] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNEL)[number];

export const DELIVERY_OUTCOME = [
  "QUEUED",
  "SENT",
  "FAILED",
  "DEAD_LETTERED",
  "SUPPRESSED",
] as const;
export type DeliveryOutcome = (typeof DELIVERY_OUTCOME)[number];
