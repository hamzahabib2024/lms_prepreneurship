import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { z } from "zod";
import {
  certificateIssueSchema,
  certificateQuerySchema,
  certificateRevokeSchema,
} from "@lms/shared";
import { CertificateService } from "./certificate.service";
import { SignatoryService, MAX_SIGNATORIES } from "./signatory.service";
import { zodBody } from "../common/zod-validation.pipe";
import { Public, RequirePermission } from "../rbac/permissions.guard";

/** SRS §9.10 — certificate endpoints. */
/**
 * Issuing to a whole batch.
 *
 * `everyone` is the office overruling the requirements. The reason is optional
 * on purpose: it is worth recording and it is not worth blocking on, and a
 * required field here would be the software demanding an explanation from the
 * people whose decision it is.
 */
const batchIssueSchema = z.object({
  everyone: z.boolean().optional(),
  reason: z.string().trim().max(500).optional(),
  /** Whose names go at the foot. Omitted means the Institute's current panel. */
  signatoryIds: z.array(z.string().uuid()).max(MAX_SIGNATORIES).optional(),
});

/** Issuing to one student, with a chosen panel. */
const issueSchema = z.object({
  signatoryIds: z.array(z.string().uuid()).max(MAX_SIGNATORIES).optional(),
});

/** Adding or changing somebody in the library. */
const signatorySchema = z.object({
  name: z.string().trim().min(1).max(200),
  designation: z.string().trim().min(1).max(150),
  signatureAssetId: z.string().uuid().nullable().optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(999).optional(),
});
const signatoryPatchSchema = signatorySchema.partial();

@Controller()
export class CertificateController {
  constructor(
    private readonly certificates: CertificateService,
    private readonly signatories: SignatoryService,
  ) {}

  /*
   * ROUTE ORDER MATTERS IN THIS CONTROLLER.
   *
   * `certificates/summary` and `certificates/students` are declared before
   * `certificates/:id`, because Nest matches in declaration order and a
   * parameterised segment would otherwise swallow both — answering a request
   * for the summary with "no certificate has the id 'summary'". That failure
   * looks like a broken endpoint rather than a routing mistake, which is why
   * it is written down here rather than left to be rediscovered.
   */

  /**
   * FR-CRT-006 — the register: every certificate the Institute has issued.
   *
   * `certificate:create` rather than `read`, and the reasoning is the same one
   * that guards the issuance worklist below. A student holds `certificate:read`
   * over their OWN certificates; this is a cross-student list with every
   * holder's name and course on it, and guarding it with `read` would open the
   * whole register to anybody who can see their own certificate. Only somebody
   * who may issue has any business with the register.
   */
  // ───────────────────────────────────── who signs a certificate ──

  /**
   * FR-CRT — the Institute's signatories.
   *
   * `read` is wide on purpose: a teacher whose own name may appear at the foot
   * of a certificate for their class should be able to see the panel, and
   * there is nothing private in three names and three job titles.
   */
  @RequirePermission("signatory", "read")
  @Get("signatories")
  listSignatories(@Query("activeOnly") activeOnly?: string) {
    return this.signatories.list(activeOnly !== "true");
  }

  @RequirePermission("signatory", "create")
  @Post("signatories")
  createSignatory(@Body(zodBody(signatorySchema)) dto: z.infer<typeof signatorySchema>) {
    return this.signatories.create(dto);
  }

  @RequirePermission("signatory", "update")
  @Patch("signatories/:id")
  updateSignatory(
    @Param("id") id: string,
    @Body(zodBody(signatoryPatchSchema)) dto: z.infer<typeof signatoryPatchSchema>,
  ) {
    return this.signatories.update(id, dto);
  }

  /** Soft — see the note on the service. Certificates already signed are safe. */
  @RequirePermission("signatory", "delete")
  @Delete("signatories/:id")
  @HttpCode(200)
  removeSignatory(@Param("id") id: string) {
    return this.signatories.remove(id);
  }

  @RequirePermission("certificate", "create")
  @Get("certificates")
  register(@Query(zodBody(certificateQuerySchema)) query: z.infer<typeof certificateQuerySchema>) {
    return this.certificates.register(query);
  }

  /** The four figures at the head of the register. Same authority as the list. */
  @RequirePermission("certificate", "create")
  @Get("certificates/summary")
  summary() {
    return this.certificates.summary();
  }

  /**
   * Students a manual certificate can be attached to.
   *
   * Guarded by the issuing permission: it is a name-and-number search across
   * the whole roll, which is not something a student or a teacher needs.
   */
  @RequirePermission("certificate", "create")
  @Get("certificates/students")
  studentLookup(@Query("q") q?: string) {
    return this.certificates.studentLookup(q ?? "");
  }

  /**
   * One certificate, ready to be drawn.
   *
   * `certificate:read`, and the SCOPE does the work: a student holds it at OWN
   * scope, so the predicate narrows this to their own rows and a classmate's id
   * simply is not found. That is what lets one endpoint serve the student's own
   * copy, the teacher's view of their class, and the administrator's register.
   */
  @RequirePermission("certificate", "read")
  @Get("certificates/:id")
  document(@Param("id") id: string) {
    return this.certificates.document(id);
  }

  /**
   * FR-CRT-002, the manual route.
   *
   * `certificate:create`, which the §4.5 matrix grants an Admin only WITH the
   * certificate_issuer sub-permission — the same authority as issuing an earned
   * one, deliberately. Issuing by hand is not a lesser act than issuing after a
   * check; if anything it is the one that needs the trust, because nothing but
   * the issuer's judgement stands behind it.
   */
  @RequirePermission("certificate", "create")
  @Post("certificates")
  issueManual(@Body(zodBody(certificateIssueSchema)) dto: z.infer<typeof certificateIssueSchema>) {
    return this.certificates.issueManual(dto);
  }

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
    @Body(zodBody(issueSchema)) dto: z.infer<typeof issueSchema>,
  ) {
    return this.certificates.issueForSubject(studentId, sectionSubjectId, {
      signatoryIds: dto.signatoryIds,
    });
  }

  /**
   * FR-CRT-010 — issue for a whole programme.
   *
   * Same permission as a subject certificate, and deliberately so: it is a
   * bigger claim about the student but the same kind of act, and inventing a
   * second permission for it would be a name nobody could hold. What guards it
   * is the requirement itself — every compulsory subject complete, recomputed
   * at the moment of issue.
   */
  @RequirePermission("certificate", "create")
  @Post("students/:studentId/certificates/programme/:programmeId")
  issueProgramme(
    @Param("studentId") studentId: string,
    @Param("programmeId") programmeId: string,
  ) {
    return this.certificates.issueForProgramme(studentId, programmeId);
  }

  /**
   * FR-CRT-011 — whether they are ready, and what is outstanding if not.
   *
   * `read` rather than `create`: it writes nothing, and an administrator
   * should be able to answer "when will I get my certificate?" without holding
   * the authority to issue one.
   */
  @RequirePermission("certificate", "read")
  @Get("students/:studentId/certificates/programme/:programmeId/standing")
  programmeStanding(
    @Param("studentId") studentId: string,
    @Param("programmeId") programmeId: string,
  ) {
    return this.certificates.programmeStanding(studentId, programmeId);
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
  revoke(
    @Param("id") id: string,
    @Body(zodBody(certificateRevokeSchema)) dto: z.infer<typeof certificateRevokeSchema>,
  ) {
    return this.certificates.revoke(id, dto.reason);
  }

  /**
   * FR-CRT-012 — archive, which is NOT revoke.
   *
   * Guarded by `certificate:update`, which §4.5 grants to a Super Admin alone.
   * That is narrower than it might look and it is the right reading: taking a
   * certificate out of circulation changes what the Institute has on record
   * about somebody's qualification, and an Admin's grant over this resource
   * stops at create, read, approve and export.
   */
  @RequirePermission("certificate", "update")
  @Post("certificates/:id/archive")
  archive(@Param("id") id: string) {
    return this.certificates.archive(id);
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

  /**
   * FR-CRT — issue to the whole batch in one action.
   *
   * `everyone: true` issues regardless of the requirements. That is the
   * office's authority and it is recorded as an override on each certificate
   * and in the audit; it is not refused, and no reason is demanded, because
   * demanding one would be this route deciding it knows better than the
   * people who run the Institute.
   *
   * The same permission as issuing one, and deliberately: it is the same act
   * done thirty times, and a second permission for "the same thing but more
   * of it" is a name nobody could hold.
   */
  @RequirePermission("certificate", "create")
  @Post("section-subjects/:id/certificates/issue-all")
  @HttpCode(200)
  issueWholeClass(
    @Param("id") id: string,
    @Body(zodBody(batchIssueSchema)) dto: z.infer<typeof batchIssueSchema>,
  ) {
    return this.certificates.issueForWholeClass(id, dto);
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
   * and enumeration must stay impractical (SEC-RTL-004).
   *
   * THE LIMIT MATTERS MORE THAN IT USED TO. This now accepts the certificate
   * NUMBER as well as the 32-byte verification code, so that somebody holding
   * paper and no camera can type something in — and certificate numbers are
   * sequential. Everything the endpoint discloses is already printed on the
   * document being checked, but a sequence is walkable in a way random bytes
   * are not, so the ceiling stays low and deliberate.
   */
  @Public()
  @Throttle({ default: { limit: 30, ttl: 3_600_000 } })
  @Get("public/certificates/:code/verify")
  verify(@Param("code") code: string) {
    return this.certificates.verify(code);
  }
}
