import { Injectable, Logger } from "@nestjs/common";
import { LoggedWhatsAppChannel } from "./logged.channel";
import { WhatsAppChannel } from "./whatsapp.channel";
import { EmailChannel } from "./email.channel";
import type { NotificationChannelAdapter } from "./notification.channel";

/**
 * ARC-046 — channels are selected by configuration, exactly as storage
 * providers (ARC-043) and classroom providers (ARC-028) are.
 *
 * Adding email or SMS means an adapter and one line here. Nothing else in the
 * System learns a channel exists, and no caller ever names one.
 */
@Injectable()
export class ChannelRegistry {
  private readonly logger = new Logger(ChannelRegistry.name);
  private readonly adapters = new Map<string, NotificationChannelAdapter>();

  /**
   * THE REAL ONE WHEN IT IS CONFIGURED, THE SIMULATOR WHEN IT IS NOT.
   *
   * Chosen once, here, rather than by every caller asking which they have. The
   * Institute supplies a token and a phone number id and messages begin
   * actually going out; supply neither and an Admin can still read what a
   * student WOULD have received on the Integrations screen, which is what the
   * simulator is for.
   *
   * The choice is logged at startup, because "did that message really send?"
   * is the first question anybody asks and the log should already answer it.
   */
  constructor(
    real: WhatsAppChannel,
    simulated: LoggedWhatsAppChannel,
    email: EmailChannel,
  ) {
    const whatsapp = real.isConfigured() ? real : simulated;
    this.adapters.set(whatsapp.channel, whatsapp);
    this.adapters.set(email.channel, email);

    this.logger.log(
      real.isConfigured()
        ? "WhatsApp is connected — messages will be sent through the Meta Cloud API."
        : "WhatsApp is not connected. Messages are simulated and readable on the Integrations screen.",
    );
  }

  get(channel: string): NotificationChannelAdapter | null {
    return this.adapters.get(channel) ?? null;
  }

  /** The channels that are actually usable, for the settings screen. */
  available(): Array<{ channel: string; configured: boolean }> {
    return [...this.adapters.values()].map((a) => ({
      channel: a.channel,
      configured: a.isConfigured(),
    }));
  }
}
