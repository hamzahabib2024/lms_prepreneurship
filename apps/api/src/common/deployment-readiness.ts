/**
 * WHAT BREAKS WHEN THERE IS MORE THAN ONE OF THIS PROCESS.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS. Every problem it names is invisible on one node and
 * silent on several. Nothing crashes, no error is logged, no test fails: a
 * student uploads a payment slip to node A and the office opens it on node B
 * and is told the file is gone. A Super Admin lowers the attendance threshold
 * and half the Institute is warned at the old figure. A teacher is removed
 * from a section and keeps reading it for another minute.
 *
 * These are not bugs in the code — they are bugs in the DEPLOYMENT, and the
 * only moment anybody is in a position to notice is startup. So the checks run
 * there, and they are LOUD in proportion to the damage: an upload that lands
 * on one node's disk is data loss, and it is reported as a blocker.
 *
 * IT DOES NOT REFUSE TO START. A single-node deployment is a legitimate and
 * common way to run this System, and every one of these is correct there. The
 * job is to make sure nobody discovers the difference from a student.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export type Severity = "blocker" | "warning" | "note";

export interface ReadinessFinding {
  severity: Severity;
  what: string;
  why: string;
  fix: string;
}

export interface DeploymentEnv {
  /** How many API processes will run behind the load balancer. */
  instances: number;
  documentStorage: string;
  lectureStorage: string;
  redisUrl: string;
  trustProxyHops: string;
  actorCacheTtlMs: number;
  settingsCacheTtlMs: number;
  nodeEnv: string;
}

export function readEnv(env: NodeJS.ProcessEnv): DeploymentEnv {
  return {
    // Named by the operator, because a process cannot see its own siblings.
    // Unset means one, which is the safe reading: the checks below then stay
    // quiet, and a single node is genuinely fine.
    instances: Number(env["API_INSTANCES"] ?? "1"),
    documentStorage: (env["DOCUMENT_STORAGE"] ?? "local").trim(),
    lectureStorage: (env["LECTURE_STORAGE"] ?? "local").trim(),
    redisUrl: (env["REDIS_URL"] ?? "").trim(),
    trustProxyHops: (env["TRUST_PROXY_HOPS"] ?? "").trim(),
    actorCacheTtlMs: Number(env["ACTOR_CACHE_TTL_MS"] ?? 60_000),
    settingsCacheTtlMs: Number(env["SETTINGS_CACHE_TTL_MS"] ?? 60_000),
    nodeEnv: (env["NODE_ENV"] ?? "development").trim(),
  };
}

export function assessDeployment(env: DeploymentEnv): ReadinessFinding[] {
  const findings: ReadinessFinding[] = [];
  const many = env.instances > 1;

  /*
   * THE ONE THAT LOSES FILES, and the reason this is a blocker rather than a
   * warning. Local storage is a directory on the container that handled the
   * upload. A payment slip written by node A does not exist for node B, and
   * the ROW does — so the office sees a submission with a file it cannot open,
   * and the student is told to send it again.
   */
  if (many && env.documentStorage === "local") {
    findings.push({
      severity: "blocker",
      what: "Documents are stored on local disk while running more than one instance.",
      why:
        "Payment slips, assignment submissions and lesson resources are written to the disk of " +
        "whichever node handled the upload. Another node cannot read them. The database row " +
        "survives and points at a file that is not there, so this presents as the Institute " +
        "losing a student's evidence rather than as a configuration mistake.",
      fix: "Set DOCUMENT_STORAGE to a shared provider (google_drive, or S3-compatible object storage).",
    });
  }

  if (many && env.lectureStorage === "local") {
    findings.push({
      severity: "blocker",
      what: "Recordings are stored on local disk while running more than one instance.",
      why:
        "A lecture uploaded through one node is unplayable through any other. Playback fails " +
        "with 'this recording is no longer available', which reads as a deleted file.",
      fix: "Set LECTURE_STORAGE=google_drive.",
    });
  }

  /*
   * Rate limiting and permission caches are per-process. Neither loses data;
   * both weaken a guarantee, quietly.
   */
  if (many && !env.redisUrl) {
    findings.push({
      severity: "warning",
      what: "No shared cache while running more than one instance.",
      why:
        "Rate limits are counted per process, so N nodes allow roughly N times the intended " +
        "number of login attempts before locking out — the protection against password " +
        "guessing is divided by the number of nodes. Permission caches cannot be purged " +
        "across processes either, so a revoked role stays in force elsewhere until its TTL " +
        `expires (currently ${Math.round(env.actorCacheTtlMs / 1000)}s).`,
      fix:
        "Set REDIS_URL and move the throttler and the actor cache onto it. Until then, keep " +
        "ACTOR_CACHE_TTL_MS low and prefer fewer, larger nodes.",
    });
  }

  if (many && env.actorCacheTtlMs > 300_000) {
    findings.push({
      severity: "warning",
      what: `Permissions are cached for ${Math.round(env.actorCacheTtlMs / 60_000)} minutes across several nodes.`,
      why:
        "A role revoked, an account suspended or a teacher removed from a section takes effect " +
        "immediately only on the node that handled it. Everywhere else the old reach survives " +
        "for the full period.",
      fix: "Lower ACTOR_CACHE_TTL_MS, or put the cache in Redis so the purge crosses processes.",
    });
  }

  /*
   * Not about instances at all, and it is the one most likely to be missed:
   * behind ANY proxy, every request appears to come from the proxy unless this
   * is set. The rate limiter then counts the whole Institute as one client.
   */
  if (env.trustProxyHops === "" && env.nodeEnv === "production") {
    findings.push({
      severity: "warning",
      what: "TRUST_PROXY_HOPS is not set in production.",
      why:
        "Behind nginx or a load balancer every request appears to originate from the proxy. " +
        "The rate limiter then treats the entire Institute as a single client and locks " +
        "everybody out together, and the audit log records the proxy's address instead of the " +
        "person's.",
      fix: "Set TRUST_PROXY_HOPS to the number of proxies in front of the API (usually 1).",
    });
  }

  /*
   * The hourly lecture sweep runs on a timer INSIDE each process, so every
   * node runs it. It is idempotent — it matches on storage reference — so the
   * result is correct and the work is duplicated. Worth knowing, not worth
   * alarming about.
   */
  if (many) {
    findings.push({
      severity: "note",
      what: "The hourly recording sweep runs on every node.",
      why:
        "It is idempotent — recordings are matched by storage reference, so nothing is " +
        "catalogued twice — but the Drive API is called once per node per hour, against a " +
        "quota shared by all of them.",
      fix: "Harmless at this scale. If the quota bites, run the sweep on one node only.",
    });
  }

  return findings;
}

/** Ordered worst-first, because the first line is the one that gets read. */
export function formatFindings(findings: ReadinessFinding[]): string[] {
  const rank: Record<Severity, number> = { blocker: 0, warning: 1, note: 2 };
  return [...findings]
    .sort((a, b) => rank[a.severity] - rank[b.severity])
    .map((f) => `[${f.severity.toUpperCase()}] ${f.what}\n    Why:  ${f.why}\n    Fix:  ${f.fix}`);
}
