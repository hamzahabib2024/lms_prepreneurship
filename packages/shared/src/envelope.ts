/**
 * The standard response envelope — SRS §9.2, Figure 9-1.
 *
 * A client must be able to determine success or failure from the HTTP status
 * and the presence of `error` alone. §9.2.2 prohibits returning an error object
 * inside a 200 response.
 */

import type { ErrorDetail } from "./errors";

export interface ResponseMeta {
  requestId: string;
  timestamp: string;
  /** §9.2 — echoes the filters actually applied, including those imposed by scope. */
  appliedFilters?: Record<string, unknown>;
}

export interface SuccessResponse<T> {
  data: T;
  meta: ResponseMeta;
}

export interface Pagination {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  hasNext: boolean;
  hasPrevious: boolean;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: Pagination;
  meta: ResponseMeta;
}

export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: ErrorDetail[];
    /** NFR-ERR-003 — correlates to the server log so support can find the cause. */
    reference: string;
  };
  meta: ResponseMeta;
}

// ------------------------------------------------------- query contract ----

/** §9.2.1. pageSize is clamped to MAX_PAGE_SIZE rather than rejected. */
export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

export interface PageQuery {
  page?: number;
  pageSize?: number;
  sort?: string;
  q?: string;
}

export function clampPageSize(requested?: number): number {
  if (!requested || requested < 1) return DEFAULT_PAGE_SIZE;
  return Math.min(requested, MAX_PAGE_SIZE);
}

export function buildPagination(page: number, pageSize: number, totalItems: number): Pagination {
  const totalPages = pageSize > 0 ? Math.ceil(totalItems / pageSize) : 0;
  return {
    page,
    pageSize,
    totalItems,
    totalPages,
    hasNext: page < totalPages,
    hasPrevious: page > 1,
  };
}

/**
 * Parses `?sort=-createdAt,fullName` into Prisma orderBy input.
 * An unknown field is rejected rather than silently ignored (§9.2.1).
 */
export function parseSort(
  sort: string | undefined,
  allowed: readonly string[],
): Array<Record<string, "asc" | "desc">> {
  if (!sort) return [];
  const out: Array<Record<string, "asc" | "desc">> = [];
  for (const raw of sort.split(",")) {
    const token = raw.trim();
    if (!token) continue;
    const desc = token.startsWith("-");
    const field = desc ? token.slice(1) : token;
    if (!allowed.includes(field)) {
      throw new Error(`Unsupported sort field: ${field}`);
    }
    out.push({ [field]: desc ? "desc" : "asc" });
  }
  return out;
}
