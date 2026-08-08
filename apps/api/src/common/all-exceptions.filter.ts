import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from "@nestjs/common";
import { AppError, ERROR_CODES, type ErrorDetail } from "@lms/shared";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import type { Request, Response } from "express";

/**
 * Converts every thrown value into the §9.2 error envelope.
 *
 * NFR-ERR-001: no unhandled exception reaches the user.
 * NFR-ERR-002: no stack trace, SQL, file path, framework name, or internal
 *              identifier appears in the response. The detail goes to the log
 *              and the user gets a reference to quote (NFR-ERR-003).
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger("Exception");

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();

    const correlationId = req.correlationId ?? "unknown";
    const reference = `ERR-${correlationId.slice(0, 8).toUpperCase()}`;

    let status = 500;
    let code: string = "INTERNAL_ERROR";
    let message: string = ERROR_CODES.INTERNAL_ERROR.message;
    let details: ErrorDetail[] | undefined;
    let logAsError = true;

    if (exception instanceof AppError) {
      status = exception.status;
      code = exception.code;
      message = exception.message;
      details = exception.details;
      logAsError = status >= 500;
    } else if (exception instanceof ZodError) {
      // SEC-VAL-001 + NFR-ERR-005: report EVERY failing field at once, not the
      // first one — a form that reveals errors one at a time is hostile.
      status = 422;
      code = "VALIDATION_FAILED";
      message = ERROR_CODES.VALIDATION_FAILED.message;
      details = exception.issues.map((i) => ({
        field: i.path.join(".") || "_",
        code: i.code.toUpperCase(),
        message: i.message,
      }));
      logAsError = false;
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      logAsError = false;
      switch (exception.code) {
        case "P2002": // unique constraint
          status = 409;
          code = "DUPLICATE_RESOURCE";
          message = ERROR_CODES.DUPLICATE_RESOURCE.message;
          break;
        case "P2025": // record not found
          status = 404;
          code = "RESOURCE_NOT_FOUND";
          message = ERROR_CODES.RESOURCE_NOT_FOUND.message;
          break;
        case "P2003": // foreign key — usually BR-DAT-04 protecting a record
          status = 409;
          code = "RESOURCE_CONFLICT";
          message = "That record is referenced elsewhere and cannot be removed.";
          break;
        default:
          status = 500;
          code = "INTERNAL_ERROR";
          message = ERROR_CODES.INTERNAL_ERROR.message;
          logAsError = true;
      }
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      code = status === 404 ? "RESOURCE_NOT_FOUND" : status === 403 ? "AUTH_FORBIDDEN" : code;
      // Never echo a framework-generated body straight back to the client.
      message =
        status < 500 && typeof body === "object" && body !== null && "message" in body
          ? String((body as { message: unknown }).message)
          : ERROR_CODES.INTERNAL_ERROR.message;
      logAsError = status >= 500;
    }

    const logLine = {
      reference,
      correlationId,
      method: req.method,
      path: req.originalUrl,
      status,
      code,
      userId: (req as { user?: { userId?: string } }).user?.userId,
    };

    if (logAsError) {
      this.logger.error(
        JSON.stringify(logLine),
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else {
      this.logger.warn(JSON.stringify(logLine));
    }

    res.status(status).json({
      error: { code, message, ...(details ? { details } : {}), reference },
      meta: { requestId: correlationId, timestamp: new Date().toISOString() },
    });
  }
}
