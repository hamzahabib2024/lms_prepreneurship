/**
 * Send one test message, and say exactly what the mail server said back.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS. "I did not get the email" is the least actionable bug report
 * in the System, because every interesting part of the answer happens on
 * somebody else's server. The address may be wrong, the account may be out of
 * quota, the message may have been accepted and filed as spam, or SMTP may not
 * be configured at all — and from the screen all four look identical.
 *
 * This separates them. It uses the SAME configuration and the SAME transport
 * settings the application uses, so a pass here means the application can send
 * too; and it prints the server's own words rather than a tidied summary,
 * because the useful detail is usually in the raw refusal.
 *
 * WHAT IT CANNOT TELL YOU. Whether the message was READ, or whether it landed
 * in spam. "Accepted" means the mail server took responsibility for delivery,
 * which is the last thing this end can observe. If it says accepted and
 * nothing arrives, the next place to look is the spam folder, not this code.
 *
 *   node -r dotenv/config scripts/mail-test.mjs someone@example.com
 *   node -r dotenv/config scripts/mail-test.mjs            (uses SMTP_USER)
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { createTransport } from "nodemailer";

const to = (process.argv[2] ?? process.env.SMTP_USER ?? "").trim();

const host = process.env.SMTP_HOST;
const port = Number(process.env.SMTP_PORT ?? 587);
const user = process.env.SMTP_USER;
const pass = process.env.SMTP_PASSWORD;
const from = process.env.MAIL_FROM ?? user;

const fail = (message, hint) => {
  console.error(`\n  FAILED: ${message}`);
  if (hint) console.error(`  ${hint}`);
  console.error("");
  process.exit(1);
};

if (!to) fail("No address to send to.", "Pass one: node -r dotenv/config scripts/mail-test.mjs you@example.com");
if (!host || !user || !pass) {
  fail(
    "SMTP is not configured.",
    "SMTP_HOST, SMTP_USER and SMTP_PASSWORD must all be set in .env.",
  );
}

/*
 * A TYPO IN THE DOMAIN IS THE COMMONEST CAUSE OF "it never arrived", and the
 * two below are not hypothetical — they are registered domains that collect
 * mail sent to them. Refusing is right: a message sent to one of these has
 * genuinely gone to a stranger, and reporting it as delivered would be worse
 * than useless.
 */
const LOOKALIKES = ["gmial.com", "gmai.com", "gmail.co", "gmailcom", "hotmial.com", "yahooo.com"];
const domain = to.split("@")[1]?.toLowerCase() ?? "";
if (LOOKALIKES.includes(domain)) {
  fail(
    `"${domain}" is a misspelling of a common mail provider, not a typo this script should paper over.`,
    `Mail sent there reaches whoever owns that domain. Did you mean ${to.replace(domain, "gmail.com")}?`,
  );
}
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) fail(`"${to}" is not a usable email address.`);

const transport = createTransport({
  host,
  port,
  secure: port === 465,
  auth: { user, pass },
  // The same bounds the application sets, so this cannot pass on settings the
  // application would fail on.
  connectionTimeout: 10_000,
  greetingTimeout: 10_000,
  socketTimeout: 20_000,
});

const stamp = new Date().toISOString();

console.log("");
console.log(`  server : ${host}:${port}`);
console.log(`  from   : ${from}`);
console.log(`  to     : ${to}`);
console.log("");

try {
  const t0 = Date.now();
  process.stdout.write("  connecting… ");
  await transport.verify();
  console.log(`ok (${Date.now() - t0} ms)`);

  const t1 = Date.now();
  process.stdout.write("  sending…    ");
  const info = await transport.sendMail({
    from,
    to,
    subject: `LMS mail test — ${stamp}`,
    text: [
      "This is a test message from the Prepreneurship LMS.",
      "",
      "If you are reading it, the System can deliver email to this address:",
      "the address is right, the account has quota left, and the settings work.",
      "",
      `  Sent at : ${stamp}`,
      `  Server  : ${host}:${port}`,
      `  From    : ${from}`,
      "",
      "Nothing has been changed in the System by this message. It exists only",
      "to prove that mail arrives.",
    ].join("\n"),
  });
  console.log(`ok (${Date.now() - t1} ms)`);

  console.log("");
  console.log("  ACCEPTED BY THE MAIL SERVER.");
  console.log(`  id       : ${info.messageId}`);
  console.log(`  response : ${String(info.response ?? "").trim()}`);
  if (info.accepted?.length) console.log(`  accepted : ${info.accepted.join(", ")}`);
  if (info.rejected?.length) console.log(`  REJECTED : ${info.rejected.join(", ")}`);
  console.log("");
  console.log("  That is as far as this end can see. If it does not appear within a");
  console.log("  minute or two, look in the spam folder before suspecting the System.");
  console.log("");
} catch (err) {
  const detail = err instanceof Error ? err.message : String(err);
  console.log("FAILED");
  console.error("");
  console.error("  The mail server refused it. Its own words:");
  console.error("");
  for (const line of detail.split("\n")) console.error(`    ${line}`);
  console.error("");

  /*
   * The three refusals worth naming, because each has a different answer and
   * the raw text buries it. Anything else is printed above and left alone —
   * a refusal nobody anticipated is exactly the one worth reading in full.
   */
  if (/daily .*limit|5\.4\.5|quota/i.test(detail)) {
    console.error("  WHAT THIS MEANS: the sending account has used up its allowance for the");
    console.error("  day. Nothing is wrong with the address or the settings. A free Google");
    console.error("  account allows roughly 500 recipients a day and resets on a rolling");
    console.error("  24-hour basis, so this will start working again on its own.");
  } else if (/invalid login|535|username and password not accepted|badcredentials/i.test(detail)) {
    console.error("  WHAT THIS MEANS: the username or password was refused. For Gmail this");
    console.error("  must be an App Password, not the account's own password, and the");
    console.error("  account must have two-step verification switched on.");
  } else if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|timeout/i.test(detail)) {
    console.error("  WHAT THIS MEANS: the mail server could not be reached at all. Check");
    console.error(`  SMTP_HOST and SMTP_PORT, and whether outbound port ${port} is blocked here.`);
  }
  console.error("");
  process.exit(1);
} finally {
  transport.close();
}
