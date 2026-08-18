/**
 * The countdown a student watches while waiting for class to start.
 *
 * A copy of the web app's `formatCountdown`, tested here because this is the
 * suite CI runs — the same arrangement as the routing and icon guards. The
 * rules are small and the failures are all embarrassing in front of a student:
 * "starts in 0 minutes" on a page that is plainly not starting, or a plural
 * "1 minutes".
 */
function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;

  if (days > 0) return `starts in ${days} day${days === 1 ? "" : "s"}`;
  if (hours > 0) {
    return `starts in ${hours} hour${hours === 1 ? "" : "s"}${
      minutes > 0 ? ` ${minutes} minute${minutes === 1 ? "" : "s"}` : ""
    }`;
  }
  if (minutes > 0) return `starts in ${minutes} minute${minutes === 1 ? "" : "s"}`;
  return `starts in ${seconds} second${seconds === 1 ? "" : "s"}`;
}

const minutes = (n: number) => n * 60_000;
const hours = (n: number) => n * 3_600_000;
const days = (n: number) => n * 86_400_000;

describe("the countdown to a class", () => {
  it("counts days out", () => {
    expect(formatCountdown(days(3))).toBe("starts in 3 days");
    expect(formatCountdown(days(1))).toBe("starts in 1 day");
  });

  it("counts hours with the minutes beside them", () => {
    expect(formatCountdown(hours(2) + minutes(10))).toBe("starts in 2 hours 10 minutes");
    expect(formatCountdown(hours(1))).toBe("starts in 1 hour");
  });

  it("counts minutes", () => {
    expect(formatCountdown(minutes(14))).toBe("starts in 14 minutes");
    expect(formatCountdown(minutes(1))).toBe("starts in 1 minute");
  });

  /**
   * THE ONE THAT MATTERS. Under a minute is the moment a student is staring at
   * the page, and "starts in 0 minutes" reads as a stuck screen rather than as
   * "any second now".
   */
  it("counts SECONDS under a minute, never 0 minutes", () => {
    expect(formatCountdown(45_000)).toBe("starts in 45 seconds");
    expect(formatCountdown(1_000)).toBe("starts in 1 second");
    expect(formatCountdown(59_400)).toBe("starts in 59 seconds");
    for (let ms = 0; ms < 60_000; ms += 137) {
      expect(formatCountdown(ms)).not.toContain("0 minutes");
    }
  });

  it("never counts backwards once the class has started", () => {
    // The page switches to "running now" at zero; this only has to not produce
    // "starts in -4 minutes" in the instant before it does.
    expect(formatCountdown(-minutes(5))).toBe("starts in 0 seconds");
    expect(formatCountdown(0)).toBe("starts in 0 seconds");
  });

  it("gets the singular right everywhere", () => {
    // "1 minutes" is the kind of detail that makes a system feel unfinished to
    // exactly the people paying for it.
    const singulars = [days(1), hours(1), minutes(1), 1000];
    for (const ms of singulars) {
      expect(formatCountdown(ms)).not.toMatch(/\b1 (days|hours|minutes|seconds)\b/);
    }
  });
});
