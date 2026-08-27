import { Body, Controller, Get, HttpCode, Post, Req } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { z } from "zod";
import {
  AppError,
  changePasswordSchema,
  loginSchema,
  refreshSchema,
  stepUpSchema,
  type ChangePasswordInput,
  type LoginInput,
  type RefreshInput,
} from "@lms/shared";
import type { Request } from "express";
import { AuthService } from "./auth.service";
import { PasswordResetService } from "./password-reset.service";
import { PasswordResetLimited } from "./password-reset.throttle";
import { zodBody } from "../common/zod-validation.pipe";
import { Public, RequirePermission } from "../rbac/permissions.guard";
import { getActor } from "../prisma/actor-context";

/**
 * Asking for a reset link.
 *
 * The address is the only field, and it is not checked against anything here:
 * whether it belongs to an account is exactly what this endpoint must not
 * reveal, so an unknown address gets the same answer as a known one.
 */
const forgotSchema = z.object({
  email: z.string().trim().email().max(320),
});

/**
 * Spending it.
 *
 * The length floor here is a sanity check, not the policy — the real minimum
 * depends on the account's roles and is applied by the service, because only
 * it knows whose password this is.
 */
const resetSchema = z.object({
  token: z.string().min(20).max(200),
  newPassword: z.string().min(8).max(200),
});

/** §9.3 — authentication endpoints. */
@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly reset: PasswordResetService,
  ) {}

  @Public()
  @Post("login")
  @HttpCode(200)
  login(@Body(zodBody(loginSchema)) dto: LoginInput, @Req() req: Request) {
    return this.auth.login(dto, req.ip, req.header("user-agent"));
  }

  @Public()
  @Post("refresh")
  @HttpCode(200)
  refresh(@Body(zodBody(refreshSchema)) dto: RefreshInput, @Req() req: Request) {
    return this.auth.refresh(dto.refreshToken, req.ip, req.header("user-agent"));
  }

  @Public()
  @Post("logout")
  @HttpCode(204)
  async logout(@Req() req: Request): Promise<void> {
    if (req.sessionId) await this.auth.logout(req.sessionId);
  }

  /**
   * FR-AUT — "I have forgotten my password."
   *
   * ALWAYS 200, ALWAYS THE SAME SENTENCE. Whether the address is registered is
   * the one thing this route must not disclose: an endpoint that says "no such
   * account" is a free membership test, and at an institute the membership
   * list is the student roster.
   *
   * THROTTLED BY THE ADDRESS BEING ASKED ABOUT, not by the computer asking.
   * Three an hour for any one mailbox is more than a genuine person needs and
   * stops somebody using this form to pester a stranger — while a hall of
   * students on one wifi are not competing for a single budget, which is what
   * an IP-keyed limit does behind nginx.
   *
   * `reset-ip` sits on top as a loose per-computer backstop, so nobody walks a
   * list of addresses three at a time. See password-reset.throttle.ts.
   *
   * @PasswordResetLimited IS WHAT APPLIES BOTH OF THEM, and it is required.
   * Naming a throttler in the module does not confine it to a route — it
   * applies to every route — so the two are declared with a `skipIf` that
   * skips everything except the handler carrying this marker. Remove it and
   * this form falls back to 300 a minute; put it on another route and that
   * route gets a three-an-hour limit keyed by a field it does not have.
   */
  @Public()
  @PasswordResetLimited()
  @Post("password/forgot")
  @HttpCode(200)
  forgotPassword(@Body(zodBody(forgotSchema)) dto: z.infer<typeof forgotSchema>, @Req() req: Request) {
    return this.reset.request(dto.email, req.ip ?? null);
  }

  /**
   * FR-AUT — set the password with the link that was emailed.
   *
   * Throttled more tightly than the request above: this one takes a SECRET, so
   * the rate limit is part of what makes guessing hopeless rather than merely
   * expensive. Thirty-two random bytes are already beyond guessing; the limit
   * is what stops somebody trying anyway and filling the log doing it.
   */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 3_600_000 } })
  @Post("password/reset")
  @HttpCode(200)
  resetPassword(@Body(zodBody(resetSchema)) dto: z.infer<typeof resetSchema>, @Req() req: Request) {
    return this.reset.complete(dto.token, dto.newPassword, req.ip ?? null);
  }

  @RequirePermission("own_password", "update")
  @Post("password/change")
  @HttpCode(200)
  async changePassword(
    @Body(zodBody(changePasswordSchema)) dto: ChangePasswordInput,
    @Req() req: Request,
  ) {
    const actor = getActor();
    if (!actor) throw new AppError("AUTH_TOKEN_INVALID");
    await this.auth.changePassword(
      actor.userId,
      dto.currentPassword,
      dto.newPassword,
      req.sessionId,
    );
    return { changed: true };
  }

  /**
   * SEC-AUZ-011 — returns a fresh access token carrying the step-up timestamp,
   * so the privileged operation that follows can be authorised.
   */
  @RequirePermission("own_password", "update")
  @Post("step-up")
  @HttpCode(200)
  async stepUp(@Body(zodBody(stepUpSchema)) dto: { password: string }, @Req() req: Request) {
    const actor = getActor();
    if (!actor) throw new AppError("AUTH_TOKEN_INVALID");
    // The session id travels with the new token so revoking the session still
    // revokes it. It is set by the actor-context middleware from the `sid`
    // claim of the token that got us here.
    return this.auth.stepUp(actor.userId, dto.password, req.sessionId ?? "");
  }

  /**
   * §9.3 — current identity, roles, and resolved permissions.
   *
   * Used on every page load to restore a session, so it returns enough for
   * the interface to identify the user without a second request.
   */
  @RequirePermission("own_profile", "read")
  @Get("me")
  async me() {
    const actor = getActor();
    if (!actor) throw new AppError("AUTH_TOKEN_INVALID");

    const profile = await this.auth.profileFor(actor.userId);

    return {
      userId: actor.userId,
      fullName: profile?.fullName ?? "",
      email: profile?.email ?? "",
      photoUrl: profile?.photoUrl ?? null,
      // FR-REG-040 — the client must know to hold the user at the password
      // screen even after a page reload, not only immediately after login.
      mustChangePassword: profile?.mustChangePassword ?? false,
      roles: actor.roles,
      subPermissions: actor.subPermissions,
      studentId: actor.studentId ?? null,
      teacherId: actor.teacherId ?? null,
      student: profile?.student ?? null,
      // Deliberately NOT returning sectionSubjectIds: it is an internal scope
      // detail, and exposing it invites clients to treat it as authorisation.
      reach: {
        sections: actor.sectionIds.length,
        subjects: actor.sectionSubjectIds.length,
      },
    };
  }
}
