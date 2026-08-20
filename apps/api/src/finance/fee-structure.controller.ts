import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import { feeStructureUpsertSchema, type FeeStructureUpsertInput } from "@lms/shared";
import { FeeStructureService } from "./fee-structure.service";
import { RequirePermission } from "../rbac/permissions.guard";
import { zodBody } from "../common/zod-validation.pipe";

/**
 * SRS §9.18 — what a course costs.
 *
 * `fee_structure`, NOT `payment`, and the distinction is the point. `payment`
 * is behind step-up because it moves money that already exists. This decides
 * what a member of the public will be ASKED to transfer: getting it wrong does
 * not misplace a receipt, it quotes a whole intake the wrong figure on a page
 * anybody can read. Different risk, different resource.
 *
 * Nothing here is public. The applicant's view of a fee comes through
 * `/public/prospectus`, which serves only PUBLISHED structures and never the
 * drafts an administrator is still working on.
 */
@Controller()
export class FeeStructureController {
  constructor(private readonly structures: FeeStructureService) {}

  /**
   * Every structure for one programme, drafts included.
   *
   * Drafts are the whole reason this is not the public endpoint: an
   * administrator needs to see the half-finished 2027 fee table, and an
   * applicant must not.
   */
  @RequirePermission("fee_structure", "read")
  @Get("programmes/:id/fee-structures")
  list(@Param("id") programmeId: string) {
    return this.structures.listForProgramme(programmeId);
  }

  @RequirePermission("fee_structure", "read")
  @Get("fee-structures/:id")
  byId(@Param("id") id: string) {
    return this.structures.byId(id);
  }

  /**
   * What an applicant to this programme would be quoted right now.
   *
   * Staff-facing, and it exists so an administrator can check what the public
   * is actually being shown WITHOUT opening the apply form and pretending to
   * be an applicant. "Is the new fee live yet" is otherwise unanswerable from
   * inside the System.
   */
  @RequirePermission("fee_structure", "read")
  @Get("programmes/:id/fee-structures/published")
  published(@Param("id") programmeId: string, @Query("sessionId") sessionId?: string) {
    return this.structures.publishedFor(programmeId, sessionId ?? null);
  }

  @RequirePermission("fee_structure", "create")
  @Post("fee-structures")
  create(@Body(zodBody(feeStructureUpsertSchema)) dto: FeeStructureUpsertInput) {
    return this.structures.create(dto);
  }

  @RequirePermission("fee_structure", "update")
  @Patch("fee-structures/:id")
  update(
    @Param("id") id: string,
    @Body(zodBody(feeStructureUpsertSchema)) dto: FeeStructureUpsertInput,
  ) {
    return this.structures.update(id, dto);
  }

  /**
   * Make it the price.
   *
   * POST rather than PATCH status: this is an act with consequences beyond the
   * row — it supersedes whatever was published before and changes what every
   * visitor to the apply page is told. A field assignment reads like a typo
   * away from the same thing.
   */
  @RequirePermission("fee_structure", "approve")
  @Post("fee-structures/:id/publish")
  @HttpCode(200)
  publish(@Param("id") id: string) {
    return this.structures.publish(id);
  }

  /** Withdraw it from the apply page without destroying the record. */
  @RequirePermission("fee_structure", "update")
  @Post("fee-structures/:id/archive")
  @HttpCode(200)
  archive(@Param("id") id: string) {
    return this.structures.archive(id);
  }

  /** Drafts only — anything published is part of the record. */
  @RequirePermission("fee_structure", "delete")
  @Delete("fee-structures/:id")
  remove(@Param("id") id: string) {
    return this.structures.remove(id);
  }
}
