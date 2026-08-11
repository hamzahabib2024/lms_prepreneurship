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
 * add a policy. scope-coverage.spec.ts fails if a model is neither policed nor
 * listed in DELIBERATELY_UNSCOPED.
 *
 * ---------------------------------------------------------------------------
 * THE ONE THING THIS DOES NOT COVER: NESTED INCLUDES
 * ---------------------------------------------------------------------------
 * A policy applies to the model being QUERIED. It does NOT apply to a relation
 * loaded alongside it.
 *
 *     prisma.scoped.assignmentSubmission.findMany({ include: { grade: true } })
 *              ^ AssignmentSubmission policy runs      ^ AssignmentGrade policy
 *                                                        does NOT run
 *
 * The extension rewrites `args.where` for the top-level operation; the relation
 * is resolved by the same database query and never re-enters as its own
 * operation. So an `include` of a scoped model returns rows the child policy
 * would have refused.
 *
 * This is not hypothetical. The student assignment list included `grade` and
 * trusted the AssignmentGrade policy to withhold unreleased marks, and it
 * leaked every unreleased grade to its student in breach of BR-ASG-09.
 *
 * ---------------------------------------------------------------------------
 * THE OTHER THING THIS DOES NOT COVER: CREATE
 * ---------------------------------------------------------------------------
 * This extension works by injecting a `where`. A create has none.
 *
 * READ_OPS and SCOPED_WRITE_OPS below are the whole of what is constrained:
 * reads, updateMany and deleteMany. `create`, `createMany` and `upsert` name
 * their own foreign keys and there is nothing to filter, so a caller supplying
 * a sectionSubjectId writes wherever they like.
 *
 * Also not hypothetical. A teacher could post an announcement to a class they
 * do not teach, and create an ASSIGNMENT in one — setting homework for another
 * teacher's students, who would see it and submit to it.
 *
 * A create that takes a section, subject-section or student id FROM THE CALLER
 * must check it: see assertOwnsSectionSubject in rbac/ownership.ts. A create
 * whose ids all come from the actor (a student's own submission, their own
 * watch progress) needs nothing. An update or delete is safe when it follows a
 * scoped read, which is the pattern used throughout — the read refuses first.
 *
 * WHEN YOU INCLUDE A SCOPED MODEL, restate its restriction — either as a
 * `where` on the nested read where the relation is to-many, or as an explicit
 * check on the loaded row where it is to-one. Treat the policy as documentation
 * of what that restriction must be.
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
 * Models with NO policy, and why.
 *
 * Kept as an explicit list because "absent" and "deliberately unscoped" look
 * identical in this map otherwise, and the difference is the whole security
 * property. Everything here is institute-wide reference data: it describes what
 * the Institute OFFERS, not what any person has done.
 *
 *   Programme, Subject, AcademicSession, Batch   the prospectus
 *   Role                                          the four fixed roles (§4.2)
 *   Rubric                                        the marking scheme itself
 *
 * RubricCriterion USED TO BE ON THIS LIST and is not any more. A rubric is
 * reference data, but its criteria are not uniformly so: one marked
 * `isInternal` records something the student must never read (FR-ASG-014) —
 * a moderation adjustment, a plagiarism weighting. That is a row-state
 * condition, which is exactly what a policy expresses, so it has one.
 *
 * A model carrying a person's work, marks, money or contact details does NOT
 * belong on this list. If you are adding one, add a policy instead.
 */
/**
 * Models whose policy restricts on ROW STATE, not just on ownership.
 *
 * This distinction is what makes nested includes dangerous, and it is worth
 * being precise about.
 *
 * Most policies here answer "is this row reachable from who you are?" — a
 * teacher's sections, a student's own id. For those, traversing to a parent
 * from a row you already legitimately hold cannot expose anything: if you may
 * see the Enrolment, its SectionSubject is within your scope by construction.
 *
 * The models below are different. They add a condition about the ROW'S OWN
 * STATE — published, released, available — on top of ownership. Holding the
 * parent tells you nothing about whether that condition is met, so an include
 * of one can hand back exactly the row the policy exists to withhold. Both
 * nested-include leaks were of this kind: an unreleased AssignmentGrade
 * reached through the student's own submission (BR-ASG-09), and a draft
 * RecordedLecture reached through a published Module (BR-CNT-01).
 *
 * nested-include.spec.ts uses this list to decide which to-one includes demand
 * a restatement.
 */
const STATE_FILTERED = [
  "Assignment", // publicationStatus — a draft assignment
  "AssignmentGrade", // releasedAt — an unreleased mark
  "Module", // publicationStatus
  "Lesson", // publicationStatus
  "RecordedLecture", // publicationStatus + availabilityStatus
  "Quiz", // publicationStatus
  "SubmissionFile", // submissionId — an unsubmitted draft upload
  "LessonResource", // publicationStatus, AND the lesson's
  "RubricCriterion", // isInternal — a criterion the student must not see
] as const;

const DELIBERATELY_UNSCOPED = [
  "Programme",
  "Subject",
  "AcademicSession",
  "Batch",
  "Role",
  "Rubric",
  // The Institute's own wording for the messages the System sends. It is
  // configuration, carries nobody's personal information, and the same text
  // goes to every recipient — so there is nothing here to scope BY. Reaching
  // it at all needs notification_config:configure, which only a Super Admin or
  // an Admin holds.
  "NotificationTemplate",
] as const;

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

  /**
   * What a student owes. Exactly the Payment policy, and for the same reasons:
   * a student sees their own statement, a teacher sees nobody's finances at
   * all, and an administrator sees everything.
   *
   * A teacher having no business in a student's debts is worth being explicit
   * about — it is the kind of thing that looks like an oversight later, and it
   * is not.
   */
  FeeCharge: (a) => {
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

  /**
   * FR-CRS-035 — a handout attached to a lesson.
   *
   * TWO PUBLICATION GATES, not one. The resource has its own status, so a
   * teacher can upload next week's worksheet to an already-published lesson
   * without it appearing the moment the upload finishes — and the LESSON'S
   * status is checked as well, because a published handout inside a draft
   * lesson must stay invisible (BR-CNT-01).
   *
   * Either gate alone leaks: without the first, uploading publishes; without
   * the second, publishing a resource smuggles out a lesson nobody has
   * released yet.
   */
  LessonResource: (a) => {
    if (isAdmin(a)) return null;
    const reach = {
      lesson: {
        module: { subject: { sectionSubjects: { some: { id: { in: [...a.sectionSubjectIds] } } } } },
      },
    };
    if (isTeacher(a)) return reach;
    if (isStudent(a)) {
      return {
        publicationStatus: "PUBLISHED",
        lesson: {
          publicationStatus: "PUBLISHED",
          deletedAt: null,
          module: { subject: { sectionSubjects: { some: { id: { in: [...a.sectionSubjectIds] } } } } },
        },
      };
    }
    return DENY_ALL;
  },

  /**
   * ARC-039/040 — a permit to stream one lecture.
   *
   * A student sees only their own, which is what a ticket IS: naming somebody
   * else's makes it useless to them, and the redeem path re-checks the actor
   * against the ticket regardless. Nobody else has any business reading them —
   * a ticket carries a storage reference, and ARC-041 keeps those inside the
   * System.
   *
   * Redeeming reads under asSystem because the request arrives with a ticket id
   * and nothing else; the ownership check happens immediately afterwards, in
   * code, against the actor.
   */
  PlaybackTicket: (a) => {
    if (isAdmin(a)) return null;
    if (isStudent(a)) return a.studentId ? { studentId: a.studentId } : DENY_ALL;
    return DENY_ALL; // teachers: never
  },

  /**
   * FR-DSC-001 — a question thread on an offering.
   *
   * READING IS ENROLLED, NOT OWN, and that is a deliberate reading of §4.5.
   * The matrix grants a student create/read/update/delete at OWN scope; taken
   * literally for READ, a student would see only their own posts, which is not
   * a discussion but a diary — nobody would ever see the answer to their own
   * question, including the teacher's.
   *
   * OWN is enforced where it means something: discussion-rules.ts refuses an
   * edit or a removal of somebody else's post. If the SRS intends the narrower
   * reading it is one line here, but the feature would have no purpose.
   */
  DiscussionPost: (a) => {
    if (isAdmin(a)) return null;
    if (isTeacher(a) || isStudent(a)) {
      return { sectionSubjectId: { in: [...a.sectionSubjectIds] } };
    }
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

  /// A student sees only their own watch history. A teacher sees it for the
  /// lectures they teach — FR-VID-014 lets them find who has not watched, and
  /// that is the only legitimate reason to read another person's viewing.
  WatchProgress: (a) => {
    if (isAdmin(a)) return null;
    if (isTeacher(a)) {
      return { recordedLecture: { sectionSubjectId: { in: [...a.sectionSubjectIds] } } };
    }
    if (isStudent(a)) return a.studentId ? { studentId: a.studentId } : DENY_ALL;
    return DENY_ALL;
  },

  // ---------------------------------------------------------- assessment --
  // Every model below carries a student's work or their marks, and every one
  // of them was missing from this map. An absent model is UNSCOPED (see the
  // header), so a student holding `submission:read` could reach anyone's.
  //
  // assignment.service.ts even carried a comment saying "Scoped: a student not
  // enrolled in this subject-section cannot see the assignment at all" — which
  // was true of the intent and false of the code.

  /// BR-CNT-01 again: a draft assignment is invisible to students, and an
  /// assignment belonging to another section does not exist for them.
  /**
   * FR-ASG-014 — an internal criterion is never shown to a student.
   *
   * Staff see the whole rubric: a teacher marks against the internal criteria,
   * so hiding them would make the rubric unusable for its actual purpose.
   *
   * This filters ROWS, which is the half of the problem scope can solve. The
   * other half is `AssignmentGrade.rubricScores`, a JSON column holding
   * criterion-id -> marks. No predicate can reach inside a blob, so the marks
   * are stripped in application code by rubric-scoring.forStudent. Two
   * mechanisms because there are two shapes of the same secret.
   */
  RubricCriterion: (a) => (isStudent(a) ? { isInternal: false } : null),

  Assignment: (a) => {
    if (isAdmin(a)) return null;
    if (isTeacher(a)) return { sectionSubjectId: { in: [...a.sectionSubjectIds] } };
    if (isStudent(a)) {
      return {
        sectionSubjectId: { in: [...a.sectionSubjectIds] },
        publicationStatus: "PUBLISHED",
      };
    }
    return DENY_ALL;
  },

  AssignmentSubmission: (a) => {
    if (isAdmin(a)) return null;
    if (isTeacher(a)) {
      return { assignment: { sectionSubjectId: { in: [...a.sectionSubjectIds] } } };
    }
    if (isStudent(a)) return a.studentId ? { studentId: a.studentId } : DENY_ALL;
    return DENY_ALL;
  },

  SubmissionFile: (a) => {
    if (isAdmin(a)) return null;
    if (isTeacher(a)) {
      // Only files that have actually been HANDED IN. A student's uploads sit
      // unattached until they press Submit, and a teacher reading a draft
      // before it is submitted would be reading work in progress.
      return {
        submissionId: { not: null },
        assignment: { sectionSubjectId: { in: [...a.sectionSubjectIds] } },
      };
    }
    // Matched on the owner column, NOT through the submission relation. An
    // unattached file has no submission, so a relation predicate excludes it —
    // which hid a student's own uploads from them until they submitted, and
    // therefore made them impossible to list or delete.
    if (isStudent(a)) return a.studentId ? { studentId: a.studentId } : DENY_ALL;
    return DENY_ALL;
  },

  /// BR-ASG-09 — a mark does not exist for the student until it is released.
  /// Enforcing it here rather than in each response means an unreleased grade
  /// cannot leak through a path nobody remembered to guard.
  AssignmentGrade: (a) => {
    if (isAdmin(a)) return null;
    if (isTeacher(a)) {
      return {
        submission: { assignment: { sectionSubjectId: { in: [...a.sectionSubjectIds] } } },
      };
    }
    if (isStudent(a)) {
      return a.studentId
        ? { submission: { studentId: a.studentId }, releasedAt: { not: null } }
        : DENY_ALL;
    }
    return DENY_ALL;
  },

  AssignmentExtension: (a) => {
    if (isAdmin(a)) return null;
    if (isTeacher(a)) {
      return { assignment: { sectionSubjectId: { in: [...a.sectionSubjectIds] } } };
    }
    if (isStudent(a)) return a.studentId ? { studentId: a.studentId } : DENY_ALL;
    return DENY_ALL;
  },

  Quiz: (a) => {
    if (isAdmin(a)) return null;
    if (isTeacher(a)) return { sectionSubjectId: { in: [...a.sectionSubjectIds] } };
    if (isStudent(a)) {
      return {
        sectionSubjectId: { in: [...a.sectionSubjectIds] },
        publicationStatus: "PUBLISHED",
      };
    }
    return DENY_ALL;
  },

  QuizAttempt: (a) => {
    if (isAdmin(a)) return null;
    if (isTeacher(a)) return { quiz: { sectionSubjectId: { in: [...a.sectionSubjectIds] } } };
    if (isStudent(a)) return a.studentId ? { studentId: a.studentId } : DENY_ALL;
    return DENY_ALL;
  },

  QuizAnswer: (a) => {
    if (isAdmin(a)) return null;
    if (isTeacher(a)) {
      return { attempt: { quiz: { sectionSubjectId: { in: [...a.sectionSubjectIds] } } } };
    }
    if (isStudent(a)) return a.studentId ? { attempt: { studentId: a.studentId } } : DENY_ALL;
    return DENY_ALL;
  },

  /**
   * A certificate is a public document, but WHO HOLDS ONE is not public.
   *
   * A student sees their own, including a revoked one: they may be holding the
   * printed copy, and hiding the record would leave them unable to find out why
   * it is no longer valid (BR-ENR-08 keeps this readable after withdrawal).
   *
   * Verification by code is deliberately NOT routed through here — an employer
   * has no account. That path runs under asSystem with its own narrow
   * projection; see CertificateService.verify.
   */
  Certificate: (a) => {
    if (isAdmin(a)) return null;
    if (isTeacher(a)) {
      return { sectionSubject: { id: { in: [...a.sectionSubjectIds] } } };
    }
    if (isStudent(a)) return a.studentId ? { studentId: a.studentId } : DENY_ALL;
    return DENY_ALL;
  },

  /**
   * A warning is about a student and belongs to their teacher's at-risk list.
   *
   * The student sees their own — being warned and then unable to look at the
   * warning would be its own small cruelty — and a teacher sees the ones in the
   * subject-sections they teach, which is the whole point of an early-warning
   * signal (FR-ATT-020).
   */
  AttendanceWarning: (a) => {
    if (isAdmin(a)) return null;
    if (isTeacher(a)) return { sectionSubjectId: { in: [...a.sectionSubjectIds] } };
    if (isStudent(a)) return a.studentId ? { studentId: a.studentId } : DENY_ALL;
    return DENY_ALL;
  },

  // ------------------------------------------------------- communication --

  /**
   * An announcement is visible to its AUDIENCE.
   *
   * This policy is also what stops a teacher announcing to a class they do not
   * teach: it constrains the create as well as the read, so the check lives in
   * one place rather than in a guard at each call site (ARC-051).
   */
  Announcement: (a) => {
    if (isAdmin(a)) return null;
    if (isTeacher(a) || isStudent(a)) {
      return {
        OR: [
          { audience: "INSTITUTE" },
          { sectionSubjectId: { in: [...a.sectionSubjectIds] } },
          { sectionId: { in: [...a.sectionIds] } },
        ],
      };
    }
    return DENY_ALL;
  },

  /**
   * A notification belongs to exactly one person, and to nobody else — not to
   * their teacher, and not to an administrator.
   *
   * An Admin is NOT given ALL here, unlike almost every other model. An inbox
   * is correspondence: it carries a student's marks, their attendance warnings
   * and their admission outcome, and administering the Institute does not
   * require reading somebody's messages. Support needs the AUDIT LOG, which
   * records that a notification was raised, not its contents.
   */
  Notification: (a) => ({ recipientId: a.userId }),

  NotificationDelivery: (a) => {
    // The delivery LOG is operational: an administrator diagnosing "students
    // are not receiving anything" needs it, and it carries no message body.
    if (isAdmin(a)) return null;
    return { notification: { recipientId: a.userId } };
  },

  NotificationPreference: (a) => (isAdmin(a) ? null : { userId: a.userId }),

  // ------------------------------------------------------- the answer key --
  // QuestionOption.isCorrect, Question.acceptedAnswers and Question.explanation
  // ARE the answer key. Quiz delivery is not built yet, so nothing reads these
  // today — which is exactly why they are locked now rather than later. Left
  // unscoped, the first query written against them would inherit read access
  // and hand students the answers, and it would look like working code.
  //
  // Delivery must therefore go through asSystem() deliberately and strip the
  // key on its way out. That is a visible decision in a reviewable place,
  // which an accidental default is not.
  QuestionBank: (a) => (isAdmin(a) || isTeacher(a) ? null : DENY_ALL),
  Question: (a) => (isAdmin(a) || isTeacher(a) ? null : DENY_ALL),
  QuestionOption: (a) => (isAdmin(a) || isTeacher(a) ? null : DENY_ALL),
  QuizQuestion: (a) => (isAdmin(a) || isTeacher(a) ? null : DENY_ALL),

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
export const __testing = {
  MODEL_POLICIES,
  DENY_ALL,
  combine,
  DELIBERATELY_UNSCOPED,
  STATE_FILTERED,
};
