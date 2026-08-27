/**
 * Every guarded route must be reachable by SOMEBODY.
 *
 * THE FOURTH DEFECT OF ONE SHAPE. A route guarded by a permission nobody holds
 * is not refused loudly — it is refused politely, to everyone, forever, and it
 * looks exactly like a working endpoint until somebody tries it:
 *
 *   an impersonation forbidden-list naming five resources that did not exist,
 *   which protected nothing while looking as though it did;
 *
 *   step-up, which never issued a token proving itself, so four operations
 *   demanding it were unreachable by anybody;
 *
 *   `payment:configure` on the fee reconcile route, when the matrix grants
 *   payment FULL and FULL has no `configure` in it;
 *
 *   and the settings catalogue, where a misspelled key was accepted and read
 *   by nothing.
 *
 * Each was found by running the code. This finds them at build time instead: it
 * reads every @RequirePermission in the codebase and asserts the pair can be
 * satisfied by at least one role. It cannot tell whether the RIGHT role holds
 * it — that is what report-authorisation.spec.ts and the probes are for — only
 * that the door has a key somewhere.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { ROLES, RESOURCES, ACTIONS, resolvePermission, type Action, type Resource } from "@lms/shared";

const SRC = join(__dirname, "..");

function controllerFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) found.push(...controllerFiles(path));
    else if (entry.endsWith(".controller.ts")) found.push(path);
  }
  return found;
}

interface Guarded {
  file: string;
  resource: string;
  action: string;
}

function guardedRoutes(): Guarded[] {
  const found: Guarded[] = [];
  for (const file of controllerFiles(SRC)) {
    const source = readFileSync(file, "utf8");
    const pattern = /@RequirePermission\(\s*"([a-z_]+)"\s*,\s*"([a-z_]+)"\s*\)/g;
    for (const match of source.matchAll(pattern)) {
      found.push({
        file: relative(SRC, file).split(sep).join("/"),
        resource: match[1] as string,
        action: match[2] as string,
      });
    }
  }
  return found;
}

/** Somebody, with every sub-permission and freshly stepped up, may do it. */
function reachableByAnyone(resource: Resource, action: Action): boolean {
  return ROLES.some(
    (role) =>
      resolvePermission(
        {
          roles: [role],
          // The most generous possible caller. If even THIS cannot pass, no
          // real user ever will.
          subPermissions: ["admin_manager", "financial_reporter", "bulk_operator", "certificate_issuer"],
          steppedUp: true,
        },
        resource,
        action,
      ).allowed,
  );
}

describe("every guarded route can be reached by somebody", () => {
  const routes = guardedRoutes();

  it("finds the guards at all", () => {
    // If the pattern stops matching, every assertion below passes vacuously
    // and this file becomes decoration.
    expect(routes.length).toBeGreaterThan(100);
  });

  it("names only resources that exist in the §4.5 matrix", () => {
    const known = new Set<string>(RESOURCES as readonly string[]);
    const unknown = routes.filter((r) => !known.has(r.resource));
    expect(
      unknown.map((r) => `${r.file}: "${r.resource}" is not a resource`),
    ).toEqual([]);
  });

  it("names only actions that exist", () => {
    const known = new Set<string>(ACTIONS as readonly string[]);
    const unknown = routes.filter((r) => !known.has(r.action));
    expect(unknown.map((r) => `${r.file}: "${r.action}" is not an action`)).toEqual([]);
  });

  it("uses a resource/action pair SOME role can satisfy", () => {
    // The one that matters. `payment:configure` passed both checks above —
    // payment is a real resource and configure is a real action — and was
    // still granted to nobody, because the matrix gives payment FULL and FULL
    // does not include configure.
    const unreachable = routes
      .filter((r) => reachableByAnyone(r.resource as Resource, r.action as Action) === false)
      .map((r) => `${r.file}: ${r.resource}:${r.action} is granted to no role`);

    expect(unreachable).toEqual([]);
  });
});

/**
 * A DECORATOR THAT DRIFTED OFF ITS METHOD.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * This one really happened. A new route was inserted above `@Post("password/
 * change")` — a reasonable anchor — and landed BETWEEN that route and the
 * `@RequirePermission` above it:
 *
 *     @RequirePermission("own_password", "update")   <- meant for change
 *     @Public()                                      <- the new route
 *     @Post("password/forgot")
 *     forgotPassword(...)
 *
 *     @Post("password/change")                       <- now unguarded
 *     changePassword(...)
 *
 * Two faults from one edit, and NEITHER shows up as a failing test: the
 * forgotten-password route carried a permission requirement AND @Public, which
 * are contradictory; and change-password silently lost its permission check.
 * It still needed a token, so nothing looked broken — the specific check was
 * simply gone.
 *
 * Decorators bind to the next DECLARATION, not the next decorator, so a
 * comment or another decorator between them changes nothing to TypeScript and
 * everything to the reader. Only a check like this notices.
 * ─────────────────────────────────────────────────────────────────────────────
 */
describe("no permission decorator has drifted onto the wrong route", () => {
  const ROUTE = /@(Get|Post|Put|Patch|Delete)\s*\(/;
  const REQUIRES = /@RequirePermission\s*\(/;
  const PUBLIC = /@Public\s*\(\s*\)/;

  /** Every @RequirePermission, with whatever sits between it and its route. */
  function suspicious(file: string): string[] {
    const lines = readFileSync(file, "utf8").split("\n");
    const problems: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      if (!REQUIRES.test(lines[i] ?? "")) continue;

      // Walk forward to the route decorator this one is guarding.
      for (let j = i + 1; j < lines.length; j++) {
        const line = lines[j] ?? "";
        if (ROUTE.test(line)) break; // reached its route — nothing between

        /*
         * A SECOND @RequirePermission before any route means the first one
         * guards nothing: they would both land on the same method, and the
         * later call wins.
         */
        if (REQUIRES.test(line)) {
          problems.push(
            `${relative(SRC, file)}:${i + 1} — a second @RequirePermission at line ${j + 1} ` +
              `before either reaches a route. One of them is guarding nothing.`,
          );
          break;
        }

        /*
         * @Public between a @RequirePermission and its route is the exact
         * shape of the bug above: the route ends up both guarded and public.
         */
        if (PUBLIC.test(line)) {
          problems.push(
            `${relative(SRC, file)}:${i + 1} — @RequirePermission is followed by @Public at ` +
              `line ${j + 1} before any route. A route cannot be both; a decorator has ` +
              `drifted onto the wrong method.`,
          );
          break;
        }

        // A method body started before any route decorator — the
        // @RequirePermission is attached to something that is not a route.
        if (/^\s*(async\s+)?[A-Za-z_$][\w$]*\s*\(/.test(line) && !line.trim().startsWith("*")) {
          break;
        }
      }
    }
    return problems;
  }

  it("keeps every @RequirePermission next to the route it guards", () => {
    const problems = controllerFiles(SRC).flatMap(suspicious);
    expect(problems).toEqual([]);
  });

  /**
   * The other half of the same bug: a route that changes a password, a role or
   * money must not be reachable with NOTHING declared about who may call it.
   *
   * Limited to the auth controller because that is where it happened and where
   * an unguarded write is worst. Widening it to every controller would flag the
   * genuinely public routes — the prospectus, certificate verification — and a
   * check that cries wolf gets deleted.
   */
  it("leaves no write in the auth controller without a guard or an explicit @Public", () => {
    const file = controllerFiles(SRC).find((f) => f.endsWith("auth.controller.ts"));
    expect(file).toBeDefined();
    const lines = readFileSync(file as string, "utf8").split("\n");

    const unguarded: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      if (!/@(Post|Put|Patch|Delete)\s*\(/.test(line)) continue;

      // Look back over this route's own decorators for a declaration.
      let declared = false;
      for (let j = i - 1; j >= 0; j--) {
        const above = lines[j] ?? "";
        if (REQUIRES.test(above) || PUBLIC.test(above)) {
          declared = true;
          break;
        }
        // Stop at the previous method — anything further up is not ours.
        if (/^\s*\}/.test(above)) break;
      }
      if (!declared) unguarded.push(`auth.controller.ts:${i + 1} — ${line.trim()}`);
    }

    expect(unguarded).toEqual([]);
  });
});
