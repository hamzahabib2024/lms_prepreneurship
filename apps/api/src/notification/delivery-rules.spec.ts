import {
  isWithinQuietHours,
  localHourIn,
  shouldPush,
  type Preference,
} from "./delivery-rules";

/**
 * Delivery rules — FR-COM-018, BR-COM-02.
 *
 * These decide whether somebody's phone goes off in the middle of the night, so
 * every branch is pinned. The wrapping quiet window is the case that looks
 * right and is not.
 */

const pref = (over: Partial<Preference> = {}): Preference => ({
  channels: ["WHATSAPP"],
  mutedKinds: [],
  quietHoursStart: null,
  quietHoursEnd: null,
  ...over,
});

describe("isWithinQuietHours", () => {
  describe("a window inside one day (01:00-06:00)", () => {
    it.each([1, 3, 5])("is quiet at %i", (h) => {
      expect(isWithinQuietHours(h, 1, 6)).toBe(true);
    });
    it.each([0, 6, 12, 23])("is not quiet at %i", (h) => {
      // 6 is the exclusive end: quiet hours are over.
      expect(isWithinQuietHours(h, 1, 6)).toBe(false);
    });
  });

  describe("a window that wraps midnight (22:00-07:00)", () => {
    // THE CASE THAT BREAKS A NAIVE IMPLEMENTATION. `h >= start && h < end` is
    // never true for 22..7, so the window would silence nothing and messages
    // would arrive all night.
    it.each([22, 23, 0, 3, 6])("is quiet at %i", (h) => {
      expect(isWithinQuietHours(h, 22, 7)).toBe(true);
    });
    it.each([7, 12, 18, 21])("is not quiet at %i", (h) => {
      expect(isWithinQuietHours(h, 22, 7)).toBe(false);
    });
  });

  it("treats an unset window as never quiet", () => {
    expect(isWithinQuietHours(3, null, null)).toBe(false);
    expect(isWithinQuietHours(3, 22, null)).toBe(false);
    expect(isWithinQuietHours(3, null, 7)).toBe(false);
  });

  it("treats a zero-width window as never quiet", () => {
    // start === end would otherwise be read as "all day" by the wrapping
    // branch, silencing everything for ever.
    expect(isWithinQuietHours(9, 9, 9)).toBe(false);
    expect(isWithinQuietHours(3, 9, 9)).toBe(false);
  });
});

describe("shouldPush", () => {
  const base = { channel: "WHATSAPP", kind: "assignment.due_soon", localHour: 12 };

  it("pushes when nothing objects", () => {
    expect(shouldPush({ ...base, isUrgent: false, preference: pref() })).toEqual({ push: true });
  });

  it("does not push a muted kind", () => {
    expect(
      shouldPush({
        ...base,
        isUrgent: false,
        preference: pref({ mutedKinds: ["assignment.due_soon"] }),
      }),
    ).toEqual({ push: false, reason: "MUTED" });
  });

  it("pushes a kind that is not the muted one", () => {
    expect(
      shouldPush({
        ...base,
        kind: "grade.released",
        isUrgent: false,
        preference: pref({ mutedKinds: ["assignment.due_soon"] }),
      }),
    ).toEqual({ push: true });
  });

  it("does not push during quiet hours", () => {
    expect(
      shouldPush({
        ...base,
        localHour: 3,
        isUrgent: false,
        preference: pref({ quietHoursStart: 22, quietHoursEnd: 7 }),
      }),
    ).toEqual({ push: false, reason: "QUIET_HOURS" });
  });

  it("does not push on a channel the user has turned off", () => {
    expect(
      shouldPush({ ...base, isUrgent: false, preference: pref({ channels: [] }) }),
    ).toEqual({ push: false, reason: "CHANNEL_OFF" });
  });

  describe("urgent (BR-COM-02)", () => {
    it("overrides quiet hours", () => {
      expect(
        shouldPush({
          ...base,
          localHour: 3,
          isUrgent: true,
          preference: pref({ quietHoursStart: 22, quietHoursEnd: 7 }),
        }),
      ).toEqual({ push: true });
    });

    it("overrides a mute", () => {
      expect(
        shouldPush({
          ...base,
          isUrgent: true,
          preference: pref({ mutedKinds: ["assignment.due_soon"] }),
        }),
      ).toEqual({ push: true });
    });

    it("does NOT override a channel the user turned off", () => {
      // Turning a channel off withdraws consent for that channel. Urgency does
      // not restore it — the message goes to the inbox instead.
      expect(
        shouldPush({ ...base, isUrgent: true, preference: pref({ channels: [] }) }),
      ).toEqual({ push: false, reason: "CHANNEL_OFF" });
    });
  });

  it("reports the reason, not merely a refusal", () => {
    // The reason is written to the delivery record, and "why did I not get
    // that?" is answerable only if it was kept.
    const decision = shouldPush({
      ...base,
      isUrgent: false,
      preference: pref({ mutedKinds: ["assignment.due_soon"] }),
    });
    expect(decision.push).toBe(false);
    if (!decision.push) expect(decision.reason).toBe("MUTED");
  });
});

describe("localHourIn", () => {
  it("resolves a real timezone", () => {
    // 2026-08-10T21:30Z is 02:30 the next day in Karachi (UTC+5).
    expect(localHourIn("Asia/Karachi", new Date("2026-08-10T21:30:00Z"))).toBe(2);
  });

  it("falls back to UTC for an unknown timezone rather than throwing", () => {
    // A bad timezone may mistime a quiet-hours check; refusing to send would
    // lose the message entirely, which is worse.
    expect(localHourIn("Not/AZone", new Date("2026-08-10T21:30:00Z"))).toBe(21);
  });
});
