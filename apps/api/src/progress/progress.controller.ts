import { Controller, Get, Param } from "@nestjs/common";
import { ProgressService } from "./progress.service";
import { RequirePermission } from "../rbac/permissions.guard";
import { assertOwnStudent } from "../rbac/ownership";

/** SRS §9.9 — progress endpoints. */
@Controller()
export class ProgressController {
  constructor(private readonly progress: ProgressService) {}

  /** FR-PRG-004 — the breakdown, so the percentage is explicable. */
  @RequirePermission("progress", "read")
  @Get("me/progress")
  mine() {
    return this.progress.mine();
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

  /** FR-PRG-011/012 — the cohort, worst-first, so intervention is easy. */
  @RequirePermission("progress", "read")
  @Get("section-subjects/:id/progress")
  cohort(@Param("id") id: string) {
    return this.progress.forSectionSubject(id);
  }
}
