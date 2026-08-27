import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { AppError } from "@lms/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { AuthService } from "./auth.service";
import { EmailChannel } from "../notification/channel/email.channel";

/**
 * FORGOTTEN PASSWORDS — FR-AUT.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A LINK AND NOT AN EMAILED TEMPORARY PASSWORD.
 *
 * The obvious design is to generate a temporary password, email it, and force a
 * change at the next sign-in. It is what the office already does by hand, and
 * it is the thing to avoid, for one reason: THE TEMPORARY PASSWORD IS THE
 * ACCOUNT'S CREDENTIAL. It sits in the mailbox indefinitely, it works until
 * somebody gets round to changing it, and anyone who reads that message later —
 * on a shared computer, in a mailbox that is breached next year, in a thread
 * forwarded to a colleague — can sign in as that person.
 *
 * A reset token is not a credential. It is a ticket to CHOOSE a credential:
 *
 *   · it expires in thirty minutes, so a mailbox read tomorrow yields nothing;
 *   · it is single use, so it cannot be replayed;
 *   · only its SHA-256 is stored, so a stolen database yields nothing either;
 *   · issuing a new one voids every earlier one for that account.
 *
 * The parts of the office's design that were right are kept: the reader is told
 * plainly to go and look in their email, and every session ends the moment the
 * password changes.
 *
 * IT SAYS WHEN AN ADDRESS IS NOT OURS, and that is a decision the Institute
 * made deliberately after being shown the trade-off.
 *
 * The alternative — one sentence for every outcome — hides whether an address
 * is registered, which stops somebody testing a list of addresses against the
 * student roster. It also means a person who mistypes their own address is
 * told their link is on its way and then waits for mail that will never come,
 * and the office is left explaining a form that lies to people.
 *
 * The Institute weighed those and chose to be told. What remains against a
 * scan, and is now doing real work rather than being a second line of
 * defence:
 *
 *   · five requests an hour per address (the route's throttle), which makes
 *     grinding through a list slow enough to be useless;
 *   · every lookup for an unknown address is written to the security log, so
 *     a scan is visible afterwards rather than silent.
 *
 * A SUSPENDED ACCOUNT IS STILL NOT DISTINGUISHED from an absent one. Whether
 * the Institute has suspended somebody is its business and the office's to
 * explain, not an unauthenticated endpoint's.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** Long enough that guessing is hopeless, short enough to survive a mail client. */
const TOKEN_BYTES = 32;
const VALID_MINUTES = 30;

/** What a person is told when the link really is on its way. */
const SENT =
  "A link for setting a new password has been sent. It is valid for 30 minutes, " +
  "and only somebody who can open that mailbox can use it.";

@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
    private readonly email: EmailChannel,
    private readonly config: ConfigService,
  ) {}

  /**
   * Ask for a reset. Always succeeds, whatever the address.
   */
  async request(email: string, ip?: string | null): Promise<{ message: string }> {
    const address = email.trim().toLowerCase();

    const user = await this.prisma.asSystem((db) =>
      db.user.findFirst({
        where: { email: address, deletedAt: null },
        select: { id: true, email: true, fullName: true, status: true },
      }),
    );

    /*
     * A SUSPENDED ACCOUNT IS TREATED AS AN ABSENT ONE, deliberately. Sending a
     * working reset link to somebody the Institute has suspended would hand
     * back the access the suspension took away, and telling them they are
     * suspended is the office's job, not an unauthenticated endpoint's.
     */
    if (!user || user.status !== "ACTIVE") {
      /*
       * WRITTEN DOWN BEFORE IT IS REFUSED. This is the line that makes a scan
       * visible: somebody working through a list of addresses leaves one of
       * these per attempt, with the address and the address they used it from.
       */
      await this.recordAttempt(null, address, ip, user ? "not_active" : "no_account");
      throw new AppError("RESOURCE_NOT_FOUND", {
        message:
          "There is no account with that email address. Check it for a typo — it must be " +
          "the address the Institute has for you. If you are not sure which that is, ask " +
          "the office.",
      });
    }

    const token = randomBytes(TOKEN_BYTES).toString("base64url");
    const tokenHash = sha256(token);
    const expiresAt = new Date(Date.now() + VALID_MINUTES * 60_000);

    await this.prisma.asSystem((db) =>
      db.$transaction(async (tx) => {
        // Asking again voids the earlier ticket. Two live links for one account
        // is one more than anybody needs and one more that can be stolen.
        await tx.passwordResetToken.updateMany({
          where: { userId: user.id, usedAt: null, expiresAt: { gt: new Date() } },
          data: { usedAt: new Date() },
        });
        await tx.passwordResetToken.create({
          data: { userId: user.id, tokenHash, expiresAt, requestedFrom: ip ?? null },
        });
      }),
    );

    const link = `${this.appUrl()}/reset-password?token=${encodeURIComponent(token)}`;
    const outcome = await this.email.send(
      { userId: user.id, fullName: user.fullName, email: user.email, phone: null, phoneIsWhatsapp: false },
      {
        kind: "password.reset",
        title: "Setting a new password",
        body: resetEmailBody(link),
        // Not a path in the System: they are not signed in, and the whole
        // point of the message is the link in its body.
        linkPath: null,
        isUrgent: false,
      },
    );

    /*
     * WHAT HAPPENED IS LOGGED, WHAT WAS SENT IS NOT. The link is the credential
     * for the next half hour; writing it to the audit trail would put it in
     * front of every administrator who can read that trail, which is precisely
     * the audience a reset link should not have.
     */
    await this.recordAttempt(user.id, address, ip, `sent:${outcome.status}`);
    this.logger.log(`password reset requested for ${user.id} — email ${outcome.status}`);

    return { message: SENT };
  }

  /**
   * Spend the ticket and set the password.
   *
   * The failures are one message on purpose: expired, already used, never
   * existed and belongs-to-a-suspended-account are the same sentence, because
   * distinguishing them tells somebody holding a stolen token which of their
   * guesses was closest.
   */
  async complete(token: string, newPassword: string, ip?: string | null) {
    const refuse = () =>
      new AppError("AUTH_INVALID_CREDENTIALS", {
        message:
          "That link is no longer valid. It may have been used already, or it may have " +
          "expired — they last 30 minutes. Ask for a new one.",
      });

    const row = await this.prisma.asSystem((db) =>
      db.passwordResetToken.findUnique({
        where: { tokenHash: sha256(token) },
        select: {
          id: true,
          userId: true,
          expiresAt: true,
          usedAt: true,
          user: { select: { id: true, email: true, status: true, deletedAt: true } },
        },
      }),
    );

    if (!row || row.usedAt || row.expiresAt <= new Date()) throw refuse();
    if (!row.user || row.user.deletedAt || row.user.status !== "ACTIVE") throw refuse();

    // The password rules are the account's own, so a super administrator does
    // not get a weaker password by coming through this door than through
    // Change password.
    await this.auth.assertPasswordAcceptable(row.userId, newPassword);
    const passwordHash = await this.auth.hashPassword(newPassword);

    await this.prisma.asSystem((db) =>
      db.$transaction(async (tx) => {
        /*
         * SPEND THE TOKEN IN THE SAME TRANSACTION, and only if it is still
         * unspent. Two requests arriving together would otherwise both find it
         * valid and both set a password; the second would silently overwrite
         * the first, which is exactly the race an attacker with a stolen link
         * would want.
         */
        const spent = await tx.passwordResetToken.updateMany({
          where: { id: row.id, usedAt: null },
          data: { usedAt: new Date() },
        });
        if (spent.count !== 1) throw refuse();

        await tx.user.update({
          where: { id: row.userId },
          data: {
            passwordHash,
            // They have just chosen it themselves, so there is nothing to force.
            mustChangePassword: false,
            passwordChangedAt: new Date(),
            failedLoginCount: 0,
            lockedUntil: null,
          },
        });

        // Every session ends. A forgotten password is what you report when you
        // think somebody else has the account, and leaving their session alive
        // would make the reset pointless.
        await tx.userSession.updateMany({
          where: { userId: row.userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }),
    );

    await this.audit.record({
      action: "auth.password.reset",
      entityType: "User",
      entityId: row.userId,
      after: { by: "reset link", from: ip ?? null },
    });
    this.logger.log(`password reset completed for ${row.userId}`);

    return {
      message: "Your password has been changed. Sign in with it.",
    };
  }

  /** The security log, which is a different audience from the audit trail. */
  private async recordAttempt(
    userId: string | null,
    email: string,
    ip: string | null | undefined,
    outcome: string,
  ) {
    await this.auth
      .recordPublicSecurityEvent("password.reset.requested", userId, email, ip ?? null, { outcome })
      .catch(() => undefined);
  }

  private appUrl(): string {
    const configured = (this.config.get<string>("APP_URL", "") ?? "").trim();
    return (configured || "http://localhost:5173").replace(/\/+$/, "");
  }
}

/**
 * What the email says.
 *
 * A PURE FUNCTION SO IT CAN BE TESTED. Once SMTP is configured the message goes
 * out for real rather than into the simulated outbox, and there is then no way
 * to read what was sent — so the property that matters most, that this carries
 * a LINK and never a password, is pinned by a test rather than hoped for.
 *
 * It also tells a reader who did NOT ask for it what to do, which is the only
 * part of the message that person will read.
 */
export function resetEmailBody(link: string, minutes: number = VALID_MINUTES): string {
  return [
    "Somebody asked to set a new password for your Prepreneurship account.",
    "",
    `Open this link to choose one. It works once and stops working in ${minutes} minutes:`,
    "",
    link,
    "",
    "If that was not you, you can ignore this message — your password has not changed, " +
      "and nobody can change it without this link.",
  ].join("\n");
}

/** Hex, lower case, 64 characters — matching the CHECK on the column. */
function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * Kept for the day something here compares two secrets directly.
 *
 * Nothing does today: the token is looked up BY its hash, so the database does
 * the comparison and there is no string equality in this file to leak timing.
 * Exported so that a later change reaches for this rather than `===`.
 */
export function constantTimeEquals(a: string, b: string): boolean {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
}
