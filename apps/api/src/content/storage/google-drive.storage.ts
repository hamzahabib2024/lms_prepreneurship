import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createSign } from "node:crypto";
import { Readable } from "node:stream";
import { loadGoogleCredentials } from "../../common/google-credentials";
import { AppError } from "@lms/shared";
import type {
  ByteRange,
  FolderEntry,
  SignedUrl,
  StorageHealth,
  StorageProvider,
  StorageStream,
  StoredObjectRef,
  UploadCapability,
  UploadInput,
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
  /**
   * TWO SCOPES, AND THE NARROW ONE IS STILL THE DEFAULT.
   *
   * Reading is all this adapter did for most of its life and read-only is the
   * right authority for it: the System catalogues and streams recordings the
   * Institute already has. Uploading a lecture from somebody's laptop needs
   * write access, and asking for it on every token — including the ones that
   * only ever list a folder — would widen the blast radius of a leaked token
   * for a feature most requests never touch.
   *
   * So tokens are minted per scope and cached per scope. A deployment that
   * never uploads never asks Google for a writable token at all.
   */
  private static readonly READ_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
  private static readonly WRITE_SCOPE = "https://www.googleapis.com/auth/drive";

  private tokens = new Map<string, { value: string; expiresAt: number }>();

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
  /** Logged once per distinct reason: `stat` runs per lecture in the weekly
   *  integrity sweep, and an unconfigured Drive would otherwise write the same
   *  line once per recording the Institute owns. */
  private loggedFailure: string | null = null;

  private credentials(): { clientEmail: string; privateKey: string } | null {
    /*
     * RESOLVED IN ONE PLACE — see common/google-credentials.ts.
     *
     * This used to read GOOGLE_SERVICE_ACCOUNT_JSON and nothing else, which is
     * a variable only docker-compose composes. Started any other way — the
     * `npm run dev` every developer uses — a perfectly valid key sitting in
     * GOOGLE_CREDENTIALS_DIR was invisible, and Drive reported itself
     * unconfigured while LECTURE_STORAGE said google_drive.
     */
    const result = loadGoogleCredentials((k) => this.config.get<string>(k, ""));
    if (!result.ok) {
      this.lastFailure = result.reason;
      if (this.loggedFailure !== result.reason) {
        this.loggedFailure = result.reason;
        this.logger.error(result.reason);
      }
      return null;
    }
    this.loggedFailure = null;
    this.lastFailure = null;
    return { clientEmail: result.credentials.clientEmail, privateKey: result.credentials.privateKey };
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
  private async accessToken(
    scope: string = GoogleDriveStorageProvider.READ_SCOPE,
  ): Promise<string> {
    const cached = this.tokens.get(scope);
    if (cached && Date.now() < cached.expiresAt) return cached.value;

    const creds = this.credentials();
    if (!creds) this.refuse();

    const now = Math.floor(Date.now() / 1000);
    const claims: Record<string, unknown> = {
      iss: creds.clientEmail,
      scope,
      aud: GoogleDriveStorageProvider.TOKEN_URL,
      iat: now,
      exp: now + 3600,
    };

    /*
     * ACTING AS A REAL PERSON, when the Institute has said who.
     *
     * A service account has no Drive storage quota of its own — measured
     * against this Institute's own project, an upload is refused with
     * `storageQuotaExceeded` even though the folder reports canAddChildren.
     * Domain-wide delegation is one of the two ways out: `sub` makes Google
     * issue the token AS that Workspace user, and the file is then owned by
     * and charged to them.
     *
     * The same variable the Meet provider uses, because it is the same grant
     * and having two would mean configuring it twice.
     */
    const subject = (this.config.get<string>("GOOGLE_IMPERSONATE_SUBJECT", "") ?? "").trim();
    if (subject) claims["sub"] = subject;

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
    const token = {
      value: body.access_token,
      expiresAt: Date.now() + (body.expires_in - 60) * 1000,
    };
    this.tokens.set(scope, token);
    return token.value;
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
  /**
   * DRIVE CANNOT SIGN A URL, and this says so rather than inventing one.
   *
   * The earlier version asked Drive for the bytes with redirect:"manual" and
   * handed the browser whatever Location came back, on the belief that Drive
   * answers 302 to a short-lived googleusercontent address. MEASURED AGAINST
   * THE INSTITUTE'S OWN DRIVE, IT DOES NOT: it answers 200 and streams the
   * file. There was no Location to hand over and never had been.
   *
   * So playback goes through openStream() below. Callers ask for that first
   * and fall back to a signed URL only for providers that genuinely have one.
   */
  signUrl(): Promise<SignedUrl> {
    return Promise.reject(
      new AppError("STORAGE_UNAVAILABLE", {
        message: "That recording could not be prepared for playback.",
        internal:
          "Google Drive has no signed URLs — it serves content directly against an OAuth " +
          "token. Playback must use openStream(). Reaching here means a caller asked for a " +
          "URL without checking for openStream first.",
      }),
    );
  }

  /**
   * The bytes, streamed — the ARC-052 deviation described on the interface.
   *
   * NEVER BUFFERED. A 363 MB recording read into memory per viewer is the
   * whole application tier gone at four concurrent students. The response body
   * is piped straight through, so memory stays flat however large the file.
   *
   * The Range header is passed to Drive and its answer mirrored back verbatim.
   * Drive honours ranges — verified against the Institute's real recordings,
   * suffix ranges included — which is what makes seeking work, and what stops
   * a player pulling a whole lecture down to show its first ten seconds.
   */
  async openStream(storageRef: string, range?: ByteRange): Promise<StorageStream> {
    if (!this.isConfigured) this.refuse();

    const url = new URL(`${GoogleDriveStorageProvider.API}/files/${encodeURIComponent(storageRef)}`);
    url.searchParams.set("alt", "media");
    url.searchParams.set("supportsAllDrives", "true");

    const headers: Record<string, string> = {
      Authorization: `Bearer ${await this.accessToken()}`,
    };
    if (range) {
      /*
       * Drive honours all three forms itself, so the header is rebuilt rather
       * than resolved. A suffix range in particular MUST reach Drive intact:
       * the length needed to turn it into an offset is only known there, and
       * dropping it turns "give me the last 2 KB" into "give me all 247 MB" —
       * which is what a player asking for an MP4's trailing index used to get.
       */
      headers["Range"] =
        range.suffix !== undefined
          ? `bytes=-${range.suffix}`
          : range.end === undefined
            ? `bytes=${range.start}-`
            : `bytes=${range.start}-${range.end}`;
    }

    const res = await fetch(url, { headers });

    if (!res.ok && res.status !== 206) {
      const body = await res.text().catch(() => "");
      const blocked =
        body.includes("cannotDownloadFile") || body.includes("cannotDownloadAbusiveFile");
      throw new AppError(blocked ? "STORAGE_UNAVAILABLE" : "RESOURCE_NOT_FOUND", {
        message: blocked
          ? "This recording cannot be played yet: downloading is turned off for its folder in Google Drive."
          : "That recording is no longer available.",
        internal: blocked
          ? `Drive refused ${storageRef} with cannotDownloadFile. Give the service account a role ` +
            `above viewer on the folder — a writer is exempt from the "viewers cannot download" ` +
            `restriction, and students never touch Drive at all.`
          : `Drive answered ${res.status} for ${storageRef}: ${body.slice(0, 200)}`,
      });
    }

    if (!res.body) {
      throw new AppError("STORAGE_UNAVAILABLE", {
        message: "That recording could not be read.",
        internal: `Drive returned ${res.status} with no body for ${storageRef}.`,
      });
    }

    const length = res.headers.get("content-length");
    return {
      status: res.status,
      contentType: res.headers.get("content-type"),
      contentLength: length ? Number(length) : null,
      contentRange: res.headers.get("content-range"),
      // Web stream to Node stream. Piped, never collected.
      body: Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]),
    };
  }

  // ────────────────────────────────────────────────────────────── writing ──

  // `async`, so it REJECTS rather than throwing synchronously. The signature
  // promises a Promise; a caller writing `provider.put(…).catch(…)` on the
  // previous version got an uncaught exception instead of their handler.
  async put(): Promise<StoredObjectRef> {
    // Small documents still do not go to Drive. Slips and submissions are the
    // Institute's records rather than shared media, and they live in the
    // System's own storage by design. A LECTURE is different, and goes through
    // putStream below.
    throw new AppError("VALIDATION_FAILED", {
      message:
        "Only lecture video is uploaded to Google Drive, and it goes through the lecture " +
        "upload rather than here.",
    });
  }

  /**
   * WILL DRIVE ACTUALLY TAKE A FILE? Asked before the transfer, not after.
   *
   * THE CONSTRAINT THIS EXISTS FOR, measured against this Institute's own
   * project rather than read in a document:
   *
   *   A GOOGLE SERVICE ACCOUNT HAS NO DRIVE STORAGE QUOTA.
   *
   * It can list the Institute's Recordings folder, read every file in it, and
   * Drive even answers `capabilities.canAddChildren: true` for that folder —
   * and the upload is still refused, 403 `storageQuotaExceeded`, because a
   * file in somebody's My Drive must be charged to somebody and a service
   * account is nobody. There are exactly two ways out and both are
   * configuration rather than code:
   *
   *   · put the folder on a SHARED DRIVE, where files are owned by the drive;
   *   · or set GOOGLE_IMPERSONATE_SUBJECT so the account acts as a real
   *     Workspace user through domain-wide delegation.
   *
   * Finding this out at upload time would mean a person waits for 300 MB to
   * cross their connection and is then told it was never going to work. So the
   * folder is inspected first: a `driveId` means a Shared Drive, and
   * impersonation is a setting we can read without asking Google anything.
   */
  async canAcceptUploads(folderRef: string | null): Promise<UploadCapability> {
    if (!this.isConfigured) {
      return { accepted: false, reason: this.lastFailure ?? "Google Drive is not connected." };
    }
    if (!folderRef) {
      return {
        accepted: false,
        reason:
          "This class has no Drive folder connected yet, so there is nowhere to put the " +
          "recording. Connect one first.",
      };
    }

    const impersonating = (
      this.config.get<string>("GOOGLE_IMPERSONATE_SUBJECT", "") ?? ""
    ).trim();

    try {
      const res = await this.api(`/files/${encodeURIComponent(folderRef)}`, {
        fields: "id, name, driveId, capabilities(canAddChildren)",
        supportsAllDrives: "true",
      });

      if (!res.ok) {
        return {
          accepted: false,
          reason:
            res.status === 404
              ? "That folder is not shared with the System, or no longer exists."
              : `Drive answered ${res.status} when asked about the folder.`,
        };
      }

      const f = (await res.json()) as {
        name?: string;
        driveId?: string;
        capabilities?: { canAddChildren?: boolean };
      };

      if (f.capabilities?.canAddChildren === false) {
        return {
          accepted: false,
          destination: f.name,
          reason:
            `The service account can read "${f.name ?? folderRef}" but not add to it. Share the ` +
            "folder with it as an Editor rather than a Viewer.",
        };
      }

      // The whole point of this method.
      if (!f.driveId && !impersonating) {
        return {
          accepted: false,
          destination: f.name,
          reason:
            `"${f.name ?? folderRef}" is in an ordinary Google Drive, and a service account has ` +
            "no storage quota of its own — Google refuses the upload however the folder is " +
            "shared. Either move the folder to a Shared Drive, or set " +
            "GOOGLE_IMPERSONATE_SUBJECT to a Workspace user the account may act as. Until then " +
            "the recording can still be stored by the System itself.",
        };
      }

      return { accepted: true, destination: f.name ?? folderRef };
    } catch (err) {
      return {
        accepted: false,
        reason: err instanceof Error ? err.message : "Drive could not be reached.",
      };
    }
  }

  /**
   * A recording, streamed into the class's Drive folder — FR-VID-002.
   *
   * RESUMABLE, NOT MULTIPART, and the file sizes decide that rather than
   * taste. Google's multipart upload wants the whole body in one request; the
   * Institute's own recordings are 130–360 MB, and a single request that size
   * fails on a dropped connection with nothing to resume from and the whole
   * transfer to do again. The resumable protocol takes a session URL first and
   * sends the bytes to it, which is also the only shape that lets the body be
   * a STREAM — the file never exists in this process's memory.
   *
   * `duplex: "half"` is not optional on a fetch with a stream body. Without it
   * Node throws "duplex option is required when sending a body as a stream",
   * and it is the sort of error that reads as a bug in the upload rather than
   * a missing flag.
   */
  async putStream(input: UploadInput): Promise<StoredObjectRef> {
    if (!this.isConfigured) this.refuse();

    const token = await this.accessToken(GoogleDriveStorageProvider.WRITE_SCOPE);

    // 1 — open a session. The metadata goes here; the bytes go to the URL it
    //     answers with.
    const start = await fetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id,name,size,mimeType,modifiedTime,videoMediaMetadata(durationMillis)",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json; charset=UTF-8",
          "X-Upload-Content-Type": input.contentType,
          "X-Upload-Content-Length": String(input.sizeBytes),
        },
        body: JSON.stringify({
          name: input.filename,
          ...(input.folderRef ? { parents: [input.folderRef] } : {}),
        }),
      },
    );

    if (!start.ok) {
      const detail = await start.text();
      throw this.uploadError(start.status, detail, input.folderRef);
    }

    const session = start.headers.get("location");
    if (!session) {
      throw new AppError("STORAGE_UNAVAILABLE", {
        message: "The recording could not be uploaded.",
        internal: "Drive accepted the resumable session request but returned no Location header.",
      });
    }

    // 2 — the bytes. One PUT, streamed.
    const put = await fetch(session, {
      method: "PUT",
      headers: {
        "Content-Type": input.contentType,
        "Content-Length": String(input.sizeBytes),
      },
      // The stream, as fetch's body. Cast because Node's DOM-shaped fetch
      // types do not name a Readable, which it accepts perfectly well.
      body: input.body as unknown as ReadableStream,
      // Required by Node's fetch for a streaming body. See the note above.
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    if (!put.ok) {
      const detail = await put.text();
      throw this.uploadError(put.status, detail, input.folderRef);
    }

    const f = (await put.json()) as DriveFile;
    this.logger.log(
      JSON.stringify({ event: "drive.upload", fileId: f.id, sizeBytes: input.sizeBytes }),
    );

    return {
      storageRef: f.id,
      sizeBytes: f.size ? Number(f.size) : input.sizeBytes,
      contentType: f.mimeType ?? input.contentType,
      durationSeconds: durationOf(f),
      lastModified: f.modifiedTime ? new Date(f.modifiedTime) : new Date(),
    };
  }

  /**
   * The refusal, named.
   *
   * `storageQuotaExceeded` is the one that will actually happen and the one
   * whose raw text sends an administrator to check their Google storage plan
   * — which is not the problem and buying more of it will not help.
   */
  private uploadError(status: number, detail: string, folderRef: string | null): AppError {
    if (detail.includes("storageQuotaExceeded") || detail.includes("do not have storage quota")) {
      return new AppError("STORAGE_UNAVAILABLE", {
        message:
          "Google refused the upload: the System's service account has no Drive storage of its " +
          "own. Move this class's folder to a Shared Drive, or set GOOGLE_IMPERSONATE_SUBJECT " +
          "to a Workspace user. The recording can be stored by the System instead in the " +
          "meantime.",
        internal: `Drive upload ${status} for folder ${folderRef}: ${detail.slice(0, 300)}`,
      });
    }
    if (status === 403 || status === 404) {
      return new AppError("STORAGE_UNAVAILABLE", {
        message:
          "Google would not accept the recording into that folder. Check the folder is shared " +
          "with the System's service account as an Editor.",
        internal: `Drive upload ${status} for folder ${folderRef}: ${detail.slice(0, 300)}`,
      });
    }
    return new AppError("STORAGE_UNAVAILABLE", {
      message: "The recording could not be uploaded to Google Drive.",
      internal: `Drive upload ${status} for folder ${folderRef}: ${detail.slice(0, 300)}`,
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
