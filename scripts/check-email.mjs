/**
 * Is email set up? — a definite answer, before a student is the test case.
 *
 *   node -r dotenv/config scripts/check-email.mjs
 *   node -r dotenv/config scripts/check-email.mjs you@example.com
 *
 * With an address it sends one real message there. Without one it stops after
 * proving the mail server accepts the credentials, which is the part that
 * usually fails.
 *
 * IT DIAGNOSES RATHER THAN REPORTING "failed". Every SMTP error worth seeing
 * here has one likely cause and one fix, and a raw nodemailer stack trace names
 * neither. The App Password mistake in particular produces an authentication
 * error that reads as a wrong password, which sends people to reset the account
 * password — the one thing that will not help.
 */
import { createTransport } from "nodemailer";

const env = (k, d = "") => (process.env[k] ?? d).trim();

const HOST = env("SMTP_HOST");
const PORT = Number(env("SMTP_PORT", "587"));
const USER = env("SMTP_USER");
const PASS = process.env["SMTP_PASSWORD"] ?? "";
const DRIVER = env("MAIL_DRIVER").toLowerCase();
const FROM = env("MAIL_FROM") || USER;
const to = process.argv[2];

const ok = (s) => console.log(`  ✓ ${s}`);
const bad = (s) => console.log(`  ✗ ${s}`);
const hint = (s) => console.log(`      ${s}`);

console.log("\nChecking email configuration\n");

let fatal = false;

// ---------------------------------------------------------------- settings --
for (const [name, value] of [
  ["SMTP_HOST", HOST],
  ["SMTP_USER", USER],
  ["SMTP_PASSWORD", PASS.trim()],
]) {
  if (value) ok(`${name} is set`);
  else {
    bad(`${name} is empty`);
    fatal = true;
  }
}

if (fatal) {
  console.log("\nNothing to test until those are filled in. See INTEGRATIONS.md.\n");
  process.exit(1);
}

if (!Number.isFinite(PORT) || PORT <= 0) {
  bad(`SMTP_PORT is "${env("SMTP_PORT")}", which is not a port number`);
  process.exit(1);
}
ok(`SMTP_PORT is ${PORT} (${PORT === 465 ? "implicit TLS" : "STARTTLS"})`);

// A Gmail App Password is 16 characters. Spaces are how Google displays it and
// are not part of it, but a pasted 16-with-spaces still works once stripped —
// what does NOT work is the account's own password, and that is the mistake.
if (/gmail|googlemail/i.test(HOST)) {
  const stripped = PASS.replace(/\s+/g, "");
  // SHAPE, NOT JUST LENGTH. A Google App Password is sixteen lowercase letters
  // and nothing else. Checking the length alone passed "my-real-password",
  // which is exactly sixteen characters and exactly the mistake this is here
  // to catch — an account password reported as looking correct sends somebody
  // off to debug the network instead.
  if (/^[a-z]{16}$/.test(stripped)) {
    ok("SMTP_PASSWORD has the shape of a Google App Password");
  } else if (stripped.length !== 16) {
    bad(`SMTP_PASSWORD is ${stripped.length} characters; a Google App Password is 16`);
    hint("Create one at https://myaccount.google.com/apppasswords");
  } else {
    bad("SMTP_PASSWORD is 16 characters but contains digits or punctuation");
    hint("A Google App Password is sixteen lowercase letters, e.g. abcdefghijklmnop.");
    hint("This looks like the account's own password, which will be refused.");
    hint("Create one at https://myaccount.google.com/apppasswords");
  }
}

if (DRIVER === "log") {
  console.log("");
  bad("MAIL_DRIVER=log — the System will NOT send, whatever this script proves");
  hint("That is the safe default. Set MAIL_DRIVER=smtp when you want it live.");
  hint("This script ignores it and tests the connection anyway.");
}

// -------------------------------------------------------------- connection --
console.log("\nTalking to the mail server\n");

const transport = createTransport({
  host: HOST,
  port: PORT,
  secure: PORT === 465,
  auth: { user: USER, pass: PASS },
  connectionTimeout: 15000,
  greetingTimeout: 15000,
});

/** The likely cause, in the words of somebody who has to fix it. */
function explain(err) {
  const code = err?.code ?? "";
  const msg = String(err?.message ?? "");

  if (code === "EAUTH" || /535|Username and Password not accepted|BadCredentials/i.test(msg)) {
    return [
      "The server rejected the username or password.",
      "For Gmail this almost always means one of:",
      "  · SMTP_PASSWORD is the account password, not a 16-character App Password",
      "  · 2-Step Verification is off, so App Passwords do not exist yet",
      "  · SMTP_USER is not the same account the App Password was made on",
      "Resetting the account password will NOT fix any of these.",
    ];
  }
  if (code === "ETIMEDOUT" || code === "ESOCKET" || code === "ECONNECTION") {
    return [
      `Could not reach ${HOST} on port ${PORT}.`,
      "Usually a firewall or an ISP blocking outbound mail ports.",
      "Try port 465 instead of 587, and check the server can reach the internet.",
    ];
  }
  if (code === "EDNS" || /getaddrinfo|ENOTFOUND/i.test(msg)) {
    return [`The host "${HOST}" does not resolve. Check it for a typo.`];
  }
  if (/self.signed|certificate/i.test(msg)) {
    return [
      "The server's TLS certificate was not trusted.",
      "On a corporate network this is usually an intercepting proxy.",
    ];
  }
  return [msg || "The server refused the connection without saying why."];
}

try {
  await transport.verify();
  ok("Connected and the credentials were accepted");
} catch (err) {
  bad("Could not authenticate");
  console.log("");
  for (const line of explain(err)) hint(line);
  console.log("");
  process.exit(1);
}

// ------------------------------------------------------------- test message --
if (!to) {
  console.log("\nCredentials work. To send a real test message:\n");
  console.log("  node -r dotenv/config scripts/check-email.mjs you@example.com\n");
  process.exit(0);
}

console.log(`\nSending one message to ${to}\n`);
try {
  const info = await transport.sendMail({
    from: FROM,
    to,
    subject: "Prepreneurship LMS — email is working",
    text: [
      "This is a test from the Prepreneurship Learning Management System.",
      "",
      "If you are reading it, the System can send email: account passwords,",
      "receipts and notifications will reach students at their own addresses.",
      "",
      "Nothing else was sent, and no student received anything.",
    ].join("\n"),
  });
  ok(`Accepted by the server (${info.messageId})`);
  console.log("");
  hint("Check the inbox — and the spam folder, which is where the first one");
  hint("often lands if you are sending from a @gmail.com address.");
  console.log("");
} catch (err) {
  bad("The server accepted the login but refused the message");
  console.log("");
  for (const line of explain(err)) hint(line);
  console.log("");
  process.exit(1);
}
