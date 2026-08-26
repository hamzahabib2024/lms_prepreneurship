import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import {
  AppError,
  CERTIFICATE_KIND_COPY,
  type CertificateDocument,
  type CertificateIssueInput,
  type CertificateKind,
  type CertificateQueryInput,
} from "@lms/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { ProgressService } from "../progress/progress.service";
import { SettingsService } from "../settings/settings.service";
import { getActor } from "../prisma/actor-context";
import { assertOwnStudent } from "../rbac/ownership";
import { RegistrationNumberService } from "../admission/registration-number.service";
import { NotificationService } from "../notification/notification.service";
import { TemplateService } from "../notification/template.service";
import { SignatoryService, type SignatorySnapshot } from "./signatory.service";

/**
 * Completion certificates — SRS §5.15, FR-CRT-001..020.
 *
 * Three rules shape everything here.
 *
 * A CERTIFICATE IS NORMALLY EARNED. `issueForSubject` and `issueForProgramme`
 * recompute the student's standing and refuse if the criteria are not met,
 * listing exactly what is outstanding. Neither can be talked into handing one
 * out because somebody asked nicely.
 *
 * BUT AN INSTITUTE ALSO CERTIFIES THINGS THE LMS NEVER TAUGHT. A weekend
 * workshop, a guest seminar, a course that ran before the System existed —
 * these are real qualifications and the office has to be able to issue them.
 * `issueManual` is that path. It is not the earned path with the checks
 * switched off: it writes `type: CUSTOM` or the anchor the administrator
 * chose, sets `issuedManually`, records the act in the audit log as its own
 * action, and takes no progress figures because there are none. A reader years
 * later can always tell which of the two a certificate was.
 *
 * A CERTIFICATE IS A SNAPSHOT, AND NOW THAT MEANS THE WORDS TOO. Progress is
 * derived and recomputed on every read (ARC-007), and so, it turns out, was
 * everything else the document said: the holder's name, the course title, the
 * teacher, the Institute. All of it is copied onto the row at issue, so a
 * reprint in 2031 produces the same piece of paper it produced in 2026 — after
 * a marriage, a course rename, a change of director, or the erasure of the
 * student record itself.
 */
@Injectable()
export class CertificateService {
  private readonly logger = new Logger(CertificateService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly signatories: SignatoryService,
    private readonly audit: AuditService,
    private readonly progress: ProgressService,
    private readonly config: ConfigService,
    private readonly settings: SettingsService,
    private readonly numbers: RegistrationNumberService,
    private readonly notifications: NotificationService,
    private readonly templates: TemplateService,
  ) {}

  // ---------------------------------------------------------- issuance ----

  /**
   * FR-CRT-002 — issues a subject certificate, or explains why it cannot.
   *
   * Idempotent: asking twice returns the certificate already issued rather than
   * minting a second number. A double-submitted form must not produce two
   * documents with different numbers for the same achievement.
   */
  /**
   * @param options.override issue even where the requirements are not met.
   *   The office's decision, recorded as one — see the note on the gate below.
   */
  async issueForSubject(
    studentId: string,
    sectionSubjectId: string,
    options: { override?: boolean; reason?: string; signatoryIds?: readonly string[] } = {},
  ) {
    const actor = getActor();
    if (!actor) throw new AppError("AUTH_TOKEN_INVALID");

    const existing = await this.prisma.scoped.certificate.findFirst({
      where: { studentId, sectionSubjectId, status: "ISSUED" },
    });
    if (existing) return this.document(existing.id, { alreadyIssued: true });

    // Recomputed HERE rather than trusting anything the caller sent. This is
    // the check that makes the certificate mean something.
    const standing = await this.progress.forSubject(studentId, sectionSubjectId);

    /*
     * THE GATE, AND THE OFFICE'S AUTHORITY TO STEP OVER IT.
     *
     * Recomputed here rather than trusting anything the caller sent — this is
     * the check that makes a certificate mean something, and it stays the
     * default for everybody.
     *
     * But the Institute issues its own qualifications, and the arithmetic does
     * not know everything: a student who sat a viva instead of the final
     * assignment, one whose attendance was wrecked by an illness the office
     * accepted, a class whose recordings were lost so nobody's video figure is
     * real. Refusing those is not rigour, it is the software overruling the
     * people responsible for the decision.
     *
     * So `override` issues anyway — and RECORDS THAT IT DID. The certificate
     * carries `issuedByOverride` with what was outstanding at the moment of
     * issue, and the audit entry names who decided. That is not a restriction
     * on the office; it is the difference between a certificate the Institute
     * can stand behind in two years and one nobody can explain.
     */
    const met = standing.completionCriteria.met;
    if (!met && !options.override) {
      throw new AppError("VALIDATION_FAILED", {
        message: "This student has not met the requirements for this subject.",
        // The specific gaps, so an administrator can tell the student what is
        // missing rather than only that something is (NFR-USE-007).
        details: standing.completionCriteria.outstanding.map((reason: string) => ({
          field: "completion",
          code: "NOT_MET",
          message: reason,
        })),
      });
    }

    const snapshot = await this.snapshot({ studentId, sectionSubjectId });
    /*
     * WHO SIGNS IT, FROZEN NOW — FR-CRT.
     *
     * Resolved here and stored as values, never as ids. The Principal retires
     * and this certificate must still print her name over her signature in
     * five years; reading through to the live rows at render time would
     * rewrite it the day somebody was promoted.
     */
    const signatories = await this.signatories.panelFor(options.signatoryIds);
    const certificateNo = await this.nextCertificateNo();

    const created = await this.prisma.scoped.certificate.create({
      data: {
        certificateNo,
        studentId,
        type: "SUBJECT",
        kind: "COMPLETION",
        sectionSubjectId,
        ...snapshot,
        progressPercent: standing.overallPercent,
        attendancePercent: standing.attendance.percentage,
        averageGradePercent: standing.averageGradePercent,
        // The rule as applied, not a reference to it.
        criteriaApplied: {
          minProgressPercent: standing.completionCriteria.minProgressPercent,
          minAttendancePercent: standing.completionCriteria.minAttendancePercent,
          minAverageGradePercent: standing.completionCriteria.minAverageGradePercent,
          // Present only when somebody overruled the arithmetic, so its
          // absence means the ordinary path was taken.
          ...(met
            ? {}
            : {
                issuedByOverride: true,
                outstandingAtIssue: standing.completionCriteria.outstanding,
                overrideReason: options.reason ?? null,
              }),
        } as object,
        signatoriesSnapshot: signatories.length > 0 ? (signatories as object[]) : undefined,
        status: "ISSUED",
        issuedBy: actor.userId,
        verificationCode: this.newVerificationCode(),
      },
    });

    await this.audit.record({
      action: met ? "certificate.issue" : "certificate.issue.override",
      entityType: "Certificate",
      entityId: created.id,
      after: {
        certificateNo,
        studentId,
        sectionSubjectId,
        progressPercent: standing.overallPercent,
        ...(met
          ? {}
          : { override: true, outstanding: standing.completionCriteria.outstanding,
              reason: options.reason ?? null }),
      },
    });

    await this.announce(studentId, certificateNo, {
      kind: "certificate.issued",
      title: "Your certificate has been issued",
      subject: snapshot.awardTitleSnapshot,
    });

    return this.document(created.id, { alreadyIssued: false });
  }

  /**
   * FR-CRT-010 — a certificate for the whole programme.
   *
   * WHAT "COMPLETED THE PROGRAMME" MEANS is the entire design, and there were
   * two candidates.
   *
   * The first: the student holds an issued SUBJECT certificate for every
   * compulsory subject. Rejected — an institute that never issues subject
   * certificates could then never issue a programme one, and the programme
   * certificate would be attesting to the Institute's paperwork rather than to
   * the student's work.
   *
   * The second, and what this does: recompute completion for every compulsory
   * subject the student is enrolled in under this programme, exactly as
   * issueForSubject recomputes for one. The programme certificate then means
   * what it says — every part was passed — whether or not anybody printed the
   * parts.
   *
   * A STUDENT WITH NO ENROLMENTS IS REFUSED. Zero subjects all vacuously
   * "complete" is how somebody who never attended anything is handed a
   * qualification, and `every()` over an empty list is exactly how that
   * happens.
   */
  async issueForProgramme(studentId: string, programmeId: string) {
    const actor = getActor();
    if (!actor) throw new AppError("AUTH_TOKEN_INVALID");

    const existing = await this.prisma.scoped.certificate.findFirst({
      where: { studentId, programmeId, status: "ISSUED" },
    });
    if (existing) return this.document(existing.id, { alreadyIssued: true });

    const programme = await this.prisma.scoped.programme.findFirst({
      where: { id: programmeId },
      select: { id: true, name: true, code: true, durationWeeks: true },
    });
    if (!programme) throw new AppError("RESOURCE_NOT_FOUND");

    // Every enrolment of this student that belongs to this programme, walked
    // through the structure rather than assumed: a student may hold subjects
    // in more than one programme at once (they keep one registration number
    // across courses), and certifying the wrong programme's subjects would
    // hand out a qualification nobody earned.
    const enrolments = await this.prisma.scoped.enrolment.findMany({
      where: {
        studentId,
        status: { in: ["ACTIVE", "COMPLETED"] },
        sectionSubject: {
          isCompulsory: true,
          section: { batch: { academicSession: { programmeId } } },
        },
      },
      select: { sectionSubjectId: true },
    });

    if (enrolments.length === 0) {
      throw new AppError("VALIDATION_FAILED", {
        message: `This student is not enrolled in any compulsory subject of ${programme.name}.`,
        details: [
          {
            field: "programmeId",
            code: "NOT_ENROLLED",
            // Said explicitly, because the alternative — an empty list passing
            // an `every()` check — issues a certificate to somebody who never
            // took the course.
            message:
              "A programme certificate cannot be issued to somebody with no subjects in it.",
          },
        ],
      });
    }

    const perSubject = await Promise.all(
      enrolments.map((e: { sectionSubjectId: string }) =>
        this.progress.forSubject(studentId, e.sectionSubjectId),
      ),
    );

    /*
     * ISSUING REQUIRES A SIGNATURE, not merely a threshold.
     *
     * The person who decides a student has finished is deliberately not the
     * person who prints the document: a teacher signs off the class they
     * taught, and the office issues. Neither can do the whole thing alone,
     * which is the point.
     */
    const issueSignOffs = await this.prisma.asSystem((db) =>
      db.subjectCompletion.findMany({
        where: {
          studentId,
          sectionSubjectId: { in: perSubject.map((p) => p.sectionSubjectId) },
          decision: "COMPLETED",
        },
        select: { sectionSubjectId: true },
      }),
    );
    const approved = new Set(issueSignOffs.map((d) => d.sectionSubjectId));
    const unmet = perSubject.filter((p) => !approved.has(p.sectionSubjectId));
    if (unmet.length > 0) {
      throw new AppError("VALIDATION_FAILED", {
        message:
          `${unmet.length} of ${perSubject.length} subjects in ${programme.name} are not complete.`,
        // Named subject by subject. "Requirements not met" leaves an
        // administrator with nothing to tell the student (NFR-USE-007).
        details: unmet.flatMap((p) =>
          p.completionCriteria.outstanding.map((reason: string) => ({
            field: "completion",
            code: "NOT_MET",
            message: `${p.subject?.name ?? "A subject"}: ${reason}`,
          })),
        ),
      });
    }

    // The programme figure is the mean across its subjects, matching how
    // progress is reported everywhere else. Credit-weighting exists in the
    // data model but the Institute has not confirmed a credit scheme
    // (OPN-11), and weighting now would be inventing policy.
    const mean = (pick: (p: (typeof perSubject)[number]) => number | null) => {
      const values = perSubject.map(pick).filter((v): v is number => v !== null);
      if (values.length === 0) return null;
      return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
    };

    const snapshot = await this.snapshot({ studentId, programmeId });
    const certificateNo = await this.nextCertificateNo();
    const created = await this.prisma.scoped.certificate.create({
      data: {
        certificateNo,
        studentId,
        type: "PROGRAMME",
        kind: "COMPLETION",
        programmeId,
        ...snapshot,
        progressPercent: mean((p) => p.overallPercent) ?? 0,
        attendancePercent: mean((p) => p.attendance.percentage),
        averageGradePercent: mean((p) => p.averageGradePercent),
        // The rule as applied, and WHICH subjects it was applied to. A
        // challenge years later is answered with what was actually checked
        // rather than with today's structure, which may have changed.
        criteriaApplied: {
          minProgressPercent: perSubject[0]!.completionCriteria.minProgressPercent,
          minAttendancePercent: perSubject[0]!.completionCriteria.minAttendancePercent,
          minAverageGradePercent: perSubject[0]!.completionCriteria.minAverageGradePercent,
          subjectCount: perSubject.length,
          subjects: perSubject.map((p) => p.subject?.name ?? p.sectionSubjectId),
        } as object,
        status: "ISSUED",
        issuedBy: actor.userId,
        verificationCode: this.newVerificationCode(),
      },
    });

    await this.audit.record({
      action: "certificate.issue.programme",
      entityType: "Certificate",
      entityId: created.id,
      after: {
        certificateNo,
        studentId,
        programmeId,
        subjectCount: perSubject.length,
        progressPercent: Number(created.progressPercent),
      },
    });

    await this.announce(studentId, certificateNo, {
      kind: "certificate.issued",
      title: `You have completed ${programme.name}`,
      subject: programme.name,
    });

    return this.document(created.id, { alreadyIssued: false });
  }

  /**
   * FR-CRT-002, the manual route — an administrator issuing by hand.
   *
   * THE DELIBERATE EXCEPTION, and the reasoning is worth keeping beside the
   * code. The earned path exists so a certificate means something; this one
   * exists because an institute certifies more than the LMS teaches. A weekend
   * workshop, a seminar, a cohort that finished before the System was
   * installed — refusing those would not make the System stricter, it would
   * make it useless for a fifth of what the office actually does, and the
   * office would go back to Word.
   *
   * WHAT KEEPS IT HONEST is not friction but the record. `issuedManually` is
   * written on the row, the audit action is its own name rather than the
   * earned one, and the type is CUSTOM unless the administrator anchored it to
   * real structure. Nobody reading a certificate later has to guess.
   *
   * ONLY THREE THINGS ARE REQUIRED: a name, a title and a kind. Everything
   * else has a good answer already, and an office issuing forty workshop
   * certificates should type forty names rather than four hundred fields.
   */
  async issueManual(input: CertificateIssueInput) {
    const actor = getActor();
    if (!actor) throw new AppError("AUTH_TOKEN_INVALID");

    // The anchors are validated BEFORE a number is allocated. A certificate
    // number is permanent and never reused, so burning one on a request that
    // was going to fail anyway leaves a visible gap in the year's series that
    // nobody can explain.
    if (input.sectionSubjectId) await this.requireSectionSubject(input.sectionSubjectId);
    if (input.programmeId) await this.requireProgramme(input.programmeId);
    if (input.studentId) await this.requireStudent(input.studentId);

    const snapshot = await this.snapshot({
      studentId: input.studentId ?? null,
      sectionSubjectId: input.sectionSubjectId ?? null,
      programmeId: input.programmeId ?? null,
      overrides: {
        studentName: input.studentName,
        registrationNo: input.registrationNo ?? null,
        rollNo: input.rollNo ?? null,
        title: input.title,
        instructorName: input.instructorName ?? null,
        instructorTitle: input.instructorTitle ?? null,
      },
    });

    const type = input.sectionSubjectId ? "SUBJECT" : input.programmeId ? "PROGRAMME" : "CUSTOM";
    const issuedAt = input.issueDate ? new Date(input.issueDate) : new Date();
    const certificateNo = await this.nextCertificateNo();

    let created;
    try {
      created = await this.prisma.scoped.certificate.create({
        data: {
          certificateNo,
          type,
          kind: input.kind,
          issuedManually: true,
          ...(input.studentId ? { studentId: input.studentId } : {}),
          ...(input.sectionSubjectId ? { sectionSubjectId: input.sectionSubjectId } : {}),
          ...(input.programmeId ? { programmeId: input.programmeId } : {}),
          ...snapshot,
          ...(input.completionDate ? { completionDate: new Date(input.completionDate) } : {}),
          ...(input.durationText ? { durationText: input.durationText } : {}),
          status: "ISSUED",
          issuedAt,
          issuedBy: actor.userId,
          verificationCode: this.newVerificationCode(),
        },
      });
    } catch (error) {
      // FR-CRT-004 — the partial unique index. Reported as a conflict with the
      // certificate that is in the way, because "unique constraint violated"
      // tells an administrator nothing they can act on.
      if ((error as { code?: string }).code === "P2002") {
        throw new AppError("RESOURCE_CONFLICT", {
          message:
            "That student already holds a valid certificate for this course. Revoke the existing one first if it needs replacing.",
        });
      }
      throw error;
    }

    // SEC-LOG-009 — its own action, never folded into `certificate.issue`. The
    // whole point of the manual route is that it is distinguishable.
    await this.audit.record({
      action: "certificate.issue.manual",
      entityType: "Certificate",
      entityId: created.id,
      after: {
        certificateNo,
        type,
        kind: input.kind,
        holder: input.studentName,
        award: input.title,
        studentId: input.studentId ?? null,
        note: input.note ?? null,
      },
    });

    if (input.studentId) {
      await this.announce(input.studentId, certificateNo, {
        kind: "certificate.issued",
        title: "A certificate has been issued to you",
        subject: input.title,
      });
    }

    return this.document(created.id, { alreadyIssued: false });
  }

  // -------------------------------------------------------- the register --

  /**
   * FR-CRT-006 — every certificate the Institute has issued.
   *
   * Read straight off the snapshot columns rather than joined out to students
   * and subjects, and that is not only a performance choice: a certificate
   * whose student has been erased still has to appear in this list, with the
   * name it was issued under. A join would silently drop exactly the rows an
   * administrator most needs to find.
   */
  async register(query: CertificateQueryInput) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = 25;

    const issuedAt: Prisma.DateTimeFilter = {};
    if (query.issuedFrom) issuedAt.gte = new Date(query.issuedFrom);
    if (query.issuedTo) {
      // Inclusive of the day somebody typed. A date filter that silently
      // excludes today is the commonest "the search is broken" report there is.
      const end = new Date(query.issuedTo);
      end.setUTCHours(23, 59, 59, 999);
      issuedAt.lte = end;
    }

    const where: Prisma.CertificateWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.kind ? { kind: query.kind } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(Object.keys(issuedAt).length > 0 ? { issuedAt } : {}),
      ...(query.q
        ? {
            OR: [
              { certificateNo: { contains: query.q, mode: "insensitive" as const } },
              { studentNameSnapshot: { contains: query.q, mode: "insensitive" as const } },
              { studentRegistrationNoSnapshot: { contains: query.q, mode: "insensitive" as const } },
              { awardTitleSnapshot: { contains: query.q, mode: "insensitive" as const } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.scoped.certificate.findMany({
        where,
        orderBy: { issuedAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.scoped.certificate.count({ where }),
    ]);

    return {
      // §9.2 names this `data`; the envelope interceptor reads that key.
      data: await Promise.all(rows.map((row: (typeof rows)[number]) => this.present(row))),
      pagination: {
        page,
        pageSize,
        totalItems: total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
        hasNext: page * pageSize < total,
        hasPrevious: page > 1,
      },
    };
  }

  /**
   * The four figures at the top of the register.
   *
   * Counted rather than derived from the current page: an administrator
   * looking at page three of a filtered list still needs to know how many
   * certificates the Institute has issued altogether.
   */
  async summary() {
    const startOfMonth = new Date();
    startOfMonth.setUTCDate(1);
    startOfMonth.setUTCHours(0, 0, 0, 0);

    const [total, valid, revoked, archived, thisMonth] = await Promise.all([
      this.prisma.scoped.certificate.count(),
      this.prisma.scoped.certificate.count({ where: { status: "ISSUED" } }),
      this.prisma.scoped.certificate.count({ where: { status: "REVOKED" } }),
      this.prisma.scoped.certificate.count({ where: { status: "ARCHIVED" } }),
      this.prisma.scoped.certificate.count({ where: { issuedAt: { gte: startOfMonth } } }),
    ]);

    return { total, valid, revoked, archived, thisMonth };
  }

  /**
   * One certificate, ready to be drawn.
   *
   * Goes through the scoped client, which is what stops a student opening a
   * classmate's: the Certificate scope policy narrows a student to their own
   * rows, so the record simply is not there. RESOURCE_NOT_FOUND rather than
   * FORBIDDEN, because at this point the two are indistinguishable and saying
   * "forbidden" would confirm the id is real (SEC-AUZ-006).
   */
  async document(id: string, meta: { alreadyIssued: boolean } = { alreadyIssued: false }) {
    const row = await this.prisma.scoped.certificate.findFirst({ where: { id } });
    if (!row) throw new AppError("RESOURCE_NOT_FOUND");
    return { ...(await this.present(row)), alreadyIssued: meta.alreadyIssued };
  }

  /**
   * Students an administrator can attach a manual certificate to.
   *
   * Its own narrow lookup rather than the user directory, because the directory
   * returns User ids and a certificate hangs off a Student. Guarded by the
   * issuing permission, and it returns a name, a number and an id — nothing a
   * certificate screen does not need.
   */
  async studentLookup(q: string) {
    const term = q.trim();
    if (term.length < 2) return [];

    const rows = await this.prisma.scoped.student.findMany({
      where: {
        deletedAt: null,
        OR: [
          { registrationNo: { contains: term, mode: "insensitive" } },
          { user: { fullName: { contains: term, mode: "insensitive" } } },
        ],
      },
      take: 20,
      orderBy: { registrationNo: "asc" },
      select: {
        id: true,
        registrationNo: true,
        currentRollNo: true,
        user: { select: { fullName: true } },
      },
    });

    return rows.map((s: (typeof rows)[number]) => ({
      id: s.id,
      name: s.user.fullName,
      registrationNo: s.registrationNo,
      rollNo: s.currentRollNo,
    }));
  }

  // ------------------------------------------------------- state changes --

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

    await this.prisma.scoped.certificate.update({
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
      before: { status: certificate.status },
      after: { status: "REVOKED", reason },
    });

    return this.document(certificateId);
  }

  /**
   * FR-CRT-012 — archived, which is not revoked.
   *
   * THE DIFFERENCE MATTERS TO THE PERSON HOLDING THE PAPER. Revoking says the
   * document should not be relied on; archiving says the Institute has taken it
   * out of circulation without disputing it — superseded by a reissue, raised
   * twice by mistake, belonging to a cohort that has been closed off. A
   * verification of an archived certificate still confirms it is genuine.
   *
   * Because it is not a judgement about the holder it carries no reason, and
   * because it frees the "one live certificate per student per course" slot it
   * is how a certificate is legitimately replaced without revoking somebody's
   * qualification to do it.
   */
  async archive(certificateId: string) {
    const actor = getActor();
    if (!actor) throw new AppError("AUTH_TOKEN_INVALID");

    const certificate = await this.prisma.scoped.certificate.findFirst({
      where: { id: certificateId },
    });
    if (!certificate) throw new AppError("RESOURCE_NOT_FOUND");

    if (certificate.status !== "ISSUED") {
      throw new AppError("RESOURCE_CONFLICT", {
        message:
          certificate.status === "REVOKED"
            ? "That certificate has been revoked. A revoked certificate is not archived as well — the revocation is the record."
            : "That certificate is already archived.",
      });
    }

    await this.prisma.scoped.certificate.update({
      where: { id: certificateId },
      data: { status: "ARCHIVED" },
    });

    await this.audit.record({
      action: "certificate.archive",
      entityType: "Certificate",
      entityId: certificateId,
      before: { status: "ISSUED" },
      after: { status: "ARCHIVED" },
    });

    return this.document(certificateId);
  }

  // ------------------------------------------------------------- reading --

  /**
   * FR-CRT-011 — is this student ready for a programme certificate, and if
   * not, what is outstanding?
   *
   * Read-only, so an administrator can see the answer before pressing anything
   * and can tell the student which subject is holding them up.
   */
  async programmeStanding(studentId: string, programmeId: string) {
    const programme = await this.prisma.scoped.programme.findFirst({
      where: { id: programmeId },
      select: { id: true, name: true },
    });
    if (!programme) throw new AppError("RESOURCE_NOT_FOUND");

    const enrolments = await this.prisma.scoped.enrolment.findMany({
      where: {
        studentId,
        status: { in: ["ACTIVE", "COMPLETED"] },
        sectionSubject: {
          isCompulsory: true,
          section: { batch: { academicSession: { programmeId } } },
        },
      },
      select: { sectionSubjectId: true },
    });

    const perSubject = await Promise.all(
      enrolments.map((e: { sectionSubjectId: string }) =>
        this.progress.forSubject(studentId, e.sectionSubjectId),
      ),
    );

    /*
     * WHAT A PERSON DECIDED, beside what the arithmetic says.
     *
     * A certificate is the most public thing this System makes — framed,
     * photographed, shown to employers for years — and issuing one because a
     * threshold was crossed is a decision nobody made. So a subject counts as
     * complete when SOMEBODY SIGNED IT OFF, and the computed criteria are kept
     * beside it as the evidence they were looking at.
     *
     * That is a deliberate tightening. Before this, meeting the criteria was
     * enough on its own; now a teacher has to say so. The office can see, per
     * subject, whether the hold-up is the student's work or a signature.
     */
    const signOffs = await this.prisma.asSystem((db) =>
      db.subjectCompletion.findMany({
        where: {
          studentId,
          sectionSubjectId: { in: enrolments.map((e: { sectionSubjectId: string }) => e.sectionSubjectId) },
        },
        select: { sectionSubjectId: true, decision: true, decidedAt: true },
      }),
    );
    const signedOff = new Map(signOffs.map((d) => [d.sectionSubjectId, d]));
    const isSignedOff = (id: string) => signedOff.get(id)?.decision === "COMPLETED";

    const complete = perSubject.filter((p) => isSignedOff(p.sectionSubjectId));
    const issued = await this.prisma.scoped.certificate.findFirst({
      where: { studentId, programmeId, status: "ISSUED" },
      select: { certificateNo: true, issuedAt: true },
    });

    return {
      programme: { id: programme.id, name: programme.name },
      subjectCount: perSubject.length,
      completedCount: complete.length,
      // Never true for a student with no subjects — see issueForProgramme.
      eligible: perSubject.length > 0 && complete.length === perSubject.length,
      alreadyIssued: issued,
      subjects: perSubject.map((p) => ({
        sectionSubjectId: p.sectionSubjectId,
        subject: p.subject?.name ?? "",
        overallPercent: p.overallPercent,
        // What the arithmetic says — evidence, not the decision.
        met: p.completionCriteria.met,
        outstanding: p.completionCriteria.outstanding,
        // What a person decided. `null` means nobody has looked yet, which is
        // a different thing from somebody deciding they have not finished.
        signedOff: signedOff.get(p.sectionSubjectId)?.decision ?? null,
        signedOffAt: signedOff.get(p.sectionSubjectId)?.decidedAt ?? null,
      })),
      /*
       * The message distinguishes the two reasons a student is not ready,
       * because they need different people to act. Work still outstanding is
       * the student's; a subject awaiting a signature is the teacher's, and an
       * office chasing the student for it would be chasing the wrong person.
       */
      message: (() => {
        if (perSubject.length === 0) {
          return `This student has no compulsory subjects in ${programme.name}.`;
        }
        if (complete.length === perSubject.length) {
          return `All ${perSubject.length} subjects signed off as complete.`;
        }
        const awaitingSignature = perSubject.filter(
          (p) => p.completionCriteria.met && !isSignedOff(p.sectionSubjectId),
        ).length;
        const base = `${complete.length} of ${perSubject.length} subjects signed off.`;
        return awaitingSignature > 0
          ? `${base} ${awaitingSignature} ${awaitingSignature === 1 ? "meets" : "meet"} the ` +
            `requirements and ${awaitingSignature === 1 ? "is" : "are"} waiting for a teacher to sign off.`
          : base;
      })(),
    };
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
  /**
   * ISSUE TO THE WHOLE BATCH AT ONCE — FR-CRT.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * At the end of a term the office issues thirty certificates, and doing it a
   * student at a time meant thirty presses on thirty rows and no way to tell,
   * afterwards, whether one had been missed. That is not a small inconvenience:
   * the student who gets missed is the one who does not know to ask.
   *
   * `everyone` is the office's authority to issue regardless of the arithmetic,
   * and it is the whole point of the request this was built for. With it off,
   * students who have not met the requirements are SKIPPED rather than failing
   * the run — one unfinished student must not stop the other twenty-nine.
   *
   * IT NEVER SILENTLY DOES NOTHING. Every student comes back with an outcome
   * and a reason: issued, issued over the requirements, already had one, or
   * skipped and why. A bulk action whose result is a number is a bulk action
   * nobody can check.
   *
   * Sequential, not parallel. Certificate numbers are allocated from a counter
   * and thirty concurrent allocations is how two students end up sharing one.
   * ───────────────────────────────────────────────────────────────────────────
   */
  async issueForWholeClass(
    sectionSubjectId: string,
    options: { everyone?: boolean; reason?: string; signatoryIds?: readonly string[] } = {},
  ) {
    const cohort = await this.progress.forSectionSubject(sectionSubjectId);

    const results: Array<{
      studentId: string;
      name: string;
      outcome: "ISSUED" | "ISSUED_OVER_REQUIREMENTS" | "ALREADY_HELD" | "SKIPPED";
      certificateNo?: string;
      message?: string;
    }> = [];

    for (const student of cohort.students) {
      const met = student.completionMet;
      if (!met && !options.everyone) {
        results.push({
          studentId: student.studentId,
          name: student.name,
          outcome: "SKIPPED",
          message:
            "Has not met the requirements. Choose to issue to everyone if you mean to " +
            "override that.",
        });
        continue;
      }

      try {
        const doc = await this.issueForSubject(student.studentId, sectionSubjectId, {
          override: options.everyone === true,
          reason: options.reason,
          // The same panel for the whole batch: nobody chooses signatories
          // thirty times, and thirty certificates from one ceremony that
          // disagree about who signed them would be a mess to explain.
          signatoryIds: options.signatoryIds,
        });
        const already = (doc as { alreadyIssued?: boolean }).alreadyIssued === true;
        results.push({
          studentId: student.studentId,
          name: student.name,
          outcome: already ? "ALREADY_HELD" : met ? "ISSUED" : "ISSUED_OVER_REQUIREMENTS",
          certificateNo: (doc as { certificateNo?: string }).certificateNo,
        });
      } catch (e) {
        // One student's problem is not the batch's. It is reported on their
        // own row and the run carries on.
        results.push({
          studentId: student.studentId,
          name: student.name,
          outcome: "SKIPPED",
          message: e instanceof AppError ? e.message : "Could not be issued.",
        });
      }
    }

    const count = (o: string) => results.filter((r) => r.outcome === o).length;
    const summary = {
      considered: results.length,
      issued: count("ISSUED"),
      issuedOverRequirements: count("ISSUED_OVER_REQUIREMENTS"),
      alreadyHeld: count("ALREADY_HELD"),
      skipped: count("SKIPPED"),
    };

    await this.audit.record({
      action: "certificate.issue.batch",
      entityType: "SectionSubject",
      entityId: sectionSubjectId,
      after: { ...summary, everyone: options.everyone === true, reason: options.reason ?? null },
    });
    this.logger.log(
      `batch issue on ${sectionSubjectId}: ${summary.issued} issued, ` +
        `${summary.issuedOverRequirements} over requirements, ${summary.skipped} skipped`,
    );

    return { sectionSubjectId, summary, students: results };
  }

  async issuanceView(sectionSubjectId: string) {
    const cohort = await this.progress.forSectionSubject(sectionSubjectId);

    const certificates = await this.prisma.scoped.certificate.findMany({
      where: { sectionSubjectId },
      orderBy: { issuedAt: "desc" },
    });

    // Latest first, so a revoked certificate does not mask a live reissue.
    const byStudent = new Map<string, (typeof certificates)[number]>();
    for (const c of certificates) {
      if (!c.studentId) continue; // an erased holder has no row to line up with
      const held = byStudent.get(c.studentId);
      if (!held || (held.status !== "ISSUED" && c.status === "ISSUED")) {
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
    });

    return Promise.all(rows.map((row: (typeof rows)[number]) => this.present(row)));
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
   * Returned: what is ALREADY PRINTED ON THE PAPER the caller is holding — the
   * holder's name, what it was for, who taught it, which institute issued it,
   * when, and whether it still stands. NOT returned: marks, attendance,
   * contact details, registration number, or any identifier usable elsewhere.
   *
   * IT ACCEPTS EITHER IDENTIFIER, and the two are not equally private. The
   * verification code is 32 random bytes and is what the QR code carries, so a
   * link is unguessable. The certificate NUMBER is sequential and is accepted
   * as well, because somebody holding paper and no phone must be able to type
   * something in — the endpoint is rate-limited for exactly that reason
   * (SEC-RTL-004), and everything it discloses is already on the document in
   * front of them.
   */
  async verify(code: string) {
    const trimmed = code.trim();

    const certificate = await this.prisma.asSystem((db) =>
      db.certificate.findFirst({
        where: {
          OR: [
            { verificationCode: trimmed },
            // Case-insensitive, because a certificate number read off paper is
            // typed however the person typing it feels about capitals.
            { certificateNo: { equals: trimmed, mode: "insensitive" } },
          ],
        },
        select: {
          certificateNo: true,
          type: true,
          kind: true,
          status: true,
          issuedAt: true,
          completionDate: true,
          revokedAt: true,
          studentNameSnapshot: true,
          awardTitleSnapshot: true,
          programmeNameSnapshot: true,
          instructorNameSnapshot: true,
          instituteNameSnapshot: true,
        },
      }),
    );

    if (!certificate) {
      return { found: false as const, message: "No certificate matches that code." };
    }

    return {
      found: true as const,
      certificateNo: certificate.certificateNo,
      holderName: certificate.studentNameSnapshot,
      awardedFor: certificate.awardTitleSnapshot,
      programme: certificate.programmeNameSnapshot,
      instructorName: certificate.instructorNameSnapshot,
      instituteName: certificate.instituteNameSnapshot,
      type: certificate.type,
      kind: certificate.kind,
      kindLabel: CERTIFICATE_KIND_COPY[certificate.kind as CertificateKind].label,
      status: certificate.status,
      issuedAt: certificate.issuedAt,
      completionDate: certificate.completionDate,
      // Stated plainly. An employer checking a revoked certificate must be
      // told, not left to infer it from a missing field. An ARCHIVED one is
      // still genuine, which is the whole reason the two are different states.
      valid: certificate.status !== "REVOKED",
      archived: certificate.status === "ARCHIVED",
      revokedAt: certificate.revokedAt,
    };
  }

  // ------------------------------------------------------------ internals --

  /**
   * Everything the document will say, copied onto the row.
   *
   * THIS FUNCTION IS THE PERMANENCE. Every field it gathers is one the printed
   * certificate depends on and one that can legitimately change afterwards; a
   * field read at render time instead is a field that will one day make two
   * copies of the same certificate disagree.
   */
  private async snapshot(input: {
    studentId?: string | null;
    sectionSubjectId?: string | null;
    programmeId?: string | null;
    overrides?: {
      studentName?: string;
      registrationNo?: string | null;
      rollNo?: number | null;
      title?: string;
      instructorName?: string | null;
      instructorTitle?: string | null;
    };
  }) {
    const overrides = input.overrides ?? {};

    // The Institute, as it names itself today.
    const [instituteName, signatoryName, signatoryTitle, defaultInstructorTitle] =
      await Promise.all([
        this.settings.text("institute.name"),
        this.settings.text("certificate.signatoryName"),
        this.settings.text("certificate.signatoryTitle"),
        this.settings.text("certificate.instructorTitle"),
      ]);

    let studentName = overrides.studentName ?? "";
    let registrationNo = overrides.registrationNo ?? null;
    let rollNo = overrides.rollNo ?? null;

    if (input.studentId) {
      const student = await this.prisma.asSystem((db) =>
        db.student.findUnique({
          where: { id: input.studentId! },
          select: {
            registrationNo: true,
            currentRollNo: true,
            user: { select: { fullName: true } },
          },
        }),
      );
      if (student) {
        // The record wins over a typed name when both exist: an administrator
        // who picked a student meant that student, and a stale name in the box
        // would print somebody else's spelling.
        studentName = student.user.fullName;
        registrationNo = registrationNo ?? student.registrationNo;
        rollNo = rollNo ?? student.currentRollNo;
      }
    }

    let title = overrides.title ?? "";
    let awardCode: string | null = null;
    let programmeName: string | null = null;
    let instructorName = overrides.instructorName ?? null;
    const instructorTitle = overrides.instructorTitle ?? null;

    if (input.sectionSubjectId) {
      const offering = await this.prisma.asSystem((db) =>
        db.sectionSubject.findUnique({
          where: { id: input.sectionSubjectId! },
          select: {
            subject: { select: { name: true, code: true } },
            section: {
              select: {
                batch: {
                  select: {
                    academicSession: { select: { programme: { select: { name: true } } } },
                  },
                },
              },
            },
            assignments: {
              // PRIMARY only, earliest first: a class that once had a
              // substitute must not credit the wrong person on the paper.
              where: { deletedAt: null, assignmentRole: "PRIMARY" },
              orderBy: { startDate: "asc" },
              take: 1,
              select: { teacher: { select: { user: { select: { fullName: true } } } } },
            },
          },
        }),
      );

      if (offering) {
        title = overrides.title || offering.subject.name;
        awardCode = offering.subject.code;
        programmeName = offering.section.batch.academicSession.programme.name;
        instructorName =
          instructorName ?? offering.assignments[0]?.teacher.user.fullName ?? null;
      }
    } else if (input.programmeId) {
      const programme = await this.prisma.asSystem((db) =>
        db.programme.findUnique({
          where: { id: input.programmeId! },
          select: { name: true, code: true, durationWeeks: true },
        }),
      );
      if (programme) {
        title = overrides.title || programme.name;
        awardCode = programme.code;
      }
    }

    return {
      studentNameSnapshot: studentName || "Unnamed",
      studentRegistrationNoSnapshot: registrationNo,
      studentRollNoSnapshot: rollNo,
      awardTitleSnapshot: title || "Course",
      awardCodeSnapshot: awardCode,
      programmeNameSnapshot: programmeName,
      instructorNameSnapshot: instructorName,
      // Only when there is a name to sit above it. A designation floating over
      // a blank signature line is worse than no block at all.
      instructorTitleSnapshot: instructorName
        ? (instructorTitle || defaultInstructorTitle || null)
        : null,
      instituteNameSnapshot: instituteName || "The Institute",
      signatoryNameSnapshot: signatoryName || null,
      signatoryTitleSnapshot: signatoryName ? signatoryTitle || null : null,
    };
  }

  /** A stored row, as the thing that gets drawn. */
  private async present(c: {
    id: string;
    certificateNo: string;
    type: string;
    kind: string;
    status: string;
    issuedAt: Date;
    completionDate: Date | null;
    durationText: string | null;
    studentId: string | null;
    studentNameSnapshot: string;
    studentRegistrationNoSnapshot: string | null;
    studentRollNoSnapshot: number | null;
    awardTitleSnapshot: string;
    awardCodeSnapshot: string | null;
    programmeNameSnapshot: string | null;
    instructorNameSnapshot: string | null;
    instructorTitleSnapshot: string | null;
    instituteNameSnapshot: string;
    signatoryNameSnapshot: string | null;
    signatoryTitleSnapshot: string | null;
    /** A JSON column, so `unknown` — read through `signatoriesOf` below. */
    signatoriesSnapshot?: unknown;
    progressPercent: unknown;
    attendancePercent: unknown;
    averageGradePercent: unknown;
    verificationCode: string;
    revokedAt: Date | null;
    revocationReason: string | null;
    issuedManually: boolean;
  }): Promise<CertificateDocument> {
    // The two branding lines that are NOT snapshotted, and deliberately so:
    // a tagline and a web address are how to reach the Institute today, not a
    // claim about the holder. A moved website should be right on a reprint.
    const [tagline, website] = await Promise.all([
      this.settings.text("certificate.tagline"),
      this.settings.text("certificate.website"),
    ]);

    const decimal = (value: unknown): number | null =>
      value === null || value === undefined ? null : Number(value);

    /*
     * WHO SIGNED IT — and what to print when nobody recorded that.
     *
     * A certificate issued AFTER the Institute had a signatory library carries
     * its own panel, and that panel is used exactly as stored: renaming
     * somebody must never rewrite a document they signed last year.
     *
     * A certificate issued BEFORE it existed has no panel at all, and there is
     * therefore no history to protect. Printing the Institute's CURRENT
     * signatories is the best answer available for those — the alternative,
     * which is what this did at first, was to leave every certificate ever
     * issued showing a settings key and whoever happened to teach the subject,
     * so that setting up three signatories appeared to do nothing.
     *
     * The distinction is `null` versus an array. A stored EMPTY array means
     * "issued with nobody signing", which is a decision and is honoured.
     */
    const stored = c.signatoriesSnapshot;
    const panel =
      stored === null || stored === undefined
        ? await this.signatories.panelFor(null).catch(() => [])
        : signatoriesOf(stored);

    return {
      id: c.id,
      certificateNo: c.certificateNo,
      type: c.type as CertificateDocument["type"],
      kind: c.kind as CertificateDocument["kind"],
      status: c.status as CertificateDocument["status"],
      issuedAt: c.issuedAt.toISOString(),
      completionDate: c.completionDate ? c.completionDate.toISOString() : null,
      durationText: c.durationText,
      student: {
        id: c.studentId,
        name: c.studentNameSnapshot,
        registrationNo: c.studentRegistrationNoSnapshot,
        rollNo: c.studentRollNoSnapshot,
      },
      award: {
        title: c.awardTitleSnapshot,
        programme: c.programmeNameSnapshot,
        code: c.awardCodeSnapshot,
      },
      instructor: c.instructorNameSnapshot
        ? {
            name: c.instructorNameSnapshot,
            title: c.instructorTitleSnapshot ?? "Course Instructor",
          }
        : null,
      institute: {
        name: c.instituteNameSnapshot,
        tagline,
        website,
        signatoryName: c.signatoryNameSnapshot ?? "",
        signatoryTitle: c.signatoryTitleSnapshot ?? "",
      },
      /*
       * The panel as it was signed. The asset id becomes a URL here rather
       * than in the renderer, because the renderer should not have to know how
       * this System addresses its media — and the route it points at is the
       * PUBLIC one, since a certificate is shown to employers who have no
       * account and could not fetch an authenticated image.
       */
      signatories: panel.map((sig) => ({
        name: sig.name,
        designation: sig.designation,
        signatureUrl: sig.signatureAssetId
          ? `/api/v1/public/course-media/${sig.signatureAssetId}`
          : null,
      })),
      verification: {
        code: c.verificationCode,
        url: this.verificationUrl(c.verificationCode),
      },
      standing:
        c.progressPercent === null || c.progressPercent === undefined
          ? null
          : {
              progressPercent: Number(c.progressPercent),
              attendancePercent: decimal(c.attendancePercent),
              averageGradePercent: decimal(c.averageGradePercent),
            },
      revokedAt: c.revokedAt ? c.revokedAt.toISOString() : null,
      revocationReason: c.revocationReason,
      issuedManually: c.issuedManually,
    };
  }

  /**
   * The address printed on the certificate and encoded in the QR code.
   *
   * ABSOLUTE, AND BUILT ON THE SERVER. The client knows its own origin, but a
   * certificate is rendered in one place and read in another — a phone camera
   * pointed at a sheet of paper has no origin at all — so the URL has to be
   * the one the Institute is actually reachable at.
   *
   * PUBLIC_WEB_URL first, then WEB_ORIGIN, then localhost, which is the same
   * chain the credentials mailer uses and for the same reason: PUBLIC_WEB_URL
   * is set by docker-compose and by nothing else, and a QR code pointing at
   * `localhost` is a QR code that means "this reader's own computer".
   */
  private verificationUrl(code: string): string {
    const configured =
      (this.config.get<string>("PUBLIC_WEB_URL", "") ?? "").trim() ||
      ((this.config.get<string>("WEB_ORIGIN", "") ?? "").split(",")[0] ?? "").trim();
    const base = (configured || "http://localhost:5173").replace(/\/+$/, "");
    return `${base}/verify/certificate/${code}`;
  }

  /**
   * The next number in the year's series — CERT-2026-000001.
   *
   * Reuses RegistrationNumberService.allocateSequence rather than writing a
   * second counter: two administrators issuing at the same moment must not
   * receive the same number, that is RSK-07, and the atomic
   * INSERT ... ON CONFLICT DO UPDATE ... RETURNING there already solves it and
   * is already tested. A certificate number is printed, permanent and public,
   * so it has exactly the same requirement as a registration number.
   *
   * HYPHENS RATHER THAN SLASHES. The number now appears in a URL — an employer
   * types it into the verification page — and a slash inside a path segment is
   * a fight with every proxy between here and them. Numbers already issued in
   * the old CERT/2026/00001 form keep it and still verify, because verification
   * matches the stored string rather than re-deriving it.
   */
  private async nextCertificateNo(): Promise<string> {
    const prefix = this.config.get<string>("CERTIFICATE_PREFIX", "CERT");
    const year = new Date().getFullYear();

    return this.prisma.asSystem((db) =>
      db.$transaction(async (tx) => {
        const sequence = await this.numbers.allocateSequence(tx, `certificate:${year}`);
        return `${prefix}-${year}-${String(sequence).padStart(6, "0")}`;
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

  /**
   * DEP-04 — earning a qualification is the one notification a student would be
   * sorry to miss, so it is URGENT: it reaches them past quiet hours.
   */
  private async announce(
    studentId: string,
    certificateNo: string,
    what: { kind: string; title: string; subject: string | null },
  ): Promise<void> {
    const student = await this.prisma.asSystem((db) =>
      db.student.findUnique({ where: { id: studentId }, select: { userId: true } }),
    );
    if (!student) return;

    // The Institute's own wording if it has set any, and the System's
    // otherwise (FR-NOT-020). The fallback is the literal that used to be
    // here, so a kind the catalogue has not adopted still sends what it
    // always sent rather than nothing.
    const worded = await this.templates.renderFor(what.kind, {
      certificateNo,
      subject: what.subject,
    });

    await this.notifications.notify({
      recipientUserIds: [student.userId],
      kind: what.kind,
      title: worded?.title || what.title,
      body:
        worded?.body ||
        `Certificate ${certificateNo} is now available, with a link you can give to an employer.`,
      linkPath: "/my-certificates",
      isUrgent: true,
    });
  }

  private async requireStudent(studentId: string): Promise<void> {
    const found = await this.prisma.scoped.student.findFirst({
      where: { id: studentId, deletedAt: null },
      select: { id: true },
    });
    if (!found) {
      throw new AppError("VALIDATION_FAILED", {
        message: "That student could not be found.",
        details: [{ field: "studentId", code: "NOT_FOUND", message: "No such student." }],
      });
    }
  }

  private async requireSectionSubject(sectionSubjectId: string): Promise<void> {
    const found = await this.prisma.scoped.sectionSubject.findFirst({
      where: { id: sectionSubjectId, deletedAt: null },
      select: { id: true },
    });
    if (!found) {
      throw new AppError("VALIDATION_FAILED", {
        message: "That subject could not be found.",
        details: [
          { field: "sectionSubjectId", code: "NOT_FOUND", message: "No such subject on that batch." },
        ],
      });
    }
  }

  private async requireProgramme(programmeId: string): Promise<void> {
    const found = await this.prisma.scoped.programme.findFirst({
      where: { id: programmeId, deletedAt: null },
      select: { id: true },
    });
    if (!found) {
      throw new AppError("VALIDATION_FAILED", {
        message: "That course could not be found.",
        details: [{ field: "programmeId", code: "NOT_FOUND", message: "No such course." }],
      });
    }
  }
}

/**
 * The stored panel, read defensively.
 *
 * It is a JSON column, so what comes back is whatever was written — including
 * from a version of this code that no longer exists. A certificate whose panel
 * cannot be read should print without one rather than fail to render at all:
 * the name, the course and the number are the parts that matter, and a
 * document nobody can open is worse than one missing a signature.
 */
function signatoriesOf(value: unknown): SignatorySnapshot[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const e = entry as Record<string, unknown>;
    if (typeof e.name !== "string" || typeof e.designation !== "string") return [];
    return [
      {
        name: e.name,
        designation: e.designation,
        signatureAssetId: typeof e.signatureAssetId === "string" ? e.signatureAssetId : null,
      },
    ];
  });
}
