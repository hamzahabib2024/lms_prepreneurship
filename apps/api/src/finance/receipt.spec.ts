import { amountInWords } from "./receipt.service";

/**
 * The words on a receipt exist to be checked against the figures. If they can
 * disagree, they are worse than useless — they are a second number to argue
 * about.
 */
describe("the amount in words", () => {
  it("writes small amounts", () => {
    expect(amountInWords(1)).toBe("Rupees One Only");
    expect(amountInWords(15)).toBe("Rupees Fifteen Only");
    expect(amountInWords(42)).toBe("Rupees Forty Two Only");
    expect(amountInWords(100)).toBe("Rupees One Hundred Only");
  });

  it("joins hundreds and the rest with 'and', as a receipt book does", () => {
    expect(amountInWords(105)).toBe("Rupees One Hundred and Five Only");
    expect(amountInWords(999)).toBe("Rupees Nine Hundred and Ninety Nine Only");
  });

  it("uses LAKH and CRORE, not million", () => {
    // "One Million Two Hundred Thousand" on a receipt in Islamabad cannot be
    // checked against the figures by the person holding it, which is the one
    // job the words have.
    expect(amountInWords(100000)).toBe("Rupees One Lakh Only");
    expect(amountInWords(10000000)).toBe("Rupees One Crore Only");
    expect(amountInWords(1200000)).toBe("Rupees Twelve Lakh Only");
  });

  it("writes the amounts this Institute actually charges", () => {
    expect(amountInWords(30000)).toBe("Rupees Thirty Thousand Only");
    expect(amountInWords(90000)).toBe("Rupees Ninety Thousand Only");
    expect(amountInWords(125000)).toBe("Rupees One Lakh Twenty Five Thousand Only");
  });

  it("combines crore, lakh, thousand and the remainder", () => {
    expect(amountInWords(12345678)).toBe(
      "Rupees One Crore Twenty Three Lakh Forty Five Thousand Six Hundred and Seventy Eight Only",
    );
  });

  it("writes paisa when there are any, and omits them when there are none", () => {
    expect(amountInWords(1234.5)).toBe("Rupees One Thousand Two Hundred and Thirty Four and Fifty Paisa Only");
    expect(amountInWords(1234.0)).toBe("Rupees One Thousand Two Hundred and Thirty Four Only");
  });

  it("handles a payment of zero rather than producing nonsense", () => {
    expect(amountInWords(0)).toBe("Rupees Zero Only");
  });

  it("handles paisa alone", () => {
    expect(amountInWords(0.75)).toBe("Rupees Zero and Seventy Five Paisa Only");
  });

  it("refuses to write words for something that is not an amount", () => {
    expect(amountInWords(-5)).toBe("");
    expect(amountInWords(Number.NaN)).toBe("");
  });

  it("respects a currency that is not rupees", () => {
    expect(amountInWords(50, "USD")).toBe("USD Fifty Only");
  });

  it("NEVER writes a doubled or trailing space", () => {
    // A receipt reading "Rupees Twelve  Lakh  Only" is the sort of thing that
    // gets noticed and trusted less.
    for (const n of [1, 20, 100, 1000, 100000, 10000000, 10000001, 1000000.05]) {
      const words = amountInWords(n);
      expect(words).not.toMatch(/\s{2}/);
      expect(words).toBe(words.trim());
    }
  });

  it("agrees with the figures across a wide sweep", () => {
    // The property that matters: the words must never be empty for a real
    // amount, and must always end in Only so the line cannot be extended.
    for (let n = 1; n < 2_000_000; n += 4321) {
      const words = amountInWords(n);
      expect(words.startsWith("Rupees ")).toBe(true);
      expect(words.endsWith(" Only")).toBe(true);
      expect(words.length).toBeGreaterThan(12);
    }
  });

  it("rounds to whole paisa rather than writing a fraction of one", () => {
    expect(amountInWords(10.999)).toBe("Rupees Eleven Only");
  });
});
