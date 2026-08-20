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

/**
 * How many applications one address may submit in an hour.
 *
 * `Number("")` is 0, not NaN — so `APPLY_LIMIT_PER_HOUR=` in .env, or the
 * empty string compose passes when the variable is unset, would set the limit
 * to ZERO and refuse every application in the country with a rate-limit error.
 * A blank is somebody not setting it, so it takes the default; a nonsense value
 * does too, rather than deciding what a negative limit means.
 */
function applyLimitPerHour(): number {
  const raw = (process.env["APPLY_LIMIT_PER_HOUR"] ?? "").trim();
  const n = Number(raw);
  return raw !== "" && Number.isFinite(n) && n > 0 ? n : 10;
}

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
   * The videos and social links the Institute has published — FR-PUB.
   *
   * Public for the same reason the prospectus is, and safe for the same
   * reason: everything it returns is already published by the Institute
   * elsewhere. There is nothing about any person in it.
   */
  /**
   * FR-REG-007 — where an applicant sends the money.
   *
   * Public for the same reason the prospectus is: somebody deciding whether to
   * apply needs to know what it costs and where to pay, and neither is a
   * secret. A bank account that receives fees is printed on every prospectus
   * the Institute has ever handed out.
   */
  @Public()
  @Get("public/payment-details")
  paymentDetails() {
    return this.admission.paymentDetails();
  }

  @Public()
  @Get("public/showcase")
  showcase() {
    return this.admission.showcase();
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
   * SEC-RTL-004: rate-limited per client address.
   *
   * THE LIMIT COUNTS ATTEMPTS, NOT APPLICATIONS, and that is what made three
   * too few. A submission refused for a mistyped CNIC consumes one, so an
   * applicant filling in nineteen fields on a phone could be locked out for an
   * hour before a single valid attempt reached the server — and the failure
   * looked like the Institute's fault rather than a limit.
   *
   * Ten matches the slip endpoint above and still stops flooding: every
   * application needs a distinct CNIC, email and phone, so ten an hour from
   * one address is a busy family or a cyber café, not an attack. A computer
   * lab or an internet café — where several genuine applicants really do share
   * one address — is the case a tight per-IP limit punishes hardest, and it is
   * exactly where applicants in Pakistan apply from.
   *
   * Configurable because the right number depends on where the Institute's
   * applicants come from, and finding out means changing it without a
   * deployment.
   */
  @Public()
  @Throttle({
    default: {
      limit: applyLimitPerHour(),
      ttl: 3_600_000,
    },
  })
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
