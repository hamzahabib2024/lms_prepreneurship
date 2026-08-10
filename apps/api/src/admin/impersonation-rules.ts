/**
 * Impersonation — SRS §5.21, SEC-AUZ-013, FR-USR-030..034.
 *
 * A Super Admin acting AS somebody else, to see what they see. It exists
 * because "the page is broken for me" is unanswerable otherwise, and it is the
 * single most dangerous capability in the System: it produces a session that is
 * indistinguishable, to every other part of the code, from the real person.
 *
 * The plumbing for it has been in place from the start and unused — Actor
 * carries impersonatedBy, the audit service writes it, the viewer returns it
 * and the audit screen renders "while impersonating". Nothing ever set it.
 *
 * THE RULES ARE THE FEATURE. Anyone can mint a token; what makes this safe
 * enough to exist is what it refuses, so those refusals live here, pure and
 * tested, rather than scattered through a service.
 *
 * The four that matter most:
 *
 *   NO SUPER ADMIN MAY BE IMPERSONATED. Otherwise the highest privilege in the
 *   System is reachable by holding it, mutually, and accountability becomes
 *   circular: two Super Admins can each act as the other and neither log tells
 *   you who decided anything.
 *
 *   NO NESTING. An impersonated session cannot start another one, or the trail
 *   becomes a chain and impersonatedBy — a single column — records only the
 *   last link.
 *
 *   NO CREDENTIAL CHANGES WHILE IMPERSONATING. This is the one that stops
 *   impersonation becoming permanent account theft. An impersonator who can
 *   change a password can lock the owner out and thereafter sign in as them
 *   directly, with nothing marked as impersonation at all. Support does not
 *   need it; a takeover does.
 *
 *   IT EXPIRES AND CANNOT BE RENEWED. There is no refresh token, so the session
 *   ends by arithmetic rather than by anyone remembering to end it.
 */

export interface ImpersonationTarget {
  id: string;
  roles: string[];
  status: string;
  deletedAt: Date | null;
}

export interface ImpersonationActor {
  userId: string;
  roles: string[];
  /** Already impersonating somebody. */
  impersonatedBy?: string | undefined;
}

export type RefusalCode =
  | "NOT_SUPER_ADMIN"
  | "TARGET_IS_SUPER_ADMIN"
  | "TARGET_IS_SELF"
  | "TARGET_INACTIVE"
  | "TARGET_DELETED"
  | "ALREADY_IMPERSONATING"
  | "REASON_TOO_SHORT";

export interface Refusal {
  code: RefusalCode;
  message: string;
}

/** Null when it is allowed; otherwise why not. */
export function refuseImpersonation(
  actor: ImpersonationActor,
  target: ImpersonationTarget,
): Refusal | null {
  if (actor.impersonatedBy) {
    return {
      code: "ALREADY_IMPERSONATING",
      message:
        "You are already acting as somebody else. Stop that first — impersonation cannot be nested, " +
        "because the record of who is really acting holds one name.",
    };
  }

  if (!actor.roles.includes("super_admin")) {
    return {
      code: "NOT_SUPER_ADMIN",
      message: "Only a Super Admin can act as another user.",
    };
  }

  if (target.id === actor.userId) {
    return {
      code: "TARGET_IS_SELF",
      message: "You are already yourself.",
    };
  }

  if (target.roles.includes("super_admin")) {
    return {
      code: "TARGET_IS_SUPER_ADMIN",
      message:
        "A Super Admin cannot be impersonated. Two Super Admins able to act as each other would " +
        "make the record of who decided what circular.",
    };
  }

  if (target.deletedAt) {
    return { code: "TARGET_DELETED", message: "That account has been deleted." };
  }

  if (target.status !== "ACTIVE") {
    return {
      code: "TARGET_INACTIVE",
      message:
        `That account is ${target.status.toLowerCase()}. Acting as a suspended user would ` +
        `let the System do things it is currently refusing them.`,
    };
  }

  return null;
}

/**
 * Resources no impersonated session may write, whatever the target could.
 *
 * SEC-AUZ-013. The test is not "would the real user be allowed" — they would.
 * It is "does allowing this let the impersonator keep the account", and every
 * one of these does.
 */
const FORBIDDEN_WHILE_IMPERSONATING: ReadonlySet<string> = new Set([
  // Change the password and the owner is locked out, while the impersonation
  // marker disappears from everything that follows.
  "own_password",
  "other_user_password",
  // The profile carries the email address, which is where a password reset is
  // delivered — changing it routes recovery to the impersonator.
  "own_profile",
  // Signing OTHER people out. Disruptive rather than a takeover, but an
  // impersonated Admin could empty the whole Institute's sessions.
  "other_user_session",
  //
  // `own_session` is NOT here, and the omission is deliberate. Ending an
  // impersonation is itself an own_session:delete, so forbidding it would trap
  // the impersonator inside somebody else's identity until the token expired —
  // the exact trap this feature is supposed to avoid. Revoking one's own
  // sessions grants no persistence either: the danger is MINTING a session, and
  // that does not go through this resource.
  // Granting privileges while wearing somebody else's name.
  "role_assignment",
  "account_state",
  // Impersonating onward. Belt and braces: refuseImpersonation refuses it too.
  "impersonation",
]);

/**
 * May this action proceed in an impersonated session?
 *
 * Reads are never refused here — the whole purpose is to SEE what they see, and
 * a support session that cannot look at anything is useless.
 */
export function refuseWhileImpersonating(
  resource: string,
  action: string,
): { refused: boolean; message?: string } {
  if (action === "read" || action === "export") return { refused: false };
  if (!FORBIDDEN_WHILE_IMPERSONATING.has(resource)) return { refused: false };

  return {
    refused: true,
    message:
      "That cannot be done while acting as another user. Changing credentials or sessions from " +
      "an impersonated session would let it outlive itself — stop impersonating and do it as " +
      "yourself, where it is recorded against your name.",
  };
}

/** Exposed so the guard and its tests agree on one list. */
export const __testing = { FORBIDDEN_WHILE_IMPERSONATING };

/**
 * How long a session may last.
 *
 * Deliberately short and NOT configurable. An institute that could set this to
 * a week would, and an impersonation session that outlives the support call is
 * a spare key to somebody's account. Fifteen minutes answers "show me what you
 * see"; anything longer is a different activity.
 */
export const IMPERSONATION_TTL_MINUTES = 15;

/** A reason is required and must say something. FR-USR-031. */
export function refuseReason(reason: string): Refusal | null {
  const trimmed = reason.trim();
  if (trimmed.length < 10) {
    return {
      code: "REASON_TOO_SHORT",
      message:
        "Record why you are acting as this person. It is written to the audit log and read by " +
        "somebody deciding later whether it was reasonable.",
    };
  }
  return null;
}
