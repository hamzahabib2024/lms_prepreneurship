import {
  byDue,
  dueDatesFrom,
  format,
  hasWholePaisa,
  toPaisa,
  validateForPublication,
  type FeeLineInput,
} from "./fee-structure";

/**
 * A course's published price — FR-PAY-033.
 *
 * THESE NUMBERS REACH MEMBERS OF THE PUBLIC WHO ARE ABOUT TO TRANSFER MONEY.
 * That is what makes the arithmetic worth this many tests: a fee table that
 * does not add up is not a cosmetic fault. The applicant pays what the
 * instalments told them, the office checks the slip against the total, and the
 * difference becomes an AMOUNT_INSUFFICIENT rejection of somebody who did
 * exactly what they were asked to do.
 */
describe("a course fee structure", () => {
  const line = (over: Partial<FeeLineInput> = {}): FeeLineInput => ({
    kind: "INSTALMENT",
    label: "Instalment",
    amount: 30000,
    dueAfterDays: 0,
    ...over,
  });

  const structure = (over: Partial<Parameters<typeof validateForPublication>[0]> = {}) => ({
    name: "Spring 2026 — Graphic Designing",
    currency: "PKR",
    totalAmount: 90000,
    dueAtApplication: 30000,
    lines: [
      line({ label: "First instalment", amount: 30000, dueAfterDays: 0 }),
      line({ label: "Second instalment", amount: 30000, dueAfterDays: 30 }),
      line({ label: "Third instalment", amount: 30000, dueAfterDays: 60 }),
    ],
    ...over,
  });

  // ------------------------------------------------------- the happy path --

  it("accepts a table that adds up", () => {
    expect(validateForPublication(structure())).toEqual([]);
  });

  it("accepts components alongside instalments when both add up", () => {
    const problems = validateForPublication(
      structure({
        lines: [
          { kind: "COMPONENT", label: "Tuition", amount: 80000 },
          { kind: "COMPONENT", label: "Registration", amount: 10000 },
          line({ label: "First instalment", amount: 30000, dueAfterDays: 0 }),
          line({ label: "Second instalment", amount: 30000, dueAfterDays: 30 }),
          line({ label: "Third instalment", amount: 30000, dueAfterDays: 60 }),
        ],
      }),
    );
    expect(problems).toEqual([]);
  });

  it("does not require components — a flat fee is a fee", () => {
    // Not every institute itemises. Demanding a breakdown would make the
    // simplest case the hardest one to enter.
    const problems = validateForPublication(
      structure({
        totalAmount: 30000,
        dueAtApplication: 30000,
        lines: [line({ label: "Full fee", amount: 30000, dueAfterDays: 0 })],
      }),
    );
    expect(problems).toEqual([]);
  });

  // -------------------------------------------------------- the sums fail --

  it("refuses instalments that do not reach the total, and says by how much", () => {
    // "does not add up" sends somebody to re-add twelve numbers by hand. The
    // difference is almost always one line forgotten or one typed twice.
    const problems = validateForPublication(
      structure({
        lines: [
          line({ label: "First instalment", amount: 30000, dueAfterDays: 0 }),
          line({ label: "Second instalment", amount: 30000, dueAfterDays: 30 }),
        ],
      }),
    );
    const p = problems.find((x) => x.code === "INSTALMENTS_MISMATCH");
    expect(p).toBeDefined();
    expect(p!.message).toContain("Rs 30,000");
    expect(p!.message).toMatch(/short/);
  });

  it("says OVER rather than short when the table exceeds the total", () => {
    const problems = validateForPublication(
      structure({
        lines: [
          line({ label: "First instalment", amount: 30000, dueAfterDays: 0 }),
          line({ label: "Second instalment", amount: 30000, dueAfterDays: 30 }),
          line({ label: "Third instalment", amount: 30000, dueAfterDays: 60 }),
          line({ label: "Fourth instalment", amount: 5000, dueAfterDays: 90 }),
        ],
      }),
    );
    const p = problems.find((x) => x.code === "INSTALMENTS_MISMATCH");
    expect(p!.message).toMatch(/over/);
    expect(p!.message).toContain("Rs 5,000");
  });

  it("refuses components that do not reach the total", () => {
    const problems = validateForPublication(
      structure({
        lines: [
          { kind: "COMPONENT", label: "Tuition", amount: 50000 },
          line({ label: "First instalment", amount: 30000, dueAfterDays: 0 }),
          line({ label: "Second instalment", amount: 30000, dueAfterDays: 30 }),
          line({ label: "Third instalment", amount: 30000, dueAfterDays: 60 }),
        ],
      }),
    );
    expect(problems.map((p) => p.code)).toContain("COMPONENTS_MISMATCH");
  });

  it("refuses a fee with no instalments at all", () => {
    // A total with no schedule tells an applicant only that they owe money.
    const problems = validateForPublication(
      structure({ lines: [{ kind: "COMPONENT", label: "Tuition", amount: 90000 }] }),
    );
    expect(problems.map((p) => p.code)).toContain("NO_INSTALMENTS");
  });

  // ------------------------------------- the two numbers that must agree --

  it("refuses when the first instalment differs from the amount due on application", () => {
    /*
     * THE DEFECT THIS PREVENTS. These are two numbers for one thing: what the
     * applicant transfers before submitting the form. Left free to differ, the
     * fee table says "First instalment 25,000" and the payment step asks for
     * 30,000 — and whichever the applicant believes, one of them makes their
     * slip wrong and their application rejected.
     */
    const problems = validateForPublication(
      structure({
        dueAtApplication: 25000,
        lines: [
          line({ label: "First instalment", amount: 30000, dueAfterDays: 0 }),
          line({ label: "Second instalment", amount: 30000, dueAfterDays: 30 }),
          line({ label: "Third instalment", amount: 30000, dueAfterDays: 60 }),
        ],
      }),
    );
    const p = problems.find((x) => x.code === "FIRST_INSTALMENT_MISMATCH");
    expect(p).toBeDefined();
    expect(p!.message).toContain("Rs 25,000");
    expect(p!.message).toContain("Rs 30,000");
  });

  it("compares against the EARLIEST instalment, not the first one typed", () => {
    // An instalment added later still belongs where it falls due. Comparing
    // against the array order would refuse a correct table because somebody
    // appended the deposit after the others.
    const problems = validateForPublication(
      structure({
        dueAtApplication: 30000,
        lines: [
          line({ label: "Third instalment", amount: 30000, dueAfterDays: 60 }),
          line({ label: "Second instalment", amount: 30000, dueAfterDays: 30 }),
          line({ label: "First instalment", amount: 30000, dueAfterDays: 0 }),
        ],
      }),
    );
    expect(problems).toEqual([]);
  });

  it("refuses an amount due on application larger than the whole fee", () => {
    const problems = validateForPublication(
      structure({ totalAmount: 30000, dueAtApplication: 50000 }),
    );
    expect(problems.map((p) => p.code)).toContain("EXCEEDS_TOTAL");
  });

  // ----------------------------------------------------------- the money --

  it("is exact for an amount that does not divide", () => {
    /*
     * 100,000 in three. Rounding each third independently gives 33,333.33
     * three times, which is 99,999.99 — the Institute a paisa short, and
     * nobody notices until a student with a zero balance is still shown as
     * owing. The remainder must be given to a specific instalment.
     */
    const problems = validateForPublication(
      structure({
        totalAmount: 100000,
        dueAtApplication: 33333.34,
        lines: [
          line({ label: "First", amount: 33333.34, dueAfterDays: 0 }),
          line({ label: "Second", amount: 33333.33, dueAfterDays: 30 }),
          line({ label: "Third", amount: 33333.33, dueAfterDays: 60 }),
        ],
      }),
    );
    expect(problems).toEqual([]);
  });

  it("catches the naive split that loses a paisa", () => {
    const problems = validateForPublication(
      structure({
        totalAmount: 100000,
        dueAtApplication: 33333.33,
        lines: [
          line({ label: "First", amount: 33333.33, dueAfterDays: 0 }),
          line({ label: "Second", amount: 33333.33, dueAfterDays: 30 }),
          line({ label: "Third", amount: 33333.33, dueAfterDays: 60 }),
        ],
      }),
    );
    expect(problems.map((p) => p.code)).toContain("INSTALMENTS_MISMATCH");
  });

  it("refuses an amount finer than a paisa", () => {
    // It cannot appear on a bank slip, so the applicant would be told a number
    // they cannot pay. Refused at the edge, where somebody can retype it.
    const problems = validateForPublication(
      structure({
        lines: [line({ label: "First instalment", amount: 30000.005, dueAfterDays: 0 })],
      }),
    );
    expect(problems.map((p) => p.code)).toContain("SUB_PAISA");
  });

  it("does not report the sums while a line is still nonsense", () => {
    // Reporting "the table does not add up" AND "that line is negative" makes
    // the first look like a second problem when it is only a consequence.
    const problems = validateForPublication(
      structure({ lines: [line({ label: "First", amount: -5 })] }),
    );
    expect(problems.some((p) => p.code === "INVALID")).toBe(true);
    expect(problems.some((p) => p.code.endsWith("MISMATCH"))).toBe(false);
  });

  // --------------------------------------------------------- everything ----

  it("reports EVERY problem at once, not the first", () => {
    // An administrator typing a fee table gets three things wrong at a time,
    // and one-per-save is three round trips to learn what one screen could
    // have said.
    const problems = validateForPublication({
      name: "",
      currency: "RUPEES",
      totalAmount: 90000,
      dueAtApplication: 25000,
      lines: [line({ label: "Only instalment", amount: 30000, dueAfterDays: 0 })],
    });
    const codes = problems.map((p) => p.code);
    expect(codes).toContain("REQUIRED"); // the name
    expect(codes).toContain("INVALID"); // the currency
    expect(codes).toContain("INSTALMENTS_MISMATCH");
    expect(codes).toContain("FIRST_INSTALMENT_MISMATCH");
  });

  it("points at the field the administrator has to fix", () => {
    const problems = validateForPublication(structure({ name: "" }));
    expect(problems.find((p) => p.code === "REQUIRED")!.field).toBe("name");
  });
});

// ------------------------------------------------------------- helpers -----

describe("money", () => {
  it("groups thousands, because 90000 and 900000 look alike", () => {
    expect(format(90000)).toBe("Rs 90,000");
    expect(format(900000)).toBe("Rs 900,000");
  });

  it("shows no decimals when there are none, and BOTH when there are", () => {
    // "Rs 90,000.00" reads like a machine wrote it, and fees here are whole
    // rupees — so a whole amount shows none.
    expect(format(90000)).not.toContain(".");
    // But half a rupee is fifty paisa, and "Rs 90,000.5" is not how anybody
    // writes money. Once there is a fractional part, both places show.
    expect(format(90000.5)).toBe("Rs 90,000.50");
    expect(format(90000.05)).toBe("Rs 90,000.05");
  });

  it("names a currency that is not rupees", () => {
    expect(format(1000, "USD")).toBe("USD 1,000");
  });

  it("converts to paisa without floating-point drift", () => {
    expect(toPaisa(0.1 + 0.2)).toBe(30);
    expect(toPaisa(33333.33)).toBe(3333333);
  });

  it("knows what cannot be expressed in paisa", () => {
    expect(hasWholePaisa(1.5)).toBe(true);
    expect(hasWholePaisa(1.55)).toBe(true);
    expect(hasWholePaisa(1.555)).toBe(false);
  });
});

describe("when each instalment falls due", () => {
  const lines: FeeLineInput[] = [
    { kind: "INSTALMENT", label: "Second", amount: 30000, dueAfterDays: 30 },
    { kind: "INSTALMENT", label: "First", amount: 30000, dueAfterDays: 0 },
  ];

  it("orders them the way the student will pay them", () => {
    expect([...lines].sort(byDue).map((l) => l.label)).toEqual(["First", "Second"]);
  });

  it("counts from the day the student enrolled", () => {
    const due = dueDatesFrom(new Date("2026-03-01T00:00:00Z"), lines);
    expect(due[0]!.label).toBe("First");
    expect(due[0]!.dueDate.toISOString().slice(0, 10)).toBe("2026-03-01");
    expect(due[1]!.dueDate.toISOString().slice(0, 10)).toBe("2026-03-31");
  });

  it("does not shift by a day when the server is not in Karachi", () => {
    // UTC arithmetic throughout. Adding days with local getters moves a due
    // date across a boundary depending on where the process happens to run.
    const due = dueDatesFrom(new Date("2026-01-31T00:00:00Z"), [
      { kind: "INSTALMENT", label: "Next", amount: 1, dueAfterDays: 1 },
    ]);
    expect(due[0]!.dueDate.toISOString().slice(0, 10)).toBe("2026-02-01");
  });
});
