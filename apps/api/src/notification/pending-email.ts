/**
 * Deciding what to do about a message the mail server would not take.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PURE, AND SEPARATE FROM THE SERVICE THAT USES IT, because these are the two
 * judgements the whole queue turns on and both are easy to get quietly wrong:
 *
 *   IS IT WORTH TRYING AGAIN? Retrying a permanent refusal for three days
 *   fills the log, wastes the very allowance that is short, and never
 *   succeeds. Giving up on a temporary one loses a message that would have
 *   gone through in an hour.
 *
 *   WHEN? A mailbox that is full for the day will still be full in sixty
 *   seconds. Hammering it is not merely useless — repeated refusals are how an
 *   account's reputation gets worse rather than better.
 *
 * Both are decided from the SMTP server's own words, which is all the
 * information there is. The tests exercise them directly with real refusal
 * text, which is only possible because nothing here touches the database.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** What a failed send should do next. */
export type Verdict =
  | { retry: true; afterMs: number; because: string }
  | { retry: false; because: string };

/**
 * THE DAILY ALLOWANCE, AND WHY IT GETS ITS OWN DELAY.
 *
 * Google answers an exhausted account with 5.4.5 and the words "Daily user
 * sending limit exceeded". The allowance is a ROLLING twenty-four hours, not a
 * calendar day, so it comes back gradually as the oldest sends age out rather
 * than all at once at midnight.
 *
 * Half an hour is the compromise: long enough that a queue of thirty messages
 * is not thirty refusals a minute, short enough that the recovery is picked up
 * within an hour of it starting. It is not worth being cleverer — the exact
 * moment an allowance returns is not knowable from this side.
 */
const DAILY_LIMIT_RETRY_MS = 30 * 60_000;

/** How many times before a message is given up on. */
export const MAX_ATTEMPTS = 60;

const matches = (detail: string, pattern: RegExp): boolean => pattern.test(detail);

/**
 * What to do about this refusal.
 *
 * `attempts` is the number ALREADY made, so the first failure arrives as 1.
 */
export function classify(detail: string, attempts: number): Verdict {
  const text = detail || "";

  /*
   * OUT OF ALLOWANCE — the case this queue exists for. Temporary by
   * definition, and the one refusal where waiting is the entire remedy.
   */
  if (matches(text, /daily .*(sending )?limit|5\.4\.5|quota|rate limit|too many messages/i)) {
    return attempts >= MAX_ATTEMPTS
      ? { retry: false, because: "The daily limit has been in the way for too long." }
      : {
          retry: true,
          afterMs: DAILY_LIMIT_RETRY_MS,
          because: "The sending account has reached its daily limit.",
        };
  }

  /*
   * NO SUCH MAILBOX. Permanent, and retrying is worse than useless: every
   * attempt spends allowance that the messages behind it need, and a hard
   * bounce repeated fifty times is exactly the pattern that damages a sending
   * reputation. A wrong address is fixed by a person, not by waiting.
   *
   * MATCHED ON THE WORDS, NOT ON THE 5xx CLASS. A 550 covers both this and the
   * daily limit, so the limit is tested FIRST above and this is the narrower
   * catch underneath it.
   */
  if (
    matches(
      text,
      /no such (user|mailbox|recipient)|user unknown|does not exist|address rejected|invalid recipient|mailbox unavailable|5\.1\.[01]/i,
    )
  ) {
    return { retry: false, because: "There is no mailbox at that address." };
  }

  /*
   * THE PASSWORD IS WRONG. A configuration fault, not a transport one — it
   * will not fix itself, and it applies to every message equally.
   */
  if (matches(text, /invalid login|535|username and password not accepted|badcredentials/i)) {
    return {
      retry: false,
      because: "The mail account's own sign-in was refused, so nothing will send until it is fixed.",
    };
  }

  if (attempts >= MAX_ATTEMPTS) {
    return { retry: false, because: "Too many attempts." };
  }

  /*
   * EVERYTHING ELSE IS ASSUMED TEMPORARY, and that is the deliberate default.
   * A dropped connection, a greylist, a server having a bad afternoon: those
   * all recover, and the cost of trying again is one message. The cost of the
   * opposite default — abandoning anything unrecognised — is silently losing
   * mail for a reason nobody wrote a pattern for yet.
   *
   * Backed off exponentially from a minute, capped at half an hour so a long
   * outage does not stretch the gap to days.
   */
  const afterMs = Math.min(60_000 * 2 ** (attempts - 1), DAILY_LIMIT_RETRY_MS);
  return { retry: true, afterMs, because: "The mail server refused it for now." };
}

/**
 * The refusal, shortened to the part a person can act on.
 *
 * An SMTP rejection arrives as several lines of repeated codes and a support
 * URL. Stored whole it is unreadable in a list; the first line carries the
 * meaning and the rest is ceremony.
 */
export function summarise(detail: string): string {
  const first = (detail || "").split("\n")[0]?.trim() ?? "";
  return first.length > 300 ? `${first.slice(0, 297)}…` : first;
}

/**
 * IS THIS MESSAGE STILL WANTED, hours or days after it was queued?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A PURE DECISION, HERE RATHER THAN INLINE, because the first version of it was
 * written inline and was wrong in the one way that mattered. It read
 *
 *     if (user.status !== "ACTIVE") abandon()
 *
 * and the cohort import creates every new student as INVITED — the status that
 * means "has an account and has never signed in", which is precisely the person
 * a credentials email is for. So the queue abandoned every message it was built
 * to deliver, on the first sweep, and said "the account is no longer active"
 * about an account that had never been anything else.
 *
 * It was caught by watching a real queued row through a real sweep. Nothing
 * about reading the code suggested it: the check looks careful, and INVITED
 * only reveals itself as the common case when you go and look at what the
 * importer writes.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export type WantedVerdict = { send: true } | { send: false; because: string };

export function stillWanted(input: {
  kind: "CREDENTIALS" | "COURSE_ADDED";
  status: string | null | undefined;
  lastLoginAt: Date | null | undefined;
}): WantedVerdict {
  /*
   * DELIBERATELY SHUT OFF. Somebody suspended, withdrawn or archived is not to
   * be sent a way back in — that is the entire point of those states, and a
   * queued message must not become a side door around them.
   */
  if (!input.status || ["SUSPENDED", "WITHDRAWN", "ARCHIVED"].includes(input.status)) {
    return { send: false, because: "The account has been closed or suspended." };
  }

  /*
   * INVITED, ACTIVE AND LOCKED ALL STILL WANT IT.
   *
   * INVITED is the common case and the one the first version got wrong.
   * LOCKED is a temporary lockout from failed sign-ins, and somebody in that
   * position wants a way to choose a new password more than anyone — the link
   * goes to their own address, so it opens nothing to whoever locked them out.
   */
  if (input.kind === "CREDENTIALS" && input.lastLoginAt) {
    return {
      send: false,
      because: "They have signed in already, so they do not need a way to set a password.",
    };
  }

  return { send: true };
}
