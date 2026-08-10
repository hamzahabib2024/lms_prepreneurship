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
