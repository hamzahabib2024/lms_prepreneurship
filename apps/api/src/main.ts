import "reflect-metadata";
import { Logger, VersioningType } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import helmet from "helmet";
import { AppModule } from "./app.module";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    logger: ["error", "warn", "log"],
  });

  // §9.1 — everything under /api/v1.
  app.setGlobalPrefix(process.env["API_PREFIX"] ?? "api/v1");

  // SEC-VAL-005/010 and SEC-CFG-005: security headers, and no framework or
  // version disclosure in responses.
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"], // no inline script (SEC-VAL-005)
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
      hsts: { maxAge: 31_536_000, includeSubDomains: true }, // SEC-CRY-002
    }),
  );
  app.getHttpAdapter().getInstance().disable("x-powered-by");

  // SEC-VAL-008 — explicit origins only; wildcard with credentials is refused.
  const origins = (process.env["WEB_ORIGIN"] ?? "http://localhost:5173")
    .split(",")
    .map((o) => o.trim());
  app.enableCors({
    origin: origins,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type", "X-Correlation-Id", "If-Match", "Idempotency-Key"],
    exposedHeaders: ["X-Correlation-Id", "X-RateLimit-Remaining", "Retry-After", "ETag"],
  });

  // API-011 — the OpenAPI document is GENERATED from the implementation, never
  // maintained by hand, so it cannot drift from what the server actually does.
  if (process.env["NODE_ENV"] !== "production") {
    const config = new DocumentBuilder()
      .setTitle("LMS API")
      .setDescription(
        "Online Learning Management System — implementation of SRS-LMS-001 v2.1. " +
          "All responses follow the standard envelope of §9.2.",
      )
      .setVersion("1.0")
      .addBearerAuth()
      .build();
    SwaggerModule.setup("docs", app, SwaggerModule.createDocument(app, config));
  }

  const port = Number(process.env["PORT"] ?? 3000);
  await app.listen(port);

  const logger = new Logger("Bootstrap");
  logger.log(`API listening on http://localhost:${port}/${process.env["API_PREFIX"] ?? "api/v1"}`);
  if (process.env["NODE_ENV"] !== "production") {
    logger.log(`API docs at http://localhost:${port}/docs`);
  }
}

void bootstrap();
