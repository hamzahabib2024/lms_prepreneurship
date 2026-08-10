import {
  EDIT_WINDOW_MINUTES,
  isModerator,
  mayEdit,
  mayRemove,
  mayReply,
  refuseEmpty,
  tombstoneNeeded,
  type PostActor,
  type PostRow,
} from "./discussion-rules";

const OFFERING = "offering-1";
const now = new Date("2026-08-11T12:00:00Z");
const minutesAgo = (n: number) => new Date(now.getTime() - n * 60_000);

const post = (over: Partial<PostRow> = {}): PostRow => ({
  id: "post-1",
  authorUserId: "student-1",
  sectionSubjectId: OFFERING,
  createdAt: minutesAgo(5),
  deletedAt: null,
  isLocked: false,
  replyCount: 0,
  ...over,
});

const author: PostActor = { userId: "student-1", roles: ["student"], teachesOfferings: [] };
const classmate: PostActor = { userId: "student-2", roles: ["student"], teachesOfferings: [] };
const teacher: PostActor = { userId: "teacher-1", roles: ["teacher"], teachesOfferings: [OFFERING] };
const otherTeacher: PostActor = {
  userId: "teacher-2",
  roles: ["teacher"],
  teachesOfferings: ["offering-2"],
};
const admin: PostActor = { userId: "admin-1", roles: ["admin"], teachesOfferings: [] };

describe("who moderates", () => {
  it("the teacher of THIS offering does", () => {
    expect(isModerator(teacher, post())).toBe(true);
  });

  it("a teacher of another offering does NOT", () => {
    // BR-ACC-04 — a teacher's authority is their own sections, not the subject
    // everywhere it is taught.
    expect(isModerator(otherTeacher, post())).toBe(false);
  });

  it("an administrator does", () => {
    expect(isModerator(admin, post())).toBe(true);
  });

  it("a classmate does not", () => {
    expect(isModerator(classmate, post())).toBe(false);
  });
});

describe("editing", () => {
  it("lets the author edit a fresh post", () => {
    expect(mayEdit(author, post(), now)).toEqual({ allowed: true, as: "author" });
  });

  it("refuses a classmate", () => {
    const v = mayEdit(classmate, post(), now);
    expect(v).toMatchObject({ allowed: false, code: "NOT_YOURS" });
  });

  it("closes the window after the allowed time", () => {
    const v = mayEdit(author, post({ createdAt: minutesAgo(EDIT_WINDOW_MINUTES + 1) }), now);
    expect(v).toMatchObject({ allowed: false, code: "EDIT_WINDOW_CLOSED" });
  });

  it("is still open ON the boundary", () => {
    expect(
      mayEdit(author, post({ createdAt: minutesAgo(EDIT_WINDOW_MINUTES) }), now).allowed,
    ).toBe(true);
  });

  it("tells the author what to do instead", () => {
    const v = mayEdit(author, post({ createdAt: minutesAgo(120) }), now);
    expect(v.allowed).toBe(false);
    if (!v.allowed) expect(v.message).toContain("add a reply");
  });

  it("does NOT bind a moderator to the window", () => {
    // Correcting misinformation on an old post is what moderation is for.
    expect(mayEdit(teacher, post({ createdAt: minutesAgo(10_000) }), now)).toEqual({
      allowed: true,
      as: "moderator",
    });
  });

  it("refuses the author on a locked thread", () => {
    expect(mayEdit(author, post({ isLocked: true }), now)).toMatchObject({
      allowed: false,
      code: "LOCKED",
    });
  });

  it("still lets a moderator edit a locked thread", () => {
    expect(mayEdit(teacher, post({ isLocked: true }), now).allowed).toBe(true);
  });

  it("refuses everybody on a removed post", () => {
    for (const who of [author, teacher, admin]) {
      expect(mayEdit(who, post({ deletedAt: now }), now)).toMatchObject({
        allowed: false,
        code: "ALREADY_REMOVED",
      });
    }
  });
});

describe("removing", () => {
  it("lets the author remove their own", () => {
    expect(mayRemove(author, post())).toEqual({ allowed: true, as: "author" });
  });

  it("has NO time limit for the author", () => {
    // Somebody who posted a private detail or lost their temper should be able
    // to take it down at any hour. A tombstone is the smaller harm.
    expect(mayRemove(author, post({ createdAt: minutesAgo(100_000) })).allowed).toBe(true);
  });

  it("lets a moderator remove anybody's", () => {
    expect(mayRemove(teacher, post({ authorUserId: "someone-else" }))).toEqual({
      allowed: true,
      as: "moderator",
    });
  });

  it("refuses a classmate", () => {
    expect(mayRemove(classmate, post())).toMatchObject({ allowed: false, code: "NOT_YOURS" });
  });

  it("refuses a teacher of a different offering", () => {
    expect(mayRemove(otherTeacher, post())).toMatchObject({ allowed: false, code: "NOT_YOURS" });
  });

  it("refuses removing twice", () => {
    expect(mayRemove(author, post({ deletedAt: now }))).toMatchObject({
      allowed: false,
      code: "ALREADY_REMOVED",
    });
  });
});

describe("replying", () => {
  it("is allowed on an open thread", () => {
    expect(mayReply(classmate, post()).allowed).toBe(true);
  });

  it("is refused on a locked one", () => {
    const v = mayReply(classmate, post({ isLocked: true }));
    expect(v).toMatchObject({ allowed: false, code: "LOCKED" });
    if (!v.allowed) expect(v.message).toContain("Start a new one");
  });

  it("is still allowed for a moderator on a locked thread", () => {
    expect(mayReply(teacher, post({ isLocked: true })).allowed).toBe(true);
  });

  it("is refused on a removed post", () => {
    expect(mayReply(classmate, post({ deletedAt: now }))).toMatchObject({
      allowed: false,
      code: "ALREADY_REMOVED",
    });
  });
});

describe("the body", () => {
  it("refuses nothing", () => {
    expect(refuseEmpty("")).toMatchObject({ code: "EMPTY" });
  });

  it("refuses whitespace", () => {
    expect(refuseEmpty("   \n\t ")).toMatchObject({ code: "EMPTY" });
  });

  it("accepts a short real answer", () => {
    // "No." is a complete answer to plenty of questions.
    expect(refuseEmpty("No.")).toBeNull();
  });
});

describe("tombstones", () => {
  it("are needed when somebody has replied", () => {
    // Deleting the question and keeping the answers produces replies to
    // nothing.
    expect(tombstoneNeeded(post({ replyCount: 3 }))).toBe(true);
  });

  it("are not needed for a post nobody answered", () => {
    expect(tombstoneNeeded(post({ replyCount: 0 }))).toBe(false);
  });
});
