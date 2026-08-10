import { CanActivate, ExecutionContext, Injectable, Logger, SetMetadata } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AppError, resolvePermission, type Action, type Resource, type Scope } from "@lms/shared";
import type { Request } from "express";
import { getActor } from "../prisma/actor-context";
import { refuseWhileImpersonating } from "../admin/impersonation-rules";

export const PERMISSION_KEY = "lms:permission";
export const PUBLIC_KEY = "lms:public";

/**
 * Marks a route as reachable without authentication.
 *
 * SEC-AUT-001 limits these to: public registration submission, registration
 * status lookup, certificate verification, the public catalogue, login, and
 * password reset. Adding one anywhere else needs a documented reason.
 */
export const Public = (): MethodDecorator => SetMetadata(PUBLIC_KEY, true);

/** Declares the resource and action a route exercises, per the §4.5 matrix. */
export const RequirePermission = (resource: Resource, action: Action): MethodDecorator =>
  SetMetadata(PERMISSION_KEY, { resource, action });

declare module "express-serve-static-core" {
  interface Request {
    /** Scope granted for this route — for handlers that need to vary output. */
    grantedScope?: Scope;
  }
}

/**
 * Enforces ROLE ∩ ACTION (§4.1).
 *
 * This guard deliberately does NOT enforce SCOPE. That is the job of the
 * Prisma extension (ARC-051), applied at the data layer so it cannot be
 * forgotten. This guard answers "may this user perform this KIND of
 * operation?"; the extension answers "on WHICH records?".
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  private readonly logger = new Logger("Authz");

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const required = this.reflector.getAllAndOverride<{ resource: Resource; action: Action }>(
      PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );

    const req = context.switchToHttp().getRequest<Request>();
    const actor = getActor();

    if (!actor) {
      throw new AppError("AUTH_TOKEN_INVALID");
    }

    // A non-public route with no declared permission is a programming error.
    // Fail closed: an undeclared route must never be reachable by default.
    if (!required) {
      this.logger.error(
        `Route ${req.method} ${req.originalUrl} has no @RequirePermission and is not @Public.`,
      );
      throw new AppError("AUTH_FORBIDDEN");
    }

    // SEC-AUZ-013 — checked BEFORE the matrix, because the question is not
    // whether the target may do this. They may; that is exactly the problem.
    // An impersonator who can change a password locks the owner out and can
    // thereafter sign in directly, with nothing marked as impersonation at all.
    if (actor.impersonatedBy) {
      const refusal = refuseWhileImpersonating(required.resource, required.action);
      if (refusal.refused) {
        this.logger.warn(
          JSON.stringify({
            event: "impersonation.refused",
            impersonator: actor.impersonatedBy,
            actingAs: actor.userId,
            resource: required.resource,
            action: required.action,
            path: req.originalUrl,
            correlationId: actor.correlationId,
          }),
        );
        throw new AppError("AUTH_FORBIDDEN", { message: refusal.message ?? "" });
      }
    }

    const decision = resolvePermission(
      {
        roles: actor.roles,
        subPermissions: actor.subPermissions,
        steppedUp: this.isStepUpFresh(actor.steppedUpAt),
      },
      required.resource,
      required.action,
    );

    if (!decision.allowed) {
      // SEC-LOG-005 / FR-RBAC-005: every denial is logged with actor,
      // attempted action, resource, and reason.
      this.logger.warn(
        JSON.stringify({
          event: "permission.denied",
          userId: actor.userId,
          roles: actor.roles,
          resource: required.resource,
          action: required.action,
          reason: decision.reason,
          path: req.originalUrl,
          correlationId: actor.correlationId,
        }),
      );

      if (decision.reason === "step_up_required") {
        throw new AppError("AUTH_STEP_UP_REQUIRED");
      }
      // SEC-AUZ-006: 403 always, never 404 — existence is not disclosed.
      throw new AppError("AUTH_FORBIDDEN");
    }

    req.grantedScope = decision.scope;
    return true;
  }

  /** SEC-AUZ-011 — step-up is valid for a bounded window (CFG-SEC-08). */
  private isStepUpFresh(steppedUpAt?: number): boolean {
    if (!steppedUpAt) return false;
    const windowMs = 10 * 60 * 1000;
    return Date.now() - steppedUpAt <= windowMs;
  }
}
