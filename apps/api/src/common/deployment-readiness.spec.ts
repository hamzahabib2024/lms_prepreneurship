import {
  assessDeployment,
  formatFindings,
  readEnv,
  type DeploymentEnv,
} from "./deployment-readiness";

/**
 * Every finding here describes a failure that is INVISIBLE on one node and
 * SILENT on several: nothing crashes, nothing is logged, no test fails, and a
 * student is told their payment slip does not exist.
 *
 * The tests are mostly about what is NOT reported. A readiness check that
 * warns about a single-node deployment is one whose output people learn to
 * scroll past — and then miss the blocker on the day it matters.
 */

const base: DeploymentEnv = {
  instances: 1,
  documentStorage: "local",
  lectureStorage: "local",
  redisUrl: "",
  trustProxyHops: "1",
  actorCacheTtlMs: 60_000,
  settingsCacheTtlMs: 60_000,
  nodeEnv: "production",
};

const of = (over: Partial<DeploymentEnv> = {}) => assessDeployment({ ...base, ...over });
const sev = (f: ReturnType<typeof assessDeployment>) => f.map((x) => x.severity);

describe("one node is a legitimate deployment", () => {
  it("says nothing at all when there is one instance", () => {
    // The whole value of this check depends on it being quiet when it should
    // be. Local storage on a single node is correct, not a finding.
    expect(of()).toEqual([]);
  });

  it("stays quiet even with no Redis and a long permission cache", () => {
    expect(of({ redisUrl: "", actorCacheTtlMs: 15 * 60_000 })).toEqual([]);
  });
});

describe("local storage across several nodes loses files", () => {
  it("is a BLOCKER, not a warning", () => {
    /*
     * The row survives and the file does not, so the office opens a submission
     * and finds nothing. That is data loss presented as a missing file, and it
     * is the single most damaging thing on this list.
     */
    const f = of({ instances: 3 });
    expect(sev(f)).toContain("blocker");
    const blockers = f.filter((x) => x.severity === "blocker");
    expect(blockers).toHaveLength(2); // documents and lectures
    expect(blockers[0]!.fix).toContain("DOCUMENT_STORAGE");
  });

  it("clears once storage is shared", () => {
    const f = of({ instances: 3, documentStorage: "google_drive", lectureStorage: "google_drive" });
    expect(sev(f)).not.toContain("blocker");
  });
});

describe("what is weakened rather than broken", () => {
  it("warns that rate limits are divided by the number of nodes", () => {
    const f = of({ instances: 3, documentStorage: "google_drive", lectureStorage: "google_drive" });
    const w = f.find((x) => x.severity === "warning");
    expect(w?.why).toContain("per process");
  });

  it("stops warning about the cache once Redis is configured", () => {
    const f = of({
      instances: 3,
      documentStorage: "google_drive",
      lectureStorage: "google_drive",
      redisUrl: "redis://cache:6379",
    });
    expect(sev(f)).not.toContain("warning");
  });

  it("objects to a long permission cache only across several nodes", () => {
    const many = of({
      instances: 3,
      documentStorage: "google_drive",
      lectureStorage: "google_drive",
      redisUrl: "redis://cache:6379",
      actorCacheTtlMs: 15 * 60_000,
    });
    expect(many.some((x) => x.what.includes("Permissions are cached"))).toBe(true);
    // On one node the purge is synchronous and correct, so the TTL is not a
    // security question at all.
    expect(of({ actorCacheTtlMs: 15 * 60_000 })).toEqual([]);
  });
});

describe("the proxy header, which is missed most often", () => {
  it("warns in production when TRUST_PROXY_HOPS is unset", () => {
    const f = of({ trustProxyHops: "" });
    expect(f.some((x) => x.what.includes("TRUST_PROXY_HOPS"))).toBe(true);
  });

  it("does not nag in development", () => {
    expect(of({ trustProxyHops: "", nodeEnv: "development" })).toEqual([]);
  });
});

describe("reading the environment", () => {
  it("treats an unset instance count as one", () => {
    // The safe reading: a process cannot see its siblings, and assuming many
    // would make every single-node deployment noisy.
    expect(readEnv({} as NodeJS.ProcessEnv).instances).toBe(1);
  });

  it("defaults storage to local, which is what the providers do", () => {
    const e = readEnv({} as NodeJS.ProcessEnv);
    expect(e.documentStorage).toBe("local");
    expect(e.lectureStorage).toBe("local");
  });
});

describe("the output", () => {
  it("puts blockers first, because the first line is the one that gets read", () => {
    const lines = formatFindings(of({ instances: 3, trustProxyHops: "" }));
    expect(lines[0]).toMatch(/^\[BLOCKER\]/);
    expect(lines[lines.length - 1]).toMatch(/^\[NOTE\]/);
  });

  it("gives every finding a why and a fix", () => {
    for (const f of of({ instances: 3, trustProxyHops: "" })) {
      expect(f.why.length).toBeGreaterThan(40);
      expect(f.fix.length).toBeGreaterThan(10);
    }
  });
});
