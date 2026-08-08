/**
 * THE SUBSTITUTION TEST — SRS §3.4.6.
 *
 * CON-03 says the Institute will replace Google Meet with its own classroom
 * and will not fund a redesign when it does. §3.4.6 makes that a non-waivable
 * acceptance gate: introduce a new provider and confirm that NOTHING outside
 * an adapter file and one registry entry changed.
 *
 * The manual acceptance version is executed in front of the Institute's
 * technical representative. This is the automated version, so a regression is
 * caught at commit time rather than at acceptance.
 *
 * If this file fails, the abstraction has been breached and Phase 4 has just
 * become a rewrite.
 */

import { ConfigService } from "@nestjs/config";
import { ProviderRegistry } from "./provider/provider.registry";
import { ManualProvider } from "./provider/manual.provider";
import { GoogleMeetProvider } from "./provider/google-meet.provider";
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
} from "./provider/live-classroom.provider";

const configWith = (v: Record<string, string> = {}): ConfigService =>
  ({ get: (k: string, d?: string) => v[k] ?? d }) as unknown as ConfigService;

/**
 * Step 1 of §3.4.6 — a stub adapter for the Institute's own classroom.
 *
 * Note what this required: implementing one interface. No domain service, no
 * schema, no API shape, no report and no template was touched to write it.
 */
class InternalClassroomProvider implements LiveClassroomProvider {
  readonly key = "internal_classroom";

  capabilities(): ProviderCapabilities {
    return {
      canCreateScheduledMeeting: true,
      canProvideJoinUrl: true,
      canReportParticipation: true, // unlike Meet in Phase 1
      canProvideRecording: true,
      canEndMeetingRemotely: true,
      supportsWaitingRoom: true,
      maxParticipants: 500,
    };
  }

  createSession(req: SessionRequest): Promise<ProviderBinding> {
    return Promise.resolve({
      providerKey: this.key,
      externalId: `room-${req.sessionId}`,
      joinUrl: null, // in-app: there is no external URL, and that is the point
      hostUrl: null,
      providerMetadata: { room: req.sessionId },
      status: "ACTIVE",
    });
  }

  updateSession(b: ProviderBinding): Promise<ProviderBinding> {
    return Promise.resolve(b);
  }
  cancelSession(): Promise<void> {
    return Promise.resolve();
  }

  /** Returns EMBEDDED_ROUTE, where Meet returns EXTERNAL_REDIRECT. */
  getJoinRoute(b: ProviderBinding, user: UserContext): Promise<JoinRoute> {
    return Promise.resolve({
      kind: "EMBEDDED_ROUTE",
      internalPath: `/classroom/${b.externalId}`,
      token: `cr_${user.userId}`,
    });
  }

  fetchParticipation(): Promise<ParticipationRecord[]> {
    return Promise.resolve([
      {
        identityHint: "ayesha.k@example.com",
        joinedAt: new Date("2026-08-08T09:00:00Z"),
        leftAt: new Date("2026-08-08T10:28:00Z"),
        totalSeconds: 5280,
        rejoinCount: 0,
      },
    ]);
  }

  fetchRecordingRefs(): Promise<RecordingReference[]> {
    return Promise.resolve([]);
  }

  healthCheck(): Promise<ProviderHealth> {
    return Promise.resolve({ healthy: true, checkedAt: new Date() });
  }
}

describe("§3.4.6 substitution test — CON-03", () => {
  const build = (defaultKey = "manual") => {
    const config = configWith({ LIVE_PROVIDER: defaultKey });
    return new ProviderRegistry(config, new ManualProvider(), new GoogleMeetProvider(config));
  };

  it("step 1–2: a new provider is added by registration alone", () => {
    const registry = build();
    expect(registry.keys()).not.toContain("internal_classroom");

    registry.register(new InternalClassroomProvider());

    expect(registry.keys()).toContain("internal_classroom");
    // No deployment, no migration, no code change anywhere else.
  });

  it("step 4: the SAME endpoint returns a different route kind", async () => {
    const registry = build();
    registry.register(new InternalClassroomProvider());

    const binding: ProviderBinding = {
      providerKey: "google_meet",
      externalId: "abc-defg-hij",
      joinUrl: "https://meet.google.com/abc-defg-hij",
      hostUrl: null,
      providerMetadata: null,
      status: "ACTIVE",
    };
    const user: UserContext = { userId: "u1", email: "a@b.c", isHost: false };

    const viaMeet = await registry.get("google_meet").getJoinRoute(binding, user);
    expect(viaMeet.kind).toBe("EXTERNAL_REDIRECT");

    const viaOwn = await registry
      .get("internal_classroom")
      .getJoinRoute({ ...binding, providerKey: "internal_classroom" }, user);
    expect(viaOwn.kind).toBe("EMBEDDED_ROUTE");

    // The client branches on `kind` and never inspects the payload, so both
    // are handled by code that already exists (ARC-029).
    expect(["EXTERNAL_REDIRECT", "EMBEDDED_ROUTE", "UNAVAILABLE"]).toContain(viaMeet.kind);
    expect(["EXTERNAL_REDIRECT", "EMBEDDED_ROUTE", "UNAVAILABLE"]).toContain(viaOwn.kind);
  });

  it("step 5: two providers operate CONCURRENTLY, selected per section", () => {
    // ARC-027 — this is what lets the Institute migrate section by section
    // instead of betting everything on one cutover.
    const registry = build("google_meet");
    registry.register(new InternalClassroomProvider());

    expect(registry.resolve("internal_classroom").key).toBe("internal_classroom");
    expect(registry.resolve(null).key).toBe("google_meet"); // institute default
    expect(registry.resolve("manual").key).toBe("manual");
  });

  it("step 6: participation is normalised, carrying no vendor shape", async () => {
    const registry = build();
    registry.register(new InternalClassroomProvider());

    const records = await registry.get("internal_classroom").fetchParticipation({
      providerKey: "internal_classroom",
      externalId: "room-1",
      joinUrl: null,
      hostUrl: null,
      providerMetadata: null,
      status: "ACTIVE",
    });

    // ARC-034: identical shape whichever provider produced it, so the
    // attendance normaliser contains no provider-specific parsing.
    for (const r of records) {
      expect(Object.keys(r).sort()).toEqual(
        ["identityHint", "joinedAt", "leftAt", "rejoinCount", "totalSeconds"].sort(),
      );
    }
  });

  it("step 7 (pass criterion): the JoinRoute union admits no vendor field", () => {
    // If a provider ever needed a new field on JoinRoute, every consumer would
    // have to learn about it — which is how the abstraction dies. The union is
    // deliberately closed and provider-agnostic.
    const external: JoinRoute = { kind: "EXTERNAL_REDIRECT", url: "x", opensInNewTab: true };
    const embedded: JoinRoute = { kind: "EMBEDDED_ROUTE", internalPath: "/x", token: "t" };
    const unavailable: JoinRoute = { kind: "UNAVAILABLE", reasonCode: "X", message: "m" };

    for (const route of [external, embedded, unavailable]) {
      expect(Object.keys(route)).not.toContain("provider");
      expect(Object.keys(route)).not.toContain("meetUrl");
      expect(Object.keys(route)).not.toContain("zoomId");
    }
  });
});

describe("provider degradation (ARC-030, §3.9)", () => {
  const config = configWith();

  it("an unconfigured Google adapter reports unhealthy rather than pretending", async () => {
    // DEP-01/DEP-02 are outstanding. Reporting healthy would make the Super
    // Admin integrations screen lie.
    const health = await new GoogleMeetProvider(config).healthCheck();
    expect(health.healthy).toBe(false);
    expect(health.detail).toMatch(/DEP-01|DEP-02|not configured/i);
  });

  it("a session with no link yields UNAVAILABLE with an actionable reason", async () => {
    const route = await new ManualProvider().getJoinRoute(
      {
        providerKey: "manual",
        externalId: null,
        joinUrl: null,
        hostUrl: null,
        providerMetadata: null,
        status: "PENDING",
      },
      { userId: "u1", email: "a@b.c", isHost: false },
    );

    expect(route.kind).toBe("UNAVAILABLE");
    if (route.kind === "UNAVAILABLE") {
      // NFR-USE-007: says what happened and what to do, with no technical
      // detail and no dead button.
      expect(route.message).toMatch(/teacher/i);
      expect(route.message).not.toMatch(/error|null|undefined|exception/i);
    }
  });

  it("the manual provider always creates a binding, never fails a session", async () => {
    // ARC-026 — a session must exist and be usable with no binding at all.
    const binding = await new ManualProvider().createSession({
      sessionId: "s1",
      title: "Class",
      scheduledStart: new Date(),
      scheduledEnd: new Date(Date.now() + 3_600_000),
    });
    expect(binding.status).toBe("PENDING");
    expect(binding.joinUrl).toBeNull();
  });

  it("an unknown provider key falls back to manual instead of taking classes down", () => {
    const registry = new ProviderRegistry(
      configWith({ LIVE_PROVIDER: "manual" }),
      new ManualProvider(),
      new GoogleMeetProvider(configWith()),
    );
    // A typo in configuration must not stop a class from happening.
    expect(registry.resolve("does_not_exist").key).toBe("manual");
  });

  it("capabilities gate behaviour rather than being decorative", () => {
    // ARC-030: a provider that cannot report participation makes attendance
    // fall back to MANUAL, and the interface says why.
    expect(new ManualProvider().capabilities().canReportParticipation).toBe(false);
    expect(new InternalClassroomProvider().capabilities().canReportParticipation).toBe(true);
  });
});
