import {
  MAX_OCCURRENCES,
  expand,
  groupByDay,
  upcoming,
  validatePattern,
  type WeeklyPattern,
} from "./timetable";

const PKT = 300; // Pakistan, UTC+05:00, no daylight saving.
const at = (iso: string) => new Date(iso);

const pattern = (over: Partial<WeeklyPattern> = {}): WeeklyPattern => ({
  days: [1, 3], // Monday and Wednesday
  startTime: "09:00",
  endTime: "11:00",
  fromDate: at("2026-08-03T00:00:00Z"), // a Monday
  toDate: at("2026-08-16T00:00:00Z"), // the Sunday two weeks later
  offsetMinutes: PKT,
  ...over,
});

describe("validating a pattern", () => {
  it("accepts an ordinary term", () => {
    expect(validatePattern(pattern())).toBeNull();
  });

  it("refuses no days", () => {
    expect(validatePattern(pattern({ days: [] }))?.code).toBe("NO_DAYS");
  });

  it("refuses a time that is not a time", () => {
    expect(validatePattern(pattern({ startTime: "nine" }))?.code).toBe("BAD_TIME");
    expect(validatePattern(pattern({ startTime: "25:00" }))?.code).toBe("BAD_TIME");
    expect(validatePattern(pattern({ endTime: "10:70" }))?.code).toBe("BAD_TIME");
  });

  it("accepts a single-digit hour", () => {
    expect(validatePattern(pattern({ startTime: "9:00" }))).toBeNull();
  });

  it("refuses a class that ends before it starts", () => {
    expect(validatePattern(pattern({ startTime: "11:00", endTime: "09:00" }))?.code).toBe(
      "END_BEFORE_START",
    );
  });

  it("refuses a class of no length", () => {
    // Not pedantry: it would produce a register for a class nobody attended.
    expect(validatePattern(pattern({ startTime: "09:00", endTime: "09:00" }))?.code).toBe(
      "END_BEFORE_START",
    );
  });

  it("refuses an inverted range", () => {
    expect(
      validatePattern(pattern({ fromDate: at("2026-09-01T00:00:00Z"), toDate: at("2026-08-01T00:00:00Z") }))
        ?.code,
    ).toBe("RANGE_INVERTED");
  });

  it("refuses more than a year", () => {
    expect(
      validatePattern(pattern({ toDate: at("2028-08-03T00:00:00Z") }))?.code,
    ).toBe("RANGE_TOO_LONG");
  });

  it("refuses a pattern that would create too many classes", () => {
    const problem = validatePattern(
      pattern({ days: [0, 1, 2, 3, 4, 5, 6], toDate: at("2027-06-01T00:00:00Z") }),
    );
    // Either bound is a fair answer; both mean "one term at a time".
    expect(["TOO_MANY", "RANGE_TOO_LONG"]).toContain(problem?.code);
  });
});

describe("expanding a pattern", () => {
  it("produces one occurrence per matching day", () => {
    // Mondays 3 and 10 August, Wednesdays 5 and 12.
    expect(expand(pattern())).toHaveLength(4);
  });

  it("puts them on the right dates", () => {
    const dates = expand(pattern()).map((o) => o.scheduledStart.toISOString().slice(0, 10));
    expect(dates).toEqual(["2026-08-03", "2026-08-05", "2026-08-10", "2026-08-12"]);
  });

  it("converts the LOCAL time to the instant it names", () => {
    // 09:00 in Karachi is 04:00 UTC.
    const first = expand(pattern())[0];
    expect(first?.scheduledStart.toISOString()).toBe("2026-08-03T04:00:00.000Z");
    expect(first?.scheduledEnd.toISOString()).toBe("2026-08-03T06:00:00.000Z");
  });

  it("handles an evening class that stays on the same local day", () => {
    // 23:00 local is 18:00 UTC — still the same date either way.
    const evening = expand(pattern({ startTime: "23:00", endTime: "23:59" }))[0];
    expect(evening?.scheduledStart.toISOString()).toBe("2026-08-03T18:00:00.000Z");
  });

  it("handles an early class that falls on the PREVIOUS UTC day", () => {
    // 02:00 in Karachi is 21:00 UTC the evening before. The occurrence is
    // still Monday's class, and the instant is what it must be.
    const early = expand(pattern({ startTime: "02:00", endTime: "04:00" }))[0];
    expect(early?.scheduledStart.toISOString()).toBe("2026-08-02T21:00:00.000Z");
  });

  it("includes both endpoints of the range", () => {
    // From a Monday to a Monday, one day only: both are included.
    const single = expand(
      pattern({ days: [1], fromDate: at("2026-08-03T00:00:00Z"), toDate: at("2026-08-03T00:00:00Z") }),
    );
    expect(single).toHaveLength(1);
  });

  it("returns nothing when no day in the range matches", () => {
    // Friday only, over a Monday-to-Wednesday range.
    expect(
      expand(pattern({ days: [5], fromDate: at("2026-08-03T00:00:00Z"), toDate: at("2026-08-05T00:00:00Z") })),
    ).toEqual([]);
  });

  it("skips an excluded date", () => {
    const withHoliday = expand(pattern({ exclusions: [at("2026-08-05T00:00:00Z")] }));
    expect(withHoliday).toHaveLength(3);
    expect(withHoliday.map((o) => o.scheduledStart.toISOString().slice(0, 10))).not.toContain(
      "2026-08-05",
    );
  });

  it("compares exclusions by calendar day, not by instant", () => {
    // A holiday given as midday must still remove the whole day.
    expect(expand(pattern({ exclusions: [at("2026-08-05T12:34:56Z")] }))).toHaveLength(3);
  });

  it("handles every day of the week", () => {
    const daily = expand(
      pattern({ days: [0, 1, 2, 3, 4, 5, 6], toDate: at("2026-08-09T00:00:00Z") }),
    );
    expect(daily).toHaveLength(7);
  });

  it("crosses a month boundary", () => {
    const across = expand(
      pattern({ days: [1], fromDate: at("2026-08-24T00:00:00Z"), toDate: at("2026-09-07T00:00:00Z") }),
    );
    expect(across.map((o) => o.scheduledStart.toISOString().slice(0, 10))).toEqual([
      "2026-08-24",
      "2026-08-31",
      "2026-09-07",
    ]);
  });

  it("crosses a year boundary", () => {
    // Thursdays between Monday 28 December and Monday 11 January: the 31st and
    // the 7th. The 14th is past the end.
    const across = expand(
      pattern({ days: [4], fromDate: at("2026-12-28T00:00:00Z"), toDate: at("2027-01-11T00:00:00Z") }),
    );
    expect(across.map((o) => o.scheduledStart.toISOString().slice(0, 10))).toEqual([
      "2026-12-31",
      "2027-01-07",
    ]);
  });

  it("returns nothing for an empty day list", () => {
    expect(expand(pattern({ days: [] }))).toEqual([]);
  });

  it("returns nothing for a nonsense time rather than throwing", () => {
    expect(expand(pattern({ startTime: "half nine" }))).toEqual([]);
  });

  it("stops at the cap rather than running away", () => {
    const huge = expand(
      pattern({ days: [0, 1, 2, 3, 4, 5, 6], toDate: at("2027-08-03T00:00:00Z") }),
    );
    expect(huge.length).toBeLessThanOrEqual(MAX_OCCURRENCES + 1);
  });
});

describe("upcoming", () => {
  const all = expand(pattern());

  it("keeps everything when the term has not started", () => {
    expect(upcoming(all, at("2026-08-01T00:00:00Z"))).toHaveLength(4);
  });

  it("drops classes that have finished", () => {
    expect(upcoming(all, at("2026-08-06T00:00:00Z"))).toHaveLength(2);
  });

  it("KEEPS a class that is currently running", () => {
    // Mid-class, a student needs the joining link more than at any other time.
    expect(upcoming(all, at("2026-08-03T05:00:00Z"))).toHaveLength(4);
  });

  it("drops one that ended a minute ago", () => {
    expect(upcoming(all, at("2026-08-03T06:01:00Z"))).toHaveLength(3);
  });
});

describe("grouping into days", () => {
  const entry = (iso: string, title: string) => ({
    id: title,
    title,
    subject: "GD101",
    section: "A",
    teacher: "Sana",
    scheduledStart: at(iso),
    scheduledEnd: new Date(at(iso).getTime() + 3_600_000),
    status: "SCHEDULED",
  });

  it("groups by the LOCAL date", () => {
    // 21:00 UTC on the 2nd is 02:00 local on the 3rd. Grouping by UTC would
    // file a student's Monday class under Sunday.
    const groups = groupByDay([entry("2026-08-02T21:00:00Z", "Early Monday")], PKT);
    expect(groups[0]?.date).toBe("2026-08-03");
  });

  it("keeps an evening class on its own day", () => {
    const groups = groupByDay([entry("2026-08-03T18:00:00Z", "Evening")], PKT);
    expect(groups[0]?.date).toBe("2026-08-03");
  });

  it("puts days in order", () => {
    const groups = groupByDay(
      [entry("2026-08-05T04:00:00Z", "Wed"), entry("2026-08-03T04:00:00Z", "Mon")],
      PKT,
    );
    expect(groups.map((g) => g.date)).toEqual(["2026-08-03", "2026-08-05"]);
  });

  it("puts classes within a day in time order", () => {
    const groups = groupByDay(
      [entry("2026-08-03T09:00:00Z", "Afternoon"), entry("2026-08-03T04:00:00Z", "Morning")],
      PKT,
    );
    expect(groups[0]?.entries.map((e) => e.title)).toEqual(["Morning", "Afternoon"]);
  });

  it("returns nothing for no entries", () => {
    expect(groupByDay([], PKT)).toEqual([]);
  });
});
