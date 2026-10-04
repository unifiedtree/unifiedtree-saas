// Who is told when someone punches in (punch-in alerts, owner request 4 Oct; migration V143_72:
// attendance.punch_alert_settings, JDBC only). One setting per company, in HR configuration next
// to the other attendance rules.
//   GET /v1/attendance/punch-alert-setting?companyId=           → PunchAlertSetting
//       Permission: settings.hrconfig.write, attendance.policy.manage or settings.read.
//   PUT /v1/attendance/punch-alert-setting?companyId=  SavePunchAlertSettingRequest → PunchAlertSetting
//       Permission: settings.hrconfig.write or attendance.policy.manage.
//   GET /v1/attendance/punch-alert-setting/options?companyId=   → PunchAlertOptions (what can be picked)
//       Permission: settings.hrconfig.write or attendance.policy.manage.
//   No row = the defaults: the reporting manager, for every punch-in. The alert (PUNCH_IN_ALERT)
//   goes in the app and on the phone, never to the person who punched, never twice.
//   Not available: 503 FEATURE_NOT_READY while the table is missing (no alerts are sent then);
//   404 on a server without it. Treat not available as "not switched on yet".
// Used by: the Punch-in alerts section of HR configuration (settings/HrConfigurationPage).
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import {
  asAvailable, defaultApi, useAvailableMutation, useAvailableQuery,
  type ApiFetch, type Availability, type SharedMutationOptions, type SharedQueryOptions,
} from './available'

export const PUNCH_ALERT_SETTING_PATH = '/v1/attendance/punch-alert-setting'
export const PUNCH_ALERT_KEYS = { setting: ['attendance', 'punch-alert-setting'], options: ['attendance', 'punch-alert-options'] } as const

/** ALL: every punch-in (the default). LATE_OR_OUTSIDE: only late punch-ins and ones outside the office. */
export type PunchAlertOn = 'ALL' | 'LATE_OR_OUTSIDE'

/** A picked person. `working` is false once they've left (the alert skips them). */
export interface PunchAlertPerson { employeeId: string; name: string | null; employeeCode: string | null; jobTitle: string | null; working: boolean }

/** A role; `builtIn` is a platform role rather than one the business made. */
export interface PunchAlertRole { roleId: string; name: string; builtIn: boolean }

export interface PunchAlertSetting {
  companyId: string
  /** The person's reporting manager (their department head when they have none). On by default. */
  notifyManager: boolean
  people: PunchAlertPerson[]
  roles: PunchAlertRole[]
  alertOn: PunchAlertOn
  updatedByName: string | null
  updatedAt: string | null
}

export interface SavePunchAlertSettingRequest {
  notifyManager: boolean
  employeeIds: string[]
  roleIds: string[]
  alertOn: PunchAlertOn
}

/** What can be picked: roles (built-in first), and this company's people who can get an alert. */
export interface PunchAlertOptions { companyId: string; roles: PunchAlertRole[]; people: PunchAlertPerson[]; truncated: boolean }

export function punchAlertSettingQuery(companyId: string, api: ApiFetch = defaultApi): SharedQueryOptions<PunchAlertSetting> {
  const qs = new URLSearchParams({ companyId })
  return {
    queryKey: [...PUNCH_ALERT_KEYS.setting, companyId],
    queryFn: () => asAvailable(() => api<PunchAlertSetting>(`${PUNCH_ALERT_SETTING_PATH}?${qs}`)),
  }
}

export function usePunchAlertSetting(companyId: string | undefined, opts?: { enabled?: boolean }) {
  return useAvailableQuery<PunchAlertSetting>({
    ...punchAlertSettingQuery(companyId ?? ''),
    enabled: (opts?.enabled ?? true) && !!companyId,
  })
}

export function punchAlertOptionsQuery(companyId: string, api: ApiFetch = defaultApi): SharedQueryOptions<PunchAlertOptions> {
  const qs = new URLSearchParams({ companyId })
  return {
    queryKey: [...PUNCH_ALERT_KEYS.options, companyId],
    queryFn: () => asAvailable(() => api<PunchAlertOptions>(`${PUNCH_ALERT_SETTING_PATH}/options?${qs}`)),
  }
}

/** The pickers' lists; only for people who can change the setting. */
export function usePunchAlertOptions(companyId: string | undefined, opts?: { enabled?: boolean }) {
  return useAvailableQuery<PunchAlertOptions>({
    ...punchAlertOptionsQuery(companyId ?? ''),
    enabled: (opts?.enabled ?? true) && !!companyId,
    staleTime: 60_000,
  })
}

export function savePunchAlertSettingMutation(
  qc: QueryClient,
  companyId: string,
  api: ApiFetch = defaultApi,
): SharedMutationOptions<PunchAlertSetting, SavePunchAlertSettingRequest> {
  const qs = new URLSearchParams({ companyId })
  const queryKey = [...PUNCH_ALERT_KEYS.setting, companyId]
  return {
    mutationFn: (body) =>
      asAvailable(() => api<PunchAlertSetting>(`${PUNCH_ALERT_SETTING_PATH}?${qs}`, { method: 'PUT', body: JSON.stringify(body) })),
    onSuccess: (result) => {
      if (!result.available) return qc.invalidateQueries({ queryKey })
      qc.setQueryData<Availability<PunchAlertSetting>>(queryKey, result)
      return undefined
    },
  }
}

export function useSavePunchAlertSetting(companyId: string) {
  const qc = useQueryClient()
  return useAvailableMutation(savePunchAlertSettingMutation(qc, companyId))
}

/** "Reporting manager · 2 people · 1 role · every punch-in" (the section's one-line summary). */
export function punchAlertSummary(s: { notifyManager: boolean; people: unknown[]; roles: unknown[]; alertOn: PunchAlertOn }): string {
  const who: string[] = []
  if (s.notifyManager) who.push('Reporting manager')
  if (s.people.length) who.push(`${s.people.length} ${s.people.length === 1 ? 'person' : 'people'}`)
  if (s.roles.length) who.push(`${s.roles.length} ${s.roles.length === 1 ? 'role' : 'roles'}`)
  return `${who.length ? who.join(' · ') : 'Nobody'} · ${s.alertOn === 'LATE_OR_OUTSIDE' ? 'late or outside-office punch-ins only' : 'every punch-in'}`
}
