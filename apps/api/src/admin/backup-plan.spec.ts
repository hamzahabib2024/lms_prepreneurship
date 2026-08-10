import { Prisma } from "@prisma/client";
import {
  NEVER_RESTORED,
  ageOf,
  prunable,
  restoreOrder,
  verifyAgainst,
  type Manifest,
  type ModelShape,
} from "./backup-plan";

const model = (name: string, ...required: string[]): ModelShape => ({
  name,
  relations: required.map((target) => ({ target, optional: false })),
});

describe("restore order", () => {
  it("puts a parent before its child", () => {
    const { order } = restoreOrder([model("Student", "User"), model("User")]);
    expect(order.indexOf("User")).toBeLessThan(order.indexOf("Student"));
  });

  it("handles a chain", () => {
    const { order } = restoreOrder([
      model("Enrolment", "Student"),
      model("Student", "User"),
      model("User"),
    ]);
    expect(order).toEqual(["User", "Student", "Enrolment"]);
  });

  it("includes models nothing points at", () => {
    const { order } = restoreOrder([model("Programme"), model("User")]);
    expect(order.sort()).toEqual(["Programme", "User"]);
  });

  it("IGNORES optional relations", () => {
    // A nullable link can be satisfied after the row exists, and treating it as
    // an ordering constraint invents cycles that do not exist in practice.
    const { order, problems } = restoreOrder([
      { name: "A", relations: [{ target: "B", optional: true }] },
      { name: "B", relations: [{ target: "A", optional: true }] },
    ]);
    expect(problems).toEqual([]);
    expect(order).toHaveLength(2);
  });

  it("reports a genuine cycle among REQUIRED relations", () => {
    const { problems } = restoreOrder([model("A", "B"), model("B", "A")]);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.code).toBe("CYCLE");
    expect(problems[0]?.message).toContain("has to be optional");
  });

  it("tolerates a self-reference", () => {
    // A DiscussionPost's parent is another DiscussionPost, which is fine: the
    // rows are written in one pass and the parent is in the same file.
    const { order } = restoreOrder([
      { name: "DiscussionPost", relations: [{ target: "DiscussionPost", optional: true }] },
    ]);
    expect(order).toEqual(["DiscussionPost"]);
  });

  it("ignores a relation to a model that is not being backed up", () => {
    const { order, problems } = restoreOrder([model("A", "NotBackedUp")]);
    expect(problems).toEqual([]);
    expect(order).toEqual(["A"]);
  });

  it("is DETERMINISTIC, so two archives of one database compare", () => {
    const models = [model("C", "B"), model("B", "A"), model("A"), model("D")];
    expect(restoreOrder(models).order).toEqual(restoreOrder([...models].reverse()).order);
  });

  it("orders the REAL schema without a cycle", () => {
    // The one that matters. If the actual Prisma schema cannot be ordered, no
    // restore this module produces would load.
    const models: ModelShape[] = Prisma.dmmf.datamodel.models.map((m) => ({
      name: m.name,
      relations: m.fields
        .filter((f) => f.kind === "object" && !f.isList)
        .map((f) => ({ target: f.type, optional: !f.isRequired })),
    }));
    const { order, problems } = restoreOrder(models);
    expect(problems).toEqual([]);
    expect(order).toHaveLength(models.length);
  });

  it("puts User before Student in the real schema", () => {
    const models: ModelShape[] = Prisma.dmmf.datamodel.models.map((m) => ({
      name: m.name,
      relations: m.fields
        .filter((f) => f.kind === "object" && !f.isList)
        .map((f) => ({ target: f.type, optional: !f.isRequired })),
    }));
    const { order } = restoreOrder(models);
    expect(order.indexOf("User")).toBeLessThan(order.indexOf("Student"));
  });
});

describe("verifying an archive", () => {
  const manifest: Manifest = {
    version: 1,
    takenAt: "2026-08-11T10:00:00Z",
    schemaVersion: "20260811030000_discussion_posts",
    counts: [
      { model: "User", rows: 12 },
      { model: "Student", rows: 8 },
    ],
    checksum: "abc123",
    totalRows: 20,
  };

  it("passes when everything matches", () => {
    expect(
      verifyAgainst(manifest, {
        checksum: "abc123",
        counts: [
          { model: "User", rows: 12 },
          { model: "Student", rows: 8 },
        ],
      }),
    ).toEqual([]);
  });

  it("catches a damaged file", () => {
    const problems = verifyAgainst(manifest, {
      checksum: "different",
      counts: manifest.counts,
    });
    expect(problems[0]?.code).toBe("CHECKSUM");
    expect(problems[0]?.message).toContain("truncated or altered");
  });

  it("catches a model that is missing entirely", () => {
    const problems = verifyAgainst(manifest, {
      checksum: "abc123",
      counts: [{ model: "User", rows: 12 }],
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]?.code).toBe("MISSING_MODEL");
  });

  it("catches rows that went missing", () => {
    const problems = verifyAgainst(manifest, {
      checksum: "abc123",
      counts: [
        { model: "User", rows: 12 },
        { model: "Student", rows: 7 },
      ],
    });
    expect(problems[0]?.code).toBe("COUNT_MISMATCH");
    expect(problems[0]?.message).toContain("8 rows");
    expect(problems[0]?.message).toContain("has 7");
  });

  it("reports every problem, not only the first", () => {
    const problems = verifyAgainst(manifest, {
      checksum: "wrong",
      counts: [{ model: "User", rows: 1 }],
    });
    expect(problems.length).toBeGreaterThan(1);
  });
});

describe("pruning", () => {
  const at = (iso: string) => ({ takenAt: new Date(iso) });

  it("keeps the newest and returns the rest", () => {
    const all = [at("2026-08-01"), at("2026-08-03"), at("2026-08-02")];
    const gone = prunable(all, 2);
    expect(gone).toHaveLength(1);
    expect(gone[0]?.takenAt.toISOString()).toContain("2026-08-01");
  });

  it("returns nothing when there are fewer than the limit", () => {
    expect(prunable([at("2026-08-01")], 5)).toEqual([]);
  });

  it("keeps by COUNT, not by age", () => {
    // A system switched off for a month would delete everything it had on the
    // morning somebody needed it, which is the wrong moment to learn the rule.
    const ancient = [at("2020-01-01"), at("2020-01-02"), at("2020-01-03")];
    expect(prunable(ancient, 3)).toEqual([]);
  });

  it("returns everything when told to keep none", () => {
    expect(prunable([at("2026-08-01"), at("2026-08-02")], 0)).toHaveLength(0);
  });
});

describe("age in words", () => {
  const now = new Date("2026-08-11T12:00:00Z");

  it("says just now", () => {
    expect(ageOf(new Date("2026-08-11T11:59:40Z"), now)).toBe("just now");
  });

  it("counts minutes, then hours, then days", () => {
    expect(ageOf(new Date("2026-08-11T11:30:00Z"), now)).toBe("30 minutes ago");
    expect(ageOf(new Date("2026-08-11T09:00:00Z"), now)).toBe("3 hours ago");
    expect(ageOf(new Date("2026-08-08T12:00:00Z"), now)).toBe("3 days ago");
  });

  it("uses the singular where it should", () => {
    expect(ageOf(new Date("2026-08-11T11:59:00Z"), now)).toBe("1 minute ago");
    expect(ageOf(new Date("2026-08-10T12:00:00Z"), now)).toBe("1 day ago");
  });
});

describe("what a restore must never touch", () => {
  it("excludes the audit log", () => {
    // The first restore attempt failed on exactly this: the append-only
    // trigger refused the DELETE (FR-LOG-004). The trigger was right.
    expect(NEVER_RESTORED.has("AuditLog")).toBe(true);
  });

  it("does not exclude ordinary data", () => {
    for (const model of ["User", "Student", "Enrolment", "AssignmentGrade", "Payment"]) {
      expect(NEVER_RESTORED.has(model)).toBe(false);
    }
  });

  it("names only models that exist", () => {
    const known = new Set(Prisma.dmmf.datamodel.models.map((m) => m.name));
    for (const name of NEVER_RESTORED) expect(known.has(name)).toBe(true);
  });
});
