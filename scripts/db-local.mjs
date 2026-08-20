/**
 * Local PostgreSQL for development — no Docker, no admin rights, no install.
 *
 * Downloads a real PostgreSQL 16 binary on first run and keeps its data in
 * ./pgdata. This is genuine Postgres, not an emulation, so the features the
 * SRS depends on all work: partial and BRIN indexes (section 8.4), native
 * partitioning (DB-017), pgcrypto, pg_trgm, and the audit-immutability
 * trigger (FR-LOG-004).
 *
 * Usage:
 *   node scripts/db-local.mjs start    start (and initialise on first run)
 *   node scripts/db-local.mjs stop
 *   node scripts/db-local.mjs status
 *
 * This is for DEVELOPMENT only. Production uses a managed instance per
 * section 3.3.
 */
import EmbeddedPostgres from "embedded-postgres";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = join(root, "pgdata");

const PORT = Number(process.env.PGPORT ?? 5432);
const USER = "lms";
const PASSWORD = "lms";
const DATABASE = "lms";

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: USER,
  password: PASSWORD,
  port: PORT,
  persistent: true,
  /*
   * UTF-8, EXPLICITLY, AND THIS IS NOT A PREFERENCE.
   *
   * `initdb` with no encoding takes it from the operating system's locale. On
   * an English-Windows machine that is WIN1252, and a WIN1252 database CANNOT
   * STORE URDU AT ALL:
   *
   *   ERROR: character with byte sequence 0xd8 0xb9 in encoding "UTF8"
   *          has no equivalent in encoding "WIN1252"
   *
   * Measured on a database this very script created. Latin-1 accents happen to
   * survive — "Zoë" stores fine — which is exactly what makes it dangerous:
   * every test somebody is likely to type passes, and the failure waits for a
   * student whose name is written in the script most of this Institute's
   * students actually use. It surfaces as a 500 on registration, from a
   * constraint nothing in the application layer mentions.
   *
   * The collation is left to the platform deliberately: `initdb` refuses a
   * locale the OS does not have, and getting UTF-8 encoding right is the part
   * that decides whether a name can be stored at all.
   *
   * THIS ONLY AFFECTS A DATABASE CREATED FROM NOW ON. An existing ./pgdata
   * keeps whatever encoding it was initialised with — encoding is fixed at
   * creation and cannot be altered afterwards. `npm run db:reset-local` prints
   * what to do about that.
   */
  initdbFlags: ["--encoding=UTF8"],
});

/** Refuses to go on if the cluster cannot hold the Institute's own names. */
async function warnIfNotUtf8() {
  const { Client } = await import("pg").catch(() => ({ Client: null }));
  if (!Client) return;
  const client = new Client({
    host: "localhost",
    port: PORT,
    user: USER,
    password: PASSWORD,
    database: DATABASE,
  });
  try {
    await client.connect();
    const { rows } = await client.query("SELECT current_setting('server_encoding') AS enc");
    const enc = rows[0]?.enc;
    if (enc && enc.toUpperCase() !== "UTF8") {
      console.log("");
      console.log(`  !  This database was created with ${enc}, not UTF8.`);
      console.log("     It CANNOT store Urdu, Arabic or any non-Latin script — a student");
      console.log("     named in Urdu fails to register with a 500 from the database.");
      console.log("");
      console.log("     Encoding is fixed when a cluster is created and cannot be changed.");
      console.log("     To fix it, back up anything you need, then:");
      console.log("");
      console.log("       node scripts/db-local.mjs stop");
      console.log("       rm -r pgdata           # deletes the local database entirely");
      console.log("       node scripts/db-local.mjs start");
      console.log("       npm run db:setup");
      console.log("");
    }
  } catch {
    // The check is a courtesy; a database that cannot be reached will report
    // itself far more loudly a moment later.
  } finally {
    await client.end().catch(() => undefined);
  }
}

const command = process.argv[2] ?? "start";

async function start() {
  const firstRun = !existsSync(join(dataDir, "PG_VERSION"));

  if (firstRun) {
    console.log("First run — downloading and initialising PostgreSQL 16…");
    console.log("(this happens once; subsequent starts are immediate)\n");
    mkdirSync(dataDir, { recursive: true });
    await pg.initialise();
  }

  await pg.start();

  if (firstRun) {
    await pg.createDatabase(DATABASE);
    console.log(`Created database "${DATABASE}".`);
  }

  await warnIfNotUtf8();

  const url = `postgresql://${USER}:${PASSWORD}@localhost:${PORT}/${DATABASE}?schema=public`;
  console.log("\nPostgreSQL is running.\n");
  console.log(`  DATABASE_URL=${url}\n`);
  console.log("Put that line in .env, then run:  npm run db:setup");
  console.log("Leave this process running. Ctrl+C stops the server.\n");

  // Keep the process alive; stop cleanly so the data directory is not left
  // in a recovery state.
  const shutdown = async () => {
    console.log("\nStopping PostgreSQL…");
    await pg.stop().catch(() => undefined);
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  await new Promise(() => undefined);
}

async function stop() {
  await pg.stop();
  console.log("PostgreSQL stopped.");
}

try {
  if (command === "start") await start();
  else if (command === "stop") await stop();
  else if (command === "status") {
    console.log(existsSync(join(dataDir, "PG_VERSION")) ? "initialised" : "not initialised");
  } else {
    console.error(`Unknown command "${command}". Use start, stop or status.`);
    process.exit(1);
  }
} catch (err) {
  console.error("\nFailed:", err instanceof Error ? err.message : err);
  console.error(
    "\nIf the port is in use, set PGPORT to something else, e.g.  PGPORT=5433 node scripts/db-local.mjs start",
  );
  process.exit(1);
}
