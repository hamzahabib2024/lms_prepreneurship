import { Module } from "@nestjs/common";
import { DiscussionService } from "./discussion.service";
import { DiscussionController } from "./discussion.controller";
import { NotificationModule } from "../notification/notification.module";

/** §5.15 — a question thread per offering. */
@Module({
  imports: [NotificationModule],
  controllers: [DiscussionController],
  providers: [DiscussionService],
})
export class DiscussionModule {}
