import { PERMISSION_MATRIX, resolvePermission, type Action, type Role } from "@lms/shared";
import { noteCreateSchema, noteUpdateSchema } from "@lms/shared";
import { __testing } from "../prisma/scope.extension";

const { MODEL_POLICIES } = __testing;

/**
 * Staff notes about a student — FR-REG-046.
 *
 * The property under test is a negative one, and it is the reason the feature
 * has its own table: a student must never reach a note written about them.
 * That is asserted here in both places it is decided — the permission matrix
 * and the scope policy — because either one alone would be a single point of
 * failure for the kind of text this holds.
 */

/** resolvePermission takes an actor, not a role name. */
const as = (role: Role) => ({ roles: [role], subPermissions: [] });

const actor = (over: Partial<Record<string, unknown>> = {}) =>
  ({
    userId: "u1",
    roles: ["teacher"],
    sectionSubjectIds: [] as readonly string[],
    studentId: null,
    teacherId: "t1",
    ...over,
  }) as never;

describe("who may touch an internal note (§4.5)", () => {
  it("GRANTS a teacher the full set over their own classes", () => {
    // The grant is asserted alongside the refusals below: testing only that a
    // student is refused would pass just as well if nobody could write one.
    for (const action of ["create", "read", "update", "delete"] as Action[]) {
      expect(resolvePermission(as("teacher"), "internal_note", action).allowed).toBe(true);
    }
    expect(resolvePermission(as("teacher"), "internal_note", "read").scope).toBe("ASSIGNED");
  });

  it("gives an Admin read and NOT the ability to rewrite one", () => {
    expect(resolvePermission(as("admin"), "internal_note", "read").allowed).toBe(true);
    expect(resolvePermission(as("admin"), "internal_note", "update").allowed).toBe(false);
    expect(resolvePermission(as("admin"), "internal_note", "delete").allowed).toBe(false);
  });

  it("REFUSES A STUDENT EVERY ACTION, including read", () => {
    for (const action of ["create", "read", "update", "delete"] as Action[]) {
      expect(resolvePermission(as("student"), "internal_note", action).allowed).toBe(false);
    }
  });

  it("names no student role in the matrix entry at all", () => {
    // Stronger than the loop above, which would still pass if somebody added
    // `student: { actions: [] }` — an entry that reads as considered-and-empty
    // and is one edit away from being filled in.
    expect(PERMISSION_MATRIX["internal_note"]).not.toHaveProperty("student");
  });
});

describe("the scope policy, which is the second lock", () => {
  const policy = MODEL_POLICIES["StudentNote"]!;

  it("exists at all — an unpoliced model is readable by anyone who passes the role check", () => {
    expect(policy).toBeDefined();
  });

  it("DENIES a student, even for a note about themselves", () => {
    const where = policy(actor({ roles: ["student"], studentId: "s1", teacherId: null }));
    // DENY_ALL, not null and not a filter naming them. A student's own id is
    // what every other policy grants on; here it must grant nothing.
    expect(where).not.toBeNull();
    expect(JSON.stringify(where)).not.toContain("s1");
  });

  it("denies a student whose own id happens to be absent too", () => {
    const where = policy(actor({ roles: ["student"], studentId: null, teacherId: null }));
    expect(where).not.toBeNull();
  });

  it("gives an Admin the unfiltered view", () => {
    expect(policy(actor({ roles: ["admin"] }))).toBeNull();
    expect(policy(actor({ roles: ["super_admin"] }))).toBeNull();
  });

  it("limits a teacher to the classes they actually teach", () => {
    const where = policy(actor({ sectionSubjectIds: ["ss1", "ss2"] })) as {
      sectionSubjectId: { in: string[] };
    };
    expect(where.sectionSubjectId.in).toEqual(["ss1", "ss2"]);
  });

  it("denies a teacher who is assigned to nothing, rather than returning an empty IN", () => {
    // `{ in: [] }` is a filter that matches nothing today and is easy to
    // mistake for "no filter" when reading. DENY_ALL says what it means.
    const where = policy(actor({ sectionSubjectIds: [] }));
    expect(JSON.stringify(where)).not.toBe('{"sectionSubjectId":{"in":[]}}');
    expect(where).not.toBeNull();
  });

  it("denies somebody holding no role at all", () => {
    expect(policy(actor({ roles: [] }))).not.toBeNull();
  });
});

describe("what a note may contain", () => {
  const id = "018f2b04-0000-7000-8000-000000000000";

  it("requires the class it was written from", () => {
    // BR-ACC-04 — a teacher's authority is a subject WITHIN a section, so a
    // note with no class recorded could not later be shown to the right people.
    expect(() => noteCreateSchema.parse({ body: "Struggling with typography." })).toThrow();
    expect(() =>
      noteCreateSchema.parse({ sectionSubjectId: id, body: "Struggling with typography." }),
    ).not.toThrow();
  });

  it("refuses an empty or near-empty note", () => {
    for (const body of ["", "  ", "ok"]) {
      expect(() => noteCreateSchema.parse({ sectionSubjectId: id, body })).toThrow();
    }
  });

  it("bounds the length, so one note cannot be a file", () => {
    expect(() =>
      noteCreateSchema.parse({ sectionSubjectId: id, body: "x".repeat(4001) }),
    ).toThrow();
    expect(() =>
      noteCreateSchema.parse({ sectionSubjectId: id, body: "x".repeat(4000) }),
    ).not.toThrow();
  });

  it("does not let an edit move the note to another class", () => {
    // Moving it would move who can read it, which is a permission change
    // wearing the clothes of a typo fix.
    const parsed = noteUpdateSchema.parse({ sectionSubjectId: id, body: "Revised." } as never);
    expect(parsed).not.toHaveProperty("sectionSubjectId");
  });

  it("trims, so a note of only whitespace cannot be saved", () => {
    expect(() => noteUpdateSchema.parse({ body: "   \n\t  " })).toThrow();
  });
});
