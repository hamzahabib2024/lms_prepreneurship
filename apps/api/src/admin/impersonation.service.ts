import { Injectable, Logger } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { randomUUID } from "node:crypto";
import { AppError } from "@lms/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { getActor } from "../prisma/actor-context";
import {
  IMPERSONATION_TTL_MINUTES,
  refuseImpersonation,
  refuseReason,
} from "./impersonation-rules";

/**
 * Acting as another user — SRS §5.21, SEC-AUZ-013, FR-USR-030..034.
 *
 * Everything needed for this has existed since the first commit except the act
 * itself: Actor carries impersonatedBy, the audit service writes it, the viewer
 * returns it and the audit screen renders "while impersonating". Nothing ever
 * set it, so that column has been null on every row ever written.
 *
 * THE TOKEN IS THE TARGET'S, TAGGED. `sub` is the person being impersonated, so
 * every scope predicate, every permission check and every query behaves exactly
 * as it would for them — which is the point, and is also why it must be
 * impossible to forget who is really driving. `imp` carries that, the middleware
 * puts it on the Actor, and the audit service stamps it on every write.
 *
 * NO REFRESH TOKEN IS ISSUED. An impersonation session ends by arithmetic after
 * fifteen minutes rather than by anybody remembering to end it. A renewable one
 * is a spare key to somebody's account.
 *
 * NO SESSION ROW IS CREATED either. The target's own session list is a security
 * feature they can read; filling it with sessions they did not start would be
 * both alarming and, worse, indistinguishable from a real intrusion.
 */
@Injectable()
export class ImpersonationService {
  private readonly logger = new Logger(ImpersonationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
  ) {}

  /**
   * FR-USR-031 — begin acting as somebody.
   *
   * The permission guard has already required `impersonation:create`, which is
   * Super Admin with step-up (§4.5). The rules here are the ones a permission
   * matrix cannot express: who the TARGET is, and what state they are in.
   */
  async start(targetUserId: string, reason: string, ip?: string) {
    const actor = getActor();
    if (!actor) throw new AppError("AUTH_TOKEN_INVALID");

    const reasonProblem = refuseReason(reason);
    if (reasonProblem) {
      throw new AppError("VALIDATION_FAILED", {
        details: [{ field: "reason", code: reasonProblem.code, message: reasonProblem.message }],
      });
    }

    const target = await this.prisma.asSystem((db) =>
      db.user.findFirst({
        where: { id: targetUserId },
        select: {
          id: true,
          fullName: true,
          email: true,
          status: true,
          deletedAt: true,
          roles: { select: { role: { select: { key: true } } } },
        },
      }),
    );
    if (!target) throw new AppError("RESOURCE_NOT_FOUND");

    const refusal = refuseImpersonation(
      {
        userId: actor.userId,
        roles: [...actor.roles],
        ...(actor.impersonatedBy ? { impersonatedBy: actor.impersonatedBy } : {}),
      },
      {
        id: target.id,
        roles: target.roles.map((r: (typeof target.roles)[number]) => r.role.key),
        status: target.status,
        deletedAt: target.deletedAt,
      },
    );
    if (refusal) {
      throw new AppError("AUTH_FORBIDDEN", {
        message: refusal.message,
        details: [{ field: "userId", code: refusal.code, message: refusal.message }],
      });
    }

    const expiresIn = `${IMPERSONATION_TTL_MINUTES}m`;
    const token = await this.jwt.signAsync(
      {
        sub: target.id,
        // A session id that belongs to no UserSession row, so nothing tries to
        // refresh or revoke it and it cannot be mistaken for a real login.
        sid: `imp-${randomUUID()}`,
        // SEC-AUZ-013. The middleware reads this and the audit service writes
        // it against every change the session makes.
        imp: actor.userId,
      },
      { expiresIn },
    );

    // Recorded against the TARGET, because the question later is "what happened
    // to this account", and against the impersonator by the actor fields.
    await this.audit.record({
      action: "impersonation.start",
      entityType: "User",
      entityId: target.id,
      after: {
        target: target.email,
        reason: reason.trim(),
        expiresInMinutes: IMPERSONATION_TTL_MINUTES,
        ipAddress: ip ?? null,
      },
    });

    // Loud, and at warn level. This is the one action where a line in the
    // operational log is worth having even though the audit log has it too.
    this.logger.warn(
      `IMPERSONATION: ${actor.userId} is acting as ${target.email} for ` +
        `${IMPERSONATION_TTL_MINUTES} minutes. Reason: ${reason.trim()}`,
    );

    return {
      accessToken: token,
      tokenType: "Bearer" as const,
      expiresIn: IMPERSONATION_TTL_MINUTES * 60,
      // No refreshToken, deliberately, and the field is absent rather than
      // null so a client that assumes one fails loudly here instead of
      // silently signing the user out later.
      actingAs: {
        id: target.id,
        fullName: target.fullName,
        email: target.email,
        roles: target.roles.map((r: (typeof target.roles)[number]) => r.role.key),
      },
      endsAt: new Date(Date.now() + IMPERSONATION_TTL_MINUTES * 60_000),
      message:
        `You are now acting as ${target.fullName}. This ends in ${IMPERSONATION_TTL_MINUTES} ` +
        `minutes and cannot be extended. Everything you do is recorded against your name.`,
    };
  }

  /**
   * FR-USR-033 — stop, deliberately.
   *
   * The token cannot be revoked — it is stateless and short-lived by design, and
   * adding a revocation list would mean a database read on every request to
   * solve a problem that fifteen minutes already solves. What this does is
   * RECORD the end, so the audit log shows a beginning and an end rather than a
   * beginning and a silence. The client discards the token.
   */
  async stop() {
    const actor = getActor();
    if (!actor?.impersonatedBy) {
      throw new AppError("VALIDATION_FAILED", {
        details: [
          {
            field: "session",
            code: "NOT_IMPERSONATING",
            message: "You are not acting as anybody.",
          },
        ],
      });
    }

    await this.audit.record({
      action: "impersonation.stop",
      entityType: "User",
      entityId: actor.userId,
      after: { endedBy: "user" },
    });

    this.logger.warn(`IMPERSONATION ENDED: ${actor.impersonatedBy} stopped acting as ${actor.userId}.`);

    return {
      stopped: true,
      message: "You are yourself again. Sign in again if your own session has expired.",
    };
  }

  /**
   * FR-USR-034 — who am I really?
   *
   * Read by the shell on every load so the impersonation banner cannot be
   * missed. A screen that looks exactly like somebody else's, with no
   * indication, is how a support session becomes a mistake.
   */
  async whoAmI() {
    const actor = getActor();
    if (!actor) throw new AppError("AUTH_TOKEN_INVALID");
    if (!actor.impersonatedBy) return { impersonating: false as const };

    const real = await this.prisma.asSystem((db) =>
      db.user.findFirst({
        where: { id: actor.impersonatedBy },
        select: { id: true, fullName: true, email: true },
      }),
    );

    return {
      impersonating: true as const,
      realUser: real
        ? { id: real.id, fullName: real.fullName, email: real.email }
        : { id: actor.impersonatedBy, fullName: "Unknown", email: null },
    };
  }
}
