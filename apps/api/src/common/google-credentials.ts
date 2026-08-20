import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";

/**
 * Where the Google service-account key is — resolved the SAME WAY everywhere.
 *
 * THE BUG THIS EXISTS TO KILL. Three places asked for the key and all three
 * asked for `GOOGLE_SERVICE_ACCOUNT_JSON` alone: the Drive storage provider,
 * the Meet provider, and the integrations screen. That variable is set by
 * docker-compose, which composes it out of GOOGLE_CREDENTIALS_DIR and
 * GOOGLE_SERVICE_ACCOUNT_FILE:
 *
 *   GOOGLE_SERVICE_ACCOUNT_JSON: /run/credentials/${GOOGLE_SERVICE_ACCOUNT_FILE}
 *
 * Nothing composes it when the API is started any other way — `npm run dev`,
 * `npm start`, a bare `node dist/main.js`, or the test suite. So an Institute
 * with a VALID key on disk, a folder correctly shared with the service
 * account, and LECTURE_STORAGE=google_drive was told "Google Drive: not
 * configured", and lectures silently fell back to local storage. The key was
 * never the problem; the name of the variable was.
 *
 * The three accepted forms, in the order they are tried:
 *
 *   1. GOOGLE_SERVICE_ACCOUNT_JSON holding the JSON itself — a container
 *      platform that has environment variables and no filesystem to mount.
 *   2. GOOGLE_SERVICE_ACCOUNT_JSON holding a PATH — what docker-compose sets,
 *      and a path inside the container.
 *   3. GOOGLE_CREDENTIALS_DIR + GOOGLE_SERVICE_ACCOUNT_FILE — the pair a
 *      person actually writes in .env, and the pair the docker mount is
 *      configured from. Now honoured OUTSIDE Docker too, which is the fix.
 *
 * `/none.json` is treated as unset because that is the compose default when
 * GOOGLE_SERVICE_ACCOUNT_FILE is empty; without this, "not configured" arrives
 * as a file-not-found error naming a file nobody chose.
 */

export interface GoogleServiceAccount {
  clientEmail: string;
  privateKey: string;
  projectId: string | null;
  /** Where it came from, for a status screen that has to explain itself. */
  source: string;
}

export type GoogleCredentialsResult =
  | { ok: true; credentials: GoogleServiceAccount }
  | { ok: false; reason: string };

/** Reads a variable through whatever the caller has — ConfigService or env. */
export type EnvReader = (key: string) => string | undefined;

export const processEnvReader: EnvReader = (key) => process.env[key];

/**
 * The path the key should be at, or null if none is configured.
 *
 * Exported because the integrations screen wants to say WHERE it looked, and
 * because check-integrations.mjs mirrors this logic for the same reason.
 */
export function resolveGoogleKeyPath(read: EnvReader = processEnvReader): string | null {
  const direct = (read("GOOGLE_SERVICE_ACCOUNT_JSON") ?? "").trim();
  if (direct && !direct.startsWith("{") && !isNoneSentinel(direct)) return direct;

  const dir = (read("GOOGLE_CREDENTIALS_DIR") ?? "").trim();
  const file = (read("GOOGLE_SERVICE_ACCOUNT_FILE") ?? "").trim();
  if (!file || isNoneSentinel(file)) return null;
  // A filename on its own is allowed: somebody who sets only the file has put
  // it beside the app, and refusing that costs an hour to discover.
  return dir ? join(dir, file) : file;
}

/** True when the deployment has named a key at all, whatever shape it took. */
export function hasGoogleCredentials(read: EnvReader = processEnvReader): boolean {
  return loadGoogleCredentials(read).ok;
}

/**
 * The key itself, or the reason there isn't one — in words somebody can act on.
 *
 * Never throws. Every caller here is deciding whether a feature is available,
 * and a status screen that raises an exception because a variable is empty is
 * worse than the missing feature.
 */
export function loadGoogleCredentials(read: EnvReader = processEnvReader): GoogleCredentialsResult {
  const direct = (read("GOOGLE_SERVICE_ACCOUNT_JSON") ?? "").trim();

  // Form 1 — the JSON pasted straight into the variable.
  if (direct.startsWith("{")) return parse(direct, "GOOGLE_SERVICE_ACCOUNT_JSON");

  const path = resolveGoogleKeyPath(read);
  if (!path) {
    return {
      ok: false,
      reason:
        "No service-account key is set (DEP-01). Put the key JSON where the API can read it, " +
        "then set GOOGLE_CREDENTIALS_DIR to its folder and GOOGLE_SERVICE_ACCOUNT_FILE to its " +
        "filename — or paste the JSON itself into GOOGLE_SERVICE_ACCOUNT_JSON.",
    };
  }

  if (!existsSync(path)) {
    return {
      ok: false,
      reason:
        `The key was not found at "${path}". ` +
        (isAbsolute(path)
          ? "If the API runs in Docker, that must be a path INSIDE the container — a path on " +
            "your own machine is not visible to it. GOOGLE_CREDENTIALS_DIR is mounted at " +
            "/run/credentials, so recreate the containers after changing it (npm run docker:up)."
          : "That is a RELATIVE path, resolved from wherever the server was started, which is " +
            "rarely where you think. Use an absolute path, or set GOOGLE_CREDENTIALS_DIR."),
    };
  }

  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    return {
      ok: false,
      reason:
        `The key at "${path}" could not be read: ` +
        `${err instanceof Error ? err.message : "unknown error"}. Check the file's permissions.`,
    };
  }

  return parse(raw, path);
}

function isNoneSentinel(value: string): boolean {
  // docker-compose substitutes "none.json" when the filename is empty.
  return value === "none.json" || value.endsWith("/none.json") || value.endsWith("\\none.json");
}

function parse(raw: string, source: string): GoogleCredentialsResult {
  let parsed: { client_email?: string; private_key?: string; project_id?: string };
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    return {
      ok: false,
      reason:
        `The key at "${source}" is not valid JSON. If it was pasted into .env it must be on ONE ` +
        "line; if it is a path, check it points at the file and not at a folder. Download it " +
        "again rather than editing it — it is machine-written.",
    };
  }

  if (!parsed.client_email || !parsed.private_key) {
    return {
      ok: false,
      reason:
        `The key at "${source}" has no client_email or private_key. Download it again from ` +
        "Google Cloud → Service accounts → Keys, choosing JSON.",
    };
  }

  return {
    ok: true,
    credentials: {
      clientEmail: parsed.client_email,
      // Environment variables cannot hold real newlines, so a pasted key
      // arrives with literal \n. Left unfixed, signing fails with an error
      // about PEM formatting that names nothing an administrator can act on.
      privateKey: parsed.private_key.replace(/\\n/g, "\n"),
      projectId: parsed.project_id ?? null,
      source,
    },
  };
}
