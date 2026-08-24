import { Injectable, Logger } from "@nestjs/common";
import { AppError } from "@lms/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { ProgressService } from "./progress.service";
import { getActor } from "../prisma/actor-context";

export type Decision = "IN_PROGRESS" | "COMPLETED" | "NOT_COMPLETED";

/**
 * SIGNING OFF THAT A STUDENT HAS FINISHED — FR-CRT, FR-PRG.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A PERSON DECIDES SOMETHING THE SYSTEM ALREADY CALCULATES.
 *
 * Completion has always been computed — attendance, work submitted, marks and
 * lectures watched, weighed against criteria — and a certificate was issued
 * when that arithmetic said so. The arithmetic is good. It is also blind to
 * everything that is not in it.
 *
 * It cannot know that a student sat a viva to make up a missed brief, that a
 * term lost two weeks, or that somebody who scraped past every threshold by a
 * single point is plainly not ready to be handed a document with the
 * Institute's name on it. A certificate is the most public thing this System
 * makes: it is framed, photographed and shown to employers for years. Issuing
 * one on a threshold alone is a decision nobody made.
 *
 * So the figure stays exactly as it is, and a human judgement is recorded
 * BESIDE it — never replacing it, always attributed, with the arithmetic as it
 * stood copied onto the row. That last part is the whole value: it is the
 * difference between "the teacher agreed with the System" and "the teacher
 * overrode it", and it is the answer when somebody asks, a year later, why a
 * certificate went to a student whose attendance reads 61%.
 *
 * WHO DECIDES WHAT, and the separation is deliberate:
 *
 *   A TEACHER signs off the classes they teach. They are the only person who
 *   knows whether the work was actually done.
 *
 *   THE OFFICE issues the certificate. Deliberately not the same person: the
 *   one who decides a student has finished should not also be the one who
 *   prints the document saying so.
 * ─────────────────────────────────────────────────────────────────────────────
 */
@Injectable()
export class CompletionService {
  private readonly logger = new Logger(CompletionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly progress: ProgressService,
  ) {}

  /**
   * Everybody in a class, where the arithmetic puts them, and what a person
   * has decided — the screen a teacher works down at the end of a term.
   */
  async roster(sectionSubjectId: string) {
    // Scoped: a teacher reaches only the classes they teach, and the predicate
    // is what enforces that rather than a check here.
    const ss = await this.prisma.scoped.sectionSubject.findFirst({
      where: { id: sectionSubjectId, deletedAt: null },
      select: {
        id: true,
        subject: { select: { name: true } },
        section: { select: { name: true, code: true } },
      },
    });
    if (!ss) throw new AppError("RESOURCE_NOT_FOUND");

    const enrolments = await this.prisma.scoped.enrolment.findMany({
      where: { sectionSubjectId, status: { in: ["ACTIVE", "COMPLETED"] }, deletedAt: null },
      select: {
        studentId: true,
        student: {
          select: {
            id: true,
            currentRollNo: true,
            registrationNo: true,
            user: { select: { fullName: true } },
          },
        },
      },
    });

    const decisions = await this.prisma.asSystem((db) =>
      db.subjectCompletion.findMany({
        where: { sectionSubjectId },
        select: {
          studentId: true,
          decision: true,
          note: true,
          computedPercent: true,
          criteriaMet: true,
          decidedAt: true,
          decider: { select: { fullName: true } },
        },
      }),
    );
    const byStudent = new Map(decisions.map((d) => [d.studentId, d]));

    /*
     * The arithmetic, per student, computed now rather than read from
     * anywhere — FR-PRG-006. It is the evidence the person signing off is
     * looking at, so it must be current at the moment they look.
     */
    const rows = await Promise.all(
      enrolments.map(async (e) => {
        const p = await this.progress.forSubject(e.studentId, sectionSubjectId).catch(() => null);
        const decided = byStudent.get(e.studentId);
        return {
          studentId: e.studentId,
          rollNo: e.student.currentRollNo,
          registrationNo: e.student.registrationNo,
          name: e.student.user.fullName,
          computedPercent: p?.overallPercent ?? null,
          criteriaMet: p?.completionCriteria.met ?? false,
          outstanding: p?.completionCriteria.outstanding ?? [],
          attendancePercent: p?.attendance.percentage ?? null,
          decision: (decided?.decision ?? "IN_PROGRESS") as Decision,
          note: decided?.note ?? null,
          decidedBy: decided?.decider.fullName ?? null,
          decidedAt: decided?.decidedAt ?? null,
          /*
           * Whether the recorded decision disagrees with the arithmetic AS IT
           * STOOD WHEN IT WAS MADE — not as it stands now. A student who has
           * since submitted more work has not retrospectively turned somebody's
           * override into an agreement.
           */
          wasOverride: decided ? decided.criteriaMet !== (decided.decision === "COMPLETED") : false,
        };
      }),
    );

    rows.sort((a, b) => (a.rollNo ?? 9999) - (b.rollNo ?? 9999));

    return {
      sectionSubject: {
        id: ss.id,
        subject: ss.subject.name,
        section: ss.section.name,
        code: ss.section.code,
      },
      summary: {
        enrolled: rows.length,
        completed: rows.filter((r) => r.decision === "COMPLETED").length,
        notCompleted: rows.filter((r) => r.decision === "NOT_COMPLETED").length,
        undecided: rows.filter((r) => r.decision === "IN_PROGRESS").length,
        // How many the arithmetic would pass, so a teacher can see at a glance
        // whether their judgement and the System are far apart.
        criteriaMet: rows.filter((r) => r.criteriaMet).length,
      },
      students: rows,
    };
  }

  /**
   * Record the decision. One per student per subject, replaced rather than
   * accumulated — the question has one current answer, and the audit log keeps
   * the history of how it changed.
   */
  async decide(
    sectionSubjectId: string,
    studentId: string,
    input: { decision: Decision; note?: string },
  ) {
    const actor = getActor();
    if (!actor) throw new AppError("AUTH_TOKEN_INVALID");

    const ss = await this.prisma.scoped.sectionSubject.findFirst({
      where: { id: sectionSubjectId, deletedAt: null },
      select: { id: true },
    });
    if (!ss) throw new AppError("RESOURCE_NOT_FOUND");

    const enrolled = await this.prisma.scoped.enrolment.findFirst({
      where: { sectionSubjectId, studentId, deletedAt: null },
      select: { id: true },
    });
    if (!enrolled) {
      throw new AppError("VALIDATION_FAILED", {
        details: [
          {
            field: "studentId",
            code: "NOT_ENROLLED",
            message: "That student is not enrolled in this class.",
          },
        ],
      });
    }

    // The arithmetic as it stands NOW, copied onto the decision.
    const p = await this.progress.forSubject(studentId, sectionSubjectId).catch(() => null);
    const criteriaMet = p?.completionCriteria.met ?? false;
    const computedPercent = p?.overallPercent ?? null;

    /*
     * A DECISION AGAINST THE ARITHMETIC MUST SAY WHY, and it is checked here as
     * well as by the database. The constraint is the guarantee; this is the
     * sentence somebody can act on, delivered while they are still looking at
     * the form rather than as a violation naming a table.
     */
    const disagrees = criteriaMet !== (input.decision === "COMPLETED");
    const note = input.note?.trim() ?? "";
    if (disagrees && note.length < 10) {
      throw new AppError("VALIDATION_FAILED", {
        details: [
          {
            field: "note",
            code: "REASON_REQUIRED",
            message: criteriaMet
              ? "This student meets the requirements, so marking them not complete needs a reason — " +
                "somebody will ask, and the answer should be on the record rather than in your memory."
              : "This student does not yet meet the requirements, so passing them needs a reason. " +
                "Say what they did that the figures do not show.",
          },
        ],
      });
    }

    const existing = await this.prisma.asSystem((db) =>
      db.subjectCompletion.findFirst({
        where: { studentId, sectionSubjectId },
        select: { id: true, decision: true, note: true },
      }),
    );

    const data = {
      decision: input.decision,
      note: note || null,
      computedPercent,
      criteriaMet,
      decidedBy: actor.userId,
      decidedAt: new Date(),
    };

    const saved = await this.prisma.asSystem((db) =>
      existing
        ? db.subjectCompletion.update({ where: { id: existing.id }, data })
        : db.subjectCompletion.create({ data: { ...data, studentId, sectionSubjectId } }),
    );

    await this.audit.record({
      action: "subject_completion.decide",
      entityType: "SubjectCompletion",
      entityId: saved.id,
      before: existing ? { decision: existing.decision, note: existing.note } : null,
      after: {
        decision: input.decision,
        note: note || null,
        computedPercent,
        criteriaMet,
        // Recorded explicitly rather than left to be inferred later.
        override: disagrees,
      },
    });

    if (disagrees) {
      this.logger.log(
        `Completion for ${studentId} in ${sectionSubjectId} set to ${input.decision} against the ` +
          `computed criteria (met=${criteriaMet}) by ${actor.userId}.`,
      );
    }

    return {
      decision: input.decision,
      criteriaMet,
      computedPercent,
      override: disagrees,
      note: note || null,
    };
  }

  /** What a student has been signed off for — read by them, and by the office. */
  async forStudent(studentId: string) {
    const rows = await this.prisma.scoped.subjectCompletion.findMany({
      where: { studentId },
      select: {
        sectionSubjectId: true,
        decision: true,
        note: true,
        decidedAt: true,
        sectionSubject: {
          select: { subject: { select: { name: true } }, section: { select: { code: true } } },
        },
      },
      orderBy: { decidedAt: "desc" },
    });
    return rows.map((r) => ({
      sectionSubjectId: r.sectionSubjectId,
      subject: r.sectionSubject.subject.name,
      section: r.sectionSubject.section.code,
      decision: r.decision,
      // The reason is NOT returned to a student. It is a note between staff
      // about a judgement, and "did not attend enough to justify passing" is
      // not a sentence to deliver through a web page with nobody in the room.
      decidedAt: r.decidedAt,
    }));
  }
}
