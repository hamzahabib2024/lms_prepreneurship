/**
 * What is connected, and what is still missing — one command.
 *
 *   node -r dotenv/config scripts/check-integrations.mjs
 *
 * Reads .env only. It does not start the server, touch the database, or send
 * anything, so it is safe to run at any time on any machine.
 *
 * IT NEVER PRINTS A CREDENTIAL. Not a token, not a key, not a masked fragment
 * of one. It reports whether something is set and whether it has the right
 * shape, which is all anybody needs to know to fix it — and a script that
 * echoes secrets ends up pasted into a chat window with the secrets in it.
 */
import { readFileSync, existsSync } from "node:fs";

const env = (k, d = "") => (process.env[k] ?? d).trim();
const set = (k) => env(k) !== "";

const GREEN = "[32m", RED = "[31m", DIM = "[2m", YEL = "[33m", OFF = "[0m";
const line = (s = "") => console.log(s);
const ok = (s) => line(`  ${GREEN}✓${OFF} ${s}`);
const no = (s) => line(`  ${RED}✗${OFF} ${s}`);
const warn = (s) => line(`  ${YEL}!${OFF} ${s}`);
const tip = (s) => line(`    ${DIM}${s}${OFF}`);

const report = [];

// ------------------------------------------------------------------- email --
line(`\n${"═".repeat(64)}\n  1. EMAIL — passwords, receipts, notifications\n${"═".repeat(64)}\n`);
{
  const has = set("SMTP_HOST") && set("SMTP_USER") && set("SMTP_PASSWORD");
  const logged = env("MAIL_DRIVER").toLowerCase() === "log";

  if (!has) {
    no("Not configured");
    tip("Needs: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD");
    tip("Gmail: smtp.gmail.com / 587, and the password is a 16-letter App Password");
    tip("Nothing is emailed. A new account's temporary password can only reach");
    tip("its owner by an administrator reading it off the screen.");
    report.push(["Email", "not configured", "Any mailbox you already own"]);
  } else if (logged) {
    warn("Configured, but MAIL_DRIVER=log — nothing will actually be sent");
    tip("That is the safe default. Set MAIL_DRIVER=smtp to go live.");
    report.push(["Email", "held by MAIL_DRIVER=log", "Change one line"]);
  } else {
    ok(`Configured — ${env("SMTP_HOST")} as ${env("SMTP_USER")}`);
    tip("Prove it works:  node -r dotenv/config scripts/check-email.mjs you@example.com");
    report.push(["Email", "live", "—"]);
  }
}

// -------------------------------------------------------- google drive/meet --
line(`\n${"═".repeat(64)}\n  2. GOOGLE DRIVE & MEET — lecture video, class links\n${"═".repeat(64)}\n`);
{
  const path = env("GOOGLE_SERVICE_ACCOUNT_JSON");
  const store = env("LECTURE_STORAGE", "local");

  if (!path) {
    no("Not configured");
    tip("Needs: GOOGLE_SERVICE_ACCOUNT_JSON pointing at the key file");
    tip("Lectures are served from this server instead. Meet links are pasted in");
    tip("by hand. Everything else about lessons and the timetable works.");
    report.push(["Google Drive", "not configured", "A Google Cloud service account"]);
  } else if (!existsSync(path)) {
    no(`GOOGLE_SERVICE_ACCOUNT_JSON points at a file that does not exist`);
    tip(`Looked for: ${path}`);
    tip("Use an absolute path. A relative one is resolved from wherever the");
    tip("server was started, which is rarely where you think.");
    report.push(["Google Drive", "key file missing", "Fix the path"]);
  } else {
    try {
      const key = JSON.parse(readFileSync(path, "utf8"));
      const missing = ["client_email", "private_key", "project_id"].filter((f) => !key[f]);
      if (missing.length) {
        no(`The key file is JSON but is missing: ${missing.join(", ")}`);
        tip("Download it again: Cloud Console → Service Accounts → Keys → JSON.");
        report.push(["Google Drive", "key file incomplete", "Re-download the key"]);
      } else {
        ok("Service account key found and readable");
        // The one thing people cannot find when they need it, and the step
        // that is silently skipped: the folder must be shared with THIS
        // address or the account sees an empty Drive.
        line("");
        line(`    Share your lecture folder with this address, as Viewer:`);
        line(`    ${GREEN}${key.client_email}${OFF}`);
        line("");
        if (store !== "google_drive") {
          warn(`LECTURE_STORAGE is "${store}", so Drive is NOT being used yet`);
          tip("Set LECTURE_STORAGE=google_drive once the folder is shared.");
          report.push(["Google Drive", "key ready, not switched on", "Set LECTURE_STORAGE"]);
        } else if (!set("GOOGLE_DRIVE_ROOT_FOLDER_ID")) {
          warn("GOOGLE_DRIVE_ROOT_FOLDER_ID is empty");
          tip("It is the long id in the folder's URL after /folders/.");
          report.push(["Google Drive", "folder id missing", "Copy it from the URL"]);
        } else {
          ok("Drive is switched on for lecture storage");
          report.push(["Google Drive", "live", "—"]);
        }
      }
    } catch {
      no("The key file is not valid JSON");
      tip("Download it again rather than editing it — it is machine-written.");
      report.push(["Google Drive", "key file unreadable", "Re-download the key"]);
    }
  }
}

// ---------------------------------------------------------------- whatsapp --
line(`\n${"═".repeat(64)}\n  3. WHATSAPP — messages to students\n${"═".repeat(64)}\n`);
{
  const token = env("WHATSAPP_ACCESS_TOKEN");
  const phone = env("WHATSAPP_PHONE_NUMBER_ID");

  if (!token && !phone) {
    no("Not configured");
    tip("Needs: WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID");
    tip("Nothing is sent. Students still get every message in the in-app inbox,");
    tip("and staff can read the exact wording under Integrations → outbox.");
    report.push(["WhatsApp", "not configured", "Meta Business account"]);
  } else if (!token || !phone) {
    no(`Half configured — ${token ? "WHATSAPP_PHONE_NUMBER_ID" : "WHATSAPP_ACCESS_TOKEN"} is missing`);
    tip("Both are needed. One alone does nothing.");
    report.push(["WhatsApp", "half configured", "Add the missing one"]);
  } else {
    ok("Both settings are present");
    // The commonest WhatsApp failure by a distance: the temporary token from
    // the dashboard works beautifully and dies overnight.
    if (!/^EAA/.test(token)) {
      warn("The token does not start with EAA, which Meta tokens normally do");
      tip("Check it was copied whole.");
    }
    if (!/^\d{6,}$/.test(phone)) {
      warn("WHATSAPP_PHONE_NUMBER_ID does not look like an id (it is all digits)");
      tip("It is NOT the phone number itself — it is the id shown beside it.");
    }
    warn("Make sure this is a PERMANENT System User token");
    tip("The test token in the dashboard expires in 24 hours and fails");
    tip("overnight, which looks exactly like an outage the next morning.");
    report.push(["WhatsApp", "configured", "Check templates are approved"]);
  }
}

// ------------------------------------------------------------------ summary --
line(`\n${"═".repeat(64)}\n  SUMMARY\n${"═".repeat(64)}\n`);
const w = Math.max(...report.map((r) => r[0].length));
for (const [name, status, need] of report) {
  const mark = status === "live" ? `${GREEN}live${OFF}` : `${YEL}${status}${OFF}`;
  line(`  ${name.padEnd(w)}  ${mark}${need === "—" ? "" : `  ${DIM}— ${need}${OFF}`}`);
}
line(`\n  ${DIM}Nothing here is required to run the System. Every one has a working`);
line(`  fallback, and the Integrations screen says which are live at any time.${OFF}\n`);
