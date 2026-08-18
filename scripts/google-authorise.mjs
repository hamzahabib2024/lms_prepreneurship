/**
 * Sign in once, so the LMS can schedule classes for ever.
 *
 *   node -r dotenv/config scripts/google-authorise.mjs
 *
 * WHY THIS EXISTS. Creating a Google Meet link requires acting as a real
 * person — a service account cannot do it, and Google says so plainly:
 *
 *   400 "Invalid conference type value."
 *
 * The usual answer is domain-wide delegation, which needs a Workspace super
 * admin and the Admin console. THIS IS THE OTHER ANSWER: the person whose
 * calendar will host the classes authorises the LMS themselves, once, in their
 * own browser. No admin, no delegation, and it works on a personal Google
 * account as well as a Workspace one.
 *
 * What comes back is a REFRESH TOKEN — a long-lived credential the LMS
 * exchanges for a working access token whenever it needs one. It is as
 * sensitive as a password for that account's calendar, so it goes in .env
 * beside the others and never into the repository.
 */

import { createServer } from "node:http";
import { randomBytes, createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const SCOPE = "https://www.googleapis.com/auth/calendar";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

const CREDENTIALS_DIR = (process.env.GOOGLE_CREDENTIALS_DIR ?? "./credentials").trim();

/**
 * The OAuth client, from .env or from the file Google downloaded.
 *
 * Google hands you a JSON FILE, not two strings, and asking somebody to open
 * it and copy two fields into .env is two chances to paste the wrong half of
 * the wrong line. If the values are not already in .env, this reads them out
 * of any client file sitting where the service-account key already lives.
 */
function findClient() {
  const id = (process.env.GOOGLE_OAUTH_CLIENT_ID ?? "").trim();
  const secret = (process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? "").trim();
  if (id && secret) return { id, secret, source: ".env" };

  if (!existsSync(CREDENTIALS_DIR)) return null;

  for (const name of readdirSync(CREDENTIALS_DIR).filter((f) => f.endsWith(".json"))) {
    let json;
    try {
      json = JSON.parse(readFileSync(join(CREDENTIALS_DIR, name), "utf8"));
    } catch {
      continue;
    }

    // A Desktop-app client sits under `installed`; a Web one under `web`.
    if (json.installed?.client_id && json.installed?.client_secret) {
      return { id: json.installed.client_id, secret: json.installed.client_secret, source: name };
    }

    if (json.web?.client_id) {
      console.error(
        [
          "",
          `  ${name} is a WEB APPLICATION client. This flow needs a Desktop app one.`,
          "",
          "  A web client only accepts redirect URIs registered in advance, and this",
          "  script uses a loopback port chosen at run time — so it would fail with",
          "  redirect_uri_mismatch. Create another client:",
          "",
          "    console.cloud.google.com -> APIs & Services -> Credentials",
          "    -> Create credentials -> OAuth client ID",
          "    -> Application type: Desktop app",
          "",
        ].join("\n"),
      );
      process.exit(1);
    }
  }
  return null;
}

/**
 * Write values into .env without disturbing anything else.
 *
 * Updates a key in place if it is there and appends it if not. Done here
 * rather than printed for somebody to copy, because a refresh token is a
 * hundred characters of base64 and a truncated paste fails days later with an
 * error that names none of this.
 */
function setEnv(pairs) {
  const file = ".env";
  let text = existsSync(file) ? readFileSync(file, "utf8") : "";
  const eol = text.includes("\r\n") ? "\r\n" : "\n";

  for (const [key, value] of Object.entries(pairs)) {
    const line = `${key}=${value}`;
    const existing = new RegExp(`^${key}=.*$`, "m");
    if (existing.test(text)) text = text.replace(existing, line);
    else text = text.replace(/\s*$/, eol) + line + eol;
  }
  writeFileSync(file, text);
}

const client = findClient();
if (!client) {
  console.error(
    [
      "",
      "  No OAuth client found.",
      "",
      "  Either drop the JSON file Google gave you into this folder:",
      `    ${CREDENTIALS_DIR}`,
      "",
      "  or put the two values into .env yourself:",
      "    GOOGLE_OAUTH_CLIENT_ID=....apps.googleusercontent.com",
      "    GOOGLE_OAUTH_CLIENT_SECRET=...",
      "",
      "  To create one: console.cloud.google.com -> APIs & Services -> Credentials",
      "  -> Create credentials -> OAuth client ID -> Application type: Desktop app.",
      "",
      "  Desktop app matters: it is the type that accepts a http://localhost",
      "  redirect on any port, so there is nothing to pre-register.",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

const clientId = client.id;
const clientSecret = client.secret;
console.log(`\n  OAuth client read from ${client.source}`);

/**
 * PKCE, even though this flow has a client secret.
 *
 * The secret is in a .env on the Institute's machine and the code comes back
 * over plain http on loopback. PKCE costs four lines and means an intercepted
 * code is worthless without the verifier, which never leaves this process.
 */
const verifier = randomBytes(32).toString("base64url");
const challenge = createHash("sha256").update(verifier).digest("base64url");
const state = randomBytes(16).toString("base64url");

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname !== "/") {
    res.writeHead(404).end();
    return;
  }

  const finish = (title, message) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(
      `<!doctype html><meta charset="utf-8"><title>${title}</title>` +
        `<body style="font:16px/1.5 system-ui;margin:3rem auto;max-width:34rem;padding:0 1rem">` +
        `<h1 style="font-size:1.3rem">${title}</h1><p>${message}</p>` +
        `<p style="color:#666">You can close this tab and go back to the terminal.</p>`,
    );
  };

  const error = url.searchParams.get("error");
  if (error) {
    finish("Not authorised", `Google said: <code>${error}</code>`);
    console.error(`\n  Refused: ${error}\n`);
    server.close();
    process.exit(1);
  }

  // The state check: without it, somebody who can make this machine's browser
  // visit a URL could feed in a code from a different account.
  if (url.searchParams.get("state") !== state) {
    finish("Ignored", "That response did not come from the request this script made.");
    return;
  }

  const code = url.searchParams.get("code");
  if (!code) return;

  const port = server.address().port;
  const tokenRes = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      code_verifier: verifier,
      redirect_uri: `http://localhost:${port}`,
      grant_type: "authorization_code",
    }),
  });
  const body = await tokenRes.json();

  if (!tokenRes.ok || !body.refresh_token) {
    finish("Something went wrong", "See the terminal.");
    console.error(`\n  Google returned ${tokenRes.status}: ${JSON.stringify(body).slice(0, 400)}`);
    if (tokenRes.ok && !body.refresh_token) {
      console.error(
        [
          "",
          "  An access token came back but NO REFRESH TOKEN, which means Google has",
          "  granted this app before and does not re-issue one automatically.",
          "",
          "  Revoke it at myaccount.google.com/permissions and run this again.",
          "",
        ].join("\n"),
      );
    }
    server.close();
    process.exit(1);
  }

  // Who actually authorised it — worth printing, because authorising as the
  // wrong Google account is the commonest mistake here and is otherwise
  // invisible until classes appear on somebody's personal calendar.
  let who = "unknown";
  try {
    const info = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${body.access_token}` },
    });
    if (info.ok) who = (await info.json()).email ?? "unknown";
  } catch {
    // Not important enough to fail on.
  }

  finish("Authorised", `The LMS can now schedule classes as <strong>${who}</strong>.`);

  /*
   * WRITTEN, NOT PRINTED.
   *
   * The refresh token is a hundred characters of base64 and the client secret
   * is another opaque string; a truncated paste of either fails days later
   * with an error naming none of this. They go straight into .env, which is
   * not committed — and the token is never echoed to the terminal, because a
   * terminal is scrolled back, screenshotted and pasted into chats.
   *
   * The client values are written too, so a later run needs no JSON file and
   * the settings live in one place.
   */
  setEnv({
    GOOGLE_OAUTH_CLIENT_ID: clientId,
    GOOGLE_OAUTH_CLIENT_SECRET: clientSecret,
    GOOGLE_OAUTH_REFRESH_TOKEN: body.refresh_token,
    GOOGLE_CALENDAR_ID: (process.env.GOOGLE_CALENDAR_ID ?? "").trim() || "primary",
    LIVE_PROVIDER: "google_meet",
  });

  console.log(
    [
      "",
      "  Authorised as: " + who,
      "",
      "  Written to .env (the token itself is not printed — it is as sensitive",
      "  as that account's password):",
      "",
      "    GOOGLE_OAUTH_CLIENT_ID",
      "    GOOGLE_OAUTH_CLIENT_SECRET",
      "    GOOGLE_OAUTH_REFRESH_TOKEN",
      "    GOOGLE_CALENDAR_ID=primary",
      "    LIVE_PROVIDER=google_meet",
      "",
      "  Next:",
      "    npm run docker:up",
      "    node -r dotenv/config scripts/check-meet.mjs",
      "",
    ].join("\n"),
  );
  server.close();
  process.exit(0);
});

server.listen(0, "127.0.0.1", () => {
  const port = server.address().port;
  const url =
    `${AUTH_URL}?` +
    new URLSearchParams({
      client_id: clientId,
      redirect_uri: `http://localhost:${port}`,
      response_type: "code",
      scope: SCOPE,
      // offline + consent together are what guarantee a refresh token. Without
      // `prompt=consent` Google silently omits it on a repeat authorisation,
      // and the script appears to work while producing nothing usable.
      access_type: "offline",
      prompt: "consent",
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
    }).toString();

  console.log(
    [
      "",
      "Open this in the browser where the INSTITUTE'S Google account is signed in:",
      "",
      "  " + url,
      "",
      "Sign in as the account whose calendar should hold the classes — a shared",
      "one like classes@ or office@, not a teacher's personal account, because a",
      "teacher leaving would take every scheduled class with them.",
      "",
      'If you see "Google hasn\'t verified this app", that is expected for your',
      'own app: press Advanced, then "Go to ... (unsafe)". You are the developer',
      "and the publisher; there is nobody else to trust.",
      "",
      "Waiting…",
    ].join("\n"),
  );
});
