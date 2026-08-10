import { Body, Controller, Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { LiveSessionService } from "./live-session.service";
import { AttendanceService } from "./attendance.service";
import { ProviderRegistry } from "./provider/provider.registry";
import { zodBody } from "../common/zod-validation.pipe";
import { RequirePermission } from "../rbac/permissions.guard";
import { assertOwnStudent, requireOwnStudentId } from "../rbac/ownership";

const ATTENDANCE_STATUS = ["PRESENT", "ABSENT", "LATE", "EXCUSED", "NOT_MARKED"] as const;

/** FR-ATT-022 — a note is optional; the act of acknowledging is the record. */
const acknowledgeWarningSchema = z.object({
  note: z.string().trim().max(1000).optional(),
});

const scheduleSchema = z.object({
  sectionSubjectId: z.string().uuid(),
  lessonId: z.string().uuid().optional(),
  title: z.string().trim().min(3).max(255),
  description: z.string().trim().max(2000).optional(),
  scheduledStart: z.coerce.date(),
  scheduledEnd: z.coerce.date(),
  hostTeacherId: z.string().uuid(),
  sessionType: z.enum(["ONLINE", "OFFLINE"]).default("ONLINE"),
  // MANUAL by default, which is what an institute expects unless it has
  // decided otherwise: the teacher takes the register. SELF_CHECKIN hands that
  // to the students of THIS class, and nothing else changes.
  attendancePolicy: z
    .enum(["MANUAL", "SELF_CHECKIN", "PROVIDER_DERIVED", "HYBRID"])
    .default("MANUAL"),
  joinWindowMinutesBefore: z.coerce.number().int().min(0).max(120).optional(),
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
  list(
    @Query("sectionSubjectId") sectionSubjectId?: string,
    @Query("days") days?: string,
    @Query("pastDays") pastDays?: string,
  ) {
    return this.sessions.listUpcoming({
      sectionSubjectId,
      days: days ? Number(days) : undefined,
      // The attendance register needs history; the dashboard does not.
      pastDays: pastDays ? Number(pastDays) : undefined,
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

  @RequirePermission("attendance_register", "read")
  @Get("live-sessions/:id/attendance")
  register(@Param("id") id: string) {
    return this.attendance.register(id);
  }

  /** FR-ATT-007 — a 40-student register in under 60 seconds. */
  @RequirePermission("attendance_register", "update")
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

  /**
   * FR-ATT-022 — the live warnings in one subject-section.
   *
   * `attendance_register`, the teaching resource, not `attendance`. This is a
   * cohort list naming students and their figures; a student holds
   * `attendance:read` over their OWN record and must not reach it.
   */
  @RequirePermission("attendance_register", "read")
  @Get("section-subjects/:id/at-risk")
  atRisk(@Param("id") id: string) {
    return this.attendance.atRisk(id);
  }

  /** FR-ATT-022 — record that somebody has acted on a warning. */
  @RequirePermission("attendance_register", "update")
  @Post("attendance-warnings/:id/acknowledge")
  @HttpCode(200)
  acknowledgeWarning(
    @Param("id") id: string,
    @Body(zodBody(acknowledgeWarningSchema)) dto: { note?: string },
  ) {
    return this.attendance.acknowledgeWarning(id, dto.note);
  }

  @RequirePermission("attendance", "read")
  @Get("students/:id/attendance")
  studentAttendance(@Param("id") id: string) {
    // SEC-AUZ-004/006 — a student naming a classmate is refused outright,
    // rather than receiving an empty-but-successful response that confirms
    // the identifier exists.
    assertOwnStudent(id);
    return this.attendance.studentSummary(id);
  }

  /** A student's own record, without needing to know their own id. */
  @RequirePermission("attendance", "read")
  @Get("me/attendance")
  myAttendance() {
    // Previously a 404 saying "that record could not be found", which is both
    // wrong and unhelpful for a teacher who simply has no student record
    // (NFR-USE-007).
    return this.attendance.studentSummary(requireOwnStudentId());
  }

  /**
   * FR-ATT-008 — a student confirms their own presence.
   *
   * `attendance_self_checkin:update`, which ONLY a student holds. It was split
   * out of `attendance` while fixing a defect where a student's "update for
   * self check-in" grant also opened the bulk-marking endpoint and let one
   * student mark the whole class present. The permission has existed since that
   * fix with nothing implementing it; this is the implementation.
   *
   * There is no student id in the path or the body, deliberately. The endpoint
   * is reachable by every student, so a student id here would let any of them
   * check in as any other — the very defect the split was for.
   */
  @RequirePermission("attendance_self_checkin", "update")
  @Post("live-sessions/:id/check-in")
  checkIn(@Param("id") id: string) {
    return this.attendance.selfCheckIn(id);
  }
}
