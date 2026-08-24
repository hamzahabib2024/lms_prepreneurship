import { Injectable, Logger } from "@nestjs/common";
import { AppError } from "@lms/shared";
import type { PaymentMethod, Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { getActor } from "../prisma/actor-context";
import { requireOwnStudentId } from "../rbac/ownership";
import { aging, balanceOf, statement, type Charge, type LedgerPayment } from "./ledger";

export interface ChargeInput {
  studentId: string;
  description: string;
  amount: number;
  dueDate: Date;
  academicSessionId?: string;
}

/**
 * Fees — SRS §5.16, FR-PAY-020..032.
 *
 * The arithmetic is in ledger.ts, pure and tested. This service does the three
 * things it cannot: read the rows, write a charge, and keep
 * `Student.outstandingBalance` honest.
 *
 * THAT LAST ONE IS THE WHOLE RISK. outstandingBalance is materialised, like
 * Section.enrolledCount, because a student list showing what each owes cannot
 * afford a ledger walk per row. A materialised figure that is recomputed
 * anywhere other than inside the transaction that changed the underlying rows
 * will drift, and a drifted balance is worse than none: it is a number
 * everybody trusts and nobody checks. Every write here recomputes it in the
 * same transaction, and recompute() is the single place that does it.
 */
@Injectable()
export class FeeService {
  private readonly logger = new Logger(FeeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** FR-PAY-021 — charge a student for something. */
  async addCharge(input: ChargeInput) {
    const actor = getActor();
    if (!actor) throw new AppError("AUTH_TOKEN_INVALID");

    if (!(input.amount > 0)) {
      throw new AppError("VALIDATION_FAILED", {
        details: [
          {
            field: "amount",
            code: "NOT_POSITIVE",
            message:
              "A charge must be for more than zero. To reduce what somebody owes, waive an " +
              "existing charge — that keeps the decision in the record.",
          },
        ],
      });
    }

    const student = await this.prisma.scoped.student.findFirst({
      where: { id: input.studentId, deletedAt: null },
      select: { id: true },
    });
    if (!student) throw new AppError("RESOURCE_NOT_FOUND");

    const created = await this.prisma.asSystem((db) =>
      db.$transaction(async (tx) => {
        const charge = await tx.feeCharge.create({
          data: {
            studentId: input.studentId,
            description: input.description,
            amount: input.amount,
            dueDate: input.dueDate,
            academicSessionId: input.academicSessionId ?? null,
            createdBy: actor.userId,
          },
        });
        // Same transaction. A balance recomputed afterwards is a balance that
        // is wrong whenever the process dies in between.
        await this.recompute(tx, input.studentId);
        return charge;
      }),
    );

    await this.audit.record({
      action: "fee.charge",
      entityType: "FeeCharge",
      entityId: created.id,
      after: {
        studentId: input.studentId,
        description: input.description,
        amount: input.amount,
        dueDate: input.dueDate,
      },
    });

    return this.statementFor(input.studentId);
  }

  /**
   * FR-PAY-021 — record a payment the Institute has received.
   *
   * UNTIL THIS EXISTED, A PAYMENT COULD ONLY BE CREATED BY APPROVING AN
   * ADMISSION. Everything after that — a second instalment, a late settlement,
   * anything at all — had nowhere to go, so the ledger showed every student
   * owing their full fee forever and the debtors report named people who had
   * paid. The instalment plans are unusable without this.
   *
   * IT IS NOT ATTACHED TO A CHARGE, deliberately. A student hands over 30,000
   * rupees; they are not paying "instalment 2", they are paying the Institute,
   * and the balance is charges minus payments. Forcing an allocation would make
   * somebody guess, and a guess recorded as fact is worse than the arithmetic.
   */
  async recordPayment(input: {
    studentId: string;
    amount: number;
    paymentDate: Date;
    method: PaymentMethod;
    bankReference?: string;
    note?: string;
  }) {
    const actor = getActor();
    if (!actor) throw new AppError("AUTH_TOKEN_INVALID");

    if (!(input.amount > 0)) {
      throw new AppError("VALIDATION_FAILED", {
        details: [
          {
            field: "amount",
            code: "NOT_POSITIVE",
            message:
              "A payment must be for more than zero. To undo one that was recorded in error, " +
              "reverse it — that keeps both the payment and the correction in the record.",
          },
        ],
      });
    }

    const student = await this.prisma.scoped.student.findFirst({
      where: { id: input.studentId, deletedAt: null },
      select: { id: true },
    });
    if (!student) throw new AppError("RESOURCE_NOT_FOUND");

    const created = await this.prisma.asSystem((db) =>
      db.$transaction(async (tx) => {
        const payment = await tx.payment.create({
          data: {
            studentId: input.studentId,
            verifiedAmount: input.amount,
            paymentDate: input.paymentDate,
            method: input.method,
            bankReference: input.bankReference ?? null,
            // BR-REG-10: the amount the Institute verified is the amount, and
            // whoever recorded it is on the record as having verified it.
            verifiedBy: actor.userId,
            ...(input.note ? { varianceReason: input.note } : {}),
          },
        });
        await this.recompute(tx, input.studentId);
        return payment;
      }),
    );

    await this.audit.record({
      action: "fee.payment.record",
      entityType: "Payment",
      entityId: created.id,
      after: {
        studentId: input.studentId,
        amount: input.amount,
        paymentDate: input.paymentDate,
        method: input.method,
        bankReference: input.bankReference ?? null,
      },
    });

    return this.statementFor(input.studentId);
  }

  /**
   * FR-PAY-023 — undo a payment recorded in error.
   *
   * MARKED, NEVER DELETED. A student may be holding a receipt for it, and the
   * ledger shows reversed payments precisely so that receipt can be reconciled
   * against the record rather than contradicting it (BR-RPT-05). Deleting the
   * row would make the Institute look as though the money never arrived, which
   * is a different claim from "it arrived and we sent it back".
   */
  async reversePayment(paymentId: string, reason: string) {
    const actor = getActor();
    if (!actor) throw new AppError("AUTH_TOKEN_INVALID");

    const payment = await this.prisma.scoped.payment.findFirst({
      where: { id: paymentId },
      select: { id: true, studentId: true, isReversed: true, verifiedAmount: true },
    });
    if (!payment) throw new AppError("RESOURCE_NOT_FOUND");
    if (payment.isReversed) {
      throw new AppError("RESOURCE_CONFLICT", {
        message: "That payment has already been reversed.",
      });
    }

    await this.prisma.asSystem((db) =>
      db.$transaction(async (tx) => {
        await tx.payment.update({
          where: { id: paymentId },
          data: {
            isReversed: true,
            reversedBy: actor.userId,
            reversedAt: new Date(),
            reversalReason: reason,
          },
        });
        await this.recompute(tx, payment.studentId);
      }),
    );

    await this.audit.record({
      action: "fee.payment.reverse",
      entityType: "Payment",
      entityId: paymentId,
      before: { isReversed: false },
      after: { isReversed: true, reason, amount: Number(payment.verifiedAmount) },
    });

    return this.statementFor(payment.studentId);
  }

  /**
   * FR-PAY-024 — write a charge off.
   *
   * Not a deletion, and not a negative charge. BR-DAT-02 keeps the record, and
   * a waiver names who decided and why — which a compensating negative line
   * would not.
   */
  async waive(chargeId: string, reason: string) {
    const actor = getActor();
    if (!actor) throw new AppError("AUTH_TOKEN_INVALID");

    if (reason.trim().length < 10) {
      throw new AppError("VALIDATION_FAILED", {
        details: [
          {
            field: "reason",
            code: "REASON_TOO_SHORT",
            message: "Record why this charge is being written off. It stays on the statement.",
          },
        ],
      });
    }

    const charge = await this.prisma.asSystem((db) =>
      db.feeCharge.findFirst({ where: { id: chargeId, deletedAt: null } }),
    );
    if (!charge) throw new AppError("RESOURCE_NOT_FOUND");
    if (charge.waivedAt) {
      throw new AppError("RESOURCE_CONFLICT", {
        message: "That charge has already been written off.",
      });
    }

    await this.prisma.asSystem((db) =>
      db.$transaction(async (tx) => {
        await tx.feeCharge.update({
          where: { id: chargeId },
          data: { waivedAt: new Date(), waivedBy: actor.userId, waiverReason: reason.trim() },
        });
        await this.recompute(tx, charge.studentId);
      }),
    );

    await this.audit.record({
      action: "fee.waive",
      entityType: "FeeCharge",
      entityId: chargeId,
      before: { amount: Number(charge.amount), waivedAt: null },
      after: { waivedAt: new Date().toISOString(), reason: reason.trim() },
    });

    this.logger.warn(
      `Fee waived: ${Number(charge.amount)} for student ${charge.studentId} by ${actor.userId}. ${reason.trim()}`,
    );

    return this.statementFor(charge.studentId);
  }

  /** FR-PAY-026 — a student's statement: every line, and what is left. */
  async statementFor(studentId: string) {
    // Through the scoped client, so a student asking for somebody else's gets
    // nothing rather than somebody else's finances.
    const student = await this.prisma.scoped.student.findFirst({
      where: { id: studentId },
      select: {
        id: true,
        registrationNo: true,
        outstandingBalance: true,
        user: { select: { fullName: true } },
      },
    });
    if (!student) throw new AppError("RESOURCE_NOT_FOUND");

    const [charges, payments] = await Promise.all([
      this.prisma.asSystem((db) =>
        db.feeCharge.findMany({ where: { studentId, deletedAt: null } }),
      ),
      this.prisma.asSystem((db) => db.payment.findMany({ where: { studentId } })),
    ]);

    const asCharges: Charge[] = charges.map((c: (typeof charges)[number]) => ({
      id: c.id,
      description: c.description,
      amount: Number(c.amount),
      dueDate: c.dueDate,
      createdAt: c.createdAt,
      waivedAt: c.waivedAt,
      waiverReason: c.waiverReason,
    }));
    const asPayments: LedgerPayment[] = payments.map((p: (typeof payments)[number]) => ({
      id: p.id,
      amount: Number(p.verifiedAmount),
      paidOn: p.paymentDate,
      method: p.method,
      reference: p.bankReference,
      isReversed: p.isReversed,
      reversedAt: p.reversedAt,
      reversalReason: p.reversalReason,
    }));

    const balance = balanceOf(asCharges, asPayments);

    return {
      student: {
        id: student.id,
        name: student.user.fullName,
        registrationNo: student.registrationNo,
      },
      balance,
      aging: aging(asCharges, asPayments, new Date()),
      lines: statement(asCharges, asPayments),
      charges: asCharges.map((c) => ({
        id: c.id,
        description: c.description,
        amount: c.amount,
        dueDate: c.dueDate,
        waived: c.waivedAt != null,
      })),
      // The payments themselves, and not only their effect on the balance.
      // Without this a statement says what a student owes and never what they
      // have handed over, and nothing on the screen can find a payment to
      // print a receipt for — which made the receipts unreachable.
      payments: asPayments.map((p) => ({
        id: p.id,
        amount: p.amount,
        paidOn: p.paidOn,
        method: p.method,
        reference: p.reference,
        // Shown, not netted away (BR-RPT-05): a student holding a receipt for
        // a reversed payment must find it here rather than nowhere.
        isReversed: p.isReversed,
        reversedAt: p.reversedAt,
        reversalReason: p.reversalReason,
      })),
      // Said in words, because "outstanding: -2000" is not obviously credit.
      note:
        balance.outstanding > 0
          ? `${balance.outstanding} outstanding.`
          : balance.outstanding < 0
            ? `In credit by ${Math.abs(balance.outstanding)}. The Institute owes this back.`
            : "Nothing outstanding.",
    };
  }

  /** A student's own statement, without needing to know their own id. */
  async myStatement() {
    return this.statementFor(requireOwnStudentId());
  }

  /**
   * FR-PAY-030 — who owes what, worst first.
   *
   * Reads the MATERIALISED balance rather than walking every ledger, which is
   * the reason that column is maintained at all. The aging is computed per row
   * for the ones that matter, so the list can say how old the debt is without
   * doing it for students who owe nothing.
   */
  async debtors() {
    const students = await this.prisma.scoped.student.findMany({
      where: { deletedAt: null, outstandingBalance: { gt: 0 } },
      select: {
        id: true,
        registrationNo: true,
        outstandingBalance: true,
        user: { select: { fullName: true, email: true } },
      },
      orderBy: { outstandingBalance: "desc" },
      take: 200,
    });

    return Promise.all(
      students.map(async (s: (typeof students)[number]) => {
        const [charges, payments] = await Promise.all([
          this.prisma.asSystem((db) =>
            db.feeCharge.findMany({ where: { studentId: s.id, deletedAt: null } }),
          ),
          this.prisma.asSystem((db) => db.payment.findMany({ where: { studentId: s.id } })),
        ]);
        const a = aging(
          charges.map((c: (typeof charges)[number]) => ({
            id: c.id,
            description: c.description,
            amount: Number(c.amount),
            dueDate: c.dueDate,
            createdAt: c.createdAt,
            waivedAt: c.waivedAt,
            waiverReason: c.waiverReason,
          })),
          payments.map((p: (typeof payments)[number]) => ({
            id: p.id,
            amount: Number(p.verifiedAmount),
            paidOn: p.paymentDate,
            method: p.method,
            reference: p.bankReference,
            isReversed: p.isReversed,
            reversedAt: p.reversedAt,
            reversalReason: p.reversalReason,
          })),
          new Date(),
        );
        return {
          studentId: s.id,
          name: s.user.fullName,
          registrationNo: s.registrationNo,
          outstanding: Number(s.outstandingBalance),
          oldestOverdueDays: a.oldestOverdueDays,
          overdue90Plus: a.overdue90Plus,
        };
      }),
    );
  }

  /**
   * Recalculate what a student owes and store it.
   *
   * THE ONLY PLACE THAT WRITES outstandingBalance. Takes the transaction it
   * must run inside, so a caller cannot accidentally recompute outside the
   * change that made it necessary.
   */
  private async recompute(db: Prisma.TransactionClient, studentId: string): Promise<number> {
    const [charges, payments] = await Promise.all([
      db.feeCharge.findMany({ where: { studentId, deletedAt: null } }),
      db.payment.findMany({ where: { studentId } }),
    ]);

    const balance = balanceOf(
      charges.map((c) => ({
        id: c.id,
        description: c.description,
        amount: Number(c.amount),
        dueDate: c.dueDate,
        createdAt: c.createdAt,
        waivedAt: c.waivedAt,
        waiverReason: c.waiverReason,
      })),
      payments.map((p) => ({
        id: p.id,
        amount: Number(p.verifiedAmount),
        paidOn: p.paymentDate,
        method: p.method,
        reference: p.bankReference,
        isReversed: p.isReversed,
        reversedAt: p.reversedAt,
        reversalReason: p.reversalReason,
      })),
    );

    await db.student.update({
      where: { id: studentId },
      data: { outstandingBalance: balance.outstanding },
    });

    return balance.outstanding;
  }

  /**
   * The same recompute, for a service that writes a Payment of its own.
   *
   * PaymentSubmission.verify creates the Payment row inside its own
   * transaction — it has a slip, a variance and a submission to close in the
   * same breath, which recordPayment() knows nothing about — and a Payment
   * that lands without the balance moving is exactly the drift the note above
   * warns of. So the recompute is reachable, but only WITH a transaction
   * client: the signature is what stops it being called on its own, after the
   * fact, from somewhere that has already committed.
   */
  async recomputeBalance(db: Prisma.TransactionClient, studentId: string): Promise<number> {
    return this.recompute(db, studentId);
  }

  /**
   * FR-PAY-032 — rebuild every balance from the ledger.
   *
   * Exists because a materialised figure needs a way back to the truth. If a
   * bug, an import or a hand-edited row ever puts a balance out of step, this
   * is what proves it and fixes it, and it reports what it changed rather than
   * quietly correcting the evidence.
   */
  async reconcile() {
    const students = await this.prisma.asSystem((db) =>
      db.student.findMany({ where: { deletedAt: null }, select: { id: true, outstandingBalance: true } }),
    );

    const corrected: Array<{ studentId: string; was: number; now: number }> = [];
    for (const s of students) {
      const was = Number(s.outstandingBalance);
      const now = await this.prisma.asSystem((db) =>
        db.$transaction(async (tx) => this.recompute(tx, s.id)),
      );
      if (Math.abs(was - now) > 0.005) corrected.push({ studentId: s.id, was, now });
    }

    if (corrected.length > 0) {
      await this.audit.record({
        action: "fee.reconcile",
        entityType: "Student",
        entityId: corrected[0]?.studentId ?? "",
        after: { corrected: corrected.length, details: corrected.slice(0, 50) },
      });
    }

    return {
      checked: students.length,
      corrected: corrected.length,
      details: corrected,
      message:
        corrected.length === 0
          ? `All ${students.length} balances already agreed with the ledger.`
          : `${corrected.length} of ${students.length} balances were out of step and have been corrected.`,
    };
  }
}
