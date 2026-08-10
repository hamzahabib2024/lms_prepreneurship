import { summarise, tally, type SecurityEventRow } from "./threat-summary";

let clock = 0;
/** Events in the order written; each one a minute after the last. */
const event = (over: Partial<SecurityEventRow> & { eventType: string }): SecurityEventRow => ({
  occurredAt: new Date(Date.UTC(2026, 7, 10, 9, (clock += 1))),
  userId: null,
  email: null,
  ipAddress: null,
  detail: null,
  ...over,
});

beforeEach(() => {
  clock = 0;
});

const failed = (email: string, ip = "10.0.0.1", detail: unknown = null) =>
  event({ eventType: "login.failed", email, ipAddress: ip, detail });
const succeeded = (email: string, ip = "10.0.0.1") =>
  event({ eventType: "login.success", email, ipAddress: ip });

const kinds = (events: SecurityEventRow[]) => summarise(events).map((c) => c.kind);

describe("quiet is reported as quiet", () => {
  it("says nothing about an empty log", () => {
    expect(summarise([])).toEqual([]);
  });

  it("says nothing about ordinary successful sign-ins", () => {
    // The realistic case: 664 successes and nothing else. A viewer that raises
    // a concern here is one people learn to ignore.
    const events = Array.from({ length: 100 }, (_, i) => succeeded(`person${i}@institute.local`));
    expect(summarise(events)).toEqual([]);
  });

  it("says nothing about a couple of typos", () => {
    expect(summarise([failed("sana@institute.local"), failed("sana@institute.local")])).toEqual([]);
  });
});

describe("one account, many failures", () => {
  const events = Array.from({ length: 6 }, () => failed("sana@institute.local"));

  it("is reported once the threshold is reached", () => {
    expect(kinds(events)).toContain("ACCOUNT_TARGETED");
  });

  it("is not reported one below it", () => {
    expect(kinds(Array.from({ length: 4 }, () => failed("sana@institute.local")))).not.toContain(
      "ACCOUNT_TARGETED",
    );
  });

  it("names the account and the count", () => {
    const c = summarise(events).find((x) => x.kind === "ACCOUNT_TARGETED");
    expect(c?.headline).toContain("sana@institute.local");
    expect(c?.headline).toContain("6");
    expect(c?.count).toBe(6);
  });

  it("says what to do", () => {
    const c = summarise(events).find((x) => x.kind === "ACCOUNT_TARGETED");
    expect(c?.advice).toContain("tell the account holder");
  });

  it("counts each account separately", () => {
    const mixed = [
      ...Array.from({ length: 6 }, () => failed("a@institute.local")),
      ...Array.from({ length: 2 }, () => failed("b@institute.local")),
    ];
    const targeted = summarise(mixed).filter((c) => c.kind === "ACCOUNT_TARGETED");
    expect(targeted).toHaveLength(1);
    expect(targeted[0]?.subject).toBe("a@institute.local");
  });
});

describe("one address, many accounts", () => {
  const spray = [
    failed("a@institute.local", "203.0.113.9"),
    failed("b@institute.local", "203.0.113.9"),
    failed("c@institute.local", "203.0.113.9"),
  ];

  it("is a DIFFERENT concern from one account being targeted", () => {
    // Same events counted a different way, because the response differs: block
    // the address, not lock the accounts.
    expect(kinds(spray)).toContain("PASSWORD_SPRAY");
    expect(kinds(spray)).not.toContain("ACCOUNT_TARGETED");
  });

  it("names the address and how many accounts", () => {
    const c = summarise(spray).find((x) => x.kind === "PASSWORD_SPRAY");
    expect(c?.headline).toContain("203.0.113.9");
    expect(c?.headline).toContain("3 different accounts");
    expect(c?.subjectKind).toBe("address");
  });

  it("explains why locking the accounts would not help", () => {
    const c = summarise(spray).find((x) => x.kind === "PASSWORD_SPRAY");
    expect(c?.advice).toContain("Blocking the address");
  });

  it("is not raised for two accounts", () => {
    expect(
      kinds([failed("a@institute.local", "203.0.113.9"), failed("b@institute.local", "203.0.113.9")]),
    ).not.toContain("PASSWORD_SPRAY");
  });

  it("is not raised when one account fails many times from one address", () => {
    expect(kinds(Array.from({ length: 8 }, () => failed("a@institute.local")))).not.toContain(
      "PASSWORD_SPRAY",
    );
  });

  it("can raise both when both are true", () => {
    const both = [
      ...Array.from({ length: 6 }, () => failed("a@institute.local", "203.0.113.9")),
      failed("b@institute.local", "203.0.113.9"),
      failed("c@institute.local", "203.0.113.9"),
    ];
    expect(kinds(both)).toEqual(expect.arrayContaining(["ACCOUNT_TARGETED", "PASSWORD_SPRAY"]));
  });
});

describe("probing for addresses that exist", () => {
  const probe = Array.from({ length: 5 }, (_, i) =>
    failed(`guess${i}@institute.local`, "198.51.100.4", { reason: "no_such_account" }),
  );

  it("is reported", () => {
    expect(kinds(probe)).toContain("ACCOUNT_ENUMERATION");
  });

  it("is only MEDIUM, because login already answers identically either way", () => {
    const c = summarise(probe).find((x) => x.kind === "ACCOUNT_ENUMERATION");
    expect(c?.severity).toBe("MEDIUM");
    expect(c?.advice).toContain("answers identically");
  });

  it("does not count failures against accounts that DO exist", () => {
    const real = Array.from({ length: 6 }, () =>
      failed("sana@institute.local", "198.51.100.4", { attempt: 1 }),
    );
    expect(kinds(real)).not.toContain("ACCOUNT_ENUMERATION");
  });

  it("survives a detail that is not an object", () => {
    expect(() => summarise([failed("a@b.c", "1.2.3.4", "nonsense")])).not.toThrow();
  });
});

describe("a token used twice", () => {
  const reuse = [event({ eventType: "refresh.reused", userId: "user-1", ipAddress: "10.0.0.5" })];

  it("is CRITICAL on a single occurrence", () => {
    // Unlike failed logins, one is already too many: it means a copy of the
    // token exists somewhere it should not.
    const c = summarise(reuse)[0];
    expect(c?.kind).toBe("TOKEN_REUSE");
    expect(c?.severity).toBe("CRITICAL");
  });

  it("says the family was already invalidated, so nobody re-does it", () => {
    expect(summarise(reuse)[0]?.advice).toContain("invalidated automatically");
  });

  it("names the account when there is only one", () => {
    expect(summarise(reuse)[0]?.subject).toBe("user-1");
  });

  it("names none when several accounts are involved", () => {
    const many = [
      event({ eventType: "refresh.reused", userId: "user-1" }),
      event({ eventType: "refresh.reused", userId: "user-2" }),
    ];
    const c = summarise(many)[0];
    expect(c?.subject).toBeNull();
    expect(c?.headline).toContain("2 accounts");
  });
});

describe("a success after a run of failures", () => {
  const breach = [
    ...Array.from({ length: 5 }, () => failed("sana@institute.local", "203.0.113.9")),
    succeeded("sana@institute.local", "203.0.113.9"),
  ];

  it("is CRITICAL — they may have got in", () => {
    const c = summarise(breach).find((x) => x.kind === "SUCCESS_AFTER_FAILURES");
    expect(c?.severity).toBe("CRITICAL");
  });

  it("names who, from where, and after how many", () => {
    const c = summarise(breach).find((x) => x.kind === "SUCCESS_AFTER_FAILURES");
    expect(c?.headline).toContain("sana@institute.local");
    expect(c?.headline).toContain("203.0.113.9");
    expect(c?.headline).toContain("5 failed");
  });

  it("is NOT raised when the success came first", () => {
    // Order matters and this is the only rule that depends on it. Somebody
    // signing in and then mistyping later is not a breach.
    const harmless = [
      succeeded("sana@institute.local", "203.0.113.9"),
      ...Array.from({ length: 6 }, () => failed("sana@institute.local", "203.0.113.9")),
    ];
    expect(kinds(harmless)).not.toContain("SUCCESS_AFTER_FAILURES");
  });

  it("is not raised for a success after one or two typos", () => {
    expect(
      kinds([
        failed("sana@institute.local"),
        failed("sana@institute.local"),
        succeeded("sana@institute.local"),
      ]),
    ).not.toContain("SUCCESS_AFTER_FAILURES");
  });

  it("resets the run after a success, so a later success is not implicated", () => {
    const events = [
      ...Array.from({ length: 5 }, () => failed("a@institute.local", "203.0.113.9")),
      succeeded("a@institute.local", "203.0.113.9"),
      succeeded("a@institute.local", "203.0.113.9"),
    ];
    expect(summarise(events).filter((c) => c.kind === "SUCCESS_AFTER_FAILURES")).toHaveLength(1);
  });

  it("does not confuse two addresses", () => {
    // Failures from an attacker, a success from the real person elsewhere.
    const events = [
      ...Array.from({ length: 6 }, () => failed("a@institute.local", "203.0.113.9")),
      succeeded("a@institute.local", "10.0.0.1"),
    ];
    expect(kinds(events)).not.toContain("SUCCESS_AFTER_FAILURES");
  });
});

describe("lockouts", () => {
  it("are reported as MEDIUM, being usually a mistyped password", () => {
    const c = summarise([event({ eventType: "login.locked", email: "sana@institute.local" })])[0];
    expect(c?.kind).toBe("LOCKOUTS");
    expect(c?.severity).toBe("MEDIUM");
    expect(c?.advice).toContain("locked out of something they need");
  });
});

describe("ordering", () => {
  it("puts the most serious first", () => {
    const messy = [
      event({ eventType: "login.locked", email: "a@institute.local" }),
      ...Array.from({ length: 6 }, () => failed("b@institute.local")),
      event({ eventType: "refresh.reused", userId: "user-1" }),
    ];
    const severities = summarise(messy).map((c) => c.severity);
    expect(severities[0]).toBe("CRITICAL");
    expect(severities[severities.length - 1]).toBe("MEDIUM");
  });

  it("puts the bigger count first within a severity", () => {
    const events = [
      ...Array.from({ length: 6 }, () => failed("small@institute.local", "10.0.0.1")),
      ...Array.from({ length: 20 }, () => failed("big@institute.local", "10.0.0.2")),
    ];
    const targeted = summarise(events).filter((c) => c.kind === "ACCOUNT_TARGETED");
    expect(targeted[0]?.subject).toBe("big@institute.local");
  });
});

describe("tally", () => {
  it("counts each kind", () => {
    const t = tally([
      succeeded("a@institute.local"),
      succeeded("b@institute.local"),
      failed("c@institute.local"),
      event({ eventType: "login.locked" }),
      event({ eventType: "refresh.reused" }),
      event({ eventType: "password.changed" }),
    ]);
    expect(t).toEqual({
      total: 6,
      signIns: 2,
      failures: 1,
      lockouts: 1,
      tokenReuse: 1,
      passwordChanges: 1,
      stepUpFailures: 0,
    });
  });

  it("is all zeros for an empty log rather than undefined", () => {
    expect(tally([]).total).toBe(0);
    expect(tally([]).signIns).toBe(0);
  });
});
