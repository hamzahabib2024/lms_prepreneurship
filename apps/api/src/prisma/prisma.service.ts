import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { scopeExtension } from "./scope.extension";
import { runUnscoped } from "./actor-context";

/**
 * The application's only database entry point.
 *
 * Every query made through this service passes the scope predicate of
 * ARC-051. Constructing a bare PrismaClient anywhere else bypasses that and is
 * prohibited — a lint rule should enforce it once the codebase grows.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  /** Scoped client — use this for everything a user asked for. */
  readonly scoped: ReturnType<PrismaClient["$extends"]>;

  constructor() {
    super({
      log: [
        { emit: "event", level: "query" },
        { emit: "event", level: "warn" },
        { emit: "event", level: "error" },
      ],
    });

    this.scoped = this.$extends(scopeExtension());

    // NFR-PRF-020: no query in a request path should exceed 200 ms. Anything
    // slower is logged for review rather than silently tolerated.
    (this as any).$on("query", (e: { duration: number; query: string }) => {
      if (e.duration > 200) {
        this.logger.warn(`Slow query ${e.duration}ms: ${e.query.slice(0, 200)}`);
      }
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log("Database connected");
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Runs system work with the scope predicate disabled.
   *
   * Legitimate callers are narrow: authentication (we must find the user before
   * we know who they are), registration provisioning (the student has no
   * session yet), scheduled jobs, and seeding. Every other use is a bug —
   * see actor-context.ts.
   */
  asSystem<T>(fn: (db: PrismaClient) => Promise<T>): Promise<T> {
    return runUnscoped(() => fn(this));
  }
}
