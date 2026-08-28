import { Body, Controller, Get, Param, Patch, Post, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";
import { PartnerService } from "./partner.service";
import { zodBody } from "../common/zod-validation.pipe";
import { RequirePermission } from "../rbac/permissions.guard";

/**
 * SRS §9 — partner institutes, and the portal they see.
 *
 * ONE CONTROLLER FOR BOTH AUDIENCES, and the scope is what separates them.
 * `GET partners` returns every institute to our office and exactly one to a
 * partner, because the PARTNER predicate rewrites the query rather than
 * because a branch here checks a role. Two controllers would be two places for
 * that rule to be stated, and the second one is where it gets stated wrongly.
 *
 * NOTHING ON THIS CONTROLLER LETS A PARTNER WRITE. Every route they can reach
 * is a GET; `create` and `update` are `partner_institute` at create/update,
 * which the matrix gives Super Admin and Admin alone.
 */

const createSchema = z.object({
  name: z.string().trim().min(2, "Give the institute its full name.").max(200),
  /* Short, and it ends up on an invoice number that somebody reads down a
     telephone. Letters and digits only for that reason. */
  code: z
    .string()
    .trim()
    .min(2)
    .max(20)
    .regex(/^[A-Za-z0-9-]+$/, "Letters, digits and hyphens only — it prints on an invoice."),
  billingMode: z.enum(["PARTNER_PAYS", "STUDENT_PAYS"]),
  contactName: z.string().trim().max(200).optional(),
  contactEmail: z.string().trim().email("Enter a valid email address.").max(320).optional(),
  contactPhone: z.string().trim().max(20).optional(),
  city: z.string().trim().max(100).optional(),
  address: z.string().trim().max(500).optional(),
  notes: z.string().trim().max(2000).optional(),
});

const invoiceSchema = z.object({
  /* What the invoice is FOR, in the Institute's own words — "Spring 2026,
     Graphic Designing". A date range alone tells the reader nothing they can
     check against their own records. */
  periodLabel: z.string().trim().min(3, "Say what period this invoice covers.").max(120),
  dueDate: z.string().trim().optional(),
  notes: z.string().trim().max(2000).optional(),
});

const updateSchema = createSchema
  .omit({ name: true, code: true })
  .partial()
  .extend({ isActive: z.boolean().optional() });

@Controller()
export class PartnerController {
  constructor(private readonly partners: PartnerService) {}

  // ------------------------------------------------------------- office ----

  /** Every partner for staff; their own single row for a partner. */
  @RequirePermission("partner_institute", "read")
  @Get("partners")
  list() {
    return this.partners.list();
  }

  /**
   * Adding one — Super Admin only, per §4.5.
   *
   * The matrix gives `create` on `partner_institute` to Super Admin alone,
   * because this is the act that makes it possible to hand somebody outside
   * this Institute an account that reads student records.
   */
  @RequirePermission("partner_institute", "create")
  @Post("partners")
  create(@Body(zodBody(createSchema)) dto: z.infer<typeof createSchema>, @Req() req: Request) {
    return this.partners.create(dto, req.ip);
  }

  @RequirePermission("partner_institute", "update")
  @Patch("partners/:id")
  update(
    @Param("id") id: string,
    @Body(zodBody(updateSchema)) dto: z.infer<typeof updateSchema>,
    @Req() req: Request,
  ) {
    return this.partners.update(id, dto, req.ip);
  }

  /**
   * WHAT WOULD BE BILLED — names, amounts and the total, before anything is
   * created. Read-only, and safe to press.
   */
  @RequirePermission("partner_invoice", "read")
  @Get("partners/:id/billing-preview")
  billingPreview(@Param("id") id: string) {
    return this.partners.billingPreview(id);
  }

  /**
   * Raise the invoice.
   *
   * `partner_invoice:create` is Super Admin and Admin, BOTH BEHIND STEP-UP
   * (§4.5) — this creates a claim for money against another organisation, and
   * the matrix already says re-authentication is the price of that.
   */
  @RequirePermission("partner_invoice", "create")
  @Post("partners/:id/invoices")
  createInvoice(
    @Param("id") id: string,
    @Body(zodBody(invoiceSchema)) dto: z.infer<typeof invoiceSchema>,
    @Req() req: Request,
  ) {
    return this.partners.createInvoice(id, dto, req.ip);
  }

  // ------------------------------------------------------------- portal ----

  /**
   * Who the signed-in partner is, and whether they are invoiced.
   *
   * `partner_institute:read` at PARTNER scope, which is the same grant the
   * list above uses — a partner reaching for the list gets their own row
   * anyway, and this is simply the shape the portal wants it in.
   */
  @RequirePermission("partner_institute", "read")
  @Get("partner/me")
  me() {
    return this.partners.me();
  }

  /** Their students. The scope decides whose. */
  @RequirePermission("student_account", "read")
  @Get("partner/students")
  students(@Query("q") q?: string) {
    return this.partners.students(q);
  }

  /**
   * One student's results.
   *
   * AUDITED, unusually for a read. A third party looking at somebody's
   * daughter's marks is an event the Institute must be able to account for
   * afterwards.
   */
  @RequirePermission("student_account", "read")
  @Get("partner/students/:id")
  student(@Param("id") id: string, @Req() req: Request) {
    return this.partners.student(id, req.ip);
  }

  /** What they owe us. Empty for a STUDENT_PAYS partner, by construction. */
  @RequirePermission("partner_invoice", "read")
  @Get("partner/invoices")
  invoices() {
    return this.partners.invoices();
  }

  @RequirePermission("partner_invoice", "read")
  @Get("partner/invoices/:id")
  invoice(@Param("id") id: string) {
    return this.partners.invoice(id);
  }
}
