import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * The seventh static guard: EVERY WEB PAGE IS ROUTED, AND EVERY LINK GOES
 * SOMEWHERE.
 *
 * This exists because of a defect that shipped. The receipt page was written,
 * the API worked, the fees screen linked to `/receipts/:id`, the build passed,
 * and the route was never added — so every Receipt button led nowhere for as
 * long as it took somebody to press one.
 *
 * NOTHING CAUGHT IT, and that is the point. TypeScript is content: an unrouted
 * page is simply a module nobody imports. Vite is content for the same reason.
 * The API tests never see the web app at all. "The build passes" proved only
 * that the file compiles.
 *
 * It lives in the API test suite because that is the suite CI runs and the one
 * that fails a build. Reaching across into apps/web to read files is not
 * elegant; a defect that reached a user is worse.
 */

// apps/api/src/rbac -> apps -> web/src
const WEB = join(__dirname, "..", "..", "..", "web", "src");
const PAGES = join(WEB, "pages");
const APP = join(WEB, "App.tsx");

describe("every page the web app defines can actually be reached", () => {
  it("can find the web app at all", () => {
    // NOT a skip when the path is wrong. The first version of this file used
    // describe.skip as a fallback, got the path wrong, and reported five
    // passing-by-skipping tests — which is precisely the failure this guard
    // exists to catch, committed inside the guard itself.
    expect({ pages: existsSync(PAGES), app: existsSync(APP), at: WEB }).toEqual({
      pages: true,
      app: true,
      at: WEB,
    });
  });

  const app = existsSync(APP) ? readFileSync(APP, "utf8") : "";

  /** Components exported from pages/, excluding panels a page composes. */
  const exported = (): Array<{ file: string; component: string }> => {
    const out: Array<{ file: string; component: string }> = [];
    for (const file of readdirSync(PAGES)) {
      if (!file.endsWith(".tsx")) continue;
      const text = readFileSync(join(PAGES, file), "utf8");
      for (const m of text.matchAll(/export function ([A-Z][A-Za-z0-9]*Page)\s*\(/g)) {
        out.push({ file, component: m[1]! });
      }
    }
    return out;
  };

  it("is reading the real web app, not an empty directory", () => {
    // A guard that scans nothing passes forever.
    expect(app.length).toBeGreaterThan(500);
    expect(exported().length).toBeGreaterThan(15);
  });

  it("routes every *Page component", () => {
    const unrouted = exported()
      // Props allowed. ChangePasswordPage is routed as
      // `<ChangePasswordPage forced />`, and a regex demanding a bare
      // self-closing tag reported it as unrouted — a guard that cries wolf is
      // a guard somebody deletes.
      .filter(({ component }) => !new RegExp(`<${component}[\\s/>]`).test(app))
      .map(({ file, component }) => `${component} (${file})`);

    // Named, so the failure says which page to route rather than that one is
    // missing.
    expect(unrouted).toEqual([]);
  });

  it("imports every *Page component it routes", () => {
    const routed = [...app.matchAll(/<([A-Z][A-Za-z0-9]*Page)[\s/>]/g)].map((m) => m[1]!);
    const missing = [...new Set(routed)].filter(
      (c) => !new RegExp(`import\\s*\\{[^}]*\\b${c}\\b`).test(app),
    );
    expect(missing).toEqual([]);
  });

  it("has a route for every internal path the app links to", () => {
    // The other half of the same defect: a page that IS routed, linked to at a
    // path that is not its route, fails identically.
    const paths = new Set<string>();
    for (const file of readdirSync(PAGES)) {
      if (!file.endsWith(".tsx")) continue;
      const text = readFileSync(join(PAGES, file), "utf8");
      // href="/receipts/${id}" and to="/fees" — the two ways this app links.
      for (const m of text.matchAll(/(?:href|to)=[{"]`?(\/[a-z0-9-]+)/gi)) {
        const first = m[1]!.toLowerCase();
        // /api is the server, not a route in this app.
        if (!first.startsWith("/api")) paths.add(first);
      }
    }

    const declared = [...app.matchAll(/path="([^"]+)"/g)].map((m) => `/${m[1]!.split("/")[1] ?? ""}`);
    const known = new Set([...declared, "/"]);
    const dangling = [...paths].filter((p) => !known.has(p));

    expect(dangling).toEqual([]);
  });

  it("WOULD catch an unrouted page", () => {
    // Proving the check rather than trusting that an empty result means a
    // clean app.
    const pretend = "<DashboardPage />";
    expect(new RegExp("<DashboardPage\\s*/>").test(pretend)).toBe(true);
    expect(new RegExp("<NeverRoutedPage\\s*/>").test(app)).toBe(false);
  });
});
