/**
 * Where you actually stand with Google Calendar and Meet.
 *
 * Written because the setup guide described steps that did not match what was
 * on screen, and there was no way to tell which of six things was wrong. This
 * asks Google directly and prints the ONE next action.
 *
 *   node -r dotenv/config scripts/check-meet.mjs
 *
 * It creates nothing and deletes nothing except its own probe event, on the
 * service account's own calendar, which it removes immediately.
 */

import { readFileSync } from "node:fs";
import { createSign } from "node:crypto";

const CAL_SCOPE = "https://www.googleapis.com/auth/calendar";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const no = (m) => console.log(`  \x1b[31m✗\x1b[0m ${m}`);
const info = (m) => console.log(`    ${m}`);
const step = (n, m) => console.log(`\n${n}. ${m}`);

/**
 * The key, from either form .env can hold it in.
 *
 * Docker needs a path INSIDE the container, so .env carries the folder and
 * the filename separately and compose joins them. A script run on the host
 * cannot use that container path — so it joins them itself, from the same two
 * variables, and one .env serves both. Getting this wrong is how a checker
 * reports a perfectly good key as missing.
 */
function loadKey() {
  let raw = (process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? "").trim();

  // A container path is meaningless here; rebuild it from the host pieces.
  const dir = (process.env.GOOGLE_CREDENTIALS_DIR ?? "").trim();
  const file = (process.env.GOOGLE_SERVICE_ACCOUNT_FILE ?? "").trim();
  if ((!raw || raw.startsWith("/run/credentials/")) && dir && file) {
    raw = `${dir.replace(/[/\\]+$/, "")}/${file}`;
  }

  if (!raw) {
    return {
      error:
        "No key configured. Set GOOGLE_CREDENTIALS_DIR and GOOGLE_SERVICE_ACCOUNT_FILE " +
        "(or GOOGLE_SERVICE_ACCOUNT_JSON) in .env.",
    };
  }
  try {
    const json = raw.startsWith("{") ? raw : readFileSync(raw, "utf8");
    const key = JSON.parse(json);
    if (!key.client_email || !key.private_key) {
      return { error: "The key has no client_email or private_key." };
    }
    return { key: { ...key, private_key: key.private_key.replace(/\\n/g, "\n") } };
  } catch (err) {
    return {
      error:
        `Could not read the key at "${raw}". ` +
        `If the API runs in Docker that must be a path INSIDE the container. (${err.message})`,
    };
  }
}

async function getToken(key, scope, subject) {
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const claims = { iss: key.client_email, scope, aud: TOKEN_URL, iat: now, exp: now + 3600 };
  if (subject) claims.sub = subject;
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64(claims)}`;
  const assertion = `${unsigned}.${createSign("RSA-SHA256").update(unsigned).sign(key.private_key, "base64url")}`;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const body = await res.json();
  return body.access_token
    ? { token: body.access_token }
    : { error: `${body.error ?? res.status}: ${body.error_description ?? ""}`.trim() };
}

console.log("\nGoogle Calendar / Meet — what is actually true\n" + "=".repeat(46));

// ─────────────────────────────────────────────────────────────── the key ──
step(1, "The service account key");
const { key, error: keyError } = loadKey();
if (keyError) {
  no(keyError);
  console.log("\nNEXT: set GOOGLE_SERVICE_ACCOUNT_JSON. See INTEGRATIONS.md section 2.\n");
  process.exit(1);
}
ok(`readable — ${key.client_email}`);
info(`project: ${key.project_id ?? "unknown"}`);
// The number the Workspace admin needs. It is not shown anywhere obvious in
// the Cloud console, and hunting for it is where this step usually stalls.
info(`\x1b[1mclient ID for domain-wide delegation: ${key.client_id}\x1b[0m`);

// ────────────────────────────────────────────────────── the Calendar API ──
step(2, "The Calendar API on the project");
const direct = await getToken(key, CAL_SCOPE);
if (direct.error) {
  no(`Google refused a Calendar token — ${direct.error}`);
  console.log("\nNEXT: enable the Google Calendar API in the Cloud console.\n");
  process.exit(1);
}
const listRes = await fetch("https://www.googleapis.com/calendar/v3/users/me/calendarList", {
  headers: { Authorization: `Bearer ${direct.token}` },
});
if (listRes.status === 403) {
  const body = await listRes.json();
  no(`the API is not enabled — ${body.error?.message ?? listRes.status}`);
  console.log(
    `\nNEXT: open https://console.cloud.google.com/apis/library/calendar-json.googleapis.com` +
      `?project=${key.project_id} and press Enable.\n`,
  );
  process.exit(1);
}
ok("enabled, and the service account can call it");

// ─────────────────────────────────────────────── domain-wide delegation ──
const subject = (process.env.GOOGLE_IMPERSONATE_SUBJECT ?? "").trim();
step(3, "Acting as a real person (domain-wide delegation)");
if (!subject) {
  no("GOOGLE_IMPERSONATE_SUBJECT is not set");
  info("A service account cannot create Meet links on its own — proved in step 4 below.");
  info("It has to act AS a Workspace user, and that user's address goes here.");
} else {
  const asUser = await getToken(key, CAL_SCOPE, subject);
  if (asUser.error) {
    no(`cannot act as ${subject} — ${asUser.error}`);
    if (asUser.error.includes("unauthorized_client")) {
      info("This exact error means the Workspace admin has not authorised the client ID.");
      info("It does NOT mean the key is wrong.");
      console.log(
        `\nNEXT, in the Google Admin console (admin.google.com), as a super admin:\n` +
          `  Security → Access and data control → API controls\n` +
          `  → Manage Domain Wide Delegation → Add new\n` +
          `  Client ID: ${key.client_id}\n` +
          `  OAuth scopes: ${CAL_SCOPE}\n` +
          `Then wait a few minutes and run this again.\n`,
      );
      process.exit(1);
    }
    if (asUser.error.includes("invalid_grant")) {
      info(`Google knows the client but not the user "${subject}".`);
      info("Check the spelling, and that it is a user in the Workspace domain.");
      process.exit(1);
    }
    process.exit(1);
  }
  ok(`can act as ${subject}`);
}

// ──────────────────────────────────────────────────── creating a meeting ──
step(4, "Creating a Meet link");
const actor = subject ? await getToken(key, CAL_SCOPE, subject) : direct;
if (actor.error) {
  no(actor.error);
  process.exit(1);
}
const calendarId = (process.env.GOOGLE_CALENDAR_ID ?? "primary").trim() || "primary";
const start = new Date(Date.now() + 86_400_000);
const end = new Date(start.getTime() + 3_600_000);

const created = await fetch(
  `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?conferenceDataVersion=1`,
  {
    method: "POST",
    headers: { Authorization: `Bearer ${actor.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      summary: "LMS setup probe — deleted automatically",
      description: "Created by scripts/check-meet.mjs to verify Meet link creation.",
      start: { dateTime: start.toISOString() },
      end: { dateTime: end.toISOString() },
      conferenceData: {
        createRequest: {
          requestId: `lms-probe-${Date.now()}`,
          conferenceSolutionKey: { type: "hangoutsMeet" },
        },
      },
    }),
  },
);

const body = await created.json();
if (!created.ok) {
  const message = body.error?.message ?? `HTTP ${created.status}`;
  no(`refused — ${message}`);
  if (message.includes("Invalid conference type")) {
    info("This is Google saying the account may not create Meet conferences.");
    info(
      subject
        ? "The impersonated user needs a Workspace licence that includes Meet."
        : "A service account acting as ITSELF can never create one. Set GOOGLE_IMPERSONATE_SUBJECT.",
    );
  }
  if (created.status === 404) info(`No calendar "${calendarId}" for that account.`);
  console.log("");
  process.exit(1);
}

const link = body.hangoutLink ?? body.conferenceData?.entryPoints?.[0]?.uri ?? null;
if (link) ok(`created — ${link}`);
else no("the event was created but carried no Meet link");

// Always tidy up, even on the unhappy path above this point.
await fetch(
  `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${body.id}`,
  { method: "DELETE", headers: { Authorization: `Bearer ${actor.token}` } },
);
info("probe event deleted");

// ────────────────────────────────────────────────────────────── the LMS ──
step(5, "The LMS side");
const provider = (process.env.LIVE_PROVIDER ?? "manual").trim() || "manual";
if (provider === "google_meet") ok("LIVE_PROVIDER=google_meet");
else no(`LIVE_PROVIDER is "${provider}" — set it to google_meet to use this`);

console.log(
  "\n" +
    "-".repeat(46) +
    "\nNOTE, and it does not change with any setting: Google Meet cannot be\n" +
    "displayed inside the LMS. meet.google.com answers X-Frame-Options:\n" +
    "SAMEORIGIN, so browsers refuse to frame it. Classes open in a window;\n" +
    "the schedule, the join window, attendance and the recording stay in the\n" +
    "LMS. See LECTURES.md.\n",
);
