import { Module } from "@nestjs/common";
import { ProgressService } from "./progress.service";
import { CompletionService } from "./completion.service";
import { ProgressSettingsService } from "./progress-settings.service";
import { ProgressController } from "./progress.controller";
import { LiveModule } from "../live/live.module";

// LiveModule provides AttendanceService. Progress consumes the SAME
// percentage calculation the register and reports use, because BR-ATT-06
// requires one definition everywhere — two would disagree and both be doubted.
@Module({
  imports: [LiveModule],
  controllers: [ProgressController],
  providers: [CompletionService, ProgressService, ProgressSettingsService],
  exports: [ProgressService],
})
export class ProgressModule {}
