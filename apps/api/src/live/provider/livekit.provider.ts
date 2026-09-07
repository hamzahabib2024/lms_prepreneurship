import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AccessToken, RoomServiceClient, TrackSource } from "livekit-server-sdk";
import { PrismaService } from "../../prisma/prisma.service";
import type {
  JoinRoute,
  LiveClassroomProvider,
  ParticipationRecord,
  ProviderBinding,
  ProviderCapabilities,
  ProviderHealth,
  RecordingReference,
  SessionRequest,
  UserContext,
} from "./live-classroom.provider";

/**
 * LiveKit — the Institute's own classroom (CON-03).
 *
 * This is the provider CON-03 was written to allow. Meet forbids framing, so
 * it can only ever return EXTERNAL_REDIRECT and the student ends up on
 * google.com. LiveKit is a WebRTC SFU we run ourselves, so it returns
 * EMBEDDED_ROUTE and the class happens inside the LMS. Nothing above this
 * file knows the difference — ClassPage already handles both branches and was
 * not touched to add this provider.
 *
 * Everything LiveKit-shaped lives here and in the room page it addresses: the
 * room-name convention, the token, the grant matrix, the server URL. ARC-025
 * holds.
 */
@Injectable()
export class LiveKitProvider implements LiveClassroomProvider {
  readonly key = "livekit";
  private readonly logger = new Logger(LiveKitProvider.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  // --------------------------------------------------------------- config --

  private cfg(key: string): string {
    return (this.config.get<string>(key, "") ?? "").trim();
  }

  private get isConfigured(): boolean {
    return !!(
      this.cfg("LIVEKIT_URL") &&
      this.cfg("LIVEKIT_API_KEY") &&
      this.cfg("LIVEKIT_API_SECRET")
    );
  }

  /**
   * Where the SERVER reaches LiveKit — which is not always where the browser
   * does, and assuming otherwise is a live trap.
   *
   * LIVEKIT_URL is the address a STUDENT'S browser dials, so under compose it
   * is ws://localhost:7880 (a published port). Inside the API container that
   * same name is the API container itself, and every management call gets
   * ECONNREFUSED — measured, not guessed: `livekit:7880` answers 200 there and
   * `localhost:7880` refuses. The adapter would then report itself unhealthy on
   * a box where the classroom is running perfectly and students can join it.
   *
   * So the management address may be overridden. Unset — a single public
   * hostname, which is the normal production shape — it derives from
   * LIVEKIT_URL and there is still only one setting to get right.
   */
  private get httpUrl(): string {
    const explicit = this.cfg("LIVEKIT_API_URL");
    // Scheme-swapped either way: the management API is HTTP, and an override
    // pasted as wss:// is a likelier mistake than a deliberate choice.
    return (explicit || this.cfg("LIVEKIT_URL")).replace(/^ws/, "http");
  }

  private client(): RoomServiceClient {
    return new RoomServiceClient(
      this.httpUrl,
      this.cfg("LIVEKIT_API_KEY"),
      this.cfg("LIVEKIT_API_SECRET"),
    );
  }

  /**
   * Deterministic from the session id, which is what lets a class survive a
   * LiveKit outage at scheduling time: the room does not have to have been
   * created in advance for the name to be right, and LiveKit creates a room on
   * first join anyway.
   */
  private roomName(sessionId: string): string {
    return `session-${sessionId}`;
  }

  capabilities(): ProviderCapabilities {
    return {
      canCreateScheduledMeeting: this.isConfigured,
      canProvideJoinUrl: this.isConfigured,
      /*
       * FALSE ON PURPOSE, and not an oversight.
       *
       * LiveKit's listParticipants reports who is connected AT THIS INSTANT,
       * not a join/leave history, so there is nothing here to build a
       * ParticipationRecord from. Provider-derived attendance needs the webhook
       * receiver storing participant_joined/participant_left — separate work.
       * Until then ARC-030 applies: declare the capability absent, leave
       * attendance on the register the teacher already uses, and do not offer a
       * feature that would silently under-report.
       */
      canReportParticipation: false,
      // Recording needs a LiveKit Egress service and somewhere to put the
      // output. Also separate work.
      canProvideRecording: false,
      canEndMeetingRemotely: this.isConfigured,
      supportsWaitingRoom: false,
      maxParticipants: null,
    };
  }

  // -------------------------------------------------------------- session --

  async createSession(req: SessionRequest): Promise<ProviderBinding> {
    if (!this.isConfigured) {
      // FR-LIV-004 — the session still exists and is still usable. Only the
      // route degrades, and the teacher can paste a fallback link.
      this.logger.warn(
        `LiveKit is not configured; session ${req.sessionId} created without a room.`,
      );
      return {
        providerKey: this.key,
        externalId: null,
        joinUrl: null,
        hostUrl: null,
        providerMetadata: { reason: "not_configured" },
        status: "PENDING",
      };
    }

    const name = this.roomName(req.sessionId);

    /*
     * BEST EFFORT, DELIBERATELY.
     *
     * Creating the room up front sets the empty-timeout and surfaces a
     * misconfiguration early. But a LiveKit that is down on Monday must not
     * stop a teacher scheduling Friday's class, and it does not need to:
     * LiveKit creates the room on first join from the name alone. So a failure
     * here is logged and the binding is still ACTIVE.
     */
    try {
      await this.client().createRoom({
        name,
        // Survives the gap between the teacher opening the room and the first
        // student arriving — ten minutes rather than the default five.
        emptyTimeout: 10 * 60,
        departureTimeout: 5 * 60,
      });
    } catch (err) {
      this.logger.warn(
        `Could not pre-create LiveKit room "${name}" (${(err as Error).message}); ` +
          `it will be created when the first participant joins.`,
      );
    }

    return {
      providerKey: this.key,
      externalId: name,
      // There is no external URL to hand out, which is the entire point of this
      // provider: the class is reached through an internal route, and a null
      // here is what stops anything upstream linking off-site.
      joinUrl: null,
      hostUrl: null,
      providerMetadata: { room: name },
      status: "ACTIVE",
    };
  }

  /** Nothing about a LiveKit room depends on the scheduled times. */
  updateSession(binding: ProviderBinding, _req: SessionRequest): Promise<ProviderBinding> {
    return Promise.resolve(binding);
  }

  async cancelSession(binding: ProviderBinding): Promise<void> {
    await this.deleteRoom(binding);
  }

  async endSession(binding: ProviderBinding): Promise<void> {
    await this.deleteRoom(binding);
  }

  /**
   * Deleting the room disconnects anybody still in it and makes the room name
   * invalid for tokens already issued — which matters, because tokens outlive
   * the class by design. See the TTL note in getJoinRoute.
   */
  private async deleteRoom(binding: ProviderBinding): Promise<void> {
    if (!this.isConfigured || !binding.externalId) return;
    try {
      await this.client().deleteRoom(binding.externalId);
    } catch (err) {
      // Already gone is the usual reason, and it is the desired end state.
      this.logger.warn(
        `Could not delete LiveKit room "${binding.externalId}": ${(err as Error).message}`,
      );
    }
  }

  // ----------------------------------------------------------- join route --

  async getJoinRoute(binding: ProviderBinding, user: UserContext): Promise<JoinRoute> {
    /*
     * THE TEACHER'S FALLBACK LINK WINS — FR-LIV-018, and it is checked FIRST.
     *
     * setFallbackLink writes joinUrl onto the binding without clearing
     * externalId, so a session that has a LiveKit room can also carry a link a
     * teacher pasted. Preferring the room there would ignore the teacher at the
     * exact moment they overrode the System on purpose: they paste a link
     * BECAUSE the classroom is not working for them, mid-class, with students
     * waiting.
     *
     * It also covers the migration. A class scheduled while its section was on
     * `manual` has a binding with no externalId, and the section switching to
     * livekit does not go back and re-bind it — the binding is written once, at
     * schedule time. Without this branch every already-scheduled class in a
     * switched section would answer "not ready" and could not be rescued.
     *
     * The URL is opaque here, exactly as it is to the manual and Meet adapters
     * (ARC-025): it is not parsed and it is not assumed to point anywhere in
     * particular.
     */
    if (binding.joinUrl) {
      return {
        kind: "EXTERNAL_REDIRECT",
        url: binding.joinUrl,
        opensInNewTab: true,
      };
    }

    if (!this.isConfigured) {
      return {
        kind: "UNAVAILABLE",
        reasonCode: "PROVIDER_NOT_CONFIGURED",
        message: "The classroom is not available yet. Your teacher has been notified.",
      };
    }

    const room = binding.externalId;
    if (!room) {
      return {
        kind: "UNAVAILABLE",
        reasonCode: binding.status === "FAILED" ? "PROVIDER_UNREACHABLE" : "LINK_NOT_SET",
        message: "The classroom is not ready yet. Please check again shortly.",
      };
    }

    const at = new AccessToken(this.cfg("LIVEKIT_API_KEY"), this.cfg("LIVEKIT_API_SECRET"), {
      // The LMS user id, so that a later webhook-based attendance normaliser
      // can match a participant to a student without a lookup table.
      identity: user.userId,
      name: await this.displayName(user.userId),
      /*
       * A FIXED TTL, because the adapter cannot know when the class ends.
       *
       * getJoinRoute receives a binding and a user, and live-session.service
       * builds that binding with providerMetadata hardcoded to null — so the
       * end time written at createSession is not readable here. The join WINDOW
       * is enforced upstream regardless (the service answers WINDOW_CLOSED and
       * never reaches this code), so the TTL only has to outlast one class.
       */
      ttl: `${this.ttlMinutes()}m`,
    });

    at.addGrant({
      roomJoin: true,
      room,
      canSubscribe: true,
      canPublish: true,
      /*
       * Screen sharing is the teacher's. A student sharing their screen over a
       * lesson is the failure mode every institute reports, and it is a claim
       * in the token rather than a button in the interface — hiding the button
       * would not have prevented it.
       *
       * THE ENUM, NOT THE STRINGS IT SERIALISES TO. The SDK maps these through
       * trackSourceToString when it signs the token, and that function THROWS
       * on a value it does not recognise — so passing "camera" as a string
       * compiles under a looser type and then fails at the first join, which is
       * the worst possible moment to find out.
       */
      canPublishSources: user.isHost
        ? [
            TrackSource.CAMERA,
            TrackSource.MICROPHONE,
            TrackSource.SCREEN_SHARE,
            TrackSource.SCREEN_SHARE_AUDIO,
          ]
        : [TrackSource.CAMERA, TrackSource.MICROPHONE],
      // Mute and remove, for the person running the class.
      roomAdmin: user.isHost,
      canUpdateOwnMetadata: false,
    });

    return {
      kind: "EMBEDDED_ROUTE",
      internalPath: `/live-room/${room}`,
      /*
       * THE SERVER URL TRAVELS INSIDE THE TOKEN.
       *
       * The interface documents `token` as opaque and ClassPage never looks at
       * it — it forwards the value to internalPath and does nothing else with
       * it. Both ends of this string therefore belong to this adapter, which is
       * what makes the envelope legitimate rather than a trick.
       *
       * It also buys something real. internalPath cannot carry the URL, because
       * ClassPage appends its own "?t=" and a second "?" would break the
       * address. The alternatives were a build-time VITE_ variable — a second
       * copy of a setting that already lives in .env, needing a web rebuild to
       * change — or a new API endpoint, which would mean a domain change to add
       * a provider and is exactly what §3.4.6 forbids.
       */
      token: encodeEnvelope({ url: this.cfg("LIVEKIT_URL"), jwt: await at.toJwt() }),
    };
  }

  private ttlMinutes(): number {
    const raw = Number(this.cfg("LIVEKIT_TOKEN_TTL_MINUTES"));
    return Number.isFinite(raw) && raw > 0 ? raw : 240;
  }

  /**
   * The name on the video tile.
   *
   * UserContext carries userId, email and isHost, and live-session.service
   * passes an empty string for the email because Actor has no email on it — so
   * without this lookup every tile in the classroom is labelled with a UUID.
   * Read as SYSTEM: a student cannot read another user's row, and by the time
   * this runs the caller has already been authorised for this class.
   */
  private async displayName(userId: string): Promise<string> {
    try {
      const user = await this.prisma.asSystem((db) =>
        db.user.findUnique({ where: { id: userId }, select: { fullName: true } }),
      );
      return user?.fullName?.trim() || "Participant";
    } catch (err) {
      // A missing name is not a reason to keep somebody out of their class.
      this.logger.warn(`Could not resolve a display name for ${userId}: ${String(err)}`);
      return "Participant";
    }
  }

  // -------------------------------------------------- participation/health --

  fetchParticipation(_binding: ProviderBinding): Promise<ParticipationRecord[]> {
    // See canReportParticipation. Empty keeps attendance on MANUAL (ARC-030).
    return Promise.resolve([]);
  }

  fetchRecordingRefs(_binding: ProviderBinding): Promise<RecordingReference[]> {
    return Promise.resolve([]);
  }

  async healthCheck(): Promise<ProviderHealth> {
    if (!this.isConfigured) {
      return {
        healthy: false,
        detail: "LiveKit is not configured (LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET).",
        checkedAt: new Date(),
      };
    }
    try {
      // listRooms is the cheapest call that proves both reachability and that
      // the key and secret are the pair this server accepts.
      await withTimeout(this.client().listRooms(), 5000);
      return { healthy: true, checkedAt: new Date() };
    } catch (err) {
      // The Super Admin integrations screen shows this string, so it names what
      // to go and look at (FR-SAD-008).
      return {
        healthy: false,
        detail: `LiveKit unreachable at ${this.httpUrl}: ${(err as Error).message}`,
        checkedAt: new Date(),
      };
    }
  }
}

/** The shape the room page unwraps. Known to this adapter and that page only. */
export interface JoinEnvelope {
  url: string;
  jwt: string;
}

/** base64url, so the value survives a query string untouched. */
export function encodeEnvelope(envelope: JoinEnvelope): string {
  return Buffer.from(JSON.stringify(envelope), "utf8").toString("base64url");
}

/**
 * The SDK has no timeout of its own, and a health check that hangs makes the
 * integrations screen hang with it.
 */
function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    work,
    new Promise<T>((_, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
      // Do not hold the process open just to fail a health check.
      timer.unref?.();
    }),
  ]);
}
