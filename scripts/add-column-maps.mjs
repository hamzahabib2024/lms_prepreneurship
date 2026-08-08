/**
 * One-off: adds @map("snake_case") to every scalar field in schema.prisma.
 *
 * DB-001 requires snake_case column names. Prisma's @@map covers the TABLE
 * name only; without a per-field @map, columns are created as quoted
 * camelCase identifiers. That breaks every raw SQL statement in
 * prisma/sql/, and forces any future hand-written query or BI tool to quote
 * every identifier.
 *
 * Relation fields are skipped: they are not columns. Their underlying foreign
 * keys ARE scalar fields and are handled normally.
 */
import { readFileSync, writeFileSync } from "node:fs";

const path = process.argv[2] ?? "apps/api/prisma/schema.prisma";
const src = readFileSync(path, "utf8");

const PRISMA_SCALARS = new Set([
  "String", "Boolean", "Int", "BigInt", "Float", "Decimal", "DateTime", "Json", "Bytes",
]);

// Model names denote relation fields; enum names denote real columns.
const modelNames = new Set([...src.matchAll(/^model\s+(\w+)\s*\{/gm)].map((m) => m[1]));

const toSnake = (name) =>
  name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .toLowerCase();

const lines = src.split(/\r?\n/);
const out = [];
let inModel = false;
let changed = 0;

for (const line of lines) {
  if (/^model\s+\w+\s*\{/.test(line)) inModel = true;
  else if (inModel && /^\}/.test(line)) inModel = false;

  if (!inModel) {
    out.push(line);
    continue;
  }

  // field name, type, then the rest (attributes and/or a trailing comment)
  const m = /^(\s+)([A-Za-z_]\w*)(\s+)([A-Za-z_]\w*)(\[\]|\?)?(.*)$/.exec(line);
  if (!m) {
    out.push(line);
    continue;
  }

  const [, indent, fieldName, gap, typeName, modifier = "", rest = ""] = m;

  // Block-level attributes (@@index, @@map) and anything already mapped.
  if (fieldName.startsWith("@") || rest.includes("@map(")) {
    out.push(line);
    continue;
  }
  // Relation fields are not columns.
  if (modelNames.has(typeName)) {
    out.push(line);
    continue;
  }
  // Enums are columns, so only genuinely unknown types are skipped.
  const isEnum = !PRISMA_SCALARS.has(typeName) && !modelNames.has(typeName);
  if (!PRISMA_SCALARS.has(typeName) && !isEnum) {
    out.push(line);
    continue;
  }

  const snake = toSnake(fieldName);
  if (snake === fieldName) {
    out.push(line); // already snake_case, e.g. `id`
    continue;
  }

  // Keep any trailing `//` comment after the attribute we add.
  const commentAt = rest.indexOf("//");
  const attrs = commentAt >= 0 ? rest.slice(0, commentAt).trimEnd() : rest.trimEnd();
  const comment = commentAt >= 0 ? " " + rest.slice(commentAt) : "";

  out.push(`${indent}${fieldName}${gap}${typeName}${modifier}${attrs} @map("${snake}")${comment}`);
  changed++;
}

writeFileSync(path, out.join("\n"));
console.log(`Added @map to ${changed} columns in ${path}`);
