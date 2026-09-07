/**
 * The LiveKit adapter — CON-03, the Institute's own classroom.
 *
 * live.spec.ts proves the ABSTRACTION holds when a provider is swapped. This
 * file proves THIS provider behaves, and in particular that the two things
 * which are easy to get silently wrong are right:
 *
 *   - an unconfigured adapter degrades rather than throwing, so a missing
 *     LiveKit cannot stop a teacher scheduling a class (FR-LIV-004);
 *   - a student is not handed a token that lets them share their screen over
 *     the lesson.
 *
 * Nothing here reaches a LiveKit server. Token minting is local — it is an
 * HMAC over a JSON payload — so the grant matrix is fully testable offline,
 * which is the part worth testing.
 */

import { ConfigService } from "@nestjs/config";
import { LiveKitProvider } from "./provider/livekit.provider";
import { ManualProvider } from "./provider/manual.provider";
import { GoogleMeetProvider } from "./provider/google-meet.provider";
import { ProviderRegistry } from "./provider/provider.registry";
import type { PrismaService } from "../prisma/prisma.service";
import type { ProviderBinding, UserContext } from "./provider/live-classroom.provider";

const configWith = (v: Record<string, string> = {}): ConfigService =>
  ({ get: (k: string, d?: string) => v[k] ?? d }) as unknown as ConfigService;

/**
 * A LiveKit that is configured but unreachable — port 1 refuses instantly.
 *
 * Deliberately not a working server: every behaviour asserted below is meant
 * to hold when the classroom is down, which is when it matters.
 */
const CONFIGURED = {
  LIVEKIT_URL: "ws://127.0.0.1:1",
  LIVEKIT_API_KEY: "testkey",
  LIVEKIT_API_SECRET: "testsecrettestsecrettestsecrettest",
};

const prismaWith = (fullName: string | null): PrismaService =>
  ({
    asSystem: (fn: (db: unknown) => unknown) =>
      Promise.resolve(
        fn({ user: { findUnique: () => Promise.resolve(fullName ? { fullName } : null) } }),
      ),
  }) as unknown as PrismaService;

/** Prisma is down. A name is a nicety; it must not keep anybody out. */
const prismaThatThrows = (): PrismaService =>
  ({ asSystem: () => Promise.reject(new Error("db down")) }) as unknown as PrismaService;

const student: UserContext = { userId: "u-student", email: "", isHost: false };
const teacher: UserContext = { userId: "u-teacher", email: "", isHost: true };

const bindingFor = (room: string | null, status: ProviderBinding["status"] = "ACTIVE"): ProviderBinding => ({
  providerKey: "livekit",
  externalId: room,
  joinUrl: null,
  hostUrl: null,
  // null ON PURPOSE — live-session.service builds the binding this way on the
  // read path, so anything the adapter stashed at createSession is NOT here.
  providerMetadata: null,
  status,
});

const request = {
  sessionId: "11111111-2222-3333-4444-555555555555",
  title: "Founding a company",
  scheduledStart: new Date("2026-09-08T09:00:00Z"),
  scheduledEnd: new Date("2026-09-08T10:30:00Z"),
};

/** The envelope the room page unwraps. */
function openEnvelope(token: string): { url: string; jwt: string } {
  return JSON.parse(Buffer.from(token, "base64url").toString("utf8")) as { url: string; jwt: string };
}

/** A JWT payload is base64url JSON; no verification needed to inspect it. */
function claims(jwt: string): {
  sub: string;
  name?: string;
  video?: {
    room?: string;
    roomJoin?: boolean;
    roomAdmin?: boolean;
    canPublish?: boolean;
    canSubscribe?: boolean;
    canPublishSources?: string[];
  };
} {
  const payload = jwt.split(".")[1] ?? "";
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
}

describe("LiveKit adapter — unconfigured", () => {
  const provider = () => new LiveKitProvider(configWith(), prismaWith("Ayesha Khan"));

  it("reports itself unhealthy rather than pretending", async () => {
    const health = await provider().healthCheck();
    expect(health.healthy).toBe(false);
    // FR-SAD-008 — the integrations screen shows this, so it has to name what
    // is missing rather than say "error".
    expect(health.detail).toContain("LIVEKIT_URL");
  });

  it("still creates a binding, so scheduling a class cannot fail", async () => {
    const binding = await provider().createSession(request);
    expect(binding.status).toBe("PENDING");
    expect(binding.externalId).toBeNull();
    // FR-LIV-004: the session exists and is usable; only the route degrades.
    expect(binding.providerMetadata).toEqual({ reason: "not_configured" });
  });

  it("degrades the join route with a reason a student can act on", async () => {
    const route = await provider().getJoinRoute(bindingFor(null, "PENDING"), student);
    expect(route.kind).toBe("UNAVAILABLE");
    if (route.kind !== "UNAVAILABLE") throw new Error("unreachable");
    expect(route.reasonCode).toBe("PROVIDER_NOT_CONFIGURED");
    expect(route.message).not.toContain("LIVEKIT"); // no configuration talk at a student
  });

  it("advertises no capabilities it cannot deliver", () => {
    const caps = provider().capabilities();
    expect(caps.canCreateScheduledMeeting).toBe(false);
    expect(caps.canProvideJoinUrl).toBe(false);
  });
});

describe("LiveKit adapter — configured", () => {
  const provider = (prisma: PrismaService = prismaWith("Ayesha Khan")) =>
    new LiveKitProvider(configWith(CONFIGURED), prisma);

  it("binds a room even when the server is unreachable", async () => {
    // The pre-create call fails here — port 1 refuses. It must not matter:
    // LiveKit creates the room from its name when the first person joins, so a
    // classroom being down on Monday cannot stop Friday being scheduled.
    const binding = await provider().createSession(request);
    expect(binding.status).toBe("ACTIVE");
    expect(binding.externalId).toBe(`session-${request.sessionId}`);
    // Nothing upstream may be handed an off-site address for this provider.
    expect(binding.joinUrl).toBeNull();
    expect(binding.hostUrl).toBeNull();
  });

  it("returns EMBEDDED_ROUTE, which is the whole point of replacing Meet", async () => {
    const room = `session-${request.sessionId}`;
    const route = await provider().getJoinRoute(bindingFor(room), student);

    expect(route.kind).toBe("EMBEDDED_ROUTE");
    if (route.kind !== "EMBEDDED_ROUTE") throw new Error("unreachable");
    expect(route.internalPath).toBe(`/live-room/${room}`);
    // ClassPage appends its own "?t=", so a query string here would produce an
    // address with two of them and a frame that loads nothing.
    expect(route.internalPath).not.toContain("?");
  });

  it("carries the server URL inside the token, not in a build-time variable", async () => {
    const route = await provider().getJoinRoute(bindingFor("session-x"), student);
    if (route.kind !== "EMBEDDED_ROUTE") throw new Error("expected EMBEDDED_ROUTE");

    const envelope = openEnvelope(route.token);
    expect(envelope.url).toBe(CONFIGURED.LIVEKIT_URL);
    expect(envelope.jwt.split(".")).toHaveLength(3);
    // base64url, so it survives the query string ClassPage builds untouched.
    expect(route.token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("names the participant, so a tile is not labelled with a UUID", async () => {
    const route = await provider().getJoinRoute(bindingFor("session-x"), student);
    if (route.kind !== "EMBEDDED_ROUTE") throw new Error("expected EMBEDDED_ROUTE");

    const c = claims(openEnvelope(route.token).jwt);
    // Identity stays the LMS user id — a future attendance normaliser matches
    // on it — while the display name is what the classroom shows.
    expect(c.sub).toBe("u-student");
    expect(c.name).toBe("Ayesha Khan");
  });

  it("lets a student in when their name cannot be looked up", async () => {
    const route = await provider(prismaThatThrows()).getJoinRoute(bindingFor("session-x"), student);
    if (route.kind !== "EMBEDDED_ROUTE") throw new Error("expected EMBEDDED_ROUTE");
    expect(claims(openEnvelope(route.token).jwt).name).toBe("Participant");
  });

  it("scopes the token to ONE room", async () => {
    const route = await provider().getJoinRoute(bindingFor("session-abc"), student);
    if (route.kind !== "EMBEDDED_ROUTE") throw new Error("expected EMBEDDED_ROUTE");

    const grant = claims(openEnvelope(route.token).jwt).video;
    expect(grant?.roomJoin).toBe(true);
    expect(grant?.room).toBe("session-abc");
  });

  /**
   * THE GRANT THAT MATTERS.
   *
   * Screen share is the teacher's alone. A student sharing their screen over a
   * lesson is the failure every institute reports, and it is a token claim —
   * hiding the button in the interface would not prevent it.
   */
  it("gives screen share to the host and withholds it from a student", async () => {
    const hostRoute = await provider().getJoinRoute(bindingFor("session-x"), teacher);
    const studentRoute = await provider().getJoinRoute(bindingFor("session-x"), student);
    if (hostRoute.kind !== "EMBEDDED_ROUTE" || studentRoute.kind !== "EMBEDDED_ROUTE") {
      throw new Error("expected EMBEDDED_ROUTE");
    }

    const hostGrant = claims(openEnvelope(hostRoute.token).jwt).video;
    const studentGrant = claims(openEnvelope(studentRoute.token).jwt).video;

    expect(hostGrant?.canPublishSources).toContain("screen_share");
    expect(studentGrant?.canPublishSources).not.toContain("screen_share");
    // A student still speaks and is seen — this is a classroom, not a webinar.
    expect(studentGrant?.canPublishSources).toEqual(["camera", "microphone"]);
    // Mute and remove belong to whoever is running the class.
    expect(hostGrant?.roomAdmin).toBe(true);
    expect(studentGrant?.roomAdmin).toBeFalsy();
  });

  /**
   * FR-LIV-018 — the teacher overrides the classroom, and it has to work.
   *
   * They paste a link BECAUSE the room is not working for them, with a class
   * waiting. An adapter that preferred its own room here would ignore the
   * teacher at the one moment they deliberately intervened.
   */
  it("prefers a teacher's fallback link over its own room", async () => {
    const binding = { ...bindingFor("session-x"), joinUrl: "https://example.org/rescue" };
    const route = await provider().getJoinRoute(binding, student);

    expect(route.kind).toBe("EXTERNAL_REDIRECT");
    if (route.kind !== "EXTERNAL_REDIRECT") throw new Error("unreachable");
    expect(route.url).toBe("https://example.org/rescue");
  });

  it("honours a fallback link even with LiveKit unconfigured", async () => {
    // The case FR-LIV-018 was written for: the provider is unusable and the
    // class happens anyway.
    const binding = { ...bindingFor(null, "FAILED"), joinUrl: "https://example.org/rescue" };
    const route = await new LiveKitProvider(configWith(), prismaWith("Ayesha Khan")).getJoinRoute(
      binding,
      student,
    );
    expect(route.kind).toBe("EXTERNAL_REDIRECT");
  });

  /**
   * The migration case. A class scheduled while its section was on `manual` has
   * a binding with no externalId, and switching the section to livekit does not
   * re-bind it — bindings are written once, at schedule time. Such a class
   * degrades honestly, and the fallback link above is how it is rescued.
   */
  it("degrades a class scheduled before the section was switched", async () => {
    const route = await provider().getJoinRoute(bindingFor(null, "ACTIVE"), student);
    expect(route.kind).toBe("UNAVAILABLE");
    if (route.kind !== "UNAVAILABLE") throw new Error("unreachable");
    expect(route.reasonCode).toBe("LINK_NOT_SET");
  });

  /**
   * MODERATION IS A SERVER ACT, and that is not an implementation detail.
   *
   * LiveKit accepts mute and remove only from a caller holding the API secret,
   * which the browser must never hold. So these exist here rather than in the
   * room page, which means the ordinary permission check applies and the act
   * reaches the audit log.
   */
  it("offers moderation once it owns a room", () => {
    expect(provider().capabilities().canModerateParticipants).toBe(true);
    // Absent, not false, when there is no server to ask — see the note on the
    // optional flag in the interface.
    expect(
      new LiveKitProvider(configWith(), prismaWith("Ayesha Khan")).capabilities()
        .canModerateParticipants,
    ).toBe(false);
  });

  it("reports an empty room rather than failing when unconfigured", async () => {
    const unconfigured = new LiveKitProvider(configWith(), prismaWith("Ayesha Khan"));
    await expect(unconfigured.listParticipants(bindingFor("session-x"))).resolves.toEqual([]);
  });

  it("does nothing for a class that never got a room", async () => {
    // A teacher pressing mute on a class held somewhere else must not produce
    // an error; there is simply nothing to act on.
    await expect(provider().listParticipants(bindingFor(null))).resolves.toEqual([]);
    await expect(provider().muteParticipant(bindingFor(null), "u-1", "audio")).resolves.toBeUndefined();
    await expect(provider().removeParticipant(bindingFor(null), "u-1")).resolves.toBeUndefined();
  });

  /**
   * There is no unmute, by design. A teacher who could switch a student's
   * microphone or camera back on could listen to their room and look into it
   * without consent. LiveKit refuses remote unmute by default for the same
   * reason. If this ever grows a boolean, that is the argument to have first.
   */
  it("mutes only — the signature admits no unmute", () => {
    // Three parameters: binding, identity, kind. A fourth would be `muted`.
    //
    // Reflect.get rather than reading the member: pulling a method off an
    // object to look at it is the unbound-method trap, and nothing is called
    // here.
    const fn = Reflect.get(LiveKitProvider.prototype, "muteParticipant") as unknown as {
      length: number;
    };
    expect(fn.length).toBe(3);
  });

  it("refuses a route when the binding never got a room", async () => {
    const route = await provider().getJoinRoute(bindingFor(null, "FAILED"), student);
    expect(route.kind).toBe("UNAVAILABLE");
    if (route.kind !== "UNAVAILABLE") throw new Error("unreachable");
    expect(route.reasonCode).toBe("PROVIDER_UNREACHABLE");
  });

  /**
   * PARTICIPATION IS PUSHED, NOT PULLED, and the two must not be confused.
   *
   * fetchParticipation asks "who attended?" after the fact, and LiveKit cannot
   * answer it — it knows only who is connected right now, so a class asked
   * about an hour later reports nobody. Answering it by guessing would
   * under-report every class. The webhook is the route that works.
   */
  it("reports participation by webhook, and says so", () => {
    expect(provider().capabilities().canReportParticipation).toBe(true);
    // Nothing to sign a delivery with, so nothing can be reported.
    expect(
      new LiveKitProvider(configWith(), prismaWith("Ayesha Khan")).capabilities()
        .canReportParticipation,
    ).toBe(false);
  });

  it("still answers the pull side honestly, which is with nothing", async () => {
    expect(await provider().fetchParticipation(bindingFor("session-x"))).toEqual([]);
    expect(await provider().fetchRecordingRefs(bindingFor("session-x"))).toEqual([]);
  });

  /**
   * THE SIGNATURE IS THE ONLY THING GUARDING THE REGISTER.
   *
   * The webhook endpoint is public, because a media server cannot sign in. So
   * anybody on the internet can post to it, and the only reason they cannot
   * write attendance for a class they are not in is this check. If this test
   * ever goes green on a forged delivery, the register is writable by strangers.
   */
  it("rejects a delivery that is not signed", async () => {
    const body = Buffer.from(JSON.stringify({ event: "participant_joined" }), "utf8");
    await expect(provider().handleWebhook(body, "")).rejects.toThrow();
    await expect(provider().handleWebhook(body, "Bearer nonsense")).rejects.toThrow();
  });

  it("ignores webhooks entirely when it has no secret to check them with", async () => {
    // Unconfigured: it cannot verify anything, so it accepts nothing rather
    // than trusting the body.
    const unconfigured = new LiveKitProvider(configWith(), prismaWith("Ayesha Khan"));
    await expect(unconfigured.handleWebhook(Buffer.alloc(0), "")).resolves.toEqual([]);
  });

  it("reports unhealthy, with the address, when the server does not answer", async () => {
    const health = await provider().healthCheck();
    expect(health.healthy).toBe(false);
    // Swapped to http:// — the management API is not a WebSocket.
    expect(health.detail).toContain("http://127.0.0.1:1");
  });

  /**
   * THE ADDRESS THE SERVER USES IS NOT ALWAYS THE ONE THE BROWSER USES.
   *
   * Under compose, LIVEKIT_URL is ws://localhost:7880 because that is what a
   * student's browser dials — and inside the API container that name is the API
   * container, so every management call is refused and a healthy classroom is
   * reported as down. Measured on this stack: `livekit:7880` answers, and
   * `localhost:7880` does not.
   */
  it("reaches LiveKit at the management address when one is given", async () => {
    const split = new LiveKitProvider(
      configWith({ ...CONFIGURED, LIVEKIT_API_URL: "http://livekit:7880" }),
      prismaWith("Ayesha Khan"),
    );
    const health = await split.healthCheck();
    // Unreachable from the test runner, which is the point — what matters is
    // WHICH address it tried.
    expect(health.detail).toContain("http://livekit:7880");
    expect(health.detail).not.toContain("127.0.0.1");
  });

  it("still hands the browser the browser's address", async () => {
    const split = new LiveKitProvider(
      configWith({ ...CONFIGURED, LIVEKIT_API_URL: "http://livekit:7880" }),
      prismaWith("Ayesha Khan"),
    );
    const route = await split.getJoinRoute(bindingFor("session-x"), student);
    if (route.kind !== "EMBEDDED_ROUTE") throw new Error("expected EMBEDDED_ROUTE");
    // The internal name would be unresolvable from a student's machine.
    expect(openEnvelope(route.token).url).toBe(CONFIGURED.LIVEKIT_URL);
  });
});

describe("registration (ARC-028)", () => {
  const registry = (env: Record<string, string> = {}) =>
    new ProviderRegistry(
      configWith(env),
      new ManualProvider(),
      new GoogleMeetProvider(configWith(env)),
      new LiveKitProvider(configWith(env), prismaWith("Ayesha Khan")),
    );

  it("is selectable by configuration alone", () => {
    expect(registry().keys()).toContain("livekit");
    expect(registry({ LIVE_PROVIDER: "livekit" }).resolve(null).key).toBe("livekit");
  });

  /**
   * ARC-027 — the migration path. The Institute moves one section at a time
   * rather than switching every class on a server nobody has taught through.
   */
  it("runs beside the current provider, chosen per section", () => {
    const r = registry({ LIVE_PROVIDER: "manual" });
    expect(r.resolve(null).key).toBe("manual");
    expect(r.resolve("livekit").key).toBe("livekit");
  });
});
