// The company switch "Allow web check-in" (off by default).
//
// Contract C0 · BW-24 · owner P-ATT-DAY (migration V143_53:
// settings.hr_configuration.allow_web_punch, JDBC only, default false)
//   GET /v1/attendance/web-punch-setting?companyId=   → WebPunchSetting
//       Permission: anyone signed in.
//   PUT /v1/attendance/web-punch-setting?companyId=  { allowWebPunch }   → WebPunchSetting
//       Permission: settings.hrconfig.write or attendance.policy.manage.
//   While it is off (or the column is missing) the punch API refuses WEB
//   (WEB_PUNCH_NOT_ALLOWED) and "Your day" is read-only, with no Check in/out.
//   Not available: 404 until P-ATT-DAY ships it; 503 FEATURE_NOT_READY while the
//   column is missing. Treat not available as off; hide the toggle.
// Used by: P-SETUP (the toggle in HR configuration › Attendance rules),
//   P-HOME ("Your day" on Home).
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { SHARED_KEYS, type SaveWebPunchSettingRequest, type WebPunchSetting } from './contracts'
import {
  asAvailable, defaultApi, useAvailableMutation, useAvailableQuery,
  type ApiFetch, type Availability, type SharedMutationOptions, type SharedQueryOptions,
} from './available'

export const WEB_PUNCH_SETTING_PATH = '/v1/attendance/web-punch-setting'

export function webPunchSettingQuery(companyId: string, api: ApiFetch = defaultApi): SharedQueryOptions<WebPunchSetting> {
  const qs = new URLSearchParams({ companyId })
  return {
    queryKey: [...SHARED_KEYS.webPunchSetting, companyId],
    queryFn: () => asAvailable(() => api<WebPunchSetting>(`${WEB_PUNCH_SETTING_PATH}?${qs}`)),
  }
}

export function useWebPunchSetting(companyId: string | undefined, opts?: { enabled?: boolean }) {
  return useAvailableQuery<WebPunchSetting>({
    ...webPunchSettingQuery(companyId ?? ''),
    enabled: (opts?.enabled ?? true) && !!companyId,
  })
}

/** True only when the company has switched web check-in on (off while loading, on error and when not available). */
export function webPunchAllowed(setting: { data: WebPunchSetting | undefined }): boolean {
  return setting.data?.allowWebPunch === true
}

export function saveWebPunchSettingMutation(
  qc: QueryClient,
  companyId: string,
  api: ApiFetch = defaultApi,
): SharedMutationOptions<WebPunchSetting, SaveWebPunchSettingRequest> {
  const qs = new URLSearchParams({ companyId })
  const queryKey = [...SHARED_KEYS.webPunchSetting, companyId]
  return {
    mutationFn: (body) =>
      asAvailable(() => api<WebPunchSetting>(`${WEB_PUNCH_SETTING_PATH}?${qs}`, { method: 'PUT', body: JSON.stringify(body) })),
    onSuccess: (result) => {
      if (!result.available) return qc.invalidateQueries({ queryKey })
      qc.setQueryData<Availability<WebPunchSetting>>(queryKey, result)
      // "Your day" reads the switch too (P-ATT-DAY's attendance keys).
      return qc.invalidateQueries({ queryKey: SHARED_KEYS.attendance })
    },
  }
}

export function useSaveWebPunchSetting(companyId: string) {
  const qc = useQueryClient()
  return useAvailableMutation(saveWebPunchSettingMutation(qc, companyId))
}
