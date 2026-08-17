import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * EVERY ICON THE APP ASKS FOR IS ONE THE APP DRAWS.
 *
 * `Icon` falls back to the dashboard shape for a name it does not know, which
 * is the right runtime behaviour — a missing icon must not blank a page — but
 * it is SILENT. `<Icon name="chevron-left" />` on a component that has no
 * chevron renders a four-square grid where an arrow should be, on a button
 * that still works, and nothing in the build, the types or the tests says a
 * word. It is found by somebody looking at the screen, or never.
 *
 * The same reasoning as the CSS-class guard beside this one, and it lives in
 * the API suite for the same reason: that is the suite CI runs.
 */

const WEB = join(__dirname, "..", "..", "..", "web", "src");
const ICON_FILE = join(WEB, "components", "Icon.tsx");

/** Every .tsx under apps/web/src, at any depth. */
function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name);
    if (e.isDirectory()) return walk(full);
    return e.isFile() && e.name.endsWith(".tsx") ? [full] : [];
  });
}

describe("icon names", () => {
  it("can find the icon set and the pages", () => {
    // Not a skip. A guard that quietly passes when it cannot find the thing it
    // guards is worse than no guard — it reports green forever.
    expect(existsSync(ICON_FILE)).toBe(true);
    expect(walk(WEB).length).toBeGreaterThan(20);
  });

  it("defines every icon the app uses", () => {
    const source = readFileSync(ICON_FILE, "utf8");
    // Both spellings the record uses: bare keys and quoted ones.
    const defined = new Set(
      [...source.matchAll(/^\s{2}"?([a-z][\w-]*)"?:\s*$|^\s{2}"?([a-z][\w-]*)"?:\s*"/gm)]
        .map((m) => m[1] ?? m[2])
        .filter((n): n is string => !!n),
    );
    expect(defined.size).toBeGreaterThan(20);

    const missing: string[] = [];
    for (const file of walk(WEB)) {
      const content = readFileSync(file, "utf8");
      // Only literal names. A name computed at runtime — iconFor(subject) —
      // cannot be checked here, and pretending otherwise would be worse.
      for (const m of content.matchAll(/<Icon\s+name="([^"]+)"/g)) {
        if (!defined.has(m[1]!)) missing.push(`${file.split(/[\\/]/).pop()!}: "${m[1]!}"`);
      }
    }

    expect(missing).toEqual([]);
  });

  it("WOULD catch an icon that does not exist", () => {
    // The guard above is only worth having if it can fail. This proves the
    // matching works rather than trusting that an empty result means clean.
    const defined = new Set(["play", "check"]);
    const used = [...'<Icon name="chevron-left" />'.matchAll(/<Icon\s+name="([^"]+)"/g)].map(
      (m) => m[1]!,
    );
    expect(used).toEqual(["chevron-left"]);
    expect(used.filter((n) => !defined.has(n))).toEqual(["chevron-left"]);
  });
});
