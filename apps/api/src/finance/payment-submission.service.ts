import { Injectable, Logger } from "@nestjs/common";
import {
  AppError,
  PAYMENT_METHOD_LABELS,
  type PaymentMethodValue,
  type PaymentRejectInput,
  type PaymentSubmissionInput,
  type PaymentVerifyInput,
} from "@lms/shared";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { SettingsService } from "../settings/settings.service";
import { NotificationService } from "../notification/notification.service";
import { StorageRegistry } from "../content/storage/storage.registry";
import { RegistrationNumberService } from "../admission/registration-number.service";
import { getActor } from "../prisma/actor-context";
import { requireOwnStudentId } from "../rbac/ownership";
import { FeeService } from "./fee.service";
import { ReceiptService } from "./receipt.service";
import { FeeMailer } from "./fee-mailer";
import { summarise, type FeeSummary } from "./fee-summary";

/**
 * PAYMENT SUBMISSIONS — a student saying they have paid, and the office
 * deciding whether they have.
 *
 * THE ONE INVARIANT THIS SERVICE EXISTS TO HOLD:
 *
 *     NOTHING A STUDENT DOES HERE PUTS MONEY IN THE LEDGER.
 *
 * `submit` writes a row and touches nothing else. `Student.outstandingBalance`
 * is not recomputed, no Payment is created, no charge is settled. The only
 * method in this file that writes a Payment is `verify`, and it is guarded by
 * `payment_submission:approve` at step-up. If that separation ever collapses,
 * the Institute's figure for what it is owed becomes a number its students
 * control.
 *
 * WHY THE WORKFLOW IS SHAPED THIS WAY. Before this existed, a Payment could
 * only be created by an administrator — at admission, or by typing at the fee
 * screen. A student who transferred their second instalment had nowhere to say
 * so: the slip went to somebody's personal WhatsApp, and the System's record of
 * the payment began whenever a human got round to it. Meanwhile the student's
 * own screen went on saying the money was owed, so they asked again, and the
 * office answered by hand. Every part of that is what this replaces.
 *
 * EVERY DECISION IS AUDITED AND NOTHING IS DELETED. A rejected claim is the
 * evidence that the Institute looked and said no, and a student who disputes it
 * is entitled to find the record rather than an absence.
 */
@Injectable()
export class PaymentSubmissionService {
  private readonly logger = new Logger(PaymentSubmissionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationService,
    private readonly storage: StorageRegistry,
    private readonly numbers: RegistrationNumberService,
    private readonly fees: FeeService,
    private readonly receipts: ReceiptService,
    private readonly mailer: FeeMailer,
  ) {}

  // =========================================================== student ======

  /**
   * Everything a student needs to fill in the form, in one request.
   *
   * ONE CALL, NOT FOUR. The form needs their name, their registration number,
   * their course, their batch, what they owe, and where to pay it. Fetching
   * those separately means a form that assembles itself in pieces on a phone
   * on a slow connection, and a student who starts typing before the balance
   * arrives is a student entering an amount against a figure that changes
   * under them.
   *
   * IT ALSO CARRIES WHERE TO PAY. The account details are the reason a student
   * opened this screen at all, and asking them to find another page for it is
   * how a payment goes to the wrong account.
   */
  async myContext() {
    const studentId = requireOwnStudentId();

    const student = await this.prisma.scoped.student.findFirst({
      where: { id: studentId, deletedAt: null },
      select: {
        id: true,
        registrationNo: true,
        currentRollNo: true,
        // WHO PAYS. A student whose institute is billed must not be shown a
        // balance, a Submit Payment button, or anything else that asks them
        // for money they do not owe.
        feePayer: true,
        partnerInstitute: { select: { name: true } },
        user: { select: { fullName: true, email: true } },
        currentSection: {
          select: {
            name: true,
            batch: {
              select: {
                academicSession: { select: { programme: { select: { name: true } } } },
              },
            },
          },
        },
      },
    });
    if (!student) throw new AppError("RESOURCE_NOT_FOUND");

    const [summary, bank] = await Promise.all([
      this.summaryFor(studentId),
      this.paymentDetails(),
    ]);

    return {
      student: {
        id: student.id,
        fullName: student.user.fullName,
        email: student.user.email,
        registrationNo: student.registrationNo,
        rollNo: student.currentRollNo,
        programme:
          student.currentSection?.batch.academicSession.programme.name ?? null,
        section: student.currentSection?.name ?? null,
      },
      summary,
      bank,
      methods: Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => ({ value, label })),
      /*
       * WHO SETTLES THIS STUDENT'S FEE.
       *
       * `PARTNER` means their institute is invoiced and NO FeeCharge was ever
       * raised against them — so every figure in `summary` above is zero by
       * construction rather than by a filter. The screen uses this to say who
       * is paying instead of showing an empty statement, and to withhold the
       * Submit Payment button: offering somebody a way to pay a bill that is
       * not theirs is how we end up holding money we have to give back.
       */
      billing: {
        payer: student.feePayer,
        partnerName: student.partnerInstitute?.name ?? null,
      },
    };
  }

  /**
   * FR-PAY-021 — a student claiming a payment.
   *
   * WHAT IT DELIBERATELY DOES NOT CHECK: whether the amount matches what is
   * owed. A student may overpay, prepay, pay a round figure, or pay against a
   * balance they have misread — and a form that refuses any of those sends the
   * money back to being unrecorded, which is strictly worse. The office reads
   * the slip; the form's job is to get the claim and the evidence into the
   * System.
   *
   * WHAT IT DOES CHECK is that the evidence is real and unattached: a slip id
   * is a bearer token for exactly one thing, and only while the document
   * belongs to nobody. Otherwise a guessed id would let one student staple
   * another's bank slip to their own claim.
   */
  async submit(input: PaymentSubmissionInput, ip?: string) {
    const studentId = requireOwnStudentId();

    const student = await this.prisma.scoped.student.findFirst({
      where: { id: studentId, deletedAt: null },
      select: {
        id: true,
        registrationNo: true,
        currentRollNo: true,
        feePayer: true,
        user: { select: { id: true, fullName: true, email: true } },
        currentSection: {
          select: {
            name: true,
            batch: { select: { academicSession: { select: { programme: { select: { name: true } } } } } },
          },
        },
      },
    });
    if (!student) throw new AppError("RESOURCE_NOT_FOUND");

    /*
     * A STUDENT WHOSE INSTITUTE PAYS CANNOT SUBMIT A PAYMENT.
     *
     * The screen does not offer the button, and that is a courtesy rather than
     * a control — this route is reachable by anybody who can type a URL. The
     * money would otherwise arrive against a student who owes nothing, sit in
     * a queue nobody expected, and have to be refunded by hand.
     */
    if (student.feePayer === "PARTNER") {
      throw new AppError("RESOURCE_CONFLICT", {
        message:
          "Your fees are paid by your institute, so there is nothing for you to pay here. " +
          "If you think that is wrong, speak to the office.",
      });
    }

    /*
     * A CEILING ON UNREVIEWED CLAIMS.
     *
     * Not a rate limit — the throttler does that. This stops a queue being
     * flooded by somebody pressing the button repeatedly on a slow connection,
     * which is the realistic failure: five identical claims for one payment,
     * each of which an administrator has to open and reject. Five is generous
     * for a student with several instalments genuinely outstanding.
     */
    const waiting = await this.prisma.asSystem((db) =>
      db.paymentSubmission.count({ where: { studentId, status: "PENDING" } }),
    );
    if (waiting >= 5) {
      throw new AppError("RESOURCE_CONFLICT", {
        message:
          "You already have five payments waiting to be checked. Please wait for those to be " +
          "reviewed before submitting another, or contact the office.",
      });
    }

    const summary = await this.summaryFor(studentId);
    const programme = student.currentSection?.batch.academicSession.programme.name ?? null;

    const created = await this.prisma.asSystem((db) =>
      db.$transaction(async (tx) => {
        const year = new Date().getUTCFullYear();
        const sequence = await this.numbers.allocateSequence(tx, `PAYSUB|${year}`);
        const reference = `PS-${year}-${String(sequence).padStart(6, "0")}`;

        const row = await tx.paymentSubmission.create({
          data: {
            reference,
            studentId,
            status: "PENDING",
            claimedAmount: input.amount,
            paymentDate: input.paymentDate,
            method: input.method,
            bankReference: input.bankReference?.trim() || null,
            studentNote: input.note?.trim() || null,
            outstandingAtSubmission: summary.remaining,
            // BR-DAT-02 — what was true when the money changed hands.
            studentNameAtSubmission: student.user.fullName,
            registrationNoAtSubmission: student.registrationNo,
            programmeAtSubmission: programme,
            sectionAtSubmission: student.currentSection?.name ?? null,
            rollNoAtSubmission: student.currentRollNo,
          },
        });

        /*
         * CLAIM THE EVIDENCE — and only what is genuinely unattached.
         *
         * `updateMany` with `paymentSubmissionId: null` AND
         * `registrationRequestId: null` in the WHERE is what makes this safe
         * under a race: two submissions naming the same document, arriving
         * together, cannot both succeed, because the second one's update
         * matches zero rows and the count below refuses it.
         */
        const claimed = await tx.registrationDocument.updateMany({
          where: {
            id: { in: input.documentIds },
            registrationRequestId: null,
            paymentSubmissionId: null,
          },
          data: { paymentSubmissionId: row.id },
        });

        if (claimed.count !== input.documentIds.length) {
          // Rolls the whole transaction back — including the reference — so a
          // claim never exists without the proof it was made on.
          throw new AppError("VALIDATION_FAILED", {
            message: "The payment receipt you attached could not be saved with this submission.",
            details: [
              {
                field: "documentIds",
                code: "SLIP_UNAVAILABLE",
                message:
                  "Please attach the photo of your payment receipt again, then submit. " +
                  "If this keeps happening, contact the office.",
              },
            ],
          });
        }

        return row;
      }),
    );

    await this.audit.record({
      action: "fee.submission.create",
      entityType: "PaymentSubmission",
      entityId: created.id,
      after: {
        reference: created.reference,
        studentId,
        claimedAmount: input.amount,
        method: input.method,
        bankReference: input.bankReference ?? null,
        documents: input.documentIds.length,
      },
      ...(ip ? { ipAddress: ip } : {}),
    });

    // AFTER the transaction, never inside it. A mail server that hangs must
    // not hold a database transaction open, and a submission that was accepted
    // has been accepted whether or not the message went.
    const email = await this.mailer.paymentSubmitted({
      to: student.user.email,
      fullName: student.user.fullName,
      reference: created.reference,
      amount: input.amount,
      currency: created.currency,
      method: input.method,
      bankReference: input.bankReference?.trim() || null,
      paidOn: input.paymentDate,
      remainingBefore: summary.remaining,
      viewUrl: this.webUrl("/fees"),
    });

    await this.raise({
      userIds: [student.user.id],
      kind: "fee.payment_submitted",
      title: "Payment submitted — waiting for verification",
      body:
        `We have your submission of ${money(input.amount, created.currency)} (${created.reference}). ` +
        "The office will check it against the bank record and write to you.",
      linkPath: "/fees",
    });

    return {
      id: created.id,
      reference: created.reference,
      status: created.status,
      amount: Number(created.claimedAmount),
      currency: created.currency,
      method: created.method,
      methodLabel: label(created.method),
      bankReference: created.bankReference,
      paidOn: created.paymentDate,
      submittedAt: created.submittedAt,
      emailed: email.sent,
      // The screen says this back to the student. It is deliberately about
      // what happens NEXT rather than about what the database did.
      message:
        "Your payment has been submitted. Our office will check the receipt you sent and " +
        "you will get an email once it has been verified. Nothing more is needed from you now.",
    };
  }

  /** A student's own claims, newest first — the payment history. */
  async mine() {
    return this.forStudent(requireOwnStudentId());
  }

  /**
   * FR-PAY-021 — withdrawing a claim that has not been looked at.
   *
   * ONLY WHILE PENDING, and that is the whole safety of it: once an
   * administrator has decided, the record is a decision and a student cannot
   * remove it. Marked CANCELLED rather than deleted, for the same reason
   * nothing else here is deleted.
   */
  async cancel(id: string) {
    const studentId = requireOwnStudentId();

    const row = await this.prisma.scoped.paymentSubmission.findFirst({
      where: { id },
      select: { id: true, studentId: true, status: true, reference: true },
    });
    if (!row || row.studentId !== studentId) throw new AppError("RESOURCE_NOT_FOUND");

    if (row.status !== "PENDING") {
      throw new AppError("RESOURCE_CONFLICT", {
        message:
          row.status === "VERIFIED"
            ? "This payment has already been verified, so it cannot be withdrawn. Speak to the office if it is wrong."
            : "This submission has already been reviewed and cannot be withdrawn.",
      });
    }

    await this.prisma.asSystem((db) =>
      db.paymentSubmission.update({
        where: { id },
        data: { status: "CANCELLED", reviewedAt: new Date() },
      }),
    );

    await this.audit.record({
      action: "fee.submission.cancel",
      entityType: "PaymentSubmission",
      entityId: id,
      before: { status: "PENDING" },
      after: { status: "CANCELLED", by: "student" },
    });

    return { id, status: "CANCELLED" as const, message: "That submission has been withdrawn." };
  }

  // ============================================================= office =====

  /**
   * FR-PAY-021 — the review queue.
   *
   * DEFAULTS TO PENDING, OLDEST FIRST, because that is the order it has to be
   * worked in and a queue that opens on "everything, newest first" is a queue
   * whose oldest item is never seen. Everything else is a filter on top.
   */
  async queue(params: {
    status?: string;
    q?: string;
    method?: string;
    programmeId?: string;
    sectionId?: string;
    from?: Date;
    to?: Date;
    minAmount?: number;
    maxAmount?: number;
    page?: number;
    pageSize?: number;
  }) {
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(100, Math.max(5, params.pageSize ?? 25));

    const where: Prisma.PaymentSubmissionWhereInput = {};

    // "ALL" is a real choice and must not be read as "PENDING".
    if (params.status && params.status !== "ALL") {
      where.status = params.status as Prisma.PaymentSubmissionWhereInput["status"];
    } else if (!params.status) {
      where.status = "PENDING";
    }

    if (params.method) where.method = params.method as Prisma.PaymentSubmissionWhereInput["method"];

    if (params.from || params.to) {
      where.submittedAt = {
        ...(params.from ? { gte: params.from } : {}),
        // Through the END of the chosen day. A reviewer filtering "to today"
        // and being shown nothing from today is the kind of thing that gets
        // reported as lost data.
        ...(params.to ? { lte: endOfDay(params.to) } : {}),
      };
    }

    if (params.minAmount !== undefined || params.maxAmount !== undefined) {
      where.claimedAmount = {
        ...(params.minAmount !== undefined ? { gte: params.minAmount } : {}),
        ...(params.maxAmount !== undefined ? { lte: params.maxAmount } : {}),
      };
    }

    /*
     * BUILT AS ONE OBJECT, not assigned twice.
     *
     * `where.student` is a Prisma XOR of "is/isNot" and a full StudentWhereInput,
     * and spreading a previous assignment into a second one collapses the union
     * to the wrong arm — the compiler then insists every field be `undefined`,
     * which reads as nonsense until you know that is what XOR does.
     */
    const studentWhere: Prisma.StudentWhereInput = {};
    if (params.sectionId) studentWhere.currentSectionId = params.sectionId;
    if (params.programmeId) {
      studentWhere.currentSection = {
        batch: { academicSession: { programmeId: params.programmeId } },
      };
    }
    if (Object.keys(studentWhere).length > 0) where.student = studentWhere;

    /*
     * SEARCH ACROSS EVERY IDENTIFIER SOMEBODY MIGHT BE HOLDING.
     *
     * A student telephones quoting whatever is in front of them: their name,
     * their registration number, the transaction number off their bank app, or
     * the submission reference from their email. A search that only matches
     * one of those makes the administrator ask them for a different one.
     *
     * The name and registration number are matched against the SNAPSHOT
     * columns as well as the live record, so a student whose name was later
     * corrected is still findable by what the receipt says.
     */
    const q = params.q?.trim();
    if (q) {
      where.OR = [
        { reference: { contains: q, mode: "insensitive" } },
        { bankReference: { contains: q, mode: "insensitive" } },
        { studentNameAtSubmission: { contains: q, mode: "insensitive" } },
        { registrationNoAtSubmission: { contains: q, mode: "insensitive" } },
        { student: { registrationNo: { contains: q, mode: "insensitive" } } },
        { student: { user: { fullName: { contains: q, mode: "insensitive" } } } },
        { payment: { receiptNo: { contains: q, mode: "insensitive" } } },
      ];
    }

    const [rows, totalItems] = await Promise.all([
      this.prisma.scoped.paymentSubmission.findMany({
        where,
        // Oldest first while working the pending queue; newest first when
        // looking back over what was decided, which is how each is read.
        orderBy: { submittedAt: where.status === "PENDING" ? "asc" : "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          reference: true,
          status: true,
          claimedAmount: true,
          verifiedAmount: true,
          currency: true,
          method: true,
          bankReference: true,
          paymentDate: true,
          submittedAt: true,
          reviewedAt: true,
          studentNameAtSubmission: true,
          registrationNoAtSubmission: true,
          programmeAtSubmission: true,
          sectionAtSubmission: true,
          studentId: true,
          payment: { select: { receiptNo: true } },
          _count: { select: { documents: true } },
        },
      }),
      this.prisma.scoped.paymentSubmission.count({ where }),
    ]);

    return {
      data: rows.map((r) => ({
        id: r.id,
        reference: r.reference,
        status: r.status,
        studentId: r.studentId,
        studentName: r.studentNameAtSubmission,
        registrationNo: r.registrationNoAtSubmission,
        programme: r.programmeAtSubmission,
        section: r.sectionAtSubmission,
        amount: Number(r.claimedAmount),
        verifiedAmount: r.verifiedAmount === null ? null : Number(r.verifiedAmount),
        currency: r.currency,
        method: r.method,
        methodLabel: label(r.method),
        bankReference: r.bankReference,
        paidOn: r.paymentDate,
        submittedAt: r.submittedAt,
        reviewedAt: r.reviewedAt,
        receiptNo: r.payment?.receiptNo ?? null,
        proofCount: r._count.documents,
      })),
      pagination: {
        page,
        pageSize,
        totalItems,
        totalPages: Math.max(1, Math.ceil(totalItems / pageSize)),
        hasNext: page * pageSize < totalItems,
        hasPrevious: page > 1,
      },
    };
  }

  /**
   * FR-PAY-021 — the figures on the fee desk, in one request.
   *
   * DELIBERATELY FEW. What an administrator opening this page needs to decide
   * what to do next is: how many are waiting, how long the oldest has waited,
   * and what has been taken. Anything more is a chart nobody acts on.
   */
  async stats() {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const startOfMonth = new Date(startOfToday.getFullYear(), startOfToday.getMonth(), 1);

    const [pending, oldest, rejected, verifiedToday, verifiedMonth, collected, owed] =
      await Promise.all([
        this.prisma.asSystem((db) =>
          db.paymentSubmission.aggregate({
            where: { status: "PENDING" },
            _count: true,
            _sum: { claimedAmount: true },
          }),
        ),
        this.prisma.asSystem((db) =>
          db.paymentSubmission.findFirst({
            where: { status: "PENDING" },
            orderBy: { submittedAt: "asc" },
            select: { submittedAt: true },
          }),
        ),
        this.prisma.asSystem((db) =>
          db.paymentSubmission.count({
            where: { status: "REJECTED", reviewedAt: { gte: startOfMonth } },
          }),
        ),
        this.prisma.asSystem((db) =>
          db.payment.aggregate({
            where: { isReversed: false, verifiedAt: { gte: startOfToday } },
            _count: true,
            _sum: { verifiedAmount: true },
          }),
        ),
        this.prisma.asSystem((db) =>
          db.payment.aggregate({
            where: { isReversed: false, verifiedAt: { gte: startOfMonth } },
            _count: true,
            _sum: { verifiedAmount: true },
          }),
        ),
        this.prisma.asSystem((db) =>
          db.payment.aggregate({ where: { isReversed: false }, _sum: { verifiedAmount: true } }),
        ),
        this.prisma.asSystem((db) =>
          db.student.aggregate({
            where: { deletedAt: null, outstandingBalance: { gt: 0 } },
            _count: true,
            _sum: { outstandingBalance: true },
          }),
        ),
      ]);

    const waitingDays =
      oldest === null
        ? null
        : Math.floor((Date.now() - oldest.submittedAt.getTime()) / 86_400_000);

    return {
      pendingCount: pending._count,
      pendingAmount: Number(pending._sum.claimedAmount ?? 0),
      oldestPendingDays: waitingDays,
      rejectedThisMonth: rejected,
      verifiedTodayCount: verifiedToday._count,
      verifiedTodayAmount: Number(verifiedToday._sum.verifiedAmount ?? 0),
      verifiedThisMonthCount: verifiedMonth._count,
      verifiedThisMonthAmount: Number(verifiedMonth._sum.verifiedAmount ?? 0),
      totalCollected: Number(collected._sum.verifiedAmount ?? 0),
      studentsOwing: owed._count,
      totalOutstanding: Number(owed._sum.outstandingBalance ?? 0),
    };
  }

  /**
   * One submission, with everything the reviewer needs to decide.
   *
   * INCLUDING THE ARITHMETIC. "Total required, previously verified, this
   * submission, total after, remaining" is the calculation an administrator
   * would otherwise do in their head against a statement on another screen,
   * and it is the calculation that decides whether they verify. Doing it here
   * means it is done the same way every time, and by the same code that
   * produces the student's own summary — so the two cannot disagree.
   */
  async detail(id: string) {
    const row = await this.prisma.scoped.paymentSubmission.findFirst({
      where: { id },
      include: {
        documents: {
          select: {
            id: true,
            originalFilename: true,
            contentType: true,
            sizeBytes: true,
            scanStatus: true,
            createdAt: true,
          },
        },
        payment: { select: { id: true, receiptNo: true, isReversed: true, verifiedAt: true } },
        student: {
          select: {
            id: true,
            registrationNo: true,
            currentRollNo: true,
            user: { select: { fullName: true, email: true, phone: true } },
            currentSection: {
              select: {
                name: true,
                batch: {
                  select: { academicSession: { select: { programme: { select: { name: true } } } } },
                },
              },
            },
          },
        },
      },
    });
    if (!row) throw new AppError("RESOURCE_NOT_FOUND");

    const summary = await this.summaryFor(row.studentId);
    const claimed = Number(row.claimedAmount);
    const settled = row.status === "VERIFIED";

    return {
      id: row.id,
      reference: row.reference,
      status: row.status,

      student: {
        id: row.student.id,
        // The LIVE name, for an administrator who is about to speak to this
        // person, alongside the snapshot the receipt will carry.
        fullName: row.student.user.fullName,
        email: row.student.user.email,
        phone: row.student.user.phone,
        registrationNo: row.student.registrationNo,
        rollNo: row.student.currentRollNo,
        programme: row.student.currentSection?.batch.academicSession.programme.name ?? null,
        section: row.student.currentSection?.name ?? null,
      },
      snapshot: {
        studentName: row.studentNameAtSubmission,
        registrationNo: row.registrationNoAtSubmission,
        programme: row.programmeAtSubmission,
        section: row.sectionAtSubmission,
        rollNo: row.rollNoAtSubmission,
      },

      payment: {
        claimedAmount: claimed,
        verifiedAmount: row.verifiedAmount === null ? null : Number(row.verifiedAmount),
        currency: row.currency,
        method: row.method,
        methodLabel: label(row.method),
        bankReference: row.bankReference,
        paidOn: row.paymentDate,
        submittedAt: row.submittedAt,
        studentNote: row.studentNote,
        outstandingAtSubmission:
          row.outstandingAtSubmission === null ? null : Number(row.outstandingAtSubmission),
      },

      proof: row.documents.map((d) => ({
        id: d.id,
        filename: d.originalFilename,
        contentType: d.contentType,
        sizeBytes: Number(d.sizeBytes),
        scanStatus: d.scanStatus,
        uploadedAt: d.createdAt,
      })),

      /*
       * THE CALCULATION, SPELLED OUT.
       *
       * `totalAfter` and `remainingAfter` describe what verifying THIS
       * submission would do, so the reviewer sees the consequence before they
       * act rather than after. Once it is verified they describe what already
       * happened, which is why `settled` decides which figure the "before"
       * column holds — otherwise reopening a verified submission would show
       * its own money counted twice.
       */
      calculation: {
        currency: row.currency,
        totalRequired: summary.totalFee,
        previouslyVerified: settled ? round2(summary.verified - Number(row.verifiedAmount ?? 0)) : summary.verified,
        thisSubmission: settled ? Number(row.verifiedAmount ?? claimed) : claimed,
        totalAfter: settled ? summary.verified : round2(summary.verified + claimed),
        remainingAfter: settled
          ? summary.remaining
          : Math.max(0, round2(summary.totalFee - summary.verified - claimed)),
        otherPending: settled ? summary.pending : round2(summary.pending - claimed),
        wouldOverpay: !settled && summary.verified + claimed > summary.totalFee + 0.005,
      },

      review: {
        reviewedBy: row.reviewedBy ? await this.nameOf(row.reviewedBy) : null,
        reviewedAt: row.reviewedAt,
        note: row.reviewNote,
      },

      receipt: row.payment
        ? {
            paymentId: row.payment.id,
            receiptNo: row.payment.receiptNo,
            isReversed: row.payment.isReversed,
            issuedAt: row.payment.verifiedAt,
          }
        : null,
    };
  }

  /**
   * The proof itself, streamed.
   *
   * NEVER A STORAGE URL (SEC-FIL-009). The object is somebody's bank record,
   * and a link that works without a session is a link that still works after
   * the session ends. Scoped, so a student reaching for another student's proof
   * finds nothing.
   */
  async proof(submissionId: string, documentId: string) {
    const submission = await this.prisma.scoped.paymentSubmission.findFirst({
      where: { id: submissionId },
      select: { id: true },
    });
    if (!submission) throw new AppError("RESOURCE_NOT_FOUND");

    const doc = await this.prisma.asSystem((db) =>
      db.registrationDocument.findFirst({
        where: { id: documentId, paymentSubmissionId: submission.id },
        select: { storageKey: true, contentType: true, originalFilename: true },
      }),
    );
    if (!doc) throw new AppError("RESOURCE_NOT_FOUND");

    const body = await this.storage.forDocuments().get(doc.storageKey);
    return { body, contentType: doc.contentType, filename: doc.originalFilename };
  }

  /**
   * FR-PAY-021 — THE ACT THAT MOVES MONEY.
   *
   * Everything before this point is paperwork. This is the one call in the fee
   * system that turns a claim into a Payment, and it does five things that must
   * either all happen or none of them:
   *
   *   1. create the Payment — the ledger's own record
   *   2. mark the submission verified and point it at that payment
   *   3. recompute the student's outstanding balance
   *   4. allocate the receipt number
   *   5. audit it
   *
   * 1 to 3 and 5 are in ONE TRANSACTION. A balance recomputed outside the
   * transaction that changed the payments is a balance that is wrong whenever
   * the process dies in between, and a wrong balance is worse than none: it is
   * a number everybody trusts and nobody checks.
   *
   * 4 IS DELIBERATELY OUTSIDE IT. The receipt number comes from an atomic
   * sequence in its own transaction, and holding the verification open while a
   * PDF is rendered and a mail server is waited on would keep row locks on the
   * ledger for as long as the slowest SMTP handshake of the day.
   */
  async verify(id: string, input: PaymentVerifyInput, ip?: string) {
    const actor = getActor();
    if (!actor) throw new AppError("AUTH_TOKEN_INVALID");

    const row = await this.prisma.scoped.paymentSubmission.findFirst({
      where: { id },
      include: {
        student: {
          select: {
            id: true,
            user: { select: { id: true, fullName: true, email: true } },
          },
        },
      },
    });
    if (!row) throw new AppError("RESOURCE_NOT_FOUND");

    if (row.status !== "PENDING") {
      throw new AppError("RESOURCE_CONFLICT", {
        message:
          row.status === "VERIFIED"
            ? "This payment has already been verified."
            : `This submission was already ${row.status.toLowerCase()} and cannot be verified.`,
      });
    }

    const claimed = Number(row.claimedAmount);
    const verifiedAmount = input.verifiedAmount ?? claimed;
    const differs = Math.abs(verifiedAmount - claimed) > 0.005;

    /*
     * A CHANGED FIGURE NEEDS A REASON — FR-REG-028 asks the same of an
     * admission, and for the same reason. The student is going to be told a
     * number different from the one they submitted, and "why" must be
     * answerable from the record rather than from somebody's memory.
     */
    if (differs && !input.note?.trim()) {
      throw new AppError("VALIDATION_FAILED", {
        details: [
          {
            field: "note",
            code: "VARIANCE_REASON_REQUIRED",
            message:
              `You are verifying ${money(verifiedAmount, row.currency)} against a claim of ` +
              `${money(claimed, row.currency)}. Say why — the student is shown this, and it ` +
              "goes on the record.",
          },
        ],
      });
    }

    const note = input.note?.trim() || null;

    const payment = await this.prisma.asSystem((db) =>
      db.$transaction(async (tx) => {
        // Re-read INSIDE the transaction. Two administrators opening the queue
        // together and pressing Verify on the same row must not produce two
        // payments for one claim; the second finds it already decided.
        const fresh = await tx.paymentSubmission.findUnique({
          where: { id },
          select: { status: true },
        });
        if (fresh?.status !== "PENDING") {
          throw new AppError("RESOURCE_CONFLICT", {
            message: "Somebody else has just reviewed this submission. Reload to see the outcome.",
          });
        }

        const created = await tx.payment.create({
          data: {
            studentId: row.studentId,
            verifiedAmount,
            currency: row.currency,
            paymentDate: row.paymentDate,
            method: row.method,
            bankReference: row.bankReference,
            // BR-REG-10: the amount the Institute verified is THE amount, and
            // whoever verified it is on the record as having done so.
            verifiedBy: actor.userId,
            varianceReason: note,
          },
        });

        await tx.paymentSubmission.update({
          where: { id },
          data: {
            status: "VERIFIED",
            verifiedAmount,
            paymentId: created.id,
            reviewedBy: actor.userId,
            reviewedAt: new Date(),
            reviewNote: note,
          },
        });

        // Same transaction as the payment that made it necessary.
        await this.fees.recomputeBalance(tx, row.studentId);

        await this.audit.record(
          {
            action: "fee.submission.verify",
            entityType: "PaymentSubmission",
            entityId: id,
            before: { status: "PENDING", claimedAmount: claimed },
            after: {
              status: "VERIFIED",
              verifiedAmount,
              paymentId: created.id,
              variance: differs,
              note,
            },
            ...(ip ? { ipAddress: ip } : {}),
          },
          tx as unknown as Parameters<AuditService["record"]>[1],
        );

        return created;
      }),
    );

    // The receipt, its number allocated on first sight. `silent`, because the
    // audit entry above already records that this act issued one — two entries
    // for one action makes the log read as two acts.
    const receipt = await this.receipts.forPayment(payment.id, ip, true);
    const pdf = this.receipts.render(receipt);

    const email = await this.mailer.paymentVerified({
      to: row.student.user.email,
      fullName: row.student.user.fullName,
      receipt,
      pdf,
      viewUrl: this.webUrl(`/receipts/${payment.id}`),
      claimedAmount: differs ? claimed : null,
    });

    await this.raise({
      userIds: [row.student.user.id],
      kind: "fee.payment_verified",
      title: `Payment verified — receipt ${receipt.receiptNo}`,
      body:
        `${money(verifiedAmount, row.currency)} has been verified and your receipt is ready. ` +
        (receipt.ledger && receipt.ledger.balanceAfter > 0.005
          ? `${money(receipt.ledger.balanceAfter, row.currency)} is still to pay.`
          : "Your fee is paid in full."),
      linkPath: `/receipts/${payment.id}`,
      // Held back: the mailer above sent this with the PDF attached.
      exceptChannels: ["EMAIL"],
    });

    const summary = await this.summaryFor(row.studentId);

    return {
      id,
      status: "VERIFIED" as const,
      paymentId: payment.id,
      receiptNo: receipt.receiptNo,
      verifiedAmount,
      currency: row.currency,
      student: { id: row.studentId, name: row.student.user.fullName },
      summary,
      emailed: email.sent,
      /*
       * WHAT ACTUALLY HAPPENED, in the order it happened, because the
       * administrator is about to tell the student and needs to know which
       * parts they can promise. The email line is honest about failure: a
       * receipt that did not reach the student is something the office must
       * know NOW, not when the student rings.
       */
      done: [
        "Payment recorded against the student's account.",
        "Fee balance updated.",
        `Receipt ${receipt.receiptNo} issued.`,
        email.sent
          ? "Receipt emailed to the student with the PDF attached."
          : `The receipt could not be emailed — ${email.detail} The student can still download it from their Fees page.`,
      ],
      message: `Verified. Receipt ${receipt.receiptNo} has been issued.`,
    };
  }

  /**
   * FR-PAY-021 — declining a claim.
   *
   * THE REASON IS MANDATORY AND THE STUDENT READS IT VERBATIM. That is the
   * whole design of this method: a rejection with no reason is an instruction
   * to telephone the office, and most of these are fixable in five minutes by
   * somebody who is simply told what was wrong.
   */
  async reject(id: string, input: PaymentRejectInput, ip?: string) {
    const actor = getActor();
    if (!actor) throw new AppError("AUTH_TOKEN_INVALID");

    const row = await this.prisma.scoped.paymentSubmission.findFirst({
      where: { id },
      include: {
        student: { select: { id: true, user: { select: { id: true, fullName: true, email: true } } } },
      },
    });
    if (!row) throw new AppError("RESOURCE_NOT_FOUND");

    if (row.status !== "PENDING") {
      throw new AppError("RESOURCE_CONFLICT", {
        message:
          row.status === "VERIFIED"
            ? "This payment has already been verified. To undo it, reverse the payment on the student's statement — that keeps both the payment and the correction on the record."
            : `This submission was already ${row.status.toLowerCase()}.`,
      });
    }

    const reason = input.reason.trim();

    await this.prisma.asSystem((db) =>
      db.$transaction(async (tx) => {
        const fresh = await tx.paymentSubmission.findUnique({
          where: { id },
          select: { status: true },
        });
        if (fresh?.status !== "PENDING") {
          throw new AppError("RESOURCE_CONFLICT", {
            message: "Somebody else has just reviewed this submission. Reload to see the outcome.",
          });
        }

        await tx.paymentSubmission.update({
          where: { id },
          data: {
            status: "REJECTED",
            reviewedBy: actor.userId,
            reviewedAt: new Date(),
            reviewNote: reason,
          },
        });

        await this.audit.record(
          {
            action: "fee.submission.reject",
            entityType: "PaymentSubmission",
            entityId: id,
            before: { status: "PENDING" },
            after: { status: "REJECTED", reason },
            ...(ip ? { ipAddress: ip } : {}),
          },
          tx as unknown as Parameters<AuditService["record"]>[1],
        );
      }),
    );

    const email = await this.mailer.paymentRejected({
      to: row.student.user.email,
      fullName: row.student.user.fullName,
      reference: row.reference,
      amount: Number(row.claimedAmount),
      currency: row.currency,
      reason,
      submitUrl: this.webUrl("/fees/submit"),
    });

    await this.raise({
      userIds: [row.student.user.id],
      kind: "fee.payment_rejected",
      title: "We could not verify your payment",
      body: `${reason} You can submit it again from your Fees page.`,
      linkPath: "/fees",
    });

    return {
      id,
      status: "REJECTED" as const,
      student: { id: row.studentId, name: row.student.user.fullName },
      emailed: email.sent,
      message: email.sent
        ? "Rejected, and the student has been emailed the reason."
        : `Rejected. The email could not be sent — ${email.detail}`,
    };
  }

  // ============================================================ shared ======

  /**
   * A student's submissions, newest first.
   *
   * Shared between "my payments" and an administrator opening somebody's
   * record, so the two views cannot drift apart.
   */
  async forStudent(studentId: string) {
    const rows = await this.prisma.scoped.paymentSubmission.findMany({
      where: { studentId },
      orderBy: { submittedAt: "desc" },
      select: {
        id: true,
        reference: true,
        status: true,
        claimedAmount: true,
        verifiedAmount: true,
        currency: true,
        method: true,
        bankReference: true,
        paymentDate: true,
        submittedAt: true,
        reviewedAt: true,
        reviewNote: true,
        studentNote: true,
        payment: { select: { id: true, receiptNo: true, isReversed: true } },
        documents: { select: { id: true, originalFilename: true, contentType: true } },
      },
    });

    return rows.map((r) => ({
      id: r.id,
      reference: r.reference,
      status: r.status,
      amount: Number(r.claimedAmount),
      verifiedAmount: r.verifiedAmount === null ? null : Number(r.verifiedAmount),
      currency: r.currency,
      method: r.method,
      methodLabel: label(r.method),
      bankReference: r.bankReference,
      paidOn: r.paymentDate,
      submittedAt: r.submittedAt,
      reviewedAt: r.reviewedAt,
      // Named for what it is on each side: a rejection reason is the office's
      // answer, and calling it "note" on the screen buries it.
      reviewNote: r.reviewNote,
      studentNote: r.studentNote,
      paymentId: r.payment?.id ?? null,
      receiptNo: r.payment?.receiptNo ?? null,
      receiptReversed: r.payment?.isReversed ?? false,
      proof: r.documents.map((d) => ({
        id: d.id,
        filename: d.originalFilename,
        contentType: d.contentType,
      })),
    }));
  }

  /**
   * The four figures, for one student.
   *
   * THE SINGLE PLACE THEY ARE COMPUTED. The student's summary, the reviewer's
   * calculation and the figures on the receipt all come through here, so the
   * three can never tell one person three different things.
   */
  async summaryFor(studentId: string): Promise<FeeSummary> {
    const [charges, payments, submissions] = await Promise.all([
      this.prisma.asSystem((db) =>
        db.feeCharge.findMany({
          where: { studentId, deletedAt: null },
          select: { amount: true, waivedAt: true },
        }),
      ),
      this.prisma.asSystem((db) =>
        db.payment.findMany({
          where: { studentId },
          select: { verifiedAmount: true, isReversed: true },
        }),
      ),
      this.prisma.asSystem((db) =>
        db.paymentSubmission.findMany({
          where: { studentId },
          select: { claimedAmount: true, status: true },
        }),
      ),
    ]);

    return summarise(
      charges.map((c) => ({ amount: Number(c.amount), waivedAt: c.waivedAt })),
      payments.map((p) => ({ amount: Number(p.verifiedAmount), isReversed: p.isReversed })),
      submissions.map((s) => ({ claimedAmount: Number(s.claimedAmount), status: s.status })),
    );
  }

  /** Where to pay — the same figures the public application form shows. */
  private async paymentDetails() {
    const [bankName, accountName, accountNumber, iban, instructions] = await Promise.all([
      this.settings.text("finance.bankName"),
      this.settings.text("finance.bankAccountName"),
      this.settings.text("finance.bankAccountNumber"),
      this.settings.text("finance.bankIban"),
      this.settings.text("finance.paymentInstructions"),
    ]);
    return {
      bankName: bankName || null,
      accountName: accountName || null,
      accountNumber: accountNumber || null,
      iban: iban || null,
      instructions: instructions || null,
      configured: Boolean(bankName || accountNumber || iban),
    };
  }

  /**
   * Raise the inbox copy, and never let it fail the thing it describes.
   *
   * A notification is a side effect of a financial act. The payment is
   * verified, the receipt is numbered and the balance is written before this
   * is called; a database hiccup writing an inbox row must not turn that into
   * an error the administrator sees, because there is nothing they could do
   * about it and the money has already moved.
   */
  private async raise(input: {
    userIds: string[];
    kind: string;
    title: string;
    body: string;
    linkPath: string;
    exceptChannels?: string[];
  }): Promise<void> {
    try {
      await this.notifications.notify({
        recipientUserIds: input.userIds,
        kind: input.kind,
        title: input.title,
        body: input.body,
        linkPath: input.linkPath,
        ...(input.exceptChannels ? { exceptChannels: input.exceptChannels } : {}),
      });
    } catch (err) {
      this.logger.warn(
        `Fee notification (${input.kind}) failed: ${err instanceof Error ? err.message : "unknown"}`,
      );
    }
  }

  private webUrl(path: string): string | null {
    const base = (process.env["PUBLIC_WEB_URL"] ?? "").trim().replace(/\/+$/, "");
    return base ? `${base}${path}` : null;
  }

  private async nameOf(userId: string): Promise<string> {
    const user = await this.prisma.asSystem((db) =>
      db.user.findUnique({ where: { id: userId }, select: { fullName: true } }),
    );
    return user?.fullName ?? "";
  }
}

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

const label = (method: string): string =>
  PAYMENT_METHOD_LABELS[method as PaymentMethodValue] ?? method;

function money(amount: number, currency: string): string {
  const whole = Number.isInteger(amount);
  const body = Math.abs(amount).toLocaleString("en-PK", {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  });
  return currency === "PKR" ? `Rs ${body}` : `${currency} ${body}`;
}

/**
 * The last moment of a day, in the server's zone.
 *
 * A date filter that means "up to and including this day" and is compared
 * against a timestamp will otherwise exclude everything after midnight — so a
 * reviewer filtering "to today" sees nothing from today and reports it as lost
 * data.
 */
function endOfDay(d: Date): Date {
  const end = new Date(d);
  end.setHours(23, 59, 59, 999);
  return end;
}
