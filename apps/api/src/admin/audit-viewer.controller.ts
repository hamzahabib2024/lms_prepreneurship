import { Controller, Get, Param, Query } from "@nestjs/common";
import { AuditViewerService } from "./audit-viewer.service";
import { RequirePermission } from "../rbac/permissions.guard";

/**
 * SRS §9.12 — reading the audit log.
 *
 * Every route is `audit_log:read`, which §4.5.12 grants to a Super Admin over
 * everything and to an Admin over their OWN actions only. That asymmetry is the
 * point and it is enforced by the scope policy, not here: an administrator
 * reading colleagues' actions is surveillance rather than administration, and
 * investigating somebody is a Super Admin's job.
 *
 * There is no write route, and the table refuses UPDATE and DELETE at the
 * database (FR-LOG-004).
 */
@Controller()
export class AuditViewerController {
  constructor(private readonly audit: AuditViewerService) {}

  @RequirePermission("audit_log", "read")
  @Get("admin/audit")
  list(
    @Query("action") action?: string,
    @Query("entityType") entityType?: string,
    @Query("entityId") entityId?: string,
    @Query("actorUserId") actorUserId?: string,
    @Query("correlationId") correlationId?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("page") page?: string,
  ) {
    return this.audit.list({
      action,
      entityType,
      entityId,
      actorUserId,
      correlationId,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      page: page ? Number(page) : undefined,
    });
  }

  /** FR-LOG-016 — the actions present, for building a filter. */
  @RequirePermission("audit_log", "read")
  @Get("admin/audit/actions")
  actions() {
    return this.audit.actions();
  }

  /**
   * FR-LOG-012 — the history of ONE record.
   *
   * The question people actually ask is never "show me the log", it is "why
   * does this grade say 19 when I remember 17".
   */
  @RequirePermission("audit_log", "read")
  @Get("admin/audit/entity/:entityType/:entityId")
  forEntity(@Param("entityType") entityType: string, @Param("entityId") entityId: string) {
    return this.audit.forEntity(entityType, entityId);
  }

  /** FR-LOG-014 — everything one request did, via ARC-008's correlation id. */
  @RequirePermission("audit_log", "read")
  @Get("admin/audit/request/:correlationId")
  forCorrelation(@Param("correlationId") correlationId: string) {
    return this.audit.forCorrelation(correlationId);
  }
}
