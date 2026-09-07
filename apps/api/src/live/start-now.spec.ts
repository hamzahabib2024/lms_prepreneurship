/**
 * "Start a class now" — FR-LIV, the ad-hoc case.
 *
 * The System could only hold a class somebody had booked in advance, so every
 * revision hour and picked-up slot happened outside it: a link in WhatsApp,
 * no register, no record the class occurred (§2.2.2).
 *
 * What is asserted here is the BOUNDARY — what a client is allowed to ask for.
 * The service itself is deliberately thin: it computes two timestamps and calls
 * schedule(), so the clash check, the provider binding, the attendance register
 * and the audit entry are the same code that a booked class goes through, and
 * are already covered by their own tests.
 */

import { startNowSchema } from "./live.controller";
import { LiveKitProvider } from "./provider/livekit.provider";
import { ManualProvider } from "./provider/manual.provider";
import { ConfigService } from "@nestjs/config";
import type { PrismaService } from "../prisma/prisma.service";
import type { LiveClassroomProvider, ProviderBinding } from "./provider/live-classroom.provider";

const configWith = (v: Record<string, string> = {}): ConfigService =>
  ({ get: (k: string, d?: string) => v[k] ?? d }) as unknown as ConfigService;

const SUBJECT = "11111111-2222-3333-4444-555555555555";

describe("what an instant class may ask for", () => {
  it("needs only the subject — everything else has an answer already", () => {
    const parsed = startNowSchema.parse({ sectionSubjectId: SUBJECT });
    expect(parsed.sectionSubjectId).toBe(SUBJECT);
    // Absent, not defaulted here: the service names the class after the subject
    // and picks the length, because those need the database and this does not.
    expect(parsed.title).toBeUndefined();
    expect(parsed.durationMinutes).toBeUndefined();
  });

  it("refuses a class with no subject", () => {
    expect(() => startNowSchema.parse({})).toThrow();
    expect(() => startNowSchema.parse({ sectionSubjectId: "not-a-uuid" })).toThrow();
  });

  /**
   * The duration holds the teacher's diary against the clash check (FR-LIV-021),
   * so a typed 600 would refuse them every other class for the rest of the day.
   * Four hours is longer than any lesson and short enough to be recoverable.
   */
  it("bounds the duration so a typo cannot block a teacher's day", () => {
    expect(startNowSchema.parse({ sectionSubjectId: SUBJECT, durationMinutes: 240 }).durationMinutes).toBe(240);
    expect(() => startNowSchema.parse({ sectionSubjectId: SUBJECT, durationMinutes: 600 })).toThrow();
    expect(() => startNowSchema.parse({ sectionSubjectId: SUBJECT, durationMinutes: 0 })).toThrow();
    expect(() => startNowSchema.parse({ sectionSubjectId: SUBJECT, durationMinutes: -30 })).toThrow();
  });

  it("takes a duration sent as a string, which is what a select gives", () => {
    // z.coerce — the form control produces "90", and rejecting that would be a
    // validation error the teacher cannot act on.
    expect(startNowSchema.parse({ sectionSubjectId: SUBJECT, durationMinutes: "90" }).durationMinutes).toBe(90);
  });

  /**
   * A teacher's own id comes from their session and never from the body. The
   * field exists only so an administrator can open a room on somebody's behalf,
   * and the service defaults it to the caller — without that default, a body
   * with somebody else's id would put their name on the register.
   */
  it("accepts a host only as a uuid, and treats it as optional", () => {
    expect(startNowSchema.parse({ sectionSubjectId: SUBJECT }).hostTeacherId).toBeUndefined();
    expect(() => startNowSchema.parse({ sectionSubjectId: SUBJECT, hostTeacherId: "me" })).toThrow();
  });

  it("keeps a title meaningful when one is given", () => {
    expect(() => startNowSchema.parse({ sectionSubjectId: SUBJECT, title: "x" })).toThrow();
    expect(startNowSchema.parse({ sectionSubjectId: SUBJECT, title: "  Revision hour  " }).title).toBe(
      "Revision hour",
    );
  });
});

describe("ending a class reaches the provider", () => {
  const binding = (externalId: string | null): ProviderBinding => ({
    providerKey: "livekit",
    externalId,
    joinUrl: null,
    hostUrl: null,
    providerMetadata: null,
    status: "ACTIVE",
  });

  const noPrisma = {} as PrismaService;

  /**
   * ARC-030 — endSession is OPTIONAL on the interface. The manual provider has
   * no room to close, so the service must cope with its absence rather than
   * calling through and throwing on a class that has genuinely ended.
   */
  it("is absent on a provider with nothing to close", () => {
    // Through the interface, which is how the service holds it — the concrete
    // class does not declare the member at all, and that IS the contract.
    //
    // `in` rather than reading the property: pulling a method off an object to
    // look at it is the unbound-method trap, and the question here is only
    // whether the member exists.
    const manual: LiveClassroomProvider = new ManualProvider();
    expect("endSession" in manual).toBe(false);
  });

  it("is offered by a provider that owns the room", () => {
    const livekit: LiveClassroomProvider = new LiveKitProvider(configWith(), noPrisma);
    expect("endSession" in livekit).toBe(true);
    expect(livekit.capabilities().canEndMeetingRemotely).toBe(false); // unconfigured
  });

  it("does not throw when the classroom is unreachable", async () => {
    // The class is over in the System whichever way this goes. A provider that
    // cannot be reached must not turn "the lesson finished" into an error.
    const livekit = new LiveKitProvider(
      configWith({
        LIVEKIT_URL: "ws://127.0.0.1:1",
        LIVEKIT_API_KEY: "k",
        LIVEKIT_API_SECRET: "s",
      }),
      noPrisma,
    );
    await expect(livekit.endSession(binding("session-x"))).resolves.toBeUndefined();
  });

  it("does nothing at all for a class that never got a room", async () => {
    const livekit = new LiveKitProvider(configWith(), noPrisma);
    await expect(livekit.endSession(binding(null))).resolves.toBeUndefined();
  });
});
