import { Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import { z } from "zod";
import { RubricService } from "./rubric.service";
import { RequirePermission } from "../rbac/permissions.guard";

const levelSchema = z.object({
  label: z.string().trim().min(1).max(80),
  marks: z.number().min(0),
  text: z.string().trim().max(1000).optional(),
});

const criterionSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).nullish(),
  // Deliberately NOT .positive(). Zod would reject it first with "Number must
  // be greater than 0" against the field path `criteria.3.maxMarks`, and the
  // screen shows the message alone — so a teacher with eight criteria is told
  // a number is wrong and not which one. validateRubric says «"Evidence" must
  // be worth more than zero marks». The bound stays here; the judgement does
  // not.
  maxMarks: z.number().max(1000),
  /** FR-ASG-014 — used to reach the mark, never shown to the student. */
  isInternal: z.boolean().optional(),
  levels: z.array(levelSchema).max(10).nullish(),
});

const rubricSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).nullish(),
  shareInstituteWide: z.boolean().optional(),
  criteria: z.array(criterionSchema).min(1).max(40),
});

/**
 * SRS §9.7 — rubrics.
 *
 * `rubric:read` reaches a student (§4.5.6, ENROLLED scope), and that is
 * deliberate: a student marked against a scheme is entitled to read it. What
 * they must not see is any criterion marked internal, and that is enforced by
 * the RubricCriterion scope policy rather than here, so no endpoint can forget
 * it. The service fetches criteria as a separate scoped query for exactly that
 * reason — a nested include would bypass the policy.
 *
 * Writing is `rubric:create`/`update`/`delete`, teacher and above. Ownership
 * narrows it further in the service: a teacher may edit only their own, and an
 * institute-wide rubric is an administrator's to change.
 */
@Controller()
export class RubricController {
  constructor(private readonly rubrics: RubricService) {}

  @RequirePermission("rubric", "read")
  @Get("rubrics")
  list() {
    return this.rubrics.list();
  }

  @RequirePermission("rubric", "read")
  @Get("rubrics/:id")
  get(@Param("id") id: string) {
    return this.rubrics.get(id);
  }

  /** FR-ASG-015 — does this rubric add up to that assignment's total? */
  @RequirePermission("rubric", "read")
  @Get("rubrics/:id/fit/:assignmentId")
  checkFit(@Param("id") id: string, @Param("assignmentId") assignmentId: string) {
    return this.rubrics.checkFit(id, assignmentId);
  }

  @RequirePermission("rubric", "create")
  @Post("rubrics")
  create(@Body() body: unknown) {
    return this.rubrics.create(rubricSchema.parse(body));
  }

  @RequirePermission("rubric", "update")
  @Patch("rubrics/:id")
  update(@Param("id") id: string, @Body() body: unknown) {
    return this.rubrics.update(id, rubricSchema.parse(body));
  }

  @RequirePermission("rubric", "delete")
  @Delete("rubrics/:id")
  remove(@Param("id") id: string) {
    return this.rubrics.remove(id);
  }
}
