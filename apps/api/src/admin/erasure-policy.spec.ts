import { Prisma } from "@prisma/client";
import {
  DATA_CATEGORIES,
  erasurePlan,
  refuseErasure,
  visibilityFor,
  type ErasureSubject,
} from "./erasure-policy";

const subject = (over: Partial<ErasureSubject> = {}): ErasureSubject => ({
  userId: "user-1",
  roles: ["student"],
  activeEnrolments: 0,
  outstandingBalance: 0,
  alreadyErased: false,
  ...over,
});

describe("the catalogue of what is held", () => {
  it("names only models that exist", () => {
    // The same guard as the impersonation forbidden-list: a category naming a
    // model that does not exist would look like a decision and erase nothing.
    const known = new Set(Prisma.dmmf.datamodel.models.map((m) => m.name));
    for (const category of DATA_CATEGORIES) {
      for (const model of category.models) {
        expect(known.has(model)).toBe(true);
      }
    }
  });

  it("covers every model that holds a person's identity", () => {
    // The other direction. A new model carrying personal data must be
    // considered here, and this fails until it is.
    const covered = new Set(DATA_CATEGORIES.flatMap((c) => c.models));
    const identityBearing = [
      "User",
      "Student",
      "RegistrationRequest",
      "Payment",
      "Enrolment",
      "AttendanceRecord",
      "AssignmentSubmission",
      "QuizAttempt",
      "Certificate",
      "Notification",
      "UserSession",
      "AuditLog",
      "SecurityEvent",
    ];
    for (const model of identityBearing) {
      expect(covered.has(model)).toBe(true);
    }
  });

  it("gives every category a reason written for the person asking", () => {
    for (const c of DATA_CATEGORIES) {
      expect(c.reason.length).toBeGreaterThan(30);
    }
  });

  it("keeps the audit log intact, and says why", () => {
    // The one nobody may override, including the Institute.
    const log = DATA_CATEGORIES.find((c) => c.models.includes("AuditLog"));
    expect(log?.disposition).toBe("RETAIN_INTACT");
    expect(log?.reason).toContain("cannot be altered");
  });

  it("keeps certificates verifiable, and offers revocation instead", () => {
    const certs = DATA_CATEGORIES.find((c) => c.models.includes("Certificate"));
    expect(certs?.disposition).toBe("RETAIN_INTACT");
    expect(certs?.reason).toContain("REVOKED");
  });

  it("never exports the audit log or session records", () => {
    // They are about the System, and one of them names other people.
    for (const model of ["AuditLog", "UserSession", "SecurityEvent"]) {
      const c = DATA_CATEGORIES.find((x) => x.models.includes(model));
      expect(c?.exported).toBe(false);
    }
  });

  it("exports everything a person would expect to receive", () => {
    for (const model of ["User", "Student", "Payment", "Certificate", "AssignmentSubmission"]) {
      const c = DATA_CATEGORIES.find((x) => x.models.includes(model));
      expect(c?.exported).toBe(true);
    }
  });
});

describe("when erasure is refused", () => {
  it("allows an ordinary former student", () => {
    expect(refuseErasure(subject(), "admin-1")).toBeNull();
  });

  it("refuses somebody still enrolled", () => {
    const r = refuseErasure(subject({ activeEnrolments: 3 }), "admin-1");
    expect(r?.code).toBe("ACTIVELY_ENROLLED");
    expect(r?.message).toContain("3 subjects");
  });

  it("says 'subject' rather than 'subjects' for one", () => {
    expect(refuseErasure(subject({ activeEnrolments: 1 }), "admin-1")?.message).toContain(
      "1 subject.",
    );
  });

  it("refuses somebody who owes money, as a fact rather than a threat", () => {
    const r = refuseErasure(subject({ outstandingBalance: 25000 }), "admin-1");
    expect(r?.code).toBe("OUTSTANDING_BALANCE");
    expect(r?.message).toContain("write it off");
  });

  it("refuses a Super Admin", () => {
    const r = refuseErasure(subject({ roles: ["super_admin"] }), "admin-1");
    expect(r?.code).toBe("IS_SUPER_ADMIN");
    expect(r?.message).toContain("Remove the role first");
  });

  it("refuses erasing yourself", () => {
    // Somebody other than the person concerned should be accountable.
    const r = refuseErasure(subject({ userId: "admin-1" }), "admin-1");
    expect(r?.code).toBe("IS_SELF");
  });

  it("refuses a second time", () => {
    expect(refuseErasure(subject({ alreadyErased: true }), "admin-1")?.code).toBe("ALREADY_ERASED");
  });

  it("reports being already erased BEFORE anything else", () => {
    // Otherwise an already-erased account with a stale balance reports the
    // balance, and somebody goes looking for a debtor who no longer exists.
    const r = refuseErasure(
      subject({ alreadyErased: true, outstandingBalance: 100, activeEnrolments: 2 }),
      "admin-1",
    );
    expect(r?.code).toBe("ALREADY_ERASED");
  });

  it("allows a teacher or an admin who is not a Super Admin", () => {
    expect(refuseErasure(subject({ roles: ["teacher"] }), "admin-1")).toBeNull();
    expect(refuseErasure(subject({ roles: ["admin"] }), "admin-1")).toBeNull();
  });

  it("ignores a zero balance", () => {
    expect(refuseErasure(subject({ outstandingBalance: 0 }), "admin-1")).toBeNull();
  });
});

describe("what an export contains depends on who asked", () => {
  it("withholds unreleased marks from the student themselves", () => {
    // BR-ASG-09. If an export revealed them, the release workflow would be
    // defeated by anybody who thought to press "export".
    const v = visibilityFor(true);
    expect(v.includeUnreleasedGrades).toBe(false);
    expect(v.note).toContain("still being marked");
  });

  it("tells them so, rather than silently omitting", () => {
    // Silence would read as "you have no marks".
    expect(visibilityFor(true).note).toContain("Ask the Institute");
  });

  it("includes them for an administrator answering a formal request", () => {
    expect(visibilityFor(false).includeUnreleasedGrades).toBe(true);
  });

  it("never includes a marker's internal notes, for either", () => {
    // §4.7. An administrator answering a request is not the route around it.
    expect(visibilityFor(true).includeInternalNotes).toBe(false);
    expect(visibilityFor(false).includeInternalNotes).toBe(false);
  });
});

describe("the plan shown before pressing the button", () => {
  it("has a line for every category", () => {
    expect(erasurePlan()).toHaveLength(DATA_CATEGORIES.length);
  });

  it("says what happens in words a person can act on", () => {
    const plan = erasurePlan();
    expect(plan.map((p) => p.what)).toEqual(
      expect.arrayContaining(["Removed", "Kept, with your name removed", "Kept as it is"]),
    );
  });

  it("never claims something is removed when it is kept", () => {
    const plan = erasurePlan();
    for (const [i, entry] of plan.entries()) {
      const category = DATA_CATEGORIES[i];
      if (category?.disposition !== "ERASE") {
        expect(entry.what).toContain("Kept");
      }
    }
  });
});
