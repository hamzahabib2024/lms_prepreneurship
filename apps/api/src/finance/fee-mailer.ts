import { Injectable, Logger } from "@nestjs/common";
import { PAYMENT_METHOD_LABELS, type PaymentMethodValue } from "@lms/shared";
import { EmailChannel } from "../notification/channel/email.channel";
import type { MessageAttachment } from "../notification/channel/notification.channel";
import type { ReceiptDocument } from "./receipt-document";

/**
 * The three emails a fee payment produces — FR-PAY-039, FR-COM-013.
 *
 * THROUGH THE EXISTING CHANNEL, NOT A SECOND MAIL SYSTEM. `EmailChannel` is
 * the Institute's mail: it holds the SMTP settings, honours MAIL_DRIVER=log,
 * writes to the simulator outbox when nothing is configured, and never claims
 * to have sent something it did not. Everything here goes through it.
 *
 * SENT DIRECTLY RATHER THAN AS A NOTIFICATION, for one reason: THE RECEIPT IS
 * ATTACHED. A notification writes its own body into a database row that
 * outlives the message by years, and a PDF cannot travel that way. The inbox
 * copy is still raised — by the service that calls this — with EMAIL held back,
 * so a student gets one email with their receipt in it rather than two without.
 *
 * NO SEND MAY FAIL THE THING IT FOLLOWS. A payment that has been verified has
 * been verified whether or not the mail server answered; the ledger is already
 * written and the receipt already numbered. Every method reports what happened
 * so the screen can say "verified, and the receipt has been emailed" or
 * "verified — the email could not be sent", which are different sentences and
 * the administrator needs the right one.
 *
 * WRITTEN FOR A STUDENT TO READ. Not "your payment record has been persisted"
 * — "we have received your payment and are checking it". Every message names
 * the next thing that will happen and whether the student has to do anything,
 * because the question behind all three is the same: is this finished?
 */
@Injectable()
export class FeeMailer {
  private readonly logger = new Logger(FeeMailer.name);

  constructor(private readonly email: EmailChannel) {}

  /**
   * "We have your submission." — sent the moment a student submits.
   *
   * THE POINT OF IT IS THE WAITING. Somebody who has just transferred 25,000
   * rupees and uploaded a photograph has no way of knowing the System received
   * any of it. Silence for two days reads as a lost payment, and the next thing
   * that happens is a telephone call — which is the cost this whole feature
   * exists to remove. So it confirms the figure, names the reference, and says
   * plainly how long checking takes and that they need do nothing meanwhile.
   */
  async paymentSubmitted(input: {
    to: string;
    fullName: string;
    reference: string;
    amount: number;
    currency: string;
    method: string;
    bankReference: string | null;
    paidOn: Date;
    remainingBefore: number | null;
    viewUrl: string | null;
  }): Promise<Sent> {
    const body = [
      `Dear ${input.fullName},`,
      "",
      "We have received your payment submission. Nothing further is needed from",
      "you right now — our office will check the receipt you sent us against the",
      "bank record, and we will write to you again with the outcome.",
      "",
      "  What you told us you paid:  " + money(input.amount, input.currency),
      "  How you paid:               " + methodLabel(input.method),
      ...(input.bankReference ? [`  Transaction reference:      ${input.bankReference}`] : []),
      "  Date of payment:            " + longDate(input.paidOn),
      "  Your submission reference:  " + input.reference,
      "",
      // Said explicitly. The single most likely misreading of a confirmation
      // email is that the payment is now settled.
      "This is a confirmation that we have your submission — it is not yet a",
      "receipt. Your fee account will be updated, and your official receipt",
      "issued, once we have verified the payment.",
      ...(input.remainingBefore !== null
        ? [
            "",
            `Your balance before this payment was ${money(input.remainingBefore, input.currency)}.`,
          ]
        : []),
      ...(input.viewUrl ? ["", "You can follow this here:", "", `  ${input.viewUrl}`] : []),
      "",
      "We usually check payments within two working days. If anything is unclear",
      "on the receipt you sent, we will tell you what we need rather than",
      "refusing it outright.",
    ].join("\n");

    return this.send(input.to, input.fullName, {
      kind: "fee.payment_submitted",
      title: `We have your payment submission — ${input.reference}`,
      body,
    });
  }

  /**
   * "It is verified, and here is your receipt." — with the PDF attached.
   *
   * THE ATTACHMENT IS THE WHOLE MESSAGE. A student who has to sign in to
   * fetch a document will not do it today, and the receipt they need in six
   * months is the one sitting in their mail. The link is offered as well, for
   * the copy that always works.
   */
  async paymentVerified(input: {
    to: string;
    fullName: string;
    receipt: ReceiptDocument;
    pdf: Buffer;
    viewUrl: string | null;
    /** Set only when the office verified a figure different from the claim. */
    claimedAmount: number | null;
  }): Promise<Sent> {
    const r = input.receipt;
    const cur = r.payment.currency;

    const body = [
      `Dear ${input.fullName},`,
      "",
      `Your payment of ${money(r.payment.amount, cur)} has been verified. Thank you.`,
      "",
      "  Receipt number:        " + r.receiptNo,
      "  Amount received:       " + money(r.payment.amount, cur),
      "  How you paid:          " + r.payment.methodLabel,
      ...(r.payment.bankReference ? [`  Transaction reference: ${r.payment.bankReference}`] : []),
      "  Date of payment:       " + longDate(r.payment.paidOn),
      "  Verified on:           " + longDate(r.verification.verifiedAt),
      ...(r.student.programme ? [`  Course:                ${r.student.programme}`] : []),
      "",
      // Said before the balance, because a student who was expecting a
      // different figure needs the explanation next to the number, not
      // underneath it.
      ...(input.claimedAmount !== null && Math.abs(input.claimedAmount - r.payment.amount) > 0.005
        ? [
            `Please note: you submitted ${money(input.claimedAmount, cur)} and we have verified`,
            `${money(r.payment.amount, cur)} — this is the amount the bank record shows.`,
            ...(r.verification.note ? ["", r.verification.note] : []),
            "",
          ]
        : []),
      ...(r.ledger
        ? [
            "Your fee account now stands at:",
            "",
            "  Total fee for the course:  " + money(r.ledger.totalFee, cur),
            "  Paid and verified:         " +
              money(r.ledger.totalFee - r.ledger.balanceAfter, cur),
            "  Still to pay:              " + money(r.ledger.balanceAfter, cur),
            "",
            r.ledger.balanceAfter <= 0.005
              ? "Your fee is paid in full. Nothing further is owed."
              : "",
          ].filter((l) => l !== "")
        : []),
      "",
      "Your official receipt is attached to this message as a PDF. Please keep it",
      "— it is your proof of payment, and the receipt number above is what to",
      "quote if you ever need to ask us about it.",
      ...(input.viewUrl
        ? ["", "You can also view, download or print it here at any time:", "", `  ${input.viewUrl}`]
        : []),
    ].join("\n");

    return this.send(
      input.to,
      input.fullName,
      {
        kind: "fee.payment_verified",
        title: `Payment verified — fee receipt ${r.receiptNo}`,
        body,
      },
      [{ filename: `${r.receiptNo}.pdf`, contentType: "application/pdf", content: input.pdf }],
    );
  }

  /**
   * "We could not verify it." — and, crucially, what to do about it.
   *
   * THE REASON IS THE MESSAGE. A rejection that says only "rejected" sends
   * somebody to the office to find out why, which is the outcome the whole
   * workflow exists to avoid. Most rejections here are fixable in five minutes
   * — a photograph too dark to read, a figure that does not match the slip —
   * so the message says which, says the money is not lost, and says the
   * submission can simply be made again.
   */
  async paymentRejected(input: {
    to: string;
    fullName: string;
    reference: string;
    amount: number;
    currency: string;
    reason: string;
    submitUrl: string | null;
  }): Promise<Sent> {
    const body = [
      `Dear ${input.fullName},`,
      "",
      `We have looked at the payment of ${money(input.amount, input.currency)} you submitted`,
      `(reference ${input.reference}) and we have not been able to verify it.`,
      "",
      "The reason given by our office is:",
      "",
      `  ${input.reason}`,
      "",
      // The reassurance is not politeness. Somebody told their payment was
      // "rejected" reasonably fears the money has gone somewhere unrecoverable.
      "This does not mean your money has been lost. It means we could not match",
      "what you sent us to a payment in our records. If you have paid, please",
      "submit it again with a clearer photograph or the correct transaction",
      "reference, and we will look at it straight away.",
      ...(input.submitUrl
        ? ["", "You can submit it again here:", "", `  ${input.submitUrl}`]
        : []),
      "",
      "If you believe this is a mistake, contact the office and quote your",
      `reference ${input.reference}. Everything you sent us has been kept.`,
    ].join("\n");

    return this.send(input.to, input.fullName, {
      kind: "fee.payment_rejected",
      title: `About your payment submission — ${input.reference}`,
      body,
    });
  }

  /**
   * One place, so all three fail the same way.
   *
   * Swallowed on purpose: see the note at the top. A verified payment is
   * verified whether or not the mail server answered, and the caller is told
   * what happened rather than being failed.
   */
  private async send(
    to: string,
    fullName: string,
    message: { kind: string; title: string; body: string },
    attachments?: MessageAttachment[],
  ): Promise<Sent> {
    try {
      const outcome = await this.email.send(
        { userId: "student", fullName, email: to, phone: null, phoneIsWhatsapp: false },
        {
          ...message,
          linkPath: null,
          isUrgent: false,
          ...(attachments ? { attachments } : {}),
        },
      );
      // The kind and the outcome, never the body — these carry a student's
      // balance and their bank reference (SEC-PRV).
      this.logger.log(
        JSON.stringify({ event: "fee.email", kind: message.kind, status: outcome.status }),
      );
      return { sent: outcome.status === "SENT", detail: outcome.detail };
    } catch (err) {
      const detail = err instanceof Error ? err.message : "The mailer raised an unknown error.";
      this.logger.warn(`Fee email (${message.kind}) failed: ${detail}`);
      return { sent: false, detail };
    }
  }
}

export interface Sent {
  sent: boolean;
  detail: string;
}

/** Grouped and never abbreviated, exactly as it reads on the screen. */
function money(amount: number, currency: string): string {
  const whole = Number.isInteger(amount);
  const body = Math.abs(amount).toLocaleString("en-PK", {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  });
  return currency === "PKR" ? `Rs ${body}` : `${currency} ${body}`;
}

function longDate(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

function methodLabel(method: string): string {
  return PAYMENT_METHOD_LABELS[method as PaymentMethodValue] ?? method;
}
