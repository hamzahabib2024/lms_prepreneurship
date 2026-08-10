import { Body, Controller, Delete, Get, Param } from "@nestjs/common";
import { z } from "zod";
import { PersonalDataService } from "./personal-data.service";
import { RequirePermission } from "../rbac/permissions.guard";
import { getActor } from "../prisma/actor-context";
import { AppError } from "@lms/shared";

const eraseSchema = z.object({ reason: z.string().trim().min(10).max(500) });

/**
 * SRS §9.15 — personal data.
 *
 * `personal_data_export:export` reaches a STUDENT with OWN scope (§4.5): the
 * right to a copy of your own record is the person's, not the Institute's to
 * grant case by case. What they receive differs from what an administrator
 * receives, and erasure-policy decides that rather than this controller.
 *
 * `permanent_deletion:delete` is Super Admin with step-up. It is the most
 * irreversible operation in the System and the only one that destroys anything.
 */
@Controller()
export class PersonalDataController {
  constructor(private readonly data: PersonalDataService) {}

  /** FR-PRV-001 — a copy of your own record, without knowing your own id. */
  @RequirePermission("personal_data_export", "export")
  @Get("me/personal-data")
  mine() {
    const actor = getActor();
    if (!actor) throw new AppError("AUTH_TOKEN_INVALID");
    return this.data.export(actor.userId);
  }

  /**
   * FR-PRV-002 — a copy of somebody's record, for a formal request.
   *
   * A student calling this for another id is refused in the service rather than
   * filtered to nothing: an empty file with a 200 would look like "we hold
   * nothing about you" (SEC-AUZ-006).
   */
  @RequirePermission("personal_data_export", "export")
  @Get("admin/users/:id/personal-data")
  forUser(@Param("id") id: string) {
    return this.data.export(id);
  }

  /**
   * FR-PRV-008 — what erasure would do, and whether it can proceed.
   *
   * Guarded by the same permission as the act, so nobody can enumerate who is
   * erasable without being able to erase.
   */
  @RequirePermission("permanent_deletion", "delete")
  @Get("admin/users/:id/erasure-plan")
  plan(@Param("id") id: string) {
    return this.data.plan(id);
  }

  /** FR-PRV-009 — erase. Super Admin, step-up, and a written reason. */
  @RequirePermission("permanent_deletion", "delete")
  @Delete("admin/users/:id/personal-data")
  erase(@Param("id") id: string, @Body() body: unknown) {
    return this.data.erase(id, eraseSchema.parse(body).reason);
  }
}
