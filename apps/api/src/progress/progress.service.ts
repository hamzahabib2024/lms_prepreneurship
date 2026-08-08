import { Injectable, Logger } from "@nestjs/common";
import { AppError } from "@lms/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AttendanceService } from "../live/attendance.service";
import { getActor } from "../prisma/actor-context";
import {
  DEFAULT_WEIGHTS,
  computeProgress,
  evaluateCompletion,
  type ComponentInputs,
  type ComponentKey,
  type CompletionCriteria,
} from "./progress-formula";

/**
 * Progress — SRS §5.14.
 *
 * Gathers the four components and hands them to the pure formula. All the
 * judgement lives in progress-formula.ts, which is why this service is mostly
 * queries: the arithmetic that decides certification should be testable
 * without a database.
 *
 * ARC-007 / DB-011: progress is DERIVED. It is computed on read here. A
 * materialised copy would need a computedAt stamp and an invalidation story,
 * and at this scale the query is cheap enough that the extra machinery would
 * cost more than it saves.
 */
@Injectable()
export class ProgressService {
  private readonly logger = new Logger(ProgressService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly attendance: AttendanceService,
  ) {}

  /** FR-PRG-001/004 — progress in one subject, with its breakdown. */
  async forSubject(studentId: string, sectionSubjectId: string) {
    const enrolment = await this.prisma.scoped.enrolment.findFirst({
      where: { studentId, sectionSubjectId },
      include: {
        sectionSubject: {
          include: { subject: { select: { id: true, code: true, name: true } } },
        },
      },
    });
    if (!enrolment) throw new AppError("RESOURCE_NOT_FOUND");

    const ss = enrolment.sectionSubject;
    const subjectId = ss.subject.id;

    const [videoTotal, videoDone, asgTotal, asgDone, attendance] = await Promise.all([
      // Only PUBLISHED items count. Counting drafts would move a student's
      // progress backwards the moment a teacher starts preparing next week's
      // material (BR-CNT-01).
      this.prisma.asSystem((db) =>
        db.recordedLecture.count({
          where: { sectionSubjectId, publicationStatus: "PUBLISHED", deletedAt: null },
        }),
      ),
      // Watch progress lands with the content module; until then the video
      // component is honestly zero rather than fabricated.
      Promise.resolve(0),
      this.prisma.asSystem((db) =>
        db.assignment.count({
          where: { sectionSubjectId, publicationStatus: "PUBLISHED", deletedAt: null },
        }),
      ),
      this.prisma.asSystem((db) =>
        db.assignmentSubmission.count({
          where: {
            studentId,
            isLatest: true,
            assignment: { sectionSubjectId, publicationStatus: "PUBLISHED", deletedAt: null },
          },
        }),
      ),
      this.attendance.percentageFor(studentId, sectionSubjectId),
    ]);

    const inputs: ComponentInputs = {
      video: { completed: videoDone, total: videoTotal },
      assignment: { completed: asgDone, total: asgTotal },
      // Quizzes are not built yet. total: 0 makes BR-PRG-03 exclude the
      // component and redistribute its weight, which is exactly right — a
      // student must not be penalised for a component that does not exist.
      quiz: { completed: 0, total: 0 },
      attendance: {
        completed: attendance.present + attendance.late,
        total: attendance.sessionsInDenominator,
      },
    };

    const weights = this.weightsFor(ss.progressWeights);
    const progress = computeProgress(inputs, weights);

    const averageGrade = await this.averageGradePercent(studentId, sectionSubjectId);
    const criteria = this.criteriaFor(ss.completionCriteria);
    const completion = evaluateCompletion(progress, criteria, {
      attendancePercent: attendance.percentage,
      averageGradePercent: averageGrade,
    });

    return {
      studentId,
      subject: ss.subject,
      overallPercent: progress.overallPercent,
      // FR-PRG-006 — computed on read, so it is never stale. Returned anyway
      // so the interface can display "as at" consistently (ARC-048).
      computedAt: new Date(),
      components: progress.components,
      weightsRedistributed: progress.weightsRedistributed,
      weightsApplied: progress.weightsApplied,
      attendance: {
        percentage: attendance.percentage,
        sessionsInDenominator: attendance.sessionsInDenominator,
      },
      averageGradePercent: averageGrade,
      completionCriteria: { ...criteria, met: completion.met, outstanding: completion.outstanding },
      enrolmentStatus: enrolment.status,
    };
  }

  /** FR-PRG-007 — across every active subject, plus an overall figure. */
  async forStudent(studentId: string) {
    const enrolments = await this.prisma.scoped.enrolment.findMany({
      where: { studentId, status: { in: ["ACTIVE", "COMPLETED"] } },
      select: { sectionSubjectId: true },
    });

    const perSubject = await Promise.all(
      enrolments.map((e: (typeof enrolments)[number]) =>
        this.forSubject(studentId, e.sectionSubjectId),
      ),
    );

    // A plain mean across subjects. Credit-weighting is available in the data
    // model but the Institute has not confirmed a credit scheme (OPN-11), so
    // weighting now would be inventing policy rather than implementing it.
    const overall =
      perSubject.length === 0
        ? 0
        : Math.round(
            (perSubject.reduce((s, p) => s + p.overallPercent, 0) / perSubject.length) * 10,
          ) / 10;

    return {
      studentId,
      overallPercent: overall,
      subjectCount: perSubject.length,
      completedCount: perSubject.filter((p) => p.completionCriteria.met).length,
      computedAt: new Date(),
      subjects: perSubject.map((p) => ({
        subject: p.subject,
        overallPercent: p.overallPercent,
        attendancePercent: p.attendance.percentage,
        completionMet: p.completionCriteria.met,
        outstanding: p.completionCriteria.outstanding,
      })),
    };
  }

  /** The signed-in student's own progress, without needing their own id. */
  async mine() {
    const actor = getActor();
    if (!actor?.studentId) {
      throw new AppError("AUTH_FORBIDDEN", { message: "Only a student has progress to show." });
    }
    return this.forStudent(actor.studentId);
  }

  /**
   * FR-PRG-011/012 — the cohort view for a teacher, sorted worst-first.
   *
   * Ordering by lowest progress is the point: the teacher opens this to find
   * who needs help, and a roll-number ordering buries exactly those students
   * in the middle of the list.
   */
  async forSectionSubject(sectionSubjectId: string) {
    const enrolments = await this.prisma.scoped.enrolment.findMany({
      where: { sectionSubjectId, status: "ACTIVE" },
      include: { student: { include: { user: { select: { fullName: true } } } } },
    });

    const rows = await Promise.all(
      enrolments.map(async (e: (typeof enrolments)[number]) => {
        const p = await this.forSubject(e.studentId, sectionSubjectId);
        return {
          studentId: e.studentId,
          rollNo: e.student.currentRollNo,
          name: e.student.user.fullName,
          overallPercent: p.overallPercent,
          attendancePercent: p.attendance.percentage,
          averageGradePercent: p.averageGradePercent,
          completionMet: p.completionCriteria.met,
        };
      }),
    );

    const withProgress = rows.filter((r) => r.overallPercent > 0);
    return {
      sectionSubjectId,
      studentCount: rows.length,
      averageProgress:
        withProgress.length === 0
          ? 0
          : Math.round(
              (withProgress.reduce((s, r) => s + r.overallPercent, 0) / withProgress.length) * 10,
            ) / 10,
      completedCount: rows.filter((r) => r.completionMet).length,
      students: rows.sort((a, b) => a.overallPercent - b.overallPercent),
    };
  }

  // ------------------------------------------------------------- internals --

  /** Mean of RELEASED grades only — an unreleased mark is not yet a fact. */
  private async averageGradePercent(
    studentId: string,
    sectionSubjectId: string,
  ): Promise<number | null> {
    const grades = await this.prisma.asSystem((db) =>
      db.assignmentGrade.findMany({
        where: {
          releasedAt: { not: null },
          submission: {
            studentId,
            isLatest: true,
            assignment: { sectionSubjectId, deletedAt: null },
          },
        },
        include: { submission: { include: { assignment: { select: { marksAvailable: true } } } } },
      }),
    );
    if (grades.length === 0) return null;

    const total = grades.reduce((sum, g) => {
      const available = Number(g.submission.assignment.marksAvailable);
      if (available <= 0) return sum;
      return sum + (Number(g.finalMarks) / available) * 100;
    }, 0);

    return Math.round((total / grades.length) * 10) / 10;
  }

  /** CFG-PRG-01..04 — per-subject override, falling back to institute defaults. */
  private weightsFor(configured: unknown): Record<ComponentKey, number> {
    if (!configured || typeof configured !== "object") return DEFAULT_WEIGHTS;
    const c = configured as Partial<Record<ComponentKey, number>>;
    const merged = {
      video: c.video ?? DEFAULT_WEIGHTS.video,
      assignment: c.assignment ?? DEFAULT_WEIGHTS.assignment,
      quiz: c.quiz ?? DEFAULT_WEIGHTS.quiz,
      attendance: c.attendance ?? DEFAULT_WEIGHTS.attendance,
    };
    const sum = Object.values(merged).reduce((a, b) => a + b, 0);
    if (Math.abs(sum - 1) > 0.0001) {
      // Bad configuration must not corrupt every student's figure. Fall back
      // and make the misconfiguration loud instead.
      this.logger.error(
        `Progress weights for a subject sum to ${sum.toFixed(4)}, not 1.00; using institute defaults.`,
      );
      return DEFAULT_WEIGHTS;
    }
    return merged;
  }

  private criteriaFor(configured: unknown): CompletionCriteria {
    const defaults: CompletionCriteria = {
      minProgressPercent: 80,
      minAttendancePercent: 75,
      minAverageGradePercent: 50,
    };
    if (!configured || typeof configured !== "object") return defaults;
    return { ...defaults, ...(configured as CompletionCriteria) };
  }
}
