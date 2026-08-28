import type { ErrorDetail } from "@lms/shared";

/**
 * The API client — SRS §9.2.
 *
 * One place that understands the response envelope, so no screen ever reaches
 * into `response.data.data`. It also owns token refresh, because a 401 halfway
 * through a form submission must not lose the user's work.
 */

const BASE = "/api/v1";

/** Mirrors the server's error shape so screens can branch on `code`. */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: ErrorDetail[];
  /** NFR-ERR-003 — quote this to support; it correlates to the server log. */
  readonly reference?: string;

  constructor(
    status: number,
    body: { code?: string; message?: string; details?: ErrorDetail[]; reference?: string },
  ) {
    super(body.message ?? "Something went wrong.");
    this.name = "ApiError";
    this.status = status;
    this.code = body.code ?? "INTERNAL_ERROR";
    if (body.details) this.details = body.details;
    if (body.reference) this.reference = body.reference;
  }

  /** Convenience for forms: the message for one field, if any. */
  fieldError(field: string): string | undefined {
    return this.details?.find((d) => d.field === field)?.message;
  }
}

export interface Pagination {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  hasNext: boolean;
  hasPrevious: boolean;
}

/**
 * Token storage.
 *
 * The access token is held in memory only, so it dies with the tab and is
 * never readable from disk. The refresh token goes to localStorage, which is
 * a deliberate and documented trade-off: SEC-SES-002 would prefer an
 * httpOnly cookie, but the API returns tokens in the body, and moving to
 * cookies is a server change rather than a client one. The Content-Security-
 * Policy set in main.ts (SEC-VAL-005) disallows inline script, which is the
 * main mitigation until that change is made.
 */
const REFRESH_KEY = "lms.refresh";

let accessToken: string | null = null;
let onUnauthenticated: (() => void) | null = null;

export const tokens = {
  setAccess(token: string | null): void {
    accessToken = token;
  },
  getAccess(): string | null {
    return accessToken;
  },
  setRefresh(token: string | null): void {
    if (token) localStorage.setItem(REFRESH_KEY, token);
    else localStorage.removeItem(REFRESH_KEY);
  },
  getRefresh(): string | null {
    return localStorage.getItem(REFRESH_KEY);
  },
  clear(): void {
    accessToken = null;
    localStorage.removeItem(REFRESH_KEY);
  },
};

/** Called when refresh fails, so the app can route back to sign-in. */
export function setUnauthenticatedHandler(fn: () => void): void {
  onUnauthenticated = fn;
}

/**
 * A single in-flight refresh shared by every caller.
 *
 * Without this, five widgets loading in parallel each hit a 401 and each fire
 * their own refresh. The server rotates the token on first use, so the other
 * four then present a consumed token — which SEC-AUT-004 treats as theft and
 * invalidates the whole family, logging the user out for doing nothing wrong.
 */
let refreshInFlight: Promise<boolean> | null = null;

async function refreshAccessToken(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    const refreshToken = tokens.getRefresh();
    if (!refreshToken) return false;

    try {
      const res = await fetch(`${BASE}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) {
        tokens.clear();
        return false;
      }
      const body = (await res.json()) as { data: { accessToken: string; refreshToken: string } };
      tokens.setAccess(body.data.accessToken);
      tokens.setRefresh(body.data.refreshToken);
      return true;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  /** Internal: prevents an infinite refresh loop. */
  _retried?: boolean;
  /**
   * Internal: return the whole §9.2 envelope rather than just `data`.
   *
   * Only `list()` wants this, because pagination lives beside the rows rather
   * than inside them. It exists so that list() does not need its own fetch —
   * it had one, and that copy had no token refresh, so every PAGINATED screen
   * in the app failed on an expired access token while every other screen
   * recovered silently. Two code paths, one of them missing a feature.
   */
  _envelope?: boolean;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  // FormData carries its own multipart boundary, which only the browser can
  // generate. Setting Content-Type ourselves would omit it and the server would
  // fail to parse a body that is otherwise perfectly well formed.
  const isForm = options.body instanceof FormData;

  const headers: Record<string, string> = isForm ? {} : { "Content-Type": "application/json" };
  if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`;

  /*
   * NOTHING WAITS FOR EVER.
   *
   * `fetch` has no timeout of its own: a request the server never answers
   * leaves the promise pending until the tab is closed. There was no timeout
   * anywhere in this client, so a slow endpoint did not fail — it simply left
   * a disabled button reading "Loading…" with nothing to press and nothing to
   * read, which is indistinguishable from the application being broken.
   *
   * A minute is deliberately generous. Every ordinary call here answers in
   * well under a second; the ones that take real time are uploads and the
   * cohort import, and both are bounded on the server. This is the backstop
   * for the case where the answer is never coming at all.
   */
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: options.method ?? "GET",
      headers,
      signal: AbortSignal.timeout(60_000),
      ...(options.body !== undefined
        ? { body: isForm ? (options.body as FormData) : JSON.stringify(options.body) }
        : {}),
    });
  } catch (e) {
    /*
     * SAID AS TWO DIFFERENT THINGS, because they need different responses. A
     * timeout may well have been acted on at the far end — telling somebody to
     * "try again" after an import that actually ran is how a cohort gets
     * loaded twice — whereas an unreachable server certainly did nothing.
     */
    const timedOut = e instanceof DOMException && e.name === "TimeoutError";
    throw new ApiError(0, {
      code: timedOut ? "TIMEOUT" : "NETWORK_ERROR",
      message: timedOut
        ? "The server has not answered in a minute. It may still be working — reload this page " +
          "and check before doing it again."
        : "The server could not be reached. Check your connection and try again.",
    });
  }

  if (res.status === 204) return undefined as T;

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new ApiError(res.status, {
      code: "INTERNAL_ERROR",
      message: "The server sent a response we could not read.",
    });
  }

  if (!res.ok) {
    const err = (body as { error?: Record<string, unknown> }).error ?? {};

    /*
     * A 401 WITH A REFRESH TOKEN IN HAND IS ROUTINE, not a failure. Refresh
     * once and replay the request, so the user never notices.
     *
     * THIS USED TO REQUIRE `AUTH_TOKEN_EXPIRED`, AND THAT BROKE EVERY RELOAD.
     * The access token lives in memory only — deliberately, so it dies with
     * the tab and is never readable from disk. So the FIRST request after any
     * page load carries no Authorization header at all, and the server answers
     * `AUTH_TOKEN_INVALID` rather than `AUTH_TOKEN_EXPIRED`: there was no token
     * to expire. The refresh branch therefore never fired, AuthContext's
     * catch ran `clear()`, and the stored refresh token was destroyed.
     *
     * The effect was that a page reload always signed the user out, and the
     * whole refresh-token mechanism — the rotation, the 30-day lifetime, the
     * session that is supposed to survive a reload — had never once worked.
     * It looked like a session timing out, which is why it read as normal.
     *
     * The condition that matters is not which 401 it is: it is whether there
     * is a refresh token to try. `refreshAccessToken()` returns false when
     * there is none or when the server rejects it, and the sign-out below
     * still happens then.
     */
    if (res.status === 401 && !options._retried && tokens.getRefresh()) {
      if (await refreshAccessToken()) {
        return request<T>(path, { ...options, _retried: true });
      }
      onUnauthenticated?.();
    } else if (res.status === 401) {
      // No refresh token, or the replay was refused as well. Either way this
      // session is over.
      onUnauthenticated?.();
    }

    throw new ApiError(res.status, err as ConstructorParameters<typeof ApiError>[1]);
  }

  // §9.2 — every success is wrapped. Screens receive the payload itself.
  if (options._envelope) return body as T;
  return (body as { data: T }).data;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: "POST", body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: "PATCH", body }),
  /** For resources with ONE value, where PATCH would imply a partial one. */
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: "PUT", body }),
  /**
   * A body is optional and unusual, but legal, and one route needs it: erasing
   * personal data requires a written reason, and the act is a DELETE.
   */
  del: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "DELETE", ...(body !== undefined ? { body } : {}) }),

  /**
   * Multipart upload. Goes through the same path as everything else, so it
   * inherits token refresh — a 401 halfway through a large upload retries
   * instead of losing the file.
   */
  upload: <T>(path: string, form: FormData) =>
    request<T>(path, { method: "POST", body: form }),

  /**
   * Bytes, not JSON.
   *
   * A file the System holds is fetched on an AUTHENTICATED request and handed
   * to the browser as a blob, never linked. The storage location never reaches
   * the client (ARC-041), and a URL a student could forward would be one that
   * outlives their enrolment.
   *
   * It does not share request(), which parses JSON and unwraps the §9.2
   * envelope — neither of which applies to a PDF. The cost is that it repeats
   * the Authorization header and the 401 handling, which is why it stays short.
   */
  async download(path: string): Promise<Blob> {
    const headers: Record<string, string> = {};
    if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`;

    let res = await fetch(`${BASE}${path}`, { headers });
    if (res.status === 401 && (await refreshAccessToken())) {
      const retry: Record<string, string> = {};
      if (accessToken) retry["Authorization"] = `Bearer ${accessToken}`;
      res = await fetch(`${BASE}${path}`, { headers: retry });
    }

    if (!res.ok) {
      // An error body IS json, even when the success body is not.
      const body = (await res.json().catch(() => ({}))) as { error?: Record<string, unknown> };
      throw new ApiError(res.status, (body.error ?? {}) as ConstructorParameters<typeof ApiError>[1]);
    }
    return res.blob();
  },

  /**
   * Collections carry pagination alongside the rows.
   *
   * Goes through request() like everything else, so it inherits token refresh:
   * a list opened after the access token expired now reloads itself instead of
   * showing an error.
   */
  async list<T>(path: string): Promise<{ data: T[]; pagination?: Pagination }> {
    const body =
      (await request<{ data?: T[]; pagination?: Pagination } | undefined>(path, {
        _envelope: true,
      })) ?? {};
    const result: { data: T[]; pagination?: Pagination } = { data: body.data ?? [] };
    if (body.pagination) result.pagination = body.pagination;
    return result;
  },
};
