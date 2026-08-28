import { ConfigService } from "@nestjs/config";
import { EmailChannel } from "./email.channel";
import { EmailLogService } from "../email-log.service";
import { SimulatedOutbox } from "../../integration/simulated-outbox";
import type { OutboundMessage, Recipient } from "./notification.channel";

/**
 * The send log, stubbed.
 *
 * Every outgoing message is written down so that "where did the day's sending
 * allowance go" has an answer. Nothing in this file is about that, and the
 * real one wants a database — so it is a no-op here, and the calls it swallows
 * are asserted where they belong, in email-log.spec.ts.
 */
const noLog = { record: () => undefined } as unknown as EmailLogService;

const configWith = (values: Record<string, string> = {}): ConfigService =>
  ({ get: (key: string, fallback?: string) => values[key] ?? fallback }) as unknown as ConfigService;

const FULL = {
  SMTP_HOST: "smtp.gmail.com",
  SMTP_PORT: "587",
  SMTP_USER: "office@prepreneurship.pk",
  SMTP_PASSWORD: "abcd efgh ijkl mnop",
};

const recipient = (over: Partial<Recipient> = {}): Recipient => ({
  userId: "u1",
  fullName: "Ayesha Khan",
  email: "ayesha@example.com",
  phone: null,
  phoneIsWhatsapp: false,
  ...over,
});

const message = (over: Partial<OutboundMessage> = {}): OutboundMessage => ({
  kind: "grade.released",
  title: "Your mark is available",
  body: "Your mark for Logo redesign has been released.",
  linkPath: "/subjects",
  isUrgent: false,
  ...over,
});

describe("whether email is usable at all", () => {
  it("needs the host, the user AND the password", () => {
    // Two of three is a misconfiguration that would otherwise fail at the
    // first send — and the first send is a real message to a real student.
    expect(new EmailChannel(configWith(FULL), new SimulatedOutbox(), noLog).isConfigured()).toBe(true);
    for (const missing of ["SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD"]) {
      const partial = { ...FULL, [missing]: "" };
      expect(new EmailChannel(configWith(partial), new SimulatedOutbox(), noLog).isConfigured()).toBe(false);
    }
  });

  it("treats whitespace as unset", () => {
    const c = new EmailChannel(configWith({ ...FULL, SMTP_HOST: "   " }), new SimulatedOutbox(), noLog);
    expect(c.isConfigured()).toBe(false);
  });

  it("is unconfigured when nothing is set", () => {
    expect(new EmailChannel(configWith(), new SimulatedOutbox(), noLog).isConfigured()).toBe(false);
  });

  it("MAIL_DRIVER=log wins over having working credentials", () => {
    // The case this exists for: real SMTP settings in .env and a database full
    // of real-looking students, one announcement away from mailing thirty
    // people by accident.
    const c = new EmailChannel(configWith({ ...FULL, MAIL_DRIVER: "log" }), new SimulatedOutbox(), noLog);
    expect(c.isConfigured()).toBe(false);
  });

  it("says WHICH of the two reasons it is holding a message", async () => {
    // "Email is not configured" when the credentials are right there would
    // send somebody to check settings that are already correct.
    const logged = new EmailChannel(
      configWith({ ...FULL, MAIL_DRIVER: "log" }),
      new SimulatedOutbox(),
      noLog,
    );
    const outcome = await logged.send(recipient(), message());
    expect(outcome.detail).toContain("MAIL_DRIVER");
    expect(outcome.detail).not.toContain("is not configured (SMTP_HOST");
  });

  it("sends once MAIL_DRIVER is anything else", () => {
    for (const driver of ["smtp", "", "SMTP"]) {
      const c = new EmailChannel(configWith({ ...FULL, MAIL_DRIVER: driver }), new SimulatedOutbox(), noLog);
      expect(c.isConfigured()).toBe(true);
    }
  });
});

describe("who it can reach", () => {
  const channel = new EmailChannel(configWith(FULL), new SimulatedOutbox(), noLog);

  it("reaches somebody with an address", () => {
    expect(channel.canReach(recipient())).toBe(true);
  });

  it("does not reach somebody without one", () => {
    expect(channel.canReach(recipient({ email: "" }))).toBe(false);
    expect(channel.canReach(recipient({ email: "not-an-address" }))).toBe(false);
    expect(channel.canReach(recipient({ email: null as unknown as string }))).toBe(false);
  });
});

describe("when it is not configured", () => {
  it("SUPPRESSES rather than claiming to have sent", async () => {
    // The property that matters. A channel reporting SENT with no mail server
    // makes the delivery log a record of messages nobody received.
    const outbox = new SimulatedOutbox();
    const channel = new EmailChannel(configWith(), outbox, noLog);
    const outcome = await channel.send(recipient(), message());

    expect(outcome.status).toBe("SUPPRESSED");
    expect(outcome.status).not.toBe("SENT");
  });

  it("names the settings that would fix it", async () => {
    const channel = new EmailChannel(configWith(), new SimulatedOutbox(), noLog);
    const outcome = await channel.send(recipient(), message());
    expect(outcome.detail).toContain("SMTP_HOST");
  });

  it("keeps the wording, so it can be proofread before there is a mailbox", async () => {
    const outbox = new SimulatedOutbox();
    const channel = new EmailChannel(configWith(), outbox, noLog);
    await channel.send(recipient(), message({ title: "Fees due" }));

    const held = outbox.recent();
    expect(held).toHaveLength(1);
    expect(held[0]?.channel).toBe("EMAIL");
    expect(held[0]?.title).toBe("Fees due");
    expect(held[0]?.destination).toBe("ayesha@example.com");
  });

  it("records NOTHING for a recipient it could not have reached anyway", async () => {
    // A person with no address is not a message waiting to be sent, and
    // putting them in the outbox would overstate what configuring email buys.
    const outbox = new SimulatedOutbox();
    const channel = new EmailChannel(configWith(), outbox, noLog);
    const outcome = await channel.send(recipient({ email: "" }), message());

    expect(outcome.status).toBe("SUPPRESSED");
    expect(outcome.detail).toContain("No email address");
    expect(outbox.count()).toBe(0);
  });
});

describe("what a recipient actually reads", () => {
  /** The private formatter, reached the way the send path reaches it. */
  const render = (cfg: Record<string, string>, msg?: Partial<OutboundMessage>) => {
    const channel = new EmailChannel(configWith(cfg), new SimulatedOutbox(), noLog) as unknown as {
      plainText: (r: Recipient, m: OutboundMessage) => string;
    };
    return channel.plainText(recipient(), message(msg));
  };

  it("greets them by name and carries the message", () => {
    const text = render({ INSTITUTE_NAME: "Prepreneurship" });
    expect(text).toContain("Dear Ayesha Khan");
    expect(text).toContain("Your mark for Logo redesign has been released.");
    expect(text).toContain("Prepreneurship");
  });

  it("turns a relative path into a link somebody can click", () => {
    const text = render({ PUBLIC_WEB_URL: "https://learn.prepreneurship.pk" });
    expect(text).toContain("https://learn.prepreneurship.pk/subjects");
  });

  it("omits the link entirely rather than printing a bare path", () => {
    // "/subjects" on its own line in an email is not a link, it is a puzzle.
    const text = render({});
    expect(text).not.toMatch(/^\/subjects$/m);
  });

  it("does not double the slash when the base URL has a trailing one", () => {
    const text = render({ PUBLIC_WEB_URL: "https://learn.prepreneurship.pk/" });
    expect(text).toContain("https://learn.prepreneurship.pk/subjects");
    expect(text).not.toContain("pk//subjects");
  });

  it("says it is automatic, so nobody replies into a void", () => {
    expect(render({})).toContain("do not reply");
  });

  it("falls back to a neutral signature rather than printing nothing", () => {
    expect(render({})).toContain("The Institute");
  });
});

describe("the from address", () => {
  const fromOf = (cfg: Record<string, string>) =>
    (new EmailChannel(configWith(cfg), new SimulatedOutbox(), noLog) as unknown as { from: string }).from;

  it("uses an explicit MAIL_FROM when given", () => {
    expect(fromOf({ ...FULL, MAIL_FROM: '"Prepreneurship" <no-reply@prep.pk>' })).toBe(
      '"Prepreneurship" <no-reply@prep.pk>',
    );
  });

  it("otherwise shows the Institute's name over the sending account", () => {
    expect(fromOf({ ...FULL, INSTITUTE_NAME: "Prepreneurship" })).toBe(
      '"Prepreneurship" <office@prepreneurship.pk>',
    );
  });

  it("falls back to the bare account rather than an empty name", () => {
    expect(fromOf(FULL)).toBe("office@prepreneurship.pk");
  });
});
