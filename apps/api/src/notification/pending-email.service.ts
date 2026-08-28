import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { randomBytes, createHash } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { CredentialsMailer } from "./credentials-mailer";
import { classify, stillWanted, summarise, MAX_ATTEMPTS } from "./pending-email";

/**
 * MESSAGES THE MAIL SERVER WOULD NOT TAKE YET, AND THE SWEEP THAT SENDS THEM.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE PROBLEM, CONCRETELY. A free Google account stops accepting messages after
 * roughly five hundred recipients in a rolling twenty-four hours and answers
 * every further attempt with "550-5.4.5 Daily user sending limit exceeded".
 * Import a cohort of forty on a day the account has already been used and the
 * last of them get nothing. Before this, that was the end of it: the screen
 * said "not emailed", somebody was expected to read out a dozen passwords by
 * hand, and the message that would have gone through an hour later was never
 * attempted again.
 *
 * WHAT IS STORED IS THE INTENT, NOT THE MESSAGE, and that is the important
 * decision in this file. The credentials email carries a temporary password.
 * This System's whole position on those is that they are hashed the instant
 * they are made and nobody — a Super Admin included — can look one up. A queue
 * holding a copy of the password so it can be posted tomorrow would undo that
 * quietly and completely. So a row says who is owed what kind of message, and
 * the body is built again when it is finally sent.
 *
 * WHICH MEANS A QUEUED CREDENTIALS EMAIL BECOMES A LINK. It cannot carry the
 * original password, because that is gone. It carries a ticket to choose one
 * instead — and that turns out to be better than the thing it replaces:
 *
 *   · The temporary password the operator can still read off the import screen
 *     GOES ON WORKING. Nothing they have already written down or read out is
 *     invalidated, which is exactly what re-minting a password would have done.
 *   · A ticket to choose a password is not a credential. Intercepted, it is
 *     one use and thirty minutes; a password in an inbox is neither.
 *   · The clock starts when it is SENT, not when it was queued, so a message
 *     that waited twenty hours still arrives with its full validity.
 *
 * IT IS NOT A GENERAL MAIL QUEUE, and should not quietly become one. Only the
 * two messages that carry a person's way into the System are kept: everything
 * else here — an announcement, a notification — is a thing whose moment has
 * passed by the time the mailbox recovers, and delivering yesterday's alert
 * tomorrow is worse than not delivering it.
 * ─────────────────────────────────────────────────────────────────────────────
 */
@Injectable()
export class PendingEmailService {
  private readonly logger = new Logger(PendingEmailService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly credentials: CredentialsMailer,
  ) {}

  /**
   * Keep a message that could not be sent, if it is worth keeping.
   *
   * Returns whether it was queued, so the caller can tell somebody the
   * difference between "this will arrive later" and "this will never arrive
   * and you must relay it yourself". Those need opposite responses from the
   * person at the desk, and reporting them the same way is how an operator
   * reads out passwords nobody needed.
   */
  async queue(input: {
    kind: "CREDENTIALS" | "COURSE_ADDED";
    userId: string;
    toAddress: string;
    fullName: string;
    context?: Record<string, unknown>;
    detail: string;
  }): Promise<boolean> {
    const verdict = classify(input.detail, 1);
    if (!verdict.retry) {
      this.logger.warn(
        `Not queueing mail for ${input.toAddress}: ${verdict.because} (${summarise(input.detail)})`,
      );
      return false;
    }

    try {
      await this.prisma.asSystem((db) =>
        db.pendingEmail.create({
          data: {
            kind: input.kind,
            userId: input.userId,
            toAddress: input.toAddress,
            fullName: input.fullName,
            ...(input.context ? { context: input.context as object } : {}),
            attempts: 1,
            lastError: summarise(input.detail),
            nextAttemptAt: new Date(Date.now() + verdict.afterMs),
          },
        }),
      );
      return true;
    } catch (err) {
      /*
       * NEVER FAILS THE THING IT FOLLOWS. The account has been created and the
       * import has happened; a queue that cannot be written to is a smaller
       * problem than an exception thrown out of the tail of an import.
       */
      this.logger.error(
        `Could not queue mail for ${input.toAddress}: ` +
          (err instanceof Error ? err.message : "unknown error"),
      );
      return false;
    }
  }

  /**
   * Send what is due.
   *
   * EVERY TEN MINUTES, which is frequent enough that a recovered allowance is
   * noticed promptly and rare enough to cost nothing when the queue is empty —
   * the usual case is one indexed query returning no rows.
   *
   * The sweep does NOT run them in parallel. A queue that exists because a
   * mail server refused too many messages is the last place to send a burst.
   */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async drain(): Promise<void> {
    const due = await this.prisma
      .asSystem((db) =>
        db.pendingEmail.findMany({
          where: { status: "PENDING", nextAttemptAt: { lte: new Date() } },
          orderBy: { nextAttemptAt: "asc" },
          // A ceiling per sweep, so one enormous backlog cannot spend the
          // whole restored allowance in a single pass and lock itself out again.
          take: 25,
          select: {
            id: true,
            kind: true,
            userId: true,
            toAddress: true,
            fullName: true,
            context: true,
            attempts: true,
          },
        }),
      )
      .catch((err: unknown) => {
        this.logger.error(
          `Could not read the mail queue: ` +
            (err instanceof Error ? err.message : "unknown error"),
        );
        return [];
      });

    if (due.length === 0) return;
    this.logger.log(`Mail queue: ${due.length} due.`);

    let sent = 0;
    let waiting = 0;
    let abandoned = 0;

    for (const row of due) {
      const outcome = await this.attempt(row);
      if (outcome === "SENT") sent += 1;
      else if (outcome === "ABANDONED") abandoned += 1;
      else waiting += 1;
    }

    this.logger.log(
      `Mail queue: ${sent} sent, ${waiting} still waiting, ${abandoned} given up on.`,
    );
  }

  /** One message. Never throws — a bad row must not stop the sweep. */
  private async attempt(row: {
    id: string;
    kind: string;
    userId: string;
    toAddress: string;
    fullName: string;
    context: unknown;
    attempts: number;
  }): Promise<"SENT" | "WAITING" | "ABANDONED"> {
    const attempts = row.attempts + 1;

    try {
      /*
       * IS IT STILL WANTED? Somebody who has already signed in does not need a
       * link to choose a password, and somebody whose account has been
       * suspended must not be sent one. Checked at SEND time rather than at
       * queue time, because the whole point is that a long time has passed.
       */
      const user = await this.prisma.asSystem((db) =>
        db.user.findFirst({
          where: { id: row.userId, deletedAt: null },
          select: { id: true, email: true, status: true, lastLoginAt: true },
        }),
      );

      if (!user) {
        return await this.abandon(row.id, attempts, "The account no longer exists.");
      }
      const wanted = stillWanted({
        kind: row.kind as "CREDENTIALS" | "COURSE_ADDED",
        status: user.status,
        lastLoginAt: user.lastLoginAt,
      });
      if (!wanted.send) {
        return await this.abandon(row.id, attempts, wanted.because);
      }

      // The address as it stands now, not as it was — a corrected address is
      // the likeliest reason somebody is still waiting.
      const to = user.email || row.toAddress;

      const context = (row.context ?? {}) as { sectionName?: string; registrationNo?: string };
      const posted =
        row.kind === "CREDENTIALS"
          ? await this.credentials.sendSetPasswordLink({
              to,
              fullName: row.fullName,
              registrationNo: context.registrationNo ?? null,
              token: await this.mintSetPasswordToken(user.id),
            })
          : await this.credentials.sendCourseAdded({
              to,
              fullName: row.fullName,
              registrationNo: context.registrationNo ?? null,
              sectionName: context.sectionName ?? "your course",
            });

      if (posted.sent) {
        await this.prisma.asSystem((db) =>
          db.pendingEmail.update({
            where: { id: row.id },
            data: { status: "SENT", sentAt: new Date(), attempts, lastError: null },
          }),
        );
        return "SENT";
      }

      return await this.reschedule(row.id, attempts, posted.detail);
    } catch (err) {
      return await this.reschedule(
        row.id,
        attempts,
        err instanceof Error ? err.message : "The mailer raised an error.",
      );
    }
  }

  private async reschedule(
    id: string,
    attempts: number,
    detail: string,
  ): Promise<"WAITING" | "ABANDONED"> {
    const verdict = classify(detail, attempts);
    if (!verdict.retry) return this.abandon(id, attempts, verdict.because, detail);

    await this.prisma
      .asSystem((db) =>
        db.pendingEmail.update({
          where: { id },
          data: {
            attempts,
            lastError: summarise(detail),
            nextAttemptAt: new Date(Date.now() + verdict.afterMs),
          },
        }),
      )
      .catch(() => undefined);
    return "WAITING";
  }

  private async abandon(
    id: string,
    attempts: number,
    because: string,
    detail?: string,
  ): Promise<"ABANDONED"> {
    this.logger.warn(`Giving up on queued mail ${id} after ${attempts}: ${because}`);
    await this.prisma
      .asSystem((db) =>
        db.pendingEmail.update({
          where: { id },
          data: {
            status: "ABANDONED",
            attempts,
            lastError: detail ? `${because} ${summarise(detail)}` : because,
          },
        }),
      )
      .catch(() => undefined);
    return "ABANDONED";
  }

  /**
   * A one-use ticket to choose a password, valid for thirty minutes.
   *
   * MINTED AT THE MOMENT OF SENDING, not when the message was queued. A
   * message can wait twenty hours for an allowance to return, and a ticket
   * minted at queue time would arrive already expired — which is the same
   * failure as not sending it, only more confusing for the person holding it.
   *
   * It voids any earlier live ticket for the same person, exactly as asking
   * for a reset does: two live links for one account is one more than anybody
   * needs and one more that can be stolen.
   */
  private async mintSetPasswordToken(userId: string): Promise<string> {
    const token = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const expiresAt = new Date(Date.now() + 30 * 60_000);

    await this.prisma.asSystem((db) =>
      db.$transaction(async (tx) => {
        await tx.passwordResetToken.updateMany({
          where: { userId, usedAt: null, expiresAt: { gt: new Date() } },
          data: { usedAt: new Date() },
        });
        await tx.passwordResetToken.create({
          data: { userId, tokenHash, expiresAt, requestedFrom: null },
        });
      }),
    );

    // Only the ticket leaves this method. The hash is what is stored, so the
    // database never holds anything that can be used to sign in.
    return token;
  }

  /** What is waiting, for the operator who wants to know. */
  async summary(): Promise<{ pending: number; abandoned: number; nextAttemptAt: Date | null }> {
    const [pending, abandoned, next] = await Promise.all([
      this.prisma.asSystem((db) => db.pendingEmail.count({ where: { status: "PENDING" } })),
      this.prisma.asSystem((db) => db.pendingEmail.count({ where: { status: "ABANDONED" } })),
      this.prisma.asSystem((db) =>
        db.pendingEmail.findFirst({
          where: { status: "PENDING" },
          orderBy: { nextAttemptAt: "asc" },
          select: { nextAttemptAt: true },
        }),
      ),
    ]);
    return { pending, abandoned, nextAttemptAt: next?.nextAttemptAt ?? null };
  }

  /** Exposed so the limit is stated in one place only. */
  static readonly MAX_ATTEMPTS = MAX_ATTEMPTS;
}
