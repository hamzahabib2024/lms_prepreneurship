import { Controller, Get, Header, Param, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { DashboardService } from "./dashboard.service";
import { ReportService, type ReportFilters } from "./report.service";
import { RequirePermission } from "../rbac/permissions.guard";

/** SRS §9.9 — dashboards and reports. */
@Controller()
export class ReportingController {
  constructor(
    private readonly dashboard: DashboardService,
    private readonly reports: ReportService,
  ) {}

  /**
   * FR-DSH-001/002 — the caller's own dashboard.
   *
   * There is no `role` parameter: the role comes from the session, so a
   * student cannot request the admin dashboard by asking for it.
   */
  @RequirePermission("dashboard", "read")
  @Get("dashboards/me")
  me() {
    return this.dashboard.forCurrentUser();
  }

  @RequirePermission("report_attendance", "read")
  @Get("reports")
  list() {
    return this.reports.list();
  }

  /**
   * FR-RPT-002 — scope is applied from the session, never from a parameter.
   * A teacher running this gets their own sections because the database
   * cannot return anything else.
   */
  @RequirePermission("report_attendance", "read")
  @Get("reports/:key")
  run(@Param("key") key: string, @Query() query: Record<string, string>) {
    return this.reports.run(key, this.parseFilters(query));
  }

  /**
   * FR-RPT-004 — CSV export.
   *
   * Requires the `export` action rather than `read`: §4.1.2 separates them
   * because bulk extraction of personal data is a distinct privacy risk from
   * reading it on screen (SEC-PRV-007). Generation is audited.
   */
  @RequirePermission("report_attendance", "export")
  @Get("reports/:key/export")
  @Header("Content-Type", "text/csv; charset=utf-8")
  async export(
    @Param("key") key: string,
    @Query() query: Record<string, string>,
    @Res() res: Response,
  ): Promise<void> {
    const { filename, content } = await this.reports.export(key, this.parseFilters(query));
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(content);
  }

  private parseFilters(query: Record<string, string>): ReportFilters {
    const filters: ReportFilters = {};
    if (query["sectionId"]) filters.sectionId = query["sectionId"];
    if (query["sectionSubjectId"]) filters.sectionSubjectId = query["sectionSubjectId"];
    if (query["status"]) filters.status = query["status"];
    if (query["from"]) filters.from = new Date(query["from"]);
    if (query["to"]) filters.to = new Date(query["to"]);
    if (query["belowThresholdOnly"] === "true") filters.belowThresholdOnly = true;
    return filters;
  }
}
