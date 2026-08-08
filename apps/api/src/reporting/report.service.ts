import { Injectable, Logger } from "@nestjs/common";
import { AppError } from "@lms/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { AttendanceService } from "../live/attendance.service";
import { getActor } from "../prisma/actor-context";
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
  ) {
    this.register({
      key: "student-directory",
      name: "Student Directory",
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
  }

  private register(def: ReportDefinition): void {
    this.definitions.set(def.key, def);
  }

  list() {
    return [...this.definitions.values()].map((d) => ({
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

    const threshold = 75;
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
}
