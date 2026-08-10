import { Body, Controller, Delete, Get, Param, Put, Query } from "@nestjs/common";
import { z } from "zod";
import { SettingsService } from "./settings.service";
import { RequirePermission } from "../rbac/permissions.guard";

const scopeSchema = z.enum(["INSTITUTE", "PROGRAMME", "SECTION", "SUBJECT"]);

const writeSchema = z.object({
  // Deliberately z.unknown(): the catalogue knows what each key may hold and
  // says so in words. A schema here would either duplicate that or, worse,
  // disagree with it.
  value: z.unknown(),
  scopeType: scopeSchema.default("INSTITUTE"),
  scopeId: z.string().uuid().optional(),
});

/**
 * SRS §9.13 — institute settings.
 *
 * Reading is `system_setting:read`, which §4.5 grants to an Admin and a Super
 * Admin. Writing is `configure`, Super Admin only: these values decide when a
 * student is warned, what counts as complete, and what a certificate requires,
 * so changing them is a governance act rather than an administrative one.
 *
 * Secrets are never returned by any route here (SEC-CRY-010) — the scope policy
 * hides them from the query and the projection omits them again.
 */
@Controller()
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  /**
   * FR-CFG-001 — every setting, grouped, with where each value came from.
   *
   * The scope query parameters are optional. Without them this shows the
   * institute-wide picture; with them, what a particular section or subject
   * actually gets, which is the question asked when a figure looks wrong.
   */
  @RequirePermission("system_setting", "read")
  @Get("settings")
  catalogue(
    @Query("programmeId") programmeId?: string,
    @Query("sectionId") sectionId?: string,
    @Query("subjectId") subjectId?: string,
  ) {
    return this.settings.catalogue({
      ...(programmeId ? { PROGRAMME: programmeId } : {}),
      ...(sectionId ? { SECTION: sectionId } : {}),
      ...(subjectId ? { SUBJECT: subjectId } : {}),
    });
  }

  /** FR-CFG-004 — change one. PUT, because a setting has one value. */
  @RequirePermission("system_setting", "configure")
  @Put("settings/:key")
  set(@Param("key") key: string, @Body() body: unknown) {
    const input = writeSchema.parse(body);
    return this.settings.set(key, input.value, input.scopeType, input.scopeId);
  }

  /** FR-CFG-005 — remove an override so the broader value applies again. */
  @RequirePermission("system_setting", "configure")
  @Delete("settings/:key")
  clear(
    @Param("key") key: string,
    @Query("scopeType") scopeType?: string,
    @Query("scopeId") scopeId?: string,
  ) {
    return this.settings.clear(key, scopeSchema.parse(scopeType ?? "INSTITUTE"), scopeId);
  }
}
