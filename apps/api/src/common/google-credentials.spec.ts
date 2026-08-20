import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  hasGoogleCredentials,
  loadGoogleCredentials,
  resolveGoogleKeyPath,
} from "./google-credentials";

/**
 * Where the Google key is — the resolution that was wrong for months.
 *
 * THE BUG THESE GUARD. The Drive provider, the Meet provider and the
 * integrations screen each read GOOGLE_SERVICE_ACCOUNT_JSON alone. Only
 * docker-compose sets that variable; it composes it from GOOGLE_CREDENTIALS_DIR
 * and GOOGLE_SERVICE_ACCOUNT_FILE, which are the two a person actually writes
 * in .env. So an Institute with a valid key on disk, a folder shared with the
 * service account and LECTURE_STORAGE=google_drive was told "Google Drive: not
 * configured" every time the API was started with npm run dev — and lectures
 * silently fell back to local storage.
 *
 * The failure was invisible because every layer degraded politely. Nothing
 * threw. The status screen simply said SIMULATED, which is also what it says
 * when there is genuinely no key, so the two were indistinguishable.
 */
describe("Google service-account credentials", () => {
  let dir: string;
  const KEY = {
    type: "service_account",
    project_id: "prepreneurship-lms",
    client_email: "lms-drive@prepreneurship-lms.iam.gserviceaccount.com",
    private_key: "-----BEGIN PRIVATE KEY-----\nMIIB\n-----END PRIVATE KEY-----\n",
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "lms-creds-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const reader = (values: Record<string, string>) => (k: string) => values[k] ?? "";

  function writeKey(name = "key.json", contents: unknown = KEY): string {
    const path = join(dir, name);
    writeFileSync(path, typeof contents === "string" ? contents : JSON.stringify(contents));
    return path;
  }

  // ─────────────────────────────────────────────────────── the actual bug ──

  it("finds the key from GOOGLE_CREDENTIALS_DIR and GOOGLE_SERVICE_ACCOUNT_FILE", () => {
    // Exactly what .env holds, and exactly what nothing outside Docker read.
    writeKey("prepreneurship-lms-96c067b8d9ed.json");
    const result = loadGoogleCredentials(
      reader({
        GOOGLE_CREDENTIALS_DIR: dir,
        GOOGLE_SERVICE_ACCOUNT_FILE: "prepreneurship-lms-96c067b8d9ed.json",
      }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.credentials.clientEmail).toBe(KEY.client_email);
      expect(result.credentials.projectId).toBe("prepreneurship-lms");
    }
  });

  it("reports the integration LIVE for the pair, not just for the composed variable", () => {
    writeKey();
    expect(
      hasGoogleCredentials(
        reader({ GOOGLE_CREDENTIALS_DIR: dir, GOOGLE_SERVICE_ACCOUNT_FILE: "key.json" }),
      ),
    ).toBe(true);
  });

  // ───────────────────────────────────────────────── the forms that worked ──

  it("still accepts a path in GOOGLE_SERVICE_ACCOUNT_JSON — what compose sets", () => {
    const path = writeKey();
    const result = loadGoogleCredentials(reader({ GOOGLE_SERVICE_ACCOUNT_JSON: path }));
    expect(result.ok).toBe(true);
  });

  it("still accepts the JSON pasted into the variable itself", () => {
    const result = loadGoogleCredentials(
      reader({ GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify(KEY) }),
    );
    expect(result.ok).toBe(true);
  });

  it("prefers GOOGLE_SERVICE_ACCOUNT_JSON when both are set", () => {
    // A deployment that has been migrated leaves both behind. The composed one
    // is the deliberate override; silently preferring the pair would ignore it.
    const path = writeKey("explicit.json", { ...KEY, client_email: "explicit@example.com" });
    writeKey("pair.json", { ...KEY, client_email: "pair@example.com" });
    const result = loadGoogleCredentials(
      reader({
        GOOGLE_SERVICE_ACCOUNT_JSON: path,
        GOOGLE_CREDENTIALS_DIR: dir,
        GOOGLE_SERVICE_ACCOUNT_FILE: "pair.json",
      }),
    );
    expect(result.ok && result.credentials.clientEmail).toBe("explicit@example.com");
  });

  it("repairs the escaped newlines a pasted key arrives with", () => {
    // An environment variable cannot hold a real newline, so a key pasted into
    // .env has a literal backslash-n in it. Left alone, signing fails with a
    // PEM error naming nothing an administrator can act on.
    const escaped = JSON.stringify({
      ...KEY,
      private_key: KEY.private_key.split("\n").join(String.raw`\n`),
    });
    const result = loadGoogleCredentials(reader({ GOOGLE_SERVICE_ACCOUNT_JSON: escaped }));
    expect(result.ok && result.credentials.privateKey).toContain("\n");
    expect(result.ok && result.credentials.privateKey).not.toContain(String.raw`\n`);
  });

  // ──────────────────────────────────────────────────── refusing honestly ──

  it("treats the compose none.json placeholder as no key at all", () => {
    // docker-compose substitutes it when GOOGLE_SERVICE_ACCOUNT_FILE is empty.
    // Without this the answer is a file-not-found naming a file nobody chose.
    const result = loadGoogleCredentials(
      reader({ GOOGLE_SERVICE_ACCOUNT_JSON: "/run/credentials/none.json" }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/DEP-01/);
  });

  it("names the path it looked at when the file is not there", () => {
    const result = loadGoogleCredentials(
      reader({ GOOGLE_CREDENTIALS_DIR: dir, GOOGLE_SERVICE_ACCOUNT_FILE: "absent.json" }),
    );
    expect(result.ok).toBe(false);
    // The single most common failure is a host path inside a container, and it
    // is unguessable unless the message says which path was tried.
    if (!result.ok) expect(result.reason).toContain("absent.json");
  });

  it("says the key is incomplete rather than that it is missing", () => {
    writeKey("half.json", { client_email: "a@b.com" });
    const result = loadGoogleCredentials(
      reader({ GOOGLE_CREDENTIALS_DIR: dir, GOOGLE_SERVICE_ACCOUNT_FILE: "half.json" }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/client_email or private_key/);
  });

  it("says the key is unreadable rather than absent when it is not JSON", () => {
    writeKey("broken.json", "not json at all");
    const result = loadGoogleCredentials(
      reader({ GOOGLE_CREDENTIALS_DIR: dir, GOOGLE_SERVICE_ACCOUNT_FILE: "broken.json" }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/not valid JSON/);
  });

  it("is not configured when nothing at all is set", () => {
    expect(hasGoogleCredentials(reader({}))).toBe(false);
    expect(resolveGoogleKeyPath(reader({}))).toBeNull();
  });
});
