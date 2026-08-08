import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { StorageProvider } from "./storage.provider";
import { LocalStorageProvider } from "./local.storage";
import { GoogleDriveStorageProvider } from "./google-drive.storage";

/**
 * ARC-043 — storage providers are selected by configuration, exactly as live
 * classroom providers are (ARC-028). Adding one means an adapter plus a
 * registry entry, and nothing else in the System is aware of it.
 *
 * Lecture video and System documents are resolved separately on purpose: CON-01
 * puts video in the Institute's Drive, while payment slips and submissions
 * belong in storage the System controls. One setting for both would force a
 * choice the Institute has not made.
 */
@Injectable()
export class StorageRegistry {
  private readonly logger = new Logger(StorageRegistry.name);
  private readonly providers = new Map<string, StorageProvider>();

  constructor(
    private readonly config: ConfigService,
    local: LocalStorageProvider,
    drive: GoogleDriveStorageProvider,
  ) {
    this.providers.set(local.key, local);
    this.providers.set(drive.key, drive);
  }

  /** Lecture video. Drive by mandate (CON-01); local while DEP-01 is open. */
  forLectures(): StorageProvider {
    return this.get(this.config.get<string>("LECTURE_STORAGE", "local"));
  }

  /** Documents the System itself holds: slips, submissions, notes. */
  forDocuments(): StorageProvider {
    return this.get(this.config.get<string>("DOCUMENT_STORAGE", "local"));
  }

  get(key: string): StorageProvider {
    const provider = this.providers.get(key);
    if (provider) return provider;
    // A misconfigured key must not take content down. Fall back to local and
    // make the misconfiguration loud rather than silent.
    this.logger.error(`Storage provider "${key}" is not registered; falling back to local.`);
    return this.providers.get("local") as StorageProvider;
  }

  listWithHealth() {
    return Promise.all(
      [...this.providers.values()].map(async (p) => ({
        key: p.key,
        health: await p.healthCheck(),
      })),
    );
  }

  keys(): string[] {
    return [...this.providers.keys()];
  }
}
