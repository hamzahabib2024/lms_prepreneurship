import { AsyncLocalStorage } from "node:async_hooks";
import type { Role, Scope, SubPermission } from "@lms/shared";

/**
 * The identity and reach of whoever is making the current request.
 *
 * §4.1.1 / FR-RBAC-002: every field here is derived from the server-side
 * session, NEVER from a client-supplied value. A `sectionId` in a query string
 * is a filter to be validated; it is not an authorisation input.
 */
export interface Actor {
  userId: string;
  roles: readonly Role[];
  subPermissions: readonly SubPermission[];

  /** Set when the user holds the student role. */
  studentId?: string;
  /** Set when the user holds the teacher role. */
  teacherId?: string;
  /**
   * Set when the user holds `partner_admin`: the institute they act for.
   *
   * THEIR ENTIRE REACH IS THIS ONE VALUE. Every PARTNER predicate in
   * scope.extension.ts resolves from it, and a partner_admin without it
   * reaches nothing at all — which is the direction this has to fail in. Like
   * every other field here it comes from the session and never from anything
   * the client sent.
   */
  partnerInstituteId?: string;

  /**
   * SectionSubject ids the actor may reach.
   *
   *  - teacher: those with a live TeacherAssignment  → ASSIGNED scope
   *  - student: those with an ACTIVE Enrolment       → ENROLLED scope
   *
   * Resolved once per request and cached for at most 15 minutes
   * (FR-RBAC-003), purged synchronously on any assignment or enrolment change
   * (ARC-047, SEC-SES-009).
   */
  sectionSubjectIds: readonly string[];

  /** Section ids reachable — used by SECTION scope. */
  sectionIds: readonly string[];

  /** Epoch ms of the last step-up re-authentication (SEC-AUZ-011). */
  steppedUpAt?: number;

  /** SEC-AUZ-013 — set while a Super Admin is impersonating someone. */
  impersonatedBy?: string;

  /** ARC-008 — threaded through logs, jobs, and provider calls. */
  correlationId: string;
}

/**
 * A SYSTEM principal for background jobs (§4.2.5, FR-LOG-005).
 *
 * Work done by the scheduler is attributed to SYSTEM in the audit log, never
 * to a human user who happens to have triggered it indirectly.
 */
export const SYSTEM_ACTOR: Actor = Object.freeze({
  userId: "00000000-0000-0000-0000-000000000000",
  roles: [],
  subPermissions: [],
  sectionSubjectIds: [],
  sectionIds: [],
  correlationId: "00000000-0000-0000-0000-000000000000",
});

interface Store {
  actor: Actor | null;
  /**
   * When true the scope predicate is skipped for this call.
   *
   * Deliberately NOT part of Actor: bypassing is an explicit, auditable act at
   * a specific call site, not a property someone can acquire. See
   * PrismaService.asSystem().
   */
  bypass: boolean;
}

const storage = new AsyncLocalStorage<Store>();

/** Runs `fn` with `actor` as the ambient identity for every query inside it. */
export function runWithActor<T>(actor: Actor | null, fn: () => T): T {
  return storage.run({ actor, bypass: false }, fn);
}

/**
 * Runs `fn` with the scope predicate DISABLED.
 *
 * Legitimate uses are narrow and each one should be obvious from the call
 * site: authentication (we must load a user before we know who they are),
 * registration approval provisioning (creating records for a student who has
 * no session yet), scheduled jobs, and migrations.
 *
 * Anything else is a bug. If a request handler needs this, the scope policy
 * for that model is wrong and should be fixed there instead.
 */
export function runUnscoped<T>(fn: () => T): T {
  const current = storage.getStore();
  return storage.run({ actor: current?.actor ?? null, bypass: true }, fn);
}

export function getActor(): Actor | null {
  return storage.getStore()?.actor ?? null;
}

export function isBypassed(): boolean {
  return storage.getStore()?.bypass ?? false;
}

/** Widest scope the actor could hold, before any per-model policy is applied. */
export function widestScopeFor(actor: Actor): Scope {
  if (actor.roles.includes("super_admin") || actor.roles.includes("admin")) return "ALL";
  if (actor.roles.includes("teacher")) return "ASSIGNED";
  if (actor.roles.includes("student")) return "ENROLLED";
  return "NONE";
}
