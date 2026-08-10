/**
 * Maintenance mode — SRS §5.23, FR-OPS-010..014.
 *
 * The Institute takes the System off the air to do something to it, and
 * everybody else is told so rather than meeting errors.
 *
 * THE ONLY WAY TO GET THIS WRONG IS TO LOCK OUT THE PERSON WHO CAN TURN IT
 * OFF, and it is easy to do: a guard that refuses every request when
 * maintenance is on refuses the request that would end it. Then the remedy is a
 * database edit at three in the morning.
 *
 * So two exemptions, and the rules are here, pure and tested, because getting
 * either wrong is unrecoverable from inside the application:
 *
 *   A SUPER ADMIN IS NEVER REFUSED. They are the ones doing the maintenance;
 *   they need to see whether it worked.
 *
 *   A SHORT LIST OF PATHS IS NEVER REFUSED, whoever asks. Signing in, above
 *   all — a Super Admin whose token expired during the work must be able to get
 *   a new one, and refusing /auth/login refuses exactly that.
 *
 * Everyone else gets 503 with a sentence and, if one was given, when it is
 * expected to end. NOT a generic error: somebody who cannot submit their
 * assignment needs to know whether to wait ten minutes or ring somebody.
 */

/**
 * Paths that work regardless.
 *
 * Prefix matches, checked against the path after the API version. Kept
 * deliberately short: every entry is a hole in the maintenance window, so each
 * one is here because the System is unrecoverable without it.
 */
const ALWAYS_AVAILABLE: ReadonlyArray<{ path: string; why: string }> = [
  {
    path: "/auth/login",
    why: "A Super Admin whose token expired mid-maintenance must be able to sign in and turn it off.",
  },
  {
    path: "/auth/refresh",
    why: "Same reason, for a session that merely needs renewing.",
  },
  {
    path: "/auth/logout",
    why: "Ending a session is never worth refusing, and refusing it strands people signed in.",
  },
  {
    path: "/maintenance",
    why: "Reading the notice, and turning it off. Refusing this is the trap.",
  },
  {
    path: "/health",
    why: "A load balancer that cannot health-check takes the System out of rotation entirely.",
  },
];

export interface MaintenanceState {
  enabled: boolean;
  message: string;
  expectedEndAt: Date | null;
}

export interface MaintenanceRequest {
  path: string;
  roles: readonly string[];
}

export interface MaintenanceRefusal {
  refused: boolean;
  message?: string;
  expectedEndAt?: Date | null;
}

export function refuseForMaintenance(
  state: MaintenanceState,
  request: MaintenanceRequest,
): MaintenanceRefusal {
  if (!state.enabled) return { refused: false };

  // The people doing the work. Refusing them would mean turning maintenance on
  // and then being unable to check whether the thing being fixed is fixed.
  if (request.roles.includes("super_admin")) return { refused: false };

  const path = normalise(request.path);
  if (ALWAYS_AVAILABLE.some((entry) => path.startsWith(entry.path))) {
    return { refused: false };
  }

  return {
    refused: true,
    message: state.message,
    expectedEndAt: state.expectedEndAt,
  };
}

/**
 * Strip the version prefix so the list is written once.
 *
 * Requests arrive as /api/v1/auth/login; the exemptions are about the route,
 * not about how it is mounted.
 */
function normalise(path: string): string {
  const withoutQuery = path.split("?")[0] ?? path;
  return withoutQuery.replace(/^\/api\/v\d+/, "");
}

/** Exposed so the tests and any future documentation share one list. */
export const __testing = { ALWAYS_AVAILABLE, normalise };

/**
 * A sentence for somebody who cannot do what they came to do.
 *
 * "Service unavailable" tells a student nothing. Whether to wait or to give up
 * for the evening is the actual question, and only the expected end answers it.
 */
export function noticeFor(state: MaintenanceState): string {
  if (!state.expectedEndAt) return state.message;
  return `${state.message} Expected back at ${state.expectedEndAt.toISOString()}.`;
}
