/**
 * Role-Based Access Control — the model defined in SRS §4.
 *
 * §4.1: every authorisation decision is the intersection of three independent
 * dimensions, ALL of which must pass:
 *
 *     ACCESS = ROLE  ∩  ACTION  ∩  SCOPE
 *
 * This file holds the ROLE × ACTION half as data (FR-RBAC-007). The SCOPE half
 * is enforced at the data-access layer by the single Prisma extension required
 * by ARC-051 — see apps/api/src/prisma/scope.extension.ts.
 *
 * Keeping the two halves in separate places is deliberate. A role check that
 * passes tells you the user may perform this KIND of operation; it says nothing
 * about WHICH records. Conflating them is how systems end up letting a teacher
 * read another section's students.
 */

// ---------------------------------------------------------------- roles ----

/**
 * `partner_admin` IS DELIBERATELY A ROLE OF ITS OWN.
 *
 * An institute that sends us students needs to watch how they are doing. The
 * tempting shortcut is an Admin with a narrower scope — and it is the wrong
 * answer, because `admin` holds FULL on very nearly every resource in the
 * matrix below. One mistake in one scope predicate would then hand an outside
 * organisation the whole Institute: every student, every fee, every audit
 * entry.
 *
 * A NEW ROLE STARTS WITH NOTHING. `resolvePermission` begins at scope NONE and
 * a role absent from a resource's policy contributes nothing at all, so this
 * role reaches only what is written down for it — a short list, all of it
 * `read`. The blast radius of a mistake is one resource rather than the System.
 */
export const ROLES = ["super_admin", "admin", "teacher", "student", "partner_admin"] as const;
export type Role = (typeof ROLES)[number];

/**
 * Admin sub-permissions (§4.2.2). Granted individually by a Super Admin; each
 * grant is a privileged change and is audited (SEC-LOG-009).
 */
export const SUB_PERMISSIONS = [
  "admin_manager", // manage other Admin accounts
  "financial_reporter", // revenue reports and financial export
  "bulk_operator", // bulk import and bulk enrolment change
  "certificate_issuer", // issue and revoke certificates
] as const;
export type SubPermission = (typeof SUB_PERMISSIONS)[number];

// --------------------------------------------------------------- actions ---

/** §4.1.2. Export is separate from Read: bulk extraction is a distinct
 *  privacy risk (SEC-PRV-007). Configure is separate from Full. */
export const ACTIONS = [
  "create",
  "read",
  "update",
  "delete",
  "approve",
  "export",
  "configure",
] as const;
export type Action = (typeof ACTIONS)[number];

/** Every action except `configure`. §4.1.2: "F" does not imply "G". */
const FULL: readonly Action[] = ["create", "read", "update", "delete", "approve", "export"];

// ---------------------------------------------------------------- scopes ---

/**
 * §4.1.1. These definitions are binding and each is individually testable.
 *
 *  ALL       every record, no predicate
 *  SECTION   records in sections the actor administers or is assigned to
 *  ASSIGNED  records in a subject-WITHIN-a-section the actor actively teaches
 *  ENROLLED  records in a subject the actor holds an active enrolment in
 *  OWN       records about, or authored by, the actor
 *  NONE      denied under all conditions
 */
/**
 * PARTNER — the students one outside institute sent us, and nothing else.
 *
 * Resolved from `User.partnerInstituteId`, which is set only on partner staff.
 * A partner_admin whose column is null reaches NOTHING: the predicate returns
 * DENY_ALL rather than falling through to something broader, because the
 * failure direction that matters here is "sees nothing" and never "sees
 * everybody".
 */
export const SCOPES = ["ALL", "SECTION", "ASSIGNED", "ENROLLED", "OWN", "PARTNER", "NONE"] as const;
export type Scope = (typeof SCOPES)[number];

// ------------------------------------------------------------- resources ---

/**
 * Resources correspond to the rows of the §4.5 matrix. Names map to domain
 * concepts, not to database tables, because one resource may span several
 * tables (`registration` covers requests and their documents).
 */
export const RESOURCES = [
  // identity and access — §4.5.1
  "super_admin_account",
  "admin_account",
  "teacher_account",
  "student_account",
  "user_directory",
  "own_profile",
  "own_password",
  "own_session",
  "other_user_session",
  "other_user_password",
  "role_assignment",
  "account_state",
  "impersonation",
  // admission — §4.5.2
  "registration",
  /** The administrative review queue. Distinct from `registration`, which a
   *  student holds over their OWN application. */
  "registration_queue",
  "payment_slip",
  "payment",
  /**
   * A STUDENT SAYING THEY HAVE PAID. Deliberately not `payment`.
   *
   * `payment` is money the Institute has verified it holds, and §4.5 puts the
   * whole resource behind step-up — reading included. A student must be able
   * to CREATE a claim and watch it being reviewed, and neither of those is an
   * act on the Institute's money: nothing a student does here reaches the
   * ledger. Granting them `payment:create` instead would have handed them the
   * one verb that means "this money has arrived".
   *
   * The office's half — verifying and rejecting — keeps the step-up that
   * `payment` has, because verifying IS the act that moves money into the
   * ledger.
   */
  "payment_submission",
  /**
   * THE SENDING INSTITUTE ITSELF — its name, its contacts, its billing mode,
   * and which of our students belong to it.
   *
   * Creating one is a Super Admin act because it opens a door: from the moment
   * a partner exists, somebody outside this Institute can be given an account
   * that reads student records. That is the kind of change §4.5 reserves for
   * the person who also holds the restore key.
   *
   * A partner reads their OWN entry and no other. They must not learn that any
   * other partner exists — a customer list is a competitor list.
   */
  "partner_institute",
  /**
   * WHAT A PARTNER OWES US, when they are the payer.
   *
   * Held apart from `payment` deliberately. `payment` is a STUDENT's money and
   * §4.5 puts the whole resource behind step-up; an invoice is a business
   * document addressed to an organisation, and the partner it belongs to has
   * to be able to read it without holding any grant over a student's ledger.
   */
  "partner_invoice",
  /** A course's PUBLISHED PRICE — what an applicant is quoted before they pay.
   *  Separate from `payment`, which is money that has actually moved. Setting
   *  the price and recording a receipt are different authorities: the first is
   *  a decision about the Institute, the second is bookkeeping. */
  "fee_structure",
  "registration_number_series",
  // academic — §4.5.3
  "programme",
  "academic_session",
  "batch",
  "section",
  "subject",
  /** A course thumbnail — the one file in the System the public may read
   *  without an account. Held apart from `lesson_resource` for exactly that
   *  reason: everything there is deliberately not public. */
  "course_media",
  "signatory",
  "section_subject",
  "teacher_assignment",
  "enrolment",
  "timetable",
  // content — §4.5.4
  "module",
  "lesson",
  "content_publication",
  "recorded_lecture",
  /**
   * THE RAW STORAGE TREE — every folder the Institute keeps recordings in, by
   * name and by id.
   *
   * Held apart from `recorded_lecture` because the audiences differ, which is
   * the recurring defect in this codebase: a teacher holds
   * `recorded_lecture:create` at ASSIGNED scope so they can catalogue a
   * recording for their own class, and that is right. It does NOT follow that
   * they should be handed the identifier of every OTHER class's folder — with
   * one, a teacher can point their own class at another cohort's recordings,
   * or simply read a folder they were never given.
   *
   * A folder id is close to a bearer token for that folder's contents. Office
   * only.
   */
  "lecture_storage_index",
  "lecture_playback",
  "lesson_resource",
  "watch_progress",
  // live — §4.5.5
  "live_session",
  "join_route",
  "provider_binding",
  "participation_evidence",
  // assessment — §4.5.6 / §4.5.7
  "assignment",
  "rubric",
  "submission",
  "submission_roster",
  /**
   * WHAT THE TEACHER SAID ABOUT THE WORK, and what the student said back.
   *
   * Deliberately not `grade`. A mark is a judgement the Institute stands
   * behind, released to a whole cohort at once and revisable only with a
   * recorded reason; a comment is a conversation about a piece of work, and
   * tying the two together is what stopped a teacher saying "this is the wrong
   * file type, send a PDF" without first inventing a score. Nothing under this
   * resource carries marks or affects one.
   *
   * A STUDENT MAY CREATE, and that is the point of it: feedback nobody can
   * answer becomes a message to the teacher's personal number, which is where
   * the System stops being the record. What a teacher wants kept private is
   * `internal_note`, which has no student key and never will.
   */
  "submission_comment",
  "grade",
  "internal_note",
  "quiz",
  "question_bank",
  "question",
  "quiz_attempt",
  "quiz_answer_grade",
  "quiz_answer_key",
  // attendance — §4.5.8
  /** A student's own attendance record. Read-only for them. */
  "attendance",
  /** The class register: every enrolled student's row, and bulk marking.
   *  Separate from `attendance` because marking a WHOLE CLASS is a different
   *  authority from reading your own row. */
  "attendance_register",
  /** FR-ATT-008 — a student confirming their own presence, nothing more. */
  "attendance_self_checkin",
  "attendance_correction",
  // progress — §4.5.9
  "progress",
  "progress_cohort",
  /**
   * A HUMAN SAYING THE STUDENT HAS FINISHED — FR-CRT, FR-PRG.
   *
   * Completion has been computed: attendance, work submitted, marks, lectures
   * watched, weighed against criteria. That figure is evidence and it is not a
   * decision. It cannot know that a student sat a viva, made up a missed brief
   * over the summer, or did everything asked of them in a term that lost two
   * weeks to a strike — and it cannot know that somebody scraped past every
   * threshold and is plainly not ready.
   *
   * So the judgement is recorded separately from the arithmetic, by a person,
   * with their name on it. A TEACHER may sign off the classes they teach,
   * because they are the only one who knows. Issuing the certificate remains
   * `certificate:create` — the office's — so the person who decides the
   * student has finished is deliberately not the person who prints the
   * document.
   */
  "subject_completion",
  "certificate",
  // communication — §4.5.10
  "announcement",
  "notification_config",
  /** Outgoing account mail held for a person to release — §4.5.10. */
  "email_queue",
  "own_notification_preference",
  "whatsapp_link",
  "discussion_post",
  // reporting — §4.5.11
  "dashboard",
  "report_attendance",
  "report_progress",
  "report_enrolment",
  "report_assessment",
  "report_financial",
  "report_teacher_activity",
  "report_marketing",
  // governance — §4.5.12
  "system_setting",
  /**
   * WHAT THE PUBLIC PAGE SAYS — the headline, the videos, the photographs and
   * the six things the Institute claims it does well.
   *
   * Held apart from `system_setting` because the two are different kinds of
   * decision made by different people. A system setting decides when a student
   * is warned and what a certificate requires, which is why writing one is
   * reserved to a Super Admin. A headline is marketing: it is wrong weekly, it
   * is corrected by whoever runs admissions, and routing that through the one
   * person who also holds the restore key means the front page says last
   * term's thing for a year.
   *
   * The values behind it ARE settings — same table, same audit, same cache —
   * so this resource is a narrower door onto a subset of them, not a second
   * store. The subset is the catalogue's "Public page" group, enforced on the
   * server (public-page.keys.ts), which is what stops the narrower door being
   * a way to reach the wider room.
   */
  "public_page",
  "integration_credential",
  "live_provider_selection",
  "audit_log",
  "security_log",
  "backup",
  "restore",
  "bulk_operation",
  "personal_data_export",
  "permanent_deletion",
  "maintenance_mode",
  "system_health",
] as const;
export type Resource = (typeof RESOURCES)[number];

// ----------------------------------------------------------- the matrix ----

export interface Grant {
  actions: readonly Action[];
  scope: Scope;
  /** When set, the grant applies only if the actor holds this sub-permission. */
  requiresSubPermission?: SubPermission;
  /** SEC-AUZ-011: privileged operations demand recent re-authentication. */
  requiresStepUp?: boolean;
}

type ResourcePolicy = Partial<Record<Role, Grant | Grant[]>>;

/**
 * The §4.5 permission matrix, executable.
 *
 * A resource absent from this map is DENIED to every role — the default is
 * closed, so forgetting to add a resource fails safe rather than open.
 */
export const PERMISSION_MATRIX: Record<Resource, ResourcePolicy> = {
  // ---------------------------------------------------- §4.5.1 identity ---
  super_admin_account: {
    super_admin: { actions: FULL, scope: "ALL", requiresStepUp: true },
  },
  admin_account: {
    super_admin: { actions: FULL, scope: "ALL", requiresStepUp: true },
    admin: {
      actions: ["create", "read", "update", "delete"],
      scope: "ALL",
      requiresSubPermission: "admin_manager",
    },
  },
  teacher_account: {
    super_admin: { actions: FULL, scope: "ALL" },
    admin: { actions: FULL, scope: "ALL" },
    teacher: { actions: ["read"], scope: "OWN" },
  },
  student_account: {
    super_admin: { actions: FULL, scope: "ALL" },
    admin: { actions: FULL, scope: "ALL" },
    teacher: { actions: ["read"], scope: "SECTION" },
    student: { actions: ["read", "update"], scope: "OWN" },
    /* Their own institute's students, read-only. `export` because the reason
       they log in is usually to put the results into their own records. */
    partner_admin: { actions: ["read", "export"], scope: "PARTNER" },
  },
  /**
   * FR-USR-003 — the institute-wide directory of every account.
   *
   * Separate from `student_account` for the reason that keeps recurring: that
   * resource is a TOPIC. A student holds `student_account:read` over their OWN
   * record and a teacher over the students in their sections, and neither of
   * those is "every account in the Institute with its roles and permissions".
   */
  user_directory: {
    super_admin: { actions: ["read", "export"], scope: "ALL" },
    admin: { actions: ["read", "export"], scope: "ALL" },
  },
  own_profile: {
    super_admin: { actions: ["read", "update"], scope: "OWN" },
    admin: { actions: ["read", "update"], scope: "OWN" },
    teacher: { actions: ["read", "update"], scope: "OWN" },
    student: { actions: ["read", "update"], scope: "OWN" },
  },
  own_password: {
    super_admin: { actions: ["update"], scope: "OWN" },
    admin: { actions: ["update"], scope: "OWN" },
    teacher: { actions: ["update"], scope: "OWN" },
    student: { actions: ["update"], scope: "OWN" },
  },
  own_session: {
    super_admin: { actions: ["read", "delete"], scope: "OWN" },
    admin: { actions: ["read", "delete"], scope: "OWN" },
    teacher: { actions: ["read", "delete"], scope: "OWN" },
    student: { actions: ["read", "delete"], scope: "OWN" },
  },
  other_user_password: {
    super_admin: { actions: ["update"], scope: "ALL" },
    admin: { actions: ["update"], scope: "ALL" },
  },
  other_user_session: {
    super_admin: { actions: ["delete"], scope: "ALL" },
    admin: { actions: ["delete"], scope: "ALL" },
  },
  role_assignment: {
    super_admin: { actions: ["configure"], scope: "ALL", requiresStepUp: true },
  },
  account_state: {
    super_admin: { actions: FULL, scope: "ALL" },
    admin: { actions: FULL, scope: "ALL" },
  },
  impersonation: {
    super_admin: { actions: ["create"], scope: "ALL", requiresStepUp: true },
  },

  // --------------------------------------------------- §4.5.2 admission ---
  registration: {
    super_admin: { actions: FULL, scope: "ALL" },
    admin: { actions: FULL, scope: "ALL" },
    // A student may see their OWN application, and nothing else. The
    // administrative queue is a separate resource below.
    student: { actions: ["read"], scope: "OWN" },
  },
  registration_queue: {
    super_admin: { actions: FULL, scope: "ALL" },
    admin: { actions: FULL, scope: "ALL" },
  },
  // BR-REG-04 / §4.7: teachers may NEVER see a payment slip. The absence of a
  // `teacher` key here is the enforcement, and it is deliberate.
  payment_slip: {
    super_admin: { actions: ["read", "export"], scope: "ALL" },
    admin: { actions: ["read", "export"], scope: "ALL" },
    student: { actions: ["read"], scope: "OWN" },
  },
  payment: {
    super_admin: { actions: FULL, scope: "ALL", requiresStepUp: true },
    admin: { actions: FULL, scope: "ALL", requiresStepUp: true },
    student: { actions: ["read"], scope: "OWN" },
  },
  /**
   * The claim, not the money — see the note beside the resource name.
   *
   * A STUDENT MAY CREATE, READ AND DELETE THEIR OWN. `delete` is withdrawing a
   * submission they have not been reviewed on yet — a wrong figure, the wrong
   * slip — and the service refuses it the moment an administrator has acted,
   * so it can never erase a decision. NO `update`: editing a claim after
   * submitting it is how a reviewed amount and a printed proof part company.
   *
   * `approve` is the office verifying one, and carries step-up for the same
   * reason `payment` does: it is the act that puts money in the ledger.
   */
  /**
   * The partner record. See the note beside the resource name.
   *
   * A PARTNER READS THEIRS AND NOTHING ELSE — the PARTNER scope resolves to
   * their own row, so "list the partners" returns exactly one to them and the
   * existence of any other is not disclosed.
   */
  partner_institute: {
    super_admin: { actions: FULL, scope: "ALL" },
    /* An Admin runs admissions and imports the cohorts, so they read and
       update; CREATING a partner opens the door and stays with Super Admin. */
    admin: { actions: ["read", "update"], scope: "ALL" },
    partner_admin: { actions: ["read"], scope: "PARTNER" },
  },
  /**
   * The invoice. The office raises and issues it; the partner reads their own.
   *
   * NO `create` FOR A PARTNER, and no `update`. They may look at what they owe
   * and, through the payment routes, tell us they have paid it — which is a
   * `payment_submission`, not a change to the invoice itself.
   */
  partner_invoice: {
    super_admin: { actions: FULL, scope: "ALL", requiresStepUp: true },
    admin: { actions: FULL, scope: "ALL", requiresStepUp: true },
    partner_admin: { actions: ["read", "export"], scope: "PARTNER" },
  },
  payment_submission: {
    super_admin: { actions: FULL, scope: "ALL", requiresStepUp: true },
    admin: { actions: FULL, scope: "ALL", requiresStepUp: true },
    student: { actions: ["create", "read", "delete"], scope: "OWN" },
  },
  /**
   * SETTING A PRICE IS NOT THE SAME AUTHORITY AS TAKING A PAYMENT.
   *
   * `payment` is behind step-up because it moves money that already exists.
   * This decides what a member of the public will be ASKED to transfer, which
   * is a different risk: getting it wrong does not misplace a receipt, it
   * quotes the whole next intake the wrong figure on a public page.
   *
   * A teacher may read it — students ask them what the course costs — and a
   * student may read their own programme's, which is what the fee panel on
   * their dashboard shows. Neither may change one.
   */
  fee_structure: {
    super_admin: { actions: FULL, scope: "ALL" },
    admin: { actions: FULL, scope: "ALL" },
    teacher: { actions: ["read"], scope: "ASSIGNED" },
    student: { actions: ["read"], scope: "ENROLLED" },
  },
  registration_number_series: {
    super_admin: { actions: ["configure", "read"], scope: "ALL", requiresStepUp: true },
    admin: { actions: ["read"], scope: "ALL" },
  },

  // ---------------------------------------------------- §4.5.3 academic ---
  programme: {
    super_admin: { actions: FULL, scope: "ALL" },
    admin: { actions: FULL, scope: "ALL" },
    teacher: { actions: ["read"], scope: "ASSIGNED" },
    student: { actions: ["read"], scope: "ENROLLED" },
  },
  /**
   * Uploading a course picture. Create and delete only — a thumbnail is
   * replaced rather than edited, and READING one needs no permission at all
   * because the whole point is that a stranger on the landing page can see it.
   */
  course_media: {
    super_admin: { actions: ["create", "delete", "read"], scope: "ALL" },
    admin: { actions: ["create", "delete", "read"], scope: "ALL" },
    teacher: { actions: ["read"], scope: "ASSIGNED" },
  },

  /*
   * WHO SIGNS A CERTIFICATE.
   *
   * The office manages the library and the office issues the certificates, so
   * both sit with admin and super_admin — a second permission for "may upload
   * a signature" would be a name nobody could hold and a rule nobody could
   * explain.
   *
   * A teacher READS it, and needs to: their own name may be in the panel on a
   * certificate for a class they taught, and being unable to see who signed it
   * would make the document unexplainable to the student holding it.
   *
   * A student does not appear here at all. What they see is the SNAPSHOT
   * printed on their own certificate, which is not this resource.
   */
  signatory: {
    super_admin: { actions: FULL, scope: "ALL" },
    admin: { actions: FULL, scope: "ALL" },
    teacher: { actions: ["read"], scope: "ALL" },
  },
  /**
   * A NOTE ON THESE TWO SCOPES, because they do not mean what they appear to.
   *
   * scope.extension.ts lists AcademicSession and Batch under
   * DELIBERATELY_UNSCOPED: they are prospectus data — a name, a code and two
   * dates, describing what the Institute OFFERS rather than anything a person
   * has done — so no database predicate narrows them, and in practice a
   * student listing batches sees them all.
   *
   * These entries were briefly widened to ALL to say so plainly, which
   * student-isolation.spec.ts correctly rejected: a student is never granted
   * ALL on anything, and weakening that invariant to document one harmless
   * catalogue is a bad trade. They stay narrow. What the narrow scope buys
   * here is the invariant itself, not row filtering; the restriction that
   * actually bites is on writing, which only an Admin holds.
   */
  academic_session: {
    super_admin: { actions: FULL, scope: "ALL" },
    admin: { actions: FULL, scope: "ALL" },
    teacher: { actions: ["read"], scope: "ASSIGNED" },
    student: { actions: ["read"], scope: "OWN" },
  },
  batch: {
    super_admin: { actions: FULL, scope: "ALL" },
    admin: { actions: FULL, scope: "ALL" },
    teacher: { actions: ["read"], scope: "ASSIGNED" },
    student: { actions: ["read"], scope: "OWN" },
  },
  section: {
    super_admin: { actions: FULL, scope: "ALL" },
    admin: { actions: FULL, scope: "ALL" },
    teacher: { actions: ["read"], scope: "ASSIGNED" },
    student: { actions: ["read"], scope: "OWN" },
  },
  subject: {
    super_admin: { actions: FULL, scope: "ALL" },
    admin: { actions: FULL, scope: "ALL" },
    teacher: { actions: ["read", "update"], scope: "ASSIGNED" },
    student: { actions: ["read"], scope: "ENROLLED" },
  },
  section_subject: {
    super_admin: { actions: FULL, scope: "ALL" },
    admin: { actions: FULL, scope: "ALL" },
    teacher: { actions: ["read"], scope: "ASSIGNED" },
    student: { actions: ["read"], scope: "ENROLLED" },
  },
  // BR-ACC-04: this is the sole source of ASSIGNED scope, so a teacher must
  // never be able to write it (FR-RBAC-012).
  teacher_assignment: {
    super_admin: { actions: FULL, scope: "ALL" },
    admin: { actions: FULL, scope: "ALL" },
    teacher: { actions: ["read"], scope: "OWN" },
  },
  enrolment: {
    super_admin: { actions: FULL, scope: "ALL" },
    admin: { actions: FULL, scope: "ALL" },
    teacher: { actions: ["read"], scope: "ASSIGNED" },
    student: { actions: ["read"], scope: "OWN" },
  },
  timetable: {
    super_admin: { actions: FULL, scope: "ALL" },
    admin: { actions: FULL, scope: "ALL" },
    teacher: { actions: ["read", "update"], scope: "ASSIGNED" },
    student: { actions: ["read"], scope: "ENROLLED" },
  },

  // ----------------------------------------------------- §4.5.4 content ---
  module: {
    super_admin: { actions: FULL, scope: "ALL" },
    admin: { actions: FULL, scope: "ALL" },
    teacher: { actions: FULL, scope: "ASSIGNED" },
    student: { actions: ["read"], scope: "ENROLLED" },
  },
  lesson: {
    super_admin: { actions: FULL, scope: "ALL" },
    admin: { actions: FULL, scope: "ALL" },
    teacher: { actions: FULL, scope: "ASSIGNED" },
    student: { actions: ["read"], scope: "ENROLLED" },
  },
  content_publication: {
    super_admin: { actions: ["update"], scope: "ALL" },
    admin: { actions: ["update"], scope: "ALL" },
    teacher: { actions: ["update"], scope: "ASSIGNED" },
  },
  recorded_lecture: {
    super_admin: { actions: FULL, scope: "ALL" },
    admin: { actions: FULL, scope: "ALL" },
    teacher: { actions: FULL, scope: "ASSIGNED" },
    student: { actions: ["read"], scope: "ENROLLED" },
  },
  /**
   * SUPER ADMIN AND ADMIN ONLY, and no teacher entry at all — an absent role
   * is a refusal here, not an oversight. See the note on the resource.
   */
  lecture_storage_index: {
    super_admin: { actions: ["read"], scope: "ALL" },
    admin: { actions: ["read"], scope: "ALL" },
  },
  lecture_playback: {
    super_admin: { actions: ["read"], scope: "ALL" },
    admin: { actions: ["read"], scope: "ALL" },
    teacher: { actions: ["read"], scope: "ASSIGNED" },
    student: { actions: ["read"], scope: "ENROLLED" },
  },
  lesson_resource: {
    super_admin: { actions: FULL, scope: "ALL" },
    admin: { actions: FULL, scope: "ALL" },
    teacher: { actions: FULL, scope: "ASSIGNED" },
    student: { actions: ["read", "export"], scope: "ENROLLED" },
  },
  watch_progress: {
    super_admin: { actions: ["read"], scope: "ALL" },
    admin: { actions: ["read"], scope: "ALL" },
    teacher: { actions: ["read"], scope: "ASSIGNED" },
    student: { actions: ["read", "update"], scope: "OWN" },
  },

  // -------------------------------------------------------- §4.5.5 live ---
  live_session: {
    super_admin: { actions: FULL, scope: "ALL" },
    admin: { actions: FULL, scope: "ALL" },
    teacher: { actions: FULL, scope: "ASSIGNED" },
    student: { actions: ["read"], scope: "ENROLLED" },
  },
  join_route: {
    super_admin: { actions: ["read"], scope: "ALL" },
    admin: { actions: ["read"], scope: "ALL" },
    teacher: { actions: ["read"], scope: "ASSIGNED" },
    student: { actions: ["read"], scope: "ENROLLED" },
  },
  // ARC-025: the raw provider link is never handed to a student — they receive
  // a JoinRoute instead, and the client renders from its `kind`.
  provider_binding: {
    super_admin: { actions: ["read", "configure"], scope: "ALL" },
    admin: { actions: ["read"], scope: "ALL" },
    teacher: { actions: ["read"], scope: "ASSIGNED" },
  },
  participation_evidence: {
    super_admin: { actions: ["read"], scope: "ALL" },
    admin: { actions: ["read"], scope: "ALL" },
    teacher: { actions: ["read"], scope: "ASSIGNED" },
  },

  // -------------------------------------------------- §4.5.6/7 assessment -
  assignment: {
    super_admin: { actions: FULL, scope: "ALL" },
    admin: { actions: FULL, scope: "ALL" },
    teacher: { actions: FULL, scope: "ASSIGNED" },
    student: { actions: ["read"], scope: "ENROLLED" },
  },
  rubric: {
    super_admin: { actions: FULL, scope: "ALL" },
    admin: { actions: FULL, scope: "ALL" },
    teacher: { actions: FULL, scope: "ASSIGNED" },
    student: { actions: ["read"], scope: "ENROLLED" },
  },
  submission: {
    super_admin: { actions: ["read", "export"], scope: "ALL" },
    admin: { actions: ["read", "export"], scope: "ALL" },
    teacher: { actions: ["read", "export"], scope: "ASSIGNED" },
    student: { actions: ["create", "read", "update", "export"], scope: "OWN" },
  },
  /**
   * FR-TCH-019 — the grading roster: who submitted, who did not, who was late,
   * what is still unmarked.
   *
   * Separate from `submission` for the same reason `progress_cohort` is
   * separate from `progress`. A student holds `submission:read` so they can see
   * their OWN work; that must not also open a list of the whole class with
   * every classmate's name, roll number and marks on it.
   */
  submission_roster: {
    super_admin: { actions: ["read", "export"], scope: "ALL" },
    admin: { actions: ["read", "export"], scope: "ALL" },
    teacher: { actions: ["read", "export"], scope: "ASSIGNED" },
  },
  /**
   * TALKING ABOUT THE WORK — see the note beside the resource name.
   *
   * A TEACHER WRITES ON WHAT THEY ARE ASSIGNED TO MARK; a student writes on
   * their OWN. `delete` is withdrawing something you wrote yourself, and the
   * service refuses anybody else's — a teacher cannot erase a student's reply,
   * and neither can erase the other's account of what was said.
   *
   * NO STEP-UP and no `approve`: this is a conversation, not a decision.
   * Administrators read but do not write, because a comment on a piece of work
   * should come from the person who marked it.
   */
  submission_comment: {
    super_admin: { actions: ["read"], scope: "ALL" },
    admin: { actions: ["read"], scope: "ALL" },
    teacher: { actions: ["create", "read", "update", "delete"], scope: "ASSIGNED" },
    student: { actions: ["create", "read", "update", "delete"], scope: "OWN" },
  },
  grade: {
    super_admin: { actions: ["read", "update"], scope: "ALL" },
    admin: { actions: ["read", "update"], scope: "ALL" },
    teacher: { actions: ["create", "read", "update"], scope: "ASSIGNED" },
    student: { actions: ["read"], scope: "OWN" },
    /* READ, never update — a partner does not mark. And RELEASED marks only,
       which this grant cannot express: BR-ASG-09 is enforced by an explicit
       `releasedAt` check in the query, because the scope predicate does not
       filter nested includes. A partner seeing a mark before the student it
       belongs to would break the release-together rule from the outside. */
    partner_admin: { actions: ["read", "export"], scope: "PARTNER" },
  },
  // §4.7: internal grading notes are never visible to a student. There is no
  // `student` key and there must never be one.
  internal_note: {
    super_admin: { actions: ["read"], scope: "ALL" },
    admin: { actions: ["read"], scope: "ALL" },
    teacher: { actions: FULL, scope: "ASSIGNED" },
  },
  quiz: {
    super_admin: { actions: FULL, scope: "ALL" },
    admin: { actions: FULL, scope: "ALL" },
    teacher: { actions: FULL, scope: "ASSIGNED" },
    student: { actions: ["read"], scope: "ENROLLED" },
  },
  question_bank: {
    super_admin: { actions: FULL, scope: "ALL" },
    admin: { actions: FULL, scope: "ALL" },
    teacher: { actions: FULL, scope: "OWN" },
  },
  question: {
    super_admin: { actions: FULL, scope: "ALL" },
    admin: { actions: FULL, scope: "ALL" },
    teacher: { actions: FULL, scope: "OWN" },
  },
  quiz_attempt: {
    super_admin: { actions: ["read", "update"], scope: "ALL" },
    admin: { actions: ["read", "update"], scope: "ALL" },
    teacher: { actions: ["read", "update"], scope: "ASSIGNED" },
    // `update` is how a student saves an answer mid-attempt (FR-QIZ-026). It
    // is NOT marking — see quiz_answer_grade.
    student: { actions: ["create", "read", "update"], scope: "OWN" },
  },
  /**
   * FR-QIZ-031 — awarding marks for a written answer.
   *
   * Split from `quiz_attempt` because a student holds `quiz_attempt:update` in
   * order to save their own answers as they type, and that must never be the
   * same permission that decides what those answers are worth.
   */
  quiz_answer_grade: {
    super_admin: { actions: ["update"], scope: "ALL" },
    admin: { actions: ["update"], scope: "ALL" },
    teacher: { actions: ["update"], scope: "ASSIGNED" },
  },
  // SEC-AUZ-009 / BR-QIZ-07: correct answers must not reach a student before
  // the configured release point — including in a field the UI never renders.
  quiz_answer_key: {
    super_admin: { actions: ["read"], scope: "ALL" },
    admin: { actions: ["read"], scope: "ALL" },
    teacher: { actions: ["read"], scope: "ASSIGNED" },
  },

  // -------------------------------------------------- §4.5.8 attendance ---
  attendance: {
    super_admin: { actions: FULL, scope: "ALL" },
    admin: { actions: FULL, scope: "ALL" },
    teacher: { actions: ["create", "read", "update", "approve", "export"], scope: "ASSIGNED" },
    // READ ONLY. `update` used to be granted here "for self check-in", which
    // also satisfied the bulk-marking endpoint — a student could mark the
    // whole class present. Self check-in is now its own resource.
    student: { actions: ["read"], scope: "OWN" },
    /* Whether their people are turning up — the reason a partner rings us. */
    partner_admin: { actions: ["read", "export"], scope: "PARTNER" },
  },
  attendance_register: {
    super_admin: { actions: FULL, scope: "ALL" },
    admin: { actions: FULL, scope: "ALL" },
    teacher: { actions: ["create", "read", "update", "approve", "export"], scope: "ASSIGNED" },
  },
  attendance_self_checkin: {
    student: { actions: ["update"], scope: "OWN" },
  },
  attendance_correction: {
    super_admin: { actions: ["update"], scope: "ALL" },
    admin: { actions: ["update"], scope: "ALL" },
    teacher: { actions: ["update"], scope: "ASSIGNED" },
  },

  // ---------------------------------------------------- §4.5.9 progress ---
  /*
   * `configure` is HOW PROGRESS IS MEASURED, not what anybody's progress is.
   *
   * A teacher holds it for their own classes because they are the only person
   * who knows whether attendance or submitted work says more about their
   * subject — a practical workshop and a lecture course should not be judged
   * by the same four numbers, and until this existed they were.
   *
   * A student reads their own and configures nothing, which needs no saying
   * except that the matrix is the only place it IS said.
   */
  progress: {
    super_admin: { actions: ["read", "export", "configure"], scope: "ALL" },
    admin: { actions: ["read", "export", "configure"], scope: "ALL" },
    teacher: { actions: ["read", "export", "configure"], scope: "ASSIGNED" },
    student: { actions: ["read"], scope: "OWN" },
    /* Read and export, never `configure` — the threshold that decides whether
       somebody has completed a subject is the Institute's rule, not a
       customer's. */
    partner_admin: { actions: ["read", "export"], scope: "PARTNER" },
  },
  /**
   * FR-PRG-011/012 — the whole cohort, worst-first.
   *
   * Separate from `progress` because it is a different kind of thing: a
   * teaching tool listing every classmate by name, roll number, attendance and
   * average grade. A student holds `progress:read` for their OWN figures, and
   * that must never be enough to open a class list.
   */
  /**
   * A teacher signs off their OWN classes and nobody else's — ASSIGNED scope,
   * the same reach they have over marking. A student may read the decision
   * about themselves: being told you have not completed, and being unable to
   * see that anybody said so, is its own small cruelty.
   */
  subject_completion: {
    super_admin: { actions: ["create", "read", "update"], scope: "ALL" },
    admin: { actions: ["create", "read", "update"], scope: "ALL" },
    teacher: { actions: ["create", "read", "update"], scope: "ASSIGNED" },
    student: { actions: ["read"], scope: "OWN" },
    partner_admin: { actions: ["read", "export"], scope: "PARTNER" },
  },
  progress_cohort: {
    super_admin: { actions: ["read", "export"], scope: "ALL" },
    admin: { actions: ["read", "export"], scope: "ALL" },
    teacher: { actions: ["read", "export"], scope: "ASSIGNED" },
  },
  certificate: {
    super_admin: { actions: FULL, scope: "ALL" },
    admin: {
      actions: ["create", "read", "approve", "export"],
      scope: "ALL",
      requiresSubPermission: "certificate_issuer",
    },
    teacher: { actions: ["read"], scope: "ASSIGNED" },
    student: { actions: ["read", "export"], scope: "OWN" },
    /* The document their student was issued. No `approve`: awarding a
       certificate in this Institute's name is this Institute's decision. */
    partner_admin: { actions: ["read"], scope: "PARTNER" },
  },

  // ----------------------------------------------- §4.5.10 communication --
  announcement: {
    super_admin: { actions: FULL, scope: "ALL" },
    admin: { actions: FULL, scope: "ALL" },
    teacher: { actions: FULL, scope: "ASSIGNED" },
    student: { actions: ["read"], scope: "ENROLLED" },
  },
  notification_config: {
    super_admin: { actions: ["configure"], scope: "ALL" },
    admin: { actions: ["configure"], scope: "ALL" },
  },
  /**
   * MESSAGES WAITING TO GO OUT, AND THE DECISION TO SEND THEM.
   *
   * The office, not a teacher: releasing one of these sends a person their way
   * into the System, and the queue itself lists every address the Institute is
   * about to write to. Neither is a teacher's business.
   *
   * NO STEP-UP, deliberately. This is a thing an administrator will do several
   * times a day — a cohort is imported, twelve messages appear, they are looked
   * at and released. A password prompt on every one of those trains somebody to
   * type their password without reading what they are approving, which is worse
   * for security than the prompt is good for it. The dangerous act here is
   * approving without looking, and re-authentication does nothing about that.
   *
   * `delete` is discarding a message rather than erasing a record: the row is
   * kept and marked, because "why did that student never get their details" is
   * asked weeks later.
   */
  email_queue: {
    super_admin: { actions: ["read", "update", "delete"], scope: "ALL" },
    admin: { actions: ["read", "update", "delete"], scope: "ALL" },
  },
  own_notification_preference: {
    super_admin: { actions: ["read", "update"], scope: "OWN" },
    admin: { actions: ["read", "update"], scope: "OWN" },
    teacher: { actions: ["read", "update"], scope: "OWN" },
    student: { actions: ["read", "update"], scope: "OWN" },
  },
  whatsapp_link: {
    super_admin: { actions: FULL, scope: "ALL" },
    admin: { actions: FULL, scope: "ALL" },
    teacher: { actions: ["read"], scope: "ASSIGNED" },
    student: { actions: ["read"], scope: "ENROLLED" },
  },
  discussion_post: {
    super_admin: { actions: FULL, scope: "ALL" },
    admin: { actions: FULL, scope: "ALL" },
    teacher: { actions: FULL, scope: "ASSIGNED" },
    student: { actions: ["create", "read", "update", "delete"], scope: "OWN" },
  },

  // -------------------------------------------------- §4.5.11 reporting ---
  dashboard: {
    super_admin: { actions: ["read"], scope: "ALL" },
    admin: { actions: ["read"], scope: "ALL" },
    teacher: { actions: ["read"], scope: "ASSIGNED" },
    student: { actions: ["read"], scope: "OWN" },
  },
  report_attendance: {
    super_admin: { actions: ["read", "export"], scope: "ALL" },
    admin: { actions: ["read", "export"], scope: "ALL" },
    teacher: { actions: ["read", "export"], scope: "ASSIGNED" },
    student: { actions: ["read"], scope: "OWN" },
  },
  report_progress: {
    super_admin: { actions: ["read", "export"], scope: "ALL" },
    admin: { actions: ["read", "export"], scope: "ALL" },
    teacher: { actions: ["read", "export"], scope: "ASSIGNED" },
    student: { actions: ["read"], scope: "OWN" },
  },
  report_enrolment: {
    super_admin: { actions: ["read", "export"], scope: "ALL" },
    admin: { actions: ["read", "export"], scope: "ALL" },
    teacher: { actions: ["read"], scope: "ASSIGNED" },
  },
  report_assessment: {
    super_admin: { actions: ["read", "export"], scope: "ALL" },
    admin: { actions: ["read", "export"], scope: "ALL" },
    teacher: { actions: ["read", "export"], scope: "ASSIGNED" },
    student: { actions: ["read"], scope: "OWN" },
  },
  report_financial: {
    super_admin: { actions: ["read", "export"], scope: "ALL" },
    admin: {
      actions: ["read", "export"],
      scope: "ALL",
      requiresSubPermission: "financial_reporter",
    },
  },
  report_teacher_activity: {
    super_admin: { actions: ["read", "export"], scope: "ALL" },
    admin: { actions: ["read", "export"], scope: "ALL" },
    teacher: { actions: ["read"], scope: "OWN" },
  },
  report_marketing: {
    super_admin: { actions: ["read", "export"], scope: "ALL" },
    admin: { actions: ["read", "export"], scope: "ALL" },
  },

  // ------------------------------------------------- §4.5.12 governance ---
  system_setting: {
    super_admin: { actions: ["read", "configure"], scope: "ALL" },
    admin: { actions: ["read"], scope: "ALL" },
  },
  /**
   * An Admin may CHANGE this one, unlike every other setting.
   *
   * Deliberate, and the reason is above the resource name. Nothing reachable
   * through it decides anything about a student — no threshold, no weighting,
   * no criterion — and everything reachable through it is already published to
   * the world by the Institute. The worst outcome of a mistake here is an
   * embarrassing sentence on a web page, corrected in the next minute by the
   * same person; the worst outcome of NOT granting it is that the page cannot
   * be corrected at all without the Super Admin.
   *
   * A teacher and a student hold nothing. This is the Institute talking about
   * itself, and it is signed with the Institute's name.
   */
  public_page: {
    super_admin: { actions: ["read", "configure"], scope: "ALL" },
    admin: { actions: ["read", "configure"], scope: "ALL" },
  },
  integration_credential: {
    // SEC-CRY-010: write-only. No role may READ a stored secret — not even a
    // Super Admin, who may replace but never retrieve it.
    super_admin: { actions: ["configure"], scope: "ALL", requiresStepUp: true },
  },
  live_provider_selection: {
    super_admin: { actions: ["read", "configure"], scope: "ALL" },
    admin: { actions: ["read"], scope: "ALL" },
  },
  audit_log: {
    // FR-LOG-004: no update, no delete, for anybody, ever.
    super_admin: { actions: ["read", "export"], scope: "ALL" },
    admin: { actions: ["read"], scope: "SECTION" },
  },
  security_log: {
    super_admin: { actions: ["read", "export"], scope: "ALL" },
  },
  backup: {
    /*
     * `export` IS TAKING A COPY OFF THE SERVER, and it is the heaviest of
     * these four verbs even though it writes nothing.
     *
     * An archive is every CNIC, address, telephone number, bank slip and mark
     * the Institute holds, in one file, on somebody's laptop. Creating one
     * changes nothing; carrying one out of the building is the act that can
     * never be undone. So it sits with `restore` in requiring step-up, and it
     * stays with the Super Admin — the same person who already holds the
     * restore key — rather than widening the most sensitive resource in the
     * System to make a download more convenient.
     */
    super_admin: {
      actions: ["create", "read", "configure", "export"],
      scope: "ALL",
      requiresStepUp: true,
    },
  },
  restore: {
    super_admin: { actions: ["create"], scope: "ALL", requiresStepUp: true },
  },
  bulk_operation: {
    super_admin: { actions: FULL, scope: "ALL" },
    admin: { actions: FULL, scope: "ALL", requiresSubPermission: "bulk_operator" },
  },
  personal_data_export: {
    super_admin: { actions: ["export"], scope: "ALL" },
    admin: { actions: ["export"], scope: "ALL" },
    student: { actions: ["export"], scope: "OWN" },
  },
  permanent_deletion: {
    super_admin: { actions: ["delete"], scope: "ALL", requiresStepUp: true },
  },
  maintenance_mode: {
    super_admin: { actions: ["configure"], scope: "ALL" },
  },
  system_health: {
    super_admin: { actions: ["read"], scope: "ALL" },
    admin: { actions: ["read"], scope: "ALL" },
  },
};

// ------------------------------------------------------------ resolution --

export interface ActorPermissions {
  roles: readonly Role[];
  subPermissions: readonly SubPermission[];
  /** Whether the actor re-authenticated within the step-up window (SEC-AUZ-011). */
  steppedUp?: boolean;
}

export interface PermissionDecision {
  allowed: boolean;
  /** Widest scope granted across the actor's roles for this action. */
  scope: Scope;
  /** Machine-readable reason, for the denial log required by SEC-LOG-005. */
  reason?:
    | "no_grant_for_role"
    | "action_not_granted"
    | "missing_sub_permission"
    | "step_up_required";
}

/**
 * Widest first — used to resolve the union across multiple roles (FR-RBAC-006).
 *
 * PARTNER SITS JUST ABOVE OWN, and the placement is a safety choice rather
 * than a statement about how many rows each reaches. This ranking only ever
 * matters for somebody holding TWO roles at once, and the pairing to think
 * about is a partner's own member of staff who is also enrolled here as a
 * student. Ranking PARTNER low means such a person's student-scoped grants can
 * never be widened by their partner role beyond the cohort their institute
 * sent us — and if the two ever genuinely conflict, the narrower answer is the
 * one nobody has to apologise for.
 */
const SCOPE_BREADTH: Record<Scope, number> = {
  ALL: 5,
  SECTION: 4,
  ASSIGNED: 3,
  ENROLLED: 2,
  PARTNER: 2,
  OWN: 1,
  NONE: 0,
};

function toGrants(entry: Grant | Grant[] | undefined): Grant[] {
  if (!entry) return [];
  return Array.isArray(entry) ? entry : [entry];
}

/**
 * Resolve ROLE ∩ ACTION for a resource, returning the scope that the caller
 * must then apply at the data layer.
 *
 * FR-RBAC-006: where several roles are held, permission is the union — but the
 * scope is never widened beyond the widest any single held role grants for
 * that action.
 */
export function resolvePermission(
  actor: ActorPermissions,
  resource: Resource,
  action: Action,
): PermissionDecision {
  const policy = PERMISSION_MATRIX[resource];
  if (!policy) {
    // Default closed: an unmapped resource is denied (see PERMISSION_MATRIX).
    return { allowed: false, scope: "NONE", reason: "no_grant_for_role" };
  }

  let best: Scope = "NONE";
  let sawRole = false;
  let sawAction = false;
  let blockedBySubPermission = false;
  let blockedByStepUp = false;

  for (const role of actor.roles) {
    for (const grant of toGrants(policy[role])) {
      sawRole = true;
      if (!grant.actions.includes(action)) continue;
      sawAction = true;

      if (grant.requiresSubPermission && !actor.subPermissions.includes(grant.requiresSubPermission)) {
        blockedBySubPermission = true;
        continue;
      }
      if (grant.requiresStepUp && !actor.steppedUp) {
        blockedByStepUp = true;
        continue;
      }
      if (SCOPE_BREADTH[grant.scope] > SCOPE_BREADTH[best]) best = grant.scope;
    }
  }

  if (best !== "NONE") return { allowed: true, scope: best };
  if (blockedByStepUp) return { allowed: false, scope: "NONE", reason: "step_up_required" };
  if (blockedBySubPermission) {
    return { allowed: false, scope: "NONE", reason: "missing_sub_permission" };
  }
  if (sawRole && !sawAction) {
    return { allowed: false, scope: "NONE", reason: "action_not_granted" };
  }
  return { allowed: false, scope: "NONE", reason: "no_grant_for_role" };
}

/** Convenience predicate for call sites that do not need the scope back. */
export function can(actor: ActorPermissions, resource: Resource, action: Action): boolean {
  return resolvePermission(actor, resource, action).allowed;
}
