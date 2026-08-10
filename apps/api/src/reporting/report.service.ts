import { Injectable, Logger } from "@nestjs/common";
import { AppError, resolvePermission, type Resource } from "@lms/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { AttendanceService } from "../live/attendance.service";
import { ProgressService } from "../progress/progress.service";
import { SettingsService } from "../settings/settings.service";
import { getActor } from "../prisma/actor-context";
import type { AttemptStatus } from "@prisma/client";
import { buildCsv, csvFilename, type CsvColumn } from "./csv";

export interface ReportFilters {
  sectionId?: string;
  sectionSubjectId?: string;
  status?: string;
  from?: Date;
  to?: Date;
  belowThresholdOnly?: boolean;
}

interface ReportDefinition {
  key: string;
  name: string;
  description: string;
  /**
   * The resource this report reads, checked PER REPORT.
   *
   * A single blanket permission on the generic /reports/:key route makes every
   * report inherit the weakest one, so a teacher holding report_attendance
   * could run the revenue report. BR-PAY-07 restricts financial data to Super
   * Admin, or Admin holding financial_reporter.
   */
  resource: Resource;
  run: (filters: ReportFilters) => Promise<Record<string, unknown>[]>;
  columns: Array<CsvColumn<Record<string, unknown>>>;
}

/**
 * Reports — SRS §14 and §5.17.
 *
 * FR-RPT-002 is the rule that shapes the design: scope is applied
 * AUTOMATICALLY from the requesting user's identity and is never a parameter
 * they can supply. Every query below goes through the scoped client, so a
 * teacher running the attendance report gets their own sections because the
 * database cannot return anything else — not because this service remembered
 * to filter.
 *
 * Five of the nineteen reports in §14 are implemented here: the ones the
 * Institute uses weekly. The remainder follow the same shape.
 */
@Injectable()
export class ReportService {
  private readonly logger = new Logger(ReportService.name);
  private readonly definitions = new Map<string, ReportDefinition>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly attendance: AttendanceService,
    private readonly progress: ProgressService,
    private readonly settings: SettingsService,
  ) {
    this.register({
      key: "student-directory",
      name: "Student Directory",
      resource: "report_enrolment",
      description: "Report 1 — the definitive list of students.",
      run: (f) => this.studentDirectory(f),
      columns: [
        { header: "Registration No", value: (r) => r["registrationNo"] },
        { header: "Roll No", value: (r) => r["rollNo"] },
        { header: "Name", value: (r) => r["name"] },
        { header: "Gender", value: (r) => r["gender"] },
        { header: "Section", value: (r) => r["section"] },
        { header: "Account Status", value: (r) => r["accountStatus"] },
        { header: "Admitted", value: (r) => r["admissionDate"] },
      ],
    });

    this.register({
      key: "attendance-summary",
      name: "Attendance Summary by Student",
      resource: "report_attendance",
      description: "Report 3 — the principal early-warning report.",
      run: (f) => this.attendanceSummary(f),
      columns: [
        { header: "Registration No", value: (r) => r["registrationNo"] },
        { header: "Roll No", value: (r) => r["rollNo"] },
        { header: "Name", value: (r) => r["name"] },
        { header: "Present", value: (r) => r["present"] },
        { header: "Absent", value: (r) => r["absent"] },
        { header: "Late", value: (r) => r["late"] },
        { header: "Excused", value: (r) => r["excused"] },
        // The denominator is exported alongside the percentage so the figure
        // can be reproduced by hand (BR-ATT-05).
        { header: "Sessions Counted", value: (r) => r["sessionsInDenominator"] },
        { header: "Attendance %", value: (r) => r["percentage"] },
        { header: "Below Threshold", value: (r) => (r["belowThreshold"] ? "YES" : "") },
      ],
    });

    this.register({
      key: "registration-pipeline",
      name: "Registration Pipeline",
      resource: "report_enrolment",
      description: "Report 15 — the state of the admission funnel.",
      run: (f) => this.registrationPipeline(f),
      columns: [
        { header: "Tracking Ref", value: (r) => r["trackingRef"] },
        { header: "Submitted", value: (r) => r["submittedAt"] },
        { header: "Applicant", value: (r) => r["applicantName"] },
        { header: "Desired Section", value: (r) => r["desiredSection"] },
        { header: "Source", value: (r) => r["source"] },
        { header: "Status", value: (r) => r["status"] },
        { header: "Days Waiting", value: (r) => r["daysWaiting"] },
        { header: "Decision", value: (r) => r["decision"] },
        { header: "Reason", value: (r) => r["reasonCode"] },
      ],
    });

    this.register({
      key: "revenue",
      name: "Revenue",
      resource: "report_financial",
      description: "Report 13 — verified income by period.",
      run: (f) => this.revenue(f),
      columns: [
        { header: "Payment Date", value: (r) => r["paymentDate"] },
        { header: "Registration No", value: (r) => r["registrationNo"] },
        { header: "Student", value: (r) => r["studentName"] },
        { header: "Amount", value: (r) => r["amount"] },
        { header: "Currency", value: (r) => r["currency"] },
        { header: "Method", value: (r) => r["method"] },
        { header: "Bank Reference", value: (r) => r["bankReference"] },
        { header: "Verified By", value: (r) => r["verifiedBy"] },
        { header: "Reversed", value: (r) => (r["isReversed"] ? "YES" : "") },
      ],
    });

    this.register({
      key: "acquisition-attribution",
      name: "Marketing Attribution",
      resource: "report_marketing",
      description: "Report 17 — which channels produce paying students.",
      run: (f) => this.acquisitionAttribution(f),
      columns: [
        { header: "Source", value: (r) => r["source"] },
        { header: "Applications", value: (r) => r["applications"] },
        { header: "Approved", value: (r) => r["approved"] },
        { header: "Rejected", value: (r) => r["rejected"] },
        { header: "Conversion %", value: (r) => r["conversionPercent"] },
      ],
    });

    this.register({
      key: "progress",
      name: "Progress and Completion",
      resource: "report_progress",
      description:
        "Report 5 — who is on course to finish, and what each person still owes. Ordered worst-first.",
      run: (f) => this.progressReport(f),
      columns: [
        { header: "Registration No", value: (r) => r["registrationNo"] },
        { header: "Name", value: (r) => r["name"] },
        { header: "Subject", value: (r) => r["subject"] },
        { header: "Progress %", value: (r) => r["progressPercent"] },
        { header: "Attendance %", value: (r) => r["attendancePercent"] },
        { header: "Average Grade %", value: (r) => r["averageGradePercent"] },
        { header: "Meets Criteria", value: (r) => (r["completionMet"] ? "YES" : "") },
        // The reason, in words. A percentage says somebody is behind; this says
        // what they have to do about it.
        { header: "Outstanding", value: (r) => r["outstanding"] },
      ],
    });

    this.register({
      key: "assessment",
      name: "Assessment Status",
      resource: "report_assessment",
      description:
        "Report 8 — every assignment and quiz, how many handed in, how many marked, and what is waiting to be released.",
      run: (f) => this.assessmentReport(f),
      columns: [
        { header: "Subject", value: (r) => r["subject"] },
        { header: "Type", value: (r) => r["type"] },
        { header: "Title", value: (r) => r["title"] },
        { header: "Due", value: (r) => r["dueAt"] },
        { header: "Enrolled", value: (r) => r["enrolled"] },
        { header: "Submitted", value: (r) => r["submitted"] },
        { header: "Marked", value: (r) => r["marked"] },
        // The one a head of department actually looks for.
        { header: "Awaiting Release", value: (r) => r["awaitingRelease"] },
        { header: "Average %", value: (r) => r["averagePercent"] },
      ],
    });

    this.register({
      key: "teacher-activity",
      name: "Teacher Activity",
      resource: "report_teacher_activity",
      description:
        "Report 12 — classes held, registers taken, work set and marking turnaround. A teacher sees only their own.",
      run: (f) => this.teacherActivity(f),
      columns: [
        { header: "Teacher", value: (r) => r["teacher"] },
        { header: "Subjects Taught", value: (r) => r["subjectsTaught"] },
        { header: "Classes Held", value: (r) => r["classesHeld"] },
        { header: "Registers Taken", value: (r) => r["registersTaken"] },
        { header: "Assignments Set", value: (r) => r["assignmentsSet"] },
        { header: "Quizzes Set", value: (r) => r["quizzesSet"] },
        { header: "Submissions Marked", value: (r) => r["submissionsMarked"] },
        // Alongside the turnaround, ALWAYS. A teacher with two hundred
        // submissions and a teacher with twenty are not comparable on days
        // alone, and a management report that implies they are is unfair.
        { header: "Awaiting Marking", value: (r) => r["awaitingMarking"] },
        { header: "Median Days to Mark", value: (r) => r["medianDaysToMark"] },
      ],
    });
  }

  private register(def: ReportDefinition): void {
    this.definitions.set(def.key, def);
  }

  /**
   * Authorises the caller for THIS report's resource.
   *
   * Called by both run() and export() so neither path can be reached without
   * it. `export` is a distinct action from `read` (§4.1.2) because bulk
   * extraction of personal data carries its own risk (SEC-PRV-007).
   */
  private authorise(def: ReportDefinition, action: "read" | "export"): void {
    const actor = getActor();
    if (!actor) throw new AppError("AUTH_TOKEN_INVALID");

    const decision = resolvePermission(
      { roles: actor.roles, subPermissions: actor.subPermissions, steppedUp: true },
      def.resource,
      action,
    );

    if (!decision.allowed) {
      this.logger.warn(
        JSON.stringify({
          event: "report.denied",
          userId: actor.userId,
          roles: actor.roles,
          report: def.key,
          resource: def.resource,
          action,
          reason: decision.reason,
        }),
      );
      throw new AppError("AUTH_FORBIDDEN");
    }
  }

  /** Only the reports this caller may actually run (FR-RPT-019). */
  list() {
    const actor = getActor();
    const permitted = [...this.definitions.values()].filter((d) =>
      actor
        ? resolvePermission(
            { roles: actor.roles, subPermissions: actor.subPermissions, steppedUp: true },
            d.resource,
            "read",
          ).allowed
        : false,
    );
    return permitted.map((d) => ({
      key: d.key,
      name: d.name,
      description: d.description,
      columns: d.columns.map((c) => c.header),
    }));
  }

  /** FR-RPT-003 — the filters applied are echoed back with the result. */
  async run(key: string, filters: ReportFilters) {
    const def = this.definitions.get(key);
    if (!def) throw new AppError("RESOURCE_NOT_FOUND", { message: "No such report." });
    this.authorise(def, "read");

    const started = Date.now();
    const rows = await def.run(filters);

    return {
      report: { key: def.key, name: def.name },
      generatedAt: new Date(),
      appliedFilters: filters,
      rowCount: rows.length,
      durationMs: Date.now() - started,
      rows,
      // FR-RPT-020 — an empty grid reads as a broken report.
      message: rows.length === 0 ? "No records matched these filters." : undefined,
    };
  }

  /**
   * FR-RPT-004 — CSV export.
   *
   * FR-RPT-011 / SEC-PRV-007: generation is audited with the requesting user,
   * the filters and the row count. Bulk extraction of personal data is a
   * distinct privacy risk from reading it on screen, which is why `export` is
   * a separate action in the §4.5 matrix.
   */
  async export(key: string, filters: ReportFilters) {
    const actor = getActor();
    if (!actor) throw new AppError("AUTH_TOKEN_INVALID");

    const def = this.definitions.get(key);
    if (!def) throw new AppError("RESOURCE_NOT_FOUND", { message: "No such report." });
    this.authorise(def, "export");

    const rows = await def.run(filters);

    const user = await this.prisma.asSystem((db) =>
      db.user.findUnique({ where: { id: actor.userId }, select: { fullName: true } }),
    );

    const csv = buildCsv(rows, def.columns, {
      reportName: def.name,
      generatedBy: user?.fullName ?? actor.userId,
      generatedAt: new Date(),
      filters: filters as Record<string, unknown>,
      institute: "Institute",
    });

    await this.audit.record({
      action: "report.export",
      entityType: "Report",
      entityId: key,
      after: { filters, rowCount: rows.length, format: "csv" },
    });

    return { filename: csvFilename(key), content: csv };
  }

  // ------------------------------------------------------------- the reports

  private async studentDirectory(f: ReportFilters) {
    const students = await this.prisma.scoped.student.findMany({
      where: {
        deletedAt: null,
        ...(f.sectionId ? { currentSectionId: f.sectionId } : {}),
      },
      include: {
        user: { select: { fullName: true, status: true } },
        currentSection: { select: { code: true, name: true } },
      },
      orderBy: [{ currentSectionId: "asc" }, { currentRollNo: "asc" }],
    });

    return students.map((s: (typeof students)[number]) => ({
      registrationNo: s.registrationNo,
      rollNo: s.currentRollNo,
      name: s.user.fullName,
      gender: s.gender,
      section: s.currentSection?.code ?? "",
      accountStatus: s.user.status,
      admissionDate: s.admissionDate,
      // Contact details and identity numbers are deliberately absent.
      // §4.7 restricts them, and a directory export is the surface most
      // likely to be forwarded outside the Institute.
    }));
  }

  private async attendanceSummary(f: ReportFilters) {
    const enrolments = await this.prisma.scoped.enrolment.findMany({
      where: {
        status: "ACTIVE",
        ...(f.sectionSubjectId ? { sectionSubjectId: f.sectionSubjectId } : {}),
        ...(f.sectionId ? { sectionSubject: { sectionId: f.sectionId } } : {}),
      },
      include: {
        student: { include: { user: { select: { fullName: true } } } },
      },
    });

    // The INSTITUTE's threshold, not a constant. Hardcoding 75 here meant an
    // institute that set 85 got warnings at 85 and a report flagging at 75 —
    // two answers to one question, neither obviously wrong on its own screen.
    const threshold = await this.settings.number("attendance.warningThreshold");
    const rows = await Promise.all(
      enrolments.map(async (e: (typeof enrolments)[number]) => {
        const stats = await this.attendance.percentageFor(e.studentId, e.sectionSubjectId);
        return {
          registrationNo: e.student.registrationNo,
          rollNo: e.student.currentRollNo,
          name: e.student.user.fullName,
          present: stats.present,
          absent: stats.absent,
          late: stats.late,
          excused: stats.excused,
          sessionsInDenominator: stats.sessionsInDenominator,
          percentage: stats.percentage,
          belowThreshold: stats.percentage !== null && stats.percentage < threshold,
        };
      }),
    );

    const filtered = f.belowThresholdOnly ? rows.filter((r) => r.belowThreshold) : rows;
    // Worst first — the report exists to find who needs help, and roll-number
    // order buries exactly those students in the middle.
    return filtered.sort((a, b) => (a.percentage ?? 101) - (b.percentage ?? 101));
  }

  private async registrationPipeline(f: ReportFilters) {
    const requests = await this.prisma.scoped.registrationRequest.findMany({
      where: {
        deletedAt: null,
        ...(f.status ? { status: f.status as never } : {}),
        ...(f.from || f.to
          ? { createdAt: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) } }
          : {}),
      },
      include: { desiredSection: { select: { code: true } } },
      orderBy: { createdAt: "asc" },
    });

    const now = Date.now();
    return requests.map((r: (typeof requests)[number]) => ({
      trackingRef: r.trackingRef,
      submittedAt: r.createdAt,
      applicantName: r.fullName,
      desiredSection: r.desiredSection?.code ?? "",
      source: r.acquisitionSource,
      status: r.status,
      daysWaiting: r.decidedAt
        ? Math.round((r.decidedAt.getTime() - r.createdAt.getTime()) / 86_400_000)
        : Math.round((now - r.createdAt.getTime()) / 86_400_000),
      decision: r.decision ?? "",
      reasonCode: r.decisionReasonCode ?? "",
    }));
  }

  private async revenue(f: ReportFilters) {
    const payments = await this.prisma.scoped.payment.findMany({
      where: {
        ...(f.from || f.to
          ? { paymentDate: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) } }
          : {}),
      },
      include: {
        student: { include: { user: { select: { fullName: true } } } },
      },
      orderBy: { paymentDate: "desc" },
    });

    return payments.map((p: (typeof payments)[number]) => ({
      paymentDate: p.paymentDate,
      registrationNo: p.student.registrationNo,
      studentName: p.student.user.fullName,
      amount: Number(p.verifiedAmount),
      currency: p.currency,
      method: p.method,
      bankReference: p.bankReference ?? "",
      verifiedBy: p.verifiedBy,
      // BR-RPT-05 — reversals are SHOWN rather than netted away silently, so
      // the total can be reconciled against the bank.
      isReversed: p.isReversed,
    }));
  }

  private async acquisitionAttribution(f: ReportFilters) {
    const requests = await this.prisma.scoped.registrationRequest.findMany({
      where: {
        deletedAt: null,
        ...(f.from || f.to
          ? { createdAt: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) } }
          : {}),
      },
      select: { acquisitionSource: true, status: true },
    });

    const bySource = new Map<string, { applications: number; approved: number; rejected: number }>();
    for (const r of requests) {
      const key = r.acquisitionSource;
      const entry = bySource.get(key) ?? { applications: 0, approved: 0, rejected: 0 };
      entry.applications++;
      if (r.status === "APPROVED") entry.approved++;
      if (r.status === "REJECTED") entry.rejected++;
      bySource.set(key, entry);
    }

    return [...bySource.entries()]
      .map(([source, v]) => ({
        source,
        ...v,
        // OBJ-07 — this column is the whole point: it tells the Director
        // which advertising actually produces paying students.
        conversionPercent:
          v.applications === 0 ? 0 : Math.round((v.approved / v.applications) * 1000) / 10,
      }))
      .sort((a, b) => b.approved - a.approved);
  }

  /**
   * Report 5 — progress and completion.
   *
   * Goes through ProgressService per enrolment rather than recomputing the
   * weighted formula here. A report that calculated progress its own way would
   * eventually disagree with the student's own screen, and the student would be
   * right.
   *
   * Ordered worst-first for the same reason the attendance report is: it exists
   * to find who needs help, and registration-number order buries exactly those
   * students in the middle.
   */
  private async progressReport(f: ReportFilters) {
    const enrolments = await this.prisma.scoped.enrolment.findMany({
      where: {
        status: "ACTIVE",
        ...(f.sectionSubjectId ? { sectionSubjectId: f.sectionSubjectId } : {}),
        ...(f.sectionId ? { sectionSubject: { sectionId: f.sectionId } } : {}),
      },
      include: {
        student: { include: { user: { select: { fullName: true } } } },
        sectionSubject: { include: { subject: { select: { code: true, name: true } } } },
      },
    });

    const rows = await Promise.all(
      enrolments.map(async (e: (typeof enrolments)[number]) => {
        const p = await this.progress.forSubject(e.studentId, e.sectionSubjectId);
        return {
          registrationNo: e.student.registrationNo,
          name: e.student.user.fullName,
          subject: `${e.sectionSubject.subject.code} ${e.sectionSubject.subject.name}`,
          progressPercent: p.overallPercent,
          attendancePercent: p.attendance?.percentage ?? null,
          averageGradePercent: p.averageGradePercent ?? null,
          completionMet: p.completionCriteria.met,
          outstanding: p.completionCriteria.outstanding.join("; "),
        };
      }),
    );

    return rows.sort((a, b) => a.progressPercent - b.progressPercent);
  }

  /**
   * Report 8 — assessment status.
   *
   * The column somebody is actually looking for is "awaiting release": work
   * that is marked and that the students cannot see yet (BR-ASG-09). Marking
   * finished and never released is invisible from every other screen — the
   * teacher's roster shows it as done, and the student's shows nothing at all.
   */
  private async assessmentReport(f: ReportFilters) {
    const where = {
      publicationStatus: "PUBLISHED" as const,
      deletedAt: null,
      ...(f.sectionSubjectId ? { sectionSubjectId: f.sectionSubjectId } : {}),
      ...(f.sectionId ? { sectionSubject: { sectionId: f.sectionId } } : {}),
    };

    const [assignments, quizzes] = await Promise.all([
      this.prisma.scoped.assignment.findMany({ where }),
      this.prisma.scoped.quiz.findMany({ where }),
    ]);

    // Assignment and Quiz name their offering by id only — neither model has a
    // relation to traverse — so the offerings are read once and joined here.
    const offeringIds = [
      ...new Set([
        ...assignments.map((a: (typeof assignments)[number]) => a.sectionSubjectId),
        ...quizzes.map((q: (typeof quizzes)[number]) => q.sectionSubjectId),
      ]),
    ];
    const offerings = await this.prisma.asSystem((db) =>
      db.sectionSubject.findMany({
        where: { id: { in: offeringIds } },
        include: {
          subject: { select: { code: true } },
          _count: { select: { enrolments: true } },
        },
      }),
    );
    const offeringOf = new Map(offerings.map((o: (typeof offerings)[number]) => [o.id, o]));

    // COUNTED THROUGH THE SCOPED CLIENT, one aggregate per figure, rather than
    // by loading submissions as a nested include and counting them here.
    //
    // A nested include is not filtered by the scope predicate, and §4.5 grants
    // a STUDENT this report at OWN scope: the include version loaded every
    // classmate's grade to compute a cohort average, and would have told a
    // student the class average before their own mark was released.
    //
    // Counting this way, the same code gives staff the cohort figures and a
    // student their own, because the predicate decides — which is the whole
    // point of ARC-051. The AssignmentGrade policy also withholds unreleased
    // marks from a student, so their average is of released work only.
    const assignmentRows = await Promise.all(
      assignments.map(async (a: (typeof assignments)[number]) => {
        const offering = offeringOf.get(a.sectionSubjectId);
        const [submitted, marked, released, avg] = await Promise.all([
          this.prisma.scoped.assignmentSubmission.count({
            where: { assignmentId: a.id, isLatest: true },
          }),
          this.prisma.scoped.assignmentGrade.count({
            where: { submission: { assignmentId: a.id, isLatest: true } },
          }),
          this.prisma.scoped.assignmentGrade.count({
            where: { submission: { assignmentId: a.id, isLatest: true }, releasedAt: { not: null } },
          }),
          this.prisma.scoped.assignmentGrade.aggregate({
            _avg: { finalMarks: true },
            where: { submission: { assignmentId: a.id, isLatest: true } },
          }),
        ]);
        const mean = avg._avg.finalMarks;
        return {
          subject: offering?.subject.code ?? "",
          type: "Assignment",
          title: a.title,
          dueAt: a.dueAt,
          enrolled: offering?._count.enrolments ?? 0,
          submitted,
          marked,
          awaitingRelease: marked - released,
          averagePercent: asPercent(mean === null ? null : Number(mean), Number(a.marksAvailable)),
        };
      }),
    );

    const quizRows = await Promise.all(
      quizzes.map(async (q: (typeof quizzes)[number]) => {
        const offering = offeringOf.get(q.sectionSubjectId);
        const done = { quizId: q.id, status: { in: DONE_ATTEMPTS } };
        const [submitted, released, avg] = await Promise.all([
          this.prisma.scoped.quizAttempt.count({ where: done }),
          this.prisma.scoped.quizAttempt.count({
            where: { ...done, releasedAt: { not: null } },
          }),
          this.prisma.scoped.quizAttempt.aggregate({
            _avg: { finalScore: true },
            where: { ...done, finalScore: { not: null } },
          }),
        ]);
        const mean = avg._avg.finalScore;
        return {
          subject: offering?.subject.code ?? "",
          type: "Quiz",
          title: q.title,
          dueAt: q.closesAt,
          enrolled: offering?._count.enrolments ?? 0,
          submitted,
          marked: submitted,
          awaitingRelease: submitted - released,
          averagePercent: asPercent(mean === null ? null : Number(mean), Number(q.totalMarks)),
        };
      }),
    );

    // Most outstanding marking first — the reason to open this report.
    return [...assignmentRows, ...quizRows].sort(
      (a, b) => b.awaitingRelease - a.awaitingRelease || b.submitted - a.submitted,
    );
  }

  /**
   * Report 12 — teacher activity.
   *
   * A TEACHER SEES ONLY THEMSELVES, and that is enforced here rather than by
   * the scope predicate. This report aggregates across six models; the
   * predicate constrains each query it is given, but "which teachers appear in
   * the output" is a decision about the SHAPE of the report and no per-model
   * where clause makes it. §4.5 grants a teacher OWN scope on this resource,
   * and this line is what that means in practice.
   *
   * A report on a colleague's productivity is management material. Getting this
   * wrong would not leak a student's data; it would hand every teacher a league
   * table of their peers.
   */
  private async teacherActivity(f: ReportFilters) {
    const actor = getActor();
    if (!actor) throw new AppError("AUTH_TOKEN_INVALID");

    const isStaff = actor.roles.some((r) => r === "admin" || r === "super_admin");
    const teachers = await this.prisma.asSystem((db) =>
      db.teacher.findMany({
        where: isStaff ? { deletedAt: null } : { id: actor.teacherId ?? "__none__" },
        include: { user: { select: { fullName: true } } },
      }),
    );

    const window = {
      ...(f.from ? { gte: f.from } : {}),
      ...(f.to ? { lte: f.to } : {}),
    };
    const inWindow = f.from || f.to ? window : undefined;

    return Promise.all(
      teachers.map(async (t: (typeof teachers)[number]) => {
        const [assignments, sessions, marked, pending, quizzes, subjects] = await Promise.all([
          this.prisma.asSystem((db) =>
            db.assignment.count({
              where: {
                createdBy: t.userId,
                deletedAt: null,
                ...(inWindow ? { createdAt: inWindow } : {}),
              },
            }),
          ),
          this.prisma.asSystem((db) =>
            db.liveSession.count({
              where: {
                hostTeacherId: t.id,
                status: "ENDED",
                ...(inWindow ? { scheduledStart: inWindow } : {}),
              },
            }),
          ),
          this.prisma.asSystem((db) =>
            db.assignmentGrade.findMany({
              where: {
                gradedBy: t.userId,
                ...(inWindow ? { gradedAt: inWindow } : {}),
              },
              select: { gradedAt: true, submission: { select: { submittedAt: true } } },
            }),
          ),
          // Work handed in to THIS teacher's assignments and not yet marked.
          // The number that makes the turnaround fair to read.
          this.prisma.asSystem((db) =>
            db.assignmentSubmission.count({
              where: {
                isLatest: true,
                grade: null,
                assignment: { createdBy: t.userId, deletedAt: null },
              },
            }),
          ),
          this.prisma.asSystem((db) =>
            db.quiz.count({ where: { createdBy: t.userId, deletedAt: null } }),
          ),
          this.prisma.asSystem((db) =>
            // FR-CRS-025 — a teaching assignment has no status; it LAPSES when
            // its endDate passes, which is what withdraws the teacher's scope.
            db.teacherAssignment.count({
              where: {
                teacherId: t.id,
                deletedAt: null,
                OR: [{ endDate: null }, { endDate: { gte: new Date() } }],
              },
            }),
          ),
        ]);

        const registersTaken = await this.prisma.asSystem((db) =>
          db.attendanceRecord.count({
            where: {
              markedBy: t.userId,
              ...(inWindow ? { markedAt: inWindow } : {}),
            },
          }),
        );

        const turnarounds = marked
          .map((g: (typeof marked)[number]) =>
            g.gradedAt && g.submission.submittedAt
              ? (g.gradedAt.getTime() - g.submission.submittedAt.getTime()) / 86_400_000
              : Number.NaN,
          )
          .filter((n: number) => Number.isFinite(n) && n >= 0);

        return {
          teacher: t.user.fullName,
          subjectsTaught: subjects,
          classesHeld: sessions,
          registersTaken,
          assignmentsSet: assignments,
          quizzesSet: quizzes,
          submissionsMarked: marked.length,
          awaitingMarking: pending,
          // MEDIAN, not mean. One submission marked six months late drags a
          // mean into meaninglessness and says nothing about the habit.
          medianDaysToMark: median(turnarounds),
        };
      }),
    );
  }
}

/** An attempt that is finished, whether or not a human has marked it yet. */
const DONE_ATTEMPTS: AttemptStatus[] = ["SUBMITTED", "AUTO_SUBMITTED", "GRADING", "GRADED"];

/** A mean mark as a percentage of what was available. */
function asPercent(mean: number | null, outOf: number): number | null {
  if (mean === null || !Number.isFinite(mean) || outOf <= 0) return null;
  return Math.round((mean / outOf) * 1000) / 10;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const value =
    sorted.length % 2 === 0 ? ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2 : (sorted[mid] as number);
  return Math.round(value * 10) / 10;
}
