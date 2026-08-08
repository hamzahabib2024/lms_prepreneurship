import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AppError } from "@lms/shared";
import type {
  FolderEntry,
  SignedUrl,
  StorageHealth,
  StorageProvider,
  StoredObjectRef,
} from "./storage.provider";

/**
 * Google Drive — the mandated home for lecture video (CON-01).
 *
 * DEP-01 and OPN-02 are outstanding: the Institute has not yet issued a
 * service account with Drive API access. ASM-01 rates this SEVERE, because
 * without it the streaming architecture of §3.5 needs replacing by direct
 * hosting, which adds recurring storage cost and a video pipeline.
 *
 * Rather than stub plausible behaviour, this adapter reports itself unhealthy
 * and refuses clearly. A provider that pretends to work produces a catalogue
 * full of entries that fail at playback — discovered by a student, mid-revision.
 */
@Injectable()
export class GoogleDriveStorageProvider implements StorageProvider {
  readonly key = "google_drive";
  private readonly logger = new Logger(GoogleDriveStorageProvider.name);

  constructor(private readonly config: ConfigService) {}

  private get isConfigured(): boolean {
    return !!this.config.get<string>("GOOGLE_SERVICE_ACCOUNT_JSON");
  }

  private refuse(): never {
    throw new AppError("STORAGE_UNAVAILABLE", {
      message: "Lecture storage is not connected yet. Please try again shortly.",
      internal: "Google Drive service account not configured (DEP-01 / OPN-02 outstanding).",
    });
  }

  listFolder(_folderRef: string | null): Promise<FolderEntry[]> {
    if (!this.isConfigured) this.refuse();
    // TODO(DEP-01): files.list, filtering by parent folder and requesting
    // id, name, mimeType, size, videoMediaMetadata and modifiedTime.
    throw new Error("Google Drive integration not yet implemented (DEP-01).");
  }

  stat(_storageRef: string): Promise<StoredObjectRef | null> {
    // Returns null rather than throwing, so the weekly integrity check can
    // mark entries MISSING instead of failing the whole sweep (ARC-045).
    if (!this.isConfigured) return Promise.resolve(null);
    throw new Error("Google Drive integration not yet implemented (DEP-01).");
  }

  signUrl(_storageRef: string, _ttlSeconds: number): Promise<SignedUrl> {
    if (!this.isConfigured) this.refuse();
    // TODO(DEP-01): mint a short-lived download link. ARC-052 requires the
    // stream endpoint to REDIRECT to it, so bytes never traverse the app tier.
    throw new Error("Google Drive integration not yet implemented (DEP-01).");
  }

  put(): Promise<StoredObjectRef> {
    // CON-01 / BR-CNT-05 — the System catalogues and streams Drive video; it
    // never uploads to it. Teachers upload through Drive itself.
    throw new AppError("VALIDATION_FAILED", {
      message: "Lecture video is uploaded to Google Drive directly, not through the System.",
    });
  }

  get(): Promise<Buffer> {
    if (!this.isConfigured) this.refuse();
    throw new Error("Google Drive integration not yet implemented (DEP-01).");
  }

  delete(): Promise<void> {
    // The System never deletes from the Institute's Drive. Removing a
    // catalogue entry must not destroy the recording behind it.
    return Promise.resolve();
  }

  healthCheck(): Promise<StorageHealth> {
    return Promise.resolve(
      this.isConfigured
        ? { healthy: true, checkedAt: new Date() }
        : {
            healthy: false,
            detail: "Google Drive service account not configured (DEP-01 / OPN-02 outstanding).",
            checkedAt: new Date(),
          },
    );
  }
}
