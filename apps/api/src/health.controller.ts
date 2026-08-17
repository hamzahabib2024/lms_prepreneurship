import { Controller, Get } from "@nestjs/common";
import { PrismaService } from "./prisma/prisma.service";
import { StorageRegistry } from "./content/storage/storage.registry";
import { Public } from "./rbac/permissions.guard";

/**
 * NFR-AVL-010 — reports the status of the application and each dependency, so
 * an external monitor (NFR-MON-007) can detect an outage independently of the
 * System's own infrastructure.
 */
@Controller("system")
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageRegistry,
  ) {}

  @Public()
  @Get("health")
  async health() {
    const checks: Record<string, { status: "up" | "down"; latencyMs?: number; detail?: string }> =
      {};

    const started = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks["database"] = { status: "up", latencyMs: Date.now() - started };
    } catch {
      checks["database"] = {
        status: "down",
        // Safe to surface here: this endpoint is for operators, and the text
        // is our own, not the driver's (NFR-ERR-002).
        detail: "unreachable",
      };
    }

    // Redis genuinely is not configured and nothing needs it — playback
    // tickets were the only caller and they live in the database now.
    checks["redis"] = { status: "down", detail: "not configured" };

    /*
     * STORAGE, ASKED RATHER THAN ASSUMED.
     *
     * This line was hardcoded to `down: "not configured (DEP-01)"`. It was
     * written as a placeholder and it outlived the adapter it was waiting for:
     * once Drive worked, this would still have reported it down — for ever,
     * on the endpoint an external monitor watches (NFR-MON-007). A red light
     * that cannot turn green is worth no more than a green one that cannot
     * turn red, and it is the same fault in the other direction.
     *
     * It reports the LECTURE provider specifically, because that is the one
     * whose failure a student notices. Local storage answers instantly;
     * Drive's check is one call to /about, which is also the only way to find
     * out that a key has been revoked or a clock has drifted.
     */
    const provider = this.storage.forLectures();
    const storageStarted = Date.now();
    try {
      const health = await provider.healthCheck();
      checks["storage"] = {
        status: health.healthy ? "up" : "down",
        latencyMs: Date.now() - storageStarted,
        detail: health.detail ?? provider.key,
      };
    } catch (err) {
      // A provider that throws must not take the health endpoint down with it:
      // the monitor would then see the whole API as unreachable, when the
      // database and every other route are fine.
      checks["storage"] = {
        status: "down",
        detail: err instanceof Error ? err.message : "unreachable",
      };
    }

    const allUp = Object.values(checks).every((c) => c.status === "up");
    return {
      status: allUp ? "healthy" : "degraded",
      version: process.env["npm_package_version"] ?? "0.1.0",
      uptimeSeconds: Math.round(process.uptime()),
      checks,
    };
  }
}
