import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
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
 * Google Meet, via Google Calendar — the Phase 1 provider (CON-03).
 *
 * Meet has no meeting-creation API of its own: a meeting is created by adding
 * conferenceData to a Calendar event. That awkwardness is precisely the kind
 * of vendor detail this layer exists to contain — it appears here and nowhere
 * else.
 *
 * DEP-01/DEP-02 are outstanding, so the Google credentials do not exist yet.
 * Rather than pretend, this adapter reports itself unhealthy and returns
 * PENDING bindings when unconfigured, which makes the System behave exactly as
 * §3.9 requires: sessions still exist and are visible, only the join route
 * degrades, and the teacher can supply a fallback link (FR-LIV-018).
 */
@Injectable()
export class GoogleMeetProvider implements LiveClassroomProvider {
  readonly key = "google_meet";
  private readonly logger = new Logger(GoogleMeetProvider.name);

  constructor(private readonly config: ConfigService) {}

  /**
   * A KEY IS NOT ENOUGH, and believing otherwise was a live trap.
   *
   * This tested only for the service-account key — which now exists, because
   * Drive uses the same one. So the moment LIVE_PROVIDER was set to
   * google_meet, this adapter declared itself configured and createSession
   * threw "not yet implemented" on EVERY class anybody scheduled. The
   * credentials arriving for one integration silently armed another.
   *
   * Meet also needs an account to act AS. A service account cannot create a
   * Meet conference on its own: Google answers
   *
   *   400 "Invalid conference type value."
   *
   * — measured against this Institute's own project. Only a real Workspace
   * user can, reached through domain-wide delegation, which is what
   * GOOGLE_IMPERSONATE_SUBJECT names. Without it there is nothing to do but
   * degrade honestly, which is what FR-LIV-004 asks for anyway.
   */
  private get isConfigured(): boolean {
    return (
      !!this.config.get<string>("GOOGLE_SERVICE_ACCOUNT_JSON") &&
      !!(this.config.get<string>("GOOGLE_IMPERSONATE_SUBJECT", "") ?? "").trim()
    );
  }

  capabilities(): ProviderCapabilities {
    return {
      canCreateScheduledMeeting: this.isConfigured,
      canProvideJoinUrl: this.isConfigured,
      // Participation comes from the Workspace Admin SDK Reports API, which is
      // a separate grant (DEP-03) and a Phase 2 item.
      canReportParticipation: false,
      canProvideRecording: false,
      canEndMeetingRemotely: false,
      supportsWaitingRoom: true,
      maxParticipants: 100, // Workspace tier dependent
    };
  }

  async createSession(req: SessionRequest): Promise<ProviderBinding> {
    if (!this.isConfigured) {
      // Not an error. The session is still created and usable; only the link
      // is missing, and FR-LIV-004 requires exactly this behaviour.
      this.logger.warn(
        `Google credentials absent (DEP-01/DEP-02); session ${req.sessionId} created without a link.`,
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

    /*
     * TODO(DEP-02): create a Calendar event with conferenceDataVersion=1 and
     * read conferenceData.entryPoints[].uri.
     *
     * DEGRADES, IT DOES NOT THROW. Throwing here failed the whole scheduling
     * transaction, so with this provider selected a teacher could not create
     * a class at all — the System went from missing one feature to refusing
     * an unrelated one. FR-LIV-004 is explicit: the session exists and is
     * usable, only the link is absent, and the teacher supplies one
     * (FR-LIV-018).
     *
     * Still no fabricated URL. A plausible link that does not work is worse
     * than an absent one, because the teacher finds out mid-class.
     */
    this.logger.warn(
      `Meet link creation is not implemented yet (DEP-02); session ${req.sessionId} ` +
        `created without one. The teacher can paste a link on the class.`,
    );
    return {
      providerKey: this.key,
      externalId: null,
      joinUrl: null,
      hostUrl: null,
      providerMetadata: { reason: "not_implemented" },
      status: "PENDING",
    };
  }

  updateSession(binding: ProviderBinding, _req: SessionRequest): Promise<ProviderBinding> {
    if (!this.isConfigured) return Promise.resolve(binding);
    throw new Error("Google Calendar integration not yet implemented (DEP-02).");
  }

  cancelSession(_binding: ProviderBinding): Promise<void> {
    if (!this.isConfigured) return Promise.resolve();
    throw new Error("Google Calendar integration not yet implemented (DEP-02).");
  }

  getJoinRoute(binding: ProviderBinding, _user: UserContext): Promise<JoinRoute> {
    if (!binding.joinUrl) {
      return Promise.resolve({
        kind: "UNAVAILABLE",
        reasonCode: binding.status === "FAILED" ? "PROVIDER_UNREACHABLE" : "LINK_NOT_SET",
        message: "The class link is not available yet. Your teacher has been notified.",
      });
    }
    // The URL is opaque to us. We do not parse it, validate its shape, or
    // assume it points at meet.google.com (ARC-025) — a teacher-supplied
    // fallback link flows through this same path.
    return Promise.resolve({
      kind: "EXTERNAL_REDIRECT",
      url: binding.joinUrl,
      opensInNewTab: true,
    });
  }

  fetchParticipation(_binding: ProviderBinding): Promise<ParticipationRecord[]> {
    // DEP-03. Empty means attendance stays MANUAL, which ARC-030 permits.
    return Promise.resolve([]);
  }

  fetchRecordingRefs(_binding: ProviderBinding): Promise<RecordingReference[]> {
    return Promise.resolve([]);
  }

  healthCheck(): Promise<ProviderHealth> {
    return Promise.resolve(
      this.isConfigured
        ? { healthy: true, checkedAt: new Date() }
        : {
            healthy: false,
            detail: "Google service account not configured (DEP-01/DEP-02 outstanding).",
            checkedAt: new Date(),
          },
    );
  }
}
