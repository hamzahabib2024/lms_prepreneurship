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

  /**
   * A wait, in the words somebody would use.
   *
   * Rounded UP, always: telling an applicant "a minute" when it is 61 seconds
   * earns one more refusal and one more reason to distrust the page.
   */
  private describeWaitFor(seconds: number): string {
    if (seconds < 60) return `${Math.ceil(seconds)} seconds`;
    const minutes = Math.ceil(seconds / 60);
    if (minutes < 60) return minutes === 1 ? "a minute" : `${minutes} minutes`;
    const hours = Math.ceil(minutes / 60);
    return hours === 1 ? "an hour" : `${hours} hours`;
  }

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
    /** Extra context for the log only — never for the response (NFR-ERR-002). */
    let logDetail: string | undefined;

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
          // The response stays generic — naming a column tells a caller about
          // the schema. The LOG names it, because "a record with that value
          // already exists" is not something an operator can act on.
          logDetail = `unique constraint on ${JSON.stringify(exception.meta?.["target"] ?? "unknown")}`;
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
        case "P2023":
          // Malformed value for a typed column — in practice, a path parameter
          // that is not a UUID. DB-003 puts UUIDs in URLs, so anything else was
          // never a real identifier.
          //
          // This used to fall through to 500, which is wrong twice over: it
          // reports a client mistake as a server fault, and it fills the error
          // log with entries carrying a reference number that nobody can act
          // on. A crawler probing /students/1 should not raise an alert.
          status = 400;
          code = "VALIDATION_FAILED";
          message = "That identifier is not valid.";
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
      code =
        status === 404
          ? "RESOURCE_NOT_FOUND"
          : status === 403
            ? "AUTH_FORBIDDEN"
            : status === 429
              ? "RATE_LIMIT_EXCEEDED"
              : code;
      // Never echo a framework-generated body straight back to the client.
      message =
        status < 500 && typeof body === "object" && body !== null && "message" in body
          ? String((body as { message: unknown }).message)
          : ERROR_CODES.INTERNAL_ERROR.message;

      /*
       * A RATE LIMIT IS NOT A SERVER FAULT, AND SAID SO FOR MONTHS.
       *
       * The throttler raises an HttpException whose body is the string
       * "ThrottlerException: Too Many Requests", not an object — so the check
       * above fell through to INTERNAL_ERROR's wording and every 429 came back
       * as "Something went wrong at our end", under code INTERNAL_ERROR.
       *
       * On the PUBLIC APPLICATION FORM that is the worst place for it: three
       * submissions an hour is a tight and deliberate limit, so an applicant
       * who mistypes a CNIC and corrects it twice is told the Institute's
       * system is broken, when what they need to know is that they should wait.
       * They then either give up or keep pressing, which is the behaviour the
       * limit exists to stop.
       *
       * Nor is it an error worth paging anybody about: it is the limiter doing
       * its job, so it is logged as a warning rather than an error.
       */
      if (status === 429) {
        // The throttler puts the real wait in Retry-After. Saying "a moment"
        // when the window is an hour is its own kind of wrong: somebody waits
        // thirty seconds, tries again, is refused again, and concludes it is
        // broken after all.
        const retryAfter = Number(res.getHeader("Retry-After"));
        message = Number.isFinite(retryAfter) && retryAfter > 0
          ? `Too many attempts. Please try again in ${this.describeWaitFor(retryAfter)}.`
          : ERROR_CODES.RATE_LIMIT_EXCEEDED.message;
      }

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
      ...(logDetail ? { detail: logDetail } : {}),
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
