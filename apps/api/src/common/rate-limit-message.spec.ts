import { AllExceptionsFilter } from "./all-exceptions.filter";

/**
 * What somebody is told when they hit a rate limit.
 *
 * THIS WAS WRONG FOR MONTHS AND NOBODY NOTICED, because a 429 looks like an
 * infrastructure event rather than something a person reads. The throttler
 * raises an HttpException whose body is the STRING "ThrottlerException: Too
 * Many Requests", so the filter's "echo the body's message if it is an object"
 * branch fell through to INTERNAL_ERROR — and every rate limit came back as
 * "Something went wrong at our end", under code INTERNAL_ERROR.
 *
 * The public application form is the worst place for that. Three submissions
 * an hour is deliberate and tight, so an applicant who mistypes a CNIC and
 * corrects it twice is told the Institute's system is broken when what they
 * need to know is to wait — and they then either give up or keep pressing,
 * which is the behaviour the limit exists to stop.
 */

/** The private helper, reached the way the filter reaches it. */
const wait = (seconds: number): string =>
  (
    Object.create(AllExceptionsFilter.prototype) as unknown as {
      describeWaitFor: (s: number) => string;
    }
  ).describeWaitFor.call(Object.create(AllExceptionsFilter.prototype), seconds);

describe("how long to wait, in words", () => {
  it("says seconds under a minute", () => {
    expect(wait(30)).toBe("30 seconds");
  });

  it("says a minute rather than 1 minutes", () => {
    expect(wait(60)).toBe("a minute");
  });

  it("says an hour rather than 60 minutes", () => {
    expect(wait(3600)).toBe("an hour");
  });

  it("ROUNDS UP, always", () => {
    // 61 seconds described as "a minute" earns one more refusal and one more
    // reason to distrust the page.
    expect(wait(61)).toBe("2 minutes");
    expect(wait(3601)).toBe("2 hours");
    expect(wait(0.5)).toBe("1 seconds");
  });

  it("handles the real value the application form produces", () => {
    // @Throttle({ limit: 3, ttl: 3_600_000 }) → Retry-After: 3600
    expect(wait(3600)).toBe("an hour");
  });

  it("never returns an empty or nonsense duration", () => {
    for (const s of [1, 59, 60, 119, 3599, 3600, 7200, 86400]) {
      const said = wait(s);
      expect(said).toMatch(/\d|a minute|an hour/);
      expect(said.trim().length).toBeGreaterThan(0);
    }
  });
});
