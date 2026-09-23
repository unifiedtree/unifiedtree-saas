import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { apiJson } from '@/core/api/client'

/**
 * `GET /v1/search?q=` — people results for the ⌘K palette (Milestone 4C).
 *
 * The server does the scoping: `hasAuthority('hrms.employee.read')` (the same
 * gate as the Workforce Directory) plus tenant RLS. Nothing here filters, and
 * nothing here fetches a list to filter — this hook only ever sends the query
 * the user typed and renders what comes back.
 */

/** Mirrors EmployeeSearchDtos.EmployeeSearchHit — six fields, nothing sensitive. */
export interface EmployeeSearchHit {
  id: string
  displayName: string
  employeeCode: string
  departmentName?: string | null
  jobTitle?: string | null
  profilePhotoUrl?: string | null
}

export interface EmployeeSearchResponse {
  employees: EmployeeSearchHit[]
  /** Effective (server-clamped) page size. */
  limit: number
  /** More matched than `limit`; ask the user to narrow, don't paginate. */
  truncated: boolean
}

/** Server rejects shorter queries with 400, so don't send them. */
export const EMPLOYEE_SEARCH_MIN_CHARS = 2
/** The directory's permission; the endpoint enforces the same code. */
export const EMPLOYEE_SEARCH_PERMISSION = 'hrms.employee.read'

export function normalizeEmployeeQuery(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ')
}

/**
 * @param query   raw (already debounced) palette text.
 * @param enabled false when the caller lacks the directory permission; the
 *                request would 403, so it is not sent. The server still
 *                decides — this only avoids a guaranteed error round-trip.
 */
export function useEmployeeSearch(query: string, enabled: boolean) {
  const q = normalizeEmployeeQuery(query)
  const active = enabled && q.length >= EMPLOYEE_SEARCH_MIN_CHARS
  return useQuery({
    // Case-folded key: the server matches case-insensitively, so "Anita" and
    // "anita" are the same request and share one cache entry.
    queryKey: ['search', 'employees', q.toLowerCase()],
    queryFn: () => apiJson<EmployeeSearchResponse>(`/v1/search?q=${encodeURIComponent(q)}`),
    enabled: active,
    staleTime: 60_000,
    // A typeahead that silently retries three times just delays the error
    // state; the user's next keystroke is the retry.
    retry: false,
    // Keep the last hits on screen while the next keystroke's request is in
    // flight, so the list doesn't blink empty between "ani" and "anit".
    placeholderData: keepPreviousData,
  })
}
