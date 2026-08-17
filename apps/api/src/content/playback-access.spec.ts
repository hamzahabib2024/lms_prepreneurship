import { ContentService } from "./content.service";
import type { ConfigService } from "@nestjs/config";
import * as actorContext from "../prisma/actor-context";

/**
 * WHO MAY WATCH A LECTURE — §4.5, ARC-039.
 *
 * The matrix grants `lecture_playback: read` to all four roles: ALL for a
 * super admin and an administrator, ASSIGNED for a teacher, ENROLLED for a
 * student. The service opened with
 *
 *   if (!actor?.studentId) throw AUTH_FORBIDDEN  // "only a student can watch"
 *
 * so three of those four were refused. A teacher could publish a recording to
 * thirty students and never watch it back to check it; an administrator could
 * not open one at all. The permission existed and nothing could satisfy it —
 * a guard nobody can satisfy, and the fourth of its kind here.
 *
 * These tests assert the GRANTS, not only the refusals. A suite that checked
 * "a stranger is refused" would have passed throughout the bug.
 */
describe("issuing a playback ticket", () => {
  const LECTURE = {
    id: "lecture-1",
    storageRef: "1Nkr4Vh",
    durationSeconds: 4331,
    availabilityStatus: "AVAILABLE",
  };

  /** Records what was written, so the ticket's shape can be asserted. */
  function harness(opts: { lecture?: unknown; progressRow?: unknown } = {}) {
    const tickets: Array<Record<string, unknown>> = [];
    const progressQueries: Array<Record<string, unknown>> = [];

    const scoped = {
      recordedLecture: {
        findFirst: () => Promise.resolve(opts.lecture === undefined ? LECTURE : opts.lecture),
      },
      watchProgress: {
        findFirst: ({ where }: { where: Record<string, unknown> }) => {
          progressQueries.push(where);
          return Promise.resolve(opts.progressRow ?? null);
        },
      },
    };

    const service = new ContentService(
      {
        scoped,
        asSystem: <T>(fn: (db: unknown) => Promise<T> | T) =>
          Promise.resolve(
            fn({
              playbackTicket: {
                create: ({ data }: { data: Record<string, unknown> }) => {
                  tickets.push(data);
                  return Promise.resolve(data);
                },
                deleteMany: () => Promise.resolve({ count: 0 }),
              },
            }),
          ),
      } as never,
      { record: () => Promise.resolve(undefined) } as never,
      {} as never,
      { get: (_k: string, d?: string) => d } as unknown as ConfigService,
    );

    return { service, tickets, progressQueries };
  }

  const asActor = (actor: Record<string, unknown>) =>
    jest.spyOn(actorContext, "getActor").mockReturnValue(actor as never);

  afterEach(() => jest.restoreAllMocks());

  // ───────────────────────────────────────────────────────────── the grants ──

  it("issues one to a STUDENT", async () => {
    asActor({ userId: "u-student", studentId: "s-1", roles: ["student"] });
    const { service, tickets } = harness();

    const ticket = await service.issuePlaybackTicket("lecture-1");

    expect(ticket.ticketId).toMatch(/^pt_/);
    expect(ticket.streamUrl).toContain(ticket.ticketId);
    expect(tickets[0]).toMatchObject({ userId: "u-student", studentId: "s-1" });
  });

  it("issues one to a TEACHER — who has to check what they publish", async () => {
    asActor({ userId: "u-teacher", roles: ["teacher"] });
    const { service, tickets } = harness();

    const ticket = await service.issuePlaybackTicket("lecture-1");

    expect(ticket.ticketId).toMatch(/^pt_/);
    expect(tickets[0]).toMatchObject({ userId: "u-teacher", studentId: null });
  });

  it("issues one to an ADMINISTRATOR", async () => {
    asActor({ userId: "u-admin", roles: ["admin"] });
    const { service } = harness();
    await expect(service.issuePlaybackTicket("lecture-1")).resolves.toHaveProperty("ticketId");
  });

  it("issues one to a SUPER ADMIN", async () => {
    asActor({ userId: "u-super", roles: ["super_admin"] });
    const { service } = harness();
    await expect(service.issuePlaybackTicket("lecture-1")).resolves.toHaveProperty("ticketId");
  });

  // ──────────────────────────────────────────────────────── still refused ──

  it("refuses anyone not signed in", async () => {
    asActor(null as never);
    const { service } = harness();
    await expect(service.issuePlaybackTicket("lecture-1")).rejects.toThrow();
  });

  it("refuses a lecture the scope predicate does not return", async () => {
    // A student not enrolled on the class, or a teacher not assigned to it.
    // It is NOT_FOUND rather than FORBIDDEN on purpose: telling somebody a
    // lecture exists but is not theirs is itself a disclosure.
    asActor({ userId: "u-student", studentId: "s-1", roles: ["student"] });
    const { service } = harness({ lecture: null });
    await expect(service.issuePlaybackTicket("lecture-1")).rejects.toMatchObject({
      code: "RESOURCE_NOT_FOUND",
    });
  });

  it("refuses a lecture whose file has gone (ARC-045)", async () => {
    asActor({ userId: "u-teacher", roles: ["teacher"] });
    const { service } = harness({
      lecture: { ...LECTURE, availabilityStatus: "MISSING" },
    });
    await expect(service.issuePlaybackTicket("lecture-1")).rejects.toMatchObject({
      code: "STORAGE_UNAVAILABLE",
    });
  });

  // ──────────────────────────────────────────── what staff must NOT receive ──

  /**
   * The privacy bug that letting staff watch would otherwise have introduced.
   *
   * Prisma reads `studentId: undefined` as "do not filter on studentId", and
   * WatchProgress is UNSCOPED for an administrator — so the resume lookup would
   * have returned some student's row. The administrator's player would open at
   * a named student's position and announce "43% watched previously", which is
   * that student's study record shown to somebody who never asked for it.
   */
  it("never looks up watch progress for staff", async () => {
    asActor({ userId: "u-admin", roles: ["admin"] });
    const { service, progressQueries } = harness({
      progressRow: { lastPositionSeconds: 812, watchedPercent: 43 },
    });

    const ticket = await service.issuePlaybackTicket("lecture-1");

    // The query was never made at all — not made and then discarded.
    expect(progressQueries).toEqual([]);
    expect(ticket.resumePositionSeconds).toBe(0);
    expect(ticket.watchedPercent).toBe(0);
  });

  it("DOES look up watch progress for a student, filtered to them", async () => {
    // Without this the test above is satisfied by never looking progress up
    // for anybody, which would silently break resume for every student.
    asActor({ userId: "u-student", studentId: "s-1", roles: ["student"] });
    const { service, progressQueries } = harness({
      progressRow: { lastPositionSeconds: 812, watchedPercent: 43 },
    });

    const ticket = await service.issuePlaybackTicket("lecture-1");

    expect(progressQueries).toHaveLength(1);
    expect(progressQueries[0]).toMatchObject({ studentId: "s-1" });
    expect(ticket.resumePositionSeconds).toBe(812);
  });

  it("tells the player whether anything is being recorded", async () => {
    // watch_progress:update is student-only (BR-PRG-02). Without this flag the
    // player reports anyway, is refused, retries what it could not save, and
    // loops a 403 every fifteen seconds for as long as a teacher watches.
    asActor({ userId: "u-teacher", roles: ["teacher"] });
    const staff = harness();
    expect((await staff.service.issuePlaybackTicket("lecture-1")).recordsProgress).toBe(false);

    asActor({ userId: "u-student", studentId: "s-1", roles: ["student"] });
    const student = harness();
    expect((await student.service.issuePlaybackTicket("lecture-1")).recordsProgress).toBe(true);
  });
});
