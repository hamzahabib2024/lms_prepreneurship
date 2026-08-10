import { Body, Controller, Get, HttpCode, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";
import { ImpersonationService } from "./impersonation.service";
import { RequirePermission } from "../rbac/permissions.guard";

const startSchema = z.object({
  userId: z.string().uuid(),
  reason: z.string().trim().min(10).max(500),
});

/**
 * SRS §9.14 — acting as another user.
 *
 * `impersonation:create` is Super Admin AND demands step-up (§4.5), both
 * enforced by the permission guard. The rules a matrix cannot express — who the
 * target is, what state they are in, and that this is not already an
 * impersonated session — live in impersonation-rules.ts.
 *
 * Stopping and asking who you really are need NO permission. They are reachable
 * by whoever holds the token, which is the point: a session that could not tell
 * you it was an impersonation, or let you leave it, would be a trap.
 */
@Controller()
export class ImpersonationController {
  constructor(private readonly impersonation: ImpersonationService) {}

  /** FR-USR-031 — begin. Returns a short-lived token with no refresh. */
  @RequirePermission("impersonation", "create")
  @Post("admin/impersonate")
  @HttpCode(200)
  start(@Body() body: unknown, @Req() req: Request) {
    const input = startSchema.parse(body);
    return this.impersonation.start(input.userId, input.reason, req.ip);
  }

  /**
   * FR-USR-033 — stop.
   *
   * `own_session:delete`, which everybody holds over their own session: ending
   * an impersonation is something the person inside it must always be able to
   * do, and gating it on a permission the TARGET may lack would trap them in
   * somebody else's identity.
   */
  @RequirePermission("own_session", "delete")
  @Post("admin/impersonate/stop")
  @HttpCode(200)
  stop() {
    return this.impersonation.stop();
  }

  /**
   * FR-USR-034 — am I acting as somebody?
   *
   * Read by the application shell on every load so the banner cannot be missed.
   * A screen that looks exactly like somebody else's, with nothing saying so, is
   * how a support session becomes a mistake.
   */
  @RequirePermission("own_profile", "read")
  @Get("me/impersonation")
  whoAmI() {
    return this.impersonation.whoAmI();
  }
}
