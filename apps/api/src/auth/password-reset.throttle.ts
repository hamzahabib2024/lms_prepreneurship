import { SetMetadata, type CustomDecorator, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { ThrottlerGetTrackerFunction } from "@nestjs/throttler";

/**
 * RATE-LIMITING THE FORGOTTEN-PASSWORD FORM BY ADDRESS, NOT BY ADDRESS.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The two senses of that word are the whole point, so: by EMAIL address, not by
 * IP address.
 *
 * The default throttler counts per IP, which is right for almost every route
 * and quietly wrong for this one. Behind nginx an entire Institute shares a
 * single public IP, so a limit of five an hour is five FOR THE SCHOOL. Five
 * students forget their passwords on results day, the sixth is told to wait an
 * hour, and nothing in the message explains why — because from her side nothing
 * has happened at all. The same shape of mistake as an unset TRUST_PROXY_HOPS:
 * one identity standing in for many people.
 *
 * SO THIS COUNTS THE MAILBOX BEING WRITTEN TO. One person cannot fill their own
 * inbox, and nobody can use the form to pester a stranger — which is the abuse
 * that actually matters, because the mail goes to somebody who never asked for
 * it. Meanwhile a hall of students on one wifi are not competing for a single
 * budget.
 *
 * IT IS A PER-THROTTLER FUNCTION RATHER THAN A SUBCLASSED GUARD, and that is
 * the second attempt. Overriding `getTracker` on the guard applies it to EVERY
 * named throttler the guard handles, so the IP backstop below was keyed by
 * email too — and a different address from the same computer was refused,
 * which is precisely the bug this exists to prevent. Caught by testing two
 * addresses rather than one.
 *
 * FALLS BACK TO THE IP when there is no address to count: a malformed body must
 * still be limited by something, and an unlimited route is worse than a bluntly
 * limited one.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const trackByEmailAddress: ThrottlerGetTrackerFunction = (req, _context) => {
  const body = (req as { body?: unknown }).body;
  const email =
    body && typeof body === "object" && typeof (body as { email?: unknown }).email === "string"
      ? (body as { email: string }).email.trim().toLowerCase()
      : "";

  // Prefixed, so this counter can never collide with the IP-keyed one the rest
  // of the application uses — `reset:a@b.com` is not an IP address, and no IP
  // address is `reset:` anything.
  if (email) return `reset:${email}`;

  const ip = (req as { ip?: string }).ip;
  return ip ?? "unknown";
};

/* ========================================================================= *
 *  AND THESE TWO LIMITS APPLY TO ONE ROUTE ONLY.
 *
 *  THE BUG THIS EXISTS TO PREVENT, because it had already happened: naming a
 *  throttler in ThrottlerModule.forRoot does NOT confine it to whatever route
 *  you had in mind. The global ThrottlerGuard enforces EVERY throttler in that
 *  array against EVERY request the application serves. So a three-an-hour
 *  limit written for the forgotten-password form became a three-an-hour limit
 *  on the whole System — and because `trackByEmailAddress` falls back to the
 *  IP when a request carries no email, every ordinary request counted against
 *  one bucket keyed by the caller's address.
 *
 *  What that looked like from a desk: sign in, and the dashboard says "Could
 *  not load your dashboard — Too many requests. Please wait a moment." Every
 *  screen, every user, one hour at a time, on the SECOND request of the hour.
 *  Even /system/health, which is the endpoint an outside monitor uses to
 *  decide whether the Institute is down.
 *
 *  So each of the two throttlers carries `skipIf: exceptPasswordReset`, and
 *  the route that wants them says so out loud with @PasswordResetLimited().
 *  OPT IN RATHER THAN OPT OUT: a new route added next year is limited by the
 *  default throttler like everything else, rather than silently inheriting a
 *  limit meant for a form it has nothing to do with.
 * ========================================================================= */

/** Set on the one handler these limits are for. */
const RESET_LIMITED = "password-reset-limited";

/**
 * Marks the forgotten-password route as the one the reset limits apply to.
 *
 * Without this the route is limited by `default` alone — 300 a minute — which
 * is why the decorator is not optional decoration. It is the whole opt-in.
 */
export const PasswordResetLimited = (): CustomDecorator => SetMetadata(RESET_LIMITED, true);

/*
 * Reflector holds no injected state — it is a thin reader over the metadata
 * Nest has already attached to the handler — so one instance for the process
 * is correct here, where there is nothing to inject into.
 */
const reflector = new Reflector();

/**
 * True — meaning SKIP this throttler — for every handler that has not opted in.
 *
 * Reads the HANDLER only, deliberately, not the class: marking a controller
 * would apply a three-an-hour limit to every route on it, which is a smaller
 * version of the same mistake.
 */
export const exceptPasswordReset = (context: ExecutionContext): boolean =>
  reflector.get<boolean>(RESET_LIMITED, context.getHandler()) !== true;
