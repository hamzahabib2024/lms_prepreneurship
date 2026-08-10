import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type {
  DeliveryOutcome,
  NotificationChannelAdapter,
  OutboundMessage,
  Recipient,
} from "./notification.channel";

/**
 * The WhatsApp channel, standing in until DEP-04 is resolved.
 *
 * It implements the real contract and records a real delivery row; it simply
 * writes the message to the log instead of handing it to Meta. That is
 * deliberate, and it is not the same as doing nothing:
 *
 *   - the whole pipeline runs today. Preferences, quiet hours, muting, the
 *     delivery record and the inbox are all exercised, so when credentials
 *     arrive the only untested code is the HTTP call itself
 *   - it refuses honestly. A student with no WhatsApp number is SUPPRESSED
 *     with a reason, exactly as the real adapter will do, rather than being
 *     reported as delivered
 *
 * It never claims SENT. A stand-in that reported success would make the
 * delivery log a record of messages nobody received, which is worse than an
 * empty log — somebody would trust it.
 */
@Injectable()
export class LoggedWhatsAppChannel implements NotificationChannelAdapter {
  readonly channel = "WHATSAPP" as const;
  private readonly logger = new Logger(LoggedWhatsAppChannel.name);

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    // The real adapter will require a token and a phone number id. Until those
    // exist this reports false, and the registry records SUPPRESSED rather
    // than pretending.
    return this.config.get<string>("WHATSAPP_ACCESS_TOKEN", "") !== "";
  }

  canReach(recipient: Recipient): boolean {
    return recipient.phone !== null && recipient.phoneIsWhatsapp;
  }

  send(recipient: Recipient, message: OutboundMessage): Promise<DeliveryOutcome> {
    if (!this.canReach(recipient)) {
      return Promise.resolve({
        status: "SUPPRESSED",
        detail: "No WhatsApp number on record for this user.",
      });
    }

    // SEC-PRV — the log records that a message went out and to whom, never its
    // contents. A notification body can carry a mark or an attendance warning.
    this.logger.log(
      JSON.stringify({
        event: "notification.would_send",
        channel: this.channel,
        kind: message.kind,
        recipientId: recipient.userId,
        urgent: message.isUrgent,
      }),
    );

    return Promise.resolve({
      status: "SUPPRESSED",
      detail:
        "WhatsApp is not configured yet (DEP-04). The message is in the recipient's inbox.",
    });
  }
}
