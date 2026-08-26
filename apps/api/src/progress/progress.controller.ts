import { Body, Controller, Get, Param, Put } from "@nestjs/common";
import { z } from "zod";
import { ProgressService } from "./progress.service";
import { CompletionService } from "./completion.service";
import { ProgressSettingsService } from "./progress-settings.service";
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

/**
 * HOW PROGRESS IS MEASURED IN ONE CLASS.
 *
 * Both halves are optional and OMITTING ONE CLEARS IT — that is how a class
 * goes back to following the Institute, and it has to be expressible or a
 * teacher who changes their mind is stuck with their own weighting forever.
 *
 * The "must total 100" rule lives in the service rather than here: Zod can see
 * the four numbers but not what should happen when they are wrong, and the
 * message a teacher needs says what they add up to now.
 */
const progressSettingsSchema = z.object({
  weights: z
    .object({
      video: z.number().min(0).max(100),
      assignment: z.number().min(0).max(100),
      quiz: z.number().min(0).max(100),
      attendance: z.number().min(0).max(100),
    })
    .optional(),
  criteria: z
    .object({
      minProgressPercent: z.number().min(0).max(100).optional(),
      minAttendancePercent: z.number().min(0).max(100).optional(),
      minAverageGradePercent: z.number().min(0).max(100).optional(),
    })
    .optional(),
});

@Controller()
export class ProgressController {
  constructor(
    private readonly progress: ProgressService,
    private readonly completion: CompletionService,
    private readonly progressSettings: ProgressSettingsService,
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
  /**
   * FR-PRG — what progress is made of here, and where each number came from.
   *
   * `read`, not `configure`: an administrator answering "why is she at 41%?"
   * should be able to see the weighting without holding the authority to
   * change it.
   */
  @RequirePermission("progress", "read")
  @Get("section-subjects/:id/progress-settings")
  getProgressSettings(@Param("id") id: string) {
    return this.progressSettings.get(id);
  }

  /**
   * FR-PRG — change it, for this class only.
   *
   * Teacher on their own class, office on any. Sending neither half puts the
   * class back on the Institute's settings.
   */
  @RequirePermission("progress", "configure")
  @Put("section-subjects/:id/progress-settings")
  setProgressSettings(
    @Param("id") id: string,
    @Body(zodBody(progressSettingsSchema)) dto: z.infer<typeof progressSettingsSchema>,
  ) {
    return this.progressSettings.set(id, dto);
  }

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
