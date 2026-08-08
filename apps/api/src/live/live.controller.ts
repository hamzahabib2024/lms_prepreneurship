import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { AppError } from "@lms/shared";
import { LiveSessionService } from "./live-session.service";
import { AttendanceService } from "./attendance.service";
import { ProviderRegistry } from "./provider/provider.registry";
import { zodBody } from "../common/zod-validation.pipe";
import { RequirePermission } from "../rbac/permissions.guard";
import { getActor } from "../prisma/actor-context";

const ATTENDANCE_STATUS = ["PRESENT", "ABSENT", "LATE", "EXCUSED", "NOT_MARKED"] as const;

const scheduleSchema = z.object({
  sectionSubjectId: z.string().uuid(),
  lessonId: z.string().uuid().optional(),
  title: z.string().trim().min(3).max(255),
  description: z.string().trim().max(2000).optional(),
  scheduledStart: z.coerce.date(),
  scheduledEnd: z.coerce.date(),
  hostTeacherId: z.string().uuid(),
  sessionType: z.enum(["ONLINE", "OFFLINE"]).default("ONLINE"),
});

const bulkMarkSchema = z.object({
  defaultStatus: z.enum(ATTENDANCE_STATUS),
  exceptions: z
    .array(
      z.object({
        studentId: z.string().uuid(),
        status: z.enum(ATTENDANCE_STATUS),
        reason: z.string().trim().max(500).optional(),
      }),
    )
    .default([]),
});

const correctSchema = z.object({
  status: z.enum(ATTENDANCE_STATUS),
  reason: z.string().trim().min(3, "Record why this is being changed.").max(500),
});

const fallbackSchema = z.object({ joinUrl: z.string().url().max(1000) });
const cancelSchema = z.object({
  reason: z.string().trim().min(3, "Tell students why the class is cancelled.").max(500),
});

/** SRS §9.7 — live sessions and attendance. */
@Controller()
export class LiveController {
  constructor(
    private readonly sessions: LiveSessionService,
    private readonly attendance: AttendanceService,
    private readonly providers: ProviderRegistry,
  ) {}

  // ------------------------------------------------------------- sessions --

  @RequirePermission("live_session", "read")
  @Get("live-sessions")
  list(@Query("sectionSubjectId") sectionSubjectId?: string, @Query("days") days?: string) {
    return this.sessions.listUpcoming({
      sectionSubjectId,
      days: days ? Number(days) : undefined,
    });
  }

  @RequirePermission("live_session", "create")
  @Post("live-sessions")
  schedule(@Body(zodBody(scheduleSchema)) dto: z.infer<typeof scheduleSchema>) {
    return this.sessions.schedule(dto);
  }

  /**
   * FR-LIV-007 — returns a JoinRoute, never a URL.
   *
   * The client branches on `kind` alone. This is the endpoint the substitution
   * test at §3.4.6 exercises: swapping the provider changes what `kind`
   * contains and nothing else.
   */
  @RequirePermission("join_route", "read")
  @Get("live-sessions/:id/join-route")
  joinRoute(@Param("id") id: string) {
    return this.sessions.getJoinRoute(id);
  }

  @RequirePermission("live_session", "update")
  @Post("live-sessions/:id/fallback-link")
  fallback(@Param("id") id: string, @Body(zodBody(fallbackSchema)) dto: { joinUrl: string }) {
    return this.sessions.setFallbackLink(id, dto.joinUrl);
  }

  @RequirePermission("live_session", "delete")
  @Post("live-sessions/:id/cancel")
  cancel(@Param("id") id: string, @Body(zodBody(cancelSchema)) dto: { reason: string }) {
    return this.sessions.cancel(id, dto.reason);
  }

  @RequirePermission("live_provider_selection", "read")
  @Get("live-providers")
  listProviders() {
    return this.providers.listWithHealth();
  }

  // ----------------------------------------------------------- attendance --

  @RequirePermission("attendance", "read")
  @Get("live-sessions/:id/attendance")
  register(@Param("id") id: string) {
    return this.attendance.register(id);
  }

  /** FR-ATT-007 — a 40-student register in under 60 seconds. */
  @RequirePermission("attendance", "update")
  @Post("live-sessions/:id/attendance")
  markBulk(@Param("id") id: string, @Body(zodBody(bulkMarkSchema)) dto: z.infer<typeof bulkMarkSchema>) {
    return this.attendance.markBulk(id, dto);
  }

  @RequirePermission("attendance_correction", "update")
  @Post("live-sessions/:id/attendance/:studentId/correct")
  correct(
    @Param("id") id: string,
    @Param("studentId") studentId: string,
    @Body(zodBody(correctSchema)) dto: z.infer<typeof correctSchema>,
  ) {
    return this.attendance.correct(id, studentId, dto.status, dto.reason);
  }

  @RequirePermission("attendance", "read")
  @Get("students/:id/attendance")
  studentAttendance(@Param("id") id: string) {
    return this.attendance.studentSummary(id);
  }

  /** A student's own record, without needing to know their own id. */
  @RequirePermission("attendance", "read")
  @Get("me/attendance")
  myAttendance() {
    const actor = getActor();
    if (!actor?.studentId) throw new AppError("RESOURCE_NOT_FOUND");
    return this.attendance.studentSummary(actor.studentId);
  }
}
