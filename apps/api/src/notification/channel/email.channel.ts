import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createTransport, type Transporter } from "nodemailer";
import { SimulatedOutbox } from "../../integration/simulated-outbox";
import type {
  DeliveryOutcome,
  NotificationChannelAdapter,
  OutboundMessage,
  Recipient,
} from "./notification.channel";

/**
 * Email — ARC-046, and the channel that needs no third-party account at all.
 *
 * SMTP, NOT THE GMAIL API. Gmail is reachable over SMTP with an app password,
 * and so is every other mail provider the Institute might move to. Using the
 * Gmail API instead would mean an OAuth consent flow, a Google Cloud project
 * and a service account — the same DEP-01 dependency that has blocked Drive
 * for months — to send a message that plain SMTP sends today. Nothing below
 * names Gmail; it is one host in a setting.
 *
 * WHY THIS MATTERS MORE THAN A THIRD CHANNEL. Until now the only way a new
 * account's temporary password reached its owner was an administrator reading
 * it off the screen and telling them. That works for eight students in a room
 * and fails completely for a cohort of a hundred, and it means the password
 * travels by whatever the administrator happens to use — a WhatsApp message
 * that stays in the chat history for good.
 *
 * IT NEVER CLAIMS SENT WITHOUT SENDING. Unconfigured, it reports SUPPRESSED and
 * writes to the simulator outbox exactly as the WhatsApp channel does, so the
 * wording can be read and proofread before the Institute has a mailbox.
 */
@Injectable()
export class EmailChannel implements NotificationChannelAdapter {
  readonly channel = "EMAIL" as const;
  private readonly logger = new Logger(EmailChannel.name);
  private transport: Transporter | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly outbox: SimulatedOutbox,
  ) {}

  private get host(): string {
    return (this.config.get<string>("SMTP_HOST", "") ?? "").trim();
  }
  private get user(): string {
    return (this.config.get<string>("SMTP_USER", "") ?? "").trim();
  }
  private get pass(): string {
    // Trimmed at the ENDS ONLY, and the distinction is deliberate. Google
    // shows an App Password as four groups of four, and people paste it that
    // way — Gmail's SMTP accepts the spaces, so they are left alone rather
    // than stripped, because some other provider's password may legitimately
    // contain one. A trailing newline or space from a .env edit is never
    // intentional and is the far more common fault.
    return (this.config.get<string>("SMTP_PASSWORD", "") ?? "").trim();
  }

  /**
   * The address a recipient sees, falling back to the account itself.
   *
   * MAIL_FROM, not SMTP_FROM. The key was already in .env.example, declared
   * and read by nothing; adding a second one beside it is how a deployment
   * ends up with two almost-identical settings and an hour spent finding out
   * which is live.
   */
  private get from(): string {
    const configured = (this.config.get<string>("MAIL_FROM", "") ?? "").trim();
    if (configured) return configured;
    const name = (this.config.get<string>("INSTITUTE_NAME", "") ?? "").trim();
    return name ? `"${name}" <${this.user}>` : this.user;
  }

  isConfigured(): boolean {
    // MAIL_DRIVER=log is an explicit "do not send", and it wins over having
    // credentials. It exists for the case that matters in development: real
    // SMTP settings in .env and a database full of real-looking students, one
    // announcement away from mailing thirty people by accident.
    if ((this.config.get<string>("MAIL_DRIVER", "") ?? "").trim().toLowerCase() === "log") {
      return false;
    }
    // All three, because two of them is a misconfiguration that fails at the
    // first send rather than at startup — and the first send is a real message
    // to a real student.
    return this.host !== "" && this.user !== "" && this.pass !== "";
  }

  canReach(recipient: Recipient): boolean {
    return typeof recipient.email === "string" && recipient.email.includes("@");
  }

  /**
   * Built once, lazily.
   *
   * nodemailer pools connections, so rebuilding per message would open a TLS
   * handshake for every recipient in a cohort announcement.
   */
  private get mailer(): Transporter {
    if (!this.transport) {
      const port = Number(this.config.get<string>("SMTP_PORT", "587"));
      this.transport = createTransport({
        host: this.host,
        port,
        // 465 is implicit TLS; 587 upgrades with STARTTLS. Deriving this from
        // the port rather than asking for a boolean removes the combination
        // that silently sends credentials in the clear.
        secure: port === 465,
        auth: { user: this.user, pass: this.pass },
        /*
         * TIMEOUTS, BECAUSE NODEMAILER'S DEFAULTS ARE MEANT FOR A BATCH JOB.
         *
         * Out of the box it waits two minutes to connect and TEN MINUTES on a
         * silent socket. That is a reasonable default for something running
         * unattended overnight and completely wrong for a request somebody is
         * sitting in front of: one stalled send would hold a cohort import
         * open past every proxy and browser timeout in the chain, and the
         * screen would simply stop.
         *
         * These are generous against the measured cost — a Gmail handshake
         * here is about 1.4 seconds and a full send about 3 — while bounding
         * the failure at seconds instead of minutes.
         */
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 20_000,
        /*
         * POOLED, which is what makes a cohort import bearable.
         *
         * Without a pool nodemailer opens a fresh connection per message, and
         * the TLS handshake is most of the cost — about 1.4 seconds of the 3
         * a message takes here. Twelve students sent one after another is
         * thirty-seven seconds; the same twelve over five pooled connections
         * is about nine, measured.
         *
         * FIVE, not fifty. The reason the import used to send one at a time
         * was a real one — firing hundreds at once is how a Gmail account
         * earns a temporary block that looks exactly like the integration
         * being broken. Five concurrent connections is ordinary client
         * behaviour and nowhere near that line.
         */
        pool: true,
        maxConnections: 5,
      });
    }
    return this.transport;
  }

  async send(recipient: Recipient, message: OutboundMessage): Promise<DeliveryOutcome> {
    if (!this.canReach(recipient)) {
      return { status: "SUPPRESSED", detail: "No email address on record for this user." };
    }

    if (!this.isConfigured()) {
      this.outbox.record({
        at: new Date(),
        channel: this.channel,
        kind: message.kind,
        recipientName: recipient.fullName,
        destination: recipient.email,
        title: message.title,
        body: message.body,
        isUrgent: message.isUrgent,
      });
      const held =
        (this.config.get<string>("MAIL_DRIVER", "") ?? "").trim().toLowerCase() === "log"
          ? "MAIL_DRIVER is set to log, so nothing is sent even though SMTP may be configured."
          : "Email is not configured (SMTP_HOST, SMTP_USER, SMTP_PASSWORD).";
      return {
        status: "SUPPRESSED",
        detail: `${held} The message is in the recipient's inbox, and its wording is in the simulator outbox.`,
      };
    }

    try {
      const info = await this.mailer.sendMail({
        from: this.from,
        to: recipient.email,
        subject: message.title,
        text: this.plainText(recipient, message),
        // Only when there are any. nodemailer accepts an empty array, but
        // passing one makes every ordinary message a multipart one for no
        // reason, and multipart mail with no parts is what some filters score
        // against.
        ...(message.attachments?.length
          ? {
              attachments: message.attachments.map((a) => ({
                filename: a.filename,
                contentType: a.contentType,
                content: a.content,
              })),
            }
          : {}),
      });
      // The provider's id, so a delivery can be traced in the mail logs later.
      return { status: "SENT", detail: `Accepted by the mail server (${info.messageId}).` };
    } catch (err) {
      // SEC-PRV — the reason is recorded, never the message. A bounce detail
      // can quote the subject line, which may carry a mark or a balance.
      const reason = err instanceof Error ? err.message : "unknown error";
      this.logger.warn(
        JSON.stringify({ event: "email.failed", kind: message.kind, recipientId: recipient.userId }),
      );
      return { status: "FAILED", detail: `The mail server refused it: ${reason}`.slice(0, 300) };
    }
  }

  /**
   * Plain text, deliberately.
   *
   * An HTML mail needs a plain-text alternative anyway, renders differently in
   * every client, and is the format phishing filters distrust most. These are
   * four short lines telling somebody something happened and where to look;
   * they do not need a layout.
   */
  private plainText(recipient: Recipient, message: OutboundMessage): string {
    const base = (this.config.get<string>("PUBLIC_WEB_URL", "") ?? "").replace(/\/+$/, "");
    const link = message.linkPath && base ? `${base}${message.linkPath}` : null;

    return [
      `Dear ${recipient.fullName},`,
      "",
      message.body,
      ...(link ? ["", link] : []),
      "",
      "— " + (this.config.get<string>("INSTITUTE_NAME", "") || "The Institute"),
      "",
      "This message was sent automatically. Please do not reply to it.",
    ].join("\n");
  }
}
