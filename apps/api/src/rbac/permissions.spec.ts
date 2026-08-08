/**
 * Negative test suites — SRS §17.2.
 *
 * These prove the System REFUSES what it must refuse. A system can pass every
 * positive test while failing all of these, and the resulting defects are the
 * ones that cause real harm to real students.
 *
 * NFR-MNT-002 requires 100% coverage of authorisation logic. This file covers
 * ROLE ∩ ACTION; scope.spec.ts covers the scope predicate.
 */

import {
  ACTIONS,
  PERMISSION_MATRIX,
  RESOURCES,
  ROLES,
  can,
  resolvePermission,
  type Action,
  type ActorPermissions,
  type Resource,
  type Role,
} from "@lms/shared";

const actor = (role: Role, subs: string[] = [], steppedUp = false): ActorPermissions => ({
  roles: [role],
  subPermissions: subs as ActorPermissions["subPermissions"],
  steppedUp,
});

describe("§17.2 — teacher-to-payment suite", () => {
  // BR-REG-04 and §4.7: a teacher must never reach payment data, through ANY
  // endpoint, export, or report — including for their own students.
  const forbidden: Resource[] = ["payment_slip", "payment", "registration", "report_financial"];

  it.each(forbidden)("teacher is denied every action on %s", (resource) => {
    for (const action of ACTIONS) {
      expect(can(actor("teacher"), resource, action)).toBe(false);
    }
  });

  it("admin CAN read a payment slip (the counterpart to the above)", () => {
    expect(can(actor("admin"), "payment_slip", "read")).toBe(true);
  });

  it("admin without financial_reporter cannot read the revenue report", () => {
    const d = resolvePermission(actor("admin"), "report_financial", "read");
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("missing_sub_permission");
  });

  it("admin WITH financial_reporter can read the revenue report", () => {
    expect(can(actor("admin", ["financial_reporter"]), "report_financial", "read")).toBe(true);
  });
});

describe("§17.2 — student-to-student suite", () => {
  // FR-STU-020: a student must not reach another student's records anywhere.
  it("student never has wider than OWN or ENROLLED scope", () => {
    for (const resource of RESOURCES) {
      for (const action of ACTIONS) {
        const d = resolvePermission(actor("student"), resource, action);
        if (d.allowed) {
          expect(["OWN", "ENROLLED"]).toContain(d.scope);
        }
      }
    }
  });

  it("student is denied internal grading notes entirely", () => {
    // §4.7: internal notes are never visible to a student. This is the whole
    // purpose of the field.
    for (const action of ACTIONS) {
      expect(can(actor("student"), "internal_note", action)).toBe(false);
    }
  });

  it("student is denied the quiz answer key entirely", () => {
    // SEC-AUZ-009 / BR-QIZ-07 — not before release, not during an attempt,
    // not in a field the interface never renders.
    for (const action of ACTIONS) {
      expect(can(actor("student"), "quiz_answer_key", action)).toBe(false);
    }
  });

  it("student cannot read the audit log or security log", () => {
    expect(can(actor("student"), "audit_log", "read")).toBe(false);
    expect(can(actor("student"), "security_log", "read")).toBe(false);
  });
});

describe("§17.2 — privilege and self-modification", () => {
  it("only a super admin may assign roles, and only with step-up", () => {
    expect(can(actor("admin"), "role_assignment", "configure")).toBe(false);
    expect(can(actor("teacher"), "role_assignment", "configure")).toBe(false);
    expect(can(actor("student"), "role_assignment", "configure")).toBe(false);

    // SEC-AUZ-011 — even a super admin needs recent re-authentication.
    const without = resolvePermission(actor("super_admin"), "role_assignment", "configure");
    expect(without.allowed).toBe(false);
    expect(without.reason).toBe("step_up_required");

    expect(can(actor("super_admin", [], true), "role_assignment", "configure")).toBe(true);
  });

  it("a teacher cannot write their own assignment (BR-ACC-04)", () => {
    // The assignment is the SOLE source of ASSIGNED scope, so writing it would
    // let a teacher grant themselves reach over any section.
    expect(can(actor("teacher"), "teacher_assignment", "create")).toBe(false);
    expect(can(actor("teacher"), "teacher_assignment", "update")).toBe(false);
    expect(can(actor("teacher"), "teacher_assignment", "delete")).toBe(false);
    expect(can(actor("teacher"), "teacher_assignment", "read")).toBe(true);
  });

  it("restore requires super admin AND step-up", () => {
    expect(can(actor("admin", ["admin_manager"], true), "restore", "create")).toBe(false);
    expect(resolvePermission(actor("super_admin"), "restore", "create").reason).toBe(
      "step_up_required",
    );
    expect(can(actor("super_admin", [], true), "restore", "create")).toBe(true);
  });

  it("nobody may READ an integration credential (SEC-CRY-010)", () => {
    // Write-only by design: a Super Admin may replace a secret but never
    // retrieve it.
    for (const role of ROLES) {
      expect(can(actor(role, [], true), "integration_credential", "read")).toBe(false);
    }
    expect(can(actor("super_admin", [], true), "integration_credential", "configure")).toBe(true);
  });

  it("the audit log admits no update or delete for any role (FR-LOG-004)", () => {
    for (const role of ROLES) {
      expect(can(actor(role, [], true), "audit_log", "update")).toBe(false);
      expect(can(actor(role, [], true), "audit_log", "delete")).toBe(false);
    }
  });
});

describe("fail-closed behaviour", () => {
  it("an unmapped resource is denied to everyone", () => {
    for (const role of ROLES) {
      const d = resolvePermission(actor(role, [], true), "not_a_real_resource" as Resource, "read");
      expect(d.allowed).toBe(false);
      expect(d.scope).toBe("NONE");
    }
  });

  it("a role with no grant on a mapped resource is denied", () => {
    const d = resolvePermission(actor("student"), "backup", "create");
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("no_grant_for_role");
  });

  it("an actor with no roles is denied everything", () => {
    const nobody: ActorPermissions = { roles: [], subPermissions: [] };
    for (const resource of RESOURCES) {
      for (const action of ACTIONS) {
        expect(can(nobody, resource, action)).toBe(false);
      }
    }
  });
});

describe("multi-role union (FR-RBAC-006)", () => {
  it("takes the widest scope across held roles, never wider", () => {
    const both: ActorPermissions = { roles: ["teacher", "admin"], subPermissions: [] };
    // Admin grants ALL on student_account; teacher only SECTION. Union = ALL.
    expect(resolvePermission(both, "student_account", "read").scope).toBe("ALL");

    // Teacher alone must not be widened by the presence of the student role.
    const teacherStudent: ActorPermissions = { roles: ["teacher", "student"], subPermissions: [] };
    const d = resolvePermission(teacherStudent, "payment", "read");
    // Student has OWN on payment; teacher has none. Union must be OWN, not ALL.
    expect(d.scope).toBe("OWN");
  });
});

describe("matrix integrity", () => {
  it("every resource in RESOURCES has a policy entry", () => {
    for (const resource of RESOURCES) {
      expect(PERMISSION_MATRIX[resource]).toBeDefined();
    }
  });

  it("no policy grants an action outside the declared ACTIONS list", () => {
    const valid = new Set<Action>(ACTIONS);
    for (const [resource, policy] of Object.entries(PERMISSION_MATRIX)) {
      for (const [role, entry] of Object.entries(policy)) {
        const grants = Array.isArray(entry) ? entry : [entry];
        for (const g of grants) {
          for (const a of g!.actions) {
            expect(valid.has(a)).toBe(true);
          }
          // A grant with actions but NONE scope is contradictory and would be
          // a silent deny — catch it at test time rather than in production.
          if (g!.actions.length > 0) {
            expect(g!.scope).not.toBe("NONE");
          }
          expect(ROLES).toContain(role as Role);
          expect(RESOURCES).toContain(resource as Resource);
        }
      }
    }
  });
});
