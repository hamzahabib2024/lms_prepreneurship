import { AppError } from "@lms/shared";
import { getActor } from "../prisma/actor-context";

/**
 * Ownership checks for routes that name a subject in the path.
 *
 * SEC-AUZ-004 forbids insecure direct object reference: requesting a resource
 * by identifier must be authorised against THAT identifier. The scope
 * predicate (ARC-051) already prevents another student's DATA being returned,
 * and a live probe confirmed it holds — a student asking for a classmate's
 * attendance got zeros, not marks.
 *
 * But zeros with a 200 still tell the caller the identifier is real, and
 * SEC-AUZ-006 requires 403 rather than a response that discloses existence.
 * These helpers close that gap at the route boundary, so the answer is the
 * same whether or not the record exists.
 */

/**
 * Asserts the caller may act on this studentId.
 *
 * A student may only ever name themselves. Everyone else is governed by the
 * scope predicate, which is stricter than anything this function could add:
 * a teacher naming a student outside their sections gets an empty result
 * regardless.
 */
export function assertOwnStudent(studentId: string): void {
  const actor = getActor();
  if (!actor) throw new AppError("AUTH_TOKEN_INVALID");

  const isStudent = actor.roles.includes("student");
  const isPrivileged =
    actor.roles.includes("super_admin") ||
    actor.roles.includes("admin") ||
    actor.roles.includes("teacher");

  if (isStudent && !isPrivileged && actor.studentId !== studentId) {
    // 403, never 404: distinguishing "does not exist" from "not yours" tells
    // an attacker which identifiers are real (SEC-AUZ-006).
    throw new AppError("AUTH_FORBIDDEN", {
      message: "You can only view your own records.",
    });
  }
}

/**
 * Resolves "the student this request is about", preferring the caller's own
 * identity where the route allows either.
 */
export function requireOwnStudentId(): string {
  const actor = getActor();
  if (!actor?.studentId) {
    throw new AppError("AUTH_FORBIDDEN", {
      message: "This view is for students. Your account is not a student account.",
    });
  }
  return actor.studentId;
}

/**
 * Asserts the caller may act ON a subject-section.
 *
 * THE SCOPE PREDICATE DOES NOT CONSTRAIN `create`.
 *
 * ARC-051 injects a `where`, and a create has none. The extension constrains
 * reads and updateMany/deleteMany; an INSERT names its own foreign keys and
 * there is nothing to filter. So any create that takes a sectionSubjectId from
 * the caller is unguarded unless it is checked here.
 *
 * That is not theoretical. A teacher was able to post an announcement to a
 * class they do not teach, and to create an assignment in one — setting
 * homework for another teacher's students, who would see it and submit to it.
 *
 * Reads are safe because the predicate applies; writes that follow a scoped
 * read are safe because the read refuses first. It is the create with no
 * preceding read that needs this.
 */
export function assertOwnsSectionSubject(sectionSubjectId: string): void {
  const actor = getActor();
  if (!actor) throw new AppError("AUTH_TOKEN_INVALID");

  // An Admin has ALL scope over academic structure; the matrix has already
  // decided they may act, and there is no section to be outside of.
  if (actor.roles.includes("super_admin") || actor.roles.includes("admin")) return;

  if (!actor.sectionSubjectIds.includes(sectionSubjectId)) {
    // 403 rather than 404: the caller supplied this id, so they already know it
    // exists. Pretending otherwise buys nothing and reads as a fault.
    throw new AppError("AUTH_FORBIDDEN", {
      message: "You are not assigned to teach that subject.",
    });
  }
}

/** The same, for a whole section. */
export function assertOwnsSection(sectionId: string): void {
  const actor = getActor();
  if (!actor) throw new AppError("AUTH_TOKEN_INVALID");
  if (actor.roles.includes("super_admin") || actor.roles.includes("admin")) return;

  if (!actor.sectionIds.includes(sectionId)) {
    throw new AppError("AUTH_FORBIDDEN", {
      message: "You are not assigned to that batch.",
    });
  }
}

/** Institute-wide acts belong to an Admin, never to a teacher. */
export function assertInstituteWide(): void {
  const actor = getActor();
  if (!actor) throw new AppError("AUTH_TOKEN_INVALID");
  if (actor.roles.includes("super_admin") || actor.roles.includes("admin")) return;

  throw new AppError("AUTH_FORBIDDEN", {
    message: "Only an administrator can do that for the whole Institute.",
  });
}
