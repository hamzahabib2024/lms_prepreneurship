import { Injectable } from "@nestjs/common";
import { AppError, PAYMENT_METHOD_LABELS, type PaymentMethodValue } from "@lms/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { SettingsService } from "../settings/settings.service";
import { RegistrationNumberService } from "../admission/registration-number.service";
import { getActor } from "../prisma/actor-context";
import { renderReceiptPdf, type ReceiptDocument } from "./receipt-document";
import { summarise } from "./fee-summary";

/**
 * Receipts — SRS §5.16, FR-PAY-039..042.
 *
 * A student who hands over 30,000 rupees gets a piece of paper. That paper is
 * the Institute's admission that it has the money, so four things about it are
 * not negotiable.
 *
 * THE NUMBER IS ALLOCATED ONCE AND NEVER CHANGES. A student holding a printed
 * receipt and the Institute's own copy must show the same number, or neither
 * document proves anything. So it is allocated on the first request, stored,
 * and every later request returns the same one — marked as a REPRINT, because
 * two pieces of paper bearing one number will end up on a desk together and
 * need to be distinguishable.
 *
 * A REVERSED PAYMENT STILL HAS A RECEIPT, and it says so on its face. Refusing
 * to print one would leave the student holding the only record of a
 * transaction the Institute has since undone, with nothing to show what
 * happened (BR-RPT-05).
 *
 * THE AMOUNT IS WRITTEN IN WORDS as well as figures. Not decoration: it is the
 * ordinary defence against a digit being added to a printed line, and every
 * receipt book in the country does it.
 *
 * IT NOW CARRIES THE BALANCE, and that is the change that matters most to the
 * people using it. A receipt that says only "we received 25,000" leaves the
 * one question the holder actually has — "so what do I still owe?" —
 * unanswered, and the answer arrives by telephone call to the office. The
 * figures are computed from the ledger at the moment of issue and printed as
 * a four-line account.
 */
@Injectable()
export class ReceiptService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly numbers: RegistrationNumberService,
  ) {}

  /**
   * The receipt for a payment, issuing its number if it has none.
   *
   * Scoped by the extension: a student reaching this for somebody else's
   * payment finds nothing, rather than being told they may not (ARC-051).
   *
   * `silent` suppresses the audit entry, and exists for exactly one caller —
   * the verification path, which has already recorded that it issued a receipt
   * and would otherwise write two entries for one act.
   */
  async forPayment(paymentId: string, ip?: string, silent = false): Promise<ReceiptDocument> {
    const actor = getActor();
    if (!actor) throw new AppError("AUTH_TOKEN_INVALID");

    // findFIRST, not findUnique. The scope extension injects an AND into the
    // where clause, and findUnique accepts only unique fields — so the two
    // together throw a validation error at runtime for any role that IS
    // scoped, while working perfectly for a Super Admin, who has no
    // predicate. That is how this once reached a probe: every staff test
    // passed.
    const payment = await this.prisma.scoped.payment.findFirst({
      where: { id: paymentId },
      include: {
        submission: { select: { reference: true } },
        student: {
          include: {
            user: { select: { fullName: true } },
            currentSection: {
              include: { batch: { include: { academicSession: { include: { programme: true } } } } },
            },
          },
        },
      },
    });
    if (!payment) throw new AppError("RESOURCE_NOT_FOUND");

    const issued = await this.ensureNumber(payment.id, payment.receiptNo, payment.paymentDate);

    /*
     * IS THIS A DUPLICATE? — and the answer is NOT "does the number already
     * exist".
     *
     * It used to be, and that was right while a receipt number was allocated
     * by the first person to press Print. It stopped being right the day
     * verification began issuing the receipt itself: the number is now
     * allocated the moment the money is confirmed, so by the time the student
     * opened their own copy the number existed, and the first document they
     * ever saw was stamped DUPLICATE — THIS RECEIPT HAS BEEN PRINTED BEFORE.
     * Which is precisely the sentence that makes somebody doubt a financial
     * document, printed across the one screen that exists to reassure them.
     *
     * So the question the stamp actually answers is "has a human produced this
     * document before" — because the stamp exists so that two pieces of paper
     * bearing one number can be told apart on a desk. A production is a
     * non-silent call: a print, a download, a view. The copy the System
     * attaches to the verification email is `silent`, it is the holder's FIRST
     * copy, and it is not one of them.
     *
     * The audit log is the record of those productions, so it is what is
     * asked. It is one indexed count against a table this act already writes
     * to, and it cannot drift from the truth the way a second column would.
     */
    const producedBefore = silent
      ? 0
      : await this.prisma.asSystem((db) =>
          db.auditLog.count({
            where: {
              entityType: "Payment",
              entityId: payment.id,
              action: { in: ["receipt.issue", "receipt.reprint"] },
            },
          }),
        );

    // FR-LOG-003. Producing a receipt is a financial act — somebody made a
    // document the Institute stands behind — so each one is recorded,
    // including the reprints.
    if (!silent) {
      await this.audit.record({
        action: producedBefore === 0 ? "receipt.issue" : "receipt.reprint",
        entityType: "Payment",
        entityId: payment.id,
        after: { receiptNo: issued.receiptNo, by: actor.userId },
        ...(ip ? { ipAddress: ip } : {}),
      });
    }

    const [institute, note, ledger] = await Promise.all([
      this.institute(),
      this.receiptNote(payment.isReversed),
      this.ledgerAt(payment.studentId, payment.id),
    ]);

    const amount = Number(payment.verifiedAmount);
    const section = payment.student.currentSection;
    const method = payment.method as PaymentMethodValue;

    return {
      receiptNo: issued.receiptNo,
      issuedAt: issued.issuedAt,
      // See the note above: a duplicate is a document produced twice, not a
      // number allocated twice.
      reprint: producedBefore > 0,
      status: payment.isReversed ? "REVERSED" : "VERIFIED",
      institute,
      student: {
        fullName: payment.student.user.fullName,
        registrationNo: payment.student.registrationNo,
        programme: section?.batch.academicSession.programme.name ?? null,
        section: section?.name ?? null,
        rollNo: payment.student.currentRollNo,
      },
      payment: {
        id: payment.id,
        amount,
        currency: payment.currency,
        amountInWords: amountInWords(amount, payment.currency),
        paidOn: payment.paymentDate,
        method,
        methodLabel: PAYMENT_METHOD_LABELS[method] ?? method,
        bankReference: payment.bankReference,
        submissionReference: payment.submission?.reference ?? null,
      },
      verification: {
        verifiedBy: await this.nameOf(payment.verifiedBy),
        verifiedAt: payment.verifiedAt,
        note: payment.varianceReason,
      },
      reversal: payment.isReversed
        ? { reversedAt: payment.reversedAt!, reason: payment.reversalReason }
        : null,
      ledger,
      verifyUrl: this.verifyUrl(issued.receiptNo),
      note,
    };
  }

  /** The same document, as a print-ready A4 PDF. */
  async pdfFor(paymentId: string, ip?: string): Promise<{ filename: string; body: Buffer }> {
    const receipt = await this.forPayment(paymentId, ip);
    return {
      // The receipt number, so a folder of downloads sorts and searches by the
      // thing people quote. Never the student's name — these end up in shared
      // download folders.
      filename: `${receipt.receiptNo}.pdf`,
      body: renderReceiptPdf(receipt),
    };
  }

  /** The PDF for a document already built, without reading it all again. */
  render(receipt: ReceiptDocument): Buffer {
    return renderReceiptPdf(receipt);
  }

  /**
   * The student's account as it stood when this payment landed.
   *
   * "PREVIOUSLY PAID" MEANS BEFORE THIS ONE, and getting that wrong is the
   * whole risk here: a receipt whose arithmetic does not add up is worse than
   * a receipt with no arithmetic on it. So the figure is every verified,
   * unreversed payment EXCEPT this one, and the balance after is the total fee
   * less all of them including this one.
   *
   * A reversed payment contributes nothing to either figure — `summarise`
   * excludes it — which is right: the receipt for a reversed payment prints
   * the account as it stands, and the reversal notice on its face says why the
   * money is not in it.
   */
  private async ledgerAt(
    studentId: string,
    paymentId: string,
  ): Promise<ReceiptDocument["ledger"]> {
    const [charges, payments] = await Promise.all([
      this.prisma.asSystem((db) =>
        db.feeCharge.findMany({
          where: { studentId, deletedAt: null },
          select: { amount: true, waivedAt: true },
        }),
      ),
      this.prisma.asSystem((db) =>
        db.payment.findMany({
          where: { studentId },
          select: { id: true, verifiedAmount: true, isReversed: true },
        }),
      ),
    ]);

    // Nothing has ever been charged. Printing "Total fee: Rs 0" beside a
    // payment of 25,000 would be a receipt that contradicts itself, so the
    // block is omitted instead (see the null branch in the layout).
    if (charges.length === 0) return null;

    const asPayments = payments.map((p) => ({
      amount: Number(p.verifiedAmount),
      isReversed: p.isReversed,
    }));
    const thisOne = payments.find((p) => p.id === paymentId);
    const thisAmount = thisOne && !thisOne.isReversed ? Number(thisOne.verifiedAmount) : 0;

    const all = summarise(
      charges.map((c) => ({ amount: Number(c.amount), waivedAt: c.waivedAt })),
      asPayments,
      [],
    );

    return {
      totalFee: all.totalFee,
      previouslyPaid: round2(all.verified - thisAmount),
      thisPayment: Number(thisOne?.verifiedAmount ?? 0),
      balanceAfter: round2(all.totalFee - all.verified),
    };
  }

  private async institute(): Promise<ReceiptDocument["institute"]> {
    const [name, campus, phone, email, website] = await Promise.all([
      this.settings.text("institute.name"),
      this.settings.text("institute.campus"),
      this.settings.text("institute.phone"),
      this.settings.text("institute.email"),
      this.settings.text("institute.website"),
    ]);
    return {
      name: name || "The Institute",
      campus: campus || "",
      phone: phone || "",
      email: email || "",
      website: website || "",
    };
  }

  private async receiptNote(isReversed: boolean): Promise<string> {
    if (isReversed) {
      return (
        "This payment has been REVERSED. This receipt is kept so the record is complete; " +
        "it is not proof of a payment the Institute holds."
      );
    }
    // The settings map is loosely typed, and a note that is not a string would
    // print on the receipt as "[object Object]". A document the Institute
    // hands to a student does not get to look broken.
    const configured = await this.settings.text("finance.receiptNote");
    return configured || "Please keep this receipt. It is your proof of payment.";
  }

  /**
   * Where a holder can check the receipt.
   *
   * THE NUMBER ALONE, and nothing about the person. A receipt is shown to
   * employers, parents and landlords; a link that discloses a student's name
   * or balance to anybody who scans the paper would be a privacy failure
   * created by a convenience (SEC-PRV). Null when no public address is
   * configured, so the document prints without a code rather than with a code
   * that goes nowhere.
   */
  private verifyUrl(receiptNo: string): string | null {
    const base = (process.env["PUBLIC_WEB_URL"] ?? "").trim().replace(/\/+$/, "");
    return base ? `${base}/receipts/verify/${encodeURIComponent(receiptNo)}` : null;
  }

  /**
   * Allocates the number if there is not one, atomically.
   *
   * The series is per calendar year of the PAYMENT, not of today, so a receipt
   * printed in January for a December payment does not carry next year's
   * number and land in the wrong year's books.
   */
  private async ensureNumber(
    paymentId: string,
    existing: string | null,
    paidOn: Date,
  ): Promise<{ receiptNo: string; issuedAt: Date }> {
    if (existing) {
      const row = await this.prisma.scoped.payment.findFirst({
        where: { id: paymentId },
        select: { receiptIssuedAt: true },
      });
      return { receiptNo: existing, issuedAt: row?.receiptIssuedAt ?? new Date() };
    }

    return this.prisma.asSystem((db) =>
      db.$transaction(async (tx) => {
        // Re-read inside the transaction: two clerks printing the same receipt
        // at once must not allocate two numbers for one payment.
        const fresh = await tx.payment.findUnique({
          where: { id: paymentId },
          select: { receiptNo: true, receiptIssuedAt: true },
        });
        if (fresh?.receiptNo) {
          return { receiptNo: fresh.receiptNo, issuedAt: fresh.receiptIssuedAt ?? new Date() };
        }

        const year = paidOn.getUTCFullYear();
        const sequence = await this.numbers.allocateSequence(tx, `RECEIPT|${year}`);
        const receiptNo = `RCPT-${year}-${String(sequence).padStart(5, "0")}`;
        const issuedAt = new Date();

        await tx.payment.update({
          where: { id: paymentId },
          data: { receiptNo, receiptIssuedAt: issuedAt },
        });
        return { receiptNo, issuedAt };
      }),
    );
  }

  private async nameOf(userId: string): Promise<string> {
    const user = await this.prisma.asSystem((db) =>
      db.user.findUnique({ where: { id: userId }, select: { fullName: true } }),
    );
    return user?.fullName ?? "";
  }
}

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

const ONES = [
  "",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function underThousand(n: number): string {
  if (n === 0) return "";
  if (n < 20) return ONES[n]!;
  if (n < 100) {
    const rest = n % 10;
    return TENS[Math.floor(n / 10)]! + (rest ? ` ${ONES[rest]}` : "");
  }
  const rest = n % 100;
  return `${ONES[Math.floor(n / 100)]} Hundred${rest ? ` and ${underThousand(rest)}` : ""}`;
}

/**
 * The amount in words, in the SOUTH ASIAN system: lakh and crore, not million.
 *
 * Writing "One Million Two Hundred Thousand" on a receipt in Islamabad is not
 * wrong so much as unreadable — nobody here counts that way, and a receipt
 * whose words cannot be checked against its figures fails at the one job the
 * words have.
 */
export function amountInWords(amount: number, currency = "PKR"): string {
  if (!Number.isFinite(amount) || amount < 0) return "";

  const totalPaisa = Math.round(amount * 100);
  const rupees = Math.floor(totalPaisa / 100);
  const paisa = totalPaisa % 100;
  const unit = currency === "PKR" ? "Rupees" : currency;

  if (rupees === 0 && paisa === 0) return `${unit} Zero Only`;

  const parts: string[] = [];
  let left = rupees;

  const crore = Math.floor(left / 10_000_000);
  left %= 10_000_000;
  const lakh = Math.floor(left / 100_000);
  left %= 100_000;
  const thousand = Math.floor(left / 1_000);
  left %= 1_000;

  if (crore) parts.push(`${underThousand(crore)} Crore`);
  if (lakh) parts.push(`${underThousand(lakh)} Lakh`);
  if (thousand) parts.push(`${underThousand(thousand)} Thousand`);
  if (left) parts.push(underThousand(left));

  const words = parts.join(" ");
  const paisaWords = paisa > 0 ? ` and ${underThousand(paisa)} Paisa` : "";
  return `${unit} ${words || "Zero"}${paisaWords} Only`;
}
