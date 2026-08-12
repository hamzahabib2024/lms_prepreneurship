import { Injectable, Logger } from "@nestjs/common";
import { LoggedWhatsAppChannel } from "./logged.channel";
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

  constructor(whatsapp: LoggedWhatsAppChannel, email: EmailChannel) {
    this.adapters.set(whatsapp.channel, whatsapp);
    this.adapters.set(email.channel, email);
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
