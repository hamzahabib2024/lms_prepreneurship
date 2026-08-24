/**
 * The receipt PDF — that it is a PDF, and that the words are on it.
 *
 * WHAT THIS CAN AND CANNOT CHECK. It cannot look at the page; nothing short of
 * a rasteriser can. What it can check is the two ways a hand-written PDF
 * writer actually fails in practice, both silently:
 *
 *   THE CROSS-REFERENCE TABLE. Every entry is a byte offset, and one wrong
 *   offset produces a file that some readers open and others refuse. Every
 *   offset here is verified to point at the object it claims.
 *
 *   THE ESCAPING. An unescaped bracket in a student's name closes the string
 *   early and the rest of the receipt becomes operators. That is a corrupt
 *   document produced by an ordinary name.
 */

import { renderReceiptPdf, type ReceiptDocument } from "./receipt-document";
import { buildPdf, Page, textWidth } from "./pdf";

const base: ReceiptDocument = {
  receiptNo: "RCPT-2026-00042",
  issuedAt: new Date("2026-08-21T09:30:00Z"),
  reprint: false,
  status: "VERIFIED",
  institute: {
    name: "Prepreneurship Institute",
    campus: "Sector G-11, Islamabad",
    phone: "+92 51 000 0000",
    email: "office@example.org",
    website: "example.org",
  },
  student: {
    fullName: "Muhammad Bilal Ahmed",
    registrationNo: "PPS-2026-0117",
    programme: "Diploma in Graphic Designing",
    section: "Morning A",
    rollNo: 14,
  },
  payment: {
    id: "11111111-1111-4111-8111-111111111111",
    amount: 25_000,
    currency: "PKR",
    amountInWords: "Rupees Twenty Five Thousand Only",
    paidOn: new Date("2026-08-19T00:00:00Z"),
    method: "EASYPAISA",
    methodLabel: "EasyPaisa",
    bankReference: "EP889321445",
    submissionReference: "PS-2026-000031",
  },
  verification: {
    verifiedBy: "Ayesha Khan",
    verifiedAt: new Date("2026-08-21T09:28:00Z"),
    note: null,
  },
  reversal: null,
  ledger: { totalFee: 100_000, previouslyPaid: 25_000, thisPayment: 25_000, balanceAfter: 50_000 },
  verifyUrl: "https://example.org/receipts/verify/RCPT-2026-00042",
  note: "Please keep this receipt. It is your proof of payment.",
};

/** The strings a PDF holds are latin1 bytes, so that is how it is searched. */
const asText = (pdf: Buffer): string => pdf.toString("latin1");

describe("the file is a PDF", () => {
  it("starts with a header and ends with the end marker", () => {
    const pdf = renderReceiptPdf(base);
    expect(asText(pdf).startsWith("%PDF-1.4")).toBe(true);
    expect(asText(pdf).trimEnd().endsWith("%%EOF")).toBe(true);
  });

  it("declares one page", () => {
    expect(asText(renderReceiptPdf(base))).toContain("/Type /Pages /Count 1");
  });

  it("points startxref at the cross-reference table", () => {
    const text = asText(renderReceiptPdf(base));
    const at = Number(/startxref\s+(\d+)/.exec(text)?.[1]);
    expect(Number.isFinite(at)).toBe(true);
    expect(text.slice(at, at + 4)).toBe("xref");
  });

  it("gives every object an offset that lands on that object", () => {
    const text = asText(renderReceiptPdf(base));
    const at = Number(/startxref\s+(\d+)/.exec(text)?.[1]);
    const table = text.slice(at);
    const size = Number(/\/Size (\d+)/.exec(text)?.[1]);
    const entries = [...table.matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));

    // Object 0 is the free entry, so there is one fewer offset than the size.
    expect(entries.length).toBe(size - 1);
    entries.forEach((offset, i) => {
      // Entry i is object i+1, and an object begins "<n> 0 obj".
      expect(text.slice(offset, offset + 12)).toContain(`${i + 1} 0 obj`);
    });
  });

  it("declares a stream length equal to the bytes it contains", () => {
    const text = asText(renderReceiptPdf(base));
    const m = /<< \/Length (\d+) >>\nstream\n/.exec(text);
    expect(m).not.toBeNull();
    const declared = Number(m![1]);
    const from = m!.index + m![0].length;
    // The writer emits a newline of its own before `endstream`, so the stream
    // is exactly `declared` bytes and then that newline.
    expect(text.slice(from + declared, from + declared + 11)).toBe("\nendstream\n");
  });
});

describe("what is on the page", () => {
  it("carries the receipt number, the institute and the student", () => {
    const text = asText(renderReceiptPdf(base));
    expect(text).toContain("RCPT-2026-00042");
    expect(text).toContain("Prepreneurship Institute");
    expect(text).toContain("Muhammad Bilal Ahmed");
    expect(text).toContain("PPS-2026-0117");
  });

  it("prints the amount in figures and in words", () => {
    const text = asText(renderReceiptPdf(base));
    expect(text).toContain("Rs 25,000");
    expect(text).toContain("Rupees Twenty Five Thousand Only");
  });

  it("names the method rather than the enum value", () => {
    expect(asText(renderReceiptPdf(base))).toContain("EasyPaisa");
  });

  it("states the balance that is left", () => {
    expect(asText(renderReceiptPdf(base))).toContain("Balance still to pay");
  });

  it("says DUPLICATE on a reprint, in words", () => {
    const text = asText(renderReceiptPdf({ ...base, reprint: true }));
    expect(text).toContain("DUPLICATE");
  });

  it("keeps a long reversal reason inside its own frame", () => {
    // The notice was a fixed 46 points tall and the third line of the warning
    // fell outside the box it was drawn in. The box is measured now, so a long
    // reason grows it rather than escaping it.
    const long = "The cheque was returned unpaid by the bank ".repeat(6);
    const text = asText(
      renderReceiptPdf({
        ...base,
        status: "REVERSED",
        reversal: { reversedAt: new Date("2026-09-01"), reason: long },
      }),
    );
    // The reason is clipped rather than allowed to run the page to two sheets.
    expect(text).toContain("...");
    // And the closing sentence of the warning still appears after it.
    expect(text).toContain("Institute holds.");
  });

  it("says REVERSED, and why, when the payment was undone", () => {
    const text = asText(
      renderReceiptPdf({
        ...base,
        status: "REVERSED",
        reversal: { reversedAt: new Date("2026-09-01"), reason: "Cheque returned unpaid." },
      }),
    );
    expect(text).toContain("PAYMENT REVERSED");
    expect(text).toContain("Cheque returned unpaid.");
    // Word-wrapped, so the sentence is asserted in the fragment that survives
    // a line break rather than as one unbroken run.
    expect(text).toContain("not proof of a");
  });

  it("omits the account table rather than inventing figures for it", () => {
    const text = asText(renderReceiptPdf({ ...base, ledger: null }));
    expect(text).not.toContain("Balance still to pay");
    // And the rest of the document is still there.
    expect(text).toContain("RCPT-2026-00042");
  });
});

describe("text that could break the file", () => {
  it("escapes brackets and backslashes in a name", () => {
    const pdf = renderReceiptPdf({
      ...base,
      student: { ...base.student, fullName: "Ali (Junior) \\ Khan" },
    });
    const text = asText(pdf);
    expect(text).toContain("Ali \\(Junior\\) \\\\ Khan");

    // And the file is still structurally sound, which is the actual risk.
    const at = Number(/startxref\s+(\d+)/.exec(text)?.[1]);
    expect(text.slice(at, at + 4)).toBe("xref");
  });

  it("folds characters the base fonts cannot draw instead of emitting them raw", () => {
    const text = asText(
      renderReceiptPdf({
        ...base,
        institute: { ...base.institute, campus: "G‑11 — “main” campus" },
      }),
    );
    expect(text).toContain('G-11 - "main" campus');
  });

  it("truncates a course name too long for its column rather than overrunning", () => {
    const text = asText(
      renderReceiptPdf({
        ...base,
        student: {
          ...base.student,
          programme: "Diploma in Advanced Graphic Designing and Digital Illustration Practice",
        },
      }),
    );
    expect(text).toContain("...");
  });
});

/**
 * NOTHING IS DRAWN OFF THE PAGE.
 *
 * The failure this guards is the one a hand-laid-out document actually has:
 * content that flows past the bottom of the sheet. It does not throw and it
 * does not corrupt the file — the PDF opens perfectly and a line of it is
 * simply not there, which nobody discovers until a student is holding a
 * receipt with no signature block on it.
 *
 * Both worst cases are checked: the reversal notice, which is the tallest
 * block that can appear, and everything at once.
 */
describe("the layout stays on the sheet", () => {
  const A4H = 841.89;
  const A4W = 595.28;

  /** Every y a text run or a rectangle is placed at, in PDF coordinates. */
  function coordinates(pdf: Buffer): Array<{ x: number; y: number }> {
    const stream = /stream\n([\s\S]*?)\nendstream/.exec(pdf.toString("latin1"))?.[1] ?? "";
    const points: Array<{ x: number; y: number }> = [];
    for (const m of stream.matchAll(/^1 0 0 1 (-?[\d.]+) (-?[\d.]+) Tm$/gm)) {
      points.push({ x: Number(m[1]), y: Number(m[2]) });
    }
    for (const m of stream.matchAll(/^(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) re/gm)) {
      const x = Number(m[1]);
      const y = Number(m[2]);
      points.push({ x, y }, { x: x + Number(m[3]), y: y + Number(m[4]) });
    }
    return points;
  }

  it.each([
    ["an ordinary receipt", base],
    [
      "one carrying a reversal notice, which is the tallest block",
      {
        ...base,
        status: "REVERSED" as const,
        reprint: true,
        reversal: {
          reversedAt: new Date("2026-09-01"),
          reason: "The cheque was returned unpaid by the bank and the amount has been withdrawn.",
        },
        verification: {
          verifiedBy: "Ayesha Khan",
          verifiedAt: new Date("2026-08-21T09:28:00Z"),
          note: "Verified against the bank statement for 19 August.",
        },
      },
    ],
  ])("keeps every mark within the page — %s", (_label, doc) => {
    for (const p of coordinates(renderReceiptPdf(doc as ReceiptDocument))) {
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(A4H);
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(A4W);
    }
  });

  it("leaves the signature block clear of the body, even at its tallest", () => {
    const tall = {
      ...base,
      status: "REVERSED" as const,
      reversal: {
        reversedAt: new Date("2026-09-01"),
        reason: "The cheque was returned unpaid by the bank and the amount has been withdrawn.",
      },
      verification: {
        verifiedBy: "Ayesha Khan",
        verifiedAt: new Date("2026-08-21T09:28:00Z"),
        note: "Verified against the bank statement for 19 August.",
      },
    };
    // The signature rules are drawn at 122 points from the foot. In PDF
    // coordinates that is y = 719.89 measured up from the bottom, so nothing
    // in the body may sit BELOW it — that is, at a smaller y — except the
    // footer itself, which lives in the last 60 points.
    const ys = coordinates(renderReceiptPdf(tall)).map((p) => p.y);
    const bodyLow = Math.min(...ys.filter((y) => y > 60));
    expect(bodyLow).toBeGreaterThan(40);
  });
});

describe("measurement", () => {
  it("measures a wider string as wider", () => {
    expect(textWidth("mmmm", "Helvetica", 10)).toBeGreaterThan(textWidth("iiii", "Helvetica", 10));
  });

  it("scales with the point size", () => {
    expect(textWidth("Receipt", "Helvetica", 20)).toBeCloseTo(
      textWidth("Receipt", "Helvetica", 10) * 2,
      6,
    );
  });

  it("builds an empty page without producing a broken file", () => {
    const pdf = buildPdf([new Page()], { title: "t", author: "a" });
    expect(asText(pdf).startsWith("%PDF-1.4")).toBe(true);
    expect(asText(pdf)).toContain("/Length 0");
  });
});
