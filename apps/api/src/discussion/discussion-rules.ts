/**
 * Discussion posts — SRS §5.15, FR-DSC-001..012.
 *
 * A question thread per subject: a student asks, classmates and the teacher
 * answer.
 *
 * ---------------------------------------------------------------------------
 * A NOTE ON THE §4.5 MATRIX, because this code deliberately reads it in a
 * particular way and somebody should know.
 * ---------------------------------------------------------------------------
 * The matrix grants a student `discussion_post: create, read, update, delete`
 * at OWN scope. Taken literally for READ, a student would see only their own
 * posts — which is not a discussion, it is a diary. Nobody would ever see an
 * answer to their question, including the teacher's.
 *
 * So OWN is enforced on the WRITES, which is where it means something: your
 * post is yours to edit and yours to withdraw, and nobody else's is. Reading is
 * scoped to the offerings a student is ENROLLED in, exactly as their lectures
 * and assignments are.
 *
 * If the SRS intends something narrower it is a one-line change to the scope
 * policy, but the feature would have no purpose.
 *
 * ---------------------------------------------------------------------------
 * THE RULES THAT MATTER are about editing and removing, because a discussion is
 * a record of a conversation and both operations rewrite history:
 *
 *   AN EDITED POST SAYS SO. Somebody who answers "yes, use method B" and later
 *   edits it to "no, never use method B" has changed what the thread means for
 *   everyone who read it. The marker is not a punishment; it is what makes the
 *   thread readable afterwards.
 *
 *   A REMOVED POST WITH REPLIES LEAVES A TOMBSTONE. Deleting the question and
 *   keeping the answers produces a thread of replies to nothing. The row goes,
 *   the shape stays.
 *
 *   A TEACHER MAY REMOVE ANYTHING IN THEIR SECTIONS, and it is recorded as
 *   moderation rather than as the author's own deletion — the difference
 *   matters to the person whose post disappeared.
 */

export interface PostActor {
  userId: string;
  roles: readonly string[];
  /** Offerings this actor teaches. Empty for a student. */
  teachesOfferings: readonly string[];
}

export interface PostRow {
  id: string;
  authorUserId: string;
  sectionSubjectId: string;
  createdAt: Date;
  deletedAt: Date | null;
  isLocked: boolean;
  replyCount: number;
}

export type Verdict =
  | { allowed: true; as: "author" | "moderator" }
  | { allowed: false; code: RefusalCode; message: string };

export type RefusalCode =
  | "NOT_YOURS"
  | "LOCKED"
  | "ALREADY_REMOVED"
  | "EDIT_WINDOW_CLOSED"
  | "EMPTY";

/**
 * How long an author may edit their own post.
 *
 * Long enough to fix a typo or a mangled paste, short enough that a post
 * somebody has already replied to does not change under them. A moderator is
 * not bound by it — correcting misinformation on an old post is exactly what
 * moderation is for.
 */
export const EDIT_WINDOW_MINUTES = 30;

const isStaff = (a: PostActor) =>
  a.roles.includes("super_admin") || a.roles.includes("admin");

/** A teacher of THIS offering, or an administrator. */
export function isModerator(actor: PostActor, post: PostRow): boolean {
  if (isStaff(actor)) return true;
  return (
    actor.roles.includes("teacher") && actor.teachesOfferings.includes(post.sectionSubjectId)
  );
}

export function mayEdit(actor: PostActor, post: PostRow, now: Date): Verdict {
  if (post.deletedAt) {
    return { allowed: false, code: "ALREADY_REMOVED", message: "That post has been removed." };
  }

  if (isModerator(actor, post)) return { allowed: true, as: "moderator" };

  if (post.authorUserId !== actor.userId) {
    return {
      allowed: false,
      code: "NOT_YOURS",
      message: "You can only edit your own posts.",
    };
  }

  if (post.isLocked) {
    return {
      allowed: false,
      code: "LOCKED",
      message: "This thread has been closed, so it can no longer be changed.",
    };
  }

  const minutes = (now.getTime() - post.createdAt.getTime()) / 60_000;
  if (minutes > EDIT_WINDOW_MINUTES) {
    return {
      allowed: false,
      code: "EDIT_WINDOW_CLOSED",
      message:
        `Posts can be edited for ${EDIT_WINDOW_MINUTES} minutes. After that, add a reply ` +
        `correcting yourself — people have read this one.`,
    };
  }

  return { allowed: true, as: "author" };
}

export function mayRemove(actor: PostActor, post: PostRow): Verdict {
  if (post.deletedAt) {
    return { allowed: false, code: "ALREADY_REMOVED", message: "That post has been removed." };
  }
  if (isModerator(actor, post)) return { allowed: true, as: "moderator" };
  if (post.authorUserId !== actor.userId) {
    return {
      allowed: false,
      code: "NOT_YOURS",
      message: "You can only remove your own posts.",
    };
  }
  // NO edit window on removal, deliberately. Somebody who posted something they
  // regret — a private detail, a temper — should be able to take it down at any
  // hour, and a thread with a tombstone in it is a smaller harm.
  return { allowed: true, as: "author" };
}

export function mayReply(actor: PostActor, post: PostRow): Verdict {
  if (post.deletedAt) {
    return { allowed: false, code: "ALREADY_REMOVED", message: "That post has been removed." };
  }
  if (post.isLocked && !isModerator(actor, post)) {
    return {
      allowed: false,
      code: "LOCKED",
      message: "This thread has been closed. Start a new one if the question is still open.",
    };
  }
  return { allowed: true, as: isModerator(actor, post) ? "moderator" : "author" };
}

/** A post of nothing helps nobody, and whitespace is nothing. */
export function refuseEmpty(body: string): Verdict | null {
  if (body.trim().length < 2) {
    return { allowed: false, code: "EMPTY", message: "Write something first." };
  }
  return null;
}

/**
 * What a removed post looks like to everyone else.
 *
 * Deleting a question and keeping its answers produces replies to nothing, so
 * a post with replies keeps its place in the thread and loses its content. One
 * with no replies is simply gone.
 */
export function tombstoneNeeded(post: PostRow): boolean {
  return post.replyCount > 0;
}
