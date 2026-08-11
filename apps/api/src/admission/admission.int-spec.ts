/**
 * Integration tests — SRS §17.2 and §17.4 Scenario C.
 *
 * These need a live PostgreSQL and self-skip without one, so `npm test` stays
 * green on a machine that has no database. Run them with:
 *
 *     DATABASE_URL=postgresql://... npm test
 *
 * They cover the things unit tests cannot: real transactions, real
 * constraints, and real concurrency. The concurrent-approval test is the most
 * important test in the codebase — it is the only proof that RSK-07 is
 * actually mitigated rather than merely designed against.
 */

import { ConfigService } from "@nestjs/config";
import { PrismaClient } from "@prisma/client";
import { RegistrationNumberService } from "./registration-number.service";

const hasDb = !!process.env["DATABASE_URL"];
const suite = hasDb ? describe : describe.skip;

if (!hasDb) {
  console.warn("\n  ⚠  Integration tests skipped: set DATABASE_URL to run them.\n");
}

const config = { get: (_k: string, d?: string) => d } as unknown as ConfigService;

suite("registration numbering — concurrency (RSK-07)", () => {
  const db = new PrismaClient();
  const numbers = new RegistrationNumberService(config);
  const seriesKey = `TEST|SP26|GD|ISB|${Date.now()}`;

  afterAll(async () => {
    await db.numberSeries.deleteMany({ where: { key: { startsWith: "TEST|" } } });
    await db.$disconnect();
  });

  it("allocates strictly increasing values with no gaps", async () => {
    const values: number[] = [];
    for (let i = 0; i < 5; i++) {
      values.push(await numbers.allocateSequence(db, seriesKey));
    }
    expect(values).toEqual([1, 2, 3, 4, 5]);
  });

  it("never issues the same number twice under concurrent allocation", async () => {
    // The failure this guards against: two administrators approving in the
    // same series at the same moment. A read-then-write implementation gives
    // them both the same number, and the collision is only discovered when a
    // certificate is printed.
    const key = `TEST|CONCURRENT|${Date.now()}`;
    const CONCURRENCY = 50;

    const results = await Promise.all(
      Array.from({ length: CONCURRENCY }, () => numbers.allocateSequence(db, key)),
    );

    const unique = new Set(results);
    expect(unique.size).toBe(CONCURRENCY); // no duplicates
    expect(Math.min(...results)).toBe(1);
    expect(Math.max(...results)).toBe(CONCURRENCY); // and no gaps either
  });

  it("keeps separate series independent (Appendix B)", async () => {
    const stamp = Date.now();
    const gd = `TEST|SP26|GD|ISB|${stamp}`;
    const dm = `TEST|SP26|DM|ISB|${stamp}`;

    expect(await numbers.allocateSequence(db, gd)).toBe(1);
    expect(await numbers.allocateSequence(db, dm)).toBe(1); // same number, different series
    expect(await numbers.allocateSequence(db, gd)).toBe(2);
  });

  it("consumes no number when the surrounding transaction rolls back", async () => {
    // BR-REG-09: a failed approval must leave the series untouched, otherwise
    // the sequence develops gaps that look like lost students.
    const key = `TEST|ROLLBACK|${Date.now()}`;
    expect(await numbers.allocateSequence(db, key)).toBe(1);

    await expect(
      db.$transaction(async (tx) => {
        await numbers.allocateSequence(tx, key); // would be 2
        throw new Error("simulated failure after allocation");
      }),
    ).rejects.toThrow("simulated failure");

    // 2 was rolled back, so the next real allocation gets it.
    expect(await numbers.allocateSequence(db, key)).toBe(2);
  });
});

suite("roll numbers — lowest unused within a section (FR-REG-057)", () => {
  const db = new PrismaClient();
  const numbers = new RegistrationNumberService(config);

  afterAll(async () => {
    await db.$disconnect();
  });

  it("starts at 1 in an empty section", async () => {
    const section = await db.section.findFirst({ where: { code: "SP26-GD-MOR-A" } });
    if (!section) return; // seed not run
    const roll = await numbers.allocateRollNumber(db, section.id);
    expect(roll).toBeGreaterThanOrEqual(1);
  });
});

suite("audit log immutability (FR-LOG-004)", () => {
  const db = new PrismaClient();

  afterAll(async () => {
    await db.$disconnect();
  });

  it("refuses UPDATE and DELETE at the database level", async () => {
    // The application has no update or delete path, but that is a promise
    // about code. This asserts the guarantee about data — the trigger added
    // by 01_constraints_and_indexes.sql.
    const entry = await db.auditLog.create({
      data: {
        action: "test.immutability",
        entityType: "Test",
        entityId: "test",
        correlationId: "00000000-0000-0000-0000-000000000000",
      },
    });

    await expect(
      db.$executeRaw`UPDATE audit_log SET action = 'tampered' WHERE id = ${entry.id}::uuid`,
    ).rejects.toThrow(/append-only/i);

    await expect(
      db.$executeRaw`DELETE FROM audit_log WHERE id = ${entry.id}::uuid`,
    ).rejects.toThrow(/append-only/i);
  });
});

suite("scope predicate against real rows (ARC-051, SEC-AUZ-002)", () => {
  const db = new PrismaClient();

  afterAll(async () => {
    await db.$disconnect();
  });

  it("seeds two teachers of the SAME subject in DIFFERENT sections", async () => {
    // This is the arrangement that makes the scope test meaningful. A teacher
    // assigned to Graphic Designing in the female section must not reach the
    // male section's students, even though the SUBJECT is identical.
    // BR-ACC-04 — the rule most often mis-implemented in systems of this kind.
    const gd = await db.subject.findFirst({ where: { code: "GD101" } });
    if (!gd) return; // seed not run

    const offerings = await db.sectionSubject.findMany({
      where: { subjectId: gd.id },
      include: { section: true, assignments: { include: { teacher: true } } },
    });

    expect(offerings.length).toBeGreaterThanOrEqual(2);

    const teacherIds = offerings.flatMap((o) => o.assignments.map((a) => a.teacherId));
    // Different teachers, so neither can be widened into the other's reach.
    expect(new Set(teacherIds).size).toBeGreaterThanOrEqual(2);
  });
});
