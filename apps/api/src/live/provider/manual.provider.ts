import { Injectable } from "@nestjs/common";
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
 * The manual provider — the Institute's current practice, made explicit.
 *
 * A teacher creates a meeting wherever they like and pastes the link in. The
 * System stores it, publishes it to the right students at the right time, and
 * records who joined. That is already an improvement on posting the link to a
 * WhatsApp group where it scrolls away (§2.2.2).
 *
 * It is also the default until DEP-02 lands (Google Calendar API credentials),
 * and the permanent fallback for FR-LIV-018: when the configured provider is
 * unreachable, a teacher can still hold the class.
 *
 * Being a first-class provider rather than a special case is deliberate. If
 * "no provider" were handled by branching inside the domain, that branch would
 * be the beginning of provider knowledge leaking upward.
 */
@Injectable()
export class ManualProvider implements LiveClassroomProvider {
  readonly key = "manual";

  capabilities(): ProviderCapabilities {
    return {
      canCreateScheduledMeeting: false, // a human creates it
      canProvideJoinUrl: true, // once the teacher supplies one
      canReportParticipation: false, // nothing to ask
      canProvideRecording: false,
      canEndMeetingRemotely: false,
      supportsWaitingRoom: false,
      maxParticipants: null,
    };
  }

  /**
   * Returns a PENDING binding with no URL. ARC-026: the session exists and is
   * fully usable — visible, reportable, with an attendance register — before
   * anyone supplies a link.
   */
  createSession(_req: SessionRequest): Promise<ProviderBinding> {
    return Promise.resolve({
      providerKey: this.key,
      externalId: null,
      joinUrl: null,
      hostUrl: null,
      providerMetadata: null,
      status: "PENDING",
    });
  }

  updateSession(binding: ProviderBinding, _req: SessionRequest): Promise<ProviderBinding> {
    return Promise.resolve(binding);
  }

  cancelSession(_binding: ProviderBinding): Promise<void> {
    return Promise.resolve(); // nothing external to cancel
  }

  getJoinRoute(binding: ProviderBinding, _user: UserContext): Promise<JoinRoute> {
    if (!binding.joinUrl) {
      // ARC-030 — degrade with a reason a student can act on, not a stack
      // trace and not a dead button.
      return Promise.resolve({
        kind: "UNAVAILABLE",
        reasonCode: "LINK_NOT_SET",
        message: "Your teacher has not added the class link yet. Please check again shortly.",
      });
    }
    return Promise.resolve({
      kind: "EXTERNAL_REDIRECT",
      url: binding.joinUrl,
      opensInNewTab: true,
    });
  }

  fetchParticipation(_binding: ProviderBinding): Promise<ParticipationRecord[]> {
    return Promise.resolve([]); // attendance falls back to MANUAL
  }

  fetchRecordingRefs(_binding: ProviderBinding): Promise<RecordingReference[]> {
    return Promise.resolve([]);
  }

  healthCheck(): Promise<ProviderHealth> {
    // Nothing external to reach, so it cannot be down.
    return Promise.resolve({ healthy: true, checkedAt: new Date() });
  }
}
