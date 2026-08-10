import { Injectable, NestMiddleware } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import type { NextFunction, Request, Response } from "express";
import { runWithActor } from "../prisma/actor-context";
import { ActorService } from "./actor.service";

declare module "express-serve-static-core" {
  interface Request {
    /** Set when a Bearer token was present but could not be accepted. */
    authError?: "expired" | "invalid";
    sessionId?: string;
  }
}

/**
 * Establishes the ambient Actor for the request.
 *
 * This runs as middleware rather than a guard so that the AsyncLocalStorage
 * context wraps EVERYTHING downstream — guards, interceptors, handlers, and
 * any async work they start. If it were a guard, the scope predicate would
 * silently see no actor in code paths that run outside the guard's frame.
 *
 * The middleware never rejects. A missing or bad token simply leaves the
 * context empty and records why; PermissionsGuard decides what to do about it,
 * so @Public routes still work.
 */
@Injectable()
export class ActorContextMiddleware implements NestMiddleware {
  constructor(
    private readonly jwt: JwtService,
    private readonly actors: ActorService,
  ) {}

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    const header = req.header("authorization");
    const token =
      header && header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : null;

    if (!token) {
      runWithActor(null, () => next());
      return;
    }

    try {
      // SEC-AUT-005: the algorithm is pinned server-side by JwtModule
      // configuration, so a token declaring `alg: none` — or any other
      // algorithm — is rejected rather than trusted.
      const claims = await this.jwt.verifyAsync<{
        sub: string;
        sid: string;
        sua?: number;
        /** SEC-AUZ-013 — the real user, when this is an impersonation token. */
        imp?: string;
      }>(token);

      // `sub` is the TARGET, so everything downstream — scope predicates,
      // permission checks, every query — behaves exactly as it would for them.
      // That is the point of impersonation and the reason `imp` must travel
      // with it: the audit service stamps it on every write, so the record says
      // who was really acting even though nothing else can tell.
      const actor = await this.actors.resolve(claims.sub, req.correlationId);
      req.sessionId = claims.sid;

      runWithActor(
        {
          ...actor,
          steppedUpAt: claims.sua,
          ...(claims.imp ? { impersonatedBy: claims.imp } : {}),
        },
        () => next(),
      );
    } catch (err) {
      const expired = err instanceof Error && err.name === "TokenExpiredError";
      req.authError = expired ? "expired" : "invalid";
      runWithActor(null, () => next());
    }
  }
}
