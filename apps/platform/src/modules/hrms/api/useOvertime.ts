// Overtime (P-ATT-PLAN; DECISIONS 22). Overtime is recorded, never paid.
//
// From punches (extra time past the shift, worked out at check-out):
//   GET  /v1/attendance/overtime?from&to&page        attendance.team.read, the caller's team; 20 a page
//   POST /v1/attendance/overtime/{id}/approve|reject  attendance.overtime.approve; a rejection needs a note
// Asked for by the employee (V143_66):
//   POST /v1/attendance/overtime/requests  {date, minutes, reason}     attendance.checkin.self
//   GET  /v1/attendance/overtime/requests/my                           attendance.checkin.self
//   POST /v1/attendance/overtime/requests/{id}/cancel                  attendance.checkin.self (their waiting one)
//   GET  /v1/attendance/overtime/requests?from&to                      attendance.team.read
//   POST /v1/attendance/overtime/requests/{id}/approve|reject {note}   attendance.overtime.approve
// The minimum overtime (1 hour unless the company changed it) is a threshold: under it nothing counts, from it all of
// it does. Every key sits under ['attendance','overtime'] (SHARED_KEYS.overtime), which the rules' save refreshes too.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiJson } from '@/core/api/client'
import { SHARED_KEYS } from './shared/contracts'
import { asAvailable, useAvailableMutation, useAvailableQuery } from './shared/available'

/** One day of overtime from punches. */
export interface OvertimeEntry {
  id: string
  employeeId: string
  employeeName: string
  date: string | number
  /** The stored extra minutes. */
  minutes: number
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | string
  note?: string | null
  decidedAt?: string | null
  decidedBy?: string | null
  checkInAt?: string | number | null
  checkOutAt?: string | number | null
  shiftName?: string | null
  shiftStart?: string | null
  shiftEnd?: string | null
  reason?: string | null
  reasonSource?: 'EMPLOYEE' | 'FIX_REQUEST' | 'MANUAL_ENTRY' | null
  /** The part that counts (all of it once the minimum is reached). */
  countedMinutes?: number
  /** The minimum overtime in force for the person's company. */
  minimumMinutes?: number
}

export interface OvertimeRequest {
  id: string
  employeeId: string
  employeeName: string | null
  employeeCode: string | null
  date: string
  minutes: number
  reason: string
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | string
  decidedByName: string | null
  decisionNote: string | null
  decidedAt: string | null
  createdAt: string
}

const KEY = SHARED_KEYS.overtime

/** Every overtime day in the range: the API pages 20 at a time (up to 1,000 rows, as before). */
export async function loadOvertime(from: string, to: string) {
  const all: OvertimeEntry[] = []
  for (let page = 0; page < 50; page++) {
    const r = await apiJson<{ content: OvertimeEntry[]; totalElements: number }>(`/v1/attendance/overtime?from=${from}&to=${to}&page=${page}`)
    all.push(...r.content)
    if (r.content.length < 20 || all.length >= r.totalElements) break
  }
  return all
}

export function useOvertimeEntries(from: string, to: string, enabled = true) {
  return useQuery({ queryKey: [...KEY, 'entries', from, to], queryFn: () => loadOvertime(from, to), enabled })
}

export function useDecideOvertime() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, approve, note }: { id: string; approve: boolean; note: string }) =>
      apiJson<{ status: string }>(`/v1/attendance/overtime/${id}/${approve ? 'approve' : 'reject'}`, { method: 'POST', body: JSON.stringify({ note }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}

export function useTeamOvertimeRequests(from: string, to: string, enabled = true) {
  return useAvailableQuery<OvertimeRequest[]>({
    queryKey: [...KEY, 'requests', 'team', from, to],
    queryFn: () => asAvailable(() => apiJson<OvertimeRequest[]>(`/v1/attendance/overtime/requests?from=${from}&to=${to}`)),
    enabled,
  })
}

export function useMyOvertimeRequests(enabled = true) {
  return useAvailableQuery<OvertimeRequest[]>({
    queryKey: [...KEY, 'requests', 'my'],
    queryFn: () => asAvailable(() => apiJson<OvertimeRequest[]>('/v1/attendance/overtime/requests/my')),
    enabled,
  })
}

export function useRequestOvertime() {
  const qc = useQueryClient()
  return useAvailableMutation<OvertimeRequest, { date: string; minutes: number; reason: string }>({
    mutationFn: (body) => asAvailable(() => apiJson<OvertimeRequest>('/v1/attendance/overtime/requests', { method: 'POST', body: JSON.stringify(body) })),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}

export function useWithdrawOvertimeRequest() {
  const qc = useQueryClient()
  return useAvailableMutation<OvertimeRequest, string>({
    mutationFn: (id) => asAvailable(() => apiJson<OvertimeRequest>(`/v1/attendance/overtime/requests/${encodeURIComponent(id)}/cancel`, { method: 'POST' })),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}

export function useDecideOvertimeRequest() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, approve, note }: { id: string; approve: boolean; note: string }) =>
      apiJson<OvertimeRequest>(`/v1/attendance/overtime/requests/${encodeURIComponent(id)}/${approve ? 'approve' : 'reject'}`, { method: 'POST', body: JSON.stringify({ note }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}
