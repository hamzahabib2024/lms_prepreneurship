import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { AssignmentService } from "./assignment.service";
import { zodBody } from "../common/zod-validation.pipe";
import { RequirePermission } from "../rbac/permissions.guard";

const createSchema = z
  .object({
    sectionSubjectId: z.string().uuid(),
    lessonId: z.string().uuid().optional(),
    title: z.string().trim().min(3).max(255),
    instructions: z.string().trim().min(10).max(20000),
    marksAvailable: z.coerce.number().positive().max(1000),
    opensAt: z.coerce.date(),
    dueAt: z.coerce.date(),
    hardCloseAt: z.coerce.date().optional(),
    graceMinutes: z.coerce.number().int().min(0).max(10080).default(0),
    latePolicy: z
      .enum(["NOT_ACCEPTED", "FLAG_ONLY", "FIXED_DEDUCTION", "PER_DAY_PERCENT"])
      .default("FLAG_ONLY"),
    latePenaltyValue: z.coerce.number().min(0).optional(),
    latePenaltyFloor: z.coerce.number().min(0).max(100).optional(),
    submissionType: z.enum(["FILE", "TEXT", "BOTH"]).default("FILE"),
    allowedFileTypes: z.array(z.string()).optional(),
    maxFileSizeMb: z.coerce.number().int().positive().max(100).optional(),
    maxFileCount: z.coerce.number().int().positive().max(20).optional(),
    resubmissionPolicy: z.enum(["NONE", "UNLIMITED_UNTIL_DUE", "LIMITED"]).default("NONE"),
    maxAttempts: z.coerce.number().int().positive().max(20).optional(),
    rubricId: z.string().uuid().optional(),
  })
  // A penalty policy without a value would silently deduct nothing, which
  // looks like a working policy and is not.
  .refine(
    (v) =>
      !["FIXED_DEDUCTION", "PER_DAY_PERCENT"].includes(v.latePolicy) ||
      v.latePenaltyValue != null,
    { path: ["latePenaltyValue"], message: "State the penalty for this late policy." },
  );

const submitSchema = z.object({
  textResponse: z.string().trim().max(50000).optional(),
  fileIds: z.array(z.string().uuid()).max(20).optional(),
});

const gradeSchema = z.object({
  rawMarks: z.coerce.number().min(0),
  rubricScores: z.record(z.string(), z.coerce.number()).optional(),
  feedback: z.string().trim().max(10000).optional(),
  internalNotes: z.string().trim().max(10000).optional(),
  revisionReason: z.string().trim().max(1000).optional(),
});

/** SRS §9.8 — assignment endpoints. */
@Controller()
export class AssessmentController {
  constructor(private readonly assignments: AssignmentService) {}

  @RequirePermission("assignment", "create")
  @Post("assignments")
  create(@Body(zodBody(createSchema)) dto: z.infer<typeof createSchema>) {
    return this.assignments.create(dto);
  }

  @RequirePermission("assignment", "update")
  @Post("assignments/:id/publish")
  publish(@Param("id") id: string) {
    return this.assignments.publish(id);
  }

  /** FR-TCH-019 — submitted, not submitted, late, ungraded, at a glance. */
  @RequirePermission("submission", "read")
  @Get("assignments/:id/submissions")
  status(@Param("id") id: string) {
    return this.assignments.submissionStatus(id);
  }

  @RequirePermission("submission", "create")
  @Post("assignments/:id/submissions")
  submit(@Param("id") id: string, @Body(zodBody(submitSchema)) dto: z.infer<typeof submitSchema>) {
    return this.assignments.submit(id, dto);
  }

  /**
   * A student's own view. Internal notes are absent by construction, and an
   * unreleased grade reports as in-progress rather than leaking the mark
   * (BR-ASG-08, BR-ASG-09).
   */
  @RequirePermission("submission", "read")
  @Get("assignments/:id/my-submission")
  mine(@Param("id") id: string) {
    return this.assignments.studentView(id);
  }

  @RequirePermission("grade", "update")
  @Post("submissions/:id/grade")
  grade(@Param("id") id: string, @Body(zodBody(gradeSchema)) dto: z.infer<typeof gradeSchema>) {
    return this.assignments.grade(id, dto);
  }

  /** FR-ASG-028 — release the cohort together, so nobody sees a mark first. */
  @RequirePermission("grade", "update")
  @Post("assignments/:id/release-grades")
  release(@Param("id") id: string) {
    return this.assignments.releaseGrades(id);
  }
}
