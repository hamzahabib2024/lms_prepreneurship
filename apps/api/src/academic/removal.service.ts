import { Injectable, Logger } from "@nestjs/common";
import { AppError } from "@lms/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";

/**
 * REMOVING WHAT WAS CREATED BY MISTAKE — FR-CRS-013, BR-DAT-04.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Setting up a term means creating a lot of records quickly, and some of them
 * are wrong: a batch named for the wrong session, a subject added to the wrong
 * class, a section created twice. Until now there was no way to take any of
 * them back — the office asked a developer, or lived with a duplicate in every
 * dropdown for the rest of the year.
 *
 * THE RULE IS: DELETE WHAT NOTHING DEPENDS ON; ARCHIVE WHAT HAS A HISTORY.
 *
 * That is not a hedge, and it is not this service being cautious on the
 * Institute's behalf. A section that has held one register is the only record
 * that a student was marked present on a Tuesday in March. A subject that has
 * been marked is the only record of what a mark was out of. Deleting those
 * does not tidy the Institute's data; it destroys a student's evidence that
 * they attended and passed, and the person who needs it is usually applying
 * for a job two years later.
 *
 * So every removal here counts what actually hangs off the record and REFUSES
 * BY NAME when something does — "this batch still has 2 sections: SP26-GD-MOR-A,
 * SP26-GD-EVE-B" — rather than failing with a foreign-key error the office
 * cannot act on. Where archiving is the right answer instead, the refusal says
 * so.
 *
 * WHAT "DELETE" MEANS HERE is `deletedAt`, not a DELETE statement. The row
 * leaves every list, every dropdown and every report because the scope
 * predicate (ARC-051) filters on it, and the audit entry records who removed
 * it and what it was. A genuine mistake can be undone by a super administrator
 * with a database at hand; a genuine `DELETE FROM` cannot.
 * ─────────────────────────────────────────────────────────────────────────────
 */
@Injectable()
export class RemovalService {
  private readonly logger = new Logger(RemovalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Refuse, and say exactly what is in the way.
   *
   * `blockers` are the human-readable phrases — "3 enrolled students", "2
   * published assignments" — assembled by each caller from real counts. The
   * office can act on every one of them; "violates foreign key constraint
   * section_subjects_section_id_fkey" is not something anybody can act on.
   */
  private refuse(
    what: string,
    blockers: string[],
    alternative: string,
    verb: "deleted" | "erased" = "deleted",
  ): never {
    throw new AppError("RESOURCE_CONFLICT", {
      details: [
        {
          field: "id",
          code: "HAS_DEPENDENTS",
          message:
            `This ${what} cannot be ${verb} because it still has ` +
            `${joinList(blockers)}. ${alternative}`,
        },
      ],
    });
  }

  // ───────────────────────────────────────────────────────────── subject ──

  /**
   * A subject, from the Institute's catalogue.
   *
   * Removable only while it is taught nowhere. A subject on a programme's
   * curriculum but not yet timetabled is still removable — that link is a
   * plan, not a record of anything having happened.
   */
  async removeSubject(id: string) {
    const subject = await this.prisma.scoped.subject.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, code: true, name: true },
    });
    if (!subject) throw new AppError("RESOURCE_NOT_FOUND");

    const [offerings, modules, curricula] = await Promise.all([
      this.prisma.asSystem((db) =>
        db.sectionSubject.findMany({
          where: { subjectId: id, deletedAt: null },
          select: { section: { select: { code: true } } },
          take: 6,
        }),
      ),
      this.prisma.asSystem((db) => db.module.count({ where: { subjectId: id, deletedAt: null } })),
      this.prisma.asSystem((db) => db.programmeSubject.count({ where: { subjectId: id } })),
    ]);

    if (offerings.length > 0) {
      this.refuse(
        "subject",
        [`${offerings.length === 6 ? "6 or more" : offerings.length} class${offerings.length === 1 ? "" : "es"} teaching it (${offerings.map((o) => o.section.code).join(", ")})`],
        "Remove it from those classes first, or archive the sections if the term is over.",
      );
    }
    if (modules > 0) {
      this.refuse(
        "subject",
        [`${modules} module${modules === 1 ? "" : "s"} of course material`],
        "Delete the material first if it is genuinely unwanted.",
      );
    }

    // The curriculum link is a plan and goes with it. Left behind it would be
    // a programme requiring a subject that no longer exists, and every course
    // tree built from it would show a hole.
    const removed = await this.prisma.asSystem((db) =>
      db.$transaction(async (tx) => {
        if (curricula > 0) await tx.programmeSubject.deleteMany({ where: { subjectId: id } });
        return tx.subject.update({
          where: { id },
          data: { deletedAt: new Date(), isActive: false },
          select: { id: true, code: true, name: true },
        });
      }),
    );

    await this.audit.record({
      action: "subject.delete",
      entityType: "Subject",
      entityId: id,
      before: { code: subject.code, name: subject.name, curriculumLinks: curricula },
      after: { deleted: true },
    });
    this.logger.log(`subject ${subject.code} removed`);
    return { ...removed, deleted: true };
  }

  // ─────────────────────────────────────────────────────────────── batch ──

  /**
   * A batch — one intake of an academic session.
   *
   * Removable only while it holds no sections. Sections are where students
   * and marks live, so a batch with any is a batch with a history even when
   * every section looks empty from here.
   */
  async removeBatch(id: string) {
    const batch = await this.prisma.scoped.batch.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, name: true, academicSessionId: true },
    });
    if (!batch) throw new AppError("RESOURCE_NOT_FOUND");

    const sections = await this.prisma.asSystem((db) =>
      db.section.findMany({
        where: { batchId: id, deletedAt: null },
        select: { code: true },
        take: 6,
      }),
    );
    if (sections.length > 0) {
      this.refuse(
        "batch",
        [`${sections.length === 6 ? "6 or more" : sections.length} section${sections.length === 1 ? "" : "s"} (${sections.map((s) => s.code).join(", ")})`],
        "Delete or archive those sections first.",
      );
    }

    const removed = await this.prisma.scoped.batch.update({
      where: { id },
      data: { deletedAt: new Date() },
      select: { id: true, name: true },
    });

    await this.audit.record({
      action: "batch.delete",
      entityType: "Batch",
      entityId: id,
      before: { name: batch.name, academicSessionId: batch.academicSessionId },
      after: { deleted: true },
    });
    this.logger.log(`batch ${batch.name} removed`);
    return { ...removed, deleted: true };
  }

  // ───────────────────────────────────────────────────────────── section ──

  /**
   * A section — one group of students taught together.
   *
   * THE ONE MOST LIKELY TO BE ASKED FOR AND MOST OFTEN WRONG. A section that
   * has ever enrolled a student holds their attendance and their marks, and
   * FR-CRS-013 is explicit that it is archived rather than removed. Archiving
   * takes it out of every list an administrator works in, which is what they
   * actually wanted; it simply does not throw the records away.
   */
  async removeSection(id: string) {
    const section = await this.prisma.scoped.section.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, code: true, name: true, status: true, batchId: true },
    });
    if (!section) throw new AppError("RESOURCE_NOT_FOUND");

    const [students, offerings, registrations] = await Promise.all([
      this.prisma.asSystem((db) => db.student.count({ where: { currentSectionId: id } })),
      this.prisma.asSystem((db) =>
        db.sectionSubject.findMany({
          where: { sectionId: id, deletedAt: null },
          select: { subject: { select: { code: true } } },
          take: 6,
        }),
      ),
      this.prisma.asSystem((db) => db.registrationRequest.count({ where: { desiredSectionId: id } })),
    ]);

    const blockers: string[] = [];
    if (students > 0) blockers.push(`${students} student${students === 1 ? "" : "s"} in it`);
    if (registrations > 0) {
      blockers.push(`${registrations} admission${registrations === 1 ? "" : "s"} pointing at it`);
    }
    if (blockers.length > 0) {
      this.refuse(
        "section",
        blockers,
        "Archive it instead — that removes it from every list while keeping the attendance " +
          "and marks the students in it will need later.",
      );
    }
    if (offerings.length > 0) {
      this.refuse(
        "section",
        [`${offerings.length === 6 ? "6 or more" : offerings.length} subject${offerings.length === 1 ? "" : "s"} on it (${offerings.map((o) => o.subject.code).join(", ")})`],
        "Remove those subjects from it first.",
      );
    }

    const removed = await this.prisma.scoped.section.update({
      where: { id },
      data: { deletedAt: new Date(), status: "ARCHIVED" },
      select: { id: true, code: true, name: true },
    });

    await this.audit.record({
      action: "section.delete",
      entityType: "Section",
      entityId: id,
      before: { code: section.code, name: section.name, status: section.status },
      after: { deleted: true },
    });
    this.logger.log(`section ${section.code} removed`);
    return { ...removed, deleted: true };
  }

  // ──────────────────────────────────────────────── a subject on a batch ──

  /**
   * One subject as taught to one group — the thing an administrator means by
   * "remove Maths from the evening class".
   *
   * The pivot of the whole model (BR-CNT-03), so this is the check that has to
   * be the most thorough: assignments, quizzes, recordings, registers,
   * certificates and completions all hang off THIS, not off the subject.
   *
   * The teacher's posting goes with it. That is not history worth keeping on
   * its own — a teacher assigned to a class that is not being taught is a row
   * that shows up in their timetable and in nobody's plans.
   */
  async removeSectionSubject(id: string) {
    const offering = await this.prisma.scoped.sectionSubject.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        subject: { select: { code: true, name: true } },
        section: { select: { code: true } },
      },
    });
    if (!offering) throw new AppError("RESOURCE_NOT_FOUND");

    const [enrolments, assignments, quizzes, lectures, sessions, certificates, completions] =
      await Promise.all([
        this.prisma.asSystem((db) => db.enrolment.count({ where: { sectionSubjectId: id } })),
        this.prisma.asSystem((db) =>
          db.assignment.count({ where: { sectionSubjectId: id, deletedAt: null } }),
        ),
        this.prisma.asSystem((db) =>
          db.quiz.count({ where: { sectionSubjectId: id, deletedAt: null } }),
        ),
        this.prisma.asSystem((db) =>
          db.recordedLecture.count({ where: { sectionSubjectId: id, deletedAt: null } }),
        ),
        this.prisma.asSystem((db) => db.liveSession.count({ where: { sectionSubjectId: id } })),
        this.prisma.asSystem((db) => db.certificate.count({ where: { sectionSubjectId: id } })),
        this.prisma.asSystem((db) =>
          db.subjectCompletion.count({ where: { sectionSubjectId: id } }),
        ),
      ]);

    const blockers: string[] = [];
    if (enrolments > 0) blockers.push(`${enrolments} enrolled student${enrolments === 1 ? "" : "s"}`);
    if (assignments > 0) blockers.push(`${assignments} assignment${assignments === 1 ? "" : "s"}`);
    if (quizzes > 0) blockers.push(`${quizzes} quiz${quizzes === 1 ? "" : "zes"}`);
    if (lectures > 0) blockers.push(`${lectures} recording${lectures === 1 ? "" : "s"}`);
    if (sessions > 0) blockers.push(`${sessions} class${sessions === 1 ? "" : "es"} on the register`);
    if (certificates > 0) {
      blockers.push(`${certificates} certificate${certificates === 1 ? "" : "s"} issued from it`);
    }
    if (completions > 0) {
      blockers.push(`${completions} completion decision${completions === 1 ? "" : "s"}`);
    }

    if (blockers.length > 0) {
      this.refuse(
        "subject",
        blockers,
        "It has been taught. Set its status to closed rather than deleting it — the students " +
          "in it will need their marks and attendance long after the term ends.",
      );
    }

    const removed = await this.prisma.asSystem((db) =>
      db.$transaction(async (tx) => {
        await tx.teacherAssignment.deleteMany({ where: { sectionSubjectId: id } });
        // `deletedAt` alone. `status` on this model is a free-text column with
        // no agreed vocabulary, and inventing a "CANCELLED" for it would put a
        // value in the database that nothing else in the System reads or
        // recognises. The scope predicate filters on deletedAt regardless.
        return tx.sectionSubject.update({
          where: { id },
          data: { deletedAt: new Date() },
          select: { id: true },
        });
      }),
    );

    await this.audit.record({
      action: "section_subject.delete",
      entityType: "SectionSubject",
      entityId: id,
      before: { subject: offering.subject.code, section: offering.section.code },
      after: { deleted: true },
    });
    this.logger.log(`${offering.subject.code} removed from ${offering.section.code}`);
    return { ...removed, deleted: true };
  }

  // ══════════════════════════════ erasing it for good ══════════════════════

  /**
   * PERMANENT DELETION — the row itself, not a `deletedAt` stamp.
   *
   * ─────────────────────────────────────────────────────────────────────────
   * The removals above hide a record: it leaves every list, every dropdown and
   * every report, and a super administrator with a database at hand can put it
   * back. That is the right default and it is what almost everybody wants.
   *
   * It is not what everybody wants. An Institute setting up its first term
   * makes a dozen throwaway records while learning the software, and being
   * told they are "deleted" while they sit in the database forever is its own
   * kind of untidy — particularly for whoever inherits the system later and
   * cannot tell a real record from a rehearsal.
   *
   * SO THIS ACTUALLY DELETES, and every safeguard from the soft version still
   * applies. Nothing that has been taught can be erased, and the same counts
   * decide it — WITH ONE DIFFERENCE: soft-deleted dependants count here too.
   * A deleted assignment is invisible but its row still exists and still holds
   * a foreign key, so a subject that looks clear on screen can be firmly held
   * in the database, and finding that out from a constraint violation helps
   * nobody.
   *
   * IT WORKS ON ALREADY-DELETED RECORDS, which is the ordinary path: delete it
   * to get it off the screen, then purge it when you are sure.
   *
   * The lookups run as the System rather than through the scope predicate,
   * because a soft-deleted row is invisible to the predicate by design and
   * this is the one operation that has to see it. Safe because the routes are
   * admin and super-admin only, and both hold ALL scope on these resources —
   * there is no narrowing being skipped, only a `deletedAt` filter.
   * ─────────────────────────────────────────────────────────────────────────
   */

  /**
   * The last line of defence.
   *
   * Every foreign key into these tables is `Restrict`, and there are more of
   * them than any one person keeps in their head. If a relation exists that
   * the counts above do not cover, the database refuses — correctly — and
   * this turns P2003 into a sentence the office can read instead of a stack
   * trace. Better a refusal nobody expected than a crash nobody understands.
   */
  private async erase<T>(what: string, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === "P2003" || code === "P2014") {
        throw new AppError("RESOURCE_CONFLICT", {
          details: [
            {
              field: "id",
              code: "STILL_REFERENCED",
              message:
                `This ${what} cannot be erased because other records still point at it. ` +
                `Delete it instead — that removes it from every screen and keeps the ` +
                `records that depend on it intact.`,
            },
          ],
        });
      }
      throw e;
    }
  }

  /** Permanently erase a subject. */
  async purgeSubject(id: string) {
    const subject = await this.prisma.asSystem((db) =>
      db.subject.findUnique({ where: { id }, select: { id: true, code: true, name: true } }),
    );
    if (!subject) throw new AppError("RESOURCE_NOT_FOUND");

    // Deleted ones count too — see the note above.
    const [offerings, modules] = await Promise.all([
      this.prisma.asSystem((db) =>
        db.sectionSubject.findMany({
          where: { subjectId: id },
          select: { section: { select: { code: true } } },
          take: 6,
        }),
      ),
      this.prisma.asSystem((db) => db.module.count({ where: { subjectId: id } })),
    ]);
    if (offerings.length > 0) {
      this.refuse(
        "subject",
        [`${offerings.length === 6 ? "6 or more" : offerings.length} class${offerings.length === 1 ? "" : "es"} on record (${offerings.map((o) => o.section.code).join(", ")})`],
        "Erase those first, or delete this subject instead of erasing it.",
        "erased",
      );
    }
    if (modules > 0) {
      this.refuse(
        "subject",
        [`${modules} module${modules === 1 ? "" : "s"} of course material on record`],
        "Erase the material first, or delete this subject instead of erasing it.",
        "erased",
      );
    }

    await this.erase("subject", () =>
      this.prisma.asSystem((db) =>
        db.$transaction(async (tx) => {
          await tx.programmeSubject.deleteMany({ where: { subjectId: id } });
          await tx.subject.delete({ where: { id } });
        }),
      ),
    );

    await this.audit.record({
      action: "subject.purge",
      entityType: "Subject",
      entityId: id,
      before: { code: subject.code, name: subject.name },
      after: { erased: true },
    });
    this.logger.warn(`subject ${subject.code} ERASED permanently`);
    return { id, code: subject.code, name: subject.name, erased: true };
  }

  /** Permanently erase a batch. */
  async purgeBatch(id: string) {
    const batch = await this.prisma.asSystem((db) =>
      db.batch.findUnique({ where: { id }, select: { id: true, name: true } }),
    );
    if (!batch) throw new AppError("RESOURCE_NOT_FOUND");

    const sections = await this.prisma.asSystem((db) =>
      db.section.findMany({ where: { batchId: id }, select: { code: true }, take: 6 }),
    );
    if (sections.length > 0) {
      this.refuse(
        "batch",
        [`${sections.length === 6 ? "6 or more" : sections.length} section${sections.length === 1 ? "" : "s"} on record (${sections.map((x) => x.code).join(", ")})`],
        "Erase those sections first, or delete this batch instead of erasing it.",
        "erased",
      );
    }

    await this.erase("batch", () =>
      this.prisma.asSystem((db) => db.batch.delete({ where: { id } })),
    );

    await this.audit.record({
      action: "batch.purge",
      entityType: "Batch",
      entityId: id,
      before: { name: batch.name },
      after: { erased: true },
    });
    this.logger.warn(`batch ${batch.name} ERASED permanently`);
    return { id, name: batch.name, erased: true };
  }

  /** Permanently erase a section. */
  async purgeSection(id: string) {
    const section = await this.prisma.asSystem((db) =>
      db.section.findUnique({ where: { id }, select: { id: true, code: true, name: true } }),
    );
    if (!section) throw new AppError("RESOURCE_NOT_FOUND");

    const [students, offerings, registrations] = await Promise.all([
      this.prisma.asSystem((db) => db.student.count({ where: { currentSectionId: id } })),
      this.prisma.asSystem((db) =>
        db.sectionSubject.findMany({
          where: { sectionId: id },
          select: { subject: { select: { code: true } } },
          take: 6,
        }),
      ),
      this.prisma.asSystem((db) =>
        db.registrationRequest.count({ where: { desiredSectionId: id } }),
      ),
    ]);

    const blockers: string[] = [];
    if (students > 0) blockers.push(`${students} student${students === 1 ? "" : "s"} on record`);
    if (registrations > 0) {
      blockers.push(`${registrations} admission${registrations === 1 ? "" : "s"} on record`);
    }
    if (offerings.length > 0) {
      blockers.push(
        `${offerings.length === 6 ? "6 or more" : offerings.length} subject${offerings.length === 1 ? "" : "s"} on record (${offerings.map((o) => o.subject.code).join(", ")})`,
      );
    }
    if (blockers.length > 0) {
      this.refuse(
        "section",
        blockers,
        "Erase or move those first. If any of it is real, archive the section instead — that " +
          "keeps the attendance and marks the students in it will need later.",
        "erased",
      );
    }

    await this.erase("section", () =>
      this.prisma.asSystem((db) => db.section.delete({ where: { id } })),
    );

    await this.audit.record({
      action: "section.purge",
      entityType: "Section",
      entityId: id,
      before: { code: section.code, name: section.name },
      after: { erased: true },
    });
    this.logger.warn(`section ${section.code} ERASED permanently`);
    return { id, code: section.code, name: section.name, erased: true };
  }

  /** Permanently erase one subject's place on one class. */
  async purgeSectionSubject(id: string) {
    const offering = await this.prisma.asSystem((db) =>
      db.sectionSubject.findUnique({
        where: { id },
        select: {
          id: true,
          subject: { select: { code: true } },
          section: { select: { code: true } },
        },
      }),
    );
    if (!offering) throw new AppError("RESOURCE_NOT_FOUND");

    const [enrolments, assignments, quizzes, lectures, sessions, certificates, completions] =
      await Promise.all([
        this.prisma.asSystem((db) => db.enrolment.count({ where: { sectionSubjectId: id } })),
        this.prisma.asSystem((db) => db.assignment.count({ where: { sectionSubjectId: id } })),
        this.prisma.asSystem((db) => db.quiz.count({ where: { sectionSubjectId: id } })),
        this.prisma.asSystem((db) => db.recordedLecture.count({ where: { sectionSubjectId: id } })),
        this.prisma.asSystem((db) => db.liveSession.count({ where: { sectionSubjectId: id } })),
        this.prisma.asSystem((db) => db.certificate.count({ where: { sectionSubjectId: id } })),
        this.prisma.asSystem((db) =>
          db.subjectCompletion.count({ where: { sectionSubjectId: id } }),
        ),
      ]);

    const blockers: string[] = [];
    if (enrolments > 0) blockers.push(`${enrolments} enrolment${enrolments === 1 ? "" : "s"} on record`);
    if (assignments > 0) blockers.push(`${assignments} assignment${assignments === 1 ? "" : "s"} on record`);
    if (quizzes > 0) blockers.push(`${quizzes} quiz${quizzes === 1 ? "" : "zes"} on record`);
    if (lectures > 0) blockers.push(`${lectures} recording${lectures === 1 ? "" : "s"} on record`);
    if (sessions > 0) blockers.push(`${sessions} class${sessions === 1 ? "" : "es"} on the register`);
    if (certificates > 0) blockers.push(`${certificates} certificate${certificates === 1 ? "" : "s"} on record`);
    if (completions > 0) blockers.push(`${completions} completion decision${completions === 1 ? "" : "s"}`);

    if (blockers.length > 0) {
      this.refuse(
        "subject",
        blockers,
        "It has been taught. Delete it instead of erasing it — the students in it will need " +
          "their marks and attendance long after the term ends.",
        "erased",
      );
    }

    await this.erase("subject", () =>
      this.prisma.asSystem((db) =>
        db.$transaction(async (tx) => {
          await tx.teacherAssignment.deleteMany({ where: { sectionSubjectId: id } });
          await tx.discussionPost.deleteMany({ where: { sectionSubjectId: id } });
          await tx.sectionSubject.delete({ where: { id } });
        }),
      ),
    );

    await this.audit.record({
      action: "section_subject.purge",
      entityType: "SectionSubject",
      entityId: id,
      before: { subject: offering.subject.code, section: offering.section.code },
      after: { erased: true },
    });
    this.logger.warn(`${offering.subject.code} ERASED from ${offering.section.code}`);
    return { id, erased: true };
  }
}

/**
 * "a and b", "a, b and c" — a sentence, not an array printed at somebody.
 *
 * These messages are read by the office under time pressure while setting up a
 * term, and "3 enrolled students, 2 assignments" reads as a fragment where
 * "3 enrolled students and 2 assignments" reads as an explanation.
 */
function joinList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
