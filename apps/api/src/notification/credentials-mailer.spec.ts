import { ConfigService } from "@nestjs/config";
import { CredentialsMailer } from "./credentials-mailer";
import type { EmailChannel } from "./channel/email.channel";

/**
 * The email that carries a password — FR-REG-042, FR-USR-012, FR-OPS-026.
 *
 * These guard two failures that are silent in production.
 *
 * THE SIGN-IN LINK. `signInUrl` read PUBLIC_WEB_URL and nothing else, and
 * PUBLIC_WEB_URL is set by docker-compose and by nothing else. An Institute
 * running the API any other way emailed every new student a link to
 * `http://localhost:5173` — an address meaning "this student's own computer",
 * which works for nobody and looks like the System is broken rather than
 * misconfigured. WEB_ORIGIN is already set everywhere because CORS does not
 * function without it, so it is the honest second choice.
 *
 * THE PASSWORD ITSELF. Reporting `sent: true` when the channel suppressed the
 * message is worse than failing: the operator closes the page believing a
 * hundred students were told, and nobody finds out until none of them signs in.
 */
describe("CredentialsMailer", () => {
  const config = (values: Record<string, string>) =>
    ({ get: (key: string, fallback?: string) => values[key] ?? fallback }) as unknown as ConfigService;

  const outcome = (status: string, detail = "") => ({ status, detail });

  /** A stand-in for the channel that records what it was asked to send. */
  function makeChannel(result = outcome("SENT", "queued")) {
    const sends: Array<{ to: { email: string; fullName: string }; message: { kind: string; title: string; body: string } }> = [];
    const channel = {
      isConfigured: () => true,
      send: jest.fn(async (to: unknown, message: unknown) => {
        sends.push(
          { to, message } as unknown as (typeof sends)[number],
        );
        return result;
      }),
    };
    return { channel: channel as unknown as EmailChannel, sends };
  }

  // ────────────────────────────────────────────────────────── the address ──

  describe("the address it tells people to sign in at", () => {
    it("uses PUBLIC_WEB_URL when it is set", () => {
      const { channel } = makeChannel();
      const mailer = new CredentialsMailer(channel, config({ PUBLIC_WEB_URL: "https://lms.prep.edu.pk" }));
      expect(mailer.signInUrl()).toBe("https://lms.prep.edu.pk");
    });

    it("falls back to WEB_ORIGIN rather than emailing a localhost link", () => {
      // The actual defect. Every deployment sets WEB_ORIGIN because CORS does
      // not work without it; almost none sets PUBLIC_WEB_URL.
      const { channel } = makeChannel();
      const mailer = new CredentialsMailer(channel, config({ WEB_ORIGIN: "https://learn.prep.edu.pk" }));
      expect(mailer.signInUrl()).toBe("https://learn.prep.edu.pk");
    });

    it("takes the first origin when WEB_ORIGIN lists several", () => {
      // WEB_ORIGIN is a CORS allow-list and is routinely comma-separated. The
      // whole list pasted into an email is not a link anybody can click.
      const { channel } = makeChannel();
      const mailer = new CredentialsMailer(
        channel,
        config({ WEB_ORIGIN: "https://learn.prep.edu.pk,http://localhost:5173" }),
      );
      expect(mailer.signInUrl()).toBe("https://learn.prep.edu.pk");
    });

    it("strips a trailing slash so the link is not doubled", () => {
      const { channel } = makeChannel();
      const mailer = new CredentialsMailer(channel, config({ PUBLIC_WEB_URL: "https://lms.prep.edu.pk/" }));
      expect(mailer.signInUrl()).toBe("https://lms.prep.edu.pk");
    });
  });

  // ───────────────────────────────────────────────────────── new accounts ──

  describe("a new account", () => {
    it("carries the password, the address and the email to sign in with", async () => {
      const { channel, sends } = makeChannel();
      const mailer = new CredentialsMailer(
        channel,
        config({ PUBLIC_WEB_URL: "https://lms.prep.edu.pk", INSTITUTE_NAME: "Prepreneurship" }),
      );

      const result = await mailer.sendNewAccount({
        to: "student@example.com",
        fullName: "Ayesha Khan",
        temporaryPassword: "Kx7m-Np2q-r4Ts",
        registrationNo: "PP/SP26-001/ISB",
      });

      expect(result.sent).toBe(true);
      expect(sends).toHaveLength(1);
      const body = sends[0]!.message.body;
      // All three, because two of them is a message nobody can act on.
      expect(body).toContain("Kx7m-Np2q-r4Ts");
      expect(body).toContain("https://lms.prep.edu.pk");
      expect(body).toContain("student@example.com");
      expect(body).toContain("PP/SP26-001/ISB");
    });

    it("does not invent a registration number for a teacher", async () => {
      // Staff have none. "Your registration number is undefined" is the kind
      // of detail that makes a System look untended.
      const { channel, sends } = makeChannel();
      const mailer = new CredentialsMailer(channel, config({ INSTITUTE_NAME: "Prepreneurship" }));

      await mailer.sendNewAccount({
        to: "teacher@example.com",
        fullName: "Bilal Ahmed",
        temporaryPassword: "Ab12-Cd34",
        roleLabel: "teacher",
      });

      expect(sends[0]!.message.body).not.toMatch(/registration number/i);
      expect(sends[0]!.message.body).toContain("teacher");
    });

    it("reports sent:false when the channel suppressed the message", async () => {
      // The failure that matters most. An operator who is told a hundred
      // students were emailed does not check, and nobody finds out until none
      // of them signs in.
      const { channel } = makeChannel(outcome("SUPPRESSED", "Email is not configured."));
      const mailer = new CredentialsMailer(channel, config({}));

      const result = await mailer.sendNewAccount({
        to: "student@example.com",
        fullName: "Ayesha Khan",
        temporaryPassword: "Kx7m",
      });

      expect(result.sent).toBe(false);
      expect(result.detail).toMatch(/not configured/i);
    });

    it("never fails the thing it follows when the mailer throws", async () => {
      // An account that was created has been created. This returning rather
      // than throwing is what keeps a slow mail server from rolling back an
      // import of three hundred students.
      const channel = {
        isConfigured: () => true,
        send: jest.fn(async () => {
          throw new Error("ECONNREFUSED");
        }),
      } as unknown as EmailChannel;
      const mailer = new CredentialsMailer(channel, config({}));

      const result = await mailer.sendNewAccount({
        to: "student@example.com",
        fullName: "Ayesha Khan",
        temporaryPassword: "Kx7m",
      });

      expect(result.sent).toBe(false);
      expect(result.detail).toContain("ECONNREFUSED");
    });
  });

  // ──────────────────────────────────────────────────────────── a reset ──

  describe("a password reset", () => {
    it("says it was the office, because a silent reset looks like a takeover", async () => {
      const { channel, sends } = makeChannel();
      const mailer = new CredentialsMailer(channel, config({ INSTITUTE_NAME: "Prepreneurship" }));

      await mailer.sendPasswordReset({
        to: "student@example.com",
        fullName: "Ayesha Khan",
        temporaryPassword: "Zz99-Yy88",
      });

      const body = sends[0]!.message.body;
      expect(body).toContain("Zz99-Yy88");
      expect(body).toMatch(/signed out/i);
      // The person has to be able to tell an authorised reset from an attack.
      expect(body).toMatch(/did not ask for this/i);
      expect(sends[0]!.message.kind).toBe("account.password-reset");
    });
  });

  // ───────────────────────────────────────────────────── what it must not do ──

  it("never writes the password to an inbox row", async () => {
    // SEC-AUZ-013 — a notification row holding a password outlives its
    // usefulness by years and is readable by anybody who later reaches that
    // inbox, an administrator impersonating the student included. The channel
    // is called DIRECTLY for exactly this reason.
    const { channel, sends } = makeChannel();
    const mailer = new CredentialsMailer(channel, config({}));

    await mailer.sendNewAccount({
      to: "student@example.com",
      fullName: "Ayesha Khan",
      temporaryPassword: "Kx7m",
    });

    // linkPath null and no notification id: nothing here reaches the inbox.
    expect(sends[0]!.message).toMatchObject({ kind: "account.created" });
    expect((sends[0]!.message as unknown as { linkPath: unknown }).linkPath).toBeNull();
  });
});
