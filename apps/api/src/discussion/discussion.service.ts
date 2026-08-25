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
        endorser: { select: { fullName: true } },
        resolver: { select: { fullName: true } },
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
      include: {
        author: { select: { id: true, fullName: true } },
        endorser: { select: { fullName: true } },
        resolver: { select: { fullName: true } },
      },
    });
    if (!post) throw new AppError("RESOURCE_NOT_FOUND");

    const replies = await this.prisma.scoped.discussionPost.findMany({
      where: { parentPostId: postId },
      orderBy: { createdAt: "asc" },
      include: {
        author: { select: { id: true, fullName: true } },
        endorser: { select: { fullName: true } },
        resolver: { select: { fullName: true } },
      },
    });

    return {
      ...this.present(post, replies.filter((r: (typeof replies)[number]) => !r.deletedAt).length),
      replies: replies.map((r: (typeof replies)[number]) => this.present(r, 0)),
    };
  }

  /** FR-DSC-004 — ask a question. */
  async create(sectionSubjectId: string, title: string, body: string, isAnonymous = false) {
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
          isAnonymous,
          title: title.trim() || body.trim().slice(0, 80),
          body: body.trim(),
        },
        include: {
        author: { select: { id: true, fullName: true } },
        endorser: { select: { fullName: true } },
        resolver: { select: { fullName: true } },
      },
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
  async reply(parentId: string, body: string, isAnonymous = false) {
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
          isAnonymous,
          parentPostId: parent.row.parentPostId ?? parent.row.id,
          body: body.trim(),
        },
        include: {
        author: { select: { id: true, fullName: true } },
        endorser: { select: { fullName: true } },
        resolver: { select: { fullName: true } },
      },
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
        include: {
        author: { select: { id: true, fullName: true } },
        endorser: { select: { fullName: true } },
        resolver: { select: { fullName: true } },
      },
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
        include: {
        author: { select: { id: true, fullName: true } },
        endorser: { select: { fullName: true } },
        resolver: { select: { fullName: true } },
      },
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
      isAnonymous?: boolean;
      endorsedAt?: Date | null;
      endorser?: { fullName: string } | null;
      resolvedAt?: Date | null;
      resolver?: { fullName: string } | null;
    },
    replyCount: number,
  ) {
    const removed = p.deletedAt != null;

    /*
     * ANONYMITY IS ENFORCED HERE AND NOWHERE ELSE, and that is the whole
     * reason this method exists as the single projection.
     *
     * A student posts anonymously so that their CLASSMATES cannot see who
     * asked. Staff always can: a forum where nobody can be identified at all
     * is one where nobody can be held to anything, and it stops being usable
     * within a term. So the name is withheld from students and shown to a
     * teacher, along with the fact that the student asked for anonymity — a
     * teacher who cannot tell would answer as though the class could see.
     *
     * The AUTHOR still sees their own name, because a post that appears to
     * have been written by nobody is one people repost, thinking it failed.
     */
    const actor = getActor();
    const staff = !!actor && !actor.studentId;
    const isOwn = !!actor && actor.userId === p.authorUserId;
    const hideName = p.isAnonymous === true && !staff && !isOwn;

    return {
      id: p.id,
      title: p.title,
      // A removed post keeps its place in the thread and loses its content.
      // The author's name goes with it: the post is gone, and who wrote it is
      // no longer anybody's business.
      body: removed ? null : p.body,
      removed,
      removedByModerator: removed ? p.removedByModerator : false,
      author: removed || hideName ? null : (p.author?.fullName ?? null),
      // Withheld with the name. An id is an identity as surely as a name is,
      // and handing one to the interface would let a determined student match
      // it against the roster.
      authorUserId: removed || hideName ? null : p.authorUserId,
      isAnonymous: p.isAnonymous === true,
      /*
       * Whether the READER can see who it was. Staff and the author get true,
       * everybody else false — so the interface can say "Anonymous (you)" or
       * "Anonymous — Hina Malik" without deciding the rule itself.
       */
      identityVisible: !removed && !hideName,
      // FR-DSC — the answer worth reading, and who said so.
      endorsedAt: p.endorsedAt ?? null,
      endorsedBy: p.endorser?.fullName ?? null,
      // FR-DSC — whether this question is settled.
      resolvedAt: p.resolvedAt ?? null,
      resolvedBy: p.resolver?.fullName ?? null,
      isPinned: p.isPinned,
      isLocked: p.isLocked,
      // FR-DSC-006 — shown, always. A thread whose answers changed after people
      // read them is unreadable otherwise.
      editedAt: p.editedAt,
      createdAt: p.createdAt,
      replyCount,
    };
  }

  /**
   * FR-DSC — THE ANSWER WORTH READING.
   *
   * The reason a course forum beats a chat log is that somebody arriving with
   * the same question next term reads ONE good answer instead of sifting forty
   * replies for it. Nothing in a thread says which reply that is, and the
   * loudest is not reliably the best — so a teacher says so, and it floats.
   *
   * A TEACHER, NOT A VOTE. A student upvote measures agreement among people
   * who do not yet know the answer, which is exactly the wrong electorate.
   */
  async endorse(replyId: string, endorsed: boolean) {
    const actor = await this.actor();

    const reply = await this.prisma.scoped.discussionPost.findFirst({
      where: { id: replyId, deletedAt: null },
      select: { id: true, parentPostId: true, sectionSubjectId: true },
    });
    if (!reply) throw new AppError("RESOURCE_NOT_FOUND");

    if (!reply.parentPostId) {
      throw new AppError("VALIDATION_FAILED", {
        details: [
          {
            field: "id",
            code: "NOT_A_REPLY",
            // The database refuses this too. Saying it here means the person
            // is told why rather than shown a constraint naming a table.
            message: "A question cannot be endorsed — endorse the reply that answers it.",
          },
        ],
      });
    }

    await this.prisma.asSystem((db) =>
      db.discussionPost.update({
        where: { id: replyId },
        data: endorsed
          ? { endorsedBy: actor.userId, endorsedAt: new Date() }
          : { endorsedBy: null, endorsedAt: null },
      }),
    );

    await this.audit.record({
      action: endorsed ? "discussion.endorse" : "discussion.unendorse",
      entityType: "DiscussionPost",
      entityId: replyId,
      after: { endorsed },
    });

    return { id: replyId, endorsed };
  }

  /**
   * FR-DSC — this question is settled.
   *
   * Without it there is no answer to "which questions has nobody dealt with",
   * which is the one thing a teacher opens a forum to find out. A question with
   * forty replies and no resolution is indistinguishable from one nobody has
   * touched, and the busiest threads are exactly where a teacher stops looking.
   */
  async resolve(questionId: string, resolved: boolean) {
    const actor = await this.actor();

    const question = await this.prisma.scoped.discussionPost.findFirst({
      where: { id: questionId, deletedAt: null },
      select: { id: true, parentPostId: true },
    });
    if (!question) throw new AppError("RESOURCE_NOT_FOUND");

    if (question.parentPostId) {
      throw new AppError("VALIDATION_FAILED", {
        details: [
          {
            field: "id",
            code: "NOT_A_QUESTION",
            message: "A reply cannot be resolved — resolve the question it belongs to.",
          },
        ],
      });
    }

    await this.prisma.asSystem((db) =>
      db.discussionPost.update({
        where: { id: questionId },
        data: resolved
          ? { resolvedBy: actor.userId, resolvedAt: new Date() }
          : { resolvedBy: null, resolvedAt: null },
      }),
    );

    await this.audit.record({
      action: resolved ? "discussion.resolve" : "discussion.reopen",
      entityType: "DiscussionPost",
      entityId: questionId,
      after: { resolved },
    });

    return { id: questionId, resolved };
  }

}
