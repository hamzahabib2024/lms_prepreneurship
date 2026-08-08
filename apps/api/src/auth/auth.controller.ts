import { Body, Controller, Get, HttpCode, Post, Req } from "@nestjs/common";
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
import { zodBody } from "../common/zod-validation.pipe";
import { Public, RequirePermission } from "../rbac/permissions.guard";
import { getActor } from "../prisma/actor-context";

/** §9.3 — authentication endpoints. */
@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

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
  async stepUp(@Body(zodBody(stepUpSchema)) dto: { password: string }) {
    const actor = getActor();
    if (!actor) throw new AppError("AUTH_TOKEN_INVALID");
    const at = await this.auth.stepUp(actor.userId, dto.password);
    return { steppedUpAt: at, validForSeconds: 600 };
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
