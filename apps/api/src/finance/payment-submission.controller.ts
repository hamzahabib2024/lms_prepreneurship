import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Throttle } from "@nestjs/throttler";
import {
  paymentRejectSchema,
  paymentSubmissionSchema,
  paymentVerifySchema,
  type PaymentRejectInput,
  type PaymentSubmissionInput,
  type PaymentVerifyInput,
} from "@lms/shared";
import type { Request, Response } from "express";
import { PaymentSubmissionService } from "./payment-submission.service";
import { MAX_SLIP_BYTES, SlipService } from "../admission/slip.service";
import { zodBody } from "../common/zod-validation.pipe";
import { RequirePermission } from "../rbac/permissions.guard";

/**
 * SRS §9.18 — a student saying they have paid, and the office deciding.
 *
 * WHY THIS IS ITS OWN CONTROLLER rather than more routes on FeeController:
 * every route on that one is `payment`, which §4.5 puts behind step-up for
 * STAFF and grants a student at OWN scope for reading only. Nothing here is
 * `payment`. A student CREATES on this controller, which they may never do on
 * the other, and the resource is deliberately a different one so that the
 * grant which lets them file a claim can never be read as a grant to record
 * money received. The note beside `payment_submission` in rbac.ts is the whole
 * argument.
 *
 * THE ROUTE ORDER IN THE STUDENT SECTION IS LOAD-BEARING. `fees/submissions/mine`
 * and `fees/submissions/stats` are declared before `fees/submissions/:id`,
 * because Nest matches in declaration order and "mine" is a perfectly good
 * uuid-shaped-nothing that would otherwise be looked up as an id and 404.
 */
@Controller()
export class PaymentSubmissionController {
  constructor(
    private readonly submissions: PaymentSubmissionService,
    // The SAME slip service the public application form uses. A payment proof
    // and an application slip are the same act — a photograph of a bank
    // receipt, sniffed by content, deduplicated by hash, stored through the
    // registry — and a second implementation of it is a second place for the
    // content-type check to be got wrong (SEC-FIL-003).
    private readonly slips: SlipService,
  ) {}

  // ============================================================= student ====

  /**
   * Everything the form needs, in one request.
   *
   * `read`, not `create`: it discloses the student's own name, balance and the
   * Institute's bank details, and discloses nothing about anybody else. A
   * student who may not read their own fees may not see this either.
   */
  @RequirePermission("payment_submission", "read")
  @Get("fees/submissions/context")
  context() {
    return this.submissions.myContext();
  }

  /**
   * A student's own claims, newest first — their payment history.
   *
   * Declared before `:id`. See the note on the class.
   */
  @RequirePermission("payment_submission", "read")
  @Get("fees/submissions/mine")
  mine() {
    return this.submissions.mine();
  }

  /**
   * The proof, uploaded BEFORE the claim exists.
   *
   * The same two-step shape the application form has, and for the same reason:
   * the submit schema names document ids, so the file has to exist first. What
   * comes back is an id, and that id is a bearer token for exactly one thing —
   * naming this file on one submission, while it still belongs to nobody.
   *
   * THROTTLED HARDER THAN THE SUBMISSION ITSELF, because this is the route
   * that writes a file. Twenty an hour is generous for somebody photographing
   * a slip on a phone and retrying on a bad connection, and it is per account
   * here rather than per address — this endpoint needs a session, so there is
   * a better key than an IP that a mobile network changes freely.
   */
  @RequirePermission("payment_submission", "create")
  @Throttle({ default: { limit: 20, ttl: 3_600_000 } })
  @Post("fees/submissions/proof")
  @UseInterceptors(
    // multer's own ceiling, applied at the socket before any validation of
    // ours runs. A 900MB upload is refused rather than buffered into memory
    // and then declined politely.
    FileInterceptor("file", { limits: { fileSize: MAX_SLIP_BYTES, files: 1 } }),
  )
  uploadProof(@UploadedFile() file?: Express.Multer.File) {
    return this.slips.upload(file);
  }

  /**
   * FR-PAY-021 — filing the claim.
   *
   * NOTHING HERE PUTS MONEY IN THE LEDGER. The service is emphatic about it
   * and so is the permission: `create` on `payment_submission`, which a
   * student holds, is not `create` on `payment`, which they never will.
   */
  @RequirePermission("payment_submission", "create")
  @Throttle({ default: { limit: 10, ttl: 3_600_000 } })
  @Post("fees/submissions")
  submit(
    @Body(zodBody(paymentSubmissionSchema)) body: PaymentSubmissionInput,
    @Req() req: Request,
  ) {
    return this.submissions.submit(body, req.ip);
  }

  /**
   * Withdrawing a claim nobody has looked at yet.
   *
   * DELETE, and `payment_submission:delete` — which the matrix grants a
   * student at OWN scope and describes as exactly this. The service refuses
   * the moment an administrator has acted, so it can never erase a decision;
   * the row is marked CANCELLED rather than removed.
   */
  @RequirePermission("payment_submission", "delete")
  @Delete("fees/submissions/:id")
  cancel(@Param("id") id: string) {
    return this.submissions.cancel(id);
  }

  // ============================================================== office ====

  /**
   * FR-PAY-021 — the figures on the fee desk.
   *
   * Before `:id`, like `mine` above.
   */
  @RequirePermission("payment_submission", "read")
  @Get("fees/submissions/stats")
  stats() {
    return this.submissions.stats();
  }

  /**
   * FR-PAY-021 — the review queue.
   *
   * EVERY FILTER ARRIVES AS A STRING and is converted here rather than in the
   * service, so the service's signature says what it means (`from: Date`) and
   * one place is responsible for the fact that HTTP has no types. An
   * unparseable date is dropped rather than becoming an Invalid Date that
   * silently matches nothing.
   */
  @RequirePermission("payment_submission", "read")
  @Get("fees/submissions")
  queue(
    @Query("status") status?: string,
    @Query("q") q?: string,
    @Query("method") method?: string,
    @Query("programmeId") programmeId?: string,
    @Query("sectionId") sectionId?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("minAmount") minAmount?: string,
    @Query("maxAmount") maxAmount?: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
  ) {
    const fromDate = day(from);
    const toDate = day(to);
    const min = amount(minAmount);
    const max = amount(maxAmount);
    const pageNo = amount(page);
    const perPage = amount(pageSize);

    return this.submissions.queue({
      ...(status ? { status } : {}),
      ...(q ? { q } : {}),
      ...(method ? { method } : {}),
      ...(programmeId ? { programmeId } : {}),
      ...(sectionId ? { sectionId } : {}),
      ...(fromDate ? { from: fromDate } : {}),
      ...(toDate ? { to: toDate } : {}),
      ...(min !== undefined ? { minAmount: min } : {}),
      ...(max !== undefined ? { maxAmount: max } : {}),
      ...(pageNo !== undefined ? { page: pageNo } : {}),
      ...(perPage !== undefined ? { pageSize: perPage } : {}),
    });
  }

  /**
   * One student's claims — for an administrator looking at their record.
   *
   * The same shape as `mine`, from the same method, so the two views cannot
   * drift apart.
   */
  @RequirePermission("payment_submission", "read")
  @Get("students/:id/fees/submissions")
  forStudent(@Param("id") id: string) {
    return this.submissions.forStudent(id);
  }

  /**
   * One submission, with the arithmetic of verifying it spelled out.
   *
   * BOTH AUDIENCES REACH THIS. The scope predicate is what makes that safe: a
   * student asking for somebody else's finds nothing rather than being told
   * they may not (ARC-051).
   */
  @RequirePermission("payment_submission", "read")
  @Get("fees/submissions/:id")
  detail(@Param("id") id: string) {
    return this.submissions.detail(id);
  }

  /**
   * The proof itself, streamed.
   *
   * NEVER A STORAGE URL (SEC-FIL-009). The object is somebody's bank record,
   * and a link that works without a session is a link that still works after
   * the session ends.
   */
  @RequirePermission("payment_submission", "read")
  @Get("fees/submissions/:id/proof/:documentId")
  async proof(
    @Param("id") id: string,
    @Param("documentId") documentId: string,
    @Res() res: Response,
  ): Promise<void> {
    const { body, contentType, filename } = await this.submissions.proof(id, documentId);
    res.setHeader("Content-Type", contentType);
    // INLINE. The reviewer wants to look at the slip beside the figures, not
    // collect a download and open it in another application.
    res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
    // A bank receipt must not sit in a shared cache (SEC-FIL-009).
    res.setHeader("Cache-Control", "private, no-store");
    res.send(body);
  }

  /**
   * FR-PAY-021 — THE ACT THAT MOVES MONEY.
   *
   * `approve`, at step-up. This is the one route in the fee system that turns
   * a student's claim into a Payment the ledger counts, and the matrix asks
   * whoever presses it to prove who they are first.
   *
   * 200, not 201: it does create a Payment, but what the caller asked for was
   * a decision on an existing submission, and the body they get back is that
   * submission's new state.
   */
  @RequirePermission("payment_submission", "approve")
  @HttpCode(200)
  @Post("fees/submissions/:id/verify")
  verify(
    @Param("id") id: string,
    @Body(zodBody(paymentVerifySchema)) body: PaymentVerifyInput,
    @Req() req: Request,
  ) {
    return this.submissions.verify(id, body, req.ip);
  }

  /**
   * FR-PAY-021 — declining one, with a reason the student reads verbatim.
   *
   * Also `approve`: deciding NO is the same authority as deciding yes, and a
   * rejection is what closes a claim the office cannot match to a bank record.
   */
  @RequirePermission("payment_submission", "approve")
  @HttpCode(200)
  @Post("fees/submissions/:id/reject")
  reject(
    @Param("id") id: string,
    @Body(zodBody(paymentRejectSchema)) body: PaymentRejectInput,
    @Req() req: Request,
  ) {
    return this.submissions.reject(id, body, req.ip);
  }
}

/**
 * A date from a query string, or nothing.
 *
 * `new Date("")` is Invalid Date, and an Invalid Date reaching Prisma is a
 * filter that matches nothing while looking as though it matched everything —
 * which is reported as lost data, not as a bad filter.
 */
function day(raw?: string): Date | undefined {
  if (!raw) return undefined;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** A number from a query string, or nothing. `Number("")` is 0, which is not. */
function amount(raw?: string): number | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}
