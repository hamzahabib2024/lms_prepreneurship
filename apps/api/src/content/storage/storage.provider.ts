import type { Readable } from "node:stream";

/**
 * Storage abstraction — SRS ARC-043.
 *
 * The same provider-independence obligation as the LCAL (ARC-001), for the
 * same reason: CON-01 keeps lecture video in the Institute's Google Drive
 * today, but the Institute must not be locked to that choice. Moving to object
 * storage or a media service should be an adapter, not a migration.
 *
 * Two rules govern everything below this interface:
 *
 *   ARC-041 — a permanent storage identifier or public link NEVER reaches a
 *   student. They receive a short-lived, user-bound ticket instead.
 *
 *   ARC-052 — video bytes are NEVER proxied through the application tier. The
 *   stream endpoint redirects to a short-lived signed URL so media flows
 *   directly from storage to the browser. Proxying 150 concurrent streams
 *   would consume the entire capacity provisioned in §3.8.
 */

export interface StoredObjectRef {
  /** Opaque provider identifier. Never exposed to a student. */
  storageRef: string;
  sizeBytes: number | null;
  contentType: string | null;
  durationSeconds: number | null;
  lastModified: Date | null;
}

export interface SignedUrl {
  url: string;
  expiresAt: Date;
  /** True when the browser may issue HTTP range requests (ARC-042 seeking). */
  supportsRangeRequests: boolean;
}

export interface FolderEntry {
  storageRef: string;
  name: string;
  isFolder: boolean;
  sizeBytes: number | null;
  durationSeconds: number | null;
  modifiedAt: Date | null;
  /**
   * WHAT THE FILE IS, which is not the same as what it is called.
   *
   * The sync used to decide "is this a video?" from the extension on the name,
   * and that is wrong against the data it exists to read: a Google Meet
   * recording arrives in Drive named
   *
   *   (Sec D) Graphic & UI/UX Class - 2026/08/13 20:58 PKT - Recording
   *
   * with NO EXTENSION AT ALL and `mimeType: "video/mp4"`. Every one of the
   * Institute's recordings looks like that, so an extension test catalogued
   * none of them and the course page stayed empty while the folder filled up.
   *
   * Null when a provider genuinely cannot tell — local disk infers from the
   * extension, which is all it has — and the caller then falls back to the
   * name. Providers that know must say.
   */
  contentType: string | null;
  /**
   * A still from the video, if the provider makes one. Drive does; local disk
   * does not. Null is normal and the interface draws its own cover instead —
   * never a broken image.
   */
  thumbnailUrl?: string | null;
  /**
   * Whether the provider will actually hand the bytes over.
   *
   * A folder can be perfectly readable while its files cannot be downloaded:
   * Google Drive has a sharing option that stops viewers downloading, set per
   * folder or by a Workspace policy. Listing succeeds, cataloguing succeeds,
   * and PLAYBACK IS REFUSED — which, without this, is discovered by a student
   * pressing play on a lecture the System listed as available.
   *
   * Undefined when the provider cannot say; only an explicit false is a no.
   */
  canDownload?: boolean;
}

/** One recording on its way in. The stream is consumed exactly once. */
export interface UploadInput {
  /** Where it goes. A Drive folder id, or a prefix under local storage. */
  folderRef: string | null;
  /** What the person called it. A LABEL — never used as a path (SEC-FIL-005). */
  filename: string;
  contentType: string;
  /** Known in advance because it came from a file on disk. Drive needs it. */
  sizeBytes: number;
  body: Readable;
}

export interface UploadCapability {
  accepted: boolean;
  /** Present when `accepted` is false. Says what to do, not merely what failed. */
  reason?: string;
  /** Where the file would land, for a panel that has to say so before sending. */
  destination?: string;
}

export interface StorageHealth {
  healthy: boolean;
  detail?: string;
  checkedAt: Date;
}

export interface StorageProvider {
  readonly key: string;

  /** FR-VID-003 — browse the configured folders from inside the interface. */
  listFolder(folderRef: string | null): Promise<FolderEntry[]>;

  /** Confirms an object still exists — ARC-045 integrity checking. */
  stat(storageRef: string): Promise<StoredObjectRef | null>;

  /**
   * Mints a short-lived signed URL. ARC-040 bounds the lifetime; the caller
   * has already authorised the request (ARC-039).
   */
  signUrl(storageRef: string, ttlSeconds: number): Promise<SignedUrl>;

  /** Used for documents the System itself stores (slips, submissions, notes). */
  put(key: string, body: Buffer, contentType: string): Promise<StoredObjectRef>;
  get(storageRef: string): Promise<Buffer>;
  delete(storageRef: string): Promise<void>;

  /**
   * A LECTURE, PUT THERE FROM SOMEBODY'S LAPTOP — streamed, never buffered.
   *
   * `put()` takes a Buffer, which is correct for a payment slip and impossible
   * for a recording: the Institute's own files run from 130 MB to 360 MB, and
   * reading one into memory to store it costs the whole application tier per
   * upload. This takes a stream and the size, and providers push it through
   * without ever holding it.
   *
   * OPTIONAL, because not every provider can accept one and the honest answer
   * differs by provider. `canAcceptUploads()` says so BEFORE a person picks a
   * 300 MB file, waits for it to cross the network, and is then told no.
   */
  putStream?(
    input: UploadInput,
  ): Promise<StoredObjectRef>;

  /**
   * Whether an upload would be accepted, and if not, WHY — in words an
   * administrator can act on.
   *
   * This exists because of a constraint no code can work around, discovered by
   * measuring rather than by reading: a Google service account HAS NO DRIVE
   * STORAGE QUOTA. It can list the Institute's folder, read every recording in
   * it, and is even reported `canAddChildren: true` — and an upload is refused
   * with `storageQuotaExceeded`, because a file in somebody's My Drive has to
   * be charged to somebody and a service account is nobody. The folder must be
   * on a Shared Drive, or the account must act as a real Workspace user
   * through domain-wide delegation.
   *
   * An interface that only found this out at upload time would waste the whole
   * transfer before saying so.
   */
  canAcceptUploads?(folderRef: string | null): Promise<UploadCapability>;

  healthCheck(): Promise<StorageHealth>;

  /**
   * Read the bytes out, for a provider that CANNOT hand the browser a URL.
   *
   * Google Drive is one, and it is not a preference: the Drive API serves file
   * content directly from googleapis.com against an OAuth token — measured,
   * not assumed — with no presigned-link equivalent. The only ways to give a
   * browser a fetchable Drive URL are to make the file link-shared, which is a
   * permanent public link to a paid course recording (ARC-041), or to publish
   * it to the web. Both are far worse than proxying.
   *
   * ARC-052 SAYS DO NOT PROXY, and this is a deviation from it, recorded as
   * one rather than quietly taken. §3.8 sized the application tier assuming
   * video never crosses it; with Drive it must. Range requests are passed
   * through — Drive honours them — so seeking still works and a player fetches
   * only what it plays rather than the whole file.
   *
   * Absent on a provider that can sign a URL. Local storage can, and still
   * redirects, exactly as before.
   */
  openStream?(storageRef: string, range?: ByteRange): Promise<StorageStream>;
}

/** One byte range a player asked for. */
export interface ByteRange {
  start: number;
  end?: number;
}

/** What a proxying provider hands back: a live stream, never a buffer. */
export interface StorageStream {
  /** 200 for the whole file, 206 for a range — mirrored from the source. */
  status: number;
  contentType: string | null;
  contentLength: number | null;
  /** Present on a 206, verbatim, so the browser can seek. */
  contentRange: string | null;
  body: Readable;
}
