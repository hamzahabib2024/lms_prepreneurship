/**
 * Partner isolation — the first multi-party boundary in this System.
 *
 * WHY THIS FILE IS THE DELIVERABLE AND THE PORTAL IS NOT. Everything before
 * partner institutes assumed one institute: one set of books, one name on the
 * certificate, one group of people who are all on the same side. A partner is
 * the first party that is NOT us and is nevertheless let in — so the question
 * "can they see something that is not theirs" stops being a matter of taste
 * and becomes the whole feature.
 *
 * IT TESTS BOTH HALVES, because a leak needs only one of them to fail:
 *
 *   the MATRIX  — what a partner_admin is granted at all (resolvePermission)
 *   the PREDICATE — which rows the grant reaches (MODEL_POLICIES)
 *
 * The student-isolation spec beside this one exists because five real defects
 * were WIRING defects: the matrix was right every time and the endpoint asked
 * for the wrong resource. The same trap applies here with more at stake, so
 * the predicates are asserted directly rather than inferred from the grants.
 */

import { resolvePermission, type ActorPermissions, type Resource } from "@lms/shared";
import { __testing } from "../prisma/scope.extension";
import type { Actor } from "../prisma/actor-context";

const { MODEL_POLICIES } = __testing;

// --------------------------------------------------------------- actors ----

const OURS = "partner-aaa";
const THEIRS = "partner-bbb";

/*
 * NULL, NOT `undefined`, for "no institute attached".
 *
 * Passing `undefined` to a parameter with a default gets you the DEFAULT — so
 * the unattached-partner cases were silently testing an attached one, and
 * every assertion about failing safely was passing for the wrong reason. Found
 * by this file's own first run, which is the argument for writing it.
 */
const partner = (partnerInstituteId: string | null = OURS): Actor => ({
  userId: "u-partner",
  roles: ["partner_admin"],
  subPermissions: [],
  ...(partnerInstituteId === null ? {} : { partnerInstituteId }),
  sectionSubjectIds: [],
  sectionIds: [],
  correlationId: "test",
});

const grants = (role: ActorPermissions["roles"][number]): ActorPermissions => ({
  roles: [role],
  subPermissions: [],
  steppedUp: true,
});

const may = (
  role: ActorPermissions["roles"][number],
  resource: Resource,
  action: Parameters<typeof resolvePermission>[2],
): boolean => resolvePermission(grants(role), resource, action).allowed;

/** The predicate a model would apply to this actor. */
const predicate = (model: string, actor: Actor) => MODEL_POLICIES[model]?.(actor);

/** Our chosen shape for "matches nothing". */
const DENIES_EVERYTHING = { id: { in: [] } };

// ---------------------------------------------------- what they may reach ---

describe("a partner reads their own students and nothing else", () => {
  it("is granted only READ and EXPORT, never a write, anywhere", () => {
    // The grant list is short on purpose. If somebody widens it, this fails
    // before the reason for widening it is forgotten.
    const readable: Resource[] = [
      "student_account",
      "grade",
      "attendance",
      "certificate",
      "progress",
      "subject_completion",
      "partner_institute",
      "partner_invoice",
    ];
    for (const resource of readable) {
      expect(may("partner_admin", resource, "read")).toBe(true);
      expect(may("partner_admin", resource, "create")).toBe(false);
      expect(may("partner_admin", resource, "update")).toBe(false);
      expect(may("partner_admin", resource, "delete")).toBe(false);
      expect(may("partner_admin", resource, "approve")).toBe(false);
    }
  });

  it("scopes every one of those to PARTNER, never to ALL", () => {
    // A grant that reached ALL would be a partner reading the whole Institute
    // even though the predicate held — the exact shape of the five wiring
    // defects the student spec was written for.
    for (const resource of [
      "student_account",
      "grade",
      "attendance",
      "certificate",
      "progress",
      "subject_completion",
    ] as Resource[]) {
      expect(resolvePermission(grants("partner_admin"), resource, "read").scope).toBe("PARTNER");
    }
  });
});

// ------------------------------------------------- what they may NOT reach --

describe("a partner is refused everything about money that is not their invoice", () => {
  it("cannot touch a student's fees, payments or receipts", () => {
    // THE POINT OF THE WHOLE BILLING DESIGN. In STUDENT_PAYS the partner has
    // no business in the student's ledger at all; in PARTNER_PAYS they get an
    // invoice line, which lives on `partner_invoice` and not here.
    for (const action of ["read", "create", "update", "export"] as const) {
      expect(may("partner_admin", "payment", action)).toBe(false);
      expect(may("partner_admin", "payment_submission", action)).toBe(false);
      expect(may("partner_admin", "fee_structure", action)).toBe(false);
    }
  });

  it("cannot read anything private about a student or the Institute", () => {
    const forbidden: Resource[] = [
      "internal_note",
      "audit_log",
      "system_setting",
      "integration_credential",
      "user_directory",
      "teacher_account",
      "admin_account",
      "registration_queue",
      "submission_roster",
    ];
    for (const resource of forbidden) {
      expect(may("partner_admin", resource, "read")).toBe(false);
    }
  });

  it("cannot mark, enrol, or issue a certificate", () => {
    expect(may("partner_admin", "grade", "update")).toBe(false);
    expect(may("partner_admin", "enrolment", "create")).toBe(false);
    expect(may("partner_admin", "certificate", "create")).toBe(false);
    expect(may("partner_admin", "certificate", "approve")).toBe(false);
  });
});

// ------------------------------------------------------------ predicates ---

describe("the predicate confines a partner to their own cohort", () => {
  it("filters students by the partner on the actor", () => {
    expect(predicate("Student", partner())).toEqual({
      partnerInstituteId: OURS,
      deletedAt: null,
    });
  });

  it("never returns another partner's id", () => {
    // The one assertion that would catch a copy-paste of the wrong variable.
    const where = JSON.stringify(predicate("Student", partner(OURS)));
    expect(where).toContain(OURS);
    expect(where).not.toContain(THEIRS);
  });

  it.each([
    "AttendanceRecord",
    "Certificate",
    "SubjectCompletion",
    "AttendanceWarning",
    "Enrolment",
  ])("reaches %s only through their own students", (model) => {
    expect(predicate(model, partner())).toEqual({
      student: { partnerInstituteId: OURS, deletedAt: null },
    });
  });

  it("shows a partner only their OWN institute record", () => {
    // A customer list is a competitor list: asking for "all partners" as a
    // partner must return exactly one row, so the existence of any other is
    // never disclosed.
    expect(predicate("PartnerInstitute", partner())).toEqual({ id: OURS });
  });

  it("shows a partner only their own invoices and lines", () => {
    expect(predicate("PartnerInvoice", partner())).toEqual({ partnerInstituteId: OURS });
    expect(predicate("PartnerInvoiceLine", partner())).toEqual({
      invoice: { partnerInstituteId: OURS },
    });
  });
});

// ------------------------------------------------ released results only -----

describe("a partner never sees a mark before the student does", () => {
  it("filters grades on releasedAt as well as on the cohort", () => {
    // BR-ASG-09 releases a cohort together. A partner reading an unreleased
    // mark would learn their student's result first — breaking that rule from
    // OUTSIDE the Institute, where nobody would think to look for it.
    expect(predicate("AssignmentGrade", partner())).toEqual({
      submission: { student: { partnerInstituteId: OURS, deletedAt: null } },
      releasedAt: { not: null },
    });
  });

  it("filters quiz attempts the same way", () => {
    expect(predicate("QuizAttempt", partner())).toEqual({
      student: { partnerInstituteId: OURS, deletedAt: null },
      releasedAt: { not: null },
    });
  });
});

// ----------------------------------------------------- failing safely -------

describe("a partner with no institute attached reaches nothing", () => {
  // The direction this has to fail in. An account created without the column
  // set, or a partner whose link was removed this morning, must see an empty
  // list — never everybody's.
  it.each([
    "Student",
    "AssignmentGrade",
    "AttendanceRecord",
    "Certificate",
    "SubjectCompletion",
    "QuizAttempt",
    "PartnerInstitute",
    "PartnerInvoice",
    "PartnerInvoiceLine",
  ])("denies %s outright", (model) => {
    expect(predicate(model, partner(null))).toEqual(DENIES_EVERYTHING);
  });

  it("is not rescued by holding the column without the role", () => {
    // Half a partner is not a partner. A member of our own staff who somehow
    // acquired the column gains nothing from it.
    const notAPartner: Actor = {
      ...partner(OURS),
      roles: [],
    };
    expect(predicate("Student", notAPartner)).toEqual(DENIES_EVERYTHING);
  });
});
