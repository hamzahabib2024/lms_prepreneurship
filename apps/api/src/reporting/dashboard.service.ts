import { Injectable, Logger } from "@nestjs/common";
import { AppError } from "@lms/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AttendanceService } from "../live/attendance.service";
import { ProgressService } from "../progress/progress.service";
import { getActor } from "../prisma/actor-context";

/**
 * Dashboards — SRS §5.18.
 *
 * Every widget is scoped automatically by the Prisma extension, so this
 * service contains no role-based filtering of its own: a teacher's counts
 * cover their assigned subject-sections because the queries physically cannot
 * return anything else (FR-DSH-002).
 *
 * FR-DSH-004 — widgets are gathered with Promise.allSettled rather than
 * Promise.all. One slow or failing widget must not blank the whole dashboard;
 * §3.9 requires the rest to render and the failure to be stated in its own
 * bounds.
 */
@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly attendance: AttendanceService,
    private readonly progress: ProgressService,
  ) {}

  async forCurrentUser() {
    const actor = getActor();
    if (!actor) throw new AppError("AUTH_TOKEN_INVALID");

    if (actor.roles.includes("super_admin") || actor.roles.includes("admin")) {
      return this.adminDashboard();
    }
    if (actor.roles.includes("teacher")) return this.teacherDashboard();
    if (actor.roles.includes("student")) return this.studentDashboard();

    return { role: "unknown", widgets: {}, generatedAt: new Date() };
  }

  /** §5.18.1 — the student widget set. */
  private async studentDashboard() {
    const actor = getActor();
    const studentId = actor?.studentId;
    if (!studentId) throw new AppError("AUTH_FORBIDDEN");

    const widgets = await this.gather({
      nextClass: () => this.nextClass(),
      myClasses: () => this.myClasses(),
      workDue: () => this.workDue(studentId),
      progress: () => this.progress.forStudent(studentId),
      attendance: () => this.attendance.studentSummary(studentId),
      announcements: () => this.recentAnnouncements(),
    });

    return { role: "student", generatedAt: new Date(), widgets };
  }

  /**
   * §5.18.1 — the teacher widget set.
   *
   * The action queue is first because FR-TCH-002 makes it the primary
   * element: teacher adoption (RSK-01) depends on the System telling them
   * what they owe rather than making them look for it.
   */
  private async teacherDashboard() {
    const actor = getActor();
    const teacherId = actor?.teacherId;
    if (!teacherId) throw new AppError("AUTH_FORBIDDEN");

    const widgets = await this.gather({
      nextClass: () => this.nextClass(),
      actionQueue: () => this.teacherActionQueue(),
      mySections: () => this.teacherSections(),
      announcements: () => this.recentAnnouncements(),
    });

    return { role: "teacher", generatedAt: new Date(), widgets };
  }

  /** §5.18.1 — the admin widget set. */
  private async adminDashboard() {
    const widgets = await this.gather({
      registrationQueue: () => this.registrationQueue(),
      instituteKpis: () => this.instituteKpis(),
      acquisitionMix: () => this.acquisitionMix(),
      exceptions: () => this.operationalExceptions(),
    });

    return { role: "admin", generatedAt: new Date(), widgets };
  }

  // ---------------------------------------------------------------- widgets

  /** FR-STU-002 / FR-TCH-001 — the next class, above the fold. */
  private async nextClass() {
    const now = new Date();
    const session = await this.prisma.scoped.liveSession.findFirst({
      where: {
        deletedAt: null,
        status: { in: ["SCHEDULED", "LIVE"] },
        scheduledEnd: { gte: now },
      },
      orderBy: { scheduledStart: "asc" },
      include: {
        binding: { select: { status: true } },
        sectionSubject: {
          include: {
            subject: { select: { code: true, name: true } },
            section: { select: { code: true, name: true } },
          },
        },
        // meetingUrl and meetingNote come with the sectionSubject above.
      },
    });

    if (!session) {
      // FR-DSH-006 / NFR-USE-009 — a meaningful empty state, not a blank card.
      return { hasNext: false as const, message: "No class scheduled in the next few days." };
    }

    const opensAt = new Date(
      session.scheduledStart.getTime() - session.joinWindowMinutesBefore * 60_000,
    );

    return {
      hasNext: true as const,
      sessionId: session.id,
      title: session.title,
      subject: session.sectionSubject.subject,
      section: session.sectionSubject.section,
      scheduledStart: session.scheduledStart,
      scheduledEnd: session.scheduledEnd,
      startsInSeconds: Math.max(
        0,
        Math.floor((session.scheduledStart.getTime() - now.getTime()) / 1000),
      ),
      // FR-STU-003 — the client activates the join control from this without
      // polling for permission.
      joinWindowOpensAt: opensAt,
      joinWindowOpen: now >= opensAt,
      linkReady: session.binding?.status === "ACTIVE",
      /*
       * THE CLASS'S STANDING ROOM — FR-LIV.
       *
       * Distinct from `linkReady` above it, which is about a meeting the
       * System created for this one occurrence through a provider binding.
       * This is the room the Institute already has and uses every week, and
       * for most classes it is the only one that exists.
       *
       * Carried here so the dashboard can offer a door rather than only a
       * countdown. A student two minutes before class wants to get IN, and
       * being told the class exists is not the same as being let into it.
       */
      sectionSubjectId: session.sectionSubjectId,
      meetingUrl: session.sectionSubject.meetingUrl,
      meetingNote: session.sectionSubject.meetingNote,
    };
  }

  /**
   * EVERY CLASS THE STUDENT CAN WALK INTO, on the dashboard — FR-LIV.
   *
   * `nextClass` above answers "what is on now?", which is the right question
   * on a timetabled day and the wrong one the rest of the time: a class moved
   * to a one-off catch-up session, or a subject with no session scheduled at
   * all, has a room the student still needs and no way to reach it from here.
   *
   * ONLY CLASSES WITH A ROOM. A list that includes the ones taught in a
   * building is a list where most rows do nothing, and the reader learns to
   * skip all of them.
   *
   * The scope predicate decides the rows, so this is the student's own
   * enrolments without a filter saying so.
   */
  private async myClasses() {
    const offerings = await this.prisma.scoped.sectionSubject.findMany({
      where: { deletedAt: null, meetingUrl: { not: null } },
      select: {
        id: true,
        meetingUrl: true,
        meetingNote: true,
        subject: { select: { code: true, name: true } },
        section: { select: { code: true, name: true } },
      },
      orderBy: { subject: { name: "asc" } },
    });

    if (offerings.length === 0) {
      // NFR-USE-009 — say why it is empty. "No classes" would read as though
      // the student were enrolled on nothing.
      return {
        classes: [],
        message:
          "None of your classes has an online meeting link yet. They appear here as your " +
          "teachers add them.",
      };
    }

    return {
      classes: offerings.map((o: (typeof offerings)[number]) => ({
        sectionSubjectId: o.id,
        subject: o.subject,
        section: o.section,
        meetingUrl: o.meetingUrl,
        meetingNote: o.meetingNote,
      })),
    };
  }

  /** FR-STU-004 — assignments and quizzes due soon, by deadline. */
  private async workDue(studentId: string) {
    const now = new Date();
    const horizon = new Date(now.getTime() + 14 * 86_400_000);

    const [assignments, quizzes, submitted] = await Promise.all([
      this.prisma.scoped.assignment.findMany({
        where: {
          deletedAt: null,
          publicationStatus: "PUBLISHED",
          dueAt: { gte: now, lte: horizon },
        },
        orderBy: { dueAt: "asc" },
        take: 20,
      }),
      this.prisma.scoped.quiz.findMany({
        where: {
          deletedAt: null,
          publicationStatus: "PUBLISHED",
          closesAt: { gte: now, lte: horizon },
        },
        orderBy: { closesAt: "asc" },
        take: 20,
      }),
      this.prisma.asSystem((db) =>
        db.assignmentSubmission.findMany({
          where: { studentId, isLatest: true },
          select: { assignmentId: true },
        }),
      ),
    ]);

    const done = new Set(submitted.map((s) => s.assignmentId));

    const items = [
      ...assignments.map((a: (typeof assignments)[number]) => ({
        kind: "assignment" as const,
        id: a.id,
        title: a.title,
        dueAt: a.dueAt,
        submitted: done.has(a.id),
      })),
      ...quizzes.map((q: (typeof quizzes)[number]) => ({
        kind: "quiz" as const,
        id: q.id,
        title: q.title,
        dueAt: q.closesAt,
        submitted: false,
      })),
    ].sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());

    return {
      count: items.filter((i) => !i.submitted).length,
      items,
      message: items.length === 0 ? "Nothing due in the next two weeks." : undefined,
    };
  }

  /** FR-TCH-002 — what the teacher owes, with counts and direct links. */
  private async teacherActionQueue() {
    const now = new Date();

    const [unmarkedSessions, ungradedSubmissions, pendingQuizGrading] = await Promise.all([
      this.prisma.scoped.liveSession.count({
        where: {
          deletedAt: null,
          status: "ENDED",
          scheduledEnd: { lt: now },
          attendance: { some: { status: "NOT_MARKED" } },
        },
      }),
      this.prisma.scoped.assignmentSubmission.count({
        where: { isLatest: true, grade: null },
      }),
      this.prisma.scoped.quizAttempt.count({ where: { status: "GRADING" } }),
    ]);

    const total = unmarkedSessions + ungradedSubmissions + pendingQuizGrading;

    return {
      total,
      unmarkedRegisters: unmarkedSessions,
      ungradedSubmissions,
      quizzesAwaitingMarking: pendingQuizGrading,
      message: total === 0 ? "Nothing outstanding — you are up to date." : undefined,
    };
  }

  /** FR-TCH-004 — per subject-section, the numbers a teacher acts on. */
  private async teacherSections() {
    const offerings = await this.prisma.scoped.sectionSubject.findMany({
      where: { deletedAt: null, status: "ACTIVE" },
      include: {
        subject: { select: { code: true, name: true } },
        section: { select: { code: true, name: true } },
        _count: { select: { enrolments: true } },
      },
    });

    return offerings.map((o: (typeof offerings)[number]) => ({
      sectionSubjectId: o.id,
      subject: o.subject,
      section: o.section,
      enrolled: o._count.enrolments,
    }));
  }

  /** FR-ADM-001 — the registration queue, with the overdue count. */
  private async registrationQueue() {
    const now = new Date();
    const overdueBefore = new Date(now.getTime() - 48 * 3_600_000);
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);

    const [pending, overdue, decidedToday] = await Promise.all([
      this.prisma.scoped.registrationRequest.count({
        where: { deletedAt: null, status: { in: ["PENDING_REVIEW", "UNDER_REVIEW", "NEEDS_INFO"] } },
      }),
      this.prisma.scoped.registrationRequest.count({
        where: {
          deletedAt: null,
          status: { in: ["PENDING_REVIEW", "UNDER_REVIEW"] },
          createdAt: { lt: overdueBefore },
        },
      }),
      this.prisma.scoped.registrationRequest.count({
        where: { deletedAt: null, decidedAt: { gte: startOfDay } },
      }),
    ]);

    return {
      pending,
      overdue, // FR-REG-038 — waiting longer than the configured threshold
      decidedToday,
      message: pending === 0 ? "No applications waiting." : undefined,
    };
  }

  /** FR-ADM-002 — headline institute numbers. */
  private async instituteKpis() {
    const [students, teachers, sections, atCapacity] = await Promise.all([
      this.prisma.scoped.student.count({ where: { deletedAt: null } }),
      this.prisma.scoped.teacher.count({ where: { deletedAt: null } }),
      this.prisma.scoped.section.count({ where: { deletedAt: null, status: "ACTIVE" } }),
      this.prisma.asSystem((db) =>
        db.$queryRaw<Array<{ count: bigint }>>`
          SELECT COUNT(*)::bigint AS count FROM sections
          WHERE deleted_at IS NULL AND enrolled_count >= capacity
        `.catch(() => [{ count: BigInt(0) }]),
      ),
    ]);

    return {
      activeStudents: students,
      activeTeachers: teachers,
      activeSections: sections,
      sectionsAtCapacity: Number(atCapacity[0]?.count ?? 0),
    };
  }

  /** FR-ADM-004 / OBJ-07 — where enrolments actually come from. */
  private async acquisitionMix() {
    const rows = await this.prisma.asSystem((db) =>
      db.registrationRequest.groupBy({
        by: ["acquisitionSource"],
        where: { deletedAt: null, status: "APPROVED" },
        _count: { _all: true },
      }),
    );

    const total = rows.reduce((s, r) => s + r._count._all, 0);
    return {
      total,
      sources: rows
        .map((r) => ({
          source: r.acquisitionSource,
          count: r._count._all,
          percent: total === 0 ? 0 : Math.round((r._count._all / total) * 1000) / 10,
        }))
        .sort((a, b) => b.count - a.count),
      message: total === 0 ? "No approved enrolments yet." : undefined,
    };
  }

  /** FR-ADM-005 — the things that need somebody to do something. */
  private async operationalExceptions() {
    const [sectionsWithoutTeacher, missingLectures] = await Promise.all([
      this.prisma.scoped.sectionSubject.count({
        where: { deletedAt: null, status: "ACTIVE", assignments: { none: { deletedAt: null } } },
      }),
      this.prisma.scoped.recordedLecture.count({
        where: { deletedAt: null, availabilityStatus: "MISSING" },
      }),
    ]);

    const items = [
      sectionsWithoutTeacher > 0 && {
        key: "sections_without_teacher",
        count: sectionsWithoutTeacher,
        // FR-CRS-026 — noticed by the Institute rather than by its students.
        message: `${sectionsWithoutTeacher} subject-section(s) have no assigned teacher.`,
        severity: "high" as const,
      },
      missingLectures > 0 && {
        key: "lectures_missing",
        count: missingLectures,
        message: `${missingLectures} lecture(s) can no longer be found in storage.`,
        severity: "medium" as const,
      },
    ].filter(Boolean);

    return { count: items.length, items, message: items.length === 0 ? "Nothing to action." : undefined };
  }

  private async recentAnnouncements() {
    // The announcements module is not built yet. Returning an honest empty
    // state beats inventing placeholder content that looks real.
    return { count: 0, items: [] as unknown[], message: "No announcements." };
  }

  /**
   * FR-DSH-004 / FR-DSH-010 — one failing widget must not blank the page.
   *
   * A failure is reported inside that widget's own bounds, exactly as §3.9
   * requires of every degradation.
   */
  private async gather<T extends Record<string, () => Promise<unknown>>>(
    loaders: T,
  ): Promise<Record<keyof T, unknown>> {
    const entries = Object.entries(loaders) as Array<[keyof T, () => Promise<unknown>]>;
    const results = await Promise.allSettled(entries.map(([, load]) => load()));

    const out = {} as Record<keyof T, unknown>;
    entries.forEach(([key], i) => {
      const r = results[i];
      if (r && r.status === "fulfilled") {
        out[key] = r.value;
      } else {
        this.logger.error(
          `Dashboard widget "${String(key)}" failed`,
          r && r.status === "rejected" ? (r.reason as Error) : undefined,
        );
        out[key] = {
          unavailable: true,
          message: "This panel could not be loaded. The rest of your dashboard is unaffected.",
        };
      }
    });
    return out;
  }
}
