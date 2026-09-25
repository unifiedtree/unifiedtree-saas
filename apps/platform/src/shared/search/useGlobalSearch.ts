import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { apiJson } from '@/core/api/client'

/**
 * `GET /v1/search/global?q=` — people and records for the top bar's search.
 *
 * The server decides what each person may find, type by type (an employee gets
 * their own leave, payslips and documents; HR gets everyone's). This hook only
 * sends what was typed and renders what comes back.
 */

/** Mirrors GlobalSearchDtos.SearchHit. */
export interface GlobalSearchHit {
  type: string
  id: string
  title: string
  subtitle?: string | null
  /** In-app page that opens it, with that page's search filled in where it has one. */
  url: string
  badge?: string | null
}

export interface GlobalSearchGroup { type: string; label: string; items: GlobalSearchHit[] }

export interface GlobalSearchResponse {
  query: string
  groups: GlobalSearchGroup[]
  /** Types this person may search that failed this time. */
  unavailable: string[]
}

/** The server rejects shorter queries with 400, so they are not sent. */
export const GLOBAL_SEARCH_MIN_CHARS = 2

export function normalizeGlobalQuery(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ')
}

export function useGlobalSearch(query: string) {
  const q = normalizeGlobalQuery(query)
  return useQuery({
    queryKey: ['search', 'global', q.toLowerCase()],
    queryFn: () => apiJson<GlobalSearchResponse>(`/v1/search/global?q=${encodeURIComponent(q)}`),
    enabled: q.length >= GLOBAL_SEARCH_MIN_CHARS,
    staleTime: 30_000,
    // The next keystroke is the retry; retrying a typeahead only delays its error state.
    retry: false,
    placeholderData: keepPreviousData,
  })
}
