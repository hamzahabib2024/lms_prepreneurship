import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { join } from "node:path";

import { PrismaModule } from "./prisma/prisma.module";
import { AuthModule } from "./auth/auth.module";
import { AuditModule } from "./audit/audit.service";
import { AdmissionModule } from "./admission/admission.module";
import { AcademicModule } from "./academic/academic.module";
import { LiveModule } from "./live/live.module";
import { HealthController } from "./health.controller";

import { CorrelationMiddleware } from "./common/correlation.middleware";
import { ActorContextMiddleware } from "./auth/actor-context.middleware";
import { EnvelopeInterceptor } from "./common/envelope.interceptor";
import { AllExceptionsFilter } from "./common/all-exceptions.filter";
import { PermissionsGuard } from "./rbac/permissions.guard";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // The repo root holds a single .env shared by the workspaces.
      envFilePath: [join(process.cwd(), ".env"), join(process.cwd(), "../../.env")],
    }),

    // §7.7 — the general authenticated ceiling. Sensitive endpoints add their
    // own tighter limits (login, registration, certificate verification).
    ThrottlerModule.forRoot([{ name: "default", ttl: 60_000, limit: 300 }]),

    PrismaModule,
    AuthModule,
    AuditModule,
    AdmissionModule,
    AcademicModule,
    LiveModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: EnvelopeInterceptor },
    // Order matters: throttle first (cheap), then authorise.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // ARC-003 — applied globally so a new route is protected by default. A
    // route without @RequirePermission or @Public is refused, not allowed.
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      // Correlation first so every later log line carries the id (ARC-008),
      // then the actor context, which must wrap everything downstream.
      .apply(CorrelationMiddleware, ActorContextMiddleware)
      .forRoutes("*");
  }
}
