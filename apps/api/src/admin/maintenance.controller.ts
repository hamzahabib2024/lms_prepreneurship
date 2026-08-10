import { Body, Controller, Get, Put } from "@nestjs/common";
import { z } from "zod";
import { SettingsService } from "../settings/settings.service";
import { Public, RequirePermission } from "../rbac/permissions.guard";
import { noticeFor } from "./maintenance-rules";

const configureSchema = z.object({
  enabled: z.boolean(),
  message: z.string().trim().min(10).max(500).optional(),
  /** ISO date-time, or null to clear it. */
  expectedEndAt: z.string().datetime().nullish(),
});

/**
 * SRS §9.16 — maintenance mode.
 *
 * Reading the notice is PUBLIC. Somebody turned away has, by definition, not
 * got in, and telling them only after they authenticate would mean telling
 * nobody. It exposes one sentence the Institute wrote for exactly this purpose.
 *
 * Configuring it is `maintenance_mode:configure`, Super Admin (§4.5). The state
 * is stored as settings, so it survives a restart, is audited when it changes,
 * and is readable by the guard from cache rather than a query per request.
 */
@Controller()
export class MaintenanceController {
  constructor(private readonly settings: SettingsService) {}

  /** FR-OPS-010 — is the System up, and if not, why and until when? */
  @Public()
  @Get("maintenance")
  async status() {
    const enabled = (await this.settings.resolveFor())["maintenance.enabled"] === true;
    if (!enabled) return { maintenance: false as const };

    const rawEnd = await this.settings.text("maintenance.expectedEndAt");
    const parsed = rawEnd ? new Date(rawEnd) : null;
    const expectedEndAt = parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
    const message = await this.settings.text("maintenance.message");

    return {
      maintenance: true as const,
      message,
      expectedEndAt,
      notice: noticeFor({ enabled: true, message, expectedEndAt }),
    };
  }

  /**
   * FR-OPS-011 — turn it on or off.
   *
   * Writing through SettingsService rather than touching the rows directly, so
   * this inherits the catalogue's validation, the audit record and the cache
   * invalidation. Turning maintenance on without invalidating the cache would
   * leave it off for up to the life of the process, which is the kind of bug
   * that is only discovered by the people it fails to keep out.
   */
  @RequirePermission("maintenance_mode", "configure")
  @Put("maintenance")
  async configure(@Body() body: unknown) {
    const input = configureSchema.parse(body);

    if (input.message !== undefined) {
      await this.settings.set("maintenance.message", input.message);
    }
    if (input.expectedEndAt !== undefined) {
      await this.settings.set("maintenance.expectedEndAt", input.expectedEndAt ?? "");
    }
    // Set LAST, so the notice and the end time are already in place for the
    // first person turned away.
    await this.settings.set("maintenance.enabled", input.enabled);

    return {
      maintenance: input.enabled,
      message: input.enabled
        ? "Maintenance mode is ON. Everybody except a Super Admin is being turned away. " +
          "Signing in still works, so you can turn it off from any device."
        : "Maintenance mode is OFF. The System is available again.",
    };
  }
}
