import { Global, Module } from "@nestjs/common";
import { IntegrationController } from "./integration.controller";
import { IntegrationService } from "./integration.service";
import { SimulatedOutbox } from "./simulated-outbox";
import { ContentModule } from "../content/content.module";

/**
 * Global for the same reason the notification module is: the outbox is written
 * by a channel adapter and read by a controller two modules away, and a
 * singleton is the whole point — a per-module instance would give the reader an
 * empty buffer and the writer nowhere useful to write.
 */
@Global()
@Module({
  imports: [ContentModule],
  controllers: [IntegrationController],
  providers: [IntegrationService, SimulatedOutbox],
  exports: [SimulatedOutbox],
})
export class IntegrationModule {}
