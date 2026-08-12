import { Injectable } from "@nestjs/common";
import { AppError } from "@lms/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { getActor } from "../prisma/actor-context";

/**
 * Staff notes about a student — FR-REG-046, §4.5 `internal_note`.
 *
 * THE STUDENT NEVER SEES THESE. §4.5 grants them no action on the resource and
 * the scope policy denies them outright; both are deliberate, because the note
 * is written so staff can help someone and is exactly the text that causes harm
 * if its subject reads it.
 *
 * A NOTE IS EDITED AND DELETED ONLY BY WHOEVER WROTE IT. The matrix grants a
 * teacher FULL over their assigned scope, which would otherwise let one teacher
 * rewrite another's pastoral observation about the same student. An Admin holds
 * `read` and nothing else — deliberately, so a note cannot be quietly amended
 * by somebody who was not there.
 */
@Injectable()
export class StudentNoteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Newest first, with who wrote it and which class it came from. */
  list(studentId: string) {
    return this.prisma.scoped.studentNote.findMany({
      where: { studentId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      include: {
        author: { select: { id: true, fullName: true } },
        sectionSubject: {
          select: {
            id: true,
            subject: { select: { code: true, name: true } },
            section: { select: { code: true } },
          },
        },
      },
    });
  }

  async create(studentId: string, input: { sectionSubjectId: string; body: string }) {
    const actor = getActor();
    if (!actor) throw new AppError("AUTH_TOKEN_INVALID");

    // findFirst on the scoped client: a teacher naming a section-subject they
    // do not teach gets nothing back, so the check and the authorisation are
    // the same query rather than two that can disagree.
    const offering = await this.prisma.scoped.sectionSubject.findFirst({
      where: { id: input.sectionSubjectId, deletedAt: null },
      select: { id: true },
    });
    if (!offering) {
      throw new AppError("VALIDATION_FAILED", {
        details: [
          {
            field: "sectionSubjectId",
            code: "NOT_FOUND",
            message: "That class is not one you teach.",
          },
        ],
      });
    }

    // Likewise for the student: scoped, so a teacher cannot write a note about
    // somebody who is not in the class they named.
    const student = await this.prisma.scoped.student.findFirst({
      where: { id: studentId },
      select: { id: true },
    });
    if (!student) throw new AppError("RESOURCE_NOT_FOUND");

    const created = await this.prisma.scoped.studentNote.create({
      data: {
        studentId,
        sectionSubjectId: input.sectionSubjectId,
        authorUserId: actor.userId,
        body: input.body,
      },
    });

    // SEC-PRV-003 — the audit records THAT a note was written and about whom,
    // never its text. An append-only log nobody can redact is the wrong home
    // for a sentence about a student's family circumstances.
    await this.audit.record({
      action: "student_note.create",
      entityType: "StudentNote",
      entityId: created.id,
      after: { studentId, sectionSubjectId: input.sectionSubjectId, length: input.body.length },
    });
    return this.one(created.id);
  }

  async update(id: string, body: string) {
    const actor = getActor();
    if (!actor) throw new AppError("AUTH_TOKEN_INVALID");

    const existing = await this.prisma.scoped.studentNote.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, authorUserId: true },
    });
    if (!existing) throw new AppError("RESOURCE_NOT_FOUND");
    this.refuseUnlessAuthor(existing.authorUserId, actor.userId, "edit");

    await this.prisma.scoped.studentNote.update({ where: { id }, data: { body } });
    await this.audit.record({
      action: "student_note.update",
      entityType: "StudentNote",
      entityId: id,
      after: { length: body.length },
    });
    return this.one(id);
  }

  async remove(id: string) {
    const actor = getActor();
    if (!actor) throw new AppError("AUTH_TOKEN_INVALID");

    const existing = await this.prisma.scoped.studentNote.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, authorUserId: true },
    });
    if (!existing) throw new AppError("RESOURCE_NOT_FOUND");
    this.refuseUnlessAuthor(existing.authorUserId, actor.userId, "delete");

    await this.prisma.scoped.studentNote.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    await this.audit.record({
      action: "student_note.delete",
      entityType: "StudentNote",
      entityId: id,
    });
    return { deleted: true };
  }

  /**
   * Authorship, checked separately from scope.
   *
   * Two teachers of the same class both hold ASSIGNED scope over it, so the
   * scope predicate lets each SEE the other's note — which is the point, they
   * are colleagues discussing a shared student. It must not let either rewrite
   * the other's words.
   */
  private refuseUnlessAuthor(authorUserId: string, actorUserId: string, verb: string): void {
    if (authorUserId !== actorUserId) {
      throw new AppError("AUTH_FORBIDDEN", {
        message: `Only whoever wrote a note can ${verb} it.`,
      });
    }
  }

  private async one(id: string) {
    const found = await this.prisma.scoped.studentNote.findFirst({
      where: { id },
      include: {
        author: { select: { id: true, fullName: true } },
        sectionSubject: {
          select: {
            id: true,
            subject: { select: { code: true, name: true } },
            section: { select: { code: true } },
          },
        },
      },
    });
    if (!found) throw new AppError("RESOURCE_NOT_FOUND");
    return found;
  }
}
