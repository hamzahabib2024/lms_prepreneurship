import { classify, stillWanted, summarise, MAX_ATTEMPTS } from "./pending-email";

/**
 * What to do about a refusal — the two judgements the mail queue turns on.
 *
 * THE REFUSAL TEXT HERE IS REAL. Every string in the "daily limit" case was
 * copied from what smtp.gmail.com actually returned to this System, not
 * invented to match the pattern. A regex tested only against text somebody
 * wrote to satisfy it proves nothing at all: the whole risk is that the
 * server's real wording differs from the wording that was imagined.
 *
 * THE TWO WAYS THIS CAN BE WRONG ARE OPPOSITE AND BOTH BAD. Treating a
 * permanent refusal as temporary retries a dead address sixty times, spending
 * the very allowance the queue exists to work around and teaching the mail
 * provider that this sender bounces. Treating a temporary one as permanent
 * loses a message that would have gone through in half an hour, which is the
 * whole defect the queue was built to fix.
 */

/** Verbatim, from a real send that was refused. */
const GMAIL_DAILY_LIMIT =
  "Data command failed: 550-5.4.5 Daily user sending limit exceeded. For more information on Gmail\n" +
  "550-5.4.5 sending limits go to\n" +
  "550 5.4.5  https://support.google.com/a/answer/166852 ffacd0b85a97d-482fbb32d30sm1595783f8f.34 - gsmtp";

describe("a refusal that will clear on its own is kept", () => {
  it("keeps the daily limit, which is the case this queue exists for", () => {
    const v = classify(GMAIL_DAILY_LIMIT, 1);
    expect(v.retry).toBe(true);
  });

  it("waits half an hour on a daily limit rather than hammering it", () => {
    const v = classify(GMAIL_DAILY_LIMIT, 1);
    if (!v.retry) throw new Error("expected a retry");
    /*
     * NOT A MINUTE. A mailbox that is full for the day is still full in sixty
     * seconds, and repeated refusals are how a sender's reputation gets worse
     * rather than better.
     */
    expect(v.afterMs).toBe(30 * 60_000);
  });

  it("keeps an unrecognised refusal, because the safe default is to try again", () => {
    const v = classify("451 4.7.1 Try again later", 1);
    expect(v.retry).toBe(true);
  });

  it("keeps a dropped connection", () => {
    expect(classify("Connection timeout", 1).retry).toBe(true);
  });

  it("backs off as attempts mount, and never past the daily-limit wait", () => {
    const delays = [1, 2, 3, 4, 5, 10].map((n) => {
      const v = classify("451 temporary failure", n);
      return v.retry ? v.afterMs : -1;
    });
    // Rising…
    expect(delays[0]).toBe(60_000);
    expect(delays[1]).toBe(120_000);
    expect(delays[2]).toBe(240_000);
    // …and then capped, so a long outage does not stretch the gap to days.
    expect(delays[5]).toBe(30 * 60_000);
    expect(Math.max(...delays)).toBe(30 * 60_000);
  });
});

describe("a refusal that will never clear is given up on", () => {
  /*
   * A WRONG ADDRESS IS FIXED BY A PERSON, NOT BY WAITING. Retrying it sixty
   * times spends allowance the messages behind it need.
   */
  it.each([
    "550 5.1.1 No such user here",
    "550-5.1.1 The email account that you tried to reach does not exist.",
    "553 5.1.2 Invalid recipient",
    "550 Mailbox unavailable",
  ])("gives up on a dead address: %s", (detail) => {
    expect(classify(detail, 1).retry).toBe(false);
  });

  it("gives up when the mail account's own password is refused", () => {
    const v = classify("535-5.7.8 Username and Password not accepted", 1);
    expect(v.retry).toBe(false);
    // And says so in a way that points at the configuration, not the student.
    if (v.retry) throw new Error("unreachable");
    expect(v.because).toMatch(/sign-in was refused/i);
  });

  it("gives up eventually even on a temporary refusal", () => {
    expect(classify("451 try later", MAX_ATTEMPTS).retry).toBe(false);
    expect(classify(GMAIL_DAILY_LIMIT, MAX_ATTEMPTS).retry).toBe(false);
  });
});

/**
 * THE ORDER OF THE TWO 550 RULES IS LORE, AND THIS IS WHERE IT IS WRITTEN DOWN.
 *
 * Gmail answers an exhausted allowance with 550, and answers a dead mailbox
 * with 550. A rule matching the code alone would classify the daily limit as a
 * dead address and abandon every queued message the first time it ran — which
 * is precisely the bug the queue was built to prevent, reintroduced inside the
 * queue itself.
 */
describe("a full mailbox is not mistaken for a missing one", () => {
  it("reads the daily limit as temporary even though it arrives as 550", () => {
    expect(GMAIL_DAILY_LIMIT).toContain("550");
    expect(classify(GMAIL_DAILY_LIMIT, 1).retry).toBe(true);
  });
});

describe("the refusal is stored readably", () => {
  it("keeps the first line, which carries the meaning", () => {
    expect(summarise(GMAIL_DAILY_LIMIT)).toBe(
      "Data command failed: 550-5.4.5 Daily user sending limit exceeded. For more information on Gmail",
    );
  });

  it("does not grow without limit", () => {
    expect(summarise("x".repeat(1000)).length).toBeLessThanOrEqual(300);
  });

  it("survives nothing at all", () => {
    expect(summarise("")).toBe("");
  });
});

/**
 * WHO STILL WANTS THE MESSAGE, hours or days later.
 *
 * THE FIRST TEST HERE IS THE BUG THAT SHIPPED INTO THIS FILE'S OWN FEATURE.
 * The check was written as `status !== "ACTIVE"` and the cohort import creates
 * every new student as INVITED — so the queue abandoned every message it had
 * been built to deliver, on the very first sweep, reporting "the account is no
 * longer active" about an account that had never been anything else.
 *
 * It was found by watching a real queued row through a real scheduled sweep,
 * not by reading. That is the argument for this describe block existing.
 */
describe("a queued message is still wanted by the person it is for", () => {
  it("SENDS to an INVITED account, which is the whole point of the queue", () => {
    const v = stillWanted({ kind: "CREDENTIALS", status: "INVITED", lastLoginAt: null });
    expect(v.send).toBe(true);
  });

  it("sends to an active account that has not signed in", () => {
    expect(stillWanted({ kind: "CREDENTIALS", status: "ACTIVE", lastLoginAt: null }).send).toBe(
      true,
    );
  });

  /* Locked out from failed sign-ins is a reason to want a new password, not a
     reason to be refused one — and the link goes to their own address. */
  it("sends to a locked-out account", () => {
    expect(stillWanted({ kind: "CREDENTIALS", status: "LOCKED", lastLoginAt: null }).send).toBe(
      true,
    );
  });

  it.each(["SUSPENDED", "WITHDRAWN", "ARCHIVED"])(
    "refuses a %s account, which must not be given a way back in",
    (status) => {
      expect(stillWanted({ kind: "CREDENTIALS", status, lastLoginAt: null }).send).toBe(false);
    },
  );

  it("refuses when the status is missing entirely", () => {
    expect(stillWanted({ kind: "CREDENTIALS", status: null, lastLoginAt: null }).send).toBe(false);
  });

  it("stops sending a way in to somebody who has already signed in", () => {
    const v = stillWanted({ kind: "CREDENTIALS", status: "ACTIVE", lastLoginAt: new Date() });
    expect(v.send).toBe(false);
  });

  /* The course-added note is news, not a credential. Having signed in does not
     make "you are enrolled in Evening B" irrelevant. */
  it("still sends a course note to somebody who has signed in", () => {
    expect(
      stillWanted({ kind: "COURSE_ADDED", status: "ACTIVE", lastLoginAt: new Date() }).send,
    ).toBe(true);
  });
});
