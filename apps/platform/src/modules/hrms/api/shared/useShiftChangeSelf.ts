// My shift change requests: list, ask (with an optional "Until"), withdraw a waiting one.
//
// Contract C0 · BW-31 / BW-34 · owner P-ATT-PLAN (migration V143_54,
// attendance.shift_change_requests.requested_end_date)
//   GET  /v1/shifts/change-requests/my            → ShiftChangeRequest[]   (exists today; unchanged)
//   POST /v1/shifts/change-requests  { requestedShiftPolicyId, effectiveDate, reason, endDate? }
//                                                  → ShiftChangeRequest     (exists today; BW-31 adds endDate)
//   POST /v1/shifts/change-requests/{id}/cancel    → ShiftChangeRequest (status CANCELLED)   (BW-34, new)
//   Permission: attendance.checkin.self; withdraw is the requester's own
//   PENDING request only. One waiting request per person
//   (uq_scr_one_pending_per_employee).
//   BW-31 rule for the owner: when endDate is sent and the column is missing,
//   answer 503 FEATURE_NOT_READY; never save a temporary change as a permanent
//   one. A null or missing endDate means permanent, as today. On approval the
//   new shift runs until endDate and the previous shift comes back the next day.
//   Not available: withdraw answers 404 until BW-34 ships (hide Withdraw).
// Used by: P-HOME (/me/shift-change), P-ATT-PLAN (Shifts & Overtime › "My shift" for employees).
// The list keeps today's key, so shifts/ShiftChangeRequest.tsx and
// AttendanceContainer.tsx (['shifts','change-requests','my']) share its cache.
import { useQueryClient, type QueryClient, type QueryKey } from '@tanstack/react-query'
import { SHARED_KEYS, type CreateShiftChangeRequest, type ShiftChangeRequest } from './contracts'
import {
  asAvailable, defaultApi, useAvailableMutation, useAvailableQuery,
  type ApiFetch, type SharedMutationOptions, type SharedQueryOptions,
} from './available'

export const SHIFT_CHANGE_REQUESTS_PATH = '/v1/shifts/change-requests'

export function myShiftChangesQuery(api: ApiFetch = defaultApi): SharedQueryOptions<ShiftChangeRequest[]> {
  return {
    queryKey: SHARED_KEYS.myShiftChanges,
    queryFn: () => asAvailable(() => api<ShiftChangeRequest[]>(`${SHIFT_CHANGE_REQUESTS_PATH}/my`)),
  }
}

export function useMyShiftChanges(opts?: { enabled?: boolean }) {
  return useAvailableQuery<ShiftChangeRequest[]>({ ...myShiftChangesQuery(), enabled: opts?.enabled ?? true })
}

/** The employee's own list and the HR queue (both under ['shifts', …]). */
const AFTER_CHANGE: readonly QueryKey[] = [SHARED_KEYS.myShiftChanges, SHARED_KEYS.shiftRequests]

export function requestShiftChangeMutation(
  qc: QueryClient,
  api: ApiFetch = defaultApi,
): SharedMutationOptions<ShiftChangeRequest, CreateShiftChangeRequest> {
  return {
    mutationFn: ({ endDate, ...rest }) => {
      // Send endDate only when there is one, so a permanent change looks exactly like today's request.
      const body = endDate ? { ...rest, endDate } : rest
      return asAvailable(() => api<ShiftChangeRequest>(SHIFT_CHANGE_REQUESTS_PATH, { method: 'POST', body: JSON.stringify(body) }))
    },
    onSuccess: (result) =>
      result.available ? Promise.all(AFTER_CHANGE.map((queryKey) => qc.invalidateQueries({ queryKey }))) : undefined,
  }
}

export function withdrawShiftChangeMutation(
  qc: QueryClient,
  api: ApiFetch = defaultApi,
): SharedMutationOptions<ShiftChangeRequest, string> {
  return {
    mutationFn: (requestId) =>
      asAvailable(() => api<ShiftChangeRequest>(`${SHIFT_CHANGE_REQUESTS_PATH}/${encodeURIComponent(requestId)}/cancel`, { method: 'POST' })),
    onSuccess: (result) =>
      result.available ? Promise.all(AFTER_CHANGE.map((queryKey) => qc.invalidateQueries({ queryKey }))) : undefined,
  }
}

export function useRequestShiftChange() {
  const qc = useQueryClient()
  return useAvailableMutation(requestShiftChangeMutation(qc))
}

/** Withdraw my waiting request; `mutate(requestId)`. */
export function useWithdrawShiftChange() {
  const qc = useQueryClient()
  return useAvailableMutation(withdrawShiftChangeMutation(qc))
}
