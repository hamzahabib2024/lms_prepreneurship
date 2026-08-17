import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHmac, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
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
/**
 * Anchors a relative storage root to the repository, not to the working
 * directory.
 *
 * The API runs from apps/api under `npm run dev` and from the repository root
 * under `npm start`. `resolve("./storage")` therefore produced two different
 * directories depending on how it was started — and unlike the JWT key path,
 * which throws when it looks in the wrong place, this failure is SILENT: the
 * provider happily creates the new directory, and every file uploaded under
 * the other one becomes unreachable with no error anywhere.
 *
 * An absolute path is honoured untouched, which is what production sets.
 */
function resolveStorageRoot(configured: string): string {
  if (isAbsolute(configured)) return resolve(configured);

  let dir = process.cwd();
  for (let depth = 0; depth < 5; depth++) {
    // The workspace root is the package.json that declares workspaces. Using
    // .git would fail in a deployed tarball, which has no repository.
    const manifest = join(dir, "package.json");
    if (existsSync(manifest)) {
      try {
        const parsed = JSON.parse(readFileSync(manifest, "utf8")) as { workspaces?: unknown };
        if (parsed.workspaces) return resolve(dir, configured);
      } catch {
        // An unreadable package.json is not our problem to report here.
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // No workspace root found. Falling back to cwd keeps a standalone deployment
  // working rather than refusing to start.
  return resolve(configured);
}

/**
 * The only thing a filesystem can tell you about a file's type.
 *
 * Deliberately narrow: the video types the System catalogues, plus the
 * document types it serves back. Anything else is left null rather than
 * guessed, because a wrong content type on a download is worse than none —
 * the browser acts on it.
 */
const CONTENT_TYPES: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/x-m4v",
  mov: "video/quicktime",
  webm: "video/webm",
  mkv: "video/x-matroska",
  avi: "video/x-msvideo",
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

function guessContentType(name: string): string | null {
  const ext = name.split(".").pop()?.toLowerCase();
  return (ext && CONTENT_TYPES[ext]) ?? null;
}

@Injectable()
export class LocalStorageProvider implements StorageProvider {
  readonly key = "local";
  private readonly logger = new Logger(LocalStorageProvider.name);
  private readonly root: string;
  private readonly secret: string;

  constructor(private readonly config: ConfigService) {
    this.root = resolveStorageRoot(this.config.get<string>("LOCAL_STORAGE_ROOT", "./storage"));
    this.secret = this.config.get<string>("LOCAL_STORAGE_SECRET", "dev-only-signing-secret");
    this.logger.log(`Local storage root: ${this.root}`);
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
            // The extension is genuinely all a filesystem knows. Said as a
            // guess rather than left null, so the caller gets the same shape
            // from both providers and the difference stays in one place.
            contentType: d.isFile() ? guessContentType(d.name) : null,
            thumbnailUrl: null,
            // A file on our own disk is always readable by us.
            canDownload: true,
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

    /*
     * ROOT-RELATIVE, so it works wherever the System is reached from.
     *
     * This was `API_PUBLIC_URL` with a default of http://localhost:3000 — the
     * API's own port. In the Docker deployment the browser reaches everything
     * through nginx on 8080, and nothing publishes 3000, so the redirect sent
     * every viewer to an address their machine cannot open. On a real server
     * it would have sent them to localhost.
     *
     * There is nothing to configure here and nothing that can be configured
     * wrongly: the browser is already on the origin that serves this API — the
     * nginx container makes it same-origin in production and the Vite proxy
     * does in development, which is the arrangement that makes CORS behave
     * identically in both. A relative Location is resolved against the request
     * URL by every browser, so it is correct in both without being told which.
     */
    return Promise.resolve({
      url: `/api/v1/media/${encodeURIComponent(storageRef)}?exp=${exp}&sig=${sig}`,
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

  /**
   * The absolute path, for the one caller that must stream rather than read.
   *
   * `get()` returns a Buffer, which is right for a payment slip and wrong for
   * a 363 MB lecture: it would load the whole recording into memory per
   * viewer. The media route needs a path it can open a read stream on and
   * serve byte ranges from, so it gets one — through the SAME traversal check
   * as every other path in this class, which is why this exists at all rather
   * than the route joining the root itself.
   */
  resolvePath(storageRef: string): string {
    return this.safePath(storageRef);
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
