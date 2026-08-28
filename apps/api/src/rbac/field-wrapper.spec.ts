import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * The eighth static guard: THE FIELD WRAPPER DOES NOT LIE ABOUT A FILE INPUT,
 * AND DOES NOT SWALLOW A REF.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS: both defects reached a person, on the same screen, from the
 * same change. Adding tick-and-cross marks to every data-entry field wrapped
 * about a hundred inputs in <Field>, and two things about that wrapper are
 * wrong for a file input specifically.
 *
 *   1. IT DECIDED "FILLED" FROM `props.value`. A file input is uncontrolled —
 *      React does not allow a value on one — so a chosen file reads as empty.
 *      The cohort import's file field is `required`, so picking a CSV and
 *      pressing "Check the file" painted a red cross saying "This is needed
 *      before you can continue." The import worked; the screen said it had not
 *      been given a file. Somebody concluded the System would not accept their
 *      CSV, which is a reasonable thing to conclude when it says so.
 *
 *   2. IT REPLACED THE CHILD'S REF. `cloneElement` with a `ref` in the config
 *      overrides whatever the child had. Three file inputs hold a ref to clear
 *      the picker afterwards, and every one of those calls is guarded with
 *      `if (input.current)` — so nothing threw and nothing logged. "Start
 *      again" quietly stopped clearing the filename.
 *
 * NEITHER WAS A TYPE ERROR AND NEITHER WAS A TEST FAILURE. TypeScript is
 * content: `props.value` is legitimately optional, and an overridden ref is
 * ordinary React. This reads the file instead.
 *
 * IT ASSERTS THE MECHANISM, not the rendering, because there is no DOM in this
 * suite. That is a weaker test than mounting the component — and a great deal
 * stronger than the nothing that was there before.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// apps/api/src/rbac -> apps -> web/src
const WEB = join(__dirname, "..", "..", "..", "web", "src");
const FIELD = join(WEB, "components", "Field.tsx");

describe("the Field wrapper handles a file input honestly", () => {
  it("can find Field.tsx at all", () => {
    // A guard that scans nothing passes forever.
    expect(existsSync(FIELD)).toBe(true);
    expect(readFileSync(FIELD, "utf8").length).toBeGreaterThan(500);
  });

  const field = existsSync(FIELD) ? readFileSync(FIELD, "utf8") : "";

  /**
   * A file input's contents come from the element, never from a prop.
   */
  it("reads a file input's own files rather than props.value", () => {
    expect(field).toMatch(/type\s*===\s*["']file["']/);
    // The `filled` decision must branch on it, not merely mention it.
    expect(field).toMatch(/filled\s*=\s*isFile\s*\?/);
  });

  /**
   * Picking a file is the only signal a file input reliably gives — the picker
   * takes focus and hands it back, so blur may never come. Without this a
   * correctly chosen file shows no tick at all.
   */
  it("treats choosing a file as having touched the field", () => {
    const onChange = field.slice(field.indexOf("isFile"));
    expect(onChange).toMatch(/setFileCount/);
    expect(onChange).toMatch(/setTouched\(true\)/);
  });

  /**
   * THE CHILD'S REF SURVIVES THE CLONE.
   *
   * Asserted as "does not pass the bare ref object", because that is the exact
   * shape of the defect: `ref: control` in the cloneElement config.
   */
  it("composes the child's ref instead of overriding it", () => {
    expect(field).not.toMatch(/\bref:\s*control\s*,/);
    expect(field).toMatch(/\bref:\s*setRef\s*,/);
    // And the composed setter must actually forward to whatever was there.
    expect(field).toMatch(/typeof\s+childRef\s*===\s*["']function["']/);
  });
});

/**
 * The other half: the inputs this wrapper is put around.
 *
 * A file input wrapped in a `required` Field is the combination that produced
 * the visible defect, so it is worth knowing where they are — not to forbid
 * them, but so that this guard is exercised by something real. If the last one
 * is ever removed, the assertion above stops protecting anything and this says
 * so rather than passing quietly.
 */
describe("the wrapper is actually used around file inputs", () => {
  const PAGES = join(WEB, "pages");
  const COMPONENTS = join(WEB, "components");

  const sources = (): string[] => {
    const out: string[] = [];
    for (const dir of [PAGES, COMPONENTS]) {
      if (!existsSync(dir)) continue;
      for (const f of readdirSync(dir)) {
        if (f.endsWith(".tsx")) out.push(readFileSync(join(dir, f), "utf8"));
      }
    }
    return out;
  };

  it("still has at least one file input inside a Field", () => {
    const all = sources();
    expect(all.length).toBeGreaterThan(20);

    const wrapped = all.filter((text) =>
      /<Field[^>]*>\s*<input[^>]*type="file"/s.test(text),
    );
    expect(wrapped.length).toBeGreaterThan(0);
  });
});
