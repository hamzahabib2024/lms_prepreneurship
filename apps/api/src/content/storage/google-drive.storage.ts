import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";
import { AppError } from "@lms/shared";
import type {
  FolderEntry,
  SignedUrl,
  StorageHealth,
  StorageProvider,
  StoredObjectRef,
} from "./storage.provider";

/**
 * Google Drive — the mandated home for lecture video (CON-01, DEP-01, OPN-02).
 *
 * Written against the Institute's REAL recordings rather than against the
 * documentation. Their Meet recordings look like this, one Drive folder per
 * class:
 *
 *   (Sec D) Graphic & UI/UX Class - 2026/08/13 20:58 PKT - Recording
 *   (Sec I) English Class - 2026/08/13 20:28 PKT - Recording
 *   Sec D - UI UX CLASS - 2026-06-16- recording
 *
 * mimeType video/mp4, and **no file extension on any of them**. That single
 * fact is why `contentType` exists on FolderEntry: the sync used to ask
 * whether the name ended in `.mp4`, and the answer for every recording the
 * Institute owns is no.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * AUTHENTICATION: a service account, signing its own assertion.
 *
 * No googleapis dependency. That library is large, pulls a transitive tree,
 * and all it would do here is what forty lines below do: sign a JWT with the
 * service account's private key, exchange it for an access token, and make
 * four REST calls. Fewer moving parts in the path that reaches student data.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ARC-052, honestly: DRIVE HAS NO SIGNED URLS.
 *
 * There is no equivalent of an S3 presigned link. What Drive does have is
 * this: a request for the file's bytes, carrying the service account's token,
 * answers 302 to a short-lived `googleusercontent.com` address that carries
 * its own authorisation. Following that redirect WITHOUT reading the body
 * yields exactly what ARC-052 asks for — a URL the browser fetches directly,
 * so video never crosses the application tier, expiring on its own.
 *
 * The alternatives are both worse and both were rejected:
 *
 *   Making the file link-shared and handing out `webContentLink` breaks
 *   ARC-041 absolutely — a permanent public link to a class recording, valid
 *   for anyone who ever sees it, forever.
 *
 *   Proxying the bytes breaks ARC-052 and §3.8's capacity: 150 concurrent
 *   streams through the API is the entire provisioned bandwidth spent on
 *   copying files that Google is already serving.
 *
 * VERIFICATION STATUS: everything in this file is unit-tested against
 * recorded Drive responses, and the listing shapes come from the Institute's
 * own folders. THE REDIRECT HOP IS THE ONE THING NOT YET EXERCISED AGAINST
 * LIVE DRIVE, because that needs the service account from DEP-01. If Google
 * ever answers 200 with the bytes instead of 302, `signUrl` says so in the
 * error rather than silently proxying — a failure that names itself.
 */
@Injectable()
export class GoogleDriveStorageProvider implements StorageProvider {
  readonly key = "google_drive";
  private readonly logger = new Logger(GoogleDriveStorageProvider.name);

  private static readonly TOKEN_URL = "https://oauth2.googleapis.com/token";
  private static readonly API = "https://www.googleapis.com/drive/v3";
  /** Read-only. The System catalogues and streams; it never writes to Drive. */
  private static readonly SCOPE = "https://www.googleapis.com/auth/drive.readonly";

  private token: { value: string; expiresAt: number } | null = null;

  constructor(private readonly config: ConfigService) {}

  // ─────────────────────────────────────────────────────────── credentials ──

  /**
   * The key, from a file path or from the JSON itself.
   *
   * Both are supported because the two deployments differ: a server mounts a
   * secret file, and a container platform that only has environment variables
   * pastes the JSON. Neither is preferred; refusing one costs somebody an hour.
   */
  /**
   * Why it is not configured, in words — not merely that it is not.
   *
   * These three failures were indistinguishable, and all three reported the
   * same "not configured (DEP-01)": no key set at all, a key set to a path
   * nothing can read, and a key that is unreadable JSON. The middle one is by
   * far the most common in practice and the least guessable:
   *
   *   A PATH ON THE HOST IS NOT A PATH IN THE CONTAINER. Setting
   *   E:\...\key.json works from `npm start` and cannot possibly work inside
   *   Docker — and on Windows that value also arrives MANGLED, because \v is a
   *   vertical tab, so the path in the container is not even the one that was
   *   typed.
   */
  private lastFailure: string | null = null;

  private credentials(): { clientEmail: string; privateKey: string } | null {
    const raw = (this.config.get<string>("GOOGLE_SERVICE_ACCOUNT_JSON", "") ?? "").trim();
    if (!raw || raw.endsWith("/none.json")) {
      this.lastFailure =
        "No service-account key is set (DEP-01). Put the key JSON where the API can read it " +
        "and set GOOGLE_SERVICE_ACCOUNT_FILE, or paste the JSON into GOOGLE_SERVICE_ACCOUNT_JSON.";
      return null;
    }

    let json = raw;
    if (!raw.startsWith("{")) {
      try {
        json = readFileSync(raw, "utf8");
      } catch {
        this.lastFailure =
          `The key was not found at "${raw}". ` +
          `If the API runs in Docker, that must be a path INSIDE the container — a path on ` +
          `your own machine is not visible to it. Set GOOGLE_CREDENTIALS_DIR to the folder ` +
          `holding the key and GOOGLE_SERVICE_ACCOUNT_FILE to its filename, then recreate ` +
          `the containers (npm run docker:up).`;
        this.logger.error(this.lastFailure);
        return null;
      }
    }

    try {
      const parsed = JSON.parse(json) as { client_email?: string; private_key?: string };
      if (!parsed.client_email || !parsed.private_key) {
        this.lastFailure =
          "The key has no client_email or private_key. Download it again from " +
          "Google Cloud → Service accounts → Keys, choosing JSON.";
        this.logger.error(this.lastFailure);
        return null;
      }
      this.lastFailure = null;
      return {
        clientEmail: parsed.client_email,
        // Environment variables cannot hold real newlines, so a pasted key
        // arrives with literal \n. Left unfixed, signing fails with an error
        // about PEM formatting that names nothing an administrator can act on.
        privateKey: parsed.private_key.replace(/\\n/g, "\n"),
      };
    } catch {
      this.lastFailure =
        "The key is not valid JSON. If it was pasted into .env it must be on ONE line; " +
        "if it is a path, check it points at the file and not at a folder.";
      this.logger.error(this.lastFailure);
      return null;
    }
  }

  private get isConfigured(): boolean {
    return this.credentials() !== null;
  }

  private refuse(): never {
    throw new AppError("STORAGE_UNAVAILABLE", {
      message: "Lecture storage is not connected yet. Please try again shortly.",
      internal: "Google Drive service account not configured (DEP-01 / OPN-02 outstanding).",
    });
  }

  // ──────────────────────────────────────────────────────────────── tokens ──

  /**
   * A self-signed JWT, exchanged for an access token — Google's two-legged
   * OAuth for service accounts.
   *
   * Cached until a minute before it expires. Not to the second: a token that
   * is valid when checked and expired when it arrives at Google produces an
   * intermittent 401 during exactly the busy period that made the call slow.
   */
  private async accessToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt) return this.token.value;

    const creds = this.credentials();
    if (!creds) this.refuse();

    const now = Math.floor(Date.now() / 1000);
    const claims = {
      iss: creds.clientEmail,
      scope: GoogleDriveStorageProvider.SCOPE,
      aud: GoogleDriveStorageProvider.TOKEN_URL,
      iat: now,
      exp: now + 3600,
    };

    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64(claims)}`;
    const signer = createSign("RSA-SHA256");
    signer.update(unsigned);
    const assertion = `${unsigned}.${signer.sign(creds.privateKey, "base64url")}`;

    const res = await fetch(GoogleDriveStorageProvider.TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      // The two failures that actually happen, named. "invalid_grant" almost
      // never means the key is wrong — it means the machine's clock is off, or
      // the key was deleted in the console while the JSON stayed on disk.
      throw new AppError("STORAGE_UNAVAILABLE", {
        message: "Lecture storage is not available at the moment.",
        internal:
          `Google refused the service account assertion (${res.status}): ${detail.slice(0, 300)}. ` +
          `If this says invalid_grant, check the server clock and that the key still exists.`,
      });
    }

    const body = (await res.json()) as { access_token: string; expires_in: number };
    this.token = {
      value: body.access_token,
      expiresAt: Date.now() + (body.expires_in - 60) * 1000,
    };
    return this.token.value;
  }

  private async api(path: string, params: Record<string, string> = {}): Promise<Response> {
    const url = new URL(`${GoogleDriveStorageProvider.API}${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    return fetch(url, { headers: { Authorization: `Bearer ${await this.accessToken()}` } });
  }

  // ─────────────────────────────────────────────────────────────── reading ──

  /**
   * FR-VID-003 — everything in one class's folder.
   *
   * `supportsAllDrives` and `includeItemsFromAllDrives` are not optional. A
   * Workspace institute keeps class material on a SHARED DRIVE, and without
   * both flags Drive answers 200 with an empty list — indistinguishable from
   * an empty folder, and the failure mode is a course page that is silently
   * blank rather than an error anybody investigates.
   *
   * Trashed files are excluded in the query rather than filtered afterwards:
   * a recording somebody deleted should stop appearing, and ARC-045 marks the
   * catalogue entry MISSING rather than removing it.
   */
  async listFolder(folderRef: string | null): Promise<FolderEntry[]> {
    if (!this.isConfigured) this.refuse();
    if (!folderRef) return [];

    const entries: FolderEntry[] = [];
    let pageToken: string | undefined;

    do {
      const res = await this.api("/files", {
        q: `'${folderRef.replace(/'/g, "\\'")}' in parents and trashed = false`,
        fields:
          "nextPageToken, files(id, name, mimeType, size, modifiedTime, createdTime, " +
          // capabilities, because a folder can be perfectly readable while its
          // files cannot be downloaded — the Drive sharing option that stops
          // viewers downloading. Asked for HERE so it is known at sync time
          // rather than discovered by a student pressing play.
          "thumbnailLink, capabilities(canDownload), videoMediaMetadata(durationMillis))",
        pageSize: "200",
        orderBy: "createdTime desc",
        supportsAllDrives: "true",
        includeItemsFromAllDrives: "true",
        ...(pageToken ? { pageToken } : {}),
      });

      if (!res.ok) {
        const detail = await res.text();
        if (res.status === 404) {
          throw new AppError("RESOURCE_NOT_FOUND", {
            message: "That lecture folder no longer exists, or is not shared with the System.",
            internal: `Drive 404 for folder ${folderRef}. Share the folder with the service account.`,
          });
        }
        throw new AppError("STORAGE_UNAVAILABLE", {
          message: "Could not read the lecture folder.",
          internal: `Drive files.list ${res.status}: ${detail.slice(0, 300)}`,
        });
      }

      const body = (await res.json()) as {
        nextPageToken?: string;
        files?: DriveFile[];
      };
      for (const f of body.files ?? []) entries.push(toEntry(f));
      pageToken = body.nextPageToken;
    } while (pageToken);

    return entries;
  }

  /**
   * ARC-045 — is it still there?
   *
   * Null for anything the System should treat as gone: deleted, unshared, or
   * moved out of reach. Never throws for those, because the integrity sweep
   * runs over every lecture in the Institute and one revoked share must mark
   * one lecture MISSING rather than abandon the sweep.
   */
  async stat(storageRef: string): Promise<StoredObjectRef | null> {
    if (!this.isConfigured) return null;

    try {
      const res = await this.api(`/files/${encodeURIComponent(storageRef)}`, {
        fields: "id, name, mimeType, size, modifiedTime, trashed, videoMediaMetadata(durationMillis)",
        supportsAllDrives: "true",
      });

      if (res.status === 404 || res.status === 403) return null;
      if (!res.ok) {
        this.logger.warn(`Drive files.get ${res.status} for ${storageRef}`);
        return null;
      }

      const f = (await res.json()) as DriveFile & { trashed?: boolean };
      // In the bin is gone as far as a student is concerned, and it is the
      // common case: somebody tidying Drive, not a broken integration.
      if (f.trashed) return null;

      return {
        storageRef: f.id,
        sizeBytes: f.size ? Number(f.size) : null,
        contentType: f.mimeType ?? null,
        durationSeconds: durationOf(f),
        lastModified: f.modifiedTime ? new Date(f.modifiedTime) : null,
      };
    } catch (err) {
      this.logger.warn(
        `Drive stat failed for ${storageRef}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  /**
   * ARC-039/040/052 — the short-lived address the browser fetches directly.
   *
   * See the note at the top of this file: Drive has no presigned URLs, and
   * this is the mechanism that gives the same property. The redirect target
   * carries its own authorisation and expires by itself, so nothing permanent
   * about the file ever reaches the student (ARC-041).
   *
   * `ttlSeconds` is recorded, not enforced — Google decides how long its own
   * link lives, and claiming otherwise would be a lie in the response. The
   * caller's ticket expiry is the limit that is actually enforced, and it is
   * checked before this is ever called.
   */
  async signUrl(storageRef: string, ttlSeconds: number): Promise<SignedUrl> {
    if (!this.isConfigured) this.refuse();

    const url = new URL(`${GoogleDriveStorageProvider.API}/files/${encodeURIComponent(storageRef)}`);
    url.searchParams.set("alt", "media");
    url.searchParams.set("supportsAllDrives", "true");

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${await this.accessToken()}` },
      // The whole point. Following it would download the file into the API.
      redirect: "manual",
    });

    const location = res.headers.get("location");
    if (location) {
      return {
        url: location,
        expiresAt: new Date(Date.now() + ttlSeconds * 1000),
        // Google's media hosts honour Range, which is what makes seeking work
        // (ARC-042). A player without it can only ever play from the start.
        supportsRangeRequests: true,
      };
    }

    if (res.status === 403 || res.status === 404) {
      // Google says WHY, and the difference matters enormously to whoever has
      // to fix it. "cannotDownloadFile" is not a missing file and not a
      // revoked share: it is the Drive sharing option "Viewers and commenters
      // can't download, print or copy", set on the folder or applied by a
      // Workspace policy. Nothing in this System can work around it, and no
      // amount of re-sharing with the service account will help — but it is
      // one checkbox in Drive, and saying so is the difference between a
      // five-minute fix and a day lost re-reading the integration guide.
      const body = await res.text().catch(() => "");
      const blocked = body.includes("cannotDownloadFile") || body.includes("cannotDownloadAbusiveFile");

      throw new AppError(blocked ? "STORAGE_UNAVAILABLE" : "RESOURCE_NOT_FOUND", {
        message: blocked
          ? "This recording cannot be played yet: downloading is turned off for its folder in Google Drive."
          : "That recording is no longer available.",
        internal: blocked
          ? `Drive refused ${storageRef} with cannotDownloadFile. In Drive, open the recordings ` +
            `folder → Share → the gear icon → UNTICK "Viewers and commenters can see the option ` +
            `to download, print, and copy" is the setting that BLOCKS this when ticked off. A ` +
            `Workspace-wide sharing or DLP policy can impose the same thing.`
          : `Drive returned ${res.status} for ${storageRef} — deleted, or the share was revoked.`,
      });
    }

    // Named rather than silently proxied. If Google ever serves the bytes
    // directly instead of redirecting, that is a change worth finding out
    // about from an error, not from a bandwidth bill.
    throw new AppError("STORAGE_UNAVAILABLE", {
      message: "That recording could not be prepared for playback.",
      internal:
        `Drive answered ${res.status} with no redirect for ${storageRef}. ARC-052 forbids ` +
        `proxying the bytes through the API, so playback fails here rather than doing that.`,
    });
  }

  // ────────────────────────────────────────────────────────────── writing ──

  // `async`, so it REJECTS rather than throwing synchronously. The signature
  // promises a Promise; a caller writing `provider.put(…).catch(…)` on the
  // previous version got an uncaught exception instead of their handler.
  async put(): Promise<StoredObjectRef> {
    // CON-01 / BR-CNT-05 — the System catalogues and streams Drive video; it
    // never uploads to it. Teachers upload through Drive itself, and the
    // service account holds READ-ONLY scope, so this could not succeed anyway.
    throw new AppError("VALIDATION_FAILED", {
      message: "Lecture video is uploaded to Google Drive directly, not through the System.",
    });
  }

  async get(storageRef: string): Promise<Buffer> {
    if (!this.isConfigured) this.refuse();
    // Deliberately NOT the playback path — that is signUrl. This exists for
    // the small reads the System does itself, and it follows redirects because
    // here the bytes are genuinely wanted.
    const res = await this.api(`/files/${encodeURIComponent(storageRef)}`, {
      alt: "media",
      supportsAllDrives: "true",
    });
    if (!res.ok) {
      throw new AppError("RESOURCE_NOT_FOUND", {
        message: "That file is no longer available.",
        internal: `Drive get ${res.status} for ${storageRef}`,
      });
    }
    return Buffer.from(await res.arrayBuffer());
  }

  delete(): Promise<void> {
    // The System never deletes from the Institute's Drive. Removing a
    // catalogue entry must not destroy the recording behind it — and with a
    // read-only scope it could not.
    return Promise.resolve();
  }

  /**
   * Reaches Drive, rather than checking that a variable is set.
   *
   * A health check that only reads configuration reports healthy while the key
   * is revoked, the clock is wrong, or the folder was never shared — which are
   * the three ways this actually breaks. One cheap call proves the token
   * exchange and the API both work.
   */
  async healthCheck(): Promise<StorageHealth> {
    if (!this.isConfigured) {
      return {
        healthy: false,
        // The REASON, not just the fact. Three different failures used to
        // report the same "not configured", and the commonest of them — a host
        // path that the container cannot see — is the least guessable.
        detail: this.lastFailure ?? "Google Drive is not configured (DEP-01).",
        checkedAt: new Date(),
      };
    }

    try {
      const res = await this.api("/about", { fields: "user(emailAddress)" });
      if (!res.ok) {
        return {
          healthy: false,
          detail: `Drive answered ${res.status}. The key may have been revoked.`,
          checkedAt: new Date(),
        };
      }
      const body = (await res.json()) as { user?: { emailAddress?: string } };
      return {
        healthy: true,
        detail: `Connected as ${body.user?.emailAddress ?? "the service account"}.`,
        checkedAt: new Date(),
      };
    } catch (err) {
      return {
        healthy: false,
        detail: err instanceof Error ? err.message : "Drive is unreachable.",
        checkedAt: new Date(),
      };
    }
  }
}

// ───────────────────────────────────────────────────────────────── helpers ──

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  createdTime?: string;
  thumbnailLink?: string;
  capabilities?: { canDownload?: boolean };
  videoMediaMetadata?: { durationMillis?: string };
}

const FOLDER_MIME = "application/vnd.google-apps.folder";

/** Milliseconds as a string, which is how Drive sends a duration. */
function durationOf(f: DriveFile): number | null {
  const ms = f.videoMediaMetadata?.durationMillis;
  if (!ms) return null;
  const n = Number(ms);
  return Number.isFinite(n) && n > 0 ? Math.round(n / 1000) : null;
}

function toEntry(f: DriveFile): FolderEntry {
  return {
    storageRef: f.id,
    name: f.name,
    isFolder: f.mimeType === FOLDER_MIME,
    sizeBytes: f.size ? Number(f.size) : null,
    durationSeconds: durationOf(f),
    // createdTime, not modifiedTime, and the Institute's own data is why:
    // renaming a recording months later moves modifiedTime to the day somebody
    // tidied the folder, and the class would then be dated to that day.
    modifiedAt: f.createdTime
      ? new Date(f.createdTime)
      : f.modifiedTime
        ? new Date(f.modifiedTime)
        : null,
    contentType: f.mimeType ?? null,
    thumbnailUrl: f.thumbnailLink ?? null,
    canDownload: f.capabilities?.canDownload,
  };
}
