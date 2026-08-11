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
  registrationApproveSchema,
  registrationRejectSchema,
  registrationRequestInfoSchema,
  registrationSubmitSchema,
  type RegistrationApproveInput,
  type RegistrationRejectInput,
  type RegistrationSubmitInput,
} from "@lms/shared";
import type { Request, Response } from "express";
import { AdmissionService } from "./admission.service";
import { MAX_SLIP_BYTES, SlipService } from "./slip.service";
import { zodBody } from "../common/zod-validation.pipe";
import { Public, RequirePermission } from "../rbac/permissions.guard";

/** SRS §9.4 — registration and admission endpoints. */
@Controller()
export class AdmissionController {
  constructor(
    private readonly admission: AdmissionService,
    private readonly slips: SlipService,
  ) {}

  // ------------------------------------------------------------ public ----

  /**
   * FR-REG-002 — what a stranger can apply for.
   *
   * THE APPLICATION FORM COULD NOT BE BUILT WITHOUT THIS. Submitting one needs
   * a programme id and a section id, and until now nothing public returned
   * either — so the public endpoint existed and no member of the public could
   * reach it. The form had an API and no way to fill it in.
   *
   * WHAT IT DELIBERATELY DOES NOT SAY: how many students are enrolled, who
   * teaches, or anything about anybody. A prospectus is a list of what is on
   * offer, and capacity is the Institute's business — "3 places left" on a
   * public page is a pressure tactic, and "0 places left" tells a competitor
   * more than it tells an applicant. Only whether the section is OPEN.
   */
  @Public()
  @Get("public/prospectus")
  prospectus() {
    return this.admission.prospectus();
  }

  /**
   * FR-REG-008 — a payment slip, uploaded BEFORE the application exists.
   *
   * The other half of what was missing. The submit schema demands between one
   * and five slip ids; nothing in the System created a slip, and the column
   * linking one to an application was NOT NULL, so an unattached slip could
   * not exist. Between them, the public application could not be submitted by
   * anybody.
   *
   * Rate-limited harder than the application itself, because this writes a
   * FILE and an unauthenticated endpoint that writes files is the one a
   * stranger points a script at. Ten an hour is five more than an application
   * may carry, which is enough for somebody who retries.
   */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 3_600_000 } })
  @Post("public/registrations/slips")
  @UseInterceptors(
    // multer's own ceiling, applied before any of our validation runs. A 900MB
    // upload must be refused at the socket rather than buffered into memory
    // and then declined politely.
    FileInterceptor("file", { limits: { fileSize: MAX_SLIP_BYTES, files: 1 } }),
  )
  uploadSlip(@UploadedFile() file?: Express.Multer.File) {
    return this.slips.upload(file);
  }

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

  /**
   * FR-REG-025 — one application, with its payment slips.
   *
   * The list deliberately omits documents; without this endpoint the reviewer
   * could see that an application existed and never see the slip the decision
   * turns on.
   */
  @RequirePermission("registration_queue", "read")
  @Get("registration-requests/:id")
  detail(@Param("id") id: string) {
    return this.admission.detail(id);
  }

  /**
   * FR-REG-024 — the slip itself, streamed.
   *
   * Never a storage URL (SEC-FIL-009). The object is somebody's bank record,
   * and a link that works without a session is a link that still works after
   * the session ends.
   */
  @RequirePermission("registration_queue", "read")
  @Get("registration-requests/:id/documents/:documentId")
  async slip(
    @Param("id") id: string,
    @Param("documentId") documentId: string,
    @Res() res: Response,
  ): Promise<void> {
    const { body, contentType, filename } = await this.admission.slip(id, documentId);
    res.setHeader("Content-Type", contentType);
    // INLINE, not attachment: the reviewer wants to look at it beside the
    // form, not collect a download and open it in another application.
    res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
    // A bank slip must not sit in a shared cache (SEC-FIL-009).
    res.setHeader("Cache-Control", "private, no-store");
    res.send(body);
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
