/**
 * THE LIVE CLASSROOM ABSTRACTION LAYER — SRS §3.4.
 *
 * This interface exists because of CON-03. The Institute has stated that it
 * intends to replace Google Meet with its own classroom, and that it will not
 * fund a redesign of the LMS when it does.
 *
 * Everything a conferencing vendor knows lives behind this boundary. Nothing
 * above it — no domain service, no database column, no API response, no
 * report, no notification template — may name a provider, construct a provider
 * URL, or parse one (ARC-025).
 *
 * Conformance is not a matter of good intentions. It is verified at acceptance
 * by the substitution test at §3.4.6: introduce a stub provider and confirm
 * that NOTHING outside an adapter file and one registry entry changed. The
 * automated version of that test is live.spec.ts.
 */

/**
 * How a user reaches a live class.
 *
 * This is the critical abstraction. The interface renders a join control from
 * `kind` alone and never inspects the payload, which is why swapping Google
 * Meet for an in-house classroom changes nothing above this layer: Meet
 * returns EXTERNAL_REDIRECT, an in-house classroom returns EMBEDDED_ROUTE, and
 * the client already handles both.
 */
export type JoinRoute =
  | { kind: "EXTERNAL_REDIRECT"; url: string; opensInNewTab: boolean }
  | { kind: "EMBEDDED_ROUTE"; internalPath: string; token: string }
  | { kind: "UNAVAILABLE"; reasonCode: string; message: string; retryAfter?: Date };

/** What the System stores about a provider's meeting. The only vendor-aware shape. */
export interface ProviderBinding {
  providerKey: string;
  externalId: string | null;
  /** Opaque. Never parsed, pattern-matched, or validated by the System. */
  joinUrl: string | null;
  hostUrl: string | null;
  providerMetadata: Record<string, unknown> | null;
  status: "PENDING" | "ACTIVE" | "FAILED" | "REVOKED";
}

export interface SessionRequest {
  sessionId: string;
  title: string;
  description?: string | null;
  scheduledStart: Date;
  scheduledEnd: Date;
  hostEmail?: string | null;
  attendeeEmails?: string[];
}

export interface UserContext {
  userId: string;
  email: string;
  isHost: boolean;
}

/**
 * Participation, normalised. ARC-034: the shape is identical whichever
 * provider produced it, so the attendance normaliser contains no
 * provider-specific parsing.
 */
export interface ParticipationRecord {
  identityHint: string; // email or provider handle, matched by the System
  joinedAt: Date;
  leftAt: Date | null;
  totalSeconds: number;
  rejoinCount: number;
}

export interface RecordingReference {
  externalId: string;
  storageRef: string;
  durationSeconds: number | null;
  recordedOn: Date;
}

/**
 * What a provider can do.
 *
 * ARC-030 requires graceful degradation rather than failure when a capability
 * is missing: a provider that cannot report participation makes attendance
 * fall back to MANUAL, and the interface says why rather than silently
 * offering a feature that will not work.
 */
export interface ProviderCapabilities {
  canCreateScheduledMeeting: boolean;
  canProvideJoinUrl: boolean;
  canReportParticipation: boolean;
  canProvideRecording: boolean;
  canEndMeetingRemotely: boolean;
  supportsWaitingRoom: boolean;
  maxParticipants: number | null;
}

export interface ProviderHealth {
  healthy: boolean;
  detail?: string;
  checkedAt: Date;
}

/**
 * Every conferencing provider implements this and nothing else touches it.
 *
 * Adding a provider means writing one class and adding one registry entry
 * (ARC-028). If it ever requires changing a domain module, a schema, an API
 * shape, a report or a template, the abstraction has been breached.
 */
export interface LiveClassroomProvider {
  /** Stable key stored on the binding, e.g. "google_meet". */
  readonly key: string;

  capabilities(): ProviderCapabilities;

  createSession(req: SessionRequest): Promise<ProviderBinding>;
  updateSession(binding: ProviderBinding, req: SessionRequest): Promise<ProviderBinding>;
  cancelSession(binding: ProviderBinding): Promise<void>;
  endSession?(binding: ProviderBinding): Promise<void>;

  /** Returns a JoinRoute, never a bare URL. The System never inspects it. */
  getJoinRoute(binding: ProviderBinding, user: UserContext): Promise<JoinRoute>;

  /** Empty array where unsupported — see canReportParticipation. */
  fetchParticipation(binding: ProviderBinding): Promise<ParticipationRecord[]>;
  fetchRecordingRefs(binding: ProviderBinding): Promise<RecordingReference[]>;

  healthCheck(): Promise<ProviderHealth>;
}
