import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { z } from "zod";
import { CertificateService } from "./certificate.service";
import { zodBody } from "../common/zod-validation.pipe";
import { Public, RequirePermission } from "../rbac/permissions.guard";

const revokeSchema = z.object({
  reason: z.string().trim().min(10).max(1000),
});

/** SRS §9.10 — certificate endpoints. */
@Controller()
export class CertificateController {
  constructor(private readonly certificates: CertificateService) {}

  /**
   * FR-CRT-002 — issue.
   *
   * `certificate:create`, which the §4.5 matrix grants an Admin only WITH the
   * certificate_issuer sub-permission. Issuing a qualification is not part of
   * ordinary administration.
   */
  @RequirePermission("certificate", "create")
  @Post("students/:studentId/certificates/subject/:sectionSubjectId")
  issueSubject(
    @Param("studentId") studentId: string,
    @Param("sectionSubjectId") sectionSubjectId: string,
  ) {
    return this.certificates.issueForSubject(studentId, sectionSubjectId);
  }

  /**
   * FR-CRT-012 — revoke.
   *
   * Guarded by `certificate:delete`, which the §4.5 matrix grants to a Super
   * Admin alone. An Admin holding certificate_issuer can create, read, approve
   * and export but NOT delete, and that separation is deliberate: the person
   * who issues a qualification should not be able to unilaterally undo it.
   *
   * `delete` is the right action even though nothing is deleted. BR-DAT-02
   * forbids destroying the record — a certificate that vanished would leave an
   * employer holding a document the System denies exists — so for this resource
   * revocation IS the destructive operation, and it is what `delete` means
   * here.
   */
  @RequirePermission("certificate", "delete")
  @Post("certificates/:id/revoke")
  revoke(@Param("id") id: string, @Body(zodBody(revokeSchema)) dto: z.infer<typeof revokeSchema>) {
    return this.certificates.revoke(id, dto.reason);
  }

  /**
   * FR-CRT-006 — the issuance worklist for a subject-section.
   *
   * Guarded by `certificate:create`, the same permission as issuing. This is a
   * cohort list with every classmate's marks and standing on it, so guarding it
   * with `certificate:read` — which a student holds over their OWN certificate
   * — would open the class to them. Only someone who can actually issue has any
   * use for it.
   */
  @RequirePermission("certificate", "create")
  @Get("section-subjects/:id/certificates")
  issuanceView(@Param("id") id: string) {
    return this.certificates.issuanceView(id);
  }

  /** A student's own, including revoked ones (BR-ENR-08). */
  @RequirePermission("certificate", "read")
  @Get("me/certificates")
  mine() {
    return this.certificates.mine();
  }

  @RequirePermission("certificate", "read")
  @Get("students/:studentId/certificates")
  forStudent(@Param("studentId") studentId: string) {
    return this.certificates.listForStudent(studentId);
  }

  /**
   * FR-CRT-015 — public verification.
   *
   * Unauthenticated by necessity: an employer holding a printed certificate has
   * no account. Rate-limited because a verification code is not a credential
   * and enumeration must stay impractical (SEC-RTL-004) — though at 32 random
   * bytes, the limit is defence in depth rather than the actual barrier.
   */
  @Public()
  @Throttle({ default: { limit: 30, ttl: 3_600_000 } })
  @Get("public/certificates/:code/verify")
  verify(@Param("code") code: string) {
    return this.certificates.verify(code);
  }
}
