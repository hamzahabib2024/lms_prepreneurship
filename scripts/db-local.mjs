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
});

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
