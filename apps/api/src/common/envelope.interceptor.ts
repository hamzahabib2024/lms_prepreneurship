import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import { Observable, map } from "rxjs";
import type { Request } from "express";

/**
 * Wraps every successful response in the §9.2 envelope (Figure 9-1).
 *
 * A handler returns its payload; this adds `data` and `meta`. Where a handler
 * already returns `{ data, pagination }` the pagination block is preserved.
 */
@Injectable()
export class EnvelopeInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();

    return next.handle().pipe(
      map((payload: unknown) => {
        const meta = {
          requestId: req.correlationId,
          timestamp: new Date().toISOString(),
        };

        // 204 and similar — nothing to wrap.
        if (payload === undefined || payload === null) return payload;

        if (typeof payload === "object" && payload !== null && "pagination" in payload) {
          const p = payload as { data: unknown; pagination: unknown; appliedFilters?: unknown };

          // A handler that paginated but named its rows something other than
          // `data` used to get a 200 with the rows silently missing — no error,
          // nothing in the log, and the mistake only visible to whoever read
          // the response. Failing here turns a silent data loss into an obvious
          // programming error.
          if (p.data === undefined) {
            throw new Error(
              "A paginated handler returned `pagination` without `data`. §9.2 names the " +
                "rows `data`; rename the key.",
            );
          }

          return {
            data: p.data,
            pagination: p.pagination,
            meta: p.appliedFilters ? { ...meta, appliedFilters: p.appliedFilters } : meta,
          };
        }

        return { data: payload, meta };
      }),
    );
  }
}
