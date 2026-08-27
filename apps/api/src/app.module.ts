import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { exceptPasswordReset, trackByEmailAddress } from "./auth/password-reset.throttle";
import { join } from "node:path";

import { PrismaModule } from "./prisma/prisma.module";
import { AuthModule } from "./auth/auth.module";
import { AuditModule } from "./audit/audit.service";
import { AdmissionModule } from "./admission/admission.module";
import { AcademicModule } from "./academic/academic.module";
import { LiveModule } from "./live/live.module";
import { AssessmentModule } from "./assessment/assessment.module";
import { NotificationModule } from "./notification/notification.module";
import { AdminModule } from "./admin/admin.module";
import { CertificateModule } from "./certificate/certificate.module";
import { ProgressModule } from "./progress/progress.module";
import { ContentModule } from "./content/content.module";
import { IntegrationModule } from "./integration/integration.module";
import { QuizModule } from "./quiz/quiz.module";
import { ReportingModule } from "./reporting/reporting.module";
import { SettingsModule } from "./settings/settings.module";
import { PublicPageModule } from "./public-page/public-page.module";
import { PartnerModule } from "./partner/partner.module";
import { MaintenanceGuard } from "./admin/maintenance.guard";
import { FinanceModule } from "./finance/finance.module";
import { DiscussionModule } from "./discussion/discussion.module";
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

    /*
     * §7.7 — the general authenticated ceiling. Sensitive endpoints add their
     * own tighter limits (login, registration, certificate verification).
     *
     * CONFIGURABLE, and a deployment with many users on one connection has to
     * raise it. The limit is per client address, so an institute whose 150
     * students sit in a lab behind one NAT shares a single budget — at the
     * 300 default that is two requests each per minute, and the building goes
     * down together at nine o'clock. Load testing made this obvious: 43% of
     * requests came back 429 before any of them reached a query.
     *
     * TRUST_PROXY_HOPS is the other half of the same problem and is set
     * separately: without it every request behind nginx appears to come from
     * the proxy, and the whole Institute shares one budget no matter what this
     * number says.
     */
    ThrottlerModule.forRoot([
      {
        name: "default",
        ttl: 60_000,
        limit: Number(process.env["THROTTLE_LIMIT_PER_MINUTE"] ?? 300),
      },
      /*
       * THE FORGOTTEN-PASSWORD FORM, COUNTED BY MAILBOX.
       *
       * `getTracker` is set HERE rather than by subclassing the guard, because
       * a guard's tracker applies to every throttler it handles — which keyed
       * the IP backstop below by email as well, and refused a second person on
       * the same wifi. See password-reset.throttle.ts.
       */
      {
        name: "reset-address",
        ttl: 3_600_000,
        limit: Number(process.env["RESET_LIMIT_PER_ADDRESS_PER_HOUR"] ?? 3),
        getTracker: trackByEmailAddress,
        // WITHOUT THIS, three an hour applies to the ENTIRE application. The
        // guard runs every throttler in this array against every request; the
        // dashboard died on the second request of the hour. See
        // password-reset.throttle.ts.
        skipIf: exceptPasswordReset,
      },
      /*
       * AND THE BACKSTOP UNDER IT, counted by computer in the ordinary way.
       * Without this somebody could walk a list of addresses three at a time,
       * which is the enumeration the Institute accepted the risk of rather
       * than invited. Thirty an hour is far above what a real office produces
       * and far below what is useful for a scan.
       */
      {
        name: "reset-ip",
        ttl: 3_600_000,
        limit: Number(process.env["RESET_LIMIT_PER_IP_PER_HOUR"] ?? 30),
        // Same reason as above: a backstop for one form, not a ceiling on the
        // System.
        skipIf: exceptPasswordReset,
      },
    ]),

    PrismaModule,
    AuthModule,
    AuditModule,
    // Global, and early: attendance, progress and submissions all read
    // institute policy through it.
    SettingsModule,
    AdmissionModule,
    AcademicModule,
    LiveModule,
    AssessmentModule,
    ProgressModule,
    CertificateModule,
    AdminModule,
    // Before NotificationModule: its WhatsApp adapter injects the outbox.
    IntegrationModule,
    NotificationModule,
    ContentModule,
    QuizModule,
    ReportingModule,
    FinanceModule,
    DiscussionModule,
    // The landing page, as something the Institute edits rather than something a
    // developer deploys. Last, because it reads settings and announcements and
    // owns nothing itself.
    PublicPageModule,
    // Institutes that send us students. Owns nothing but itself — everything it
    // reads belongs to another module and is confined by the PARTNER scope.
    PartnerModule,
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
    // FR-OPS-012 — registered AFTER the permissions guard, so it runs after it.
    // A request that would be refused anyway should be told it is forbidden
    // rather than that the System is down: "come back later" is a worse answer
    // than the true one, and it is the answer an attacker would enjoy most.
    { provide: APP_GUARD, useClass: MaintenanceGuard },
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
