import { aging, balanceOf, statement, type Charge, type LedgerPayment } from "./ledger";

const at = (iso: string) => new Date(iso);

let n = 0;
const charge = (over: Partial<Charge> = {}): Charge => ({
  id: `c${(n += 1)}`,
  description: "Tuition",
  amount: 10000,
  dueDate: at("2026-08-01T00:00:00Z"),
  createdAt: at("2026-07-01T00:00:00Z"),
  waivedAt: null,
  waiverReason: null,
  ...over,
});

const payment = (over: Partial<LedgerPayment> = {}): LedgerPayment => ({
  id: `p${(n += 1)}`,
  amount: 10000,
  paidOn: at("2026-08-05T00:00:00Z"),
  method: "BANK_TRANSFER",
  reference: "TRX-1",
  isReversed: false,
  reversedAt: null,
  reversalReason: null,
  ...over,
});

describe("the balance", () => {
  it("is zero for a student with nothing", () => {
    expect(balanceOf([], [])).toMatchObject({ charged: 0, paid: 0, outstanding: 0 });
  });

  it("is what was charged when nothing is paid", () => {
    expect(balanceOf([charge()], []).outstanding).toBe(10000);
  });

  it("is zero when it is settled exactly", () => {
    expect(balanceOf([charge()], [payment()]).outstanding).toBe(0);
  });

  it("goes NEGATIVE when they are in credit", () => {
    // An overpayment is a real thing and the Institute owes it back. Clamping
    // to zero here would hide money that belongs to somebody.
    expect(balanceOf([charge()], [payment({ amount: 12000 })]).outstanding).toBe(-2000);
  });

  it("does not count a WAIVED charge as owed", () => {
    const b = balanceOf([charge({ waivedAt: at("2026-08-10T00:00:00Z") })], []);
    expect(b.outstanding).toBe(0);
    // Still reported, because somebody decided to write it off.
    expect(b.charged).toBe(10000);
    expect(b.waived).toBe(10000);
  });

  it("does not count a REVERSED payment as paid", () => {
    const b = balanceOf([charge()], [payment({ isReversed: true })]);
    expect(b.outstanding).toBe(10000);
    expect(b.paid).toBe(0);
    expect(b.reversed).toBe(10000);
  });

  it("does not double-count a reversal", () => {
    // paid excludes it already; subtracting it again would make the student
    // owe twice the money the Institute never kept.
    const b = balanceOf([charge({ amount: 5000 })], [payment({ amount: 5000, isReversed: true })]);
    expect(b.outstanding).toBe(5000);
  });

  it("adds several charges and payments", () => {
    const b = balanceOf(
      [charge({ amount: 10000 }), charge({ amount: 5000 }), charge({ amount: 2500 })],
      [payment({ amount: 10000 }), payment({ amount: 3000 })],
    );
    expect(b.outstanding).toBe(4500);
  });

  it("handles money that does not divide neatly", () => {
    const b = balanceOf([charge({ amount: 0.1 }), charge({ amount: 0.2 })], []);
    expect(b.outstanding).toBe(0.3);
  });
});

describe("the statement", () => {
  it("is empty for a student with nothing", () => {
    expect(statement([], [])).toEqual([]);
  });

  it("shows a charge then a payment, with a running balance", () => {
    const lines = statement([charge()], [payment()]);
    expect(lines.map((l) => [l.kind, l.balance])).toEqual([
      ["CHARGE", 10000],
      ["PAYMENT", 0],
    ]);
  });

  it("SHOWS a reversal as its own line rather than omitting the payment", () => {
    // A student holding a receipt must find both. Netting it away makes the
    // Institute look as though it lost the money.
    const lines = statement(
      [charge()],
      [payment({ isReversed: true, reversedAt: at("2026-08-20T00:00:00Z"), reversalReason: "Slip forged" })],
    );
    expect(lines.map((l) => l.kind)).toEqual(["CHARGE", "PAYMENT", "REVERSAL"]);
    expect(lines[2]?.balance).toBe(10000);
    expect(lines[2]?.description).toContain("Slip forged");
  });

  it("SHOWS a waiver as its own line", () => {
    const lines = statement(
      [charge({ waivedAt: at("2026-08-15T00:00:00Z"), waiverReason: "Hardship" })],
      [],
    );
    expect(lines.map((l) => l.kind)).toEqual(["CHARGE", "WAIVER"]);
    expect(lines[1]?.balance).toBe(0);
    expect(lines[1]?.description).toContain("Hardship");
  });

  it("orders by date", () => {
    const lines = statement(
      [
        charge({ description: "Second", createdAt: at("2026-09-01T00:00:00Z") }),
        charge({ description: "First", createdAt: at("2026-07-01T00:00:00Z") }),
      ],
      [],
    );
    expect(lines.map((l) => l.description)).toEqual(["First", "Second"]);
  });

  it("is STABLE when two entries share a timestamp", () => {
    // Without a tie-breaker, two people reading one statement see different
    // running totals and neither is wrong.
    const same = at("2026-08-01T00:00:00Z");
    const build = () =>
      statement(
        [charge({ id: "b", amount: 100, createdAt: same }), charge({ id: "a", amount: 200, createdAt: same })],
        [payment({ id: "z", amount: 50, paidOn: same })],
      );
    expect(build().map((l) => l.balance)).toEqual(build().map((l) => l.balance));
    // A charge before a payment on the same day, so the balance never dips
    // below what was actually owed at that moment.
    expect(build().map((l) => l.kind)).toEqual(["CHARGE", "CHARGE", "PAYMENT"]);
  });

  it("places a reversal with no recorded date at its payment, not at the epoch", () => {
    const lines = statement([], [payment({ isReversed: true, reversedAt: null })]);
    expect(lines[1]?.date).toEqual(at("2026-08-05T00:00:00Z"));
  });

  it("ends on the same figure the balance reports", () => {
    const charges = [charge({ amount: 10000 }), charge({ amount: 5000 })];
    const payments = [payment({ amount: 4000 }), payment({ amount: 1000, isReversed: true })];
    const lines = statement(charges, payments);
    expect(lines[lines.length - 1]?.balance).toBe(balanceOf(charges, payments).outstanding);
  });
});

describe("aging", () => {
  const now = at("2026-09-15T00:00:00Z");

  it("reports nothing for a settled account", () => {
    expect(aging([charge()], [payment()], now)).toMatchObject({
      current: 0,
      overdue30: 0,
      oldestOverdueDays: null,
    });
  });

  it("puts a charge not yet due in current", () => {
    const a = aging([charge({ dueDate: at("2026-10-01T00:00:00Z") })], [], now);
    expect(a.current).toBe(10000);
    expect(a.oldestOverdueDays).toBeNull();
  });

  it("buckets by how overdue it is", () => {
    const a = aging(
      [
        charge({ id: "x", amount: 100, dueDate: at("2026-09-01T00:00:00Z") }), // 14 days
        charge({ id: "y", amount: 200, dueDate: at("2026-08-01T00:00:00Z") }), // 45 days
        charge({ id: "z", amount: 300, dueDate: at("2026-05-01T00:00:00Z") }), // 137 days
      ],
      [],
      now,
    );
    expect(a).toMatchObject({ overdue30: 100, overdue60: 200, overdue90Plus: 300 });
    expect(a.oldestOverdueDays).toBe(137);
  });

  it("applies payment to the OLDEST charge first", () => {
    // The convention, and the fair one: a student who owes three instalments
    // and pays one has paid the oldest. Applying to the newest would keep the
    // oldest perpetually overdue and make a paying student a defaulter.
    const a = aging(
      [
        charge({ id: "old", amount: 100, dueDate: at("2026-05-01T00:00:00Z") }),
        charge({ id: "new", amount: 200, dueDate: at("2026-09-01T00:00:00Z") }),
      ],
      [payment({ amount: 100 })],
      now,
    );
    expect(a.overdue90Plus).toBe(0);
    expect(a.overdue30).toBe(200);
  });

  it("settles a charge partly", () => {
    const a = aging(
      [charge({ amount: 1000, dueDate: at("2026-09-01T00:00:00Z") })],
      [payment({ amount: 400 })],
      now,
    );
    expect(a.overdue30).toBe(600);
  });

  it("ignores waived charges", () => {
    const a = aging(
      [charge({ dueDate: at("2026-05-01T00:00:00Z"), waivedAt: at("2026-06-01T00:00:00Z") })],
      [],
      now,
    );
    expect(a.overdue90Plus).toBe(0);
    expect(a.oldestOverdueDays).toBeNull();
  });

  it("ignores reversed payments when settling", () => {
    const a = aging(
      [charge({ amount: 500, dueDate: at("2026-08-01T00:00:00Z") })],
      [payment({ amount: 500, isReversed: true })],
      now,
    );
    expect(a.overdue60).toBe(500);
  });

  it("does not let an overpayment create a negative bucket", () => {
    const a = aging([charge({ amount: 100 })], [payment({ amount: 5000 })], now);
    expect(a.overdue30).toBe(0);
    expect(a.current).toBe(0);
  });
});
