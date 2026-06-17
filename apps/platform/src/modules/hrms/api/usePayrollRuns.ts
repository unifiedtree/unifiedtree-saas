import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getAccessToken, useAuthStore } from '@unifiedtree/sdk'
import { apiJson, API_BASE_URL, currentSubdomain } from '@/core/api/client'

// ── Types (mirror PayrollRunService DTOs) ───────────────────────────────────

export type RunStatus = 'DRAFT' | 'PROCESSING' | 'LOCKED'

export interface PayrollRun {
  id: string
  companyId: string
  companyName: string
  periodMonth: number // 1–12
  periodYear: number
  periodStart: string
  periodEnd: string
  status: RunStatus
  employeeCount: number
  totalGross: number
  totalDeductions: number
  totalNet: number
  skippedEmployeeCount: number
  processedAt?: string | null
  lockedAt?: string | null
  createdAt: string
}

export interface EligibleEmployee {
  employeeId: string
  employeeCode: string
  employeeName: string
  ctcMonthly: number
}

export interface RunEmployee {
  employeeId: string
  employeeCode: string
  employeeName: string
  paidDays: number
  lopDays: number
  gross: number
  deductions: number
  netPay: number
}

export interface PayslipLine {
  code: string
  name: string
  amount: number
}

export interface PayslipDetail {
  runId: string
  employeeId: string
  employeeName: string
  employeeCode: string
  designation?: string | null
  period: string
  panMasked: string
  bankMasked: string
  paidDays?: number | null
  lopDays?: number | null
  earnings: PayslipLine[]
  deductions: PayslipLine[]
  employerContributions: PayslipLine[]
  gross: number
  totalDeductions: number
  netPay: number
}

export interface MyPayslip {
  runId: string
  period: string
  periodMonth: number
  periodYear: number
  netPay: number
  status: RunStatus
  lockedAt?: string | null
}

export interface CreateRunPayload {
  companyId: string
  periodMonth: number
  periodYear: number
}

export interface RunFilters {
  companyId?: string
  year?: number
  status?: RunStatus
}

const KEY = ['hrms', 'payroll', 'runs'] as const

// ── Queries ─────────────────────────────────────────────────────────────────

export function useRuns(filters: RunFilters = {}) {
  const qs = new URLSearchParams()
  if (filters.companyId) qs.set('companyId', filters.companyId)
  if (filters.year) qs.set('year', String(filters.year))
  if (filters.status) qs.set('status', filters.status)
  const suffix = qs.toString() ? `?${qs}` : ''
  return useQuery({
    queryKey: [...KEY, 'list', filters],
    queryFn: () => apiJson<PayrollRun[]>(`/v1/payroll/runs${suffix}`),
    staleTime: 30_000,
  })
}

export function useRun(id: string) {
  return useQuery({
    queryKey: [...KEY, 'detail', id],
    queryFn: () => apiJson<PayrollRun>(`/v1/payroll/runs/${id}`),
    enabled: !!id,
  })
}

export function useRunEmployees(id: string) {
  return useQuery({
    queryKey: [...KEY, 'detail', id, 'employees'],
    queryFn: () => apiJson<RunEmployee[]>(`/v1/payroll/runs/${id}/employees`),
    enabled: !!id,
  })
}

export function useEligibleEmployees(id: string, enabled: boolean) {
  return useQuery({
    queryKey: [...KEY, 'detail', id, 'eligible'],
    queryFn: () => apiJson<EligibleEmployee[]>(`/v1/payroll/runs/${id}/eligible-employees`),
    enabled: !!id && enabled,
  })
}

// Employees skipped during processing for lacking a current salary structure (FIX P1-4).
export function useRunSkipped(id: string, enabled: boolean) {
  return useQuery({
    queryKey: [...KEY, 'detail', id, 'skipped'],
    queryFn: () => apiJson<EligibleEmployee[]>(`/v1/payroll/runs/${id}/skipped`),
    enabled: !!id && enabled,
  })
}

export function useRunPayslip(runId: string, empId: string | null) {
  return useQuery({
    queryKey: [...KEY, 'detail', runId, 'payslip', empId],
    queryFn: () => apiJson<PayslipDetail>(`/v1/payroll/runs/${runId}/employees/${empId}/payslip`),
    enabled: !!runId && !!empId,
  })
}

export function useMyPayslips() {
  return useQuery({
    queryKey: ['hrms', 'payroll', 'me', 'payslips'],
    queryFn: () => apiJson<MyPayslip[]>('/v1/payroll/payslips/me'),
  })
}

// ── Mutations ───────────────────────────────────────────────────────────────

export function useCreateRun() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateRunPayload) =>
      apiJson<PayrollRun>('/v1/payroll/runs', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...KEY, 'list'] }),
  })
}

export function useProcessRun(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => apiJson<PayrollRun>(`/v1/payroll/runs/${id}/process`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [...KEY, 'detail', id] })
      qc.invalidateQueries({ queryKey: [...KEY, 'list'] })
    },
  })
}

export function useLockRun(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => apiJson<PayrollRun>(`/v1/payroll/runs/${id}/lock`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [...KEY, 'detail', id] })
      qc.invalidateQueries({ queryKey: [...KEY, 'list'] })
    },
  })
}

// ── PDF blob download (raw fetch — apiJson only parses JSON) ─────────────────

async function downloadPdf(path: string, filename: string): Promise<void> {
  const token = getAccessToken()
  const tenantSubdomain = currentSubdomain()
  const tenantId = useAuthStore.getState().tenant?.id
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: 'GET',
    headers: {
      Accept: 'application/pdf',
      ...(tenantSubdomain ? { 'X-Tenant-Subdomain': tenantSubdomain } : {}),
      ...(tenantId ? { 'X-Tenant-ID': tenantId } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  })
  if (!res.ok) {
    let msg = `Download failed (${res.status})`
    try {
      const j = await res.json()
      msg = j?.message || j?.errorCode || msg
    } catch {
      /* non-JSON error body */
    }
    throw new Error(msg)
  }
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export function downloadPayslipPdf(runId: string, empId: string) {
  return downloadPdf(`/v1/payroll/runs/${runId}/employees/${empId}/payslip.pdf`, `payslip-${empId}.pdf`)
}

export function downloadMyPayslipPdf(runId: string) {
  return downloadPdf(`/v1/payroll/payslips/me/${runId}.pdf`, `payslip-${runId}.pdf`)
}

// ── Shared display helpers ──────────────────────────────────────────────────

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export const statusTone: Record<RunStatus, 'default' | 'info' | 'success'> = {
  DRAFT: 'default',
  PROCESSING: 'info',
  LOCKED: 'success',
}

export const inr = (n: number) => `₹${Number(n ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
export const inr2 = (n: number) => `₹${Number(n ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
