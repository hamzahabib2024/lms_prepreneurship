import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AppError } from "@lms/shared";
import type { LiveClassroomProvider } from "./live-classroom.provider";
import { ManualProvider } from "./manual.provider";
import { GoogleMeetProvider } from "./google-meet.provider";

/**
 * The provider registry — ARC-028.
 *
 * Providers are selected at run time by configuration. Adding one means adding
 * an adapter and registering it here; no domain module changes. This file and
 * the adapter beside it are the ENTIRE surface a new provider touches, which
 * is what the substitution test at §3.4.6 verifies.
 *
 * ARC-027 permits several providers to be active at once, chosen per section,
 * so the Institute can migrate to its own classroom section by section rather
 * than as a single risky cutover.
 */
@Injectable()
export class ProviderRegistry {
  private readonly logger = new Logger(ProviderRegistry.name);
  private readonly providers = new Map<string, LiveClassroomProvider>();

  constructor(
    private readonly config: ConfigService,
    manual: ManualProvider,
    googleMeet: GoogleMeetProvider,
    // A new provider is added as a constructor parameter and one register()
    // call. Nothing else in the System is aware of it.
  ) {
    this.register(manual);
    this.register(googleMeet);
  }

  register(provider: LiveClassroomProvider): void {
    if (this.providers.has(provider.key)) {
      throw new Error(`Duplicate live provider key: ${provider.key}`);
    }
    this.providers.set(provider.key, provider);
    this.logger.log(`Registered live provider "${provider.key}"`);
  }

  /**
   * Resolves the provider for a section.
   *
   * ARC-027: a per-section key wins over the institute default, which is what
   * makes gradual migration possible.
   */
  resolve(sectionProviderKey?: string | null): LiveClassroomProvider {
    const key =
      sectionProviderKey ?? this.config.get<string>("LIVE_PROVIDER", "manual");

    const provider = this.providers.get(key);
    if (provider) return provider;

    // A misconfigured key must not take classes down. Fall back to manual,
    // which always works because a human supplies the link, and make the
    // misconfiguration loud in the logs rather than silent in the interface.
    this.logger.error(
      `Live provider "${key}" is not registered; falling back to "manual". ` +
        `Check LIVE_PROVIDER or the section's liveProviderKey.`,
    );
    const fallback = this.providers.get("manual");
    if (!fallback) throw new AppError("PROVIDER_UNAVAILABLE");
    return fallback;
  }

  get(key: string): LiveClassroomProvider {
    const provider = this.providers.get(key);
    if (!provider) throw new AppError("PROVIDER_UNAVAILABLE");
    return provider;
  }

  /** For the Super Admin integrations screen (FR-SAD-008). */
  async listWithHealth() {
    const active = this.config.get<string>("LIVE_PROVIDER", "manual");
    return Promise.all(
      [...this.providers.values()].map(async (p) => ({
        key: p.key,
        isDefault: p.key === active,
        capabilities: p.capabilities(),
        health: await p.healthCheck(),
      })),
    );
  }

  /** Exposed for the substitution test at §3.4.6. */
  keys(): string[] {
    return [...this.providers.keys()];
  }
}
