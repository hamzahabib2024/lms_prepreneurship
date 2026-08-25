import { WhatsAppChannel, toE164, flatten, explain } from "./whatsapp.channel";
import type { ConfigService } from "@nestjs/config";
import type { Recipient, OutboundMessage } from "./notification.channel";

/**
 * THE RULE THIS SUITE EXISTS TO PROTECT.
 *
 * Meta opens a 24-hour customer service window when a person messages your
 * number, and outside it accepts NOTHING but a pre-approved template. Every
 * message this System sends is outside that window: a student never messages
 * the Institute first, they are simply told their attendance is slipping.
 *
 * So an adapter that posts `type: "text"` — which is the API documentation's
 * own first example — is refused for essentially every recipient the Institute
 * has. And it fails in the most expensive way available: the developer's own
 * test message succeeds, because THEY messaged the number while setting it up
 * and are inside the window, and then no student receives anything.
 *
 * These tests pin the decision that prevents that: template or nothing.
 */

const config = (values: Record<string, string>): ConfigService =>
  ({ get: (k: string, d?: string) => values[k] ?? d ?? "" }) as unknown as ConfigService;

const READY = {
  WHATSAPP_ACCESS_TOKEN: "tok",
  WHATSAPP_PHONE_NUMBER_ID: "123456",
  WHATSAPP_TEMPLATE_NAME: "lms_notice",
  WHATSAPP_TEMPLATE_LANGUAGE: "en",
};

const recipient: Recipient = {
  userId: "u-1",
  fullName: "Hina Malik",
  phone: "+923001234567",
  phoneIsWhatsapp: true,
  email: null,
} as unknown as Recipient;

const message: OutboundMessage = {
  kind: "attendance.warning",
  title: "Attendance below 75%",
  body: "You have missed four classes.\nPlease speak to the office.",
  isUrgent: false,
} as unknown as OutboundMessage;

describe("whether WhatsApp is usable at all", () => {
  it("needs BOTH a token and a phone number id", () => {
    // One without the other cannot send: a token with no number has nowhere to
    // post, and a number with no token cannot authenticate. Reporting
    // configured on either alone moves the failure to send time, one message
    // at a time, buried in a delivery log.
    expect(new WhatsAppChannel(config({})).isConfigured()).toBe(false);
    expect(
      new WhatsAppChannel(config({ WHATSAPP_ACCESS_TOKEN: "t" })).isConfigured(),
    ).toBe(false);
    expect(
      new WhatsAppChannel(config({ WHATSAPP_PHONE_NUMBER_ID: "1" })).isConfigured(),
    ).toBe(false);
    expect(new WhatsAppChannel(config(READY)).isConfigured()).toBe(true);
  });

  it("will not send to somebody with no WhatsApp number", async () => {
    const ch = new WhatsAppChannel(config(READY));
    const out = await ch.send(
      { ...recipient, phoneIsWhatsapp: false } as Recipient,
      message,
    );
    expect(out.status).toBe("SUPPRESSED");
  });
});

describe("template or nothing", () => {
  it("REFUSES rather than falling back to free text when no template is set", async () => {
    /*
     * The heart of it. A fallback to `type: "text"` would look like resilience
     * and would in fact be a delivery log full of failures nobody can explain,
     * because the window is closed for every student the Institute has.
     */
    const ch = new WhatsAppChannel(config({ ...READY, WHATSAPP_TEMPLATE_NAME: "" }));
    const out = await ch.send(recipient, message);
    expect(out.status).toBe("SUPPRESSED");
    expect(out.detail).toContain("template");
    // And it says what to do about it.
    expect(out.detail).toContain("WHATSAPP_TEMPLATE_NAME");
  });

  it("posts a template message, not a text message", async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      // `RequestInit.body` is a union wide enough to include Blob and
      // ReadableStream, and String() on one of those gives "[object Object]".
      // The adapter always sends a JSON string; narrowing to that here keeps
      // the assertion honest rather than silencing the rule.
      const raw = typeof init.body === "string" ? init.body : "";
      calls.push({ url: String(url), body: JSON.parse(raw) as Record<string, unknown> });
      return {
        ok: true,
        status: 200,
        json: () => Promise.resolve({ messages: [{ id: "wamid.TEST" }] }),
      } as unknown as Response;
    }) as typeof fetch;

    try {
      const out = await new WhatsAppChannel(config(READY)).send(recipient, message);
      expect(out.status).toBe("SENT");
      expect(out.detail).toBe("wamid.TEST");

      const [call] = calls;
      expect(call!.url).toContain("/123456/messages");
      expect(call!.body["type"]).toBe("template");
      expect(call!.body["type"]).not.toBe("text");
      // Digits only — Meta wants no plus.
      expect(call!.body["to"]).toBe("923001234567");

      const template = call!.body["template"] as Record<string, unknown>;
      expect(template["name"]).toBe("lms_notice");

      // Two parameters, in this order: the Institute's approved template must
      // expect {{1}} title and {{2}} body, and a change here silently breaks
      // every message the moment Meta re-validates it.
      const params = (template["components"] as Array<Record<string, unknown>>)[0]![
        "parameters"
      ] as Array<{ text: string }>;
      expect(params).toHaveLength(2);
      expect(params[0]!.text).toBe("Attendance below 75%");
      // Newlines flattened: Meta rejects a body parameter containing one, and
      // the rejection reads as "invalid parameter".
      expect(params[1]!.text).not.toContain("\n");
    } finally {
      globalThis.fetch = original;
    }
  });

  it("reports a refusal in words the Institute can act on", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      ({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ error: { code: 190, message: "Session expired" } }),
      }) as unknown as Response) as typeof fetch;

    try {
      const out = await new WhatsAppChannel(config(READY)).send(recipient, message);
      expect(out.status).toBe("FAILED");
      expect(out.detail).toContain("token");
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("the number", () => {
  it("strips the plus and keeps the country code", () => {
    expect(toE164("+923001234567")).toBe("923001234567");
    expect(toE164("+92 300 123 4567")).toBe("923001234567");
  });

  it("refuses a local number rather than guessing a country", () => {
    // `03001234567` sent as-is reaches somebody in another country, or nobody.
    // Both are worse than a suppression that says the number is unusable.
    expect(toE164("03001234567")).toBeNull();
    expect(toE164("1234")).toBeNull();
    expect(toE164("+1234567890123456")).toBeNull();
  });
});

describe("the message body", () => {
  it("flattens newlines and bounds the length", () => {
    expect(flatten("a\nb\n\nc", 50)).toBe("a b c");
    expect(flatten("x".repeat(100), 10)).toHaveLength(10);
    expect(flatten("x".repeat(100), 10).endsWith("…")).toBe(true);
  });
});

describe("errors are explained, not echoed", () => {
  it.each([
    [190, "token"],
    [131_047, "template"],
    [131_030, "allow-list"],
    [4, "rate-limit"],
  ])("code %s mentions %s", (code, word) => {
    expect(explain(400, { code, message: "x" }).toLowerCase()).toContain(word);
  });

  it("says something useful even for a code it does not know", () => {
    expect(explain(500, { code: 999_999, message: "boom" })).toContain("500");
  });
});
