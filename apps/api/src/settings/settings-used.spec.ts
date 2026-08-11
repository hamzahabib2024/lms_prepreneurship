import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { CATALOGUE } from "./settings-catalogue";

/**
 * The sixth static guard: EVERY SETTING READ IN CODE IS DECLARED.
 *
 * The catalogue already refuses to WRITE a key it does not know — a misspelled
 * `attendance.warningThresold` is rejected rather than saved and never read.
 * This is the other half, and until it existed the other half was missing: a
 * key can be READ that nobody can ever set.
 *
 * That failure is silent by construction. The read returns nothing, the code
 * falls back to its default, and the setting appears nowhere on the settings
 * screen — so the Institute cannot discover it exists, let alone change it.
 * The receipt shipped with exactly two of these: `institute.campus`, which
 * would have printed a blank line forever, and `finance.receiptNote`, the
 * sentence at the foot of every receipt, which the Institute could never have
 * customised. Both looked fine in a probe, because a default IS a value.
 *
 * It is the same shape as the guard on `@RequirePermission` — a name that
 * matches nothing, failing quietly rather than loudly — and it is caught the
 * same way: by reading the source rather than trusting review.
 */

const SRC = join(__dirname, "..");

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, found);
    else if (entry.endsWith(".ts") && !entry.endsWith(".spec.ts")) found.push(full);
  }
  return found;
}

/**
 * The ways a setting is read: `settings.text("x")`, `settings.number("x")`,
 * `settings.bool("x")`, and indexing the resolved map as `resolved["x"]`.
 *
 * Matched on a dotted key, so ordinary strings are not swept up. A key that is
 * built at runtime rather than written literally would slip past this — there
 * are none today, and one would be worth arguing about rather than hiding.
 */
const READS = [
  /\bsettings\.(?:text|number|bool|flag)\(\s*"([a-z][A-Za-z]*\.[A-Za-z.]+)"/g,
  // ANY bracket index by a dotted key. Written narrowly at first as
  // `resolved["x"]`, which missed `(await this.settings.resolveFor())["x"]` —
  // the form the maintenance guard actually uses. A guard with a hole in it is
  // the thing it exists to prevent, so this matches the shape rather than one
  // variable name. Dotted string literals used as an index are settings keys
  // in this codebase; a false positive fails loudly and gets looked at, which
  // is the right way round.
  /\[\s*"([a-z][A-Za-z]*\.[A-Za-z.]+)"\s*\]/g,
];

describe("every setting the code reads is one the Institute can set", () => {
  const declared = new Set(CATALOGUE.map((s) => s.key));
  const used = new Map<string, string>(); // key -> where

  beforeAll(() => {
    for (const file of sourceFiles(SRC)) {
      // The catalogue itself declares the keys; it is not a caller.
      if (file.endsWith("settings-catalogue.ts")) continue;
      const text = readFileSync(file, "utf8");
      for (const pattern of READS) {
        for (const match of text.matchAll(pattern)) {
          const key = match[1]!;
          if (!used.has(key)) used.set(key, file.slice(SRC.length + 1));
        }
      }
    }
  });

  it("finds no key that is read but never declared", () => {
    const undeclared = [...used]
      .filter(([key]) => !declared.has(key))
      .map(([key, where]) => `${key} (read in ${where})`);
    expect(undeclared).toEqual([]);
  });

  it("is actually finding the reads, not scanning an empty set", () => {
    // A guard that matches nothing passes forever. These are keys the System
    // genuinely reads today; if the accessors are renamed this fails, which is
    // the correct outcome — the pattern above then needs updating too.
    expect(used.size).toBeGreaterThanOrEqual(8);
    expect([...used.keys()]).toEqual(expect.arrayContaining([
      "attendance.warningThreshold",
      "institute.name",
      "maintenance.enabled",
    ]));
  });

  it("WOULD catch an undeclared key", () => {
    // Proving the patterns match what they claim, rather than trusting that an
    // empty result means a clean codebase.
    const sample = 'const x = await this.settings.text("finance.madeUpKey");';
    const found = [...sample.matchAll(READS[0]!)].map((m) => m[1]);
    expect(found).toEqual(["finance.madeUpKey"]);
    expect(declared.has("finance.madeUpKey")).toBe(false);
  });

  it("does not sweep up ordinary strings that merely contain a dot", () => {
    const innocent = 'logger.log("saved to disk. done"); const f = "file.txt";';
    for (const pattern of READS) {
      expect([...innocent.matchAll(pattern)]).toEqual([]);
    }
  });
});
