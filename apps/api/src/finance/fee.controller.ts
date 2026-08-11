import { Body, Controller, Get, Param, Post, HttpCode, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";
import { FeeService } from "./fee.service";
import { InstalmentService } from "./instalment.service";
import { ReceiptService } from "./receipt.service";
import { RequirePermission } from "../rbac/permissions.guard";

const chargeSchema = z.object({
  studentId: z.string().uuid(),
  description: z.string().trim().min(3).max(200),
  amount: z.number().positive().max(10_000_000),
  dueDate: z.coerce.date(),
  academicSessionId: z.string().uuid().optional(),
});

const waiveSchema = z.object({ reason: z.string().trim().min(10).max(500) });

const paymentSchema = z.object({
  studentId: z.string().uuid(),
  amount: z.number().positive().max(10_000_000),
  paymentDate: z.coerce.date(),
  // The four the schema actually has. Inventing "CASH" and "ONLINE" here
  // would have been accepted by Zod and refused by the database.
  method: z.enum(["BANK_TRANSFER", "CASH_DEPOSIT", "CHEQUE", "OTHER"]),
  bankReference: z.string().trim().max(100).optional(),
  note: z.string().trim().max(500).optional(),
});

const reverseSchema = z.object({ reason: z.string().trim().min(10).max(500) });

// No .multipleOf(0.01) on the amount. Zod would answer "Number must be a
// multiple of 0.01", and the instalment rules say the useful thing instead:
// which value was given and that money has at most two decimal places.
const planSchema = z.object({
  studentId: z.string().uuid(),
  totalRupees: z.number(),
  count: z.number().int(),
  firstDueDate: z.coerce.date(),
  cadence: z.enum(["MONTHLY", "FORTNIGHTLY", "WEEKLY"]),
  label: z.string().trim().min(3).max(120),
  academicSessionId: z.string().uuid().optional(),
});

const planPreviewSchema = planSchema.omit({ studentId: true, academicSessionId: true });

/**
 * SRS §9.18 — fees.
 *
 * `payment` is Super Admin and Admin with FULL, and demands step-up (§4.5):
 * money is the one area where an unattended screen is a real risk. A STUDENT
 * holds read at OWN scope, which is their own statement.
 */
@Controller()
export class FeeController {
  constructor(
    private readonly fees: FeeService,
    private readonly instalments: InstalmentService,
    private readonly receipts: ReceiptService,
  ) {}

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
  // `update`, not `configure`. The matrix grants payment FULL, and FULL is
  // create/read/update/delete/approve/export — there is no `configure` on this
  // resource, so guarding it with one made the route unreachable by anybody.
  @RequirePermission("payment", "update")
  @Post("fees/reconcile")
  @HttpCode(200)
  reconcile() {
    return this.fees.reconcile();
  }

  /**
   * FR-PAY-021 — record a payment the Institute has received.
   *
   * Everything except the admission fee arrives here: second instalments, late
   * settlements, cash at the desk. Until this existed a Payment could only be
   * created by approving an admission, so every later payment had nowhere to
   * go and the ledger showed students owing fees they had already paid.
   */
  @RequirePermission("payment", "create")
  @Post("fees/payments")
  recordPayment(@Body() body: unknown) {
    return this.fees.recordPayment(paymentSchema.parse(body));
  }

  /** FR-PAY-023 — undo one recorded in error. Marked, never deleted. */
  @RequirePermission("payment", "update")
  @Post("fees/payments/:id/reverse")
  @HttpCode(200)
  reversePayment(@Param("id") id: string, @Body() body: unknown) {
    return this.fees.reversePayment(id, reverseSchema.parse(body).reason);
  }

  /**
   * FR-PAY-033 — the schedule, before it is written.
   *
   * A POST that writes nothing, because the whole plan is the request and a
   * query string of amount, count, cadence and date is not a URL anybody can
   * read back to a colleague.
   */
  @RequirePermission("payment", "read")
  @Post("fees/plans/preview")
  @HttpCode(200)
  previewPlan(@Body() body: unknown) {
    return this.instalments.preview(planPreviewSchema.parse(body));
  }

  /** FR-PAY-034 — write the charges. All of them or none. */
  @RequirePermission("payment", "create")
  @Post("fees/plans")
  createPlan(@Body() body: unknown, @Req() req: Request) {
    return this.instalments.create(planSchema.parse(body), req.ip);
  }

  /**
   * FR-PAY-039 — the receipt for a payment.
   *
   * `payment:read`, which a STUDENT holds at OWN scope — so a student can
   * print their own receipt without an administrator doing it for them, and
   * the scope predicate is what stops them printing anybody else's.
   */
  @RequirePermission("payment", "read")
  @Get("payments/:id/receipt")
  receipt(@Param("id") id: string, @Req() req: Request) {
    return this.receipts.forPayment(id, req.ip);
  }
}
