import { AdmissionMailer } from "./admission-mailer";
import type { EmailChannel } from "../notification/channel/email.channel";

/**
 * The two emails an applicant receives — FR-REG-018, FR-REG-042.
 *
 * These tests exist because the failure they guard is silent. A mailer that
 * throws is noticed in a minute; a mailer that puts the password in a log line,
 * or reports `sent: true` when the channel suppressed the message, is noticed
 * when somebody cannot sign in and nobody can say why.
 */
describe("AdmissionMailer", () => {
  const outcome = (status: string, detail = "") => ({ status, detail });

  /** A stand-in for the channel that records what it was asked to send. */
  function makeChannel(result = outcome("SENT", "queued")) {
    const sends: Array<{ to: unknown; message: { title: string; body: string; kind: string } }> = [];
    const channel = {
      send: jest.fn(async (to: unknown, message: { title: string; body: string; kind: string }) => {
        sends.push({ to, message });
        return result;
      }),
    };
    return { channel: channel as unknown as EmailChannel, sends, spy: channel.send };
  }

  // ------------------------------------------------------------ FR-REG-018

  it("sends the tracking reference to the address that applied", async () => {
    const { channel, sends } = makeChannel();
    const mailer = new AdmissionMailer(channel);

    const result = await mailer.sendTrackingReference({
      to: "applicant@example.com",
      fullName: "Ayesha Khan",
      trackingRef: "REG-2026-000123",
    });

    expect(result.sent).toBe(true);
    expect(sends).toHaveLength(1);
    expect(sends[0]!.to).toMatchObject({ email: "applicant@example.com", fullName: "Ayesha Khan" });
    // The reference is the entire point of the message; it has to be IN it.
    expect(sends[0]!.message.body).toContain("REG-2026-000123");
    expect(sends[0]!.message.title).toContain("REG-2026-000123");
  });

  // ------------------------------------------------------------ FR-REG-042

  it("sends the temporary password and the address to sign in at", async () => {
    const { channel, sends } = makeChannel();
    const mailer = new AdmissionMailer(channel);

    await mailer.sendCredentials({
      to: "student@example.com",
      fullName: "Ayesha Khan",
      registrationNo: "PREP-2026-0001",
      temporaryPassword: "Kx7mNp2q",
      signInUrl: "https://lms.example.com",
    });

    const body = sends[0]!.message.body;
    // All four things somebody needs to get in, in one message. A welcome mail
    // missing any one of them generates the support call it was meant to save.
    expect(body).toContain("Kx7mNp2q");
    expect(body).toContain("PREP-2026-0001");
    expect(body).toContain("student@example.com");
    expect(body).toContain("https://lms.example.com");
  });

  /**
   * SEC-CRY-010 — the password exists in the message body and nowhere else.
   *
   * The regression this catches: adding the password to the log line while
   * debugging a delivery failure, which puts every student's first password
   * into a log file that is copied, shipped and kept.
   */
  it("never writes the password to the log", async () => {
    const { channel } = makeChannel();
    const mailer = new AdmissionMailer(channel);
    const written: string[] = [];
    jest.spyOn(mailer["logger"], "log").mockImplementation((m) => void written.push(String(m)));
    jest.spyOn(mailer["logger"], "warn").mockImplementation((m) => void written.push(String(m)));

    await mailer.sendCredentials({
      to: "student@example.com",
      fullName: "Ayesha Khan",
      registrationNo: "PREP-2026-0001",
      temporaryPassword: "Kx7mNp2q",
      signInUrl: "https://lms.example.com",
    });

    expect(written.length).toBeGreaterThan(0); // the check is not vacuous
    for (const line of written) expect(line).not.toContain("Kx7mNp2q");
  });

  // ------------------------------------------------- FR-REG-033/034/046

  it("explains a rejection in words rather than printing the reason code", async () => {
    const { channel, sends } = makeChannel();
    const mailer = new AdmissionMailer(channel);

    await mailer.sendRejection({
      to: "applicant@example.com",
      fullName: "Ayesha Khan",
      trackingRef: "REG-2026-000123",
      reasonCode: "SLIP_ILLEGIBLE",
    });

    const body = sends[0]!.message.body;
    // The code itself is an internal value. A person reading "SLIP_ILLEGIBLE"
    // on a phone learns nothing and cannot act on it.
    expect(body).not.toContain("SLIP_ILLEGIBLE");
    expect(body).toContain("clearer photograph");
    // This one is fixable today, so the message has to say so.
    expect(body).toContain("apply again");
    expect(body).toContain("REG-2026-000123");
  });

  it("carries the reviewer's own note when there is one", async () => {
    const { channel, sends } = makeChannel();
    const mailer = new AdmissionMailer(channel);

    await mailer.sendRejection({
      to: "applicant@example.com",
      fullName: "Ayesha Khan",
      trackingRef: "REG-2026-000123",
      reasonCode: "OTHER",
      note: "The CNIC on the slip does not match the one on the form.",
    });

    expect(sends[0]!.message.body).toContain("does not match the one on the form");
  });

  it("asks for more information without discarding what was sent", async () => {
    const { channel, sends } = makeChannel();
    const mailer = new AdmissionMailer(channel);

    await mailer.sendInfoRequest({
      to: "applicant@example.com",
      fullName: "Ayesha Khan",
      trackingRef: "REG-2026-000123",
      message: "Please send a photograph of the back of your CNIC.",
    });

    const body = sends[0]!.message.body;
    expect(body).toContain("back of your CNIC");
    expect(body).toContain("REG-2026-000123");
    // The reassurance is the point: people re-apply from scratch otherwise,
    // which creates the duplicate the office then has to reconcile.
    expect(body).toContain("has been lost");
  });

  // -------------------------------------------------------- failure modes

  /**
   * The distinction that matters. An unconfigured mail server does not throw —
   * the channel returns SUPPRESSED and the send LOOKS successful. Reporting
   * that as sent is how a student never receives a password and the office is
   * told they did.
   */
  it("reports a suppressed send as NOT sent", async () => {
    const { channel } = makeChannel(outcome("SUPPRESSED", "Email is not configured."));
    const mailer = new AdmissionMailer(channel);

    const result = await mailer.sendTrackingReference({
      to: "applicant@example.com",
      fullName: "Ayesha Khan",
      trackingRef: "REG-2026-000123",
    });

    expect(result.sent).toBe(false);
    expect(result.detail).toContain("not configured");
  });

  it("does not throw when the mail server does, and says why", async () => {
    const channel = {
      send: jest.fn(async () => {
        throw new Error("ECONNREFUSED smtp.gmail.com:587");
      }),
    } as unknown as EmailChannel;
    const mailer = new AdmissionMailer(channel);

    // The caller has already committed an approval. This must not throw.
    const result = await mailer.sendCredentials({
      to: "student@example.com",
      fullName: "Ayesha Khan",
      registrationNo: "PREP-2026-0001",
      temporaryPassword: "Kx7mNp2q",
      signInUrl: "https://lms.example.com",
    });

    expect(result.sent).toBe(false);
    expect(result.detail).toContain("ECONNREFUSED");
  });
});
