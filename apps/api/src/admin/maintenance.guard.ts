import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import type { Request } from "express";
import { AppError } from "@lms/shared";
import { getActor } from "../prisma/actor-context";
import { SettingsService } from "../settings/settings.service";
import { noticeFor, refuseForMaintenance } from "./maintenance-rules";

/**
 * FR-OPS-012 — turn everybody away while the System is being worked on.
 *
 * Registered globally, and it runs on EVERY request, so it must be cheap: the
 * settings service caches, and a request during normal operation costs one map
 * lookup. That is the reason maintenance state lives in settings rather than in
 * its own table with its own query.
 *
 * The decision itself is in maintenance-rules.ts, pure and tested, because
 * getting it wrong locks out the person who would turn it off and the remedy is
 * a database edit at three in the morning.
 */
@Injectable()
export class MaintenanceGuard implements CanActivate {
  constructor(private readonly settings: SettingsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();

    const enabled = await this.settings.resolveFor().then((s) => s["maintenance.enabled"] === true);
    if (!enabled) return true;

    const rawEnd = await this.settings.text("maintenance.expectedEndAt");
    const parsed = rawEnd ? new Date(rawEnd) : null;

    const state = {
      enabled: true,
      message: await this.settings.text("maintenance.message"),
      // A malformed date must not become "Invalid Date" in a notice shown to
      // every user; it simply means no end time was given.
      expectedEndAt: parsed && !Number.isNaN(parsed.getTime()) ? parsed : null,
    };

    // The actor may be absent — somebody signing in during maintenance has no
    // token yet, and the exempt-path list is what lets them through.
    const actor = getActor();
    const refusal = refuseForMaintenance(state, {
      path: req.originalUrl ?? req.url ?? "",
      roles: actor?.roles ?? [],
    });

    if (!refusal.refused) return true;

    // MAINTENANCE_MODE has existed in the error catalogue from the start, with
    // its 503 status, and nothing ever threw it.
    throw new AppError("MAINTENANCE_MODE", {
      message: noticeFor(state),
      details: [
        {
          field: "maintenance",
          code: "MAINTENANCE_MODE",
          message: noticeFor(state),
        },
      ],
    });
  }
}
