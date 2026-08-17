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

  healthCheck(): Promise<StorageHealth>;
}
