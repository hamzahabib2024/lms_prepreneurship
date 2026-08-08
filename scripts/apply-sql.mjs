/**
 * Applies a raw SQL file through the Prisma client.
 *
 * Replaces a `psql -f` invocation so the constraints migration works on a
 * machine without the PostgreSQL client tools installed — which is the normal
 * case when the server itself is the portable build.
 *
 * Usage:  node -r dotenv/config scripts/apply-sql.mjs <path-to-sql>
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";

const file = process.argv[2];
if (!file) {
  console.error("Usage: node scripts/apply-sql.mjs <path-to-sql>");
  process.exit(1);
}

const sql = readFileSync(resolve(file), "utf8");

/**
 * Splits on semicolons that terminate a statement.
 *
 * Naive splitting breaks the audit-immutability trigger, whose function body
 * is delimited by $$ and contains its own semicolons. Tracking the
 * dollar-quote state keeps that body intact.
 */
function splitStatements(text) {
  const out = [];
  let current = "";
  let inDollar = false;
  let inLineComment = false;

  for (let i = 0; i < text.length; i++) {
    const two = text.slice(i, i + 2);

    if (inLineComment) {
      current += text[i];
      if (text[i] === "\n") inLineComment = false;
      continue;
    }
    if (!inDollar && two === "--") {
      inLineComment = true;
      current += two;
      i++;
      continue;
    }
    if (two === "$$") {
      inDollar = !inDollar;
      current += two;
      i++;
      continue;
    }
    if (text[i] === ";" && !inDollar) {
      if (current.trim()) out.push(current.trim());
      current = "";
      continue;
    }
    current += text[i];
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

/** A fragment that is only comments has nothing to execute. */
function stripComments(statement) {
  return statement
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .trim();
}

const statements = splitStatements(sql).map(stripComments).filter((s) => s.length > 0);

const prisma = new PrismaClient();
let applied = 0;
let failed = 0;

for (const statement of statements) {
  const label = statement.replace(/\s+/g, " ").slice(0, 80);
  try {
    await prisma.$executeRawUnsafe(statement);
    applied++;
    console.log(`  ok    ${label}`);
  } catch (err) {
    failed++;
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  FAIL  ${label}`);
    console.error(`        ${msg.replace(/\s+/g, " ").slice(0, 260)}`);
  }
}

await prisma.$disconnect();
console.log(`\n${applied} applied, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
