import { Controller, Get } from "@nestjs/common";
import { PrismaService } from "./prisma/prisma.service";
import { Public } from "./rbac/permissions.guard";

/**
 * NFR-AVL-010 — reports the status of the application and each dependency, so
 * an external monitor (NFR-MON-007) can detect an outage independently of the
 * System's own infrastructure.
 */
@Controller("system")
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get("health")
  async health() {
    const checks: Record<string, { status: "up" | "down"; latencyMs?: number; detail?: string }> =
      {};

    const started = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks["database"] = { status: "up", latencyMs: Date.now() - started };
    } catch (err) {
      checks["database"] = {
        status: "down",
        // Safe to surface here: this endpoint is for operators, and the text
        // is our own, not the driver's (NFR-ERR-002).
        detail: "unreachable",
      };
    }

    // Placeholders until the adapters land — each will report independently so
    // the failure-mode table in §3.9 can be observed rather than inferred.
    checks["redis"] = { status: "down", detail: "not configured" };
    checks["storage"] = { status: "down", detail: "not configured (DEP-01)" };

    const allUp = Object.values(checks).every((c) => c.status === "up");
    return {
      status: allUp ? "healthy" : "degraded",
      version: process.env["npm_package_version"] ?? "0.1.0",
      uptimeSeconds: Math.round(process.uptime()),
      checks,
    };
  }
}
