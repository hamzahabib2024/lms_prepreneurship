/**
 * API error codes — SRS Appendix C.
 *
 * Codes are stable and machine-readable; messages are human-facing and safe to
 * display. NFR-ERR-002: no stack trace, SQL, file path, framework name, or
 * internal identifier ever appears in an error response.
 */

export const ERROR_CODES = {
  // --- authentication ---
  AUTH_INVALID_CREDENTIALS: { status: 401, message: "The email address or password is incorrect." },
  AUTH_TOKEN_EXPIRED: { status: 401, message: "Your session has expired. Please sign in again." },
  AUTH_TOKEN_INVALID: { status: 401, message: "Your session is no longer valid. Please sign in again." },
  AUTH_REFRESH_REUSED: {
    status: 401,
    message: "Your session was ended for security reasons. Please sign in again.",
  },
  AUTH_MFA_REQUIRED: { status: 200, message: "A verification code is required." },
  AUTH_MFA_INVALID: { status: 401, message: "That verification code is not correct." },
  AUTH_ACCOUNT_LOCKED: {
    status: 423,
    message: "This account is temporarily locked. Try again shortly, or reset your password.",
  },
  AUTH_ACCOUNT_SUSPENDED: { status: 403, message: "This account is currently suspended." },
  AUTH_PASSWORD_CHANGE_REQUIRED: { status: 403, message: "You must set a new password to continue." },
  AUTH_STEP_UP_REQUIRED: {
    status: 403,
    message: "Please confirm your password to continue with this action.",
  },
  AUTH_FORBIDDEN: { status: 403, message: "You do not have permission to do that." },

  // --- validation and state ---
  VALIDATION_FAILED: { status: 422, message: "The submitted data could not be accepted." },
  RESOURCE_NOT_FOUND: { status: 404, message: "That record could not be found." },
  RESOURCE_CONFLICT: { status: 409, message: "That action conflicts with the current state." },
  CONFLICT_STALE_VERSION: {
    status: 409,
    message: "This record changed while you were editing. Reload and try again.",
  },
  DUPLICATE_RESOURCE: { status: 409, message: "A record with that value already exists." },

  // --- domain-specific ---
  SECTION_AT_CAPACITY: { status: 409, message: "That section is full." },
  SECTION_GENDER_RESTRICTED: { status: 422, message: "That section admits one gender only." },
  REGISTRATION_ALREADY_CLAIMED: {
    status: 409,
    message: "Another administrator is reviewing this application.",
  },
  SUBMISSION_WINDOW_CLOSED: { status: 422, message: "The submission window has closed." },
  QUIZ_ATTEMPTS_EXHAUSTED: { status: 409, message: "You have used all attempts for this quiz." },
  QUIZ_ATTEMPT_EXPIRED: { status: 409, message: "The time limit for this attempt has expired." },

  // --- files ---
  FILE_TOO_LARGE: { status: 413, message: "That file is larger than the maximum allowed." },
  FILE_TYPE_NOT_ALLOWED: { status: 415, message: "That file type is not permitted." },
  FILE_SCAN_FAILED: { status: 422, message: "That file could not be accepted." },

  // --- infrastructure ---
  STORAGE_UNAVAILABLE: {
    status: 503,
    message: "This content is temporarily unavailable. Please try again shortly.",
  },
  PROVIDER_UNAVAILABLE: { status: 503, message: "That service is temporarily unavailable." },
  RATE_LIMIT_EXCEEDED: { status: 429, message: "Too many requests. Please wait a moment." },
  MAINTENANCE_MODE: { status: 503, message: "The system is undergoing scheduled maintenance." },
  INTERNAL_ERROR: { status: 500, message: "Something went wrong at our end." },
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export interface ErrorDetail {
  field: string;
  code: string;
  message: string;
}

/**
 * Thrown anywhere in the API; converted to the §9.2 envelope by the global
 * exception filter. Carrying the code rather than the status keeps call sites
 * declarative.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: ErrorDetail[];
  /** Never serialised to the client — for the server log only. */
  readonly internal?: unknown;

  constructor(
    code: ErrorCode,
    options?: { message?: string; details?: ErrorDetail[]; internal?: unknown },
  ) {
    const spec = ERROR_CODES[code];
    super(options?.message ?? spec.message);
    this.name = "AppError";
    this.code = code;
    this.status = spec.status;
    this.details = options?.details;
    this.internal = options?.internal;
  }
}
