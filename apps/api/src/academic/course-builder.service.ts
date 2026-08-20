import { Injectable, Logger } from "@nestjs/common";
import { AppError, type QuickBatchCreateInput } from "@lms/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";

/**
 * Building a course the way an administrator thinks about one.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TWO MODELS OF THE SAME THING.
 *
 * The System's:   Programme → AcademicSession → Batch → Section → Subject
 * An administrator's:            Subjects → Course → Batches
 *
 * What they call a BATCH is a Section — that is where the gender restriction,
 * the capacity and the shift actually live, and "a female batch and a male
 * batch of the same course" is two Sections under one Programme. What the
 * System calls a Batch is a fourth layer between the term and the section, and
 * in every piece of real data this Institute holds, each term contains exactly
 * one of them.
 *
 * WHAT THAT COST. Creating a class meant: create a term (Structure), then a
 * delivery group (Structure), then a section (Sections), then offer subjects to
 * it (Sections again) — four steps across two screens, each refusing to begin
 * until the one above it existed, and none of them saying so. An administrator
 * who did not already know the model could not get to the end, and the ones who
 * did got there by remembering an order nothing on screen described.
 *
 * This service does the whole of it from the three things they actually know:
 * which course, what the batch is called, and who is in it.
 *
 * NOTHING IS HIDDEN FROM THE DATABASE. Every layer is still created, still
 * real, and still editable under Structure — a term with several delivery
 * groups works exactly as it did. They simply stop being a prerequisite for
 * the ordinary case.
 * ─────────────────────────────────────────────────────────────────────────────
 */
@Injectable()
export class CourseBuilderService {
  private readonly logger = new Logger(CourseBuilderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * The whole hierarchy for one course, flattened to what the screen shows.
   *
   * ONE QUERY, not one per level. The alternative is a request per course to
   * fetch its terms, another per term for its groups, another per group for
   * its sections — which is what a screen built level by level ends up doing,
   * and it is slow in exactly the case that matters, an institute with a dozen
   * courses.
   */
  async courseTree(programmeId?: string) {
    const programmes = await this.prisma.scoped.programme.findMany({
      where: { deletedAt: null, ...(programmeId ? { id: programmeId } : {}) },
      orderBy: { name: "asc" },
      include: {
        thumbnail: { select: { id: true } },
        feeStructures: { where: { deletedAt: null }, select: { status: true } },
        sessions: {
          where: { deletedAt: null },
          orderBy: { startDate: "desc" },
          include: {
            batches: {
              where: { deletedAt: null },
              include: {
                sections: {
                  where: { deletedAt: null },
                  orderBy: { name: "asc" },
                  include: {
                    sectionSubjects: {
                      where: { deletedAt: null },
                      include: { subject: { select: { id: true, code: true, name: true } } },
                    },
                    _count: { select: { students: true } },
                  },
                },
              },
            },
          },
        },
      },
    });

    return programmes.map((p) => {
      /*
       * THE TWO MIDDLE LAYERS ARE FLATTENED AWAY HERE, not dropped.
       *
       * A section's term is carried on the section itself so the screen can
       * group and label by term without the reader ever meeting a "delivery
       * group". The ids travel too, because Structure still edits them and an
       * "advanced" view has to be able to reach them.
       */
      const batches = p.sessions.flatMap((session) =>
        session.batches.flatMap((group) =>
          group.sections.map((sec) => ({
            id: sec.id,
            code: sec.code,
            name: sec.name,
            status: sec.status,
            capacity: sec.capacity,
            enrolled: sec.enrolledCount,
            students: sec._count.students,
            genderRestriction: sec.genderRestriction,
            shift: sec.shift,
            deliveryMode: sec.deliveryMode,
            subjects: sec.sectionSubjects.map((ss) => ({
              sectionSubjectId: ss.id,
              ...ss.subject,
            })),
            // Where it really sits, for Structure and for the advanced view.
            term: { id: session.id, code: session.code, name: session.name },
            deliveryGroup: { id: group.id, name: group.name },
          })),
        ),
      );

      // Every subject taught anywhere in this course. What an administrator
      // means by "the subjects in this course" — the System only ever attaches
      // a subject to a batch, never to the course itself.
      const subjectMap = new Map<string, { id: string; code: string; name: string; batches: number }>();
      for (const b of batches) {
        for (const s of b.subjects) {
          const held = subjectMap.get(s.id);
          if (held) held.batches += 1;
          else subjectMap.set(s.id, { id: s.id, code: s.code, name: s.name, batches: 1 });
        }
      }

      return {
        id: p.id,
        code: p.code,
        name: p.name,
        description: p.description,
        durationWeeks: p.durationWeeks,
        isActive: p.isActive,
        thumbnailAssetId: p.thumbnailAssetId,
        fee: {
          published: p.feeStructures.some((f) => f.status === "PUBLISHED"),
          drafts: p.feeStructures.filter((f) => f.status === "DRAFT").length,
        },
        terms: p.sessions.map((t) => ({
          id: t.id,
          code: t.code,
          name: t.name,
          status: t.status,
          startDate: t.startDate,
          endDate: t.endDate,
        })),
        subjects: [...subjectMap.values()].sort((a, b) => a.code.localeCompare(b.code)),
        batches,
        // The two numbers a course card leads with.
        totals: {
          batches: batches.length,
          seats: batches.reduce((n, b) => n + b.capacity, 0),
          enrolled: batches.reduce((n, b) => n + b.enrolled, 0),
        },
      };
    });
  }

  /**
   * A batch, and whatever it needs above it — FR-CRS-005, FR-CRS-011.
   *
   * ONE TRANSACTION for all four rows. Creating the term and then failing on
   * the section leaves an empty term nobody asked for, on a screen that does
   * not show terms, waiting to collide with the next attempt at the same code.
   */
  async createBatch(input: QuickBatchCreateInput) {
    const programme = await this.prisma.scoped.programme.findFirst({
      where: { id: input.programmeId, deletedAt: null },
      select: { id: true, code: true, name: true },
    });
    if (!programme) {
      throw new AppError("RESOURCE_NOT_FOUND", {
        message: "That course does not exist, so a batch cannot be added to it.",
      });
    }

    // Subjects are checked BEFORE anything is written. Offering a subject that
    // does not exist would otherwise fail halfway, leaving a batch with some of
    // its subjects and no indication which are missing.
    if (input.subjectIds.length > 0) {
      const found = await this.prisma.scoped.subject.findMany({
        where: { id: { in: input.subjectIds }, deletedAt: null },
        select: { id: true },
      });
      if (found.length !== input.subjectIds.length) {
        throw new AppError("VALIDATION_FAILED", {
          message: "One of the subjects chosen no longer exists. Reload the page and try again.",
          details: [{ field: "subjectIds", code: "NOT_FOUND", message: "Unknown subject." }],
        });
      }
    }

    const created = await this.prisma.asSystem((db) =>
      db.$transaction(async (tx) => {
        // ---- the term ------------------------------------------------------
        let sessionId = input.academicSessionId;
        if (!sessionId) {
          /*
           * THE TERM IT ALREADY RUNS IN, or a new one.
           *
           * An administrator adding "Batch 2" in March is not making a
           * statement about academic terms — they want it in whatever is
           * running. So: the most recent term that has not ended, else the most
           * recent at all, else one is created. Asking would be asking a
           * question whose answer is almost always "the obvious one".
           */
          const existing = await tx.academicSession.findFirst({
            where: { programmeId: programme.id, deletedAt: null },
            orderBy: [{ endDate: "desc" }],
          });

          if (existing) {
            sessionId = existing.id;
          } else {
            const now = new Date();
            const year = now.getUTCFullYear();
            const term = await tx.academicSession.create({
              data: {
                programmeId: programme.id,
                name: `${year} intake`,
                // Unique per programme, and the year is the only thing known.
                code: `Y${String(year).slice(2)}`,
                startDate: now,
                // A year, because a term with no end date is not allowed and
                // an arbitrary short one would close admissions unexpectedly.
                endDate: new Date(Date.UTC(year + 1, now.getUTCMonth(), now.getUTCDate())),
                status: "ACTIVE",
              },
            });
            sessionId = term.id;
          }
        }

        // ---- the delivery group -------------------------------------------
        // Reused rather than multiplied. Every term in this Institute's data
        // has exactly one, and creating a second per batch would fill Structure
        // with rows nobody meant to make.
        let group = await tx.batch.findFirst({
          where: { academicSessionId: sessionId, deletedAt: null },
          orderBy: { createdAt: "asc" },
        });
        if (!group) {
          group = await tx.batch.create({
            data: {
              academicSessionId: sessionId,
              name: `${programme.code} — ${input.shift.toLowerCase()}`,
              deliveryPattern: input.shift,
            },
          });
        }

        // ---- the batch itself ---------------------------------------------
        const code = input.code ?? (await uniqueCode(tx, programme.code, input.name));

        const section = await tx.section.create({
          data: {
            batchId: group.id,
            code,
            name: input.name.trim(),
            capacity: input.capacity,
            genderRestriction: input.genderRestriction,
            shift: input.shift,
            deliveryMode: input.deliveryMode,
            ...(input.whatsappChannelUrl ? { whatsappChannelUrl: input.whatsappChannelUrl } : {}),
            ...(input.whatsappGroupUrl ? { whatsappGroupUrl: input.whatsappGroupUrl } : {}),
          },
        });

        // ---- its subjects --------------------------------------------------
        if (input.subjectIds.length > 0) {
          await tx.sectionSubject.createMany({
            data: input.subjectIds.map((subjectId) => ({
              sectionId: section.id,
              subjectId,
              isCompulsory: true,
            })),
          });
        }

        return { section, sessionId, groupId: group.id, subjectCount: input.subjectIds.length };
      }),
    );

    await this.audit.record({
      action: "course.batch.create",
      entityType: "Section",
      entityId: created.section.id,
      after: {
        programmeId: programme.id,
        code: created.section.code,
        name: created.section.name,
        capacity: created.section.capacity,
        genderRestriction: created.section.genderRestriction,
        subjects: created.subjectCount,
        academicSessionId: created.sessionId,
      },
    });

    this.logger.log(
      `Created batch ${created.section.code} for ${programme.code} with ` +
        `${created.subjectCount} subject(s)`,
    );

    return {
      id: created.section.id,
      code: created.section.code,
      name: created.section.name,
      capacity: created.section.capacity,
      subjects: created.subjectCount,
      message:
        created.subjectCount === 0
          ? `${created.section.name} is ready. Add its subjects so students have a register and a course page.`
          : `${created.section.name} is ready, teaching ${created.subjectCount} subject${
              created.subjectCount === 1 ? "" : "s"
            }.`,
    };
  }

  /**
   * Change which subjects a batch teaches — FR-CRS-016.
   *
   * REPLACED WHOLESALE, and only where nothing depends on the row. A subject
   * offering carries the register, the assignments and the recordings; removing
   * one that a student has attended would orphan all of it. So an offering with
   * anything hanging off it is refused by name rather than silently kept, which
   * would leave the screen disagreeing with the database.
   */
  async setBatchSubjects(sectionId: string, subjectIds: string[]) {
    const section = await this.prisma.scoped.section.findFirst({
      where: { id: sectionId, deletedAt: null },
      select: { id: true, name: true },
    });
    if (!section) throw new AppError("RESOURCE_NOT_FOUND");

    const current = await this.prisma.asSystem((db) =>
      db.sectionSubject.findMany({
        where: { sectionId, deletedAt: null },
        select: {
          id: true,
          subjectId: true,
          subject: { select: { code: true, name: true } },
          /*
           * WHAT WOULD BE ORPHANED. `assignments` here is TEACHER assignments
           * — who teaches the class — and `sessions` is the timetable. Both
           * hang off the offering, so removing one silently unteaches a class
           * and deletes its scheduled sittings.
           */
          _count: { select: { enrolments: true, assignments: true, sessions: true } },
        },
      }),
    );

    const wanted = new Set(subjectIds);
    const removing = current.filter((c) => !wanted.has(c.subjectId));
    const blocked = removing.filter(
      (r) => r._count.enrolments > 0 || r._count.assignments > 0 || r._count.sessions > 0,
    );

    if (blocked.length > 0) {
      throw new AppError("VALIDATION_FAILED", {
        message:
          `${blocked.length === 1 ? "One subject cannot" : "Some subjects cannot"} be removed ` +
          "from this batch: students are enrolled in them, or there is work or a recording " +
          "attached. Archive the batch instead of stripping it.",
        details: blocked.map((b) => ({
          field: "subjectIds",
          code: "IN_USE",
          message:
            `${b.subject.name} (${b.subject.code}) has ${b._count.enrolments} enrolled ` +
            `student(s), ${b._count.assignments} teacher assignment(s) and ` +
            `${b._count.sessions} scheduled class(es).`,
        })),
      });
    }

    const existing = new Set(current.map((c) => c.subjectId));
    const adding = subjectIds.filter((id) => !existing.has(id));

    await this.prisma.asSystem((db) =>
      db.$transaction(async (tx) => {
        if (removing.length > 0) {
          await tx.sectionSubject.updateMany({
            where: { id: { in: removing.map((r) => r.id) } },
            data: { deletedAt: new Date() },
          });
        }
        if (adding.length > 0) {
          await tx.sectionSubject.createMany({
            data: adding.map((subjectId) => ({ sectionId, subjectId, isCompulsory: true })),
          });
        }
      }),
    );

    await this.audit.record({
      action: "course.batch.subjects",
      entityType: "Section",
      entityId: sectionId,
      after: { added: adding.length, removed: removing.length, total: subjectIds.length },
    });

    return { added: adding.length, removed: removing.length, total: subjectIds.length };
  }
}

/**
 * A code nobody had to invent.
 *
 * Derived from the programme and the batch's name — `GD-MORNING-A` — and
 * checked, because `Section.code` is globally unique and a collision on a
 * derived value is a 500 from a constraint the administrator never saw. The
 * suffix is only reached when the obvious name is taken, which is exactly the
 * "Batch 1 / Batch 2" case.
 */
async function uniqueCode(
  tx: { section: { findFirst: (a: { where: { code: string } }) => Promise<unknown> } },
  programmeCode: string,
  name: string,
): Promise<string> {
  const slug =
    name
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 24) || "BATCH";

  const base = `${programmeCode}-${slug}`.slice(0, 36);
  for (let n = 0; n < 50; n++) {
    const candidate = n === 0 ? base : `${base}-${n + 1}`.slice(0, 40);
    if (!(await tx.section.findFirst({ where: { code: candidate } }))) return candidate;
  }
  // Fifty collisions on one name is not a naming problem any more.
  return `${programmeCode}-${Date.now().toString(36).toUpperCase()}`.slice(0, 40);
}
