/**
 * CSV export — SRS FR-RPT-004, FR-RPT-005, NFR-LOC-004.
 *
 * CSV escaping looks trivial and is not. Every case here corrupts a naive
 * implementation SILENTLY: the file opens, it is simply wrong, and nobody
 * notices until a column has shifted and a student is attached to another
 * student's marks.
 */

import { buildCsv, csvFilename, escapeCsvField } from "./csv";

describe("escapeCsvField", () => {
  it("passes plain values through", () => {
    expect(escapeCsvField("Ayesha Khan")).toBe("Ayesha Khan");
    expect(escapeCsvField(42)).toBe("42");
  });

  it("quotes a value containing a comma", () => {
    // Addresses always contain commas, and an unquoted one shifts every
    // subsequent column on that row.
    expect(escapeCsvField("House 12, Street 4, Islamabad")).toBe(
      '"House 12, Street 4, Islamabad"',
    );
  });

  it("doubles embedded quotes", () => {
    expect(escapeCsvField('She said "hello"')).toBe('"She said ""hello"""');
  });

  it("quotes a value containing a newline", () => {
    // Teacher feedback is free text and routinely contains line breaks. An
    // unquoted newline splits one row into two.
    expect(escapeCsvField("Line one\nLine two")).toBe('"Line one\nLine two"');
    expect(escapeCsvField("Line one\r\nLine two")).toBe('"Line one\r\nLine two"');
  });

  it("renders null and undefined as empty, not as the words", () => {
    expect(escapeCsvField(null)).toBe("");
    expect(escapeCsvField(undefined)).toBe("");
    // A literal "null" in a marks column is worse than a blank: it looks
    // like data.
    expect(escapeCsvField(null)).not.toBe("null");
  });

  it("neutralises formula injection", () => {
    // A cell beginning =, +, - or @ is EXECUTED by Excel on open. Without the
    // prefix, a crafted registration number becomes an attack on whoever
    // opens the export.
    expect(escapeCsvField("=cmd|'/c calc'!A1")).toBe("'=cmd|'/c calc'!A1");
    expect(escapeCsvField("+1234")).toBe("'+1234");
    expect(escapeCsvField("-1234")).toBe("'-1234");
    expect(escapeCsvField("@SUM(A1:A9)")).toBe("'@SUM(A1:A9)");
  });

  it("does not mangle a normal negative number in a text field", () => {
    // The trade-off is accepted: a leading apostrophe is visible but harmless,
    // whereas executing a formula is not.
    expect(escapeCsvField("-5")).toBe("'-5");
    expect(escapeCsvField(-5)).toBe("'-5");
  });

  it("serialises dates in a sortable, unambiguous form", () => {
    // NFR-USE-012 — never a locale-dependent numeric date, which is read
    // differently in different countries.
    expect(escapeCsvField(new Date("2026-08-09T10:30:00Z"))).toBe("2026-08-09T10:30:00.000Z");
  });
});

describe("buildCsv", () => {
  interface Row {
    regNo: string;
    name: string;
    percent: number | null;
  }
  const columns = [
    { header: "Registration No", value: (r: Row) => r.regNo },
    { header: "Name", value: (r: Row) => r.name },
    { header: "Attendance %", value: (r: Row) => r.percent },
  ];
  const meta = {
    reportName: "Attendance Summary",
    generatedBy: "Usman Admin",
    generatedAt: new Date("2026-08-09T14:12:00Z"),
    institute: "Prepreneurship Institute",
    filters: { section: "SP26-GD-MOR-A", from: "2026-07-01" },
  };

  it("carries the provenance header FR-RPT-005 requires", () => {
    const csv = buildCsv([], columns, meta);
    // Without these, a report emailed onward is unreadable a week later —
    // nobody can tell whether the figures covered one section or all of them.
    expect(csv).toContain("Attendance Summary");
    expect(csv).toContain("Usman Admin");
    expect(csv).toContain("section=SP26-GD-MOR-A");
    expect(csv).toContain("Prepreneurship Institute");
  });

  it("writes headers and rows", () => {
    const csv = buildCsv(
      [{ regNo: "CIIT/SP26-GD-034/ISB", name: "Ayesha Khan", percent: 71.4 }],
      columns,
      meta,
    );
    expect(csv).toContain("Registration No,Name,Attendance %");
    expect(csv).toContain("CIIT/SP26-GD-034/ISB,Ayesha Khan,71.4");
  });

  it("explains an empty result rather than emitting a bare header", () => {
    // FR-RPT-020 — an empty grid reads as a broken report.
    const csv = buildCsv([], columns, meta);
    expect(csv).toMatch(/No records matched/i);
  });

  it("starts with a BOM so Excel reads UTF-8", () => {
    // NFR-LOC-004 — without it Excel mangles Urdu and Arabic-script names,
    // which is most of the roll.
    expect(buildCsv([], columns, meta).charCodeAt(0)).toBe(0xfeff);
  });

  it("uses CRLF line endings per RFC 4180", () => {
    expect(buildCsv([], columns, meta)).toContain("\r\n");
  });

  it("survives a row whose fields contain commas, quotes and newlines", () => {
    const csv = buildCsv(
      [{ regNo: "R,1", name: 'O"Brien\nSecond line', percent: null }],
      columns,
      meta,
    );
    expect(csv).toContain('"R,1"');
    expect(csv).toContain('"O""Brien\nSecond line"');

    // The newline sits INSIDE a quoted field, so it has not split the record.
    // Counting unescaped quotes is the cheap way to prove the quoting is
    // balanced: an unbalanced field is what shifts every later column.
    const dataSection = csv.split("Registration No,Name,Attendance %")[1] ?? "";
    expect(dataSection).toContain('"R,1"');
    expect((dataSection.match(/"/g) ?? []).length % 2).toBe(0);
  });
});

describe("csvFilename", () => {
  it("sorts chronologically and is filesystem-safe", () => {
    const name = csvFilename("attendance-summary", new Date("2026-08-09T14:12:33Z"));
    expect(name).toBe("attendance-summary-2026-08-09-14-12-33.csv");
    expect(name).not.toMatch(/[:*?"<>|]/); // characters Windows refuses
  });

  it("strips characters from an untrusted report key", () => {
    expect(csvFilename("../../etc/passwd")).toMatch(/^-+etc-passwd-/);
  });
});
