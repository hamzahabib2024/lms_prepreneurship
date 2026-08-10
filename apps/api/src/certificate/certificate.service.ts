import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomBytes } from "node:crypto";
import { AppError } from "@lms/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { ProgressService } from "../progress/progress.service";
import { getActor } from "../prisma/actor-context";
import { assertOwnStudent } from "../rbac/ownership";
import { RegistrationNumberService } from "../admission/registration-number.service";
import { NotificationService } from "../notification/notification.service";

/**
 * Completion certificates — SRS §5.15, FR-CRT-001..020.
 *
 * Two rules shape everything here.
 *
 * A CERTIFICATE IS EARNED, NOT GRANTED. Issue recomputes the student's standing
 * and refuses if the criteria are not met, listing exactly what is outstanding.
 * An administrator cannot hand one out because they were asked nicely; if the
 * Institute wants to waive a requirement, that is a change to the criteria,
 * which is configuration and is audited as such.
 *
 * A CERTIFICATE IS A SNAPSHOT. Progress is derived and recomputed on every read
 * (ARC-007), so it moves as content is published and registers are corrected.
 * The document says "this student met the requirements on this date", and it
 * carries its own copies of the figures AND of the criteria that were applied,
 * so a challenge years later can be answered with the rule that was actually
 * used rather than today's configuration.
 */
@Injectable()
export class CertificateService {
  private readonly logger = new Logger(CertificateService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly progress: ProgressService,
    private readonly config: ConfigService,
    private readonly numbers: RegistrationNumberService,
    private readonly notifications: NotificationService,
  ) {}

  /**
   * FR-CRT-002 — issues a subject certificate, or explains why it cannot.
   *
   * Idempotent: asking twice returns the certificate already issued rather than
   * minting a second number. A double-submitted form must not produce two
   * documents with different numbers for the same achievement.
   */
  async issueForSubject(studentId: string, sectionSubjectId: string) {
    const actor = getActor();
    if (!actor) throw new AppError("AUTH_TOKEN_INVALID");

    const existing = await this.prisma.scoped.certificate.findFirst({
      where: { studentId, sectionSubjectId, status: "ISSUED" },
    });
    if (existing) return this.present(existing, { alreadyIssued: true });

    // Recomputed HERE rather than trusting anything the caller sent. This is
    // the check that makes the certificate mean something.
    const standing = await this.progress.forSubject(studentId, sectionSubjectId);

    if (!standing.completionCriteria.met) {
      throw new AppError("VALIDATION_FAILED", {
        message: "This student has not met the requirements for this subject.",
        // The specific gaps, so an administrator can tell the student what is
        // missing rather than only that something is (NFR-USE-007).
        details: standing.completionCriteria.outstanding.map((reason) => ({
          field: "completion",
          code: "NOT_MET",
          message: reason,
        })),
      });
    }

    const certificateNo = await this.nextCertificateNo();

    const created = await this.prisma.scoped.certificate.create({
      data: {
        certificateNo,
        studentId,
        type: "SUBJECT",
        sectionSubjectId,
        progressPercent: standing.overallPercent,
        attendancePercent: standing.attendance.percentage,
        averageGradePercent: standing.averageGradePercent,
        // The rule as applied, not a reference to it.
        criteriaApplied: {
          minProgressPercent: standing.completionCriteria.minProgressPercent,
          minAttendancePercent: standing.completionCriteria.minAttendancePercent,
          minAverageGradePercent: standing.completionCriteria.minAverageGradePercent,
        } as object,
        status: "ISSUED",
        issuedBy: actor.userId,
        verificationCode: this.newVerificationCode(),
      },
    });

    await this.audit.record({
      action: "certificate.issue",
      entityType: "Certificate",
      entityId: created.id,
      after: {
        certificateNo,
        studentId,
        sectionSubjectId,
        progressPercent: standing.overallPercent,
      },
    });

    // DEP-04 — earning a qualification is the one notification a student would
    // be sorry to miss, so it is URGENT: it reaches them past quiet hours.
    const student = await this.prisma.asSystem((db) =>
      db.student.findUnique({ where: { id: studentId }, select: { userId: true } }),
    );
    if (student) {
      await this.notifications.notify({
        recipientUserIds: [student.userId],
        kind: "certificate.issued",
        title: "Your certificate has been issued",
        body: `Certificate ${certificateNo} is now available, with a link you can give to an employer.`,
        linkPath: "/subjects",
        isUrgent: true,
      });
    }

    return this.present(created, { alreadyIssued: false });
  }

  /**
   * FR-CRT-012 — revokes, never deletes.
   *
   * A certificate that vanished would leave an employer holding a document the
   * System denies exists. Revocation keeps the record and gives verification
   * something truthful to say (BR-DAT-02).
   */
  async revoke(certificateId: string, reason: string) {
    const actor = getActor();
    if (!actor) throw new AppError("AUTH_TOKEN_INVALID");

    const certificate = await this.prisma.scoped.certificate.findFirst({
      where: { id: certificateId },
    });
    if (!certificate) throw new AppError("RESOURCE_NOT_FOUND");

    if (certificate.status === "REVOKED") {
      throw new AppError("RESOURCE_CONFLICT", {
        message: "That certificate has already been revoked.",
      });
    }

    const updated = await this.prisma.scoped.certificate.update({
      where: { id: certificateId },
      data: {
        status: "REVOKED",
        revokedAt: new Date(),
        revokedBy: actor.userId,
        revocationReason: reason,
      },
    });

    // SEC-LOG-009 — revoking a qualification is a privileged act; the reason is
    // recorded with it, because "why" is the first question anyone will ask.
    await this.audit.record({
      action: "certificate.revoke",
      entityType: "Certificate",
      entityId: certificateId,
      before: { status: "ISSUED" },
      after: { status: "REVOKED", reason },
    });

    return this.present(updated, { alreadyIssued: false });
  }

  /**
   * FR-CRT-006 — the issuance worklist for one subject-section.
   *
   * Every enrolled student, whether they have met the criteria, and whether a
   * certificate already exists. An administrator opening this wants one
   * question answered — who can I issue to now — so the answer is computed
   * here rather than left to the interface to derive from three separate calls.
   *
   * The cohort progress is reused from ProgressService rather than recomputed:
   * it already walks every enrolment and applies the same formula, and a second
   * implementation would be a second thing to keep in step.
   */
  async issuanceView(sectionSubjectId: string) {
    const cohort = await this.progress.forSectionSubject(sectionSubjectId);

    const certificates = await this.prisma.scoped.certificate.findMany({
      where: { sectionSubjectId },
      orderBy: { issuedAt: "desc" },
    });

    // Latest first, so a revoked certificate does not mask a live reissue.
    const byStudent = new Map<string, (typeof certificates)[number]>();
    for (const c of certificates) {
      const held = byStudent.get(c.studentId);
      if (!held || (held.status === "REVOKED" && c.status === "ISSUED")) {
        byStudent.set(c.studentId, c);
      }
    }

    return {
      sectionSubjectId,
      students: cohort.students.map((s: (typeof cohort.students)[number]) => {
        const certificate = byStudent.get(s.studentId);
        return {
          studentId: s.studentId,
          rollNo: s.rollNo,
          name: s.name,
          overallPercent: s.overallPercent,
          attendancePercent: s.attendancePercent,
          averageGradePercent: s.averageGradePercent,
          completionMet: s.completionMet,
          certificate: certificate
            ? {
                id: certificate.id,
                certificateNo: certificate.certificateNo,
                status: certificate.status,
                issuedAt: certificate.issuedAt,
              }
            : null,
          // The single question the screen exists to answer.
          canIssue: s.completionMet && certificate?.status !== "ISSUED",
        };
      }),
      eligible: cohort.students.filter(
        (s: (typeof cohort.students)[number]) =>
          s.completionMet && byStudent.get(s.studentId)?.status !== "ISSUED",
      ).length,
      issued: [...byStudent.values()].filter((c) => c.status === "ISSUED").length,
    };
  }

  /** A student's own certificates, including revoked ones (BR-ENR-08). */
  async listForStudent(studentId: string) {
    assertOwnStudent(studentId); // SEC-AUZ-004

    const rows = await this.prisma.scoped.certificate.findMany({
      where: { studentId },
      orderBy: { issuedAt: "desc" },
      include: {
        sectionSubject: { include: { subject: { select: { code: true, name: true } } } },
        programme: { select: { code: true, name: true } },
      },
    });

    return rows.map((c: (typeof rows)[number]) => ({
      ...this.present(c, { alreadyIssued: false }),
      subject: c.sectionSubject?.subject ?? null,
      programme: c.programme ?? null,
    }));
  }

  /** The signed-in student's own, without needing their id. */
  async mine() {
    const actor = getActor();
    if (!actor?.studentId) {
      throw new AppError("AUTH_FORBIDDEN", {
        message: "This view is for students. Your account is not a student account.",
      });
    }
    return this.listForStudent(actor.studentId);
  }

  /**
   * FR-CRT-015 — public verification.
   *
   * An employer holding a printed certificate has no account, so this runs
   * unauthenticated and therefore under asSystem: the scope predicate has no
   * actor to work from. That makes the PROJECTION the whole protection, and it
   * is deliberately minimal — enough to confirm the document is genuine, and
   * nothing that would turn this into a way to mine student records.
   *
   * Returned: the holder's name, what it is for, when it was issued, and
   * whether it still stands. NOT returned: marks, attendance, contact details,
   * registration number, or any identifier that could be used elsewhere.
   *
   * A wrong code gets the same "not found" as a well-formed one that does not
   * exist, and the code is 32 random bytes rather than the printed number, so
   * guessing is impractical (SEC-AUZ-004).
   */
  async verify(verificationCode: string) {
    const certificate = await this.prisma.asSystem((db) =>
      db.certificate.findUnique({
        where: { verificationCode },
        select: {
          certificateNo: true,
          type: true,
          status: true,
          issuedAt: true,
          revokedAt: true,
          student: { select: { user: { select: { fullName: true } } } },
          sectionSubject: { select: { subject: { select: { name: true } } } },
          programme: { select: { name: true } },
        },
      }),
    );

    if (!certificate) {
      return { found: false as const, message: "No certificate matches that code." };
    }

    return {
      found: true as const,
      certificateNo: certificate.certificateNo,
      holderName: certificate.student.user.fullName,
      awardedFor:
        certificate.sectionSubject?.subject.name ?? certificate.programme?.name ?? "",
      type: certificate.type,
      issuedAt: certificate.issuedAt,
      // Stated plainly. An employer checking a revoked certificate must be
      // told, not left to infer it from a missing field.
      valid: certificate.status === "ISSUED",
      revokedAt: certificate.revokedAt,
    };
  }

  // ------------------------------------------------------------ internals --

  /**
   * The next number in the year's series.
   *
   * Reuses RegistrationNumberService.allocateSequence rather than writing a
   * second counter: two administrators issuing at the same moment must not
   * receive the same number, that is RSK-07, and the atomic
   * INSERT ... ON CONFLICT DO UPDATE ... RETURNING there already solves it and
   * is already tested. A certificate number is printed, permanent and public,
   * so it has exactly the same requirement as a registration number.
   */
  private async nextCertificateNo(): Promise<string> {
    const prefix = this.config.get<string>("CERTIFICATE_PREFIX", "CERT");
    const year = new Date().getFullYear();

    return this.prisma.asSystem((db) =>
      db.$transaction(async (tx) => {
        const sequence = await this.numbers.allocateSequence(tx, `certificate:${year}`);
        return `${prefix}/${year}/${String(sequence).padStart(5, "0")}`;
      }),
    );
  }

  /**
   * 32 random bytes, hex encoded.
   *
   * Not derived from the certificate number, the student, or the date: a code
   * anyone could compute from the printed document would verify a forgery.
   */
  private newVerificationCode(): string {
    return randomBytes(32).toString("hex");
  }

  private present(
    c: {
      id: string;
      certificateNo: string;
      type: string;
      status: string;
      issuedAt: Date;
      revokedAt: Date | null;
      revocationReason: string | null;
      progressPercent: unknown;
      attendancePercent: unknown;
      averageGradePercent: unknown;
      verificationCode: string;
    },
    meta: { alreadyIssued: boolean },
  ) {
    return {
      id: c.id,
      certificateNo: c.certificateNo,
      type: c.type,
      status: c.status,
      issuedAt: c.issuedAt,
      revokedAt: c.revokedAt,
      revocationReason: c.revocationReason,
      progressPercent: Number(c.progressPercent),
      attendancePercent: c.attendancePercent == null ? null : Number(c.attendancePercent),
      averageGradePercent:
        c.averageGradePercent == null ? null : Number(c.averageGradePercent),
      verificationCode: c.verificationCode,
      alreadyIssued: meta.alreadyIssued,
    };
  }
}
