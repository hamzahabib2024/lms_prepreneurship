import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { summarise, tally, type SecurityEventRow } from "./threat-summary";

export interface SecurityFilter {
  eventType?: string;
  userId?: string;
  email?: string;
  ipAddress?: string;
  from?: Date;
  to?: Date;
  page?: number;
}

/**
 * The security log — SRS §5.19, FR-LOG-020..026.
 *
 * Written since the first commit by the authentication service and, like the
 * audit log before it, read by nothing. Failed sign-ins, lockouts, step-up
 * refusals and replayed refresh tokens have all been recorded faithfully and
 * been invisible.
 *
 * SUPER ADMIN ONLY, with no Admin tier at all — which is stricter than the
 * audit log, where an Admin sees their own actions. That is deliberate (§4.5):
 * this log is a list of who has been attacked and from where, and it names
 * accounts alongside the addresses that tried them. It is the material for
 * investigating a colleague as easily as for defending one.
 *
 * The scope policy enforces that. Nothing here re-checks it, and nothing here
 * writes: the log is produced by authentication, never edited.
 */
@Injectable()
export class SecurityLogService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * FR-LOG-021 — what deserves attention right now.
   *
   * The default view. A list of 674 events, of which 664 are people signing in
   * successfully, tells nobody anything; this says whether anything in the
   * window looks like an attack, and what to do about each one.
   */
  async overview(hours = 24) {
    const since = new Date(Date.now() - hours * 3_600_000);
    const events = await this.prisma.scoped.securityEvent.findMany({
      where: { occurredAt: { gte: since } },
      orderBy: { occurredAt: "asc" },
      // A window this size is small; a very busy institute would page it, but
      // the analysis needs the whole window to see a pattern across it.
      take: 5000,
    });

    const rows = events as unknown as SecurityEventRow[];
    const concerns = summarise(rows);

    // Names, resolved once, so a concern can say "Sana Iqbal" rather than a
    // uuid. Under asSystem because the log stores an id and a Super Admin
    // reading it should not have to hold a separate grant to see who it means.
    const userIds = [...new Set(rows.map((r) => r.userId).filter((id): id is string => !!id))];
    const users = userIds.length
      ? await this.prisma.asSystem((db) =>
          db.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, fullName: true, email: true },
          }),
        )
      : [];
    const nameOf = new Map(users.map((u: (typeof users)[number]) => [u.id, u.fullName]));

    return {
      windowHours: hours,
      since,
      tally: tally(rows),
      concerns: concerns.map((c) => ({
        ...c,
        subjectName:
          c.subjectKind === "account" && c.subject ? (nameOf.get(c.subject) ?? c.subject) : null,
      })),
      // Said explicitly. An empty list is ambiguous between "quiet" and
      // "broken", and this log is one somebody checks precisely when anxious.
      message:
        concerns.length === 0
          ? `Nothing of concern in the last ${hours} hours.`
          : `${concerns.length} ${concerns.length === 1 ? "thing" : "things"} worth looking at.`,
    };
  }

  /** FR-LOG-020 — the events themselves, filtered. */
  async list(filter: SecurityFilter) {
    const page = Math.max(1, filter.page ?? 1);
    const pageSize = 50;

    const where = {
      ...(filter.eventType ? { eventType: { startsWith: filter.eventType } } : {}),
      ...(filter.userId ? { userId: filter.userId } : {}),
      // Contains rather than equals: an investigation starts from a fragment
      // somebody has, not from an exact address they already know.
      ...(filter.email ? { email: { contains: filter.email, mode: "insensitive" as const } } : {}),
      ...(filter.ipAddress ? { ipAddress: { contains: filter.ipAddress } } : {}),
      ...(filter.from || filter.to
        ? {
            occurredAt: {
              ...(filter.from ? { gte: filter.from } : {}),
              ...(filter.to ? { lte: filter.to } : {}),
            },
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.scoped.securityEvent.findMany({
        where,
        orderBy: { occurredAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.scoped.securityEvent.count({ where }),
    ]);

    const userIds = [
      ...new Set(
        rows.map((r: (typeof rows)[number]) => r.userId).filter((id): id is string => !!id),
      ),
    ];
    const users = userIds.length
      ? await this.prisma.asSystem((db) =>
          db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true } }),
        )
      : [];
    const nameOf = new Map(users.map((u: (typeof users)[number]) => [u.id, u.fullName]));

    return {
      data: rows.map((r: (typeof rows)[number]) => ({
        id: r.id,
        occurredAt: r.occurredAt,
        eventType: r.eventType,
        outcome: r.outcome,
        userId: r.userId,
        // The email on a failed sign-in may belong to NO ACCOUNT — somebody
        // guessing addresses. Naming it "account" would assert otherwise, so
        // the field is `email` and the screen labels it "tried".
        email: r.email,
        who: r.userId ? (nameOf.get(r.userId) ?? "Deleted account") : null,
        ipAddress: r.ipAddress,
        userAgent: r.userAgent,
        detail: r.detail,
        correlationId: r.correlationId,
      })),
      pagination: {
        page,
        pageSize,
        totalItems: total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
    };
  }

  /**
   * FR-LOG-024 — one account's security history.
   *
   * The question actually asked is "has this person been attacked, or are they
   * just bad at typing", and it is answered by the shape of their own events
   * rather than by the whole log.
   */
  async forUser(userId: string) {
    const events = await this.prisma.scoped.securityEvent.findMany({
      where: { userId },
      orderBy: { occurredAt: "desc" },
      take: 200,
    });
    const rows = events as unknown as SecurityEventRow[];

    const addresses = new Map<string, number>();
    for (const e of rows) {
      if (e.ipAddress) addresses.set(e.ipAddress, (addresses.get(e.ipAddress) ?? 0) + 1);
    }

    return {
      userId,
      tally: tally(rows),
      concerns: summarise(rows),
      // Where they sign in FROM, commonest first. An account that has always
      // been used from one address and suddenly appears from another is the
      // pattern nobody spots by reading rows in time order.
      addresses: [...addresses.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([address, count]) => ({ address, count })),
      events: rows.slice(0, 50),
    };
  }

  /** FR-LOG-026 — the kinds present, for building a filter. */
  async eventTypes() {
    const rows = await this.prisma.scoped.securityEvent.groupBy({
      by: ["eventType"],
      _count: { _all: true },
      orderBy: { _count: { eventType: "desc" } },
    });
    return rows.map((r: (typeof rows)[number]) => ({
      eventType: r.eventType,
      count: r._count._all,
    }));
  }
}
