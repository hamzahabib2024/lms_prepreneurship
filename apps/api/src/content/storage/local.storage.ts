import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHmac, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { AppError } from "@lms/shared";
import type {
  FolderEntry,
  SignedUrl,
  StorageHealth,
  StorageProvider,
  StoredObjectRef,
} from "./storage.provider";

/**
 * Local-disk storage — development, and the fallback until DEP-01 lands.
 *
 * Deliberately implements the SAME signing contract as a cloud provider
 * rather than shortcutting to plain file paths. If development used unsigned
 * paths, the signing code would only ever execute in production, which is
 * exactly where nobody wants to discover it is wrong.
 */
@Injectable()
export class LocalStorageProvider implements StorageProvider {
  readonly key = "local";
  private readonly logger = new Logger(LocalStorageProvider.name);
  private readonly root: string;
  private readonly secret: string;

  constructor(private readonly config: ConfigService) {
    this.root = resolve(this.config.get<string>("LOCAL_STORAGE_ROOT", "./storage"));
    this.secret = this.config.get<string>("LOCAL_STORAGE_SECRET", "dev-only-signing-secret");
  }

  /**
   * SEC-FIL-005 — a storage reference must never escape the root.
   *
   * The check is on the RESOLVED path, because "a/../../etc/passwd" only
   * reveals itself as traversal after resolution.
   */
  private safePath(storageRef: string): string {
    const full = resolve(join(this.root, storageRef));
    if (full !== this.root && !full.startsWith(this.root + sep)) {
      this.logger.error(`Blocked path traversal attempt: ${storageRef}`);
      throw new AppError("AUTH_FORBIDDEN");
    }
    return full;
  }

  async listFolder(folderRef: string | null): Promise<FolderEntry[]> {
    const dir = this.safePath(folderRef ?? "");
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      return await Promise.all(
        entries.map(async (d) => {
          const rel = join(folderRef ?? "", d.name).replace(/\\/g, "/");
          const s = await stat(join(dir, d.name)).catch(() => null);
          return {
            storageRef: rel,
            name: d.name,
            isFolder: d.isDirectory(),
            sizeBytes: s && d.isFile() ? s.size : null,
            durationSeconds: null, // needs media probing; not available locally
            modifiedAt: s?.mtime ?? null,
          };
        }),
      );
    } catch {
      return [];
    }
  }

  async stat(storageRef: string): Promise<StoredObjectRef | null> {
    try {
      const s = await stat(this.safePath(storageRef));
      return {
        storageRef,
        sizeBytes: s.size,
        contentType: null,
        durationSeconds: null,
        lastModified: s.mtime,
      };
    } catch {
      return null; // ARC-045 — the caller marks the catalogue entry MISSING
    }
  }

  /**
   * An HMAC-signed, expiring reference. The signature covers the reference AND
   * the expiry, so neither can be altered without invalidating it.
   */
  signUrl(storageRef: string, ttlSeconds: number): Promise<SignedUrl> {
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    const exp = Math.floor(expiresAt.getTime() / 1000);
    const sig = createHmac("sha256", this.secret).update(`${storageRef}:${exp}`).digest("hex");
    const base = this.config.get<string>("API_PUBLIC_URL", "http://localhost:3000");

    return Promise.resolve({
      url: `${base}/api/v1/media/${encodeURIComponent(storageRef)}?exp=${exp}&sig=${sig}`,
      expiresAt,
      supportsRangeRequests: true,
    });
  }

  /** Verifies a signature produced by signUrl. Constant-time on the digest. */
  verifySignature(storageRef: string, exp: number, sig: string): boolean {
    if (exp * 1000 < Date.now()) return false;
    const expected = createHmac("sha256", this.secret)
      .update(`${storageRef}:${exp}`)
      .digest("hex");
    if (expected.length !== sig.length) return false;
    let diff = 0;
    for (let i = 0; i < expected.length; i++) {
      diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
    }
    return diff === 0;
  }

  async put(key: string, body: Buffer, contentType: string): Promise<StoredObjectRef> {
    // SEC-FIL-005 — a System-generated name. The original filename is kept as
    // metadata and never used as a path.
    const ref = `${key}/${randomUUID()}`;
    const full = this.safePath(ref);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, body);
    return {
      storageRef: ref,
      sizeBytes: body.length,
      contentType,
      durationSeconds: null,
      lastModified: new Date(),
    };
  }

  get(storageRef: string): Promise<Buffer> {
    return readFile(this.safePath(storageRef));
  }

  async delete(storageRef: string): Promise<void> {
    await unlink(this.safePath(storageRef)).catch(() => undefined);
  }

  async healthCheck(): Promise<StorageHealth> {
    try {
      await mkdir(this.root, { recursive: true });
      return { healthy: true, detail: `local: ${this.root}`, checkedAt: new Date() };
    } catch (err) {
      return { healthy: false, detail: (err as Error).message, checkedAt: new Date() };
    }
  }
}
