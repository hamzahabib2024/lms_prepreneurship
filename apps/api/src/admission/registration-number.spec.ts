/**
 * Registration numbering — SRS Appendix B, FR-REG-049..058.
 *
 * NFR-MNT-002 requires 100% coverage of numbering logic. These cover format
 * and series-key derivation without a database; the concurrency guarantee
 * itself is asserted by the SQL (INSERT ... ON CONFLICT DO UPDATE RETURNING)
 * and is exercised by the integration test in registration-number.int-spec.ts,
 * which needs a live PostgreSQL.
 */

import { ConfigService } from "@nestjs/config";
import { RegistrationNumberService } from "./registration-number.service";

const configWith = (values: Record<string, string> = {}): ConfigService =>
  ({
    get: (key: string, fallback?: string) => values[key] ?? fallback,
  }) as unknown as ConfigService;

describe("RegistrationNumberService — format (Appendix B)", () => {
  const svc = new RegistrationNumberService(configWith());
  const parts = {
    instituteCode: "CIIT",
    sessionCode: "SP26",
    programmeCode: "GD",
    campusCode: "ISB",
  };

  it("produces the documented Appendix B example", () => {
    expect(svc.format(parts, 34)).toBe("CIIT/SP26-GD-034/ISB");
  });

  it("zero-pads the sequence to the configured width", () => {
    expect(svc.format(parts, 1)).toBe("CIIT/SP26-GD-001/ISB");
    expect(svc.format(parts, 999)).toBe("CIIT/SP26-GD-999/ISB");
  });

  it("does not truncate a sequence that outgrows the pad width", () => {
    // Padding is a minimum, not a maximum. Truncating at 1000 students would
    // silently create duplicates, which BR-REG-06 forbids.
    expect(svc.format(parts, 1000)).toBe("CIIT/SP26-GD-1000/ISB");
    expect(svc.format(parts, 12345)).toBe("CIIT/SP26-GD-12345/ISB");
  });

  it("upper-cases every component", () => {
    const lower = {
      instituteCode: "ciit",
      sessionCode: "sp26",
      programmeCode: "gd",
      campusCode: "isb",
    };
    expect(svc.format(lower, 7)).toBe("CIIT/SP26-GD-007/ISB");
  });

  it("honours a configured template and pad width (FR-REG-054)", () => {
    const custom = new RegistrationNumberService(
      configWith({
        REG_NO_TEMPLATE: "{SESSION}/{PROGRAMME}/{SEQUENCE}",
        REG_NO_PAD_WIDTH: "5",
      }),
    );
    expect(custom.format(parts, 42)).toBe("SP26/GD/00042");
  });
});

describe("RegistrationNumberService — series key (Appendix B)", () => {
  const svc = new RegistrationNumberService(configWith());

  it("is unique over institute, session, programme and campus", () => {
    const base = {
      instituteCode: "CIIT",
      sessionCode: "SP26",
      programmeCode: "GD",
      campusCode: "ISB",
    };
    const key = svc.buildSeriesKey(base);

    // Each of these must be a DIFFERENT series, so the same sequence number
    // can legitimately appear in each. This is intentional per Appendix B.
    expect(svc.buildSeriesKey({ ...base, campusCode: "LHR" })).not.toBe(key);
    expect(svc.buildSeriesKey({ ...base, programmeCode: "DM" })).not.toBe(key);
    expect(svc.buildSeriesKey({ ...base, sessionCode: "FA26" })).not.toBe(key);
    expect(svc.buildSeriesKey({ ...base, instituteCode: "OTHER" })).not.toBe(key);
  });

  it("is stable regardless of case or surrounding whitespace", () => {
    const a = svc.buildSeriesKey({
      instituteCode: "CIIT",
      sessionCode: "SP26",
      programmeCode: "GD",
      campusCode: "ISB",
    });
    const b = svc.buildSeriesKey({
      instituteCode: " ciit ",
      sessionCode: "sp26",
      programmeCode: " Gd",
      campusCode: "isb ",
    });
    expect(a).toBe(b);
  });

  it("cannot be confused by a separator appearing inside a component", () => {
    // A naive join on "-" would make ("SP", "26-GD") collide with
    // ("SP26", "GD"). The pipe separator is not a legal component character.
    const a = svc.buildSeriesKey({
      instituteCode: "CIIT",
      sessionCode: "SP26",
      programmeCode: "GD",
      campusCode: "ISB",
    });
    const b = svc.buildSeriesKey({
      instituteCode: "CIIT",
      sessionCode: "SP",
      programmeCode: "26-GD",
      campusCode: "ISB",
    });
    expect(a).not.toBe(b);
  });
});

describe("RegistrationNumberService — allocation contract", () => {
  const svc = new RegistrationNumberService(configWith());

  it("allocates atomically and formats the returned sequence", async () => {
    const queries: string[] = [];
    const tx = {
      $queryRaw: (strings: TemplateStringsArray) => {
        queries.push(strings.join("?"));
        return Promise.resolve([{ next_value: 34 }]);
      },
    } as never;

    const result = await svc.allocate(tx, {
      instituteCode: "CIIT",
      sessionCode: "SP26",
      programmeCode: "GD",
      campusCode: "ISB",
    });

    expect(result).toEqual({ registrationNo: "CIIT/SP26-GD-034/ISB", sequence: 34 });

    // RSK-07: the allocation must be a single atomic statement. A
    // read-then-write pair collides under concurrent approval.
    const sql = queries.join(" ");
    expect(sql).toContain("ON CONFLICT");
    expect(sql).toContain("RETURNING");
    expect(sql).not.toMatch(/SELECT\s+MAX/i);
  });

  it("fails loudly rather than inventing a number", async () => {
    const tx = { $queryRaw: () => Promise.resolve([]) } as never;
    await expect(
      svc.allocate(tx, {
        instituteCode: "CIIT",
        sessionCode: "SP26",
        programmeCode: "GD",
        campusCode: "ISB",
      }),
    ).rejects.toThrow(/returned no value/);
  });

  it("takes an exclusive lock before allocating a roll number", async () => {
    // Without FOR UPDATE, two approvals into the same section can compute the
    // same gap and both claim it.
    const queries: string[] = [];
    const tx = {
      $queryRaw: (strings: TemplateStringsArray) => {
        queries.push(strings.join("?"));
        return Promise.resolve([{ roll: 1 }]);
      },
    } as never;

    await svc.lockSection(tx, "018f2b04-0000-7000-8000-000000000000");
    expect(queries.join(" ")).toContain("FOR UPDATE");
  });

  it("refuses to lower an existing series when seeding (BR-REG-07)", async () => {
    // Lowering would reissue numbers already in use, which is forbidden
    // absolutely. GREATEST in the SQL is what prevents it.
    let executed = "";
    const tx = {
      $executeRaw: (strings: TemplateStringsArray) => {
        executed = strings.join("?");
        return Promise.resolve(1);
      },
    } as never;

    await svc.seedSeries(tx, "CIIT|SP26|GD|ISB", 120);
    expect(executed).toContain("GREATEST");
  });
});
