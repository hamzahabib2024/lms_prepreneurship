import { Global, Module } from "@nestjs/common";
import { AnnouncementService } from "./announcement.service";
import { NotificationService } from "./notification.service";
import { TemplateService } from "./template.service";
import { NotificationController } from "./notification.controller";
import { ChannelRegistry } from "./channel/channel.registry";
import { LoggedWhatsAppChannel } from "./channel/logged.channel";

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
  controllers: [NotificationController],
  providers: [
    AnnouncementService,
    NotificationService,
    TemplateService,
    ChannelRegistry,
    LoggedWhatsAppChannel,
  ],
  exports: [NotificationService, AnnouncementService, TemplateService],
})
export class NotificationModule {}
