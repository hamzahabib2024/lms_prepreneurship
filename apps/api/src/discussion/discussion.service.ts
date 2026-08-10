import { Injectable, Logger } from "@nestjs/common";
import { AppError } from "@lms/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { getActor } from "../prisma/actor-context";
import { NotificationService } from "../notification/notification.service";
import {
  mayEdit,
  mayRemove,
  mayReply,
  refuseEmpty,
  tombstoneNeeded,
  type PostActor,
  type Verdict,
} from "./discussion-rules";

/**
 * Discussion — SRS §5.15, FR-DSC-001..012.
 *
 * A question thread per offering. `discussion_post` has been in the §4.5 matrix
 * since the first commit with no endpoint and no table.
 *
 * WHAT YOU MAY SEE is the scope policy's business: a student and a teacher both
 * see the threads of the offerings they are in. WHAT YOU MAY CHANGE is
 * discussion-rules.ts, because it depends on authorship and on the clock, and
 * neither is a `where` clause.
 */
@Injectable()
export class DiscussionService {
  private readonly logger = new Logger(DiscussionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
  ) {}

  /** FR-DSC-002 — the threads on an offering, pinned first, newest next. */
  async list(sectionSubjectId: string) {
    // Scoped: a student asking about an offering they are not enrolled in gets
    // nothing, and the offering read below refuses them outright.
    const offering = await this.prisma.scoped.sectionSubject.findFirst({
      where: { id: sectionSubjectId, deletedAt: null },
      select: { id: true },
    });
    if (!offering) throw new AppError("RESOURCE_NOT_FOUND");

    const threads = await this.prisma.scoped.discussionPost.findMany({
      where: { sectionSubjectId, parentPostId: null },
      orderBy: [{ isPinned: "desc" }, { createdAt: "desc" }],
      include: {
        author: { select: { id: true, fullName: true } },
        _count: { select: { replies: { where: { deletedAt: null } } } },
      },
      take: 100,
    });

    return threads.map((t: (typeof threads)[number]) => this.present(t, t._count.replies));
  }

  /** FR-DSC-003 — one thread and its answers. */
  async thread(postId: string) {
    const post = await this.prisma.scoped.discussionPost.findFirst({
      where: { id: postId, parentPostId: null },
      include: { author: { select: { id: true, fullName: true } } },
    });
    if (!post) throw new AppError("RESOURCE_NOT_FOUND");

    const replies = await this.prisma.scoped.discussionPost.findMany({
      where: { parentPostId: postId },
      orderBy: { createdAt: "asc" },
      include: { author: { select: { id: true, fullName: true } } },
    });

    return {
      ...this.present(post, replies.filter((r: (typeof replies)[number]) => !r.deletedAt).length),
      replies: replies.map((r: (typeof replies)[number]) => this.present(r, 0)),
    };
  }

  /** FR-DSC-004 — ask a question. */
  async create(sectionSubjectId: string, title: string, body: string) {
    const actor = await this.actor();

    const empty = refuseEmpty(body);
    if (empty) this.refuse(empty);

    const offering = await this.prisma.scoped.sectionSubject.findFirst({
      where: { id: sectionSubjectId, deletedAt: null },
      select: { id: true },
    });
    // The create-scope guard's rule: a create naming an offering id from the
    // caller must prove the caller may write there. The scoped read is that
    // proof — a student not enrolled gets nothing back.
    if (!offering) throw new AppError("RESOURCE_NOT_FOUND");

    const created = await this.prisma.asSystem((db) =>
      db.discussionPost.create({
        data: {
          sectionSubjectId,
          authorUserId: actor.userId,
          title: title.trim() || body.trim().slice(0, 80),
          body: body.trim(),
        },
        include: { author: { select: { id: true, fullName: true } } },
      }),
    );

    await this.audit.record({
      action: "discussion.post",
      entityType: "DiscussionPost",
      entityId: created.id,
      after: { sectionSubjectId, title: created.title },
    });

    return this.present(created, 0);
  }

  /** FR-DSC-005 — answer one. */
  async reply(parentId: string, body: string) {
    const actor = await this.actor();

    const empty = refuseEmpty(body);
    if (empty) this.refuse(empty);

    const parent = await this.loadFor(parentId);
    this.check(mayReply(actor, parent.rules));

    const created = await this.prisma.asSystem((db) =>
      db.discussionPost.create({
        data: {
          sectionSubjectId: parent.row.sectionSubjectId,
          authorUserId: actor.userId,
          parentPostId: parent.row.parentPostId ?? parent.row.id,
          body: body.trim(),
        },
        include: { author: { select: { id: true, fullName: true } } },
      }),
    );

    // FR-DSC-010 — the person who asked is told somebody answered. Not the
    // whole class: a thread with forty replies would send forty notifications
    // to everybody who ever posted in it.
    if (parent.row.authorUserId !== actor.userId) {
      await this.notifications
        .notify({
          recipientUserIds: [parent.row.authorUserId],
          kind: "DISCUSSION_REPLY",
          title: "Somebody answered your question",
          body: `${actor.fullName} replied to "${parent.row.title ?? "your post"}".`,
          linkPath: `/discussions/${parent.row.id}`,
        })
        .catch(() => undefined);
    }

    await this.audit.record({
      action: "discussion.reply",
      entityType: "DiscussionPost",
      entityId: created.id,
      after: { parentPostId: parent.row.id },
    });

    return this.present(created, 0);
  }

  /** FR-DSC-006 — change what you wrote, within the window. */
  async edit(postId: string, body: string) {
    const actor = await this.actor();
    const empty = refuseEmpty(body);
    if (empty) this.refuse(empty);

    const post = await this.loadFor(postId);
    const verdict = mayEdit(actor, post.rules, new Date());
    this.check(verdict);

    const updated = await this.prisma.asSystem((db) =>
      db.discussionPost.update({
        where: { id: postId },
        data: {
          body: body.trim(),
          // AN EDITED POST SAYS SO. Somebody who answers "yes, use method B"
          // and later changes it to "no, never" has altered what the thread
          // means for everyone who already read it.
          editedAt: new Date(),
        },
        include: { author: { select: { id: true, fullName: true } } },
      }),
    );

    await this.audit.record({
      action: "discussion.edit",
      entityType: "DiscussionPost",
      entityId: postId,
      before: { body: post.row.body },
      after: { body: body.trim(), by: verdict.allowed ? verdict.as : "unknown" },
    });

    return this.present(updated, 0);
  }

  /** FR-DSC-007 — take it down. */
  async remove(postId: string, reason?: string) {
    const actor = await this.actor();
    const post = await this.loadFor(postId);
    const verdict = mayRemove(actor, post.rules);
    this.check(verdict);

    const byModerator = verdict.allowed && verdict.as === "moderator";

    await this.prisma.asSystem((db) =>
      db.discussionPost.update({
        where: { id: postId },
        data: {
          deletedAt: new Date(),
          removedByModerator: byModerator,
          removalReason: byModerator ? (reason?.trim() ?? null) : null,
          // A post with answers keeps its place and loses its content;
          // deleting the question and keeping the replies produces answers to
          // nothing.
          body: tombstoneNeeded(post.rules) ? "" : post.row.body,
        },
      }),
    );

    await this.audit.record({
      action: byModerator ? "discussion.moderate" : "discussion.remove",
      entityType: "DiscussionPost",
      entityId: postId,
      before: { body: post.row.body, authorUserId: post.row.authorUserId },
      after: { removedByModerator: byModerator, reason: reason?.trim() ?? null },
    });

    if (byModerator && post.row.authorUserId !== actor.userId) {
      // The author is told. A post that vanishes without explanation is worse
      // than one removed with a reason.
      await this.notifications
        .notify({
          recipientUserIds: [post.row.authorUserId],
          kind: "DISCUSSION_MODERATED",
          title: "A post of yours was removed",
          body: reason?.trim()
            ? `Your post was removed by a teacher: ${reason.trim()}`
            : "Your post was removed by a teacher.",
        })
        .catch(() => undefined);
    }

    return { id: postId, removed: true, keptAsTombstone: tombstoneNeeded(post.rules) };
  }

  /** FR-DSC-008/009 — pin a thread, or close it. Moderators only. */
  async moderate(postId: string, change: { isPinned?: boolean; isLocked?: boolean }) {
    const actor = await this.actor();
    const post = await this.loadFor(postId);

    // Reuses mayEdit's moderator test rather than a second one: the question
    // "are you this offering's teacher" must have one answer.
    const verdict = mayEdit(actor, post.rules, new Date());
    if (!verdict.allowed || verdict.as !== "moderator") {
      throw new AppError("AUTH_FORBIDDEN", {
        message: "Only the teacher of this class can pin or close a thread.",
      });
    }
    if (post.row.parentPostId) {
      throw new AppError("VALIDATION_FAILED", {
        details: [
          {
            field: "postId",
            code: "NOT_A_THREAD",
            message: "Pin or close the question, not an answer to it.",
          },
        ],
      });
    }

    const updated = await this.prisma.asSystem((db) =>
      db.discussionPost.update({
        where: { id: postId },
        data: {
          ...(change.isPinned !== undefined ? { isPinned: change.isPinned } : {}),
          ...(change.isLocked !== undefined ? { isLocked: change.isLocked } : {}),
        },
        include: { author: { select: { id: true, fullName: true } } },
      }),
    );

    await this.audit.record({
      action: "discussion.moderate",
      entityType: "DiscussionPost",
      entityId: postId,
      before: { isPinned: post.row.isPinned, isLocked: post.row.isLocked },
      after: { isPinned: updated.isPinned, isLocked: updated.isLocked },
    });

    return this.present(updated, 0);
  }

  // ------------------------------------------------------------- helpers --

  private async actor(): Promise<PostActor & { fullName: string }> {
    const a = getActor();
    if (!a) throw new AppError("AUTH_TOKEN_INVALID");
    const user = await this.prisma.asSystem((db) =>
      db.user.findUnique({ where: { id: a.userId }, select: { fullName: true } }),
    );
    return {
      userId: a.userId,
      roles: [...a.roles],
      // The offerings this actor TEACHES, which is what moderation turns on —
      // not the ones they can see. A student's list is empty by construction.
      teachesOfferings: a.roles.includes("teacher") ? [...a.sectionSubjectIds] : [],
      fullName: user?.fullName ?? "Somebody",
    };
  }

  /** The post, read through the scope policy, in both shapes the rules need. */
  private async loadFor(postId: string) {
    const row = await this.prisma.scoped.discussionPost.findFirst({
      where: { id: postId },
      include: { _count: { select: { replies: { where: { deletedAt: null } } } } },
    });
    if (!row) throw new AppError("RESOURCE_NOT_FOUND");

    return {
      row,
      rules: {
        id: row.id,
        authorUserId: row.authorUserId,
        sectionSubjectId: row.sectionSubjectId,
        createdAt: row.createdAt,
        deletedAt: row.deletedAt,
        isLocked: row.isLocked,
        replyCount: row._count.replies,
      },
    };
  }

  private check(verdict: Verdict): void {
    if (!verdict.allowed) this.refuse(verdict);
  }

  private refuse(verdict: Verdict): never {
    if (verdict.allowed) throw new AppError("INTERNAL_ERROR");
    const status = verdict.code === "NOT_YOURS" ? "AUTH_FORBIDDEN" : "VALIDATION_FAILED";
    throw new AppError(status, {
      message: verdict.message,
      details: [{ field: "post", code: verdict.code, message: verdict.message }],
    });
  }

  private present(
    p: {
      id: string;
      title: string | null;
      body: string;
      isPinned: boolean;
      isLocked: boolean;
      editedAt: Date | null;
      deletedAt: Date | null;
      removedByModerator: boolean;
      createdAt: Date;
      authorUserId: string;
      author?: { id: string; fullName: string };
    },
    replyCount: number,
  ) {
    const removed = p.deletedAt != null;
    return {
      id: p.id,
      title: p.title,
      // A removed post keeps its place in the thread and loses its content.
      // The author's name goes with it: the post is gone, and who wrote it is
      // no longer anybody's business.
      body: removed ? null : p.body,
      removed,
      removedByModerator: removed ? p.removedByModerator : false,
      author: removed ? null : (p.author?.fullName ?? null),
      authorUserId: removed ? null : p.authorUserId,
      isPinned: p.isPinned,
      isLocked: p.isLocked,
      // FR-DSC-006 — shown, always. A thread whose answers changed after people
      // read them is unreadable otherwise.
      editedAt: p.editedAt,
      createdAt: p.createdAt,
      replyCount,
    };
  }
}
