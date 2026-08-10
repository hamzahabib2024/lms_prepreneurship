/**
 * Scope coverage — SRS ARC-051.
 *
 * REGRESSION TEST. Nineteen models had no scope policy, and because an absent
 * model is treated as UNSCOPED, seven of them carrying student work were
 * readable by anyone who passed the role check. Among them:
 * AssignmentSubmission, SubmissionFile, AssignmentGrade — and the question
 * models, whose `isCorrect` column is the answer key.
 *
 * None of it was visible by reading the map, because a missing entry looks
 * exactly like a model nobody had needed yet. This test closes that: every
 * model in schema.prisma must be EITHER policed OR named as deliberately
 * unscoped. Adding a model without deciding is now a failing test rather than
 * a silent grant.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { __testing } from "./scope.extension";

const { MODEL_POLICIES, DELIBERATELY_UNSCOPED } = __testing;

/** Reads the model names straight from the schema, so it cannot drift. */
function modelsInSchema(): string[] {
  const schema = readFileSync(join(__dirname, "..", "..", "prisma", "schema.prisma"), "utf8");
  return [...schema.matchAll(/^model\s+([A-Za-z][A-Za-z0-9_]*)\s*\{/gm)].map((m) => m[1] as string);
}

describe("every model is classified", () => {
  const models = modelsInSchema();

  it("finds the schema", () => {
    // Guards the test itself: a path change that returned zero models would
    // make every assertion below vacuously pass.
    expect(models.length).toBeGreaterThan(40);
  });

  it.each(modelsInSchema())("%s is policed or explicitly unscoped", (model) => {
    const policed = Object.prototype.hasOwnProperty.call(MODEL_POLICIES, model);
    const exempt = (DELIBERATELY_UNSCOPED as readonly string[]).includes(model);

    if (!policed && !exempt) {
      throw new Error(
        `${model} has no scope policy and is not listed as deliberately unscoped.\n` +
          `An unpoliced model is readable by anyone who passes the role check.\n` +
          `Add a policy to MODEL_POLICIES, or — only if it is institute-wide ` +
          `reference data carrying nobody's personal information — add it to ` +
          `DELIBERATELY_UNSCOPED with a reason.`,
      );
    }
    expect(policed || exempt).toBe(true);
  });

  it("never classifies a model both ways", () => {
    const both = (DELIBERATELY_UNSCOPED as readonly string[]).filter((m) =>
      Object.prototype.hasOwnProperty.call(MODEL_POLICIES, m),
    );
    expect(both).toEqual([]);
  });

  it("does not exempt anything that holds a person's work or money", () => {
    // A blunt name check. It cannot catch everything, but the exemption list is
    // the one place where a mistake grants read access to everyone, so it is
    // worth a second lock.
    const forbidden = /submission|grade|attempt|answer|payment|attendance|student|user|audit/i;
    const suspicious = (DELIBERATELY_UNSCOPED as readonly string[]).filter((m) =>
      forbidden.test(m),
    );
    expect(suspicious).toEqual([]);
  });

  it("policies every model that stores a student's work", () => {
    // Named explicitly rather than inferred, so deleting a policy fails here
    // even if someone also adds the model to the exemption list.
    const mustBePoliced = [
      "AssignmentSubmission",
      "SubmissionFile",
      "AssignmentGrade",
      "AssignmentExtension",
      "QuizAttempt",
      "QuizAnswer",
      "WatchProgress",
      "AttendanceRecord",
      "Enrolment",
      "Payment",
    ];
    for (const model of mustBePoliced) {
      expect(Object.keys(MODEL_POLICIES)).toContain(model);
    }
  });

  it("policies the question models, which hold the answer key", () => {
    for (const model of ["Question", "QuestionOption", "QuestionBank", "QuizQuestion"]) {
      expect(Object.keys(MODEL_POLICIES)).toContain(model);
    }
  });
});
