import { Body, Controller, Get, HttpCode, Post } from "@nestjs/common";
import { z } from "zod";
import { PendingEmailService } from "./pending-email.service";
import { zodBody } from "../common/zod-validation.pipe";
import { RequirePermission } from "../rbac/permissions.guard";
import { getActor } from "../prisma/actor-context";
import { AppError } from "@lms/shared";

/**
 * OUTGOING EMAIL, AND THE PERSON WHO DECIDES IT GOES — SRS §9.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY AN INSTITUTE WOULD WANT THIS. Two reasons, and the second is the one that
 * bites:
 *
 *   1. A message carrying somebody's way into the System should be something a
 *      person chose to send. An import of two hundred is two hundred sets of
 *      credentials leaving the building on the strength of a CSV nobody read
 *      twice.
 *
 *   2. THE DAILY ALLOWANCE IS FINITE. A free Google account will send five
 *      hundred messages a day. Holding the queue means the office decides what
 *      is worth spending that on — rather than an accidental re-import using it
 *      all up and the afternoon's genuine mail bouncing.
 *
 * RELEASING IS A STATUS CHANGE, NOT A SEND. The sweep does the sending, ten
 * minutes at a time, because approving forty messages here would mean forty
 * SMTP round trips inside one request — the same freeze the cohort import was
 * cured of. The screen says so, so nobody watches for an inbox that is thirty
 * seconds behind.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const idsSchema = z.object({
  /** Empty means "everything awaiting approval" — what the release-all button sends. */
  ids: z.array(z.string().uuid()).max(500).default([]),
});

const discardSchema = z.object({
  // Never empty: discarding everything by leaving a field out is exactly the
  // accident this refuses to make possible.
  ids: z.array(z.string().uuid()).min(1, "Choose what to discard.").max(500),
});

@Controller("admin/email-queue")
export class EmailQueueController {
  constructor(private readonly queue: PendingEmailService) {}

  /** What is waiting, why, and whether the Institute is holding mail at all. */
  @RequirePermission("email_queue", "read")
  @Get()
  async list() {
    const [state, requiresApproval] = await Promise.all([
      this.queue.list(),
      this.queue.approvalRequired(),
    ]);
    return { ...state, requiresApproval };
  }

  /**
   * Let them go.
   *
   * `update` rather than a bespoke action: releasing a message changes its
   * state, and inventing an "approve" verb for the matrix would put one
   * resource's vocabulary out of step with every other.
   */
  @RequirePermission("email_queue", "update")
  @Post("approve")
  @HttpCode(200)
  approve(@Body(zodBody(idsSchema)) dto: z.infer<typeof idsSchema>) {
    const actor = getActor();
    if (!actor) throw new AppError("AUTH_TOKEN_INVALID");
    return this.queue.approve(dto.ids, actor.userId);
  }

  /** Decide they should not go at all. The rows are kept and marked. */
  @RequirePermission("email_queue", "delete")
  @Post("discard")
  @HttpCode(200)
  discard(@Body(zodBody(discardSchema)) dto: z.infer<typeof discardSchema>) {
    const actor = getActor();
    if (!actor) throw new AppError("AUTH_TOKEN_INVALID");
    return this.queue.discard(dto.ids, actor.userId);
  }
}
