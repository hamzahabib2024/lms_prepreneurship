import { Module } from "@nestjs/common";
import { PublicPageController } from "./public-page.controller";
import { PublicPageService } from "./public-page.service";

/**
 * No imports. SettingsModule is @Global and PrismaModule is @Global, which is
 * the whole dependency list — this module owns no data of its own, by design.
 * What the public page says lives in the settings table beside everything else
 * the Institute configures; this is a narrower door onto part of it.
 */
@Module({
  controllers: [PublicPageController],
  providers: [PublicPageService],
})
export class PublicPageModule {}
