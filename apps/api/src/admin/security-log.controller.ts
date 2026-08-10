import { Controller, Get, Param, Query } from "@nestjs/common";
import { SecurityLogService } from "./security-log.service";
import { RequirePermission } from "../rbac/permissions.guard";

/**
 * SRS §9.12 — the security log.
 *
 * Every route is `security_log:read`, which §4.5 grants to a SUPER ADMIN ALONE.
 * There is no Admin tier here, unlike the audit log where an Admin sees their
 * own actions: this log names who has been attacked and from where, and it is
 * as useful for investigating a colleague as for defending one.
 *
 * No write route. Security events are produced by authentication and are never
 * edited or removed by anybody.
 */
@Controller()
export class SecurityLogController {
  constructor(private readonly security: SecurityLogService) {}

  /** FR-LOG-021 — the default view: what deserves attention right now. */
  @RequirePermission("security_log", "read")
  @Get("admin/security")
  overview(@Query("hours") hours?: string) {
    // Clamped. A window of a year would scan the whole table to answer a
    // question about right now, and one of zero would always be empty.
    const requested = Number(hours);
    const window = Number.isFinite(requested) ? Math.min(720, Math.max(1, requested)) : 24;
    return this.security.overview(window);
  }

  /** FR-LOG-020 — the events themselves. */
  @RequirePermission("security_log", "read")
  @Get("admin/security/events")
  list(
    @Query("eventType") eventType?: string,
    @Query("userId") userId?: string,
    @Query("email") email?: string,
    @Query("ipAddress") ipAddress?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("page") page?: string,
  ) {
    return this.security.list({
      eventType,
      userId,
      email,
      ipAddress,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      page: page ? Number(page) : undefined,
    });
  }

  /** FR-LOG-026 — the kinds present, for building a filter. */
  @RequirePermission("security_log", "read")
  @Get("admin/security/event-types")
  eventTypes() {
    return this.security.eventTypes();
  }

  /** FR-LOG-024 — one account's security history. */
  @RequirePermission("security_log", "read")
  @Get("admin/security/users/:id")
  forUser(@Param("id") id: string) {
    return this.security.forUser(id);
  }
}
