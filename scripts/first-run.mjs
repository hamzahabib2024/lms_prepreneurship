/**
 * Everything a fresh copy needs, in one command: npm run setup
 *
 * SAFE TO RUN TWICE, because people do. Each step checks whether it is already
 * done and says so rather than failing — a setup script that errors on the
 * second run teaches everybody to distrust it and read it instead.
 *
 * It does NOT start the servers. `npm start` does that, and keeping them apart
 * means setup can be run once in a deployment and the process manager can own
 * the running.
 */
import { execSync } from "node:child_process";
import { existsSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const GREEN = "[32m", DIM = "[2m", YEL = "[33m", RED = "[31m", OFF = "[0m";
const ok = (s) => console.log(`  ${GREEN}✓${OFF} ${s}`);
const skip = (s) => console.log(`  ${DIM}·${OFF} ${DIM}${s}${OFF}`);
const warn = (s) => console.log(`  ${YEL}!${OFF} ${s}`);

function run(command, label) {
  try {
    execSync(command, { cwd: root, stdio: "pipe" });
    ok(label);
    return true;
  } catch (err) {
    console.log(`  ${RED}✗${OFF} ${label}`);
    const out = `${err.stdout ?? ""}${err.stderr ?? ""}`.toString().trim();
    if (out) console.log(`\n${out.split("\n").slice(-12).join("\n")}\n`);
    return false;
  }
}

console.log("\nSetting up the Prepreneurship LMS\n");

// 1. .env ---------------------------------------------------------------------
const env = join(root, ".env");
if (existsSync(env)) {
  skip(".env already exists, leaving it alone");
} else {
  copyFileSync(join(root, ".env.example"), env);
  ok("created .env from .env.example");
}

// 2. Signing keys -------------------------------------------------------------
/*
 * RS256 tokens need a key pair and the app will not start without one.
 *
 * The filename matters and I got it wrong first time — keys/jwt-private.pem,
 * not keys/private.pem — so this step tried to generate keys that already
 * existed and generate-keys.mjs correctly refused, because rotating the
 * signing key invalidates every issued token (SEC-CRY-011). A setup script
 * that fails on its second run is one nobody trusts, so the check has to name
 * the file the generator actually writes.
 */
if (existsSync(join(root, "keys", "jwt-private.pem"))) {
  skip("signing keys already present");
} else if (!run("node scripts/generate-keys.mjs", "generated the JWT signing keys")) {
  process.exit(1);
}

// 3. Database -----------------------------------------------------------------
// embedded-postgres, so there is nothing to install and no Docker needed.
if (existsSync(join(root, "pgdata"))) {
  skip("database already initialised (pgdata/)");
} else if (!run("node scripts/db-local.mjs start", "started PostgreSQL and initialised it")) {
  console.log(`  ${DIM}If port 5432 is already taken by another PostgreSQL, stop it or set PGPORT.${OFF}`);
  process.exit(1);
}

// 4. Schema, constraints, seed ------------------------------------------------
/*
 * On Windows a running API holds the Prisma query engine open, and generating
 * over it fails with EPERM naming a .dll.node temp file — which tells somebody
 * nothing about what to do. If a client is already generated, that is a
 * warning; if there is none, setup genuinely cannot continue.
 */
const generated = existsSync(join(root, "node_modules", ".prisma", "client", "index.js"));
if (!run("npm run db:generate", "generated the database client")) {
  if (generated) {
    warn("could not regenerate the database client — one is already there, carrying on");
    console.log(`  ${DIM}Usually means the API is running and holding it open. If you have just${OFF}`);
    console.log(`  ${DIM}changed the schema, stop the servers and run this again.${OFF}`);
  } else {
    console.log(`  ${DIM}Stop anything already running (npm start) and try again.${OFF}`);
    process.exit(1);
  }
}
if (!run("npx prisma migrate deploy --schema=apps/api/prisma/schema.prisma", "applied the migrations")) process.exit(1);
if (!run("npm run db:constraints", "applied the constraints and indexes")) process.exit(1);

// The seed is the one step that is genuinely re-runnable-with-care: it upserts
// the fixed accounts and skips what it already made.
if (!run("npm run db:seed", "loaded the sample institute")) {
  warn("the seed did not complete — the System will still run, with no sample data");
}

console.log(`
${GREEN}Ready.${OFF}

  ${GREEN}npm start${OFF}      both servers

  then open   ${GREEN}http://localhost:5173${OFF}       sign in
              ${GREEN}http://localhost:5173/home${OFF}  the public page

  admin@institute.local        ChangeMe!Admin2026
  sana@institute.local         ChangeMe!Teacher2026
  ayesha1@student.local        ChangeMe!Student2026
  superadmin@institute.local   ChangeMe!SuperAdmin2026
`);
