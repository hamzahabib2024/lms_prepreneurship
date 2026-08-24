import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type {
  DeliveryOutcome,
  NotificationChannelAdapter,
  OutboundMessage,
  Recipient,
} from "./notification.channel";

/**
 * WhatsApp, actually sent — the Meta Cloud API.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ONE RULE THAT DECIDES THIS WHOLE FILE.
 *
 * Meta opens a 24-HOUR CUSTOMER SERVICE WINDOW when a person messages your
 * number. Inside it you may send free text. Outside it you may send NOTHING
 * but a pre-approved TEMPLATE.
 *
 * Every message this System sends is outside that window. A student never
 * messages the Institute's WhatsApp number — they are told their attendance is
 * slipping, or that a fee is due, or that a mark has been released, and none of
 * those are replies to anything. So an adapter that posts `type: "text"`, which
 * is what the API's own first example shows, would be REFUSED by Meta for
 * essentially every recipient the Institute has.
 *
 * It would also fail in the most expensive way possible: silently and later.
 * The token works, the number is right, the first test message to the
 * developer's own phone succeeds — because THEY messaged the number to set it
 * up, so they are inside the window — and then every real student gets nothing.
 *
 * This adapter therefore sends a TEMPLATE by default and treats free text as
 * the exception. If no template is configured it REFUSES rather than falling
 * back to text, because a refusal that names the missing setting is worth more
 * than a send that quietly reaches nobody.
 *
 * WHAT THE INSTITUTE HAS TO DO ONCE. Create a template in the WhatsApp
 * Manager with two body parameters — the title and the message — wait for
 * Meta to approve it, and put its name in WHATSAPP_TEMPLATE_NAME. Everything
 * else here is already done.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** Meta's versioned Graph host. Pinned, so an upgrade is a decision. */
const GRAPH = "https://graph.facebook.com";

@Injectable()
export class WhatsAppChannel implements NotificationChannelAdapter {
  readonly channel = "WHATSAPP" as const;
  private readonly logger = new Logger(WhatsAppChannel.name);

  constructor(private readonly config: ConfigService) {}

  private token(): string {
    return this.config.get<string>("WHATSAPP_ACCESS_TOKEN", "").trim();
  }

  private phoneNumberId(): string {
    return this.config.get<string>("WHATSAPP_PHONE_NUMBER_ID", "").trim();
  }

  private version(): string {
    return this.config.get<string>("WHATSAPP_API_VERSION", "v21.0").trim();
  }

  private templateName(): string {
    return this.config.get<string>("WHATSAPP_TEMPLATE_NAME", "").trim();
  }

  private templateLanguage(): string {
    return this.config.get<string>("WHATSAPP_TEMPLATE_LANGUAGE", "en").trim();
  }

  /**
   * BOTH HALVES, because one without the other sends nothing.
   *
   * A token with no phone number id has nowhere to post; a number id with no
   * token cannot authenticate. Reporting configured on either alone would put
   * the failure at send time, one message at a time, in a delivery log.
   */
  isConfigured(): boolean {
    return this.token() !== "" && this.phoneNumberId() !== "";
  }

  canReach(recipient: Recipient): boolean {
    return recipient.phone !== null && recipient.phoneIsWhatsapp;
  }

  async send(recipient: Recipient, message: OutboundMessage): Promise<DeliveryOutcome> {
    if (!this.canReach(recipient)) {
      return { status: "SUPPRESSED", detail: "No WhatsApp number on record for this user." };
    }
    if (!this.isConfigured()) {
      return {
        status: "SUPPRESSED",
        detail: "WhatsApp is not connected. Set WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID.",
      };
    }

    const template = this.templateName();
    if (!template) {
      /*
       * REFUSED, NOT DOWNGRADED TO TEXT. See the note at the top: text outside
       * the 24-hour window is rejected by Meta for every recipient who has not
       * messaged the Institute first, which is all of them. Falling back would
       * turn a clear configuration error into a delivery log full of failures
       * nobody can explain.
       */
      return {
        status: "SUPPRESSED",
        detail:
          "No approved WhatsApp template is configured. Meta only accepts template messages " +
          "outside a 24-hour reply window, and students never message the Institute first — " +
          "so set WHATSAPP_TEMPLATE_NAME to an approved template with two body parameters.",
      };
    }

    const to = toE164(recipient.phone as string);
    if (!to) {
      return { status: "SUPPRESSED", detail: "That number is not in a form WhatsApp accepts." };
    }

    const url = `${GRAPH}/${this.version()}/${this.phoneNumberId()}/messages`;
    const body = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "template",
      template: {
        name: template,
        language: { code: this.templateLanguage() },
        components: [
          {
            type: "body",
            /*
             * TWO PARAMETERS, IN THIS ORDER, and the Institute's approved
             * template must expect exactly that: {{1}} the title, {{2}} the
             * message. Newlines are flattened because Meta rejects a body
             * parameter containing them, which is a rejection that reads as
             * "invalid parameter" and takes an afternoon to trace.
             */
            parameters: [
              { type: "text", text: flatten(message.title, 60) },
              { type: "text", text: flatten(message.body, 900) },
            ],
          },
        ],
      },
    };

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.token()}`,
        },
        body: JSON.stringify(body),
        // A notification is not worth holding a request open for. Meta is
        // normally sub-second; ten seconds means something is wrong.
        signal: AbortSignal.timeout(10_000),
      });

      const json = (await res.json().catch(() => null)) as {
        messages?: Array<{ id: string }>;
        error?: { message?: string; code?: number; error_subcode?: number; type?: string };
      } | null;

      if (!res.ok) {
        const err = json?.error;
        /*
         * SEC-PRV — the log records that a message failed and why, never its
         * contents. A notification body can carry a mark or an attendance
         * warning, and a delivery log is read by more people than the message.
         */
        this.logger.warn(
          JSON.stringify({
            event: "whatsapp.send_failed",
            kind: message.kind,
            recipientId: recipient.userId,
            status: res.status,
            code: err?.code,
            subcode: err?.error_subcode,
          }),
        );
        return { status: "FAILED", detail: explain(res.status, err) };
      }

      const id = json?.messages?.[0]?.id ?? null;
      this.logger.log(
        JSON.stringify({
          event: "whatsapp.sent",
          kind: message.kind,
          recipientId: recipient.userId,
          messageId: id,
        }),
      );
      // The provider's own id, so a query to Meta about one message can be
      // answered from the delivery log rather than from memory.
      return { status: "SENT", detail: id ?? "Accepted by WhatsApp." };
    } catch (e) {
      const timedOut = e instanceof Error && e.name === "TimeoutError";
      return {
        status: "FAILED",
        detail: timedOut
          ? "WhatsApp did not answer within ten seconds."
          : `WhatsApp could not be reached: ${e instanceof Error ? e.message : "unknown error"}`,
      };
    }
  }
}

/**
 * Meta wants digits — country code first, no plus, no spaces.
 *
 * The Institute stores E.164 already (`+923001234567`), so this is mostly a
 * strip. It returns null rather than guessing for anything that does not look
 * like an international number: a local `0300…` sent as-is would be delivered
 * to somebody in another country, or to nobody, and both are worse than a
 * suppression that says so.
 */
export function toE164(raw: string): string | null {
  const digits = raw.replace(/[^\d+]/g, "");
  if (!digits.startsWith("+")) return null;
  const bare = digits.slice(1);
  // Shortest national numbers are 8 digits with a 1-digit country code; the
  // E.164 ceiling is 15.
  if (bare.length < 8 || bare.length > 15) return null;
  return bare;
}

/** One line, bounded. Meta rejects a body parameter with a newline in it. */
export function flatten(text: string, max: number): string {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length <= max ? one : `${one.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Meta's error, in words the Institute can act on.
 *
 * The raw message is kept on the end because it is occasionally the only thing
 * that identifies which of several possible causes it is — but the sentence in
 * front of it is the one somebody reads first.
 */
export function explain(status: number, err?: { message?: string; code?: number }): string {
  const raw = err?.message ? ` (${err.message})` : "";
  switch (err?.code) {
    case 190:
      return `The WhatsApp access token is invalid or has expired. Generate a new one in the Meta Business account.${raw}`;
    case 100:
      return `WhatsApp refused the request. Usually the template name or its language does not match an approved template.${raw}`;
    case 131_030:
      return `That number is not on the allow-list for this WhatsApp app. A test number can only message numbers you have added.${raw}`;
    case 131_047:
      return `Outside the 24-hour reply window, so only an approved template can be sent to this person.${raw}`;
    case 131_026:
      return `That number cannot receive WhatsApp messages.${raw}`;
    case 4:
    case 80_007:
      return `WhatsApp is rate-limiting this account. The message was not sent.${raw}`;
    default:
      if (status === 401 || status === 403) {
        return `WhatsApp rejected the credentials.${raw}`;
      }
      return `WhatsApp refused the message (HTTP ${status}).${raw}`;
  }
}
