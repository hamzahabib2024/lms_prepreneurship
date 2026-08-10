import { Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { AppError } from "@lms/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { getActor } from "../prisma/actor-context";
import { erasurePlan, refuseErasure, visibilityFor } from "./erasure-policy";

/**
 * Personal data — SRS §5.22, SEC-PRV-001..010.
 *
 * Export and erasure, both of which read as one operation and are really two.
 *
 * EXPORT depends on who is asking, and erasure-policy.visibilityFor() decides.
 * A student exporting their own record must not receive marks their teacher has
 * not released, or BR-ASG-09 is defeated by anybody who presses "export".
 *
 * ERASURE ANONYMISES rather than deletes, because the audit log is append-only
 * by database trigger, certificates must stay verifiable, and BR-DAT-02 retains
 * academic and financial records. Every field that identifies a person is
 * destroyed; the rows that would become incoherent without them are kept
 * without identity. Afterwards the audit log still says user 7f3a… did things
 * and nothing says who 7f3a… was.
 *
 * BOTH ARE AUDITED AS A MATTER OF COURSE. SEC-PRV-007 treats bulk extraction of
 * personal data as a distinct privacy risk from reading it on screen, and an
 * export is exactly that.
 */
@Injectable()
export class PersonalDataService {
  private readonly logger = new Logger(PersonalDataService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * FR-PRV-001 — everything the Institute holds about one person.
   *
   * Read under asSystem and then projected, rather than through the scoped
   * client. A student's own scope would return their own rows anyway, but an
   * administrator answering a request for somebody else needs the same code
   * path, and two paths would drift.
   */
  async export(userId: string) {
    const actor = getActor();
    if (!actor) throw new AppError("AUTH_TOKEN_INVALID");

    const isSubject = actor.userId === userId;
    // A student may export only their own. The matrix grants them OWN scope;
    // this is where that becomes a refusal rather than a filter, because
    // returning somebody else's export filtered to nothing would be a 200 with
    // an empty file and no explanation (SEC-AUZ-006).
    if (!isSubject && actor.roles.includes("student")) {
      throw new AppError("AUTH_FORBIDDEN", {
        message: "You can export your own record only.",
      });
    }

    const visibility = visibilityFor(isSubject);

    const user = await this.prisma.asSystem((db) =>
      db.user.findFirst({
        where: { id: userId },
        select: {
          id: true,
          fullName: true,
          email: true,
          phone: true,
          status: true,
          createdAt: true,
          student: {
            select: {
              id: true,
              registrationNo: true,
              nationalId: true,
              dateOfBirth: true,
              gender: true,
              guardianName: true,
              guardianPhone: true,
              admissionDate: true,
              outstandingBalance: true,
            },
          },
        },
      }),
    );
    if (!user) throw new AppError("RESOURCE_NOT_FOUND");

    const studentId = user.student?.id;

    const [enrolments, attendance, submissions, quizAttempts, certificates, payments, notifications] =
      await Promise.all([
        studentId
          ? this.prisma.asSystem((db) =>
              db.enrolment.findMany({
                where: { studentId },
                select: {
                  status: true,
                  enrolledAt: true,
                  sectionSubject: {
                    select: {
                      subject: { select: { code: true, name: true } },
                      section: { select: { code: true } },
                    },
                  },
                },
              }),
            )
          : [],
        studentId
          ? this.prisma.asSystem((db) =>
              db.attendanceRecord.findMany({
                where: { studentId },
                select: {
                  status: true,
                  markedAt: true,
                  markingSource: true,
                  liveSession: { select: { title: true, scheduledStart: true } },
                },
                orderBy: { markedAt: "desc" },
              }),
            )
          : [],
        studentId
          ? this.prisma.asSystem((db) =>
              db.assignmentSubmission.findMany({
                where: { studentId, isLatest: true },
                select: {
                  submittedAt: true,
                  isLate: true,
                  assignment: { select: { title: true, marksAvailable: true } },
                  grade: {
                    select: {
                      finalMarks: true,
                      feedback: true,
                      releasedAt: true,
                      // internalNotes is not selected AT ALL. §4.7 — a marker's
                      // private notes are not the student's data to receive,
                      // and an administrator answering a request is not a route
                      // around that either.
                    },
                  },
                },
              }),
            )
          : [],
        studentId
          ? this.prisma.asSystem((db) =>
              db.quizAttempt.findMany({
                where: { studentId },
                select: {
                  attemptNumber: true,
                  submittedAt: true,
                  finalScore: true,
                  isPassed: true,
                  releasedAt: true,
                  quiz: { select: { title: true, totalMarks: true } },
                },
              }),
            )
          : [],
        studentId
          ? this.prisma.asSystem((db) =>
              db.certificate.findMany({
                where: { studentId },
                select: {
                  certificateNo: true,
                  type: true,
                  issuedAt: true,
                  status: true,
                  verificationCode: true,
                },
              }),
            )
          : [],
        studentId
          ? this.prisma.asSystem((db) =>
              db.payment.findMany({
                where: { studentId },
                select: {
                  verifiedAmount: true,
                  currency: true,
                  paymentDate: true,
                  method: true,
                  isReversed: true,
                },
              }),
            )
          : [],
        this.prisma.asSystem((db) =>
          db.notification.findMany({
            where: { recipientId: userId },
            select: { kind: true, title: true, body: true, createdAt: true, readAt: true },
            orderBy: { createdAt: "desc" },
            take: 500,
          }),
        ),
      ]);

    // SEC-PRV-007 — bulk extraction is a distinct risk from reading on screen,
    // so it is recorded with who, whose, and how much.
    await this.audit.record({
      action: "personal_data.export",
      entityType: "User",
      entityId: userId,
      after: {
        bySubject: isSubject,
        counts: {
          enrolments: enrolments.length,
          attendance: attendance.length,
          submissions: submissions.length,
          certificates: certificates.length,
          payments: payments.length,
        },
      },
    });

    return {
      generatedAt: new Date(),
      about: { userId, isYourOwnRecord: isSubject },
      note: visibility.note,
      account: {
        fullName: user.fullName,
        email: user.email,
        phone: user.phone,
        status: user.status,
        joined: user.createdAt,
      },
      student: user.student
        ? {
            registrationNumber: user.student.registrationNo,
            identityNumber: user.student.nationalId,
            dateOfBirth: user.student.dateOfBirth,
            gender: user.student.gender,
            guardianName: user.student.guardianName,
            guardianPhone: user.student.guardianPhone,
            admissionDate: user.student.admissionDate,
            outstandingBalance: Number(user.student.outstandingBalance),
          }
        : null,
      enrolments,
      attendance,
      coursework: submissions.map((s: (typeof submissions)[number]) => ({
        assignment: s.assignment.title,
        outOf: Number(s.assignment.marksAvailable),
        submittedAt: s.submittedAt,
        wasLate: s.isLate,
        // BR-ASG-09 — the release check is explicit, and what a student sees
        // here is exactly what they would see on the screen.
        mark:
          s.grade && (s.grade.releasedAt || visibility.includeUnreleasedGrades)
            ? {
                marks: Number(s.grade.finalMarks),
                feedback: s.grade.feedback,
                released: s.grade.releasedAt != null,
              }
            : s.grade
              ? { status: "still being marked" }
              : null,
      })),
      quizzes: quizAttempts.map((a: (typeof quizAttempts)[number]) => ({
        quiz: a.quiz.title,
        outOf: Number(a.quiz.totalMarks),
        attempt: a.attemptNumber,
        submittedAt: a.submittedAt,
        score:
          a.releasedAt || visibility.includeUnreleasedGrades
            ? a.finalScore != null
              ? Number(a.finalScore)
              : null
            : null,
        passed: a.releasedAt || visibility.includeUnreleasedGrades ? a.isPassed : null,
      })),
      certificates,
      payments: payments.map((p: (typeof payments)[number]) => ({
        amount: Number(p.verifiedAmount),
        currency: p.currency,
        paidOn: p.paymentDate,
        method: p.method,
        // A reversal is part of somebody's financial record and omitting it
        // would make the export disagree with the receipt they hold.
        reversed: p.isReversed,
      })),
      notifications,
    };
  }

  /** FR-PRV-008 — what erasure would do, before anybody presses it. */
  async plan(userId: string) {
    const subject = await this.subjectFor(userId);
    const refusal = refuseErasure(subject, getActor()?.userId ?? "");

    return {
      userId,
      canErase: refusal === null,
      ...(refusal ? { refusal: refusal.message, refusalCode: refusal.code } : {}),
      // Shown whether or not it can proceed, because the person deciding needs
      // to know what they are asking for either way.
      plan: erasurePlan(),
      warning:
        "This cannot be undone, and it is not a delete. Identifying details are destroyed; " +
        "records that would otherwise stop making sense are kept without a name attached.",
    };
  }

  /**
   * FR-PRV-009 — erase.
   *
   * Super Admin with step-up, which the permission guard enforces (§4.5) and
   * which only began working once step-up itself was fixed.
   */
  async erase(userId: string, reason: string) {
    const actor = getActor();
    if (!actor) throw new AppError("AUTH_TOKEN_INVALID");

    if (reason.trim().length < 10) {
      throw new AppError("VALIDATION_FAILED", {
        details: [
          {
            field: "reason",
            code: "REASON_TOO_SHORT",
            message: "Record why this person's data is being erased. It cannot be undone.",
          },
        ],
      });
    }

    const subject = await this.subjectFor(userId);
    const refusal = refuseErasure(subject, actor.userId);
    if (refusal) {
      throw new AppError("RESOURCE_CONFLICT", {
        message: refusal.message,
        details: [{ field: "userId", code: refusal.code, message: refusal.message }],
      });
    }

    // A stable, meaningless label. Not the user id — that is in the audit log
    // and reversing it must not be as easy as reading a name field.
    const tombstone = `erased-${randomUUID().slice(0, 8)}`;

    const result = await this.prisma.asSystem((db) =>
      db.$transaction(async (tx) => {
        const student = await tx.student.findFirst({
          where: { userId },
          select: { id: true },
        });

        // -- the account itself -------------------------------------------
        await tx.user.update({
          where: { id: userId },
          data: {
            fullName: "Erased",
            // Unique columns need a unique value, not an empty one, or the
            // second erasure collides with the first.
            email: `${tombstone}@erased.invalid`,
            phone: null,
            photoUrl: null,
            status: "SUSPENDED",
            deletedAt: new Date(),
            // The password is replaced with something nobody holds, rather
            // than left: an erased account must not be signable-into.
            passwordHash: `erased:${randomUUID()}`,
            mfaSecret: null,
            mfaRecoveryCodes: [],
          },
        });

        await tx.userSession.deleteMany({ where: { userId } });
        await tx.notification.deleteMany({ where: { recipientId: userId } });
        await tx.notificationPreference.deleteMany({ where: { userId } });

        let anonymised = { attendance: 0, submissions: 0, payments: 0 };

        if (student) {
          // -- the student record ------------------------------------------
          //
          // registrationNo is KEPT. It is printed on certificates and is how a
          // qualification is checked years later; destroying it would break
          // verification for a document already in somebody's hand.
          await tx.student.update({
            where: { id: student.id },
            data: {
              nationalId: `${tombstone}`,
              guardianName: null,
              guardianPhone: null,
            },
          });

          await tx.registrationDocument.deleteMany({
            where: { registrationRequest: { createdStudentId: student.id } },
          });
          // phone, nationalId and address are NOT NULL, so they are overwritten
          // rather than nulled — an empty string is still a destroyed value.
          await tx.registrationRequest.updateMany({
            where: { createdStudentId: student.id },
            data: {
              fullName: "Erased",
              email: `${tombstone}@erased.invalid`,
              phone: "",
              nationalId: tombstone,
              address: "",
            },
          });

          // Submitted files are destroyed; the marks stay, without a name.
          await tx.submissionFile.deleteMany({ where: { studentId: student.id } });

          // A Payment carries no name of its own: the payer is the student it
          // points at, and the uploaded slip lives on RegistrationDocument,
          // deleted above. Nothing to strip, so the count is what is retained.
          const p = { count: await tx.payment.count({ where: { studentId: student.id } }) };
          anonymised = {
            attendance: await tx.attendanceRecord.count({ where: { studentId: student.id } }),
            submissions: await tx.assignmentSubmission.count({ where: { studentId: student.id } }),
            payments: p.count,
          };
        }

        // Security events keep the fact, lose the address (they are evidence
        // about attacks on the Institute rather than about this person).
        await tx.securityEvent.updateMany({
          where: { userId },
          data: { ipAddress: null, userAgent: null, email: null },
        });

        return anonymised;
      }),
    );

    // The audit entry is written AFTER, and deliberately still names the user
    // id. The log is append-only; this row is the record that the erasure
    // happened and who decided it, and it is the only place that remains.
    await this.audit.record({
      action: "personal_data.erase",
      entityType: "User",
      entityId: userId,
      after: {
        tombstone,
        reason: reason.trim(),
        anonymised: result,
      },
    });

    this.logger.warn(`PERSONAL DATA ERASED: ${userId} by ${actor.userId}. Reason: ${reason.trim()}`);

    return {
      userId,
      erased: true,
      tombstone,
      anonymised: result,
      message:
        "Identifying details have been destroyed. Academic and financial records remain without " +
        "a name attached, certificates stay verifiable, and the audit log is unchanged — it now " +
        "refers to an identifier that corresponds to nobody.",
    };
  }

  private async subjectFor(userId: string) {
    const user = await this.prisma.asSystem((db) =>
      db.user.findFirst({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          roles: { select: { role: { select: { key: true } } } },
          student: { select: { id: true, outstandingBalance: true } },
        },
      }),
    );
    if (!user) throw new AppError("RESOURCE_NOT_FOUND");

    const activeEnrolments = user.student
      ? await this.prisma.asSystem((db) =>
          db.enrolment.count({ where: { studentId: user.student!.id, status: "ACTIVE" } }),
        )
      : 0;

    return {
      userId: user.id,
      roles: user.roles.map((r: (typeof user.roles)[number]) => r.role.key),
      activeEnrolments,
      outstandingBalance: Number(user.student?.outstandingBalance ?? 0),
      alreadyErased: user.email.endsWith("@erased.invalid"),
    };
  }
}
