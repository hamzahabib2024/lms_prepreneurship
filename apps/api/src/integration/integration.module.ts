import { Global, Module } from "@nestjs/common";
import { IntegrationController } from "./integration.controller";
import { IntegrationService } from "./integration.service";
import { SimulatedOutbox } from "./simulated-outbox";
import { ContentModule } from "../content/content.module";
import { LiveModule } from "../live/live.module";

/**
 * Global for the same reason the notification module is: the outbox is written
 * by a channel adapter and read by a controller two modules away, and a
 * singleton is the whole point — a per-module instance would give the reader an
 * empty buffer and the writer nowhere useful to write.
 */
@Global()
@Module({
  // LiveModule for ProviderRegistry: the status screen asks the provider that
  // will actually be used whether it creates meeting links, rather than
  // guessing from the environment. Drive and Meet share a service account, and
  // guessing made a key added for lecture video claim that Meet was live too.
  imports: [ContentModule, LiveModule],
  controllers: [IntegrationController],
  providers: [IntegrationService, SimulatedOutbox],
  exports: [SimulatedOutbox],
})
export class IntegrationModule {}
