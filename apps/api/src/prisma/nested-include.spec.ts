/**
 * Nested includes of scoped models — SRS ARC-051.
 *
 * A STATIC GUARD against a whole class of bug, not a single instance.
 *
 * The scope predicate rewrites `args.where` for the model being queried. A
 * relation loaded alongside it is resolved by that same database query and
 * never re-enters the extension, so the child model's policy never runs:
 *
 *     prisma.scoped.assignmentSubmission.findMany({ include: { grade: true } })
 *              ^ AssignmentSubmission policy runs      ^ AssignmentGrade policy
 *                                                        does NOT run
 *
 * That produced two leaks in one afternoon — every unreleased mark visible to
 * its student (BR-ASG-09), and draft lectures visible inside published modules
 * (BR-CNT-01). Both were found by accident. This test walks every
 * `prisma.scoped.<model>` call in the API, resolves each nested relation
 * against the Prisma schema, and fails when a policed model is included without
 * the restriction being restated.
 *
 * A `where` on the nested read satisfies it. Prisma does not accept a `where`
 * on a to-one relation, so those must be listed in ACKNOWLEDGED below with the
 * reason the include is safe — which makes each one a decision somebody wrote
 * down rather than a default nobody noticed.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { Prisma } from "@prisma/client";
import ts from "typescript";
import { __testing } from "./scope.extension";

const POLICED = new Set(Object.keys(__testing.MODEL_POLICIES));
const STATE_FILTERED = new Set<string>(__testing.STATE_FILTERED);

/**
 * Which includes this guard demands a restatement for.
 *
 * TO-MANY of any policed model: Prisma accepts a `where` on the nested read,
 * so there is no reason not to restate, and a list is exactly where a child
 * policy would have removed rows.
 *
 * TO-ONE of a STATE_FILTERED model: holding the parent says nothing about
 * whether the child is published, released or available, so the traversal can
 * return the very row the policy exists to withhold.
 *
 * TO-ONE of an ownership-scoped model is NOT flagged. Those policies answer
 * "is this reachable from who you are?", and a row you already legitimately
 * hold is reachable from its own parent by construction — flagging all 50 of
 * them would bury the handful that matter under justifications nobody reads.
 */
function demandsRestatement(model: string, isList: boolean): boolean {
  if (!POLICED.has(model)) return false;
  return isList || STATE_FILTERED.has(model);
}
const SRC = join(__dirname, "..");

/** relation field -> { model, isList }, per model, straight from the schema. */
const RELATIONS = new Map<string, Map<string, { model: string; isList: boolean }>>();
for (const model of Prisma.dmmf.datamodel.models) {
  const fields = new Map<string, { model: string; isList: boolean }>();
  for (const f of model.fields) {
    if (f.kind === "object") fields.set(f.name, { model: f.type, isList: f.isList });
  }
  RELATIONS.set(model.name, fields);
}

const MODEL_BY_CAMEL = new Map(
  Prisma.dmmf.datamodel.models.map((m) => [m.name.charAt(0).toLowerCase() + m.name.slice(1), m.name]),
);

/**
 * Includes that are safe without a nested `where`, each with the reason.
 *
 * Keyed by "<file>::<model>.<relation path>". Adding an entry is a claim that
 * the restriction is enforced some other way — say where, so the next reader
 * can check the claim rather than trust it.
 */
const ACKNOWLEDGED: Record<string, string> = {
  "assessment/assignment.service.ts::Assignment.rubric":
    "To-one parent of a rubric the student is already marked against. Rubric " +
    "itself is unscoped reference data; the criteria under it are the policed " +
    "part and are handled by the entry below.",
  "assessment/assignment.service.ts::Rubric.criteria":
    "DELIBERATELY UNRESTATED, and the only include in the codebase that loads " +
    "policed rows on purpose. studentView needs the INTERNAL criteria in order " +
    "to remove them: forStudent drops each internal row and reports " +
    "isPartialAccount when internal marks were awarded, so the student is told " +
    "the breakdown does not account for the whole mark rather than left to " +
    "discover the arithmetic does not work. Restating `isInternal: false` here " +
    "would silently return a total that fails to reconcile with the grade " +
    "beside it. Nothing from this include is returned unprojected — forStudent " +
    "is the only consumer, and rubric-scoring.spec.ts asserts the internal " +
    "name, id and marks are absent from its output.",
  "assessment/assignment.service.ts::AssignmentSubmission.grade":
    "To-one, so Prisma accepts no where. listForStudent and studentView both " +
    "check grade.releasedAt explicitly before exposing anything (BR-ASG-09); " +
    "submissionStatus is submission_roster, teacher and above, who may see an " +
    "unreleased mark.",
  "assessment/assignment.service.ts::AssignmentSubmission.files":
    "Every submission reached here is already restricted to the caller by the " +
    "AssignmentSubmission policy, so its files are theirs by construction. " +
    "Only id and filename are projected.",
  "assessment/assignment.service.ts::AssignmentSubmission.assignment":
    "To-one parent, used to read marksAvailable and the late policy. The " +
    "submission was already scoped, and an assignment a student may not see " +
    "cannot have one of their submissions attached to it.",
  "quiz/quiz.service.ts::Quiz.questions":
    "QuizQuestion is a join row carrying only a mark and a display order; it " +
    "has no state of its own to withhold. The parent Quiz is already scoped " +
    "AND filtered to PUBLISHED, and every question of a quiz belongs to that " +
    "quiz by definition.",
  "quiz/quiz.service.ts::Question.options":
    "Selected down to id, optionText and displayOrder, so isCorrect never " +
    "leaves the database on a student's request. The restriction is enforced " +
    "by the projection in the query itself, which is stronger than a where.",
  "quiz/quiz-authoring.service.ts::Question.options":
    "AUTHORING. The teacher writing a question must see which option is " +
    "correct, so the key is returned deliberately. It cannot reach a student: " +
    "§4.5 gives no student key on `question` or `quiz_answer_key`, and the " +
    "Question/QuestionOption policies are DENY_ALL for them, so a mis-guarded " +
    "route would still return nothing. The STUDENT-facing path is " +
    "quiz.service.ts, which selects id, optionText and displayOrder so " +
    "isCorrect never leaves the database.",
  "quiz/quiz-authoring.service.ts::Quiz.questions":
    "QuizQuestion is a join row carrying a mark and a display order, and the " +
    "parent Quiz was already scoped. Authoring endpoints only; a student " +
    "holds nothing on quiz_answer_key.",
  "admin/user-admin.service.ts::User.roles":
    "Every read here is on an admin-only route (§4.5.1 gives no teacher or " +
    "student `student_account:read`, `account_state:update` or " +
    "`role_assignment:configure`), and the UserRole policy returns null — no " +
    "restriction — for an admin. A non-admin cannot reach these endpoints at " +
    "all, so there is no narrower set of rows to restate.",
  "progress/progress.service.ts::AssignmentGrade.submission":
    "To-one parent. The query runs under asSystem with an explicit " +
    "releasedAt: { not: null } and a studentId filter, which is stricter than " +
    "the policy would have been.",
};

interface Violation {
  file: string;
  path: string;
  model: string;
  isList: boolean;
}

/** Every .ts file under src, excluding tests. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (entry.endsWith(".ts") && !entry.endsWith(".spec.ts")) out.push(full);
  }
  return out;
}

/** `prisma.scoped.assignmentSubmission.findMany` -> "AssignmentSubmission". */
function scopedModelOf(node: ts.CallExpression): string | null {
  if (!ts.isPropertyAccessExpression(node.expression)) return null;
  const modelAccess = node.expression.expression; // .scoped.<model>
  if (!ts.isPropertyAccessExpression(modelAccess)) return null;
  const scopedAccess = modelAccess.expression;
  if (!ts.isPropertyAccessExpression(scopedAccess)) return null;
  if (scopedAccess.name.text !== "scoped") return null;
  return MODEL_BY_CAMEL.get(modelAccess.name.text) ?? null;
}

function findProperty(obj: ts.ObjectLiteralExpression, name: string): ts.Expression | null {
  for (const prop of obj.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const key = ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name) ? prop.name.text : null;
    if (key === name) return prop.initializer;
  }
  return null;
}

/**
 * Walks an include/select object, resolving each relation against `model`.
 *
 * Recurses, because a violation three levels down is exactly as exploitable as
 * one at the top.
 */
function walkSelection(
  obj: ts.ObjectLiteralExpression,
  model: string,
  file: string,
  path: string[],
  found: Violation[],
): void {
  const relations = RELATIONS.get(model);
  if (!relations) return;

  for (const prop of obj.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const key = ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name) ? prop.name.text : null;
    if (!key) continue;

    const relation = relations.get(key);
    if (!relation) continue; // a scalar, or _count

    const here = [...path, key];

    if (demandsRestatement(relation.model, relation.isList)) {
      const restated =
        ts.isObjectLiteralExpression(prop.initializer) &&
        findProperty(prop.initializer, "where") !== null;

      const acknowledged = `${file}::${model}.${key}` in ACKNOWLEDGED;

      if (!restated && !acknowledged) {
        found.push({ file, path: here.join("."), model: relation.model, isList: relation.isList });
      }
    }

    // Descend regardless: an acknowledged include can still contain a
    // violation beneath it.
    if (ts.isObjectLiteralExpression(prop.initializer)) {
      for (const nested of ["include", "select"] as const) {
        const child = findProperty(prop.initializer, nested);
        if (child && ts.isObjectLiteralExpression(child)) {
          walkSelection(child, relation.model, file, here, found);
        }
      }
    }
  }
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
        const model = scopedModelOf(node);
        const arg = node.arguments[0];
        if (model && arg && ts.isObjectLiteralExpression(arg)) {
          for (const key of ["include", "select"] as const) {
            const selection = findProperty(arg, key);
            if (selection && ts.isObjectLiteralExpression(selection)) {
              walkSelection(selection, model, file, [], found);
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }

  return found;
}

describe("nested includes of policed models", () => {
  const violations = scan();

  it("parses the source tree", () => {
    // Guards the guard: a path change returning no files would make the
    // assertion below pass while checking nothing.
    expect(sourceFiles(SRC).length).toBeGreaterThan(30);
  });

  it("resolves relations from the Prisma schema", () => {
    expect(RELATIONS.get("AssignmentSubmission")?.get("grade")).toEqual({
      model: "AssignmentGrade",
      isList: false,
    });
  });

  it("restates the restriction on every include of a policed model", () => {
    if (violations.length > 0) {
      const detail = violations
        .map(
          (v) =>
            `  ${v.file}\n` +
            `    includes ${v.path} -> ${v.model} (policed, ${v.isList ? "to-many" : "to-one"})\n` +
            `    ${
              v.isList
                ? "Add a `where` to the nested read restating the policy."
                : "To-one: Prisma accepts no `where`. Check the loaded row in code, " +
                  "then add an ACKNOWLEDGED entry saying so."
            }`,
        )
        .join("\n\n");

      throw new Error(
        `The scope predicate does NOT filter nested includes, so these return ` +
          `rows the child policy would refuse:\n\n${detail}\n\n` +
          `See the header of scope.extension.ts.`,
      );
    }
    expect(violations).toEqual([]);
  });

  it("keeps every acknowledgement pointing at a real include", () => {
    // A stale entry is worse than none: it reads as a considered decision
    // about code that no longer exists, and hides the next real violation of
    // the same relation.
    const live = new Set<string>();
    for (const path of sourceFiles(SRC)) {
      const file = relative(SRC, path).split(sep).join("/");
      for (const key of Object.keys(ACKNOWLEDGED)) {
        if (key.startsWith(`${file}::`)) live.add(key);
      }
    }
    const orphaned = Object.keys(ACKNOWLEDGED).filter((k) => !live.has(k));
    expect(orphaned).toEqual([]);
  });

  it("gives every acknowledgement a reason", () => {
    for (const [key, reason] of Object.entries(ACKNOWLEDGED)) {
      expect(`${key}: ${reason}`.length).toBeGreaterThan(key.length + 40);
    }
  });
});
