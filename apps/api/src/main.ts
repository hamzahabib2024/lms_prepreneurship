import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import helmet from "helmet";
import { AppModule } from "./app.module";

async function bootstrap(): Promise<void> {
  const logger = new Logger("Bootstrap");

  const app = await NestFactory.create(AppModule, {
    logger: ["error", "warn", "log"],
  });

  // §9.1 — everything under /api/v1.
  app.setGlobalPrefix(process.env["API_PREFIX"] ?? "api/v1");

  // Who the client actually is, when something is in front of us.
  //
  // Express reports the socket address unless told otherwise, so behind a
  // reverse proxy EVERY request appears to come from the proxy. That is not a
  // cosmetic problem: the throttler is a global guard keyed on the client
  // address, so the whole Institute would share ONE 300-per-minute budget and
  // rate-limit itself into failure under the 150 concurrent users of NFR-PRF;
  // the admission form's three-applications-per-hour would apply to every
  // applicant COLLECTIVELY; and the security log's account-probing detection
  // (SEC-MON) groups by address, so it would see one address for everybody and
  // detect nothing. Every login would be recorded against the proxy.
  //
  // The number is a HOP COUNT, not a boolean, and the difference matters. A
  // client can put anything in X-Forwarded-For, so trusting the header
  // outright lets an attacker change their apparent address per request and
  // walk straight through the rate limit that exists to stop them. Counting
  // hops makes Express take the entry OUR OWN proxy appended and ignore
  // whatever the client invented to the left of it.
  //
  // Defaults to 0 — trust nothing — so a direct deployment is safe by
  // omission. It is set to 1 in docker-compose.yml, where nginx is genuinely
  // the one hop in front.
  const proxyHops = Number(process.env["TRUST_PROXY_HOPS"] ?? 0);
  if (Number.isFinite(proxyHops) && proxyHops > 0) {
    app.getHttpAdapter().getInstance().set("trust proxy", proxyHops);
    logger.log(`Trusting ${proxyHops} proxy hop(s) for the client address`);
  }

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

  logger.log(`API listening on http://localhost:${port}/${process.env["API_PREFIX"] ?? "api/v1"}`);
  if (process.env["NODE_ENV"] !== "production") {
    logger.log(`API docs at http://localhost:${port}/docs`);
  }
}

void bootstrap();
