/**
 * Student isolation — SRS §17.2, FR-STU-020, SEC-AUZ-004/006.
 *
 * REGRESSION TESTS. A live probe found five defects, one of them serious: a
 * student could mark the entire class present.
 *
 * Every one was a WIRING defect. The scope predicate held in all five cases —
 * a student asking for a classmate's attendance got zeros, not marks, and the
 * registration queue returned no rows. What was wrong was the resource each
 * endpoint declared, and no unit test caught that because the tests asserted
 * the matrix, and the matrix was never wrong.
 */

import { resolvePermission, type ActorPermissions, type Resource } from "@lms/shared";

const actor = (role: ActorPermissions["roles"][number]): ActorPermissions => ({
  roles: [role],
  subPermissions: [],
  steppedUp: true,
});

const may = (
  role: ActorPermissions["roles"][number],
  resource: Resource,
  action: Parameters<typeof resolvePermission>[2],
): boolean => resolvePermission(actor(role), resource, action).allowed;

describe("a student cannot mark attendance for anyone", () => {
  it("is denied the class register outright", () => {
    // THE SERIOUS ONE. `attendance` previously granted a student `update`
    // "for self check-in", and the bulk-marking endpoint accepted the same
    // permission — so a student could mark all eight classmates PRESENT.
    // Bulk marking runs in asSystem(), which bypasses the scope predicate by
    // design, so nothing downstream would have stopped it.
    expect(may("student", "attendance_register", "read")).toBe(false);
    expect(may("student", "attendance_register", "update")).toBe(false);
    expect(may("student", "attendance_register", "create")).toBe(false);
  });

  it("may still read their OWN attendance", () => {
    // The counterpart. A fix that denied students all attendance access would
    // satisfy the assertion above and break the student dashboard.
    expect(may("student", "attendance", "read")).toBe(true);
  });

  it("may no longer UPDATE the shared attendance resource", () => {
    expect(may("student", "attendance", "update")).toBe(false);
  });

  it("has self check-in as its own narrow grant (FR-ATT-008)", () => {
    // Separated so that granting a student the ability to confirm their own
    // presence can never again imply the ability to mark a class.
    expect(may("student", "attendance_self_checkin", "update")).toBe(true);
    expect(may("student", "attendance_self_checkin", "read")).toBe(false);
  });

  it("still lets a teacher run the register", () => {
    expect(may("teacher", "attendance_register", "read")).toBe(true);
    expect(may("teacher", "attendance_register", "update")).toBe(true);
  });

  it("does not let a teacher self check-in on a student's behalf", () => {
    expect(may("teacher", "attendance_self_checkin", "update")).toBe(false);
  });
});

describe("a student cannot reach the administrative admission queue", () => {
  it("is denied registration_queue", () => {
    // The queue returned zero rows thanks to the scope predicate, so nothing
    // leaked — but it answered 200, and an administrative endpoint should not
    // be reachable at all.
    for (const action of ["read", "update", "approve", "export"] as const) {
      expect(may("student", "registration_queue", action)).toBe(false);
    }
  });

  it("may still read their OWN application", () => {
    // FR-REG-020 — a student checking their own admission status.
    expect(may("student", "registration", "read")).toBe(true);
  });

  it("is denied a teacher too, who has no business in admissions (BR-REG-04)", () => {
    expect(may("teacher", "registration_queue", "read")).toBe(false);
  });

  it("is allowed for an admin", () => {
    expect(may("admin", "registration_queue", "read")).toBe(true);
    expect(may("super_admin", "registration_queue", "read")).toBe(true);
  });
});

describe("a student cannot open the class list", () => {
  it("is denied progress_cohort", () => {
    // Found while building the student screens. The cohort view lists every
    // classmate by name, roll number, attendance and average grade, ordered
    // worst-first — and a student's own `progress:read` was enough to open it.
    // The scope predicate reduced the answer to their own row, so nothing
    // leaked, but a teaching tool should refuse rather than return a list of
    // one (SEC-AUZ-006).
    expect(may("student", "progress_cohort", "read")).toBe(false);
    expect(may("student", "progress_cohort", "export")).toBe(false);
  });

  it("may still read their own progress", () => {
    expect(may("student", "progress", "read")).toBe(true);
  });

  it("still lets a teacher see their cohort (FR-PRG-011)", () => {
    expect(may("teacher", "progress_cohort", "read")).toBe(true);
  });
});

describe("matrix invariants that prevented the original defects", () => {
  it("no student grant is wider than OWN or ENROLLED", () => {
    const RESOURCES_TO_CHECK: Resource[] = [
      "attendance",
      "attendance_register",
      "attendance_self_checkin",
      "registration",
      "registration_queue",
      "progress",
      "progress_cohort",
      "enrolment",
    ];
    for (const resource of RESOURCES_TO_CHECK) {
      for (const action of ["create", "read", "update", "delete", "approve", "export"] as const) {
        const decision = resolvePermission(actor("student"), resource, action);
        if (decision.allowed) {
          expect(["OWN", "ENROLLED"]).toContain(decision.scope);
        }
      }
    }
  });

  it("a student holds no write on anything about another person", () => {
    // A blunt sweep. Writing is where the damage is, and the register defect
    // was exactly a write that looked like a read-adjacent convenience.
    const writeActions = ["create", "update", "delete", "approve"] as const;
    const othersResources: Resource[] = [
      "attendance_register",
      "attendance_correction",
      "registration_queue",
      "student_account",
      "teacher_assignment",
      "section",
      "enrolment",
      "grade",
      "internal_note",
    ];
    for (const resource of othersResources) {
      for (const action of writeActions) {
        if (resource === "student_account" && action === "update") continue; // own profile
        expect(may("student", resource, action)).toBe(false);
      }
    }
  });
});
