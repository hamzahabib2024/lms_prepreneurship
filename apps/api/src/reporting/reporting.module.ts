import { Module } from "@nestjs/common";
import { DashboardService } from "./dashboard.service";
import { ReportService } from "./report.service";
import { ReportingController } from "./reporting.controller";
import { LiveModule } from "../live/live.module";
import { ProgressModule } from "../progress/progress.module";

// Attendance and progress come from their owning modules rather than being
// recomputed here. BR-ATT-06 and BR-RPT-02 require one definition everywhere:
// a report that disagrees with the dashboard makes both untrustworthy.
@Module({
  imports: [LiveModule, ProgressModule],
  controllers: [ReportingController],
  providers: [DashboardService, ReportService],
  exports: [DashboardService, ReportService],
})
export class ReportingModule {}
