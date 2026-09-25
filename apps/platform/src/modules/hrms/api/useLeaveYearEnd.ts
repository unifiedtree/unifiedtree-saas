// Leave encashment, accrual, the year-end carry forward and the balance audit
// trail (V143.23). Backend: LeaveEncashmentController (/v1/leave/encashments)
// and LeaveYearEndController (/v1/leave/accrual, /year-end, /ledger).
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiJson } from '@/core/api/client'

export type EncashmentStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'PAID'

/** What one person can still encash of one leave type this year. */
export interface EncashmentOption {
  leaveTypeId: string
  leaveTypeName: string
  year: number
  available: number
  maxPerYear: number | null
  alreadyRequested: number
  canRequest: number
  /** One day's pay (monthly Basic ÷ 30), or null without a salary structure. */
  perDayRate: number | null
}

export interface Encashment {
  id: string
  employeeId: string
  employeeName?: string | null
  employeeCode?: string | null
  leaveTypeId: string
  leaveTypeName?: string | null
  year: number
  days: number
  status: EncashmentStatus
  reason?: string | null
  raisedByHr: boolean
  raisedByName?: string | null
  decidedByName?: string | null
  decidedAt?: string | null
  decisionNote?: string | null
  perDayRate?: number | null
  amount?: number | null
  payrollRunId?: string | null
  paidAt?: string | null
  createdAt: string
}

export interface AccrualRunResult { year: number; balancesCreated: number; balancesCredited: number; daysCredited: number }
export interface CarryForwardLine {
  employeeId: string; employeeName?: string | null; employeeCode?: string | null; leaveTypeId: string; leaveTypeName: string
  unused: number; carried: number; lapsed: number; done: boolean
}
export interface CarryForwardPreview { fromYear: number; toYear: number; lines: CarryForwardLine[]; totalCarried: number; totalLapsed: number; alreadyDone: number }
export interface CarryForwardResult { fromYear: number; toYear: number; processed: number; skippedAlreadyDone: number; totalCarried: number; totalLapsed: number }
export interface LedgerEntry {
  id: string; employeeId: string; employeeName?: string | null; employeeCode?: string | null; leaveTypeId: string; leaveTypeName?: string | null
  year: number; kind: 'ACCRUAL' | 'CARRY_FORWARD' | 'LAPSE' | 'ENCASHMENT'; period: string; days: number; note?: string | null; createdAt: string; createdBy?: string | null
}

const KEY = ['hrms', 'leave', 'encash'] as const
const BAL = ['hrms', 'leave', 'balances'] as const
const json = (method: string, body?: unknown) => ({ method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })

// ── Employee ─────────────────────────────────────────────────────────────────
export function useMyEncashOptions(enabled = true) {
  return useQuery({ queryKey: [...KEY, 'my-options'], queryFn: () => apiJson<EncashmentOption[]>('/v1/leave/encashments/my/options'), enabled })
}
export function useMyEncashments(enabled = true) {
  return useQuery({ queryKey: [...KEY, 'my'], queryFn: () => apiJson<Encashment[]>('/v1/leave/encashments/my'), enabled })
}

function useInvalidate() {
  const qc = useQueryClient()
  return () => {
    qc.invalidateQueries({ queryKey: KEY })
    qc.invalidateQueries({ queryKey: BAL })
    qc.invalidateQueries({ queryKey: ['hrms', 'leave', 'overview'] })
    qc.invalidateQueries({ queryKey: ['hrms', 'leave', 'ledger'] })
  }
}

export interface EncashPayload { leaveTypeId: string; days: number; reason?: string }
export function useRequestEncashment() {
  const done = useInvalidate()
  return useMutation({
    mutationFn: (p: EncashPayload & { employeeId?: string }) => {
      const { employeeId, ...body } = p
      return apiJson<Encashment>(employeeId ? `/v1/leave/encashments/for/${employeeId}` : '/v1/leave/encashments', json('POST', body))
    },
    onSuccess: done,
  })
}
export function useCancelEncashment() {
  const done = useInvalidate()
  return useMutation({ mutationFn: (id: string) => apiJson<Encashment>(`/v1/leave/encashments/${id}/cancel`, json('POST')), onSuccess: done })
}

// ── HR ───────────────────────────────────────────────────────────────────────
export function useEncashments(status: 'PENDING' | 'DECIDED', enabled = true) {
  return useQuery({ queryKey: [...KEY, 'all', status], queryFn: () => apiJson<Encashment[]>(`/v1/leave/encashments?status=${status}`), enabled })
}
export function useEncashOptionsFor(employeeId: string) {
  return useQuery({
    queryKey: [...KEY, 'options', employeeId],
    queryFn: () => apiJson<EncashmentOption[]>(`/v1/leave/encashments/options/${employeeId}`),
    enabled: !!employeeId,
  })
}
export function useDecideEncashment() {
  const done = useInvalidate()
  return useMutation({
    mutationFn: ({ id, approved, note }: { id: string; approved: boolean; note?: string }) =>
      apiJson<Encashment>(`/v1/leave/encashments/${id}/decision`, json('POST', { approved, note })),
    onSuccess: done,
  })
}

// ── Accrual and year end ─────────────────────────────────────────────────────
export function useRunAccrual() {
  const done = useInvalidate()
  return useMutation({ mutationFn: () => apiJson<AccrualRunResult>('/v1/leave/accrual/run', json('POST')), onSuccess: done })
}
export function useCarryForwardPreview(fromYear: number, enabled = true) {
  return useQuery({
    queryKey: ['hrms', 'leave', 'year-end', fromYear],
    queryFn: () => apiJson<CarryForwardPreview>(`/v1/leave/year-end/preview?fromYear=${fromYear}`),
    enabled,
  })
}
export function useRunCarryForward() {
  const qc = useQueryClient()
  const done = useInvalidate()
  return useMutation({
    mutationFn: (fromYear: number) => apiJson<CarryForwardResult>(`/v1/leave/year-end/carry-forward?fromYear=${fromYear}`, json('POST')),
    onSuccess: () => { done(); qc.invalidateQueries({ queryKey: ['hrms', 'leave', 'year-end'] }) },
  })
}
export function useLeaveLedger(enabled = true) {
  return useQuery({ queryKey: ['hrms', 'leave', 'ledger', 'all'], queryFn: () => apiJson<LedgerEntry[]>('/v1/leave/ledger?limit=100'), enabled })
}
export function useMyLeaveLedger(enabled = true) {
  return useQuery({ queryKey: ['hrms', 'leave', 'ledger', 'my'], queryFn: () => apiJson<LedgerEntry[]>('/v1/leave/my/ledger'), enabled })
}
