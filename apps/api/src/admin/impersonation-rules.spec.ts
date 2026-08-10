import { RESOURCES, type Resource } from "@lms/shared";
import {
  IMPERSONATION_TTL_MINUTES,
  __testing,
  refuseImpersonation,
  refuseReason,
  refuseWhileImpersonating,
  type ImpersonationActor,
  type ImpersonationTarget,
} from "./impersonation-rules";

const superAdmin: ImpersonationActor = { userId: "super-1", roles: ["super_admin"] };

const target = (over: Partial<ImpersonationTarget> = {}): ImpersonationTarget => ({
  id: "user-2",
  roles: ["student"],
  status: "ACTIVE",
  deletedAt: null,
  ...over,
});

describe("the forbidden list names REAL resources", () => {
  it("every entry exists in the §4.5 matrix", () => {
    // THE GUARD THAT MATTERS. A forbidden-list entry with a typo silently
    // protects nothing: the guard looks up a resource nobody ever asks for and
    // waves everything through. Five of the ten entries were invented on the
    // first attempt at this list, and this test is why that was caught.
    const known = new Set<string>(RESOURCES as readonly string[]);
    for (const entry of __testing.FORBIDDEN_WHILE_IMPERSONATING) {
      expect(known.has(entry)).toBe(true);
    }
  });

  it("covers every resource that can change a credential", () => {
    // The other direction: a new credential resource added to the matrix
    // should be considered here. Named explicitly so adding one fails this
    // test rather than quietly widening what an impersonator may do.
    const credentialResources: Resource[] = [
      "own_password",
      "other_user_password",
      "other_user_session",
      "role_assignment",
    ];
    for (const r of credentialResources) {
      expect(__testing.FORBIDDEN_WHILE_IMPERSONATING.has(r)).toBe(true);
    }
  });
});

describe("who may impersonate", () => {
  it("allows a Super Admin to act as a student", () => {
    expect(refuseImpersonation(superAdmin, target())).toBeNull();
  });

  it("allows acting as a teacher", () => {
    expect(refuseImpersonation(superAdmin, target({ roles: ["teacher"] }))).toBeNull();
  });

  it("allows acting as an admin", () => {
    // An Admin is not a Super Admin; support for them is legitimate.
    expect(refuseImpersonation(superAdmin, target({ roles: ["admin"] }))).toBeNull();
  });

  it("refuses an ADMIN attempting it", () => {
    const admin: ImpersonationActor = { userId: "admin-1", roles: ["admin"] };
    expect(refuseImpersonation(admin, target())?.code).toBe("NOT_SUPER_ADMIN");
  });

  it("refuses a teacher and a student", () => {
    for (const role of ["teacher", "student"]) {
      expect(refuseImpersonation({ userId: "u", roles: [role] }, target())?.code).toBe(
        "NOT_SUPER_ADMIN",
      );
    }
  });
});

describe("who may NOT be impersonated", () => {
  it("refuses another Super Admin", () => {
    // Otherwise the highest privilege is reachable by holding it, mutually, and
    // the record of who decided anything becomes circular.
    const refusal = refuseImpersonation(superAdmin, target({ roles: ["super_admin"] }));
    expect(refusal?.code).toBe("TARGET_IS_SUPER_ADMIN");
    expect(refusal?.message).toContain("circular");
  });

  it("refuses a Super Admin who also holds another role", () => {
    expect(
      refuseImpersonation(superAdmin, target({ roles: ["teacher", "super_admin"] }))?.code,
    ).toBe("TARGET_IS_SUPER_ADMIN");
  });

  it("refuses yourself", () => {
    expect(refuseImpersonation(superAdmin, target({ id: "super-1" }))?.code).toBe("TARGET_IS_SELF");
  });

  it("refuses a suspended account", () => {
    // Acting as a suspended user would let the System do things it is
    // currently refusing them.
    const refusal = refuseImpersonation(superAdmin, target({ status: "SUSPENDED" }));
    expect(refusal?.code).toBe("TARGET_INACTIVE");
    expect(refusal?.message).toContain("suspended");
  });

  it("refuses a locked account", () => {
    expect(refuseImpersonation(superAdmin, target({ status: "LOCKED" }))?.code).toBe(
      "TARGET_INACTIVE",
    );
  });

  it("refuses a deleted account", () => {
    expect(
      refuseImpersonation(superAdmin, target({ deletedAt: new Date() }))?.code,
    ).toBe("TARGET_DELETED");
  });
});

describe("no nesting", () => {
  it("refuses an already-impersonating session", () => {
    // impersonatedBy is one column. A chain would record only the last link.
    const inside: ImpersonationActor = {
      userId: "user-2",
      roles: ["super_admin"],
      impersonatedBy: "super-1",
    };
    const refusal = refuseImpersonation(inside, target({ id: "user-3" }));
    expect(refusal?.code).toBe("ALREADY_IMPERSONATING");
  });

  it("refuses it BEFORE checking the role", () => {
    // The message must explain the nesting, not say "you are not a Super
    // Admin" to somebody wearing a student's identity.
    const inside: ImpersonationActor = {
      userId: "student-9",
      roles: ["student"],
      impersonatedBy: "super-1",
    };
    expect(refuseImpersonation(inside, target({ id: "user-3" }))?.code).toBe(
      "ALREADY_IMPERSONATING",
    );
  });
});

describe("what an impersonated session may not do", () => {
  it("allows reading anything", () => {
    // The whole purpose is to see what they see.
    for (const resource of ["own_password", "own_profile", "role_assignment", "grade"]) {
      expect(refuseWhileImpersonating(resource, "read").refused).toBe(false);
    }
  });

  it("allows exporting", () => {
    expect(refuseWhileImpersonating("own_profile", "export").refused).toBe(false);
  });

  it("refuses changing a password", () => {
    // The rule that stops impersonation becoming permanent account theft.
    const r = refuseWhileImpersonating("own_password", "update");
    expect(r.refused).toBe(true);
    expect(r.message).toContain("outlive itself");
  });

  it("refuses changing somebody else's password", () => {
    expect(refuseWhileImpersonating("other_user_password", "update").refused).toBe(true);
  });

  it("refuses editing the profile, which carries the email", () => {
    // Where a password reset is delivered.
    expect(refuseWhileImpersonating("own_profile", "update").refused).toBe(true);
  });

  it("refuses signing OTHER people out", () => {
    expect(refuseWhileImpersonating("other_user_session", "delete").refused).toBe(true);
  });

  it("ALLOWS own_session:delete, because that is how you stop", () => {
    // Forbidding it would trap the impersonator inside somebody else's
    // identity until the token expired — the exact trap this feature avoids.
    // Revoking your own sessions grants no persistence; minting one would, and
    // that does not go through this resource.
    expect(refuseWhileImpersonating("own_session", "delete").refused).toBe(false);
  });

  it("refuses granting roles or changing account state", () => {
    expect(refuseWhileImpersonating("role_assignment", "configure").refused).toBe(true);
    expect(refuseWhileImpersonating("account_state", "update").refused).toBe(true);
  });

  it("refuses impersonating onward", () => {
    expect(refuseWhileImpersonating("impersonation", "create").refused).toBe(true);
  });

  it("ALLOWS ordinary work, which is the point", () => {
    // A support session that can change nothing cannot reproduce the problem.
    for (const resource of ["submission", "quiz_attempt", "notification", "watch_progress"]) {
      expect(refuseWhileImpersonating(resource, "update").refused).toBe(false);
      expect(refuseWhileImpersonating(resource, "create").refused).toBe(false);
    }
  });
});

describe("the reason", () => {
  it("is required", () => {
    expect(refuseReason("")?.code).toBe("REASON_TOO_SHORT");
  });

  it("must say something", () => {
    expect(refuseReason("test")?.code).toBe("REASON_TOO_SHORT");
    expect(refuseReason("        ")?.code).toBe("REASON_TOO_SHORT");
  });

  it("accepts a real one", () => {
    expect(refuseReason("Investigating a report that grades are missing.")).toBeNull();
  });

  it("says who reads it, so it is written for them", () => {
    expect(refuseReason("x")?.message).toContain("audit log");
  });
});

describe("the time limit", () => {
  it("is short", () => {
    expect(IMPERSONATION_TTL_MINUTES).toBeLessThanOrEqual(30);
  });

  it("is long enough to be useful", () => {
    expect(IMPERSONATION_TTL_MINUTES).toBeGreaterThanOrEqual(5);
  });
});
