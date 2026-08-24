/**
 * The four numbers — and the one that must never move.
 *
 * Every test here that matters is a variant of the same question: does a claim
 * the office has not looked at change what the student is told they owe? It
 * must not, on any path, which is why there are several.
 */

import { summarise } from "./fee-summary";

const charge = (amount: number, waived = false) => ({
  amount,
  waivedAt: waived ? new Date("2026-03-01") : null,
});
const paid = (amount: number, reversed = false) => ({ amount, isReversed: reversed });
const claim = (claimedAmount: number, status = "PENDING") => ({ claimedAmount, status });

describe("a pending claim is not money", () => {
  it("does not reduce what is still to pay", () => {
    const s = summarise([charge(100_000)], [paid(40_000)], [claim(30_000)]);

    expect(s.totalFee).toBe(100_000);
    expect(s.verified).toBe(40_000);
    expect(s.pending).toBe(30_000);
    // The whole point. 60,000 — not 30,000.
    expect(s.remaining).toBe(60_000);
  });

  it("reports what would be left if it were verified, separately", () => {
    const s = summarise([charge(100_000)], [paid(40_000)], [claim(30_000)]);
    expect(s.remainingIfAllVerified).toBe(30_000);
  });

  it("says in words that the claim does not count yet", () => {
    const s = summarise([charge(100_000)], [paid(40_000)], [claim(30_000)]);
    expect(s.headline).toContain("does not count until");
  });

  it("ignores claims the office has already decided", () => {
    const s = summarise(
      [charge(100_000)],
      [paid(40_000)],
      [claim(30_000, "VERIFIED"), claim(5_000, "REJECTED"), claim(1_000, "CANCELLED")],
    );
    expect(s.pending).toBe(0);
    expect(s.pendingCount).toBe(0);
  });

  it("counts the claims as well as their total", () => {
    const s = summarise([charge(100_000)], [], [claim(10_000), claim(15_000)]);
    expect(s.pendingCount).toBe(2);
    expect(s.pending).toBe(25_000);
  });
});

describe("what is owed", () => {
  it("subtracts a waived charge from the total fee", () => {
    const s = summarise([charge(100_000), charge(20_000, true)], [paid(50_000)], []);
    expect(s.charged).toBe(120_000);
    expect(s.waived).toBe(20_000);
    expect(s.totalFee).toBe(100_000);
    expect(s.remaining).toBe(50_000);
  });

  it("does not count a reversed payment as paid", () => {
    const s = summarise([charge(100_000)], [paid(40_000), paid(25_000, true)], []);
    expect(s.verified).toBe(40_000);
    expect(s.reversed).toBe(25_000);
    expect(s.remaining).toBe(60_000);
  });

  it("reports an overpayment as credit rather than a negative balance", () => {
    const s = summarise([charge(50_000)], [paid(60_000)], []);
    // "Still to pay: −10,000" is not something anybody can act on.
    expect(s.remaining).toBe(0);
    expect(s.credit).toBe(10_000);
    expect(s.standing).toBe("IN_CREDIT");
    expect(s.headline).toContain("owes this back");
  });

  it("holds to the paisa across many lines", () => {
    const s = summarise(
      [charge(33_333.34), charge(33_333.33), charge(33_333.33)],
      [paid(33_333.34)],
      [],
    );
    expect(s.totalFee).toBe(100_000);
    expect(s.remaining).toBe(66_666.66);
  });
});

describe("standing", () => {
  it("is NOTHING_DUE before any fee is charged", () => {
    const s = summarise([], [], []);
    expect(s.standing).toBe("NOTHING_DUE");
    expect(s.headline).toContain("No fee has been charged");
  });

  it("is UNPAID when a fee is charged and nothing has happened", () => {
    expect(summarise([charge(50_000)], [], []).standing).toBe("UNPAID");
  });

  it("is AWAITING_VERIFICATION when the only thing paid is a claim", () => {
    const s = summarise([charge(50_000)], [], [claim(50_000)]);
    expect(s.standing).toBe("AWAITING_VERIFICATION");
    // And it still says the money is owed, because it is.
    expect(s.remaining).toBe(50_000);
  });

  it("is PARTIALLY_PAID once something is verified, even with a claim waiting", () => {
    expect(summarise([charge(50_000)], [paid(10_000)], [claim(40_000)]).standing).toBe(
      "PARTIALLY_PAID",
    );
  });

  it("is FULLY_PAID when the verified payments meet the total", () => {
    const s = summarise([charge(50_000)], [paid(50_000)], []);
    expect(s.standing).toBe("FULLY_PAID");
    expect(s.headline).toContain("paid in full");
  });

  it("still says paid in full when a further claim is waiting, and mentions it", () => {
    const s = summarise([charge(50_000)], [paid(50_000)], [claim(5_000)]);
    expect(s.standing).toBe("FULLY_PAID");
    expect(s.headline).toContain("waiting to be checked");
  });
});
