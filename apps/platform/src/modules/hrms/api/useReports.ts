import { useQuery } from '@tanstack/react-query'
import { apiJson } from '@/core/api/client'

// ── Response interfaces (column names match backend SQL exactly) ───────────────

export interface HeadcountRow {
  department: string | null
  total: number
  active: number
  on_notice: number
  probation: number
}

export interface AttritionRow {
  month: string
  exits: number
  resignations: number
  terminations: number
  attrition_pct: number
}

export interface AttendanceSummaryRow {
  employee_code: string
  employee_name: string
  department: string | null
  present_days: number
  late_days: number
  avg_hours: number | null
  total_overtime_mins: number
}

export interface LeaveBalanceRow {
  employee_code: string
  employee_name: string
  department: string | null
  leave_type: string
  total_entitlement: number
  used: number
  pending: number
  carry_forward: number
  available: number
}

export interface LateMarkRow {
  employee_code: string
  employee_name: string
  department: string | null
  attendance_date: string
  late_by_minutes: number
  check_in_at: string | null
}

export interface DiversityRow {
  department: string | null
  gender: string
  count: number
  pct: number
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

export function useHeadcountReport(companyId: string | null, asOf?: string) {
  return useQuery({
    queryKey: ['hrms', 'reports', 'headcount', companyId, asOf ?? 'today'],
    queryFn: () => {
      const params = new URLSearchParams({ companyId: companyId! })
      if (asOf) params.set('asOf', asOf)
      return apiJson<HeadcountRow[]>(`/v1/reports/headcount?${params}`)
    },
    enabled: !!companyId,
    staleTime: 60_000,
  })
}

export function useAttritionReport(companyId: string | null, from: string, to: string) {
  return useQuery({
    queryKey: ['hrms', 'reports', 'attrition', companyId, from, to],
    queryFn: () => {
      const params = new URLSearchParams({ companyId: companyId!, from, to })
      return apiJson<AttritionRow[]>(`/v1/reports/attrition?${params}`)
    },
    enabled: !!companyId && !!from && !!to,
    staleTime: 60_000,
  })
}

export function useAttendanceSummaryReport(companyId: string | null, from: string, to: string) {
  return useQuery({
    queryKey: ['hrms', 'reports', 'attendance-summary', companyId, from, to],
    queryFn: () => {
      const params = new URLSearchParams({ companyId: companyId!, from, to })
      return apiJson<AttendanceSummaryRow[]>(`/v1/reports/attendance-summary?${params}`)
    },
    enabled: !!companyId && !!from && !!to,
    staleTime: 60_000,
  })
}

export function useLeaveBalanceReport(companyId: string | null, year: string) {
  return useQuery({
    queryKey: ['hrms', 'reports', 'leave-balance', companyId, year],
    queryFn: () => {
      const params = new URLSearchParams({ companyId: companyId!, year })
      return apiJson<LeaveBalanceRow[]>(`/v1/reports/leave-balance?${params}`)
    },
    enabled: !!companyId && !!year,
    staleTime: 60_000,
  })
}

export function useLateMarksReport(companyId: string | null, from: string, to: string) {
  return useQuery({
    queryKey: ['hrms', 'reports', 'late-marks', companyId, from, to],
    queryFn: () => {
      const params = new URLSearchParams({ companyId: companyId!, from, to })
      return apiJson<LateMarkRow[]>(`/v1/reports/late-marks?${params}`)
    },
    enabled: !!companyId && !!from && !!to,
    staleTime: 60_000,
  })
}

export function useDiversityReport(companyId: string | null) {
  return useQuery({
    queryKey: ['hrms', 'reports', 'diversity', companyId],
    queryFn: () => {
      const params = new URLSearchParams({ companyId: companyId! })
      return apiJson<DiversityRow[]>(`/v1/reports/diversity?${params}`)
    },
    enabled: !!companyId,
    staleTime: 60_000,
  })
}
