import { Body, Controller, Get, Header, HttpCode, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { z } from "zod";
import { CohortImportService } from "./cohort-import.service";
import { templateCsv } from "./cohort-import";
import { Public, RequirePermission } from "../rbac/permissions.guard";

// The file arrives as text in the body rather than as multipart, because it IS
// text and the operator has already had it in a text editor. No .max() here:
// the size limit belongs to the import rules, which say what to do about it
// ("split the file by section or batch") rather than "String must contain at
// most N character(s)".
const previewSchema = z.object({
  csv: z.string(),
  sectionId: z.string().uuid(),
});

const commitSchema = z.object({
  csv: z.string(),
  sectionId: z.string().uuid(),
  capacityOverride: z.boolean().default(false),
  /**
   * SEC-PRV-003. Not defaulted, and not optional: the operator has to say it.
   * A default of true would have the System assert on their behalf that three
   * hundred people were shown a notice, which is the one thing it cannot know.
   */
  consentCollectedOffline: z.literal(true, {
    errorMap: () => ({
      message:
        "Confirm that these students were given the data-collection notice. The System cannot " +
        "assert this for you.",
    }),
  }),
  note: z.string().trim().min(10).max(500),
});

/**
 * SRS §9.17 — importing a cohort.
 *
 * `bulk_operation`, the same authority as a bulk transfer: loading three
 * hundred students is a different kind of act from admitting one, and the
 * sub-permission is what says so.
 *
 * Preview is a POST despite writing nothing, because the file is the request.
 */
@Controller()
export class CohortImportController {
  constructor(private readonly imports: CohortImportService) {}

  /**
   * The template, so the operator starts from something that imports rather
   * than from a description of something that would.
   *
   * PUBLIC and unauthenticated on purpose: it is a line of column headings with
   * one invented student in it, it contains nothing about the Institute, and
   * needing a token to fetch a blank form is friction with no payoff.
   */
  @Public()
  @Get("admin/cohort-import/template.csv")
  @Header("Content-Type", "text/csv; charset=utf-8")
  template(@Res() res: Response): void {
    // WRITTEN TO THE RESPONSE DIRECTLY, which is the only way to escape the
    // envelope of §9.2. Returning the string instead wraps it as
    // {"data":"fullName,email,...\n..."} — a file that downloads with a .csv
    // name, opens as one long line of JSON, and cannot be imported. The
    // template's own test cannot catch that: it checks the module, and the
    // damage is done by the interceptor above it.
    res.setHeader("Content-Disposition", 'attachment; filename="cohort-template.csv"');
    res.send(templateCsv());
  }

  /** FR-OPS-024 — what it would do, before it does it. */
  @RequirePermission("bulk_operation", "read")
  @Post("admin/cohort-import/preview")
  @HttpCode(200)
  preview(@Body() body: unknown) {
    const input = previewSchema.parse(body);
    return this.imports.preview(input.csv, input.sectionId);
  }

  /** FR-OPS-025 — load them. */
  @RequirePermission("bulk_operation", "create")
  @Post("admin/cohort-import")
  @HttpCode(200)
  commit(@Body() body: unknown, @Req() req: Request) {
    const input = commitSchema.parse(body);
    return this.imports.commit(
      input.csv,
      input.sectionId,
      {
        capacityOverride: input.capacityOverride,
        consentCollectedOffline: input.consentCollectedOffline,
        note: input.note,
      },
      req.ip,
    );
  }
}
