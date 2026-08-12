/**
 * Creates that name a scope-bearing id — SRS ARC-051.
 *
 * A STATIC GUARD against the second structural limit of the scope predicate.
 *
 * The extension works by injecting a `where`. A create has none, so `create`,
 * `createMany` and `upsert` write wherever their data says. A caller supplying
 * a sectionSubjectId therefore writes into any section in the Institute unless
 * something checks it.
 *
 * That produced two real defects in one afternoon — a teacher posting an
 * announcement to a class they do not teach, and a teacher creating an
 * ASSIGNMENT in one, setting homework for students they do not teach who would
 * see it and submit to it. I found both by sweeping the codebase by hand, which
 * is the same method that missed them when the code was written.
 *
 * This walks every `prisma.scoped.<model>` create in the API, finds the
 * scope-bearing foreign keys in its data, and fails when the value did not come
 * from the ACTOR and the enclosing method makes no assertion about it.
 *
 * WHAT IT DOES NOT COVER: asSystem. That call is an explicit, visible statement
 * that the caller is bypassing scope on purpose — writing thirty inboxes,
 * recording an audit row, marking a whole register — and demanding an assertion
 * inside every one would flag mostly legitimate system work and train people to
 * add the exemption without thinking. The bypass is the review point; this
 * guard is for the creates that LOOK scoped and are not.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";

const SRC = join(__dirname, "..");

/** Operations that write without a `where` the extension could constrain. */
const CREATE_OPS = new Set(["create", "createMany", "createManyAndReturn", "upsert"]);

/**
 * Foreign keys that decide WHOSE data a row becomes.
 *
 * A row naming one of these belongs to a section, a person or a class. Every
 * other column is either the row's own content or a reference that follows from
 * one of these.
 */
const SCOPE_BEARING = new Set(["sectionSubjectId", "sectionId", "studentId", "teacherId"]);

/** Helpers that make the check the predicate cannot. */
const ASSERTIONS = new Set([
  "assertOwnsSectionSubject",
  "assertOwnsSection",
  "assertOwnStudent",
  "assertInstituteWide",
  "requireOwnStudentId",
]);

/**
 * Creates that need no assertion, each with the reason.
 *
 * Keyed by "<file>::<method>". An entry is a claim that the ids cannot come
 * from the caller — say why, so the next reader can check rather than trust.
 */
const ACKNOWLEDGED: Record<string, string> = {
  "assessment/submission-file.service.ts::upload":
    "studentId is actor.studentId; assignmentId was just read through the " +
    "scoped client, which refuses an assignment outside the student's sections.",
  "certificate/certificate.service.ts::issueForSubject":
    "Admin-only (certificate:create with the certificate_issuer sub-permission), " +
    "so ALL scope applies and there is no section to be outside of. The " +
    "studentId is checked against the completion criteria before anything is " +
    "written.",
  "academic/academic.service.ts::offerSubject":
    "Admin-only. §4.5 gives no teacher `section_subject:create`.",
  "academic/student-note.service.ts::create":
    "BOTH ids are read back through the scoped client immediately before the " +
    "write, and both refusals are raised rather than logged: the " +
    "sectionSubject findFirst returns nothing for a class this teacher does " +
    "not teach, and the student findFirst returns nothing for somebody outside " +
    "their sections. The authorUserId is actor.userId. This is a real check " +
    "the scanner cannot see, not an exemption.",
  "academic/assignment.service.ts::create":
    "Admin-only teacher assignment (FR-CRS-021). A teacher explicitly cannot " +
    "write their own assignment — BR-ACC-04 — and the matrix grants them read " +
    "on this resource and nothing more.",
  "live/live-session.service.ts::schedule":
    "Reads the SectionSubject through the scoped client first and fails if it " +
    "is not returned, which refuses a section the teacher does not teach. That " +
    "is the read-then-act pattern; the assertion would be redundant.",
  "live/attendance.service.ts::markBulk":
    "The register is `attendance_register`, teacher and admin only, and the " +
    "live session was read through the scoped client before any row is written.",
};

interface Violation {
  file: string;
  method: string;
  model: string;
  key: string;
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (entry.endsWith(".ts") && !entry.endsWith(".spec.ts")) out.push(full);
  }
  return out;
}

/** `this.prisma.scoped.assignment.create` -> { model: "assignment" }. */
function scopedCreate(node: ts.CallExpression): { model: string; op: string } | null {
  if (!ts.isPropertyAccessExpression(node.expression)) return null;
  const op = node.expression.name.text;
  if (!CREATE_OPS.has(op)) return null;

  const modelAccess = node.expression.expression;
  if (!ts.isPropertyAccessExpression(modelAccess)) return null;
  const scopedAccess = modelAccess.expression;
  if (!ts.isPropertyAccessExpression(scopedAccess)) return null;
  if (scopedAccess.name.text !== "scoped") return null;

  return { model: modelAccess.name.text, op };
}

/** The method or function that encloses a node, for reporting and for scanning. */
function enclosingMethod(node: ts.Node): { name: string; body: ts.Node } | null {
  let current: ts.Node | undefined = node;
  while (current) {
    if (
      (ts.isMethodDeclaration(current) || ts.isFunctionDeclaration(current)) &&
      current.name &&
      current.body
    ) {
      return { name: current.name.getText(), body: current.body };
    }
    current = current.parent;
  }
  return null;
}

/** Whether the enclosing method calls one of the assertion helpers. */
function hasAssertion(body: ts.Node): boolean {
  let found = false;
  const visit = (n: ts.Node): void => {
    if (found) return;
    if (ts.isCallExpression(n)) {
      const callee = ts.isIdentifier(n.expression)
        ? n.expression.text
        : ts.isPropertyAccessExpression(n.expression)
          ? n.expression.name.text
          : "";
      if (ASSERTIONS.has(callee)) {
        found = true;
        return;
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(body);
  return found;
}

/**
 * Whether a value came from the ACTOR rather than from the caller.
 *
 * `actor.studentId`, `studentId` where that was assigned from the actor, and
 * `this.something` are all treated as safe; an `input.x` or a bare parameter is
 * not. The check is on the ROOT of the expression, so `actor.studentId` passes
 * and `input.studentId` does not.
 */
function fromActor(expr: ts.Expression, methodBody: ts.Node): boolean {
  const rootOf = (e: ts.Expression): string => {
    let current: ts.Expression = e;
    while (ts.isPropertyAccessExpression(current)) current = current.expression;
    return ts.isIdentifier(current) ? current.text : "";
  };

  const root = rootOf(expr);
  if (root === "actor") return true;

  // A local assigned from the actor, e.g. `const studentId = actor.studentId`.
  let assignedFromActor = false;
  const visit = (n: ts.Node): void => {
    if (assignedFromActor) return;
    if (
      ts.isVariableDeclaration(n) &&
      ts.isIdentifier(n.name) &&
      n.name.text === root &&
      n.initializer &&
      rootOf(n.initializer) === "actor"
    ) {
      assignedFromActor = true;
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(methodBody);
  return assignedFromActor;
}

function scan(): Violation[] {
  const found: Violation[] = [];

  for (const path of sourceFiles(SRC)) {
    const file = relative(SRC, path).split(sep).join("/");
    const source = ts.createSourceFile(
      path,
      readFileSync(path, "utf8"),
      ts.ScriptTarget.ES2022,
      true,
    );

    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const target = scopedCreate(node);
        const arg = node.arguments[0];
        if (target && arg) {
          const method = enclosingMethod(node);
          const key = `${file}::${method?.name ?? "?"}`;

          if (!(key in ACKNOWLEDGED) && method && !hasAssertion(method.body)) {
            // Every object literal under the arguments — covers a plain data
            // object, an array of them, and a .map() producing them.
            const literals: ts.ObjectLiteralExpression[] = [];
            const collect = (n: ts.Node): void => {
              if (ts.isObjectLiteralExpression(n)) literals.push(n);
              ts.forEachChild(n, collect);
            };
            collect(arg);

            for (const literal of literals) {
              for (const prop of literal.properties) {
                if (!ts.isPropertyAssignment(prop)) continue;
                const name = ts.isIdentifier(prop.name) ? prop.name.text : null;
                if (!name || !SCOPE_BEARING.has(name)) continue;
                if (fromActor(prop.initializer, method.body)) continue;

                found.push({ file, method: method.name, model: target.model, key: name });
              }
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }

  // One report per method and key, however many literals produced it.
  const seen = new Set<string>();
  return found.filter((v) => {
    const id = `${v.file}::${v.method}::${v.key}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

describe("creates that name a scope-bearing id", () => {
  const violations = scan();

  it("parses the source tree", () => {
    expect(sourceFiles(SRC).length).toBeGreaterThan(30);
  });

  it("checks the id, or says why it needs no checking", () => {
    if (violations.length > 0) {
      const detail = violations
        .map(
          (v) =>
            `  ${v.file}\n` +
            `    ${v.method}() creates ${v.model} with ${v.key} from the caller\n` +
            `    The scope predicate does not constrain a create. Call ` +
            `assertOwnsSectionSubject (or the matching helper) before writing, or ` +
            `add an ACKNOWLEDGED entry explaining why the id cannot come from ` +
            `outside the caller's scope.`,
        )
        .join("\n\n");

      throw new Error(
        `These creates write wherever their data says:\n\n${detail}\n\n` +
          `See the header of scope.extension.ts.`,
      );
    }
    expect(violations).toEqual([]);
  });

  it("keeps every acknowledgement pointing at a real method", () => {
    // A stale entry reads as a considered decision about code that no longer
    // exists, and would hide the next real violation in the same method.
    const live = new Set<string>();
    for (const path of sourceFiles(SRC)) {
      const file = relative(SRC, path).split(sep).join("/");
      const text = readFileSync(path, "utf8");
      for (const key of Object.keys(ACKNOWLEDGED)) {
        const [keyFile, method] = key.split("::");
        if (keyFile === file && method && text.includes(`${method}(`)) live.add(key);
      }
    }
    expect(Object.keys(ACKNOWLEDGED).filter((k) => !live.has(k))).toEqual([]);
  });

  it("recognises the assertion helpers that exist", () => {
    // Guards the guard: a renamed helper would silently make every create look
    // unguarded, or — worse — every acknowledgement look justified.
    const ownership = readFileSync(join(SRC, "rbac", "ownership.ts"), "utf8");
    for (const helper of ASSERTIONS) {
      expect(ownership).toContain(`export function ${helper}`);
    }
  });
});
