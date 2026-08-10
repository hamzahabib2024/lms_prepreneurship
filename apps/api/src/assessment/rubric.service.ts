import { Injectable } from "@nestjs/common";
import { AppError } from "@lms/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { getActor } from "../prisma/actor-context";
import { rubricTotal, validateRubric, type Criterion } from "./rubric-scoring";

export interface CriterionInput {
  name: string;
  description?: string | null;
  maxMarks: number;
  isInternal?: boolean;
  levels?: Array<{ label: string; marks: number; text?: string }> | null;
}

export interface RubricInput {
  name: string;
  description?: string | null;
  /** Admin only. A rubric with no owner is offered to every teacher. */
  shareInstituteWide?: boolean;
  criteria: CriterionInput[];
}

/**
 * Rubrics — SRS §8.3.5, FR-ASG-012..018.
 *
 * The models existed from the first migration and nothing had ever written to
 * them, so every assignment in the System was marked as a single number. A
 * rubric is what turns "17 out of 25" into an account a student can act on, and
 * what lets two markers reach the same figure.
 *
 * OWNERSHIP IS THE INTERESTING PART. A rubric belongs to the teacher who wrote
 * it, or to the Institute when `ownerTeacherId` is null. Both are visible to
 * every teacher, because reuse is the point (FR-ASG-012) and a marking scheme
 * is not confidential — but only the owner may EDIT one, and an institute-wide
 * rubric is editable by administrators alone. A teacher silently changing a
 * scheme their colleagues are marking against is how two sections end up graded
 * differently by the same rubric on the same day.
 */
@Injectable()
export class RubricService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** FR-ASG-012 — what this teacher can mark against: their own, and shared. */
  async list() {
    const actor = getActor();
    if (!actor) throw new AppError("AUTH_TOKEN_INVALID");

    const rubrics = await this.prisma.scoped.rubric.findMany({
      where: {
        deletedAt: null,
        // An administrator sees every rubric; a teacher sees their own and the
        // institute-wide ones. Written here rather than as a scope policy
        // because it is not a confidentiality rule — a teacher denied sight of
        // a colleague's rubric loses nothing but the ability to reuse it.
        ...(actor.teacherId && !actor.roles.some((r) => r === "admin" || r === "super_admin")
          ? { OR: [{ ownerTeacherId: actor.teacherId }, { ownerTeacherId: null }] }
          : {}),
      },
      orderBy: [{ ownerTeacherId: "asc" }, { name: "asc" }],
      include: { _count: { select: { assignments: true } } },
    });

    // Criteria are counted, not returned. A list of rubrics is for choosing
    // one, and the criteria are what you read once you have.
    const counts = await this.prisma.asSystem((db) =>
      db.rubricCriterion.groupBy({
        by: ["rubricId"],
        _count: { _all: true },
        _sum: { maxMarks: true },
        where: { rubricId: { in: rubrics.map((r: (typeof rubrics)[number]) => r.id) } },
      }),
    );
    const byRubric = new Map(
      counts.map((c: (typeof counts)[number]) => [
        c.rubricId,
        { criteria: c._count._all, total: Number(c._sum.maxMarks ?? 0) },
      ]),
    );

    return rubrics.map((r: (typeof rubrics)[number]) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      isShared: r.ownerTeacherId === null,
      isMine: r.ownerTeacherId != null && r.ownerTeacherId === actor.teacherId,
      criteriaCount: byRubric.get(r.id)?.criteria ?? 0,
      totalMarks: byRubric.get(r.id)?.total ?? 0,
      usedByAssignments: r._count.assignments,
    }));
  }

  /**
   * FR-ASG-013 — one rubric with its criteria.
   *
   * The criteria are fetched through the scoped client as a SEPARATE query
   * rather than as a nested include, so the RubricCriterion policy applies to
   * them: a student reading the rubric they are marked against gets the visible
   * criteria and never learns an internal one exists. A nested include would
   * have bypassed the policy entirely.
   */
  async get(id: string) {
    const actor = getActor();
    if (!actor) throw new AppError("AUTH_TOKEN_INVALID");

    const rubric = await this.prisma.scoped.rubric.findFirst({
      where: { id, deletedAt: null },
    });
    if (!rubric) throw new AppError("RESOURCE_NOT_FOUND");

    const criteria = await this.prisma.scoped.rubricCriterion.findMany({
      where: { rubricId: id },
      orderBy: { displayOrder: "asc" },
    });

    // The scope policy has already removed the internal criteria for a student.
    // The FLAG goes too: it is `false` on every row they can see, so it carries
    // no information except that the concept exists — and a student who learns
    // rubrics can have hidden criteria has learnt the one thing FR-ASG-014 is
    // there to keep quiet. Staff need it, because it is what they are marking.
    const isStudent = actor.roles.includes("student") && !actor.teacherId;

    return {
      id: rubric.id,
      name: rubric.name,
      description: rubric.description,
      isShared: rubric.ownerTeacherId === null,
      canEdit: this.mayEdit(rubric.ownerTeacherId),
      criteria: criteria.map((c: (typeof criteria)[number]) => ({
        id: c.id,
        name: c.name,
        description: c.description,
        maxMarks: Number(c.maxMarks),
        displayOrder: c.displayOrder,
        ...(isStudent ? {} : { isInternal: c.isInternal }),
        levels: c.levels,
      })),
      totalMarks: criteria.reduce(
        (sum: number, c: (typeof criteria)[number]) => sum + Number(c.maxMarks),
        0,
      ),
    };
  }

  /** FR-ASG-012 — create a rubric and its criteria in one act. */
  async create(input: RubricInput) {
    const actor = getActor();
    if (!actor) throw new AppError("AUTH_TOKEN_INVALID");

    const isAdmin = actor.roles.some((r) => r === "admin" || r === "super_admin");
    if (input.shareInstituteWide && !isAdmin) {
      throw new AppError("AUTH_FORBIDDEN", {
        message: "Only an administrator can share a rubric with the whole Institute.",
      });
    }

    this.refuseInvalid(input.criteria);

    // A teacher's rubric is owned by them; an administrator's is either shared
    // or, if they are not a teacher, shared by necessity — an administrator has
    // no sections to own a private marking scheme for.
    const ownerTeacherId = input.shareInstituteWide ? null : (actor.teacherId ?? null);

    const created = await this.prisma.asSystem((db) =>
      db.rubric.create({
        data: {
          name: input.name,
          description: input.description ?? null,
          ownerTeacherId,
          criteria: {
            create: input.criteria.map((c, index) => ({
              name: c.name,
              description: c.description ?? null,
              maxMarks: c.maxMarks,
              isInternal: c.isInternal ?? false,
              displayOrder: index,
              levels: (c.levels ?? undefined) as object | undefined,
            })),
          },
        },
      }),
    );

    await this.audit.record({
      action: "rubric.create",
      entityType: "Rubric",
      entityId: created.id,
      after: { name: created.name, criteria: input.criteria.length, shared: ownerTeacherId === null },
    });

    return this.get(created.id);
  }

  /**
   * FR-ASG-017 — replace a rubric's criteria.
   *
   * The criteria are replaced wholesale rather than patched, because a rubric
   * is edited as a document. That means the criterion IDS CHANGE, and grades
   * already awarded store those ids in their JSON — so this refuses once any
   * assignment using the rubric has been marked. Editing then would leave every
   * historic breakdown pointing at criteria that no longer exist, and
   * `totalAwarded` would quietly start returning a smaller number for marks
   * that were correctly awarded (BR-DAT-02: a record of what happened does not
   * change because somebody edited a form afterwards).
   */
  async update(id: string, input: RubricInput) {
    const rubric = await this.prisma.asSystem((db) =>
      db.rubric.findFirst({ where: { id, deletedAt: null } }),
    );
    if (!rubric) throw new AppError("RESOURCE_NOT_FOUND");
    this.refuseUnlessOwner(rubric.ownerTeacherId);
    this.refuseInvalid(input.criteria);

    const graded = await this.prisma.asSystem((db) =>
      db.assignmentGrade.count({
        where: { submission: { assignment: { rubricId: id } } },
      }),
    );
    if (graded > 0) {
      throw new AppError("RESOURCE_CONFLICT", {
        message:
          `This rubric has already been used to mark ${graded} ` +
          `${graded === 1 ? "submission" : "submissions"}. Copy it and edit the copy, ` +
          `so the marks already awarded still explain themselves.`,
      });
    }

    const before = { name: rubric.name, description: rubric.description };

    await this.prisma.asSystem((db) =>
      db.$transaction(async (tx) => {
        await tx.rubricCriterion.deleteMany({ where: { rubricId: id } });
        await tx.rubric.update({
          where: { id },
          data: {
            name: input.name,
            description: input.description ?? null,
            criteria: {
              create: input.criteria.map((c, index) => ({
                name: c.name,
                description: c.description ?? null,
                maxMarks: c.maxMarks,
                isInternal: c.isInternal ?? false,
                displayOrder: index,
                levels: (c.levels ?? undefined) as object | undefined,
              })),
            },
          },
        });
      }),
    );

    await this.audit.record({
      action: "rubric.update",
      entityType: "Rubric",
      entityId: id,
      before,
      after: { name: input.name, description: input.description ?? null },
    });

    return this.get(id);
  }

  /**
   * FR-ASG-018 — withdraw a rubric from use.
   *
   * Soft delete (BR-DAT-02). Assignments keep pointing at it and grades already
   * awarded still explain themselves; it simply stops being offered.
   */
  async remove(id: string) {
    const rubric = await this.prisma.asSystem((db) =>
      db.rubric.findFirst({
        where: { id, deletedAt: null },
        include: { _count: { select: { assignments: true } } },
      }),
    );
    if (!rubric) throw new AppError("RESOURCE_NOT_FOUND");
    this.refuseUnlessOwner(rubric.ownerTeacherId);

    await this.prisma.asSystem((db) =>
      db.rubric.update({ where: { id }, data: { deletedAt: new Date() } }),
    );

    await this.audit.record({
      action: "rubric.delete",
      entityType: "Rubric",
      entityId: id,
      before: { name: rubric.name, deletedAt: null },
      after: { deletedAt: new Date().toISOString(), stillUsedBy: rubric._count.assignments },
    });

    return {
      id,
      withdrawn: true,
      // Said plainly, because "deleted" that leaves marking intact is otherwise
      // alarming to whoever pressed it.
      stillAttachedTo: rubric._count.assignments,
      message:
        rubric._count.assignments > 0
          ? `Withdrawn. ${rubric._count.assignments} existing ${rubric._count.assignments === 1 ? "assignment keeps" : "assignments keep"} it, and marks already awarded are unchanged.`
          : "Withdrawn.",
    };
  }

  /** FR-ASG-015 — does this rubric fit that assignment? A question, not a rule. */
  async checkFit(rubricId: string, assignmentId: string) {
    const [criteria, assignment] = await Promise.all([
      this.prisma.asSystem((db) => db.rubricCriterion.findMany({ where: { rubricId } })),
      this.prisma.scoped.assignment.findFirst({
        where: { id: assignmentId },
        select: { id: true, title: true, marksAvailable: true },
      }),
    ]);
    if (!assignment) throw new AppError("RESOURCE_NOT_FOUND");

    const total = rubricTotal(
      criteria.map((c: (typeof criteria)[number]) => ({
        id: c.id,
        name: c.name,
        maxMarks: Number(c.maxMarks),
        displayOrder: c.displayOrder,
        isInternal: c.isInternal,
      })),
    );
    const assignmentTotal = Number(assignment.marksAvailable);

    return {
      rubricTotal: total,
      assignmentTotal,
      matches: Math.abs(total - assignmentTotal) < 0.005,
      // A warning, never a refusal: the same rubric legitimately serves a
      // 25-mark and a 50-mark assignment, and refusing would defeat reuse.
      message:
        Math.abs(total - assignmentTotal) < 0.005
          ? null
          : `The rubric awards ${total} marks and the assignment is out of ${assignmentTotal}.`,
    };
  }

  private mayEdit(ownerTeacherId: string | null): boolean {
    const actor = getActor();
    if (!actor) return false;
    if (actor.roles.some((r) => r === "admin" || r === "super_admin")) return true;
    return ownerTeacherId != null && ownerTeacherId === actor.teacherId;
  }

  private refuseUnlessOwner(ownerTeacherId: string | null): void {
    if (this.mayEdit(ownerTeacherId)) return;
    throw new AppError("AUTH_FORBIDDEN", {
      message:
        ownerTeacherId === null
          ? "This rubric is shared with the whole Institute. Only an administrator can change it."
          : "This rubric belongs to another teacher. Copy it and edit the copy.",
    });
  }

  private refuseInvalid(criteria: CriterionInput[]): void {
    // Ids are needed for the shared validator; the inputs have none yet, so
    // their position stands in. Every message names the criterion, so the
    // screen can put each problem beside the row it belongs to.
    const asCriteria: Criterion[] = criteria.map((c, index) => ({
      id: String(index),
      name: c.name,
      maxMarks: c.maxMarks,
      displayOrder: index,
      isInternal: c.isInternal ?? false,
      description: c.description ?? null,
      levels: c.levels ?? null,
    }));

    const problems = validateRubric(asCriteria);
    if (problems.length > 0) {
      throw new AppError("VALIDATION_FAILED", {
        details: problems.map((p) => ({
          field: p.criterionId === null ? "criteria" : `criteria.${p.criterionId}`,
          code: "INVALID",
          message: p.message,
        })),
      });
    }
  }
}
