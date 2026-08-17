import { ConfigService } from "@nestjs/config";
import { RegistrationNumberService } from "./registration-number.service";

/**
 * Defined-as-empty is not the same as unset.
 *
 * `docker-compose.yml` passes the Institute's codes through as
 * `${INSTITUTE_CODE:-}` so they can be set in .env — which means that on a
 * machine where they are NOT set, the container receives an EMPTY STRING
 * rather than nothing. ConfigService returns its default only for `undefined`,
 * so the empty string wins, and every registration number allocated on that
 * machine would be missing the institute and the campus.
 *
 * These tests pin the layer where that is absorbed. Both would have passed
 * before the compose change and both fail without the fix, because the trap is
 * in the interaction between the two files rather than in either one.
 */
describe("environment values that arrive blank", () => {
  const build = (env: Record<string, string | undefined>) =>
    new RegistrationNumberService(
      { get: (key: string, def?: string) => env[key] ?? def } as unknown as ConfigService,
      {} as never,
    );

  it("uses the default when the variable is absent", () => {
    const format = build({}).getFormat();
    expect(format.instituteCode).toBe("CIIT");
    expect(format.campusCode).toBe("ISB");
    expect(format.padWidth).toBe(3);
  });

  it("uses the default when the variable is present but empty", () => {
    const format = build({
      INSTITUTE_CODE: "",
      CAMPUS_CODE: "",
      REG_NO_TEMPLATE: "",
      REG_NO_PAD_WIDTH: "",
    }).getFormat();

    // The failure this prevents, spelled out: "/SP26-001/" with the institute
    // and campus silently missing from every number the Institute issues.
    expect(format.instituteCode).toBe("CIIT");
    expect(format.campusCode).toBe("ISB");
    expect(format.template).toContain("{INSTITUTE}");
    expect(format.padWidth).toBe(3);
  });

  it("still takes a real value over the default", () => {
    // Without this the check above is satisfied by ignoring the variable
    // entirely, which would be a green test over a broken setting.
    const format = build({ INSTITUTE_CODE: "PREP", CAMPUS_CODE: "LHR" }).getFormat();
    expect(format.instituteCode).toBe("PREP");
    expect(format.campusCode).toBe("LHR");
  });

  it("trims a value somebody typed with a trailing space", () => {
    expect(build({ INSTITUTE_CODE: " PREP " }).getFormat().instituteCode).toBe("PREP");
  });
});

/**
 * The same trap, one endpoint over, with a worse outcome: `Number("")` is 0,
 * so a blank APPLY_LIMIT_PER_HOUR would rate-limit every applicant in the
 * country to zero submissions an hour.
 */
describe("the application rate limit", () => {
  const original = process.env["APPLY_LIMIT_PER_HOUR"];
  afterEach(() => {
    if (original === undefined) delete process.env["APPLY_LIMIT_PER_HOUR"];
    else process.env["APPLY_LIMIT_PER_HOUR"] = original;
    jest.resetModules();
  });

  /** Re-imported per case: the decorator reads it when the class is defined. */
  const limitWith = async (value: string | undefined) => {
    if (value === undefined) delete process.env["APPLY_LIMIT_PER_HOUR"];
    else process.env["APPLY_LIMIT_PER_HOUR"] = value;
    jest.resetModules();
    const mod = await import("./admission.controller");
    // The throttle metadata the decorator wrote, read back off the method.
    const method = (mod.AdmissionController.prototype as unknown as Record<string, object>)[
      "submit"
    ];
    // @nestjs/throttler appends the named bucket to its own key, so a
    // @Throttle({ default: … }) lands under "THROTTLER:LIMIT" + "default".
    const meta: unknown = Reflect.getMetadata("THROTTLER:LIMITdefault", method as object);
    // The decorator accepts a number or a resolver, so handle both rather than
    // assuming which one this call site used.
    return typeof meta === "function" ? ((meta as () => number)() as unknown) : meta;
  };

  it.each([
    ["absent", undefined, 10],
    ["empty", "", 10],
    ["not a number", "many", 10],
    ["zero", "0", 10],
    ["negative", "-5", 10],
    ["a real value", "25", 25],
  ])("%s (%s) allows %s an hour", async (_name, value, expected) => {
    expect(await limitWith(value as string | undefined)).toBe(expected);
  });
});
