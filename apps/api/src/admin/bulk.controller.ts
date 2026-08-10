import { Body, Controller, HttpCode, Post } from "@nestjs/common";
import { z } from "zod";
import { BulkService } from "./bulk.service";
import { RequirePermission } from "../rbac/permissions.guard";

// No .min()/.max() on studentIds, deliberately. Zod would answer "Array must
// contain at most 200 element(s)" and shadow bulk-rules, which says what to do
// about it: split it, or use an import for a whole cohort. Same reason the
// rubric schema does not bound its marks.
const transferSchema = z.object({
  studentIds: z.array(z.string().uuid()),
  toSectionId: z.string().uuid(),
  reason: z.string().trim().min(10).max(500),
});

const withdrawSchema = z.object({
  studentIds: z.array(z.string().uuid()),
  reason: z.string().trim().min(10).max(500),
});

const previewSchema = z.object({
  studentIds: z.array(z.string().uuid()),
  toSectionId: z.string().uuid(),
});

/**
 * SRS §9.17 — bulk operations.
 *
 * `bulk_operation`, which §4.5 gives to a Super Admin and to an Admin holding
 * the `bulk_operator` sub-permission. Moving fifty students at once is a
 * different kind of authority from moving one, and the sub-permission is what
 * says so.
 *
 * Preview is a POST despite reading nothing, because the list of students is
 * the request and a query string of two hundred uuids is not a URL anybody can
 * work with.
 */
@Controller()
export class BulkController {
  constructor(private readonly bulk: BulkService) {}

  /** FR-OPS-021 — what it would do, before it does it. */
  @RequirePermission("bulk_operation", "read")
  @Post("admin/bulk/transfer/preview")
  @HttpCode(200)
  previewTransfer(@Body() body: unknown) {
    const input = previewSchema.parse(body);
    return this.bulk.previewTransfer(input.studentIds, input.toSectionId);
  }

  /** FR-OPS-022 — move them. */
  @RequirePermission("bulk_operation", "update")
  @Post("admin/bulk/transfer")
  @HttpCode(200)
  transfer(@Body() body: unknown) {
    const input = transferSchema.parse(body);
    return this.bulk.transfer(input.studentIds, input.toSectionId, input.reason);
  }

  /** FR-OPS-023 — withdraw them. */
  @RequirePermission("bulk_operation", "update")
  @Post("admin/bulk/withdraw")
  @HttpCode(200)
  withdraw(@Body() body: unknown) {
    const input = withdrawSchema.parse(body);
    return this.bulk.withdraw(input.studentIds, input.reason);
  }
}
