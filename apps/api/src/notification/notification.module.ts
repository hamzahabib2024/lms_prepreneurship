import { Global, Module } from "@nestjs/common";
import { AnnouncementService } from "./announcement.service";
import { NotificationService } from "./notification.service";
import { TemplateService } from "./template.service";
import { NotificationController } from "./notification.controller";
import { ChannelRegistry } from "./channel/channel.registry";
import { LoggedWhatsAppChannel } from "./channel/logged.channel";
import { WhatsAppChannel } from "./channel/whatsapp.channel";
import { EmailChannel } from "./channel/email.channel";
import { CredentialsMailer } from "./credentials-mailer";
import { PendingEmailService } from "./pending-email.service";
import { EmailQueueController } from "./email-queue.controller";

/**
 * Global, because notifications are raised from everywhere — admission,
 * assessment, attendance — and threading this module through each of their
 * imports would make every one of them aware of the messaging layer.
 *
 * Adding a channel touches this file and one adapter beside it, exactly as
 * storage (ARC-043) and classroom providers (ARC-028) do.
 */
@Global()
@Module({
  controllers: [NotificationController, EmailQueueController],
  providers: [
    AnnouncementService,
    NotificationService,
    TemplateService,
    ChannelRegistry,
    LoggedWhatsAppChannel,
    WhatsAppChannel,
    EmailChannel,
    CredentialsMailer,
    PendingEmailService,
  ],
  // ChannelRegistry is exported so the integrations screen can ask the adapter
  // itself whether it is configured, rather than re-deriving that from the
  // environment. Two copies of "is WhatsApp set up" is how a status screen
  // starts reporting LIVE for a channel that is not.
  //
  // EmailChannel is exported for the ONE case that is not a notification:
  // admission writes to an address belonging to somebody who has no account
  // yet, and to a student whose first password must not be stored in an inbox
  // row that outlives it. Both go through the same adapter, so there is still
  // one place that knows how to reach a mail server.
  exports: [
    NotificationService,
    AnnouncementService,
    TemplateService,
    ChannelRegistry,
    EmailChannel,
    // CredentialsMailer for the four places that mint a temporary password —
    // admission approval, cohort import, account creation and password reset.
    // Each used to decide for itself whether the password ever left the
    // administrator's screen, and three of them decided it did not.
    CredentialsMailer,
    // The queue, so a caller can ask what is still waiting to go out.
    PendingEmailService,
  ],
})
export class NotificationModule {}
