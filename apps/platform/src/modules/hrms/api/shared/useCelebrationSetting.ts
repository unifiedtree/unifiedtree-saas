// "Show birthdays to colleagues" (owner, 5 Oct 2026; migration V143_89: settings.celebration_settings,
// JDBC only). One switch per company, in HR configuration → Celebrations. On by default.
//   GET /v1/settings/celebrations?companyId=                       → CelebrationSetting
//       Permission: whoever can read HR configuration (settings.read, settings.hrconfig.write,
//       hrms.employee.write or attendance.policy.manage).
//   PUT /v1/settings/celebrations?companyId=  { showBirthdays }    → CelebrationSetting
//       Permission: settings.hrconfig.write.
//   Off: nobody in that company sees colleagues' birthdays on Celebrations (Home's card and the
//   page) or on Home's Upcoming events, and nobody can send birthday wishes; work anniversaries and
//   new joiners still show. The server applies it; nothing else reads this.
//   Not available: 503 FEATURE_NOT_READY while the table is missing (birthdays show, as today);
//   404 on a server without it. Treat not available as "not switched on yet".
// Used by: the Celebrations section of HR configuration (settings/HrConfigurationPage).
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import {
  asAvailable, defaultApi, useAvailableMutation, useAvailableQuery,
  type ApiFetch, type Availability, type SharedMutationOptions, type SharedQueryOptions,
} from './available'

export const CELEBRATION_SETTING_PATH = '/v1/settings/celebrations'
export const CELEBRATION_SETTING_KEY = ['settings', 'celebrations'] as const

export interface CelebrationSetting {
  companyId: string
  /** Colleagues see each other's birthdays (never the year). On by default. */
  showBirthdays: boolean
  updatedByName: string | null
  updatedAt: string | null
}

export function celebrationSettingQuery(companyId: string, api: ApiFetch = defaultApi): SharedQueryOptions<CelebrationSetting> {
  const qs = new URLSearchParams({ companyId })
  return {
    queryKey: [...CELEBRATION_SETTING_KEY, companyId],
    queryFn: () => asAvailable(() => api<CelebrationSetting>(`${CELEBRATION_SETTING_PATH}?${qs}`)),
  }
}

export function useCelebrationSetting(companyId: string | undefined, opts?: { enabled?: boolean }) {
  return useAvailableQuery<CelebrationSetting>({
    ...celebrationSettingQuery(companyId ?? ''),
    enabled: (opts?.enabled ?? true) && !!companyId,
  })
}

export function saveCelebrationSettingMutation(
  qc: QueryClient,
  companyId: string,
  api: ApiFetch = defaultApi,
): SharedMutationOptions<CelebrationSetting, { showBirthdays: boolean }> {
  const qs = new URLSearchParams({ companyId })
  const queryKey = [...CELEBRATION_SETTING_KEY, companyId]
  return {
    mutationFn: (body) =>
      asAvailable(() => api<CelebrationSetting>(`${CELEBRATION_SETTING_PATH}?${qs}`, { method: 'PUT', body: JSON.stringify(body) })),
    onSuccess: (result) => {
      if (!result.available) return qc.invalidateQueries({ queryKey })
      qc.setQueryData<Availability<CelebrationSetting>>(queryKey, result)
      // Everyone's Celebrations and Upcoming events change with it.
      return qc.invalidateQueries({ queryKey: ['ess'] })
    },
  }
}

export function useSaveCelebrationSetting(companyId: string) {
  const qc = useQueryClient()
  return useAvailableMutation(saveCelebrationSettingMutation(qc, companyId))
}
