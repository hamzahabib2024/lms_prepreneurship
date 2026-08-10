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

describe("a student cannot open the grading roster", () => {
  it("is denied submission_roster", () => {
    // The seventh instance of one pattern: a resource named after a TOPIC
    // ("submission") guarding endpoints that serve very different audiences
    // under it. A student holds submission:read for their own work, and that
    // was enough to open the class list with every classmate's name, roll
    // number and marks on it.
    expect(may("student", "submission_roster", "read")).toBe(false);
    expect(may("student", "submission_roster", "export")).toBe(false);
  });

  it("may still read their own submission", () => {
    expect(may("student", "submission", "read")).toBe(true);
    expect(may("student", "submission", "create")).toBe(true);
  });

  it("still lets a teacher mark their cohort (FR-TCH-019)", () => {
    expect(may("teacher", "submission_roster", "read")).toBe(true);
  });

  it("lets a student READ their own grade but never write one", () => {
    // Read is correct and deliberate — it is how a student sees their own
    // mark, and BR-ASG-09 is enforced separately by the AssignmentGrade scope
    // policy, which hides a grade until releasedAt is set. Marking is the
    // write, and that is the teacher's alone.
    expect(may("student", "grade", "read")).toBe(true);
    for (const action of ["create", "update", "delete", "approve"] as const) {
      expect(may("student", "grade", action)).toBe(false);
    }
  });

  it("never grants a student internal grading notes (§4.7)", () => {
    for (const action of ["create", "read", "update", "delete", "approve", "export"] as const) {
      expect(may("student", "internal_note", action)).toBe(false);
    }
  });
});

describe("a student cannot award marks on a quiz", () => {
  it("is denied quiz_answer_grade", () => {
    // The eighth instance, and the first that was a WRITE. Awarding marks for
    // a written answer was guarded by `quiz_attempt:update` — the permission a
    // student needs to save their own answers as they type. A student could
    // therefore mark their own essay, and because the service looked the
    // answer up under asSystem with no ownership check, anyone else's too.
    expect(may("student", "quiz_answer_grade", "update")).toBe(false);
  });

  it("keeps the permission a student DOES need to sit a quiz", () => {
    // The counterpart. A fix that removed quiz_attempt:update would satisfy
    // the assertion above and make every quiz unanswerable.
    expect(may("student", "quiz_attempt", "create")).toBe(true);
    expect(may("student", "quiz_attempt", "update")).toBe(true);
    expect(may("student", "quiz_attempt", "read")).toBe(true);
  });

  it("still lets a teacher mark a written answer (FR-QIZ-031)", () => {
    expect(may("teacher", "quiz_answer_grade", "update")).toBe(true);
  });

  it("never grants a student the answer key", () => {
    // SEC-AUZ-009 / BR-QIZ-07. There is no student key on this resource and
    // there must never be one.
    for (const action of ["create", "read", "update", "delete", "approve", "export"] as const) {
      expect(may("student", "quiz_answer_key", action)).toBe(false);
      expect(may("student", "question_bank", action)).toBe(false);
      expect(may("student", "question", action)).toBe(false);
    }
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
