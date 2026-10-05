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
 * GET /v1/approvals/delegation/candidates?q=&limit= is for approvers: anyone
 * holding one of DELEGATE_APPROVER_PERMISSIONS (403 for everyone else), so a
 * manager without hrms.employee.read can pick someone. It lists current
 * colleagues with a login, not the caller, in this workspace only, with the same
 * six fields as the directory search (EmployeeSearchDtos.EmployeeSearchHit).
 *
 * Who searches what (delegateSearchVia): an approver uses that endpoint; someone
 * who approves nothing but holds hrms.employee.read keeps the directory search
 * (/v1/search) as before; anyone else gets no search box. Until the endpoint is
 * deployed (404/405, 503 not ready) an approver falls back to the directory
 * search. A 403 never falls back.
 */
export const DELEGATE_CANDIDATES_PATH = '/v1/approvals/delegation/candidates'
/** How many people the picker lists (the server allows up to 20). */
export const DELEGATE_CANDIDATE_LIMIT = 10
export const DELEGATE_SEARCH_MIN_CHARS = EMPLOYEE_SEARCH_MIN_CHARS

/**
 * The approval permissions, as DelegationCandidatesController.APPROVER_PERMISSIONS
 * (the codes that guard the approve / decide endpoints): holding any one makes
 * someone an approver, who may look colleagues up to choose a delegate.
 */
export const DELEGATE_APPROVER_PERMISSIONS = [
  'hrms.leave.approve.l1',
  'hrms.leave.approve.l2',
  'hrms.leave.encash.approve',
  'wfh.approve',
  'attendance.regularization.approve',
  'attendance.overtime.approve',
  'hrms.expense.claim.approve',
  'hrms.advance.approve',
  'hrms.timesheet.approve',
  'hrms.probation.team.decide',
  'hrms.fnf.approve',
  'hrms.learning.skill.approve',
]

export type DelegateSearchSource = 'candidates' | 'directory'

/** Which search the picker uses for this person; null: no search box. */
export function delegateSearchVia(approver: boolean, canReadDirectory: boolean): DelegateSearchSource | null {
  if (approver) return 'candidates'
  return canReadDirectory ? 'directory' : null
}

export interface DelegateSearchResult extends EmployeeSearchResponse {
  /** Which endpoint answered: the delegation picker's own, or the directory search. */
  source: DelegateSearchSource
}

type Fetch = <T>(path: string, init?: RequestInit) => Promise<T>

/** The candidates endpoint isn't on this server: 404/405 (not deployed) or 503 FEATURE_NOT_READY. Never a 403. */
export function fallsBackToDirectory(error: unknown): boolean {
  const status = httpStatusOf(error)
  return status === 404 || status === 405 || isFeatureNotReady(error)
}

/** Remembered for the page's life once the server has no candidates endpoint, so each keystroke makes one request. */
let candidatesMissing = false

/** For tests: forget that the endpoint was missing. */
export function resetDelegateSearch() {
  candidatesMissing = false
}

/**
 * Search the way `via` says: the delegation picker's endpoint (falling back to the
 * directory search where it isn't deployed), or the directory search. Errors from
 * the endpoint that answered are thrown as they are.
 */
export async function searchDelegates(raw: string, via: DelegateSearchSource, api: Fetch = apiJson): Promise<DelegateSearchResult> {
  const q = encodeURIComponent(normalizeEmployeeQuery(raw))
  if (via === 'candidates' && !candidatesMissing) {
    try {
      const r = await api<EmployeeSearchResponse>(`${DELEGATE_CANDIDATES_PATH}?q=${q}&limit=${DELEGATE_CANDIDATE_LIMIT}`)
      return { ...r, source: 'candidates' }
    } catch (error) {
      if (!fallsBackToDirectory(error)) throw error
      // Not deployed is true for the whole server; "not ready" may change, so it is asked again.
      if (!isFeatureNotReady(error)) candidatesMissing = true
    }
  }
  const r = await api<EmployeeSearchResponse>(`/v1/search?q=${q}&limit=${EMPLOYEE_SEARCH_LIMIT}`)
  return { ...r, source: 'directory' }
}

/**
 * @param query the picker's text; nothing is sent under two characters.
 * @param via   delegateSearchVia's answer; null sends nothing.
 */
export function useDelegateSearch(query: string, via: DelegateSearchSource | null) {
  const q = normalizeEmployeeQuery(query)
  return useQuery({
    // Case-folded: the server matches case-insensitively. Not under ['me', 'delegation'],
    // which saving or removing a delegation invalidates.
    queryKey: ['delegation-candidates', via, q.toLowerCase()],
    queryFn: () => searchDelegates(q, via ?? 'directory'),
    enabled: via !== null && q.length >= DELEGATE_SEARCH_MIN_CHARS,
    staleTime: 60_000,
    // A typeahead: the next keystroke is the retry.
    retry: false,
    // Keep the last hits on screen while the next keystroke's request is in flight.
    placeholderData: keepPreviousData,
  })
}
