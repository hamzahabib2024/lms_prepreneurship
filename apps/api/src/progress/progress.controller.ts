import { Body, Controller, Get, Param, Put } from "@nestjs/common";
import { z } from "zod";
import { ProgressService } from "./progress.service";
import { CompletionService } from "./completion.service";
import { zodBody } from "../common/zod-validation.pipe";
import { RequirePermission } from "../rbac/permissions.guard";
import { assertOwnStudent } from "../rbac/ownership";

/** SRS §9.9 — progress endpoints. */

/**
 * The reason is optional HERE and required by the service when the decision
 * disagrees with the arithmetic. Putting that rule in Zod would mean the schema
 * needing to know a student's computed progress, which it cannot.
 */
const decisionSchema = z.object({
  decision: z.enum(["IN_PROGRESS", "COMPLETED", "NOT_COMPLETED"]),
  note: z.string().trim().max(2000).optional(),
});

@Controller()
export class ProgressController {
  constructor(
    private readonly progress: ProgressService,
    private readonly completion: CompletionService,
  ) {}

  /** FR-PRG-004 — the breakdown, so the percentage is explicable. */
  @RequirePermission("progress", "read")
  @Get("me/progress")
  mine() {
    return this.progress.mine();
  }

  /**
   * The same breakdown for one subject, without the caller needing to know
   * their own student id.
   *
   * Declared BEFORE the parameterised student routes: `me` would otherwise be
   * matched as an `:id`, and the ownership check would reject it.
   */
  @RequirePermission("progress", "read")
  @Get("me/progress/:sectionSubjectId")
  mineForSubject(@Param("sectionSubjectId") ssId: string) {
    return this.progress.mineForSubject(ssId);
  }

  @RequirePermission("progress", "read")
  @Get("students/:id/progress")
  forStudent(@Param("id") id: string) {
    assertOwnStudent(id); // SEC-AUZ-004
    return this.progress.forStudent(id);
  }

  @RequirePermission("progress", "read")
  @Get("students/:id/progress/:sectionSubjectId")
  forSubject(@Param("id") id: string, @Param("sectionSubjectId") ssId: string) {
    assertOwnStudent(id); // SEC-AUZ-004
    return this.progress.forSubject(id, ssId);
  }

  /**
   * FR-PRG-011/012 — the cohort, worst-first, so intervention is easy.
   *
   * `progress_cohort`, not `progress`. This lists every classmate by name,
   * roll number, attendance and average grade; a student's own `progress:read`
   * must not reach it. The scope predicate already reduced the answer to their
   * own row, but an administrative view should refuse rather than return a
   * list of one (SEC-AUZ-006).
   */
  @RequirePermission("progress_cohort", "read")
  @Get("section-subjects/:id/progress")
  cohort(@Param("id") id: string) {
    return this.progress.forSectionSubject(id);
  }

  // ───────────────────────────────────── signing off that a student finished ──

  /**
   * The end-of-term worklist: everybody in a class, where the arithmetic puts
   * them, and what a person has decided.
   *
   * `subject_completion:read` at ASSIGNED for a teacher — they see their own
   * classes and no others, and the scope predicate is what enforces that.
   */
  @RequirePermission("subject_completion", "read")
  @Get("section-subjects/:id/completion")
  completionRoster(@Param("id") id: string) {
    return this.completion.roster(id);
  }

  /**
   * Record it. PUT, because a student has ONE standing in a subject and this
   * replaces it — the history of how it changed is the audit log's, and it
   * already keeps it.
   *
   * A teacher may do this for the classes they teach. Issuing the certificate
   * afterwards is `certificate:create`, which a teacher does not hold: the
   * person who decides a student has finished is deliberately not the person
   * who prints the document saying so.
   */
  @RequirePermission("subject_completion", "update")
  @Put("section-subjects/:id/completion/:studentId")
  decideCompletion(
    @Param("id") id: string,
    @Param("studentId") studentId: string,
    @Body(zodBody(decisionSchema)) dto: z.infer<typeof decisionSchema>,
  ) {
    return this.completion.decide(id, studentId, dto);
  }

  /** What a student has been signed off for. Their own, or the office's view. */
  @RequirePermission("subject_completion", "read")
  @Get("students/:studentId/completion")
  studentCompletion(@Param("studentId") studentId: string) {
    assertOwnStudent(studentId);
    return this.completion.forStudent(studentId);
  }

}
