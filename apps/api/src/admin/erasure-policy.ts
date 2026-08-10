/**
 * Personal data: export and erasure — SRS §5.22, SEC-PRV-001..010.
 *
 * Two rights, and they are not opposites of each other.
 *
 * EXPORT is "give me everything you hold about me". The interesting question is
 * not what to include but WHO IS ASKING: a student exporting their own record
 * is using a self-service screen, and an administrator exporting on their
 * behalf is answering a formal request. Those are different acts and they do
 * not return the same thing — see visibilityFor().
 *
 * ERASURE IS NOT DELETION, and pretending otherwise would either break the
 * System or lie to the person asking. Three things make a true delete
 * impossible, and all three are deliberate features:
 *
 *   the audit log is append-only, enforced by database triggers (FR-LOG-004).
 *   A log that can be edited to remove somebody is not a log.
 *
 *   certificates must stay verifiable (FR-CRT-015). An employer holding a
 *   printed certificate checks it years later; erasing the holder would turn a
 *   genuine qualification into a forgery.
 *
 *   BR-DAT-02 retains academic and financial records. A grade with no student
 *   is incoherent, and payments usually carry statutory retention.
 *
 * So erasure ANONYMISES: every field that identifies a person is destroyed, and
 * the structural rows that would otherwise become incoherent are kept with the
 * identity removed. Afterwards the audit log still says user 7f3a… did things,
 * and nothing anywhere says who 7f3a… was.
 *
 * That is the honest answer and it must be SAID to whoever asks for it, which
 * is why every entry below carries its reason in words.
 */

export type Disposition = "ERASE" | "RETAIN_ANONYMISED" | "RETAIN_INTACT";

export interface DataCategory {
  /** What a person would call it. */
  label: string;
  /** The models involved, for the person implementing or auditing this. */
  models: string[];
  disposition: Disposition;
  /** Why. Shown to the requester, so it is written for them, not for a lawyer. */
  reason: string;
  /** Included in an export? */
  exported: boolean;
}

/**
 * Every category of personal data the System holds, and what happens to it.
 *
 * Kept as one list because the alternative is the decision being made
 * separately in an export query and a deletion routine, which is how a field
 * ends up erased but still exported, or exported but never erased.
 */
export const DATA_CATEGORIES: DataCategory[] = [
  {
    label: "Your account",
    models: ["User"],
    disposition: "ERASE",
    reason:
      "Name, email, phone and photograph are removed. The account row itself remains, without " +
      "identity, so records that point at it stay coherent.",
    exported: true,
  },
  {
    label: "Your student record",
    models: ["Student"],
    disposition: "ERASE",
    reason:
      "Identity number, date of birth, guardian details and address are destroyed. The " +
      "registration number is kept: it is printed on certificates and is how a qualification is " +
      "checked years later.",
    exported: true,
  },
  {
    label: "Your admission application",
    models: ["RegistrationRequest", "RegistrationDocument"],
    disposition: "ERASE",
    reason: "The application and any documents you uploaded are removed entirely.",
    exported: true,
  },
  {
    label: "Payments and receipts",
    models: ["Payment"],
    disposition: "RETAIN_ANONYMISED",
    reason:
      "Amounts and dates are kept because the Institute must be able to reconcile its accounts, " +
      "but they no longer name you. Payment slips you uploaded are deleted.",
    exported: true,
  },
  {
    label: "Enrolments, attendance and progress",
    models: ["Enrolment", "AttendanceRecord", "WatchProgress", "AttendanceWarning"],
    disposition: "RETAIN_ANONYMISED",
    reason:
      "Kept without your name so class sizes and attendance statistics stay correct. Nothing in " +
      "them identifies you afterwards.",
    exported: true,
  },
  {
    label: "Your coursework and marks",
    models: ["AssignmentSubmission", "SubmissionFile", "AssignmentGrade", "QuizAttempt", "QuizAnswer"],
    disposition: "RETAIN_ANONYMISED",
    reason:
      "The files you submitted are deleted. The marks are kept without your name, because a " +
      "subject's grade distribution is a record of the teaching as well as of you.",
    exported: true,
  },
  {
    label: "Certificates",
    models: ["Certificate"],
    disposition: "RETAIN_INTACT",
    reason:
      "A certificate must stay verifiable by whoever you gave it to. Erasing it would turn a " +
      "qualification you earned into one that cannot be checked. Ask for it to be REVOKED " +
      "instead if that is what you want.",
    exported: true,
  },
  {
    label: "Messages and notifications",
    models: ["Notification", "NotificationDelivery", "NotificationPreference"],
    disposition: "ERASE",
    reason: "Everything sent to you, and your preferences, are removed.",
    exported: true,
  },
  {
    label: "Sign-in sessions",
    models: ["UserSession"],
    disposition: "ERASE",
    reason: "Every session is ended and the records of them removed.",
    exported: false,
  },
  {
    label: "The audit log",
    models: ["AuditLog"],
    disposition: "RETAIN_INTACT",
    reason:
      "The record of who did what cannot be altered by anybody, including the Institute — that " +
      "is what makes it worth having. It refers to you by an identifier which, after this, " +
      "corresponds to nothing.",
    exported: false,
  },
  {
    label: "Security events",
    models: ["SecurityEvent"],
    disposition: "RETAIN_ANONYMISED",
    reason:
      "Failed sign-ins and lockouts are kept, without your address, because they are evidence " +
      "about attacks on the Institute rather than about you.",
    exported: false,
  },
];

export type RefusalCode =
  | "ACTIVELY_ENROLLED"
  | "OUTSTANDING_BALANCE"
  | "IS_SUPER_ADMIN"
  | "IS_SELF"
  | "ALREADY_ERASED";

export interface ErasureRefusal {
  code: RefusalCode;
  message: string;
}

export interface ErasureSubject {
  userId: string;
  roles: string[];
  activeEnrolments: number;
  outstandingBalance: number;
  alreadyErased: boolean;
}

/**
 * SEC-PRV-006 — may this person be erased?
 *
 * The refusals are all cases where erasing would either break something or be
 * the wrong remedy for what the person actually wants.
 */
export function refuseErasure(
  subject: ErasureSubject,
  requestedBy: string,
): ErasureRefusal | null {
  if (subject.alreadyErased) {
    return {
      code: "ALREADY_ERASED",
      message: "This person's data has already been erased.",
    };
  }

  if (subject.userId === requestedBy) {
    // Not squeamishness. A Super Admin erasing themselves removes the person
    // who can undo it, and BR-ACC-02 already refuses removing the last one.
    return {
      code: "IS_SELF",
      message:
        "You cannot erase your own account here. Ask another Super Admin, so that somebody is " +
        "accountable for the decision besides the person it concerns.",
    };
  }

  if (subject.roles.includes("super_admin")) {
    return {
      code: "IS_SUPER_ADMIN",
      message:
        "A Super Admin cannot be erased while they hold the role. Remove the role first, so the " +
        "Institute is never left without one.",
    };
  }

  if (subject.activeEnrolments > 0) {
    return {
      code: "ACTIVELY_ENROLLED",
      message:
        `This student is enrolled in ${subject.activeEnrolments} ` +
        `${subject.activeEnrolments === 1 ? "subject" : "subjects"}. Withdraw them first — ` +
        `erasing a current student would leave a class with a member nobody can identify.`,
    };
  }

  if (subject.outstandingBalance > 0) {
    // Said as a fact, not a threat. The Institute is entitled to settle its
    // accounts, and erasing the debtor makes that impossible.
    return {
      code: "OUTSTANDING_BALANCE",
      message:
        `There is an outstanding balance of ${subject.outstandingBalance}. Settle or write it ` +
        `off first; after erasure there is nobody to invoice.`,
    };
  }

  return null;
}

/**
 * What an export contains, which depends on WHO ASKED.
 *
 * A student exporting their own record gets what the System would show them on
 * a screen. It is not a way around BR-ASG-09: if an export revealed marks a
 * teacher has not released, the release workflow would be defeated by anybody
 * who thought to press "export", and marking in draft would stop being
 * possible. The export says plainly that marking in progress is excluded, which
 * is the honest thing — silence would read as "you have no marks".
 *
 * An administrator exporting on somebody's behalf is answering a formal
 * request and gets everything, because that is what the request is for. It is a
 * considered act by a named person and it is audited as one.
 */
export function visibilityFor(requesterIsSubject: boolean): {
  includeUnreleasedGrades: boolean;
  includeInternalNotes: boolean;
  note: string;
} {
  if (requesterIsSubject) {
    return {
      includeUnreleasedGrades: false,
      includeInternalNotes: false,
      note:
        "Work that is still being marked is not included, because a mark does not exist until " +
        "your teacher releases it. Ask the Institute for a full copy if you need one.",
    };
  }
  return {
    includeUnreleasedGrades: true,
    // §4.7 — a marker's private notes are the marker's, not the student's, and
    // an administrator answering a request is not the route around that either.
    // Included only if the SRS demanded it; it does not.
    includeInternalNotes: false,
    note: "Prepared by the Institute in response to a request. Includes marking in progress.",
  };
}

/** A summary somebody can read before pressing the button. FR-PRV-008. */
export function erasurePlan(): Array<{ label: string; what: string; reason: string }> {
  return DATA_CATEGORIES.map((c) => ({
    label: c.label,
    what:
      c.disposition === "ERASE"
        ? "Removed"
        : c.disposition === "RETAIN_ANONYMISED"
          ? "Kept, with your name removed"
          : "Kept as it is",
    reason: c.reason,
  }));
}
