import { MAX_BATCH, refuseBatch, report, type RowResult } from "./bulk-rules";

const rows = (spec: Array<[RowResult["outcome"], string]>): RowResult[] =>
  spec.map(([outcome, studentId], i) => ({
    studentId,
    outcome,
    ...(outcome === "FAILED" ? { message: `reason ${i}` } : {}),
  }));

describe("the shape of a batch", () => {
  it("accepts an ordinary list", () => {
    expect(refuseBatch(["a", "b", "c"])).toBeNull();
  });

  it("refuses an empty one", () => {
    expect(refuseBatch([])?.code).toBe("EMPTY");
  });

  it("refuses more than it can do at once", () => {
    const many = Array.from({ length: MAX_BATCH + 1 }, (_, i) => `s${i}`);
    const problem = refuseBatch(many);
    expect(problem?.code).toBe("TOO_MANY");
    expect(problem?.message).toContain(String(MAX_BATCH));
  });

  it("accepts exactly the limit", () => {
    expect(refuseBatch(Array.from({ length: MAX_BATCH }, (_, i) => `s${i}`))).toBeNull();
  });

  it("refuses duplicates", () => {
    // Left in, the second attempt fails with "already in that section" and the
    // report accuses the operator of a mistake they did not make.
    const problem = refuseBatch(["a", "b", "a"]);
    expect(problem?.code).toBe("DUPLICATES");
    expect(problem?.message).toContain("1 student appears");
  });

  it("counts distinct duplicates, not occurrences", () => {
    expect(refuseBatch(["a", "a", "a", "b", "b"])?.message).toContain("2 students appear");
  });

  it("checks size before duplicates", () => {
    // A list of 500 with duplicates should be told about its size; splitting it
    // is what they must do either way.
    const many = [...Array.from({ length: MAX_BATCH + 5 }, (_, i) => `s${i}`), "s0"];
    expect(refuseBatch(many)?.code).toBe("TOO_MANY");
  });
});

describe("the report", () => {
  it("counts each outcome", () => {
    const r = report(
      rows([
        ["SUCCEEDED", "a"],
        ["SUCCEEDED", "b"],
        ["FAILED", "c"],
        ["SKIPPED", "d"],
      ]),
      false,
    );
    expect(r).toMatchObject({ total: 4, succeeded: 2, failed: 1, skipped: 1 });
  });

  it("counts WOULD_SUCCEED as succeeded in a preview", () => {
    const r = report(rows([["WOULD_SUCCEED", "a"], ["FAILED", "b"]]), true);
    expect(r.succeeded).toBe(1);
  });

  it("puts failures FIRST, not below fifty that worked", () => {
    const r = report(
      rows([
        ["SUCCEEDED", "a"],
        ["SUCCEEDED", "b"],
        ["FAILED", "c"],
        ["SKIPPED", "d"],
      ]),
      false,
    );
    expect(r.rows[0]?.outcome).toBe("FAILED");
    expect(r.rows[1]?.outcome).toBe("SKIPPED");
  });

  it("does not mutate the caller's array", () => {
    const original = rows([["SUCCEEDED", "a"], ["FAILED", "b"]]);
    report(original, false);
    expect(original[0]?.outcome).toBe("SUCCEEDED");
  });
});

describe("the summary sentence", () => {
  it("says so plainly when everything worked", () => {
    expect(report(rows([["SUCCEEDED", "a"], ["SUCCEEDED", "b"]]), false).summary).toBe(
      "All 2 done.",
    );
  });

  it("WARNS that it is not all-or-nothing when some failed", () => {
    // The sentence that matters. Somebody who reads "38 done" and closes the
    // page must not later discover twelve students never moved.
    const summary = report(
      rows([["SUCCEEDED", "a"], ["SUCCEEDED", "b"], ["FAILED", "c"]]),
      false,
    ).summary;
    expect(summary).toContain("not all-or-nothing");
    expect(summary).toContain("were NOT changed");
    expect(summary).toContain("2 of 3");
  });

  it("counts skipped rows as not-changed too", () => {
    const summary = report(rows([["SUCCEEDED", "a"], ["SKIPPED", "b"]]), false).summary;
    expect(summary).toContain("1 were NOT changed");
  });

  it("speaks in the conditional for a preview", () => {
    expect(report(rows([["WOULD_SUCCEED", "a"]]), true).summary).toBe("All 1 would go through.");
  });

  it("tells a preview reader they may proceed anyway", () => {
    const summary = report(rows([["WOULD_SUCCEED", "a"], ["FAILED", "b"]]), true).summary;
    expect(summary).toContain("would not");
    expect(summary).toContain("left as they are");
  });

  it("handles a batch where everything failed", () => {
    const r = report(rows([["FAILED", "a"], ["FAILED", "b"]]), false);
    expect(r.succeeded).toBe(0);
    expect(r.summary).toContain("0 of 2 done");
  });
});
