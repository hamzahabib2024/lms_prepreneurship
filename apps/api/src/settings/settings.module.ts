import { Global, Module } from "@nestjs/common";
import { SettingsService } from "./settings.service";
import { SettingsController } from "./settings.controller";

/**
 * Global, because institute policy is not one feature's business: attendance
 * asks for its thresholds, progress for its weights, submissions for their
 * limits. The alternative is importing this module almost everywhere, which
 * says the same thing with more ceremony.
 */
@Global()
@Module({
  controllers: [SettingsController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
