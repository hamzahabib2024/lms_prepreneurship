/**
 * Load test — NFR-PRF, 150 concurrent users.
 *
 * Usage:  CONC=150 SECS=30 node scripts/load-test.mjs
 *
 * Raise THROTTLE_LIMIT_PER_MINUTE on the SERVER before running, or this
 * measures the rate limiter refusing you rather than the application. All the
 * load comes from one address, and §7.7's ceiling is per address.
 *
 * WHAT THIS IS NOT. The API, PostgreSQL and this script all run on one machine,
 * so the numbers include no network and share a CPU with the database. That
 * makes them useful for finding a query that falls over under concurrency and
 * useless as a production verdict. Treat a bad number here as real and a good
 * one as "not obviously broken".
 *
 * MEASURED, 12 August 2026, on a developer laptop:
 *
 *   concurrency 10    p50   53ms   p95  125ms   165 req/s
 *   concurrency 150   p50  798ms   p95 1792ms   164 req/s
 *
 * Throughput is IDENTICAL at both, which is the whole finding: the server
 * saturates around 165 req/s here and the latency at 150 is queueing, not slow
 * queries. 150 signed-in users do not make 150 requests a second — with any
 * realistic think-time that is a handful per second — so this is headroom
 * rather than a wall. It is also a single process: the ceiling moves with
 * cores and instances, and the Docker stack already runs behind nginx.
 *
 * The slowest endpoint is /dashboards/me, which is also the first thing every
 * user opens in the morning. If anything here is worth optimising, it is that.
 *
 * The mix is what an institute actually does at nine in the morning: mostly
 * reading — dashboards, timetables, subject lists — with a thin slice of the
 * heavier report and roster queries an administrator runs while everyone else
 * is logging in.
 */
const BASE = "http://localhost:3000/api/v1";
const CONCURRENCY = Number(process.env["CONC"] ?? 150);
const DURATION_MS = Number(process.env["SECS"] ?? 30) * 1000;

async function login(email, password) {
  const r = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!r.ok) throw new Error(`login ${email}: ${r.status}`);
  const j = await r.json();
  return j.data.accessToken ?? j.data.tokens?.accessToken;
}

/** Weighted so reads dominate, as they do in life. */
const JOURNEY = [
  { path: "/dashboards/me", weight: 5 },
  { path: "/timetable/me", weight: 4 },
  { path: "/me/notifications?limit=20", weight: 4 },
  { path: "/announcements", weight: 3 },
  { path: "/sections", weight: 3 },
  { path: "/subjects", weight: 2 },
  { path: "/academic-sessions", weight: 1 },
  { path: "/reports", weight: 1 },
  { path: "/reports/attendance-summary", weight: 1 },
];
const BAG = JOURNEY.flatMap((j) => Array.from({ length: j.weight }, () => j.path));

const samples = [];
const byPath = new Map();
let errors = 0;
const statusCounts = new Map();

async function worker(token, deadline) {
  while (Date.now() < deadline) {
    const path = BAG[Math.floor(Math.random() * BAG.length)];
    const t0 = performance.now();
    try {
      const res = await fetch(`${BASE}${path}`, { headers: { authorization: `Bearer ${token}` } });
      // Drain the body: not doing so measures time-to-headers, which is not
      // what a user waits for.
      await res.arrayBuffer();
      const ms = performance.now() - t0;
      statusCounts.set(res.status, (statusCounts.get(res.status) ?? 0) + 1);
      if (res.status >= 500) errors++;
      // ONLY SUCCESSFUL RESPONSES ARE TIMED. A 429 is refused before it
      // reaches a query and a 404 never had one, so both are fast — including
      // them produces a flattering p95 that measures the throttler. The first
      // run of this script reported p95 879ms with 43% 429s and 38% 404s.
      if (res.status >= 200 && res.status < 300) {
        samples.push(ms);
        if (!byPath.has(path)) byPath.set(path, []);
        byPath.get(path).push(ms);
      }
    } catch (e) {
      errors++;
      statusCounts.set("network", (statusCounts.get("network") ?? 0) + 1);
    }
  }
}

const pct = (arr, p) => {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

const main = async () => {
  console.log(`signing in ${CONCURRENCY} sessions…`);
  const accounts = [
    ["admin@institute.local", "ChangeMe!Admin2026"],
    ["sana@institute.local", "ChangeMe!Teacher2026"],
    ["ayesha1@student.local", "ChangeMe!Student2026"],
    ["fatima5@student.local", "ChangeMe!Student2026"],
    ["aliya7@student.local", "ChangeMe!Student2026"],
    ["hina2@student.local", "ChangeMe!Student2026"],
  ];
  const tokens = [];
  for (const [e, p] of accounts) {
    try { tokens.push(await login(e, p)); } catch (err) { console.log(`  (${e} unavailable)`); }
  }
  if (tokens.length === 0) throw new Error("no accounts could sign in");
  console.log(`  ${tokens.length} distinct accounts, reused across ${CONCURRENCY} workers`);

  const deadline = Date.now() + DURATION_MS;
  const started = Date.now();
  await Promise.all(
    Array.from({ length: CONCURRENCY }, (_, i) => worker(tokens[i % tokens.length], deadline)),
  );
  const elapsed = (Date.now() - started) / 1000;

  const total = [...statusCounts.values()].reduce((a, b) => a + b, 0);
  const rejected = (statusCounts.get(429) ?? 0) + (statusCounts.get(404) ?? 0);
  console.log(`\n${total} requests in ${elapsed.toFixed(1)}s at concurrency ${CONCURRENCY}`);
  console.log(`  timed (2xx only): ${samples.length}`);
  if (rejected / Math.max(1, total) > 0.05) {
    console.log(
      `\n  ⚠  ${((rejected / total) * 100).toFixed(0)}% of requests were 429 or 404. ` +
        `The latency below is measured only from the ${samples.length} that succeeded, ` +
        `but a run this rejected does not represent the system under load.`,
    );
  }
  console.log(`throughput: ${(samples.length / elapsed).toFixed(0)} req/s`);
  console.log(`errors (5xx or network): ${errors}`);
  console.log("status codes:", Object.fromEntries(statusCounts));
  console.log(`\nlatency, whole mix (ms)`);
  console.log(`  p50 ${pct(samples, 50).toFixed(0)}   p90 ${pct(samples, 90).toFixed(0)}   p95 ${pct(samples, 95).toFixed(0)}   p99 ${pct(samples, 99).toFixed(0)}   max ${Math.max(...samples).toFixed(0)}`);

  console.log(`\nby endpoint (n, p50, p95, p99)`);
  const rows = [...byPath.entries()].sort((a, b) => pct(b[1], 95) - pct(a[1], 95));
  for (const [path, arr] of rows) {
    console.log(
      `  ${path.padEnd(34)} ${String(arr.length).padStart(5)}  ${pct(arr, 50).toFixed(0).padStart(5)}  ${pct(arr, 95).toFixed(0).padStart(6)}  ${pct(arr, 99).toFixed(0).padStart(6)}`,
    );
  }
};

main().catch((e) => { console.error("LOAD TEST ERROR:", e.message); process.exit(1); });
