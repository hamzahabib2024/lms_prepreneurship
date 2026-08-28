import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { SettingsService } from "../settings/settings.service";

/**
 * WHERE THE SENDING ALLOWANCE WENT.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * "The mail account is full" was only ever half an answer, and the half nobody
 * can act on. The other half — WHAT filled it — could not be answered at all,
 * because a message that sent successfully left no trace anywhere in the
 * System. Only failures were recorded, which is exactly backwards: an
 * allowance is spent by the mail that WORKED.
 *
 * So every attempt is written down, and the interesting question becomes
 * answerable: two hundred sign-in details from an import somebody re-ran by
 * mistake looks completely different from two hundred announcements, and until
 * this existed the two were indistinguishable after the fact.
 *
 * THE LIMIT HERE IS NOT ENFORCED AND MUST NOT BE. Google enforces it, on its
 * own count, which this System cannot see — mail sent from the same account by
 * a person in Gmail spends the same allowance and never touches this code. So
 * the figure is a WARNING, always described as an estimate, and never used to
 * refuse a send. A System that stopped sending at its own count of 500 would
 * withhold mail an account still had room for, and would still be surprised by
 * the real limit arriving early.
 * ─────────────────────────────────────────────────────────────────────────────
 */
@Injectable()
export class EmailLogService {
  private readonly logger = new Logger(EmailLogService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Write down one attempt.
   *
   * NEVER THROWS AND NEVER BLOCKS THE SEND. The message has already gone (or
   * already failed) by the time this is called; a logging table that is full,
   * locked or missing must not turn a delivered message into an error. A
   * warning in the console is the correct worst case.
   */
  record(entry: {
    toAddress: string;
    kind: string;
    subject: string;
    status: "SENT" | "FAILED" | "SUPPRESSED";
    detail?: string | null;
  }): void {
    void this.prisma
      .asSystem((db) =>
        db.emailLog.create({
          data: {
            toAddress: entry.toAddress.slice(0, 320),
            kind: entry.kind.slice(0, 80),
            subject: entry.subject.slice(0, 300),
            status: entry.status,
            // Only on a refusal. A success detail is the provider's message id
            // and says nothing anybody reads.
            ...(entry.status === "SENT" ? {} : { detail: entry.detail ?? null }),
          },
        }),
      )
      .catch((err: unknown) =>
        this.logger.warn(
          `Could not record an email attempt: ` +
            (err instanceof Error ? err.message : "unknown error"),
        ),
      );
  }

  /**
   * How much of the day's allowance has gone, and on what.
   *
   * ROLLING TWENTY-FOUR HOURS, not since midnight, because that is how Google
   * counts it. A calendar-day figure would read as nearly empty at 00:05 on a
   * morning when the account is still completely blocked from the evening
   * before — the one moment somebody is most likely to be looking at it.
   */
  async usage(): Promise<{
    sent: number;
    failed: number;
    limit: number;
    remaining: number;
    percentUsed: number;
    /** The mail server has actually refused something for being over the limit. */
    blocked: boolean;
    blockedSince: Date | null;
    byKind: Array<{ kind: string; label: string; sent: number }>;
    recent: Array<{
      occurredAt: Date;
      toAddress: string;
      kind: string;
      subject: string;
      status: string;
    }>;
  }> {
    const since = new Date(Date.now() - 24 * 3600_000);

    const [sent, failed, grouped, recent, lastLimitRefusal, limit] = await Promise.all([
      this.prisma.asSystem((db) =>
        db.emailLog.count({ where: { status: "SENT", occurredAt: { gte: since } } }),
      ),
      this.prisma.asSystem((db) =>
        db.emailLog.count({ where: { status: "FAILED", occurredAt: { gte: since } } }),
      ),
      this.prisma.asSystem((db) =>
        db.emailLog.groupBy({
          by: ["kind"],
          where: { status: "SENT", occurredAt: { gte: since } },
          _count: { _all: true },
        }),
      ),
      this.prisma.asSystem((db) =>
        db.emailLog.findMany({
          where: { occurredAt: { gte: since } },
          orderBy: { occurredAt: "desc" },
          take: 50,
          select: {
            occurredAt: true,
            toAddress: true,
            kind: true,
            subject: true,
            status: true,
          },
        }),
      ),
      /*
       * DID THE SERVER ITSELF SAY SO? This is the only trustworthy signal that
       * the account is actually out — far better than comparing our count to a
       * configured number, because mail sent from the same account by a person
       * in Gmail spends the allowance without ever passing through here.
       */
      this.prisma.asSystem((db) =>
        db.emailLog.findFirst({
          where: {
            status: "FAILED",
            occurredAt: { gte: since },
            OR: [
              { detail: { contains: "5.4.5" } },
              { detail: { contains: "Daily user sending limit", mode: "insensitive" } },
            ],
          },
          orderBy: { occurredAt: "desc" },
          select: { occurredAt: true },
        }),
      ),
      this.limit(),
    ]);

    const byKind = grouped
      .map((g) => ({
        kind: g.kind,
        label: KIND_LABELS[g.kind] ?? g.kind,
        sent: g._count._all,
      }))
      .sort((a, b) => b.sent - a.sent);

    return {
      sent,
      failed,
      limit,
      remaining: Math.max(0, limit - sent),
      percentUsed: limit > 0 ? Math.min(100, Math.round((sent / limit) * 100)) : 0,
      blocked: lastLimitRefusal !== null,
      blockedSince: lastLimitRefusal?.occurredAt ?? null,
      byKind,
      recent,
    };
  }

  /** The Institute's stated allowance. A warning threshold, never a gate. */
  private async limit(): Promise<number> {
    const value = (await this.settings.resolveFor())["email.dailyLimit"];
    return typeof value === "number" && value > 0 ? value : 500;
  }

  /**
   * Throw away what is too old to answer anything.
   *
   * This is the highest-volume table the System writes and its entire value is
   * recent — nobody asks what the allowance was spent on last spring. Ninety
   * days is well past any question anybody has actually had, and keeps the
   * table from growing without end on an institute that mails every day.
   */
  async prune(): Promise<number> {
    const cutoff = new Date(Date.now() - 90 * 24 * 3600_000);
    const result = await this.prisma
      .asSystem((db) => db.emailLog.deleteMany({ where: { occurredAt: { lt: cutoff } } }))
      .catch(() => ({ count: 0 }));
    if (result.count > 0) {
      this.logger.log(`Pruned ${result.count} email log entries older than 90 days.`);
    }
    return result.count;
  }
}

/**
 * The Institute's words for the System's own message kinds.
 *
 * WORTH A TABLE because this is the answer to "where did my allowance go", and
 * "account.created" is a developer's name for it. Anything unmapped falls back
 * to the raw kind rather than being hidden — an unrecognised sender is exactly
 * what somebody investigating a spent allowance most wants to see.
 */
const KIND_LABELS: Record<string, string> = {
  "account.created": "New sign-in details",
  "account.set-password": "Password-choosing links",
  "registration.course-added": "Course enrolment notes",
  "password.reset": "Password resets",
  announcement: "Announcements",
  "admission.approved": "Admission approvals",
  "admission.received": "Application receipts",
};
