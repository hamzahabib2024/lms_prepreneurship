import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * The fifth static guard: NEVER `findUnique` ON THE SCOPED CLIENT.
 *
 * The scope extension (ARC-051) injects its predicate by wrapping the caller's
 * `where` in an AND. `findUnique` accepts only unique fields, so Prisma refuses
 * the combination at runtime with a validation error.
 *
 * WHAT MAKES THIS WORTH A BUILD-BREAKING TEST is which roles it breaks for. A
 * Super Admin has no predicate, so nothing is injected and the call works. A
 * student, a teacher, an Admin with a narrower reach — anybody the System
 * actually scopes — gets a 500. So it passes every test written from a staff
 * account and fails the moment a real student uses the feature, which is
 * exactly how it reached a probe: the receipt endpoint worked for four
 * privileged sessions in a row and answered 500 for the student it was FOR.
 *
 * `findFirst` takes the same arguments, accepts the injected predicate, and
 * returns the same thing. There is no case where findUnique on the scoped
 * client is the right call, so the rule has no exceptions to reason about —
 * including for models that are unscoped TODAY, because a policy added later
 * would turn a working call into a 500 with nothing to connect the two.
 *
 * `asSystem` is unaffected: no predicate is injected there, which is the whole
 * point of it, so findUnique is fine on that path.
 */

const SRC = join(__dirname, "..");

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, found);
    else if (entry.endsWith(".ts") && !entry.endsWith(".spec.ts")) found.push(full);
  }
  return found;
}

describe("the scoped client is never asked for findUnique", () => {
  const offenders: Array<{ file: string; line: number; text: string }> = [];

  beforeAll(() => {
    for (const file of sourceFiles(SRC)) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((text, i) => {
        // `scoped.something.findUnique(` — the model name varies, the shape
        // does not. Matching on the text rather than the AST keeps this guard
        // readable by the next person, which matters more here than rigour:
        // a guard nobody understands gets deleted.
        if (/\bscoped\.[A-Za-z0-9_]+\.findUnique\s*\(/.test(text)) {
          offenders.push({ file: file.slice(SRC.length + 1), line: i + 1, text: text.trim() });
        }
      });
    }
  });

  it("finds none", () => {
    const named = offenders
      .map((o) => `${o.file}:${o.line} — ${o.text}`)
      .join("\n");
    expect(
      offenders.length === 0
        ? []
        : [
            "findUnique on the scoped client throws for every role that IS scoped, " +
              "and works for a Super Admin. Use findFirst:\n" +
              named,
          ],
    ).toEqual([]);
  });

  it("is looking at real source, not an empty directory", () => {
    // A guard that scans nothing passes forever. This is the check that the
    // check is running.
    const files = sourceFiles(SRC);
    expect(files.length).toBeGreaterThan(100);
    expect(files.some((f) => f.endsWith("receipt.service.ts"))).toBe(true);
  });

  it("would CATCH the pattern if it came back", () => {
    // Proving the regex matches what it claims to, rather than trusting that
    // zero offenders means zero offences.
    const pattern = /\bscoped\.[A-Za-z0-9_]+\.findUnique\s*\(/;
    expect(pattern.test("await this.prisma.scoped.payment.findUnique({")).toBe(true);
    expect(pattern.test("const x = prisma.scoped.feeCharge.findUnique ({")).toBe(true);
    // And does not fire on the calls that are perfectly correct.
    expect(pattern.test("await this.prisma.scoped.payment.findFirst({")).toBe(false);
    expect(pattern.test("db.payment.findUnique({")).toBe(false);
    expect(pattern.test("tx.payment.findUnique({")).toBe(false);
  });
});
