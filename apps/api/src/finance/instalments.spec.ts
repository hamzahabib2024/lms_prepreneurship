import {
  MAX_INSTALMENTS,
  addMonthsKeepingDay,
  describeSchedule,
  hasWholePaisa,
  planInstalments,
  refusePlan,
  split,
  toPaisa,
  toRupees,
} from "./instalments";

describe("money is counted in paisa, never in floats", () => {
  it("converts rupees to paisa", () => {
    expect(toPaisa(1)).toBe(100);
    expect(toPaisa(1234.56)).toBe(123456);
  });

  it("survives the values floating point gets wrong", () => {
    // 0.1 + 0.2 is 0.30000000000000004 and 35.7 * 100 is 3570.0000000000005.
    // Truncating instead of rounding would lose a paisa on amounts the
    // Institute writes down as exact.
    expect(toPaisa(0.1 + 0.2)).toBe(30);
    expect(toPaisa(35.7)).toBe(3570);
  });

  it("recognises what is and is not an amount of money", () => {
    // 1.005 is stored as 1.00499999999999989, so no conversion can tell it
    // from 1.00 — which is why it is refused at the edge rather than rounded
    // into a plan that does not add up to what was typed.
    expect(hasWholePaisa(1.0)).toBe(true);
    expect(hasWholePaisa(35.7)).toBe(true);
    expect(hasWholePaisa(1234.56)).toBe(true);
    expect(hasWholePaisa(0.1 + 0.2)).toBe(true);
    expect(hasWholePaisa(1.005)).toBe(false);
    expect(hasWholePaisa(0.001)).toBe(false);
  });

  it("round-trips", () => {
    for (const r of [0.01, 1, 99.99, 12345.67, 1_000_000]) {
      expect(toRupees(toPaisa(r))).toBeCloseTo(r, 2);
    }
  });
});

describe("splitting an amount", () => {
  it("divides evenly when it can", () => {
    expect(split(30000, 3)).toEqual([10000, 10000, 10000]);
  });

  it("gives the remainder to the EARLIEST instalments", () => {
    // 100,000 paisa in three: 33334, 33333, 33333. Not three lots of 33333,
    // which is a paisa short of the total.
    expect(split(100000, 3)).toEqual([33334, 33333, 33333]);
  });

  it("spreads a remainder of more than one", () => {
    expect(split(10, 4)).toEqual([3, 3, 2, 2]);
  });

  it("ALWAYS sums to the total, over hundreds of awkward amounts", () => {
    // The property the whole module exists for. A plan that does not add up
    // leaves a student owing a paisa forever, or the Institute short.
    for (let total = 1; total <= 5000; total += 7) {
      for (let count = 2; count <= 12; count++) {
        const parts = split(total, count);
        expect(parts).toHaveLength(count);
        expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
      }
    }
  });

  it("never produces a negative or fractional part", () => {
    for (let total = 2; total <= 500; total++) {
      for (const parts of [split(total, 2), split(total, 3), split(total, 7)]) {
        for (const p of parts) {
          expect(Number.isInteger(p)).toBe(true);
          expect(p).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it("differs by at most one paisa between any two instalments", () => {
    // Otherwise it is not a plan, it is a deposit and a balance.
    const parts = split(100001, 7);
    expect(Math.max(...parts) - Math.min(...parts)).toBeLessThanOrEqual(1);
  });
});

describe("monthly due dates keep the day of the month", () => {
  const at = (iso: string) => new Date(`${iso}T00:00:00Z`);
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  it("keeps an ordinary day", () => {
    expect(iso(addMonthsKeepingDay(at("2026-03-10"), 1, 10))).toBe("2026-04-10");
    expect(iso(addMonthsKeepingDay(at("2026-03-10"), 2, 10))).toBe("2026-05-10");
  });

  it("clamps the 31st into a short month", () => {
    // Naively adding a month to 31 January gives 3 March, and every later date
    // in the plan is then wrong.
    expect(iso(addMonthsKeepingDay(at("2026-01-31"), 1, 31))).toBe("2026-02-28");
    expect(iso(addMonthsKeepingDay(at("2026-01-31"), 3, 31))).toBe("2026-04-30");
  });

  it("returns to the 31st after clamping, rather than drifting", () => {
    // The part usually missed. The plan is "the 31st of each month", so March
    // is the 31st again — not the 28th carried forward from February.
    expect(iso(addMonthsKeepingDay(at("2026-01-31"), 2, 31))).toBe("2026-03-31");
  });

  it("handles February in a leap year", () => {
    expect(iso(addMonthsKeepingDay(at("2028-01-31"), 1, 31))).toBe("2028-02-29");
  });

  it("crosses a year boundary", () => {
    expect(iso(addMonthsKeepingDay(at("2026-11-15"), 3, 15))).toBe("2027-02-15");
  });

  it("is monotonic — a later instalment is never due earlier", () => {
    const start = at("2026-01-31");
    let previous = 0;
    for (let i = 0; i < 24; i++) {
      const d = addMonthsKeepingDay(start, i, 31).getTime();
      expect(d).toBeGreaterThan(previous);
      previous = d;
    }
  });
});

describe("refusing a plan that should not exist", () => {
  const start = new Date("2026-03-01T00:00:00Z");

  it("refuses a total of nothing", () => {
    expect(refusePlan(0, 3, start)?.code).toBe("AMOUNT");
    expect(refusePlan(-100, 3, start)?.code).toBe("AMOUNT");
  });

  it("refuses a total finer than a paisa, rather than rounding it silently", () => {
    const p = refusePlan(1000.005, 3, start);
    expect(p?.code).toBe("AMOUNT");
    expect(p?.message).toContain("two decimal places");
  });

  it("refuses ONE instalment, and says what to do instead", () => {
    // One instalment is a charge, and there is already a way to add one.
    const p = refusePlan(50000, 1, start);
    expect(p?.code).toBe("COUNT");
    expect(p?.message).toContain("add a charge");
  });

  it("refuses more instalments than it allows", () => {
    expect(refusePlan(500000, MAX_INSTALMENTS + 1, start)?.code).toBe("COUNT");
    expect(refusePlan(500000, MAX_INSTALMENTS, start)).toBeNull();
  });

  it("refuses an unreal date", () => {
    expect(refusePlan(50000, 3, new Date("not a date"))?.code).toBe("START");
  });

  it("refuses instalments too small to be worth collecting", () => {
    const p = refusePlan(500, 12, start);
    expect(p?.code).toBe("TOO_SMALL");
    expect(p?.message).toContain("fewer instalments");
  });

  it("accepts an ordinary plan", () => {
    expect(refusePlan(90000, 3, start)).toBeNull();
  });
});

describe("the schedule", () => {
  const start = new Date("2026-03-05T00:00:00Z");
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const plan = (over: Partial<Parameters<typeof planInstalments>[0]> = {}) =>
    planInstalments({
      totalRupees: 90000,
      count: 3,
      firstDueDate: start,
      cadence: "MONTHLY",
      label: "Spring 2026 tuition",
      ...over,
    });

  it("splits evenly when it can", () => {
    const { instalments } = plan();
    expect(instalments.map((i) => i.amount)).toEqual([30000, 30000, 30000]);
  });

  it("dates them monthly from the first", () => {
    const { instalments } = plan();
    expect(instalments.map((i) => iso(i.dueDate))).toEqual([
      "2026-03-05",
      "2026-04-05",
      "2026-05-05",
    ]);
  });

  it("numbers them for the student, 1-based", () => {
    expect(plan().instalments.map((i) => i.number)).toEqual([1, 2, 3]);
  });

  it("names each one, because a statement of three identical lines is useless", () => {
    const { instalments } = plan();
    expect(instalments[0]?.description).toBe("Spring 2026 tuition — instalment 1 of 3");
    expect(instalments[2]?.description).toBe("Spring 2026 tuition — instalment 3 of 3");
  });

  it("sums to the total EXACTLY when it does not divide", () => {
    const { instalments } = plan({ totalRupees: 100000 });
    const total = instalments.reduce((s, i) => s + toPaisa(i.amount), 0);
    expect(total).toBe(toPaisa(100000));
    expect(instalments.map((i) => i.amount)).toEqual([33333.34, 33333.33, 33333.33]);
  });

  it("supports fortnightly and weekly", () => {
    expect(plan({ cadence: "FORTNIGHTLY" }).instalments.map((i) => iso(i.dueDate))).toEqual([
      "2026-03-05",
      "2026-03-19",
      "2026-04-02",
    ]);
    expect(plan({ cadence: "WEEKLY" }).instalments.map((i) => iso(i.dueDate))).toEqual([
      "2026-03-05",
      "2026-03-12",
      "2026-03-19",
    ]);
  });

  it("returns the problem rather than a schedule when refused", () => {
    const r = plan({ count: 1 });
    expect(r.instalments).toEqual([]);
    expect(r.problem?.code).toBe("COUNT");
  });

  it("keeps the month-end rule end to end", () => {
    const { instalments } = plan({
      firstDueDate: new Date("2026-01-31T00:00:00Z"),
      count: 4,
    });
    expect(instalments.map((i) => iso(i.dueDate))).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
    ]);
  });
});

describe("what the operator is told before it is written", () => {
  const start = new Date("2026-03-05T00:00:00Z");
  const said = (totalRupees: number, count = 3) =>
    describeSchedule(
      planInstalments({
        totalRupees,
        count,
        firstDueDate: start,
        cadence: "MONTHLY",
        label: "Tuition",
      }).instalments,
    );

  it("states the equal case plainly", () => {
    expect(said(90000)).toContain("3 instalments of Rs 30000.00");
    expect(said(90000)).toContain("totalling Rs 90000.00");
  });

  it("CLAIMS the uneven case rather than leaving it to be noticed", () => {
    // A schedule where one row differs by a paisa reads as a bug unless the
    // System says it meant to.
    const s = said(100000);
    expect(s).toContain("not all equal");
    expect(s).toContain("does not divide exactly");
    expect(s).toContain("totalling Rs 100000.00");
  });

  it("gives the span, which is what an operator checks", () => {
    expect(said(90000)).toContain("2026-03-05 to 2026-05-05");
  });

  it("says so when there is nothing", () => {
    expect(describeSchedule([])).toBe("No instalments.");
  });
});
