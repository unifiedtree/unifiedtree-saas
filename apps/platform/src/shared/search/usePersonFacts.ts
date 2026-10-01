import { useQuery } from '@tanstack/react-query'
import { apiJson } from '@/core/api/client'
import { notAvailableReason } from '@/modules/hrms/api/shared/available'

/**
 * `GET /v1/search/people/facts?ids=` — the ⌘K preview's facts about the people a search found
 * (redesign BW-02): branch, who they report to, when they joined, employment status. The same gate
 * and visibility as `GET /v1/search` (`hrms.employee.read`), at most 20 ids.
 *
 * Until the server has it (404) or its feature is off (FEATURE_NOT_READY) the facts are simply not
 * there: no error, no retry, and the preview shows what the search itself returned.
 */
export interface PersonFacts {
  id: string
  branchName?: string | null
  managerName?: string | null
  dateOfJoining?: string | null
  employmentStatus?: string | null
}

export const PERSON_FACTS_MAX = 20

export function usePersonFacts(ids: readonly string[], enabled: boolean) {
  const wanted = [...new Set(ids)].slice(0, PERSON_FACTS_MAX).sort()
  return useQuery({
    queryKey: ['search', 'people', 'facts', wanted.join(',')],
    queryFn: async (): Promise<Map<string, PersonFacts>> => {
      try {
        const rows = await apiJson<PersonFacts[]>(`/v1/search/people/facts?ids=${wanted.map(encodeURIComponent).join(',')}`)
        return new Map((rows ?? []).map((r) => [r.id, r]))
      } catch (e) {
        if (notAvailableReason(e)) return new Map()
        throw e
      }
    },
    enabled: enabled && wanted.length > 0,
    staleTime: 5 * 60_000,
    retry: false,
  })
}
