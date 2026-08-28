import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { EmailChannel } from "./channel/email.channel";

/**
 * The one email that carries a password — FR-REG-042, FR-USR-012, FR-OPS-026.
 *
 * WHY THIS IS NOT PART OF THE NOTIFICATION SERVICE. Every notification writes
 * an inbox row holding its own text, and that row outlives the password's
 * usefulness by years — readable by anybody who later reaches that inbox,
 * including an administrator impersonating the student (SEC-AUZ-013). A
 * temporary password belongs in exactly one place: in transit, to one address.
 *
 * WHY IT IS SHARED. Four places in the System mint a temporary password:
 *
 *   admission approval        → emailed (it always was)
 *   cohort import             → NOT emailed, until now
 *   an administrator creating an account → NOT emailed, until now
 *   an administrator resetting a password → NOT emailed, until now
 *
 * The last three returned the password to the administrator's screen and
 * stopped there. For eight students in a room that works. For the hundred-row
 * cohort import those three exist to serve, it means an operator copying a
 * hundred passwords out of a CSV and relaying them by hand — so in practice
 * they travel by WhatsApp, where they stay in the chat history for good, or
 * they do not travel at all and the accounts are never used.
 *
 * IT NEVER FAILS THE THING IT FOLLOWS. An account that was created has been
 * created whether or not the mail server answered. Every caller is told what
 * happened so the screen can say so, and the password is STILL shown on screen
 * precisely because delivery is not certain.
 */
@Injectable()
export class CredentialsMailer {
  private readonly logger = new Logger(CredentialsMailer.name);

  constructor(
    private readonly email: EmailChannel,
    private readonly config: ConfigService,
  ) {}

  /** Is there any point trying? Lets a caller skip the round trip entirely. */
  get canSend(): boolean {
    return this.email.isConfigured();
  }

  /**
   * The address the Institute is actually reachable at.
   *
   * PUBLIC_WEB_URL first, then WEB_ORIGIN, then localhost. The fallback chain
   * is the fix for a real defect: PUBLIC_WEB_URL is set by docker-compose and
   * by nothing else, so an Institute running the API any other way emailed
   * every new student a sign-in link to `http://localhost:5173` — an address
   * that means "this student's own computer" and works for nobody. WEB_ORIGIN
   * is already set in every deployment because CORS does not work without it,
   * so it is the honest second choice.
   */
  signInUrl(): string {
    const configured =
      (this.config.get<string>("PUBLIC_WEB_URL", "") ?? "").trim() ||
      // WEB_ORIGIN may be a comma-separated list; the first is the canonical one.
      ((this.config.get<string>("WEB_ORIGIN", "") ?? "").split(",")[0] ?? "").trim();
    return (configured || "http://localhost:5173").replace(/\/+$/, "");
  }

  instituteName(): string {
    return (this.config.get<string>("INSTITUTE_NAME", "") ?? "").trim() || "the Institute";
  }

  /**
   * A brand-new account — FR-REG-042, FR-OPS-026.
   *
   * `registrationNo` is present for a student and absent for a teacher or an
   * administrator, who have no such number. Saying "your registration number
   * is undefined" to a new teacher is the kind of detail that makes a System
   * look untended.
   */
  async sendNewAccount(input: {
    to: string;
    fullName: string;
    temporaryPassword: string;
    registrationNo?: string | null;
    /** "student" | "teacher" | "administrator" — what to call them. */
    roleLabel?: string;
  }): Promise<{ sent: boolean; detail: string }> {
    const institute = this.instituteName();
    const body = [
      `Dear ${input.fullName},`,
      "",
      input.registrationNo
        ? `An account has been created for you at ${institute}.`
        : `An account has been created for you at ${institute}${
            input.roleLabel ? ` as a ${input.roleLabel}` : ""
          }.`,
      "",
      ...(input.registrationNo
        ? [
            `Your registration number is ${input.registrationNo}. It is permanent, and you`,
            "will be asked for it whenever you contact the office.",
            "",
          ]
        : []),
      "To sign in for the first time:",
      "",
      `  Address:  ${this.signInUrl()}`,
      `  Email:    ${input.to}`,
      `  Password: ${input.temporaryPassword}`,
      "",
      "You will be asked to choose your own password immediately. This temporary",
      "one stops working as soon as you do, so it cannot be used by anybody who",
      "reads this message later.",
      "",
      "If you were not expecting this, please tell the office at once and do not sign in.",
    ].join("\n");

    return this.send(input.to, input.fullName, {
      kind: "account.created",
      // PHRASED SO THE FALLBACK STILL READS. `instituteName()` returns "the
      // Institute" when INSTITUTE_NAME is unset, and "Your the Institute
      // account" is what a possessive construction makes of that. The name
      // goes after a preposition, where both a real name and the fallback fit.
      title: `Your sign-in details for ${institute}`,
      body,
    });
  }

  /**
   * An existing student, added to another course — FR-REG-042's other half.
   *
   * THE MESSAGE THAT USED TO NOT EXIST. Both places that can enrol somebody who
   * is already a student — an admission approval and a cohort import — sent
   * them nothing whatsoever. The reasoning was right about the password and
   * wrong about the silence: their account genuinely was not touched, so the
   * credentials mail would have been a lie, but a person who has just paid a
   * fee and attached a slip hearing nothing back cannot tell that from their
   * application having been lost.
   *
   * IT CARRIES NO PASSWORD, AND SAYS SO IN WORDS. The likeliest thing this
   * student does otherwise is wait for a temporary password that is never
   * coming, then ring the office to ask where it is — which is the support call
   * the message exists to prevent, not cause.
   */
  async sendCourseAdded(input: {
    to: string;
    fullName: string;
    sectionName: string;
    registrationNo?: string | null;
  }): Promise<{ sent: boolean; detail: string }> {
    const institute = this.instituteName();
    const body = [
      `Good news ${input.fullName} — you are enrolled in ${input.sectionName}.`,
      "",
      `You are already a student at ${institute}, so nothing about your account`,
      "has changed.",
      "",
      ...(input.registrationNo
        ? [`  Your registration number stays ${input.registrationNo}.`]
        : []),
      `  Sign in at ${this.signInUrl()} with your EXISTING email and password.`,
      "",
      "There is no new password. We have not sent you one and you do not need",
      "one — use the same details you already sign in with. If you have",
      "forgotten them, use 'Forgot password' on the sign-in page.",
      "",
      "The new course appears on your dashboard alongside the one you are",
      "already taking.",
      "",
      "If you did not ask to join this course, tell the office at once.",
    ].join("\n");

    return this.send(input.to, input.fullName, {
      kind: "registration.course-added",
      title: `You are enrolled in ${input.sectionName}`,
      body,
    });
  }

  /**
   * FR-USR-012 — somebody's password was reset for them.
   *
   * DELIBERATELY DIFFERENT WORDING from a new account. A reset ends every
   * session the person held, so the first thing they experience is being
   * signed out with no explanation. The message says why, and says what to do
   * if it was not expected — a silent reset is indistinguishable from an
   * account takeover, and is exactly what one looks like.
   */
  async sendPasswordReset(input: {
    to: string;
    fullName: string;
    temporaryPassword: string;
  }): Promise<{ sent: boolean; detail: string }> {
    const institute = this.instituteName();
    const body = [
      `Dear ${input.fullName},`,
      "",
      `Your password for ${institute} has been reset by the office, and you have`,
      "been signed out everywhere. Nothing else about your account has changed.",
      "",
      "To sign in again:",
      "",
      `  Address:  ${this.signInUrl()}`,
      `  Email:    ${input.to}`,
      `  Password: ${input.temporaryPassword}`,
      "",
      "You will be asked to choose a new password straight away, and this",
      "temporary one stops working the moment you do.",
      "",
      "IF YOU DID NOT ASK FOR THIS, contact the office immediately — somebody",
      "may be trying to reach your account.",
    ].join("\n");

    return this.send(input.to, input.fullName, {
      kind: "account.password-reset",
      title: `Your password for ${institute} has been reset`,
      body,
    });
  }

  /**
   * One place, so every credentials email fails the same way.
   *
   * The recipient shape the channel expects describes a USER, and here there
   * genuinely is one — but only the address and the name are used to send.
   */
  /**
   * A TICKET TO CHOOSE A PASSWORD — what a queued credentials email becomes.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * WHY IT IS NOT THE ORIGINAL PASSWORD. Because that is gone. A temporary
   * password is hashed the moment it is made and nobody, a Super Admin
   * included, can read one back — so a message held over until the mail
   * account recovers cannot possibly carry it. The alternatives were to store
   * the password in the queue, which quietly undoes that rule, or to mint a
   * new one, which would silently break the password the operator has already
   * read off the import screen and possibly relayed by hand.
   *
   * A ticket does neither, and is better than both:
   *
   *   · THE ORIGINAL STILL WORKS. Nothing anybody wrote down is invalidated.
   *     This is an additional way in, not a replacement.
   *   · IT IS NOT A CREDENTIAL. One use, thirty minutes. A password sitting in
   *     an inbox is neither of those things.
   *   · THE CLOCK STARTS NOW. Minted at the moment of sending, so a message
   *     that waited twenty hours for an allowance to return still arrives with
   *     its full validity rather than expired on delivery.
   *
   * It voids any earlier live ticket for the same person, exactly as asking
   * for a reset does: two live links for one account is one more than anybody
   * needs and one more that can be stolen.
   * ───────────────────────────────────────────────────────────────────────────
   */
  async sendSetPasswordLink(input: {
    to: string;
    fullName: string;
    registrationNo?: string | null;
    /**
     * A ticket already minted and stored by the caller.
     *
     * COMPOSING A MESSAGE AND ISSUING A CREDENTIAL ARE TWO JOBS, and this
     * class does the first. Handing it a database so it could do the second
     * would put a token-minting transaction inside the thing whose entire
     * responsibility is wording — and it showed immediately, as ten existing
     * tests that construct this class with a channel and a config and have no
     * business knowing about Prisma.
     */
    token: string;
  }): Promise<{ sent: boolean; detail: string }> {
    const institute = this.instituteName();
    const base = this.signInUrl().replace(/\/login$/, "");
    const link = `${base}/reset-password?token=${encodeURIComponent(input.token)}`;

    const body = [
      `${input.fullName}, your account at ${institute} is ready.`,
      "",
      ...(input.registrationNo
        ? [`  Your registration number is ${input.registrationNo}.`, ""]
        : []),
      "Choose your password here:",
      "",
      `  ${link}`,
      "",
      "That link works once and lasts thirty minutes. If it has expired by the",
      "time you use it, go to the sign-in page and choose 'Forgot password' —",
      "it will send you another.",
      "",
      "IF THE OFFICE ALREADY GAVE YOU A TEMPORARY PASSWORD, that still works.",
      "Use either. You will be asked to choose your own password on the way in.",
      "",
      "If you were not expecting this, please tell the office and do not use the link.",
    ].join("\n");

    return this.send(input.to, input.fullName, {
      kind: "account.set-password",
      title: `Choose your password for ${institute}`,
      body,
    });
  }

  private async send(
    to: string,
    fullName: string,
    message: { kind: string; title: string; body: string },
  ): Promise<{ sent: boolean; detail: string }> {
    try {
      const outcome = await this.email.send(
        { userId: "account", fullName, email: to, phone: null, phoneIsWhatsapp: false },
        { ...message, linkPath: null, isUrgent: false },
      );
      // The kind and the status, never the body — it carries a password.
      this.logger.log(
        JSON.stringify({ event: "credentials.email", kind: message.kind, status: outcome.status }),
      );
      return { sent: outcome.status === "SENT", detail: outcome.detail };
    } catch (err) {
      const detail = err instanceof Error ? err.message : "The mailer raised an unknown error.";
      this.logger.warn(`Credentials email (${message.kind}) failed: ${detail}`);
      return { sent: false, detail };
    }
  }
}
