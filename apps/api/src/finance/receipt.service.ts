import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { SettingsService } from "../settings/settings.service";
import { RegistrationNumberService } from "../admission/registration-number.service";
import { getActor } from "../prisma/actor-context";
import { AppError } from "@lms/shared";

export interface Receipt {
  receiptNo: string;
  issuedAt: Date;
  /** True when this print is not the first. Shown on the document. */
  reprint: boolean;

  institute: { name: string; campus: string };
  student: {
    fullName: string;
    registrationNo: string;
    programme: string | null;
    section: string | null;
  };
  payment: {
    id: string;
    amount: number;
    currency: string;
    amountInWords: string;
    paidOn: Date;
    method: string;
    bankReference: string | null;
    receivedBy: string;
  };
  /** Present only when the payment has been reversed. */
  reversal: { reversedAt: Date; reason: string | null } | null;
  balanceAfter: number | null;
  note: string;
}

/**
 * Receipts — SRS §5.16, FR-PAY-039..042.
 *
 * A student who hands over 30,000 rupees in cash gets a piece of paper. That
 * paper is the Institute's admission that it has the money, so three things
 * about it are not negotiable.
 *
 * THE NUMBER IS ALLOCATED ONCE AND NEVER CHANGES. A student holding a printed
 * receipt and the Institute's own copy must show the same number, or neither
 * document proves anything. So it is allocated on the first request, stored,
 * and every later request returns the same one — marked as a REPRINT, because
 * two pieces of paper bearing one number need to be distinguishable when both
 * are on the desk.
 *
 * A REVERSED PAYMENT STILL HAS A RECEIPT, and it says so. Refusing to print one
 * would leave the student holding the only record of a transaction the
 * Institute has since undone, with nothing to show what happened. The receipt
 * is issued and states the reversal on its face (BR-RPT-05, and the same
 * reasoning as the ledger).
 *
 * THE AMOUNT IS WRITTEN IN WORDS as well as figures. That is not decoration:
 * it is the ordinary defence against a digit being added to a printed line,
 * and every receipt book in the country does it.
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
   */
  async forPayment(paymentId: string, ip?: string): Promise<Receipt> {
    const actor = getActor();
    if (!actor) throw new AppError("AUTH_TOKEN_INVALID");

    // findFIRST, not findUnique. The scope extension injects an AND into the
    // where clause, and findUnique accepts only unique fields — so the two
    // together throw a validation error at runtime for any role that IS
    // scoped, while working perfectly for a Super Admin, who has no
    // predicate. That is how this reached a probe: every staff test passed.
    const payment = await this.prisma.scoped.payment.findFirst({
      where: { id: paymentId },
      include: {
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

    const resolved = await this.settings.resolveFor();
    const instituteName =
      (await this.settings.text("institute.name")) ?? "The Institute";
    const campus = (await this.settings.text("institute.campus")) ?? "";

    // FR-LOG-003. Printing a receipt is a financial act — somebody produced a
    // document the Institute stands behind — so each printing is recorded,
    // including the reprints.
    await this.audit.record({
      action: issued.wasNew ? "receipt.issue" : "receipt.reprint",
      entityType: "Payment",
      entityId: payment.id,
      after: { receiptNo: issued.receiptNo, by: actor.userId },
      ...(ip ? { ipAddress: ip } : {}),
    });

    const amount = Number(payment.verifiedAmount);
    const section = payment.student?.currentSection;

    return {
      receiptNo: issued.receiptNo,
      issuedAt: issued.issuedAt,
      reprint: !issued.wasNew,
      institute: { name: instituteName, campus },
      student: {
        fullName: payment.student?.user.fullName ?? "",
        registrationNo: payment.student?.registrationNo ?? "",
        programme: section?.batch.academicSession.programme.name ?? null,
        section: section?.name ?? null,
      },
      payment: {
        id: payment.id,
        amount,
        currency: payment.currency,
        amountInWords: amountInWords(amount, payment.currency),
        paidOn: payment.paymentDate,
        method: payment.method,
        bankReference: payment.bankReference,
        receivedBy: await this.nameOf(payment.verifiedBy),
      },
      reversal: payment.isReversed
        ? { reversedAt: payment.reversedAt!, reason: payment.reversalReason }
        : null,
      balanceAfter: null,
      note: payment.isReversed
        ? "This payment has been REVERSED. This receipt is kept so the record is complete; " +
          "it is not proof of a payment the Institute holds."
        : String(resolved["finance.receiptNote"] ?? "") ||
          "Please keep this receipt. It is your proof of payment.",
    };
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
  ): Promise<{ receiptNo: string; issuedAt: Date; wasNew: boolean }> {
    if (existing) {
      const row = await this.prisma.scoped.payment.findFirst({
        where: { id: paymentId },
        select: { receiptIssuedAt: true },
      });
      return { receiptNo: existing, issuedAt: row?.receiptIssuedAt ?? new Date(), wasNew: false };
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
          return {
            receiptNo: fresh.receiptNo,
            issuedAt: fresh.receiptIssuedAt ?? new Date(),
            wasNew: false,
          };
        }

        const year = paidOn.getUTCFullYear();
        const sequence = await this.numbers.allocateSequence(tx, `RECEIPT|${year}`);
        const receiptNo = `RCPT-${year}-${String(sequence).padStart(5, "0")}`;
        const issuedAt = new Date();

        await tx.payment.update({
          where: { id: paymentId },
          data: { receiptNo, receiptIssuedAt: issuedAt },
        });
        return { receiptNo, issuedAt, wasNew: true };
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
