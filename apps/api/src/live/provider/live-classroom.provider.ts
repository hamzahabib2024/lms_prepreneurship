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

/**
 * Something that happened in a room, normalised — ARC-034.
 *
 * A provider that can tell the System when somebody arrived and left turns
 * attendance from a thing the teacher types into a thing the System proposes.
 * The shape is identical whichever provider produced it, so the attendance code
 * contains no vendor parsing and no vendor's idea of an event name.
 */
export interface RoomEvent {
  kind: "PARTICIPANT_JOINED" | "PARTICIPANT_LEFT" | "ROOM_FINISHED";
  /** The provider's room id. Matches ProviderBinding.externalId. */
  room: string;
  /** The identity the adapter issued — for this System, the LMS user id. */
  identity: string | null;
  at: Date;
  /** How long they had been in the room when they left, where it is known. */
  secondsInRoom: number | null;
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
  /**
   * Whether the teacher can see who is in the room and act on them.
   *
   * OPTIONAL, so that adding it did not force every existing adapter to be
   * edited — an absent flag means "no", which is the correct answer for the
   * manual provider and for a Meet link the System does not own. That is the
   * same shape `endSession?` already has, and ARC-030 requires the interface to
   * say a capability is missing rather than offer one that will not work.
   */
  canModerateParticipants?: boolean;
}

/**
 * Somebody in the room right now.
 *
 * Normalised, like ParticipationRecord: the shape is identical whichever
 * provider produced it, so nothing above the adapter learns a vendor's idea of
 * a participant. `identity` is the LMS user id, which is what the adapter puts
 * in the token.
 *
 * The track ids are here because muting somebody requires naming the track,
 * and they are opaque — the System passes them back and never reads them.
 */
export interface RoomParticipant {
  identity: string;
  name: string;
  joinedAt: Date;
  isPublishingAudio: boolean;
  isPublishingVideo: boolean;
  audioTrackSid: string | null;
  videoTrackSid: string | null;
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

  /**
   * Who is in the room AT THIS MOMENT — the teacher's register of the room, not
   * of the class.
   *
   * Distinct from fetchParticipation, which is a history and is what attendance
   * is built from. This is live and disappears when people leave.
   *
   * Optional: a provider that does not own the room cannot answer it, and the
   * interface says so rather than returning an empty list that would read as
   * "nobody is here".
   */
  listParticipants?(binding: ProviderBinding): Promise<RoomParticipant[]>;

  /**
   * Mute somebody — the control every classroom needs when one microphone is
   * left open in a noisy room.
   *
   * MUTE ONLY, AND DELIBERATELY SO. There is no unmute here and there will not
   * be one: a teacher who could switch a student's microphone or camera back on
   * could listen to their room and look into it without consent. Google Meet
   * draws the line in the same place, and so does LiveKit, which refuses remote
   * unmute unless a server setting is turned on. The student turns their own
   * devices back on.
   *
   * Enforced by the provider rather than by the interface hiding a button: a
   * client that can be asked nicely can also decline.
   */
  muteParticipant?(
    binding: ProviderBinding,
    identity: string,
    kind: "audio" | "video",
  ): Promise<void>;

  /** Remove somebody from the room. They can rejoin; this is not a ban. */
  removeParticipant?(binding: ProviderBinding, identity: string): Promise<void>;

  /** Empty array where unsupported — see canReportParticipation. */
  fetchParticipation(binding: ProviderBinding): Promise<ParticipationRecord[]>;
  fetchRecordingRefs(binding: ProviderBinding): Promise<RecordingReference[]>;

  /**
   * Turn a webhook the provider sent into normalised RoomEvents.
   *
   * THE ADAPTER VERIFIES THE SIGNATURE, not the controller. The endpoint is
   * necessarily public — a provider cannot sign in — so the signature is the
   * only thing standing between a stranger and the attendance register. Where
   * that check lives matters: putting it in the controller would mean the
   * controller knowing one provider's signing scheme, which is precisely the
   * knowledge ARC-025 keeps out of the domain.
   *
   * Throwing rejects the delivery. Returning an empty array accepts it and does
   * nothing, which is right for the many event kinds the System does not care
   * about.
   */
  handleWebhook?(rawBody: Buffer, authorization: string): Promise<RoomEvent[]>;

  healthCheck(): Promise<ProviderHealth>;
}
