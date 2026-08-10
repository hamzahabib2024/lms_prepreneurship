import { Module } from "@nestjs/common";
import { LiveSessionService } from "./live-session.service";
import { AttendanceService } from "./attendance.service";
import { LiveController } from "./live.controller";
import { TimetableService } from "./timetable.service";
import { TimetableController } from "./timetable.controller";
import { ProviderRegistry } from "./provider/provider.registry";
import { ManualProvider } from "./provider/manual.provider";
import { GoogleMeetProvider } from "./provider/google-meet.provider";

/**
 * Adding a live provider touches this file and one adapter beside it. Nothing
 * else in the System is aware of it — that is ARC-028, and the substitution
 * test at §3.4.6 verifies it.
 */
@Module({
  controllers: [LiveController, TimetableController],
  providers: [
    LiveSessionService,
    AttendanceService,
    ProviderRegistry,
    ManualProvider,
    GoogleMeetProvider, TimetableService],
  exports: [LiveSessionService, AttendanceService, ProviderRegistry],
})
export class LiveModule {}
