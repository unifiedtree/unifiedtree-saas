// The next pay date for the signed-in person ("Next payday", "Payroll is processed on {date}").
//
// Contract C0 · BW-55 · owner P-PAY-CORE
//   GET /v1/payroll/payslips/me/schedule   → PaySchedule
//   Permission: payroll.payslip.read.self; the caller's own company only.
//   nextPayDate is the next run's pay date, else this cycle's processing day
//   (one date: the processing day is the pay date today, AUDIT §5.9).
//   Not available: until P-PAY-CORE adds the literal path, the request matches
//   today's /payslips/me/{runId} and answers 400 INVALID_PARAMETER ("schedule"
//   isn't a run id); the hook reads that as not built yet, like a 404.
// Used by: P-HOME (Pay card, Around you), P-ATT-DAY (the fix-a-day panel's
//   payroll line), P-MYPAY (My payslips).
import { SHARED_KEYS, type PaySchedule } from './contracts'
import { asAvailable, defaultApi, unmatchedPathParam, useAvailableQuery, type ApiFetch, type SharedQueryOptions } from './available'

export const PAY_SCHEDULE_PATH = '/v1/payroll/payslips/me/schedule'

export function payScheduleQuery(api: ApiFetch = defaultApi): SharedQueryOptions<PaySchedule> {
  return {
    queryKey: SHARED_KEYS.paySchedule,
    queryFn: () => asAvailable(() => api<PaySchedule>(PAY_SCHEDULE_PATH), unmatchedPathParam),
  }
}

/** Pass `enabled: false` for people without payroll.payslip.read.self or without the payroll module. */
export function usePaySchedule(opts?: { enabled?: boolean }) {
  return useAvailableQuery<PaySchedule>({ ...payScheduleQuery(), enabled: opts?.enabled ?? true, staleTime: 5 * 60_000 })
}
