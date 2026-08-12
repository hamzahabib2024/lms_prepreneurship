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
import type { SettingsService } from "../settings/settings.service";

const configWith = (values: Record<string, string> = {}): ConfigService =>
  ({
    get: (key: string, fallback?: string) => values[key] ?? fallback,
  }) as unknown as ConfigService;

/**
 * An Institute that has set nothing. Blank and NaN are what an untouched
 * settings store yields, and resolveFormat is required to fall through them to
 * the environment rather than treat them as chosen values.
 */
const settingsWith = (values: Record<string, string | number> = {}): SettingsService =>
  ({
    text: (key: string) => Promise.resolve(String(values[key] ?? "")),
    number: (key: string) => Promise.resolve(Number(values[key] ?? Number.NaN)),
  }) as unknown as SettingsService;

describe("RegistrationNumberService — format", () => {
  const svc = new RegistrationNumberService(configWith(), settingsWith());
  const parts = {
    instituteCode: "CIIT",
    sessionCode: "SP26",
    campusCode: "ISB",
  };

  it("carries NO programme code", () => {
    // THE POINT. A registration number identifies a student, and a student may
    // take more than one course. A number with a programme in it would have to
    // change when they enrolled in a second one — breaking a permanent public
    // identifier already printed on certificates (BR-REG-07) — or would
    // describe them wrongly from then on.
    const formatted = svc.format(parts, 34);
    expect(formatted).toBe("CIIT/SP26-034/ISB");
    expect(formatted).not.toContain("GD");
  });

  it("zero-pads the sequence to the configured width", () => {
    expect(svc.format(parts, 1)).toBe("CIIT/SP26-001/ISB");
    expect(svc.format(parts, 999)).toBe("CIIT/SP26-999/ISB");
  });

  it("does not truncate a sequence that outgrows the pad width", () => {
    // Padding is a minimum, not a maximum. Truncating at 1000 students would
    // silently create duplicates, which BR-REG-06 forbids.
    expect(svc.format(parts, 1000)).toBe("CIIT/SP26-1000/ISB");
    expect(svc.format(parts, 12345)).toBe("CIIT/SP26-12345/ISB");
  });

  it("upper-cases every component", () => {
    const lower = { instituteCode: "ciit", sessionCode: "sp26", campusCode: "isb" };
    expect(svc.format(lower, 7)).toBe("CIIT/SP26-007/ISB");
  });

  it("honours a configured template and pad width (FR-REG-054)", () => {
    const custom = new RegistrationNumberService(
      configWith({ REG_NO_TEMPLATE: "{SESSION}/{SEQUENCE}", REG_NO_PAD_WIDTH: "5" }),
      settingsWith(),
    );
    expect(custom.format(parts, 42)).toBe("SP26/00042");
  });

  it("still substitutes {PROGRAMME} for a deployment that configures it", () => {
    // The placeholder is retained so an institute that genuinely wants it can
    // have it; nothing supplies it by default.
    const custom = new RegistrationNumberService(
      configWith({ REG_NO_TEMPLATE: "{SESSION}-{PROGRAMME}-{SEQUENCE}" }),
      settingsWith(),
    );
    expect(custom.format({ ...parts, programmeCode: "GD" }, 42)).toBe("SP26-GD-042");
  });

  it("leaves {PROGRAMME} empty rather than printing undefined", () => {
    const custom = new RegistrationNumberService(
      configWith({ REG_NO_TEMPLATE: "{SESSION}-{PROGRAMME}{SEQUENCE}" }),
      settingsWith(),
    );
    expect(custom.format(parts, 42)).toBe("SP26-042");
  });
});

describe("the format an administrator can change (FR-REG-054)", () => {
  const env = {
    INSTITUTE_CODE: "ENVI",
    CAMPUS_CODE: "ENVC",
    REG_NO_PAD_WIDTH: "3",
    REG_NO_TEMPLATE: "{INSTITUTE}/{SESSION}-{SEQUENCE}/{CAMPUS}",
  };

  it("uses the environment when the Institute has set nothing", async () => {
    const svc = new RegistrationNumberService(configWith(env), settingsWith());
    await expect(svc.resolveFormat()).resolves.toEqual({
      instituteCode: "ENVI",
      campusCode: "ENVC",
      padWidth: 3,
      template: "{INSTITUTE}/{SESSION}-{SEQUENCE}/{CAMPUS}",
    });
  });

  it("lets a setting override each part", async () => {
    const svc = new RegistrationNumberService(
      configWith(env),
      settingsWith({
        "registration.instituteCode": "PREP",
        "registration.campusCode": "LHR",
        "registration.padWidth": 5,
        "registration.template": "{INSTITUTE}-{SESSION}-{SEQUENCE}",
      }),
    );
    const cfg = await svc.resolveFormat();
    expect(cfg).toEqual({
      instituteCode: "PREP",
      campusCode: "LHR",
      padWidth: 5,
      template: "{INSTITUTE}-{SESSION}-{SEQUENCE}",
    });
    // The point of the setting: the number that comes out actually changes.
    expect(
      svc.format({ instituteCode: "PREP", sessionCode: "SP26", campusCode: "LHR" }, 42, cfg),
    ).toBe("PREP-SP26-00042");
  });

  it("FALLS BACK rather than accepting a cleared field", async () => {
    // An administrator emptying the institute code would otherwise produce
    // "/SP26-001/ISB" — a permanent public identifier starting with a slash.
    const svc = new RegistrationNumberService(
      configWith(env),
      settingsWith({
        "registration.instituteCode": "   ",
        "registration.campusCode": "",
        "registration.template": "",
      }),
    );
    await expect(svc.resolveFormat()).resolves.toEqual({
      instituteCode: "ENVI",
      campusCode: "ENVC",
      padWidth: 3,
      template: "{INSTITUTE}/{SESSION}-{SEQUENCE}/{CAMPUS}",
    });
  });

  it("refuses a pad width that is not a usable number", async () => {
    for (const bad of [0, -2, Number.NaN]) {
      const svc = new RegistrationNumberService(
        configWith(env),
        settingsWith({ "registration.padWidth": bad }),
      );
      expect((await svc.resolveFormat()).padWidth).toBe(3);
    }
  });

  it("overrides one part without disturbing the others", async () => {
    const svc = new RegistrationNumberService(
      configWith(env),
      settingsWith({ "registration.campusCode": "KHI" }),
    );
    const cfg = await svc.resolveFormat();
    expect(cfg.campusCode).toBe("KHI");
    expect(cfg.instituteCode).toBe("ENVI");
    expect(cfg.padWidth).toBe(3);
  });
});

describe("RegistrationNumberService — series key (Appendix B)", () => {
  const svc = new RegistrationNumberService(configWith(), settingsWith());

  it("is unique over institute, session and campus", () => {
    const base = { instituteCode: "CIIT", sessionCode: "SP26", campusCode: "ISB" };
    const key = svc.buildSeriesKey(base);

    // Each of these is a DIFFERENT series, so the same sequence number can
    // legitimately appear in each: the campuses admit independently.
    expect(svc.buildSeriesKey({ ...base, campusCode: "LHR" })).not.toBe(key);
    expect(svc.buildSeriesKey({ ...base, sessionCode: "FA26" })).not.toBe(key);
    expect(svc.buildSeriesKey({ ...base, instituteCode: "OTHER" })).not.toBe(key);
  });

  it("is the SAME series across programmes", () => {
    // One institute-wide series per session and campus. A series per programme
    // would hand a student a second number when they took a second course,
    // which is exactly what the number must not do.
    const base = { instituteCode: "CIIT", sessionCode: "SP26", campusCode: "ISB" };
    expect(svc.buildSeriesKey({ ...base, programmeCode: "DM" })).toBe(
      svc.buildSeriesKey({ ...base, programmeCode: "GD" }),
    );
    expect(svc.buildSeriesKey({ ...base, programmeCode: "GD" })).toBe(
      svc.buildSeriesKey(base),
    );
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
  const svc = new RegistrationNumberService(configWith(), settingsWith());

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
      campusCode: "ISB",
    });

    expect(result).toEqual({ registrationNo: "CIIT/SP26-034/ISB", sequence: 34 });

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
