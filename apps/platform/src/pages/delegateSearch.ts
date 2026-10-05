import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { apiJson } from '@/core/api/client'
import { httpStatusOf, isFeatureNotReady } from '@/core/api/featureNotReady'
import {
  EMPLOYEE_SEARCH_LIMIT,
  EMPLOYEE_SEARCH_MIN_CHARS,
  normalizeEmployeeQuery,
  type EmployeeSearchResponse,
} from '@/shared/search/useEmployeeSearch'

/**
 * Finding the colleague to delegate approvals to.
 *
 * GET /v1/approvals/delegation/candidates?q=&limit= is open to everyone who may
 * set a delegation (isAuthenticated, as POST /v1/me/delegation), so a manager
 * without hrms.employee.read can pick someone. It lists current colleagues with
 * a login, not the caller, in this workspace only, with the same six fields as
 * the directory search (EmployeeSearchDtos.EmployeeSearchHit).
 *
 * Until that endpoint is deployed (404), or where the workspace has no HRMS
 * module (403 from the module guard), the picker falls back to the directory
 * search (/v1/search, hrms.employee.read), so people who could search before
 * still can.
 */
export const DELEGATE_CANDIDATES_PATH = '/v1/approvals/delegation/candidates'
/** How many people the picker lists (the server allows up to 20). */
export const DELEGATE_CANDIDATE_LIMIT = 10
export const DELEGATE_SEARCH_MIN_CHARS = EMPLOYEE_SEARCH_MIN_CHARS

export type DelegateSearchSource = 'candidates' | 'directory'

export interface DelegateSearchResult extends EmployeeSearchResponse {
  /** Which endpoint answered: the delegation picker's own, or the directory search. */
  source: DelegateSearchSource
}

type Fetch = <T>(path: string, init?: RequestInit) => Promise<T>

/** The candidates endpoint isn't there for this server or workspace: 404/405 (not deployed), 403 (no HRMS module), 503 FEATURE_NOT_READY. */
export function fallsBackToDirectory(error: unknown): boolean {
  const status = httpStatusOf(error)
  return status === 404 || status === 405 || status === 403 || isFeatureNotReady(error)
}

/** Remembered for the page's life once the server has no candidates endpoint, so each keystroke makes one request. */
let candidatesMissing = false

/** For tests: forget that the endpoint was missing. */
export function resetDelegateSearch() {
  candidatesMissing = false
}

/**
 * Search with the delegation picker's endpoint, else the directory search.
 * Errors from the endpoint that answered are thrown as they are (a 403 from the
 * directory search means "you can't look up colleagues").
 */
export async function searchDelegates(raw: string, api: Fetch = apiJson): Promise<DelegateSearchResult> {
  const q = encodeURIComponent(normalizeEmployeeQuery(raw))
  if (!candidatesMissing) {
    try {
      const r = await api<EmployeeSearchResponse>(`${DELEGATE_CANDIDATES_PATH}?q=${q}&limit=${DELEGATE_CANDIDATE_LIMIT}`)
      return { ...r, source: 'candidates' }
    } catch (error) {
      if (!fallsBackToDirectory(error)) throw error
      // Not deployed: true for the whole server. A 403 is this workspace's (no HRMS
      // module) and someone may switch workspaces, so it is asked again next time.
      const status = httpStatusOf(error)
      if (status === 404 || status === 405) candidatesMissing = true
    }
  }
  const r = await api<EmployeeSearchResponse>(`/v1/search?q=${q}&limit=${EMPLOYEE_SEARCH_LIMIT}`)
  return { ...r, source: 'directory' }
}

/** @param query the picker's text; nothing is sent under two characters. */
export function useDelegateSearch(query: string, enabled = true) {
  const q = normalizeEmployeeQuery(query)
  return useQuery({
    // Case-folded: the server matches case-insensitively. Not under ['me', 'delegation'],
    // which saving or removing a delegation invalidates.
    queryKey: ['delegation-candidates', q.toLowerCase()],
    queryFn: () => searchDelegates(q),
    enabled: enabled && q.length >= DELEGATE_SEARCH_MIN_CHARS,
    staleTime: 60_000,
    // A typeahead: the next keystroke is the retry.
    retry: false,
    // Keep the last hits on screen while the next keystroke's request is in flight.
    placeholderData: keepPreviousData,
  })
}
