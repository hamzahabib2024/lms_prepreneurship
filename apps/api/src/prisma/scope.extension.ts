/**
 * ARC-051 — THE SCOPE PREDICATE.
 *
 * This file is the single mechanism by which SEC-AUZ-002 and SEC-AUZ-005 are
 * satisfied. Every read of a scoped model passes through it, and the predicate
 * is injected into the QUERY — not applied to the result — so out-of-scope rows
 * are never retrieved in the first place.
 *
 * §3.11 (ARC-051) forbids per-endpoint scope filtering. Applying this by hand
 * at each call site guarantees that one call site will eventually omit it, and
 * the resulting bug is invisible in every positive test. The negative suites in
 * §17.2 exist to prove this layer works; they cannot prove that 200 hand-written
 * filters all work.
 *
 * ---------------------------------------------------------------------------
 * IF YOU ARE ABOUT TO ADD A MODEL
 * ---------------------------------------------------------------------------
 * Add it to MODEL_POLICIES below. A model that is absent is treated as
 * UNSCOPED and is therefore readable by anyone who passes the role check.
 * That default is deliberate for genuinely public reference data (Programme,
 * Subject) but it is WRONG for anything carrying student data. When in doubt,
 * add a policy.
 */

import { Prisma } from "@prisma/client";
import { getActor, isBypassed, type Actor } from "./actor-context";

/** Read operations that accept a `where` we can constrain. */
const READ_OPS = new Set([
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "findUnique",
  "findUniqueOrThrow",
  "count",
  "aggregate",
  "groupBy",
]);

/** Writes we also constrain, so an update cannot reach outside scope. */
const SCOPED_WRITE_OPS = new Set(["updateMany", "deleteMany"]);

type WhereFragment = Record<string, unknown>;

/**
 * A policy returns the `where` fragment that limits this model to what the
 * actor may see.
 *
 *   - return `null`  → no restriction (the actor has ALL scope here)
 *   - return DENY_ALL → the actor may see nothing of this model
 */
type PolicyFn = (actor: Actor) => WhereFragment | null;

/** A predicate that can never match. Safer than throwing: lists come back empty. */
const DENY_ALL: WhereFragment = { id: { in: [] } };

const isAdmin = (a: Actor) => a.roles.includes("super_admin") || a.roles.includes("admin");
const isTeacher = (a: Actor) => a.roles.includes("teacher");
const isStudent = (a: Actor) => a.roles.includes("student");

/**
 * Per-model scope policies.
 *
 * The keys are Prisma model names. Each entry is written from the point of view
 * of "what does this actor legitimately reach?", and mirrors the scope column
 * of the §4.5 matrix.
 */
const MODEL_POLICIES: Record<string, PolicyFn> = {
  // ------------------------------------------------------------- identity --
  User: (a) => {
    if (isAdmin(a)) return null;
    // A teacher may read students in their assigned sections (§4.5.1), but the
    // roster path goes through Student, so from the User model they see only
    // themselves. Narrower is correct: widen deliberately, never by accident.
    return { id: a.userId };
  },

  UserSession: (a) => (isAdmin(a) ? null : { userId: a.userId }),

  UserRole: (a) => (isAdmin(a) ? null : { userId: a.userId }),

  // ------------------------------------------------------------- students --
  Student: (a) => {
    if (isAdmin(a)) return null;
    if (isTeacher(a)) {
      // SECTION scope: students enrolled in a subject-section this teacher
      // actively teaches. Note this reaches through Enrolment rather than
      // trusting Student.currentSectionId, which is denormalised (§8.5).
      return {
        enrolments: {
          some: {
            status: "ACTIVE",
            sectionSubjectId: { in: [...a.sectionSubjectIds] },
          },
        },
      };
    }
    if (isStudent(a)) return a.studentId ? { id: a.studentId } : DENY_ALL;
    return DENY_ALL;
  },

  Teacher: (a) => {
    if (isAdmin(a)) return null;
    if (isTeacher(a)) return a.teacherId ? { id: a.teacherId } : DENY_ALL;
    // Students may see who teaches them; that goes through TeacherAssignment.
    return DENY_ALL;
  },

  // ------------------------------------------------------------ admission --
  // §4.7 and BR-REG-04: a teacher must NEVER reach a registration or a payment
  // slip. There is no teacher branch here, and there must never be one.
  RegistrationRequest: (a) => {
    if (isAdmin(a)) return null;
    if (isStudent(a)) return a.studentId ? { createdStudentId: a.studentId } : DENY_ALL;
    return DENY_ALL;
  },

  RegistrationDocument: (a) => {
    if (isAdmin(a)) return null;
    if (isStudent(a)) {
      return a.studentId
        ? { registrationRequest: { createdStudentId: a.studentId } }
        : DENY_ALL;
    }
    return DENY_ALL;
  },

  Payment: (a) => {
    if (isAdmin(a)) return null;
    if (isStudent(a)) return a.studentId ? { studentId: a.studentId } : DENY_ALL;
    return DENY_ALL; // teachers: never
  },

  // ------------------------------------------------------------- academic --
  SectionSubject: (a) => {
    if (isAdmin(a)) return null;
    if (isTeacher(a) || isStudent(a)) return { id: { in: [...a.sectionSubjectIds] } };
    return DENY_ALL;
  },

  Section: (a) => {
    if (isAdmin(a)) return null;
    if (a.sectionIds.length === 0) return DENY_ALL;
    return { id: { in: [...a.sectionIds] } };
  },

  Enrolment: (a) => {
    if (isAdmin(a)) return null;
    if (isTeacher(a)) return { sectionSubjectId: { in: [...a.sectionSubjectIds] } };
    if (isStudent(a)) return a.studentId ? { studentId: a.studentId } : DENY_ALL;
    return DENY_ALL;
  },

  TeacherAssignment: (a) => {
    if (isAdmin(a)) return null;
    if (isTeacher(a)) return a.teacherId ? { teacherId: a.teacherId } : DENY_ALL;
    return DENY_ALL;
  },

  // -------------------------------------------------------------- content --
  // BR-CNT-01: draft content is invisible to students in every list, count,
  // search result and API response. That is enforced HERE, once, rather than
  // being remembered at each query.
  Module: (a) => {
    if (isAdmin(a)) return null;
    if (isTeacher(a)) {
      return { subject: { sectionSubjects: { some: { id: { in: [...a.sectionSubjectIds] } } } } };
    }
    if (isStudent(a)) {
      return {
        publicationStatus: "PUBLISHED",
        subject: { sectionSubjects: { some: { id: { in: [...a.sectionSubjectIds] } } } },
      };
    }
    return DENY_ALL;
  },

  Lesson: (a) => {
    if (isAdmin(a)) return null;
    const reach = {
      module: { subject: { sectionSubjects: { some: { id: { in: [...a.sectionSubjectIds] } } } } },
    };
    if (isTeacher(a)) return reach;
    if (isStudent(a)) return { ...reach, publicationStatus: "PUBLISHED" };
    return DENY_ALL;
  },

  RecordedLecture: (a) => {
    if (isAdmin(a)) return null;
    if (isTeacher(a)) return { sectionSubjectId: { in: [...a.sectionSubjectIds] } };
    if (isStudent(a)) {
      return {
        sectionSubjectId: { in: [...a.sectionSubjectIds] },
        publicationStatus: "PUBLISHED",
        availabilityStatus: "AVAILABLE",
      };
    }
    return DENY_ALL;
  },

  // ----------------------------------------------------------------- live --
  LiveSession: (a) => {
    if (isAdmin(a)) return null;
    if (isTeacher(a) || isStudent(a)) {
      return { sectionSubjectId: { in: [...a.sectionSubjectIds] } };
    }
    return DENY_ALL;
  },

  /**
   * ARC-025: the raw provider link never reaches a student. Students obtain a
   * JoinRoute from the LCAL instead, and the client renders from its `kind`.
   * Denying the binding model outright means a careless `include` cannot leak
   * it either.
   */
  LiveSessionProviderBinding: (a) => {
    if (isAdmin(a)) return null;
    if (isTeacher(a)) {
      return { liveSession: { sectionSubjectId: { in: [...a.sectionSubjectIds] } } };
    }
    return DENY_ALL;
  },

  AttendanceRecord: (a) => {
    if (isAdmin(a)) return null;
    if (isTeacher(a)) {
      return { liveSession: { sectionSubjectId: { in: [...a.sectionSubjectIds] } } };
    }
    if (isStudent(a)) return a.studentId ? { studentId: a.studentId } : DENY_ALL;
    return DENY_ALL;
  },

  // ------------------------------------------------------------ governance --
  // §4.5.12: an Admin sees their own and subordinate actions; a Super Admin
  // sees everything. Teachers and students see nothing.
  AuditLog: (a) => {
    if (a.roles.includes("super_admin")) return null;
    if (a.roles.includes("admin")) return { actorUserId: a.userId };
    return DENY_ALL;
  },

  SecurityEvent: (a) => (a.roles.includes("super_admin") ? null : DENY_ALL),

  Setting: (a) => {
    if (isAdmin(a)) return { isSecret: false }; // SEC-CRY-010: secrets are write-only
    return DENY_ALL;
  },

  NumberSeries: (a) => (a.roles.includes("super_admin") ? null : DENY_ALL),

  // Deliberately unscoped reference data — no student information, and every
  // role legitimately needs to read it:
  //   Programme, AcademicSession, Batch, Subject, Role
};

/** Combine the caller's `where` with ours. AND, so ours can only narrow. */
function combine(existing: unknown, predicate: WhereFragment): WhereFragment {
  if (!existing || typeof existing !== "object" || Object.keys(existing).length === 0) {
    return predicate;
  }
  return { AND: [existing as WhereFragment, predicate] };
}

/**
 * Builds the Prisma client extension.
 *
 * `$allModels` means a model added later is covered automatically — it cannot
 * be forgotten, only deliberately left unscoped.
 */
export function scopeExtension() {
  return Prisma.defineExtension({
    name: "lms-scope-predicate",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          // Bypass is explicit and narrow — see runUnscoped().
          if (isBypassed()) return query(args);

          const isRead = READ_OPS.has(operation);
          const isScopedWrite = SCOPED_WRITE_OPS.has(operation);
          if (!isRead && !isScopedWrite) return query(args);

          const policy = model ? MODEL_POLICIES[model] : undefined;
          if (!policy) return query(args); // unscoped model — see file header

          const actor = getActor();
          if (!actor) {
            // A scoped model reached with no identity at all. This is a
            // programming error, so fail closed and loudly rather than
            // returning data.
            throw new Error(
              `Scope violation: ${model}.${operation} was called with no actor in context. ` +
                `Wrap the call in runWithActor(), or in runUnscoped() if it is genuinely ` +
                `system work (see actor-context.ts).`,
            );
          }

          const predicate = policy(actor);
          if (predicate === null) return query(args); // ALL scope

          const next = { ...(args as Record<string, unknown>) };

          // findUnique cannot take arbitrary filters, so promote it to
          // findFirst. Semantics are preserved and the predicate applies.
          if (operation === "findUnique" || operation === "findUniqueOrThrow") {
            next["where"] = combine(next["where"], predicate);
            const promoted = operation === "findUnique" ? "findFirst" : "findFirstOrThrow";
            const delegate = (this as Record<string, any>)[model!];
            if (delegate && typeof delegate[promoted] === "function") {
              return delegate[promoted](next);
            }
          }

          next["where"] = combine(next["where"], predicate);
          return query(next);
        },
      },
    },
  });
}

/** Exported for the negative test suites required by §17.2. */
export const __testing = { MODEL_POLICIES, DENY_ALL, combine };
