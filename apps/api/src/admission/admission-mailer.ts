import { Injectable, Logger } from "@nestjs/common";
import { EmailChannel } from "../notification/channel/email.channel";

/**
 * The two emails an applicant receives — FR-REG-018, FR-REG-042.
 *
 * SENT DIRECTLY, NOT THROUGH THE NOTIFICATION SERVICE, and both reasons matter.
 *
 *   AN APPLICANT HAS NO ACCOUNT. NotificationService.notify() takes user ids
 *   and writes an inbox row against each; at the moment somebody applies there
 *   is no user to write against. The tracking reference has to reach an email
 *   address, not a person the System knows.
 *
 *   A TEMPORARY PASSWORD MUST NOT BE STORED. Every notification writes a row
 *   holding its own text, and that row outlives the password's usefulness by
 *   years — readable by anybody who later reaches that inbox, including an
 *   administrator impersonating the student (SEC-AUZ-013). A password belongs
 *   in exactly one place, in transit, to one address.
 *
 * NEITHER SEND CAN FAIL THE THING IT FOLLOWS. An application that was accepted
 * has been accepted whether or not the mail server answered, and a student
 * whose account was created has an account. Both callers get told what
 * happened so the screen can say so, and the administrator is still shown the
 * password on screen (FR-REG-042) precisely because delivery is not certain.
 */
@Injectable()
export class AdmissionMailer {
  private readonly logger = new Logger(AdmissionMailer.name);

  constructor(private readonly email: EmailChannel) {}

  /** FR-REG-018 — the reference they use to ask what is happening. */
  async sendTrackingReference(input: {
    to: string;
    fullName: string;
    trackingRef: string;
    programmeName?: string;
    /** The page that answers "what is happening with my application". */
    trackUrl?: string;
  }): Promise<{ sent: boolean; detail: string }> {
    const body = [
      `Thank you for applying to ${this.instituteName()}.`,
      "",
      `Your reference is ${input.trackingRef}.`,
      "",
      // The programme line AND the blank line after it, or neither. Filtering
      // only the line left a double gap in every message, because no
      // programme name is ever passed here today.
      ...(input.programmeName ? [`Programme: ${input.programmeName}`, ""] : []),
      "Keep this reference. You can use it to check what is happening with your",
      "application at any time, and you will need it if you contact the office.",
      "",
      // The link, when there is one. A message that says "you can check at any
      // time" and names nowhere to check is the reason people telephone the
      // office instead — which is the cost FR-REG-020 exists to remove.
      ...(input.trackUrl
        ? ["Check your application here:", "", `  ${input.trackUrl}`, ""]
        : []),
      "We review payment slips within 48 hours. We will write to you again with",
      "the outcome — there is nothing you need to do until then.",
    ]
      .filter((l) => l !== null)
      .join("\n");

    return this.send(input.to, input.fullName, {
      kind: "registration.received",
      title: `Your application reference is ${input.trackingRef}`,
      body,
    });
  }

  /**
   * FR-REG-042 — the credentials, once.
   *
   * The password is in the body and nowhere else: not in the audit log, not in
   * an inbox row, not in this service's own log line below.
   */
  async sendCredentials(input: {
    to: string;
    fullName: string;
    registrationNo: string;
    temporaryPassword: string;
    signInUrl: string;
  }): Promise<{ sent: boolean; detail: string }> {
    const body = [
      `Congratulations ${input.fullName} — your place at ${this.instituteName()} is confirmed.`,
      "",
      `Your registration number is ${input.registrationNo}. It is permanent, and`,
      "you will be asked for it whenever you contact the office.",
      "",
      "To sign in for the first time:",
      "",
      `  Address:  ${input.signInUrl}`,
      `  Email:    ${input.to}`,
      `  Password: ${input.temporaryPassword}`,
      "",
      "You will be asked to choose your own password immediately. This temporary",
      "one stops working as soon as you do, so it cannot be used by anybody who",
      "reads this message later.",
      "",
      "If you did not apply to us, please tell the office at once and do not sign in.",
    ].join("\n");

    return this.send(input.to, input.fullName, {
      kind: "registration.approved",
      title: `Welcome to ${this.instituteName()} — your sign-in details`,
      body,
    });
  }

  /**
   * FR-REG-035 — "we need something else from you", to the person who can
   * supply it.
   *
   * An application parked in NEEDS_INFO while nobody tells the applicant is an
   * application that never moves: they are waiting for us and we are waiting
   * for them. The reference is repeated because it is what the office will ask
   * for when they reply.
   */
  async sendInfoRequest(input: {
    to: string;
    fullName: string;
    trackingRef: string;
    message: string;
  }): Promise<{ sent: boolean; detail: string }> {
    const body = [
      `Dear ${input.fullName},`,
      "",
      `We are reviewing your application (${input.trackingRef}) and need one more`,
      "thing from you before we can finish:",
      "",
      input.message,
      "",
      "Please reply to this message, or contact the office and quote your",
      `reference ${input.trackingRef}. Your application is being held for you`,
      "meanwhile — nothing you have already sent us has been lost.",
    ].join("\n");

    return this.send(input.to, input.fullName, {
      kind: "registration.needs-info",
      title: `We need one more thing — ${input.trackingRef}`,
      body,
    });
  }

  /**
   * FR-REG-033/034/046 — the answer nobody wants, given plainly.
   *
   * THE REASON IS TRANSLATED, NOT PRINTED. `SLIP_ILLEGIBLE` is a value the
   * office chose from a list; a person reading it on their phone learns
   * nothing and cannot act. Several of these are fixable in an afternoon —
   * a clearer photograph, the right amount — so the message says which, and
   * says the application can be made again. BR-REG-11 keeps the evidence, so
   * reapplying is genuinely open to them.
   */
  async sendRejection(input: {
    to: string;
    fullName: string;
    trackingRef: string;
    reasonCode: string;
    note?: string | null;
  }): Promise<{ sent: boolean; detail: string }> {
    const REASONS: Record<string, string> = {
      PAYMENT_NOT_RECEIVED:
        "We could not find your payment in the bank record. If you have paid, please apply again and attach the slip showing the transaction reference.",
      AMOUNT_INSUFFICIENT:
        "The amount received was less than the fee for this programme. You are welcome to apply again once the balance is paid.",
      SLIP_ILLEGIBLE:
        "We could not read the payment slip you sent. A clearer photograph, with the date and amount visible, is all we need — please apply again.",
      DUPLICATE_APPLICATION:
        "We already hold an application from you, so this one has been closed. The first one is still being reviewed.",
      INELIGIBLE: "This programme's entry requirements were not met.",
      SECTION_FULL:
        "The class you chose filled before your application was reviewed. Other classes may still have places — please apply again and choose another.",
      OTHER: "",
    };

    const body = [
      `Dear ${input.fullName},`,
      "",
      `We are sorry to tell you that your application (${input.trackingRef}) has not`,
      "been accepted.",
      "",
      REASONS[input.reasonCode] || "",
      input.note ? `\n${input.note}` : "",
      "",
      "If you believe this is a mistake, contact the office and quote your",
      `reference ${input.trackingRef}. Everything you sent us has been kept.`,
    ]
      .filter((l) => l !== "")
      .join("\n");

    return this.send(input.to, input.fullName, {
      kind: "registration.rejected",
      title: `About your application — ${input.trackingRef}`,
      body,
    });
  }

  private instituteName(): string {
    return process.env["INSTITUTE_NAME"]?.trim() || "the Institute";
  }

  /**
   * One place, so both messages fail the same way.
   *
   * The recipient shape the channel expects describes a USER; an applicant is
   * not one yet, so the id is a marker rather than a lie about a row that
   * exists. Only the address and the name are used to send.
   */
  private async send(
    to: string,
    fullName: string,
    message: { kind: string; title: string; body: string },
  ): Promise<{ sent: boolean; detail: string }> {
    try {
      const outcome = await this.email.send(
        {
          userId: "applicant",
          fullName,
          email: to,
          phone: null,
          phoneIsWhatsapp: false,
        },
        { ...message, linkPath: null, isUrgent: false },
      );
      // The address is logged, never the body — one of these carries a
      // password and the other a reference somebody could use to impersonate
      // an applicant to the office.
      this.logger.log(
        JSON.stringify({ event: "admission.email", kind: message.kind, status: outcome.status }),
      );
      return { sent: outcome.status === "SENT", detail: outcome.detail };
    } catch (err) {
      // Swallowed on purpose: see the note at the top. An application that was
      // accepted has been accepted.
      const detail = err instanceof Error ? err.message : "The mailer raised an unknown error.";
      this.logger.warn(`Admission email (${message.kind}) failed: ${detail}`);
      return { sent: false, detail };
    }
  }
}
