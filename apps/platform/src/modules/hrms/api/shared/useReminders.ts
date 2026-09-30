// "Send a reminder" to people who haven't checked in, and who was reminded today.
//
// Contract C0 · BW-10 · owner P-TEAM
//   POST /v1/attendance/reminders  { date, reason, employeeIds[] }   → ReminderResult[] (one per id)
//   GET  /v1/attendance/reminders?date=yyyy-MM-dd                     → SentReminder[]
//   Permission: attendance.team.read, only for people in the caller's team scope
//   (TeamEmployeeScope). At most once per person, day and reason (checked
//   against notif.notifications): a repeat comes back ALREADY_SENT, not an
//   error. Delivered in the app and on the phone per each person's choices
//   (CHECKIN_REMINDER). No new permission.
//   Not available: 404 until P-TEAM ships it.
// Used by: P-TEAM (Team today), P-HOME (the manager's Home), P-ATT-DAY (Daily
//   Logs "Remind all at once"), P-DASH (the dashboard inbox's Remind).
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { SHARED_KEYS, type IsoDate, type ReminderResult, type SendRemindersRequest, type SentReminder } from './contracts'
import {
  asAvailable, defaultApi, useAvailableMutation, useAvailableQuery,
  type ApiFetch, type SharedMutationOptions, type SharedQueryOptions,
} from './available'

export const REMINDERS_PATH = '/v1/attendance/reminders'

export function remindersQuery(date: IsoDate, api: ApiFetch = defaultApi): SharedQueryOptions<SentReminder[]> {
  const qs = new URLSearchParams({ date })
  return {
    queryKey: [...SHARED_KEYS.reminders, date],
    queryFn: () => asAvailable(() => api<SentReminder[]>(`${REMINDERS_PATH}?${qs}`)),
  }
}

/** Reminders already sent for the day, so "Reminder sent" survives a reload. */
export function useReminders(date: IsoDate | undefined, opts?: { enabled?: boolean }) {
  return useAvailableQuery<SentReminder[]>({ ...remindersQuery(date ?? ''), enabled: (opts?.enabled ?? true) && !!date })
}

export function sendRemindersMutation(
  qc: QueryClient,
  api: ApiFetch = defaultApi,
): SharedMutationOptions<ReminderResult[], SendRemindersRequest> {
  return {
    mutationFn: (body) =>
      asAvailable(() => api<ReminderResult[]>(REMINDERS_PATH, { method: 'POST', body: JSON.stringify(body) })),
    onSuccess: (result, { date }) =>
      result.available ? qc.invalidateQueries({ queryKey: [...SHARED_KEYS.reminders, date] }) : undefined,
  }
}

export function useSendReminders() {
  const qc = useQueryClient()
  return useAvailableMutation(sendRemindersMutation(qc))
}
