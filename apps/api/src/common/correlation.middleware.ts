import { Injectable, NestMiddleware } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

declare module "express-serve-static-core" {
  interface Request {
    correlationId: string;
  }
}

/**
 * ARC-008 / NFR-LOG-003 — every request carries a correlation identifier that
 * is threaded through logs, background jobs, and outbound provider calls, so a
 * single user action can be traced end to end.
 */
@Injectable()
export class CorrelationMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.header("x-correlation-id");
    // Only accept a client-supplied id if it is a well-formed UUID, so the
    // field cannot be used to inject arbitrary text into the logs.
    const id =
      incoming && /^[0-9a-f-]{36}$/i.test(incoming) ? incoming : randomUUID();
    req.correlationId = id;
    res.setHeader("X-Correlation-Id", id);
    next();
  }
}
