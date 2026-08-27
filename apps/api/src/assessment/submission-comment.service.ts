import { Injectable, Logger } from "@nestjs/common";
import { AppError } from "@lms/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { NotificationService } from "../notification/notification.service";
import { getActor } from "../prisma/actor-context";

/**
 * TALKING ABOUT A PIECE OF WORK — FR-ASG-027.
 *
 * WHAT WAS MISSING. A teacher opening a submission could do exactly one thing
 * with it: award a mark. `AssignmentGrade.feedback` exists, but a grade row
 * cannot exist without `rawMarks` and `finalMarks`, and BR-ASG-09 keeps the
 * whole thing from the student until the cohort's grades are released. So the
 * most useful sentence a marker ever writes — "this is the wrong export, send
 * me a PDF and I will mark it" — had nowhere to go, and went to WhatsApp.
 *
 * SO A COMMENT IS NOT A GRADE, and this service touches no marks. It cannot
 * change what a student scored, it is not gated on release, and it is visible
 * the moment it is written. Anything a teacher wants kept from the student
 * belongs in `AssignmentGrade.internalNotes`, which §4.7 keeps out of every
 * response, export and report.
 *
 * BOTH SIDES CAN WRITE. A student replying is the difference between feedback
 * and a notice; without it the answer arrives on somebody's personal number
 * and the System stops being the record of what was said.
 *
 * NOTHING IS DELETED. Withdrawing marks `deletedAt` and keeps the row, for the
 * same reason a rejected fee claim is kept: somebody who was told something
 * and later disputes it is entitled to find it.
 */
@Injectable()
export class SubmissionCommentService {
  private readonly logger = new Logger(SubmissionCommentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
  ) {}

  /**
   * The thread on one submission, oldest first.
   *
   * OLDEST FIRST because it is a conversation and it is read as one. The
   * newest-first ordering that suits a queue makes an exchange read backwards.
   *
   * Withdrawn comments are dropped HERE rather than by the scope predicate,
   * which is why the predicate says nothing about `deletedAt`: the author has
   * to be able to see that their own withdrawal took effect, and a row that
   * vanishes from the scope cannot report anything about itself.
   */
  async forSubmission(submissionId: string) {
    const submission = await this.prisma.scoped.assignmentSubmission.findFirst({
      where: { id: submissionId },
      select: { id: true },
    });
    // Not "you may not": a caller who cannot reach the submission is told the
    // same thing as one asking about a submission that does not exist
    // (ARC-051).
    if (!submission) throw new AppError("RESOURCE_NOT_FOUND");

    const rows = await this.prisma.scoped.submissionComment.findMany({
      where: { submissionId, deletedAt: null },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        fileId: true,
        body: true,
        authorUserId: true,
        authorRole: true,
        editedAt: true,
        createdAt: true,
        author: { select: { fullName: true } },
        file: { select: { originalFilename: true } },
      },
    });

    const actor = getActor();

    return rows.map((c) => ({
      id: c.id,
      fileId: c.fileId,
      filename: c.file?.originalFilename ?? null,
      body: c.body,
      authorName: c.author.fullName,
      authorRole: c.authorRole,
      // So the screen can align a person's own words to one side without
      // having to know who the viewer is a second time.
      isMine: actor?.userId === c.authorUserId,
      editedAt: c.editedAt,
      createdAt: c.createdAt,
    }));
  }

  /**
   * Adding one.
   *
   * A FILE ID IS CHECKED AGAINST THIS SUBMISSION, not merely for existing.
   * Without that, a comment could be anchored to a file belonging to another
   * student's submission — and the anchor is what decides whose screen it
   * appears on.
   */
  async create(submissionId: string, input: { body: string; fileId?: string }, ip?: string) {
    const actor = getActor();
    if (!actor) throw new AppError("AUTH_TOKEN_INVALID");

    const submission = await this.prisma.scoped.assignmentSubmission.findFirst({
      where: { id: submissionId },
      select: {
        id: true,
        studentId: true,
        student: { select: { userId: true, user: { select: { fullName: true } } } },
        assignment: {
          select: {
            id: true,
            title: true,
            sectionSubjectId: true,
          },
        },
      },
    });
    if (!submission) throw new AppError("RESOURCE_NOT_FOUND");

    if (input.fileId) {
      const file = await this.prisma.asSystem((db) =>
        db.submissionFile.findFirst({
          where: { id: input.fileId, submissionId: submission.id },
          select: { id: true },
        }),
      );
      if (!file) {
        throw new AppError("VALIDATION_FAILED", {
          message: "That file is not part of this submission.",
          details: [
            {
              field: "fileId",
              code: "NOT_ON_SUBMISSION",
              message: "Reload the page and try again.",
            },
          ],
        });
      }
    }

    const created = await this.prisma.asSystem((db) =>
      db.submissionComment.create({
        data: {
          submissionId: submission.id,
          fileId: input.fileId ?? null,
          authorUserId: actor.userId,
          // The role held AT THE TIME. A teacher later made an administrator
          // must not turn last term's feedback into an administrator's ruling.
          authorRole: actor.roles[0] ?? "unknown",
          body: input.body.trim(),
        },
        select: { id: true, createdAt: true, fileId: true },
      }),
    );

    await this.audit.record({
      action: "submission.comment.create",
      entityType: "SubmissionComment",
      entityId: created.id,
      after: {
        submissionId: submission.id,
        fileId: created.fileId,
        by: actor.userId,
        role: actor.roles[0] ?? "unknown",
      },
      ...(ip ? { ipAddress: ip } : {}),
    });

    /*
     * TELL THE OTHER SIDE — and only the other side.
     *
     * A teacher writing notifies the student whose work it is. A student
     * replying notifies the teachers assigned to that class, because there may
     * be more than one and the one who marked it is not always the one who
     * reads the reply. Nobody is told about their own comment, which is the
     * most common way a notification system trains people to ignore it.
     */
    const isStudentAuthor = actor.userId === submission.student.userId;
    const recipients = isStudentAuthor
      ? await this.teachersOf(submission.assignment.sectionSubjectId, actor.userId)
      : [submission.student.userId].filter((id) => id !== actor.userId);

    if (recipients.length > 0) {
      await this.notify({
        userIds: recipients,
        kind: isStudentAuthor ? "assignment.comment_reply" : "assignment.comment",
        title: isStudentAuthor
          ? `${submission.student.user.fullName} replied on ${submission.assignment.title}`
          : `Feedback on ${submission.assignment.title}`,
        body: preview(input.body),
        // Straight to the work being discussed, not to a list the reader then
        // has to search.
        linkPath: `/subjects/${submission.assignment.sectionSubjectId}`,
      });
    }

    return {
      id: created.id,
      createdAt: created.createdAt,
      message: isStudentAuthor ? "Your reply has been posted." : "Your comment has been posted.",
    };
  }

  /**
   * Editing one — YOUR OWN ONLY, and it says it was edited.
   *
   * A teacher who could rewrite a student's reply, or a student who could
   * rewrite a teacher's feedback, would make the thread worthless as a record
   * of what was actually said. The scope predicate decides what you can SEE;
   * this decides what you can CHANGE, and they are different questions.
   */
  async update(id: string, body: string, ip?: string) {
    const actor = getActor();
    if (!actor) throw new AppError("AUTH_TOKEN_INVALID");

    const row = await this.prisma.scoped.submissionComment.findFirst({
      where: { id },
      select: { id: true, authorUserId: true, deletedAt: true, body: true },
    });
    if (!row) throw new AppError("RESOURCE_NOT_FOUND");
    if (row.authorUserId !== actor.userId) {
      throw new AppError("AUTH_FORBIDDEN", {
        message: "You can only change something you wrote yourself.",
      });
    }
    if (row.deletedAt) {
      throw new AppError("RESOURCE_CONFLICT", {
        message: "That comment has been withdrawn, so it cannot be edited.",
      });
    }

    await this.prisma.asSystem((db) =>
      db.submissionComment.update({
        where: { id },
        data: { body: body.trim(), editedAt: new Date() },
      }),
    );

    await this.audit.record({
      action: "submission.comment.update",
      entityType: "SubmissionComment",
      entityId: id,
      before: { body: row.body },
      after: { body: body.trim() },
      ...(ip ? { ipAddress: ip } : {}),
    });

    return { id, message: "Your comment has been updated." };
  }

  /** Withdrawing one. Marked, never removed — see the note on the class. */
  async remove(id: string, ip?: string) {
    const actor = getActor();
    if (!actor) throw new AppError("AUTH_TOKEN_INVALID");

    const row = await this.prisma.scoped.submissionComment.findFirst({
      where: { id },
      select: { id: true, authorUserId: true, deletedAt: true },
    });
    if (!row) throw new AppError("RESOURCE_NOT_FOUND");
    if (row.authorUserId !== actor.userId) {
      throw new AppError("AUTH_FORBIDDEN", {
        message: "You can only withdraw something you wrote yourself.",
      });
    }
    if (row.deletedAt) return { id, message: "That comment was already withdrawn." };

    await this.prisma.asSystem((db) =>
      db.submissionComment.update({ where: { id }, data: { deletedAt: new Date() } }),
    );

    await this.audit.record({
      action: "submission.comment.delete",
      entityType: "SubmissionComment",
      entityId: id,
      after: { by: actor.userId },
      ...(ip ? { ipAddress: ip } : {}),
    });

    return { id, message: "That comment has been withdrawn." };
  }

  /**
   * How many comments each of these submissions has.
   *
   * ONE QUERY FOR THE WHOLE ROSTER. The grading screen lists thirty students
   * and wants a count beside each; asking per row is thirty round trips to
   * draw one column.
   */
  async countsFor(submissionIds: string[]): Promise<Record<string, number>> {
    if (submissionIds.length === 0) return {};

    const rows = await this.prisma.asSystem((db) =>
      db.submissionComment.groupBy({
        by: ["submissionId"],
        where: { submissionId: { in: submissionIds }, deletedAt: null },
        _count: { _all: true },
      }),
    );

    const counts: Record<string, number> = {};
    for (const r of rows) counts[r.submissionId] = r._count._all;
    return counts;
  }

  /**
   * Who currently teaches this class.
   *
   * A SEPARATE QUERY, because `Assignment` holds `sectionSubjectId` as a plain
   * column with no relation object to traverse — so there is nothing to
   * include, and pretending otherwise does not compile.
   *
   * CURRENTLY is the load-bearing word. An assignment lapses by its end date
   * as well as by being withdrawn (FR-CRS-025), and a student's reply routed to
   * last term's teacher is a reply nobody reads.
   */
  private async teachersOf(sectionSubjectId: string, exceptUserId: string): Promise<string[]> {
    const rows = await this.prisma.asSystem((db) =>
      db.teacherAssignment.findMany({
        where: {
          sectionSubjectId,
          deletedAt: null,
          OR: [{ endDate: null }, { endDate: { gte: new Date() } }],
        },
        select: { teacher: { select: { userId: true } } },
      }),
    );
    // Deduplicated: a teacher can hold both a PRIMARY and an ASSISTANT
    // assignment on one class, and would otherwise be told twice.
    return [...new Set(rows.map((r) => r.teacher.userId))].filter((id) => id !== exceptUserId);
  }

  /**
   * The inbox copy, which must never fail the thing it describes.
   *
   * The comment is written before this is called. A database hiccup writing a
   * notification row must not turn a saved comment into an error the teacher
   * sees, because there is nothing they could do about it and the words are
   * already on the record.
   */
  private async notify(input: {
    userIds: string[];
    kind: string;
    title: string;
    body: string;
    linkPath: string;
  }): Promise<void> {
    try {
      await this.notifications.notify({
        recipientUserIds: input.userIds,
        kind: input.kind,
        title: input.title,
        body: input.body,
        linkPath: input.linkPath,
      });
    } catch (err) {
      this.logger.warn(
        `Comment notification (${input.kind}) failed: ${err instanceof Error ? err.message : "unknown"}`,
      );
    }
  }
}

/**
 * The first line or so, for a notification.
 *
 * The whole comment in a push message is how somebody reads the feedback on a
 * lock screen and never opens the work it is about.
 */
function preview(body: string): string {
  const flat = body.trim().replace(/\s+/g, " ");
  return flat.length <= 140 ? flat : `${flat.slice(0, 137)}...`;
}
