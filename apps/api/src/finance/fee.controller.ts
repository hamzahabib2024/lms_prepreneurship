import { Body, Controller, Get, Param, Post, HttpCode } from "@nestjs/common";
import { z } from "zod";
import { FeeService } from "./fee.service";
import { RequirePermission } from "../rbac/permissions.guard";

const chargeSchema = z.object({
  studentId: z.string().uuid(),
  description: z.string().trim().min(3).max(200),
  amount: z.number().positive().max(10_000_000),
  dueDate: z.coerce.date(),
  academicSessionId: z.string().uuid().optional(),
});

const waiveSchema = z.object({ reason: z.string().trim().min(10).max(500) });

/**
 * SRS §9.18 — fees.
 *
 * `payment` is Super Admin and Admin with FULL, and demands step-up (§4.5):
 * money is the one area where an unattended screen is a real risk. A STUDENT
 * holds read at OWN scope, which is their own statement.
 */
@Controller()
export class FeeController {
  constructor(private readonly fees: FeeService) {}

  /** FR-PAY-026 — a student's own statement. */
  @RequirePermission("payment", "read")
  @Get("me/fees")
  mine() {
    return this.fees.myStatement();
  }

  /** FR-PAY-026 — somebody's statement, for an administrator. */
  @RequirePermission("payment", "read")
  @Get("students/:id/fees")
  forStudent(@Param("id") id: string) {
    return this.fees.statementFor(id);
  }

  /** FR-PAY-030 — who owes what, most first. */
  @RequirePermission("payment", "read")
  @Get("fees/debtors")
  debtors() {
    return this.fees.debtors();
  }

  /** FR-PAY-021 — charge somebody. */
  @RequirePermission("payment", "create")
  @Post("fees/charges")
  addCharge(@Body() body: unknown) {
    return this.fees.addCharge(chargeSchema.parse(body));
  }

  /** FR-PAY-024 — write a charge off, with a reason that stays on the record. */
  @RequirePermission("payment", "update")
  @Post("fees/charges/:id/waive")
  @HttpCode(200)
  waive(@Param("id") id: string, @Body() body: unknown) {
    return this.fees.waive(id, waiveSchema.parse(body).reason);
  }

  /**
   * FR-PAY-032 — rebuild every balance from the ledger.
   *
   * A materialised figure needs a way back to the truth. This proves whether
   * the stored balances agree with the charges and payments they summarise, and
   * says what it corrected rather than quietly fixing the evidence.
   */
  @RequirePermission("payment", "configure")
  @Post("fees/reconcile")
  @HttpCode(200)
  reconcile() {
    return this.fees.reconcile();
  }
}
