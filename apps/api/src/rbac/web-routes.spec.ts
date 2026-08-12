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

  /**
   * EVERY SIGNED-OUT ADDRESS RESOLVES WHEN SIGNED IN TOO.
   *
   * The second defect of this shape, and it reached a user. The sign-in form
   * lives at /login; nothing navigated away from it afterwards, because the
   * session simply appeared and the signed-in route table took over. That
   * table had no /login, so its catch-all caught it and showed "page not
   * found" to somebody who had just successfully signed in.
   *
   * The two tables are written hundreds of lines apart and neither mentions
   * the other, so nothing about reading either one reveals the gap. This
   * compares them.
   */
  /**
   * EVERY PAGE APPEARS IN THE STYLING CHECKLIST.
   *
   * BEAUTIFICATION.md claims to cover all of them, and a claim like that is
   * true on the day it is written and quietly false a month later. A page
   * added afterwards and never styled would look exactly like one that was —
   * which is the whole thing the document exists to prevent.
   */
  it("BEAUTIFICATION.md names every page", () => {
    const doc = join(WEB, "..", "..", "..", "BEAUTIFICATION.md");
    if (!existsSync(doc)) throw new Error("BEAUTIFICATION.md is missing.");
    const text = readFileSync(doc, "utf8");

    const pages = readdirSync(PAGES)
      .filter((f) => f.endsWith(".tsx"))
      .map((f) => f.replace(/\.tsx$/, ""));

    // Guards the guard: a wrong path here would find no pages and pass.
    expect(pages.length).toBeGreaterThan(20);

    const missing = pages.filter((p) => !text.includes(p));
    expect(missing).toEqual([]);
  });

  it("every address a signed-out visitor can be at also resolves signed in", () => {
    /*
     * SLICED ON THE <Routes> BLOCK, not on a nearby identifier.
     *
     * The first version cut from `if (!user)` to `mustChangePassword`, which
     * is destructured from useAuth at the top of the file — hundreds of lines
     * ABOVE the gate. The slice was therefore empty, no paths were collected,
     * and the assertion passed against a codebase with the bug still in it.
     * It was only found by deleting the fix and watching this stay green.
     */
    const gate = app.indexOf("if (!user)");
    const closes = app.indexOf("</Routes>", gate);
    expect(gate).toBeGreaterThan(-1);
    expect(closes).toBeGreaterThan(gate);

    const signedOut = app.slice(gate, closes);
    const publicPaths = [...signedOut.matchAll(/<Route path="([^"*]+)"/g)]
      .map((m) => m[1] as string)
      .filter((p) => p !== "/");

    // Guards the guard: if this ever collects nothing, the assertion below
    // proves nothing and would pass forever.
    expect(publicPaths.length).toBeGreaterThan(0);

    // Everything after that block is the signed-in table, plus the early
    // returns above it (/verify/:code, /home) which resolve for anybody.
    const signedIn = app.slice(closes);
    const early = [...app.matchAll(/location\.pathname (?:===|\.startsWith\()\s*"([^"]+)"/g)].map(
      (m) => m[1] as string,
    );

    const orphaned = publicPaths.filter(
      (p) =>
        !signedIn.includes(`path="${p}"`) &&
        !early.some((e) => p.startsWith(e)),
    );

    expect(orphaned).toEqual([]);
  });

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

  /**
   * Every class a page uses is one the stylesheet defines.
   *
   * AN UNKNOWN CLASS IS NOT AN ERROR IN CSS. It is silently nothing, so a page
   * that asks for `.register` after the rule has gone renders as unstyled rows
   * and the build is perfectly happy — exactly as it was happy about a page
   * nobody routed.
   *
   * This check found THIRTY-ONE dropped classes across two passes of the
   * redesign: the attendance register's cursor row, the modals, the
   * notification panel, the impersonation banner, the video player. It is here
   * so the next restyle cannot lose them quietly.
   */
  it("defines every class the pages use", () => {
    const css = readFileSync(join(WEB, "styles.css"), "utf8");
    const defined = new Set([...css.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]!));

    const used = new Map<string, string>();
    const files = [
      ...readdirSync(PAGES).map((f) => join(PAGES, f)),
      ...readdirSync(join(WEB, "components")).map((f) => join(WEB, "components", f)),
    ].filter((f) => f.endsWith(".tsx"));

    for (const file of files) {
      // Only plain string literals. A className built from an expression can
      // hold anything, and guessing at it would produce false alarms — which
      // is how a guard gets deleted.
      for (const m of readFileSync(file, "utf8").matchAll(/className="([^"]+)"/g)) {
        for (const c of m[1]!.split(/\s+/)) {
          if (/^[a-zA-Z][\w-]*$/.test(c) && !used.has(c)) used.set(c, file.split(/[\\/]/).pop()!);
        }
      }
    }

    const missing = [...used]
      .filter(([c]) => !defined.has(c))
      .map(([c, where]) => `.${c} (used in ${where})`);

    expect(missing).toEqual([]);
    // And it is genuinely looking at something.
    expect(used.size).toBeGreaterThan(80);
  });

  it("WOULD catch an unrouted page", () => {
    // Proving the check rather than trusting that an empty result means a
    // clean app.
    const pretend = "<DashboardPage />";
    expect(new RegExp("<DashboardPage\\s*/>").test(pretend)).toBe(true);
    expect(new RegExp("<NeverRoutedPage\\s*/>").test(app)).toBe(false);
  });
});
