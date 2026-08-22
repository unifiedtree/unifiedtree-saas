import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiJson } from '@/core/api/client'

/**
 * Shift *policies* — the attendance-owned shift definitions.
 *
 * Backend: com.hrms.api.attendance.ShiftController (`/v1/shifts`), table
 * `attendance.shift_policies`.
 *   GET    /v1/shifts?companyId=…   → ShiftPolicyResponse[]  (seeds defaults if none)
 *   POST   /v1/shifts?companyId=…   → create
 *   PUT    /v1/shifts/{shiftId}     → update
 *   DELETE /v1/shifts/{shiftId}     → soft-delete (409 SHIFT_IN_USE if assigned)
 * Reads need `attendance.checkin.self`; every write needs
 * `attendance.regularization.approve`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DO NOT confuse this with `useShifts` / `useCreateShift` in ./useOrg.ts.
 * Those talk to `/v1/hrms/shifts`, which is the *org* roster table
 * (`org.shifts`, grace column `grace_minutes`, default 10). Nothing in the
 * attendance late-mark path reads that table — editing it looks like it works
 * and changes nothing. This file is the one that matters.
 *
 * Grace-period stores in this codebase (three, and they disagree):
 *   1. attendance.shift_policies.grace_period_minutes  (default 15)  ← AUTHORITATIVE
 *   2. settings.hr_configuration.late_grace_minutes    (default 15)  — unread by attendance
 *   3. org.shifts.grace_minutes                        (default 10)  — unread by attendance
 * Only (1) is consumed by the late-mark calculation:
 *   AttendanceService.getShiftProfile() (~line 666) reads
 *   `sp.grace_period_minutes` off attendance.shift_policies, and
 *   AttendanceService (~lines 1234-1235) does `shiftStart.plusMinutes(grace)`
 *   to derive the late cutoff. Wire new grace UI to THIS hook only.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export type ShiftType = 'FIXED' | 'FLEXIBLE' | 'ROTATIONAL' | 'NIGHT'

/** Mirrors ShiftDtos.ShiftPolicyResponse. Times arrive as "HH:mm:ss". */
export interface ShiftPolicy {
  id: string
  name: string
  shiftType: ShiftType
  startTime: string
  endTime: string
  /** Minutes after shift start before a punch is marked LATE. 0..120. */
  gracePeriodMinutes: number
  workingHoursPerDay?: number | null
  /**
   * Overtime settings live on the shift policy. They are stored only — no
   * payroll run consumes them yet (see ShiftDtos javadoc), so UI copy must
   * describe them as the configured rate, not as an applied payout.
   */
  overtimeApplicable?: boolean
  overtimeMultiplier?: number | null
}

/** Mirrors ShiftDtos.ShiftPolicyRequest (all fields optional server-side except name). */
export interface ShiftPolicyPayload {
  name: string
  shiftType: ShiftType
  /** "HH:mm:ss" — Jackson also accepts "HH:mm". */
  startTime: string
  endTime: string
  /** Server bound: 0..120. */
  gracePeriodMinutes: number
  /** Server bound: 0.5..24.0. */
  workingHoursPerDay?: number
  overtimeApplicable?: boolean
  /** Server bound: 1.0..9.99. */
  overtimeMultiplier?: number
}

/** Namespaced away from useOrg's ['hrms','org','shifts',…] so the two caches never collide. */
const KEY = ['hrms', 'shift-policies'] as const

export function useShiftPolicies(companyId: string) {
  return useQuery({
    queryKey: [...KEY, companyId],
    queryFn: () => apiJson<ShiftPolicy[]>(`/v1/shifts?companyId=${companyId}`),
    enabled: !!companyId,
    staleTime: 60_000,
  })
}

export function useCreateShiftPolicy() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ companyId, data }: { companyId: string; data: ShiftPolicyPayload }) =>
      apiJson<ShiftPolicy>(`/v1/shifts?companyId=${companyId}`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: (_res, vars) => qc.invalidateQueries({ queryKey: [...KEY, vars.companyId] }),
  })
}

export function useUpdateShiftPolicy() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; companyId: string; data: ShiftPolicyPayload }) =>
      apiJson<ShiftPolicy>(`/v1/shifts/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    onSuccess: (_res, vars) => qc.invalidateQueries({ queryKey: [...KEY, vars.companyId] }),
  })
}

export function useDeleteShiftPolicy() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id }: { id: string; companyId: string }) =>
      apiJson<void>(`/v1/shifts/${id}`, { method: 'DELETE' }),
    onSuccess: (_res, vars) => qc.invalidateQueries({ queryKey: [...KEY, vars.companyId] }),
  })
}
