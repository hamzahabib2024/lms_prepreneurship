import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query, Req } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import {
  registrationApproveSchema,
  registrationRejectSchema,
  registrationRequestInfoSchema,
  registrationSubmitSchema,
  type RegistrationApproveInput,
  type RegistrationRejectInput,
  type RegistrationSubmitInput,
} from "@lms/shared";
import type { Request } from "express";
import { AdmissionService } from "./admission.service";
import { zodBody } from "../common/zod-validation.pipe";
import { Public, RequirePermission } from "../rbac/permissions.guard";

/** SRS §9.4 — registration and admission endpoints. */
@Controller()
export class AdmissionController {
  constructor(private readonly admission: AdmissionService) {}

  // ------------------------------------------------------------ public ----

  /**
   * FR-REG-001 — no account, no login, no app install.
   *
   * SEC-RTL-004: rate-limited to three submissions per hour per address. Tight
   * enough to stop automated abuse, loose enough that a family sharing a
   * connection can still apply.
   */
  @Public()
  @Throttle({ default: { limit: 3, ttl: 3_600_000 } })
  @Post("public/registrations")
  submit(@Body(zodBody(registrationSubmitSchema)) dto: RegistrationSubmitInput, @Req() req: Request) {
    // FR-REG-006 — campaign data is captured from the link, without the
    // applicant doing anything, so marketing spend can be attributed (OBJ-07).
    const q = req.query as Record<string, string | undefined>;
    const campaignRef = {
      utmSource: q["utm_source"] ?? null,
      utmMedium: q["utm_medium"] ?? null,
      utmCampaign: q["utm_campaign"] ?? null,
      utmContent: q["utm_content"] ?? null,
      referrer: req.header("referer") ?? null,
      capturedAt: new Date().toISOString(),
    };
    return this.admission.submit(dto, campaignRef);
  }

  /**
   * FR-REG-020 — status by tracking reference, unauthenticated.
   *
   * SEC-RTL-004 / SEC-AUZ-004: rate-limited because a tracking reference is
   * not a credential, and enumeration must be impractical.
   */
  @Public()
  @Throttle({ default: { limit: 20, ttl: 3_600_000 } })
  @Get("public/registrations/:trackingRef/status")
  status(@Param("trackingRef") trackingRef: string) {
    return this.admission.publicStatus(trackingRef);
  }

  // ------------------------------------------------------ administrative --

  @RequirePermission("registration_queue", "read")
  @Get("registration-requests")
  list(
    @Query("status") status?: string,
    @Query("sectionId") sectionId?: string,
    @Query("source") source?: string,
    @Query("q") q?: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
  ) {
    return this.admission.listQueue({
      status,
      sectionId,
      source,
      q,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  /** FR-REG-026 — claim, so two administrators cannot act on one application. */
  @RequirePermission("registration", "update")
  @Post("registration-requests/:id/claim")
  @HttpCode(200)
  claim(@Param("id") id: string) {
    return this.admission.claim(id);
  }

  @RequirePermission("registration", "update")
  @Delete("registration-requests/:id/claim")
  @HttpCode(204)
  async release(@Param("id") id: string): Promise<void> {
    await this.admission.releaseClaim(id);
  }

  /**
   * FR-REG-039 — verify payment and provision, in one transaction.
   *
   * `approve` on the `registration` resource, not `update`: approving is a
   * decision that changes a record's authoritative state, and §4.1.2 separates
   * that from ordinary editing so the two can be granted independently.
   */
  @RequirePermission("registration", "approve")
  @Post("registration-requests/:id/approve")
  @HttpCode(201)
  approve(
    @Param("id") id: string,
    @Body(zodBody(registrationApproveSchema)) dto: RegistrationApproveInput,
    @Req() req: Request,
  ) {
    return this.admission.approve(id, dto, req.ip, req.header("user-agent"));
  }

  @RequirePermission("registration", "approve")
  @Post("registration-requests/:id/reject")
  @HttpCode(200)
  reject(
    @Param("id") id: string,
    @Body(zodBody(registrationRejectSchema)) dto: RegistrationRejectInput,
    @Req() req: Request,
  ) {
    return this.admission.reject(id, dto, req.ip, req.header("user-agent"));
  }

  @RequirePermission("registration", "approve")
  @Post("registration-requests/:id/request-info")
  @HttpCode(200)
  requestInfo(
    @Param("id") id: string,
    @Body(zodBody(registrationRequestInfoSchema)) dto: { message: string },
  ) {
    return this.admission.requestInfo(id, dto.message);
  }
}
