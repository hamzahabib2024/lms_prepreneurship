import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
  type RawBodyRequest,
} from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";
import { LiveSessionService } from "./live-session.service";
import { AttendanceService } from "./attendance.service";
import { ProviderRegistry } from "./provider/provider.registry";
import { zodBody } from "../common/zod-validation.pipe";
import { Public, RequirePermission } from "../rbac/permissions.guard";
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

/**
 * FR-LIV — an instant class asks for almost nothing.
 *
 * A teacher pressing "start now" has a class in front of them. Every field
 * except which subject has a sensible answer already, and each extra box is one
 * more thing between them and the room.
 */
export const startNowSchema = z.object({
  sectionSubjectId: z.string().uuid(),
  // Defaults to the subject's own name in the service.
  title: z.string().trim().min(3).max(255).optional(),
  // Capped at four hours: this sets how long the class holds the teacher's
  // diary against the clash check, and a typo of 600 would block their day.
  durationMinutes: z.coerce.number().int().min(5).max(240).optional(),
  // Only an administrator opening a room on somebody's behalf sends this; a
  // teacher's own id comes from their session, never from the body.
  hostTeacherId: z.string().uuid().optional(),
});

/** Which of somebody's devices to silence. No unmute — see the endpoint. */
const muteSchema = z.object({ kind: z.enum(["audio", "video"]) });

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

  /**
   * FR-LIV — start a class now, with nothing scheduled in advance.
   *
   * `live_session:create`, the same grant scheduling needs, so an instant class
   * cannot be started by anybody who could not have booked one. A teacher holds
   * it at ASSIGNED scope, so the section-subject in the body is checked against
   * what they actually teach before anything is created.
   */
  @RequirePermission("live_session", "create")
  @Post("live-sessions/start-now")
  startNow(@Body(zodBody(startNowSchema)) dto: z.infer<typeof startNowSchema>) {
    return this.sessions.startNow(dto);
  }

  /**
   * FR-ATT-012 — the classroom reporting who came and went.
   *
   * PUBLIC, AND THAT IS NOT A HOLE. A media server cannot sign in, so this
   * endpoint is reachable by anybody. What protects the attendance register is
   * the signature over the raw bytes, checked with the API secret inside the
   * adapter — the same secret that mints join tokens. A delivery that does not
   * verify throws, and this answers 401.
   *
   * The controller names no provider: the key in the path selects an adapter
   * from the registry, and the adapter owns its own signing scheme. Adding a
   * second provider with webhooks needs nothing here (ARC-025).
   */
  @Public()
  @Post("live/webhooks/:providerKey")
  @HttpCode(200)
  async webhook(
    @Param("providerKey") providerKey: string,
    @Req() req: RawBodyRequest<Request>,
    @Headers("authorization") authorization?: string,
  ) {
    const provider = this.providers.get(providerKey);
    if (!provider.handleWebhook) {
      // Registered, but it does not speak webhooks. Accepted and dropped: a
      // provider retrying a delivery this System will never understand is
      // noise on both sides.
      return { received: 0 };
    }

    let events;
    try {
      // rawBody, never the parsed object: re-serialising would reorder keys and
      // the signature would never match its own payload.
      events = await provider.handleWebhook(req.rawBody ?? Buffer.alloc(0), authorization ?? "");
    } catch {
      // Deliberately says nothing about why. An unauthenticated caller probing
      // this endpoint learns only that it refused them.
      throw new UnauthorizedException("Webhook signature could not be verified.");
    }

    return this.sessions.applyRoomEvents(events);
  }

  /** The picker behind "start now" — what this teacher could open a room for. */
  @RequirePermission("live_session", "create")
  @Get("me/teaching")
  myTeaching() {
    return this.sessions.myTeaching();
  }

  /**
   * FR-LIV — classes happening now that the caller can walk into.
   *
   * `live_session:read`, which a STUDENT holds at ENROLLED scope: this is what
   * tells them a class has begun. Scoped by the server, so it can only ever
   * name their own classes.
   */
  @RequirePermission("live_session", "read")
  @Get("me/live-now")
  liveNow() {
    return this.sessions.liveNow();
  }

  /**
   * Who is in the room — FR-LIV.
   *
   * `attendance_register:read`, the teaching resource, NOT `live_session:read`.
   * A student holds live_session:read over their own classes, and this names
   * every classmate in the room together with whether their camera is on. That
   * is a roster, and it belongs to whoever takes the register.
   */
  @RequirePermission("attendance_register", "read")
  @Get("live-sessions/:id/participants")
  participants(@Param("id") id: string) {
    return this.sessions.participants(id);
  }

  /**
   * FR-LIV — mute one person.
   *
   * Mute only; there is no unmute endpoint and there will not be one. A teacher
   * who could switch a student's microphone back on could listen to their room
   * without consent.
   */
  @RequirePermission("live_session", "update")
  @Post("live-sessions/:id/participants/:identity/mute")
  @HttpCode(200)
  mute(
    @Param("id") id: string,
    @Param("identity") identity: string,
    @Body(zodBody(muteSchema)) dto: z.infer<typeof muteSchema>,
  ) {
    return this.sessions.muteParticipant(id, identity, dto.kind);
  }

  @RequirePermission("live_session", "update")
  @Post("live-sessions/:id/participants/:identity/remove")
  @HttpCode(200)
  removeParticipant(@Param("id") id: string, @Param("identity") identity: string) {
    return this.sessions.removeParticipant(id, identity);
  }

  /**
   * FR-LIV — the class is over.
   *
   * `update`, not `delete`. Ending a class that happened is a normal part of
   * teaching it; cancelling one that did not is the destructive act, and they
   * must not need the same grant.
   */
  @RequirePermission("live_session", "update")
  @Post("live-sessions/:id/end")
  @HttpCode(200)
  end(@Param("id") id: string) {
    return this.sessions.end(id);
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
