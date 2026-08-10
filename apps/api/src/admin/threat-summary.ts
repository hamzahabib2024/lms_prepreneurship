/**
 * Reading the security log — SRS §13.8, FR-LOG-020..026, SEC-MON-*.
 *
 * WHAT MAKES A SECURITY LOG USELESS IS SHOWING IT. The development database
 * holds 674 events, of which 664 are successful logins. A viewer that lists
 * them newest-first is a wall of people signing in, with the eight failures
 * that might matter somewhere inside it. Nobody reads that twice.
 *
 * So the rows are available, but the screen leads with this: what, in the last
 * window, deserves a person's attention. That is a judgement, which is why it
 * is a pure function with tests rather than a query.
 *
 * THE SAME EVENT MEANS DIFFERENT THINGS DEPENDING ON ITS COMPANY, and the
 * distinctions here are the ones that change what somebody should DO:
 *
 *   many failures against ONE account          somebody is guessing a person's
 *                                              password. Tell that person.
 *
 *   failures from ONE ADDRESS across MANY      somebody is trying one common
 *   accounts                                   password against everybody.
 *                                              Block the address.
 *
 *   failures against accounts that DO NOT      somebody is discovering which
 *   EXIST                                      email addresses are real. Not
 *                                              urgent, worth knowing.
 *
 *   a success after a run of failures from     they may have got in. This is
 *   the same address                           the one that needs answering
 *                                              tonight.
 *
 *   a refresh token used twice                 the token was copied. SEC-AUT-004
 *                                              already invalidated the family;
 *                                              this says whose and how often.
 */

export interface SecurityEventRow {
  eventType: string;
  occurredAt: Date;
  userId: string | null;
  email: string | null;
  ipAddress: string | null;
  detail: unknown;
}

export type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export interface Concern {
  kind:
    | "TOKEN_REUSE"
    | "SUCCESS_AFTER_FAILURES"
    | "ACCOUNT_TARGETED"
    | "PASSWORD_SPRAY"
    | "ACCOUNT_ENUMERATION"
    | "LOCKOUTS";
  severity: Severity;
  /** One line, in words, naming the subject. */
  headline: string;
  /** What a person should actually do about it. */
  advice: string;
  count: number;
  /** The account or address it concerns, for filtering the rows below. */
  subject: string | null;
  subjectKind: "account" | "address" | null;
}

export interface Thresholds {
  /** Failures against one account before it is worth saying. */
  perAccount: number;
  /** Distinct accounts one address may fail against before it is spraying. */
  distinctAccountsPerAddress: number;
  /** Failures against non-existent accounts from one address. */
  enumerationPerAddress: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  perAccount: 5,
  distinctAccountsPerAddress: 3,
  enumerationPerAddress: 5,
};

const SEVERITY_ORDER: Record<Severity, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
};

/**
 * The concerns in a window of events, most serious first.
 *
 * Returns an empty array when there is nothing to say, and the screen says so
 * plainly. "No concerns in the last 24 hours" is information; an empty table is
 * ambiguous between quiet and broken.
 */
export function summarise(
  events: SecurityEventRow[],
  thresholds: Thresholds = DEFAULT_THRESHOLDS,
): Concern[] {
  const concerns: Concern[] = [];
  const failures = events.filter((e) => e.eventType === "login.failed");

  // -- a token used twice -----------------------------------------------------
  const reuse = events.filter((e) => e.eventType === "refresh.reused");
  if (reuse.length > 0) {
    const accounts = new Set(reuse.map((e) => e.userId).filter(Boolean));
    concerns.push({
      kind: "TOKEN_REUSE",
      severity: "CRITICAL",
      headline: `A refresh token was used twice, on ${accounts.size} ${accounts.size === 1 ? "account" : "accounts"}.`,
      advice:
        "A token was replayed, which means a copy of it exists somewhere it should not. " +
        "The session family was invalidated automatically; sign the account out everywhere " +
        "and have the password changed.",
      count: reuse.length,
      subject: accounts.size === 1 ? ([...accounts][0] as string) : null,
      subjectKind: accounts.size === 1 ? "account" : null,
    });
  }

  // -- a success after a run of failures from the same address ----------------
  //
  // Ordered by time, so "after" means after. This is the only concern that
  // depends on sequence rather than counting, and it is the one worth waking
  // somebody for.
  const byTime = [...events].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  const runByAddress = new Map<string, number>();
  const suspicious: Array<{ address: string; failuresBefore: number; account: string }> = [];
  for (const e of byTime) {
    const address = e.ipAddress;
    if (!address) continue;
    if (e.eventType === "login.failed") {
      runByAddress.set(address, (runByAddress.get(address) ?? 0) + 1);
    } else if (e.eventType === "login.success") {
      const run = runByAddress.get(address) ?? 0;
      if (run >= thresholds.perAccount) {
        suspicious.push({
          address,
          failuresBefore: run,
          account: e.email ?? e.userId ?? "an account",
        });
      }
      runByAddress.set(address, 0);
    }
  }
  for (const s of suspicious) {
    concerns.push({
      kind: "SUCCESS_AFTER_FAILURES",
      severity: "CRITICAL",
      headline: `${s.account} signed in from ${s.address} after ${s.failuresBefore} failed attempts.`,
      advice:
        "The password may have been guessed. Confirm with the account holder that it was them, " +
        "and reset the password if not.",
      count: s.failuresBefore,
      subject: s.address,
      subjectKind: "address",
    });
  }

  // -- one account, many failures ---------------------------------------------
  const perAccount = new Map<string, number>();
  for (const e of failures) {
    const key = e.email ?? e.userId;
    if (key) perAccount.set(key, (perAccount.get(key) ?? 0) + 1);
  }
  for (const [account, count] of perAccount) {
    if (count >= thresholds.perAccount) {
      concerns.push({
        kind: "ACCOUNT_TARGETED",
        severity: "HIGH",
        headline: `${count} failed sign-ins for ${account}.`,
        advice:
          "Somebody is guessing this password. The account locks itself after repeated failures; " +
          "tell the account holder, in case it is not them mistyping.",
        count,
        subject: account,
        subjectKind: "account",
      });
    }
  }

  // -- one address, many accounts ---------------------------------------------
  //
  // A different attack from the one above and it needs a different response, so
  // it is a different concern even though both count login.failed.
  const accountsPerAddress = new Map<string, Set<string>>();
  for (const e of failures) {
    if (!e.ipAddress) continue;
    const key = e.email ?? e.userId;
    if (!key) continue;
    const set = accountsPerAddress.get(e.ipAddress) ?? new Set<string>();
    set.add(key);
    accountsPerAddress.set(e.ipAddress, set);
  }
  for (const [address, accounts] of accountsPerAddress) {
    if (accounts.size >= thresholds.distinctAccountsPerAddress) {
      concerns.push({
        kind: "PASSWORD_SPRAY",
        severity: "HIGH",
        headline: `${address} failed against ${accounts.size} different accounts.`,
        advice:
          "One password tried against many people. Blocking the address stops it; locking the " +
          "accounts does not, because each is only tried once or twice.",
        count: accounts.size,
        subject: address,
        subjectKind: "address",
      });
    }
  }

  // -- probing for which addresses exist --------------------------------------
  const enumerationPerAddress = new Map<string, number>();
  for (const e of failures) {
    if (!e.ipAddress) continue;
    if (reasonOf(e.detail) !== "no_such_account") continue;
    enumerationPerAddress.set(e.ipAddress, (enumerationPerAddress.get(e.ipAddress) ?? 0) + 1);
  }
  for (const [address, count] of enumerationPerAddress) {
    if (count >= thresholds.enumerationPerAddress) {
      concerns.push({
        kind: "ACCOUNT_ENUMERATION",
        severity: "MEDIUM",
        headline: `${address} tried ${count} addresses that are not accounts here.`,
        advice:
          "Somebody is finding out which email addresses are real. Login already answers " +
          "identically either way, so this tells them little, but the source is worth noting.",
        count,
        subject: address,
        subjectKind: "address",
      });
    }
  }

  // -- lockouts ---------------------------------------------------------------
  const lockouts = events.filter((e) => e.eventType === "login.locked");
  if (lockouts.length > 0) {
    const accounts = new Set(lockouts.map((e) => e.email ?? e.userId).filter(Boolean));
    concerns.push({
      kind: "LOCKOUTS",
      severity: "MEDIUM",
      headline: `${accounts.size} ${accounts.size === 1 ? "account was" : "accounts were"} locked out.`,
      advice:
        "Usually somebody mistyping their own password. Worth checking they are not locked out " +
        "of something they need today.",
      count: lockouts.length,
      subject: accounts.size === 1 ? ([...accounts][0] as string) : null,
      subjectKind: accounts.size === 1 ? "account" : null,
    });
  }

  return concerns.sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || b.count - a.count,
  );
}

/** The counts a person expects to see at the top, whether or not anything is wrong. */
export function tally(events: SecurityEventRow[]) {
  const count = (type: string) => events.filter((e) => e.eventType === type).length;
  return {
    total: events.length,
    signIns: count("login.success"),
    failures: count("login.failed"),
    lockouts: count("login.locked"),
    tokenReuse: count("refresh.reused"),
    passwordChanges: count("password.changed"),
    stepUpFailures: count("stepup.failed"),
  };
}

function reasonOf(detail: unknown): string | null {
  if (!detail || typeof detail !== "object") return null;
  const value = (detail as Record<string, unknown>)["reason"];
  return typeof value === "string" ? value : null;
}
