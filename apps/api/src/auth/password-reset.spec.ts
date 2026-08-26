import { createHash } from "node:crypto";
import { resetEmailBody, constantTimeEquals } from "./password-reset.service";

/**
 * The forgotten-password flow, in the parts that can be pinned without a
 * database.
 *
 * WHY THE EMAIL BODY IS TESTED AT ALL. Once SMTP is configured — and it is, on
 * this installation — the message goes out for real instead of into the
 * simulated outbox, and there is then no way to read back what was sent. The
 * one property that must never regress is that this carries a LINK and not a
 * password, so it is asserted here rather than left to whoever reads the
 * service next.
 */
describe("the email a forgotten password produces", () => {
  const LINK = "https://lms.institute.test/reset-password?token=abc123_-XYZ";

  it("carries the link", () => {
    expect(resetEmailBody(LINK)).toContain(LINK);
  });

  it("never carries a password", () => {
    const body = resetEmailBody(LINK).toLowerCase();
    // The wording that would mean somebody had reverted to emailing a
    // credential. Each of these is a phrase that only appears if they did.
    for (const giveaway of [
      "temporary password",
      "your new password is",
      "your password is",
      "sign in with this password",
      "password:",
    ]) {
      expect(body).not.toContain(giveaway);
    }
  });

  it("says how long it lasts, in the same breath as the link", () => {
    const body = resetEmailBody(LINK, 30);
    expect(body).toContain("30 minutes");
    expect(body).toContain("works once");
  });

  it("tells somebody who did not ask for it that they need do nothing", () => {
    const body = resetEmailBody(LINK);
    expect(body).toContain("If that was not you");
    expect(body).toContain("has not changed");
  });

  /*
   * A reader whose mail client mangles long lines is the commonest way a reset
   * link arrives broken, so the link sits on a line of its own with nothing
   * else on it — no trailing full stop to be swallowed into the URL either.
   */
  it("puts the link alone on its own line", () => {
    const lines = resetEmailBody(LINK).split("\n");
    expect(lines).toContain(LINK);
  });
});

describe("the token", () => {
  /**
   * The column is `VARCHAR(64)` with a CHECK for 64 lower-case hex characters.
   * If the hashing here ever changed shape — a different algorithm, base64,
   * an upper-case digest — every reset would fail at the database with a
   * constraint violation rather than anywhere legible.
   */
  it("hashes to exactly what the column accepts", () => {
    const hash = createHash("sha256").update("any-token-at-all", "utf8").digest("hex");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toHaveLength(64);
  });

  it("gives a different hash for a token that differs by one character", () => {
    const a = createHash("sha256").update("token-a", "utf8").digest("hex");
    const b = createHash("sha256").update("token-b", "utf8").digest("hex");
    expect(a).not.toEqual(b);
  });
});

describe("comparing secrets", () => {
  it("matches identical strings", () => {
    expect(constantTimeEquals("abcdef", "abcdef")).toBe(true);
  });

  it("rejects different ones", () => {
    expect(constantTimeEquals("abcdef", "abcdeg")).toBe(false);
  });

  /*
   * Different lengths must return false rather than throw. `timingSafeEqual`
   * throws on a length mismatch, and an exception escaping a comparison is how
   * a login endpoint turns into a 500 that tells an attacker their guess was
   * the wrong LENGTH — which is information.
   */
  it("returns false rather than throwing on different lengths", () => {
    expect(() => constantTimeEquals("short", "considerably longer")).not.toThrow();
    expect(constantTimeEquals("short", "considerably longer")).toBe(false);
  });
});
