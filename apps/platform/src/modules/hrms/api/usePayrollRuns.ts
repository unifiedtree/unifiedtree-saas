import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getAccessToken, useAuthStore } from '@unifiedtree/sdk'
import { apiJson, API_BASE_URL, currentSubdomain } from '@/core/api/client'

// ── Types (mirror PayrollRunService DTOs) ───────────────────────────────────

// Mirrors the DB CHECK on payroll.runs.status (V046): DRAFT/PROCESSING/LOCKED/PAID/CANCELLED.
export type RunStatus = 'DRAFT' | 'PROCESSING' | 'LOCKED' | 'PAID' | 'CANCELLED'

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
  /** Planned pay date (the processing day in Payroll Settings), yyyy-mm-dd. */
  payDate?: string | null
  /** Days in the pay period that aren't the company's weekly off or a holiday. */
  workingDays?: number | null
  createdByName?: string | null
  processedByName?: string | null
  lockedByName?: string | null
  paidByName?: string | null
  // P-PAY-CORE BW-53 (additive):
  /** Sum of EMPLOYER_CONTRIBUTION lines; used for employer-cost tiles and sparklines on the overview. */
  employerContributions?: number | null
  /** When the bank disbursement for this run was marked PAID; null while not. */
  paidAt?: string | null
}

/** One salary component's total across a run's payslips. */
export interface ComponentTotal {
  code: string
  name: string
  category: 'EARNING' | 'DEDUCTION' | 'EMPLOYER_CONTRIBUTION' | 'REIMBURSEMENT'
  amount: number
  employees: number
}

/** PF / ESI / PT / LWF owed for a month, from locked and paid runs. */
export interface StatutoryDue {
  period: string
  periodYear: number
  periodMonth: number
  companyId: string
  companyName?: string | null
  scheme: 'PF' | 'ESI' | 'PT' | 'LWF'
  employeeShare: number
  employerShare: number
  total: number
  /** Legal due date where it's the same everywhere (PF, ESI); null for PT and LWF. */
  dueDate?: string | null
  filingId?: string | null
  filingStatus?: string | null
  filingDueDate?: string | null
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
  // P-PAY-CORE BW-50: additive. The server joins these in a single query so the UI never has to call the directory per row.
  department?: string | null
  branch?: string | null
  designation?: string | null
  dateOfJoining?: string | null
  /** Net pay from the previous month's run of the same company (null if there was none). */
  previousGross?: number | null
  previousNet?: number | null
  /** Net change vs previous month, in %. Null when there is no previous month. */
  changePercent?: number | null
  newJoiner?: boolean
  hasBankAccount?: boolean
  fnfInProgress?: boolean
  /** Why this person shows under Needs review. Values: VARIANCE, MISSING_BANK, FNF_IN_PROGRESS. */
  reviewReasons?: string[]
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
  department?: string | null
  /** Days in the pay period ("paid days X of Y"). */
  totalDays?: number | null
  runStatus?: RunStatus | null
}

export interface MyPayslip {
  runId: string
  period: string
  periodMonth: number
  periodYear: number
  // Wave 1 (2026-08-11): backend now surfaces the paid-day breakdown and the
  // gross/deductions split so the ESS list renders a 5-column table without a
  // per-row second fetch. Nulls are legitimate — a tenant that isn't tracking
  // LOP won't have paidDays / lopDays; render a dash in the UI.
  paidDays?: number | null
  lopDays?: number | null
  gross?: number | null
  totalDeductions?: number | null
  netPay: number
  status: RunStatus
  lockedAt?: string | null
  // P-PAY-CORE BW-55 (additive, redesign):
  payDate?: string | null
  paidAt?: string | null
  totalDays?: number | null
  notes?: { kind: string; label?: string | null; amount?: number | null }[]
}

// P-PAY-CORE BW-55: the schedule a `payroll.payslip.read.self` holder sees on My payslips, Home and Attendance.
export interface PaySchedule {
  /** The next pay date, from the next DRAFT/PROCESSING/LOCKED run of my company; else derived from Payroll Settings. */
  nextPayDate: string | null
  /** The company's processing day of the month (1–31). */
  processingDay: number | null
}

// P-PAY-CORE BW-55: this financial year's totals, over my own LOCKED and PAID payslips.
export interface MyYtd {
  label: string
  fyStart: string
  fyEnd: string
  fromPeriod: string | null
  toPeriod: string | null
  payslips: number
  gross: number
  deductions: number
  net: number
  pfEmployee: number
  tds: number | null
  taxRegime: string | null
}

// P-PAY-CORE BW-55: the next month if a DRAFT or PROCESSING run exists ("BEING_PREPARED"). No figures.
export interface MyUpcoming {
  periodMonth: number
  periodYear: number
  period: string
  payDate: string | null
  status: 'BEING_PREPARED'
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

export function useRuns(filters: RunFilters = {}, opts?: { enabled?: boolean }) {
  const qs = new URLSearchParams()
  if (filters.companyId) qs.set('companyId', filters.companyId)
  if (filters.year) qs.set('year', String(filters.year))
  if (filters.status) qs.set('status', filters.status)
  const suffix = qs.toString() ? `?${qs}` : ''
  return useQuery({
    queryKey: [...KEY, 'list', filters],
    queryFn: () => apiJson<PayrollRun[]>(`/v1/payroll/runs${suffix}`),
    staleTime: 30_000,
    enabled: opts?.enabled ?? true,
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

/** The signed-in employee's own payslip lines for one locked or paid run. */
export function useMyPayslip(runId: string | null) {
  return useQuery({
    queryKey: ['hrms', 'payroll', 'me', 'payslips', runId],
    queryFn: () => apiJson<PayslipDetail>(`/v1/payroll/payslips/me/${runId}`),
    enabled: !!runId,
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

export function useReopenRun(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (reason: string) => apiJson<PayrollRun>(`/v1/payroll/runs/${id}/reopen`, { method: 'POST', body: JSON.stringify({ reason }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY })
      qc.invalidateQueries({ queryKey: ['hrms', 'payroll', 'me', 'payslips'] })
      qc.invalidateQueries({ queryKey: ['hrms', 'payroll', 'dashboard'] })
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
  PAID: 'success',
  CANCELLED: 'default',
}

export const inr = (n: number) => `₹${Number(n ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
export const inr2 = (n: number) => `₹${Number(n ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

// ─── P-PAY-CORE / P-MYPAY: shared contracts for the redesign ────────────────

// BW-51: /v1/payroll/runs/{id}/checks — the "Checks before you lock" list the overview and the Needs review segment share.
export interface RunCheck {
  key: 'VARIANCE' | 'MISSING_BANK' | 'PRORATED_JOINERS' | 'FNF_IN_PROGRESS' | 'SKIPPED' | 'LOP' | string
  severity: 'INFO' | 'WARNING' | 'CRITICAL'
  count: number
  employeeIds: string[]
  text: string
}

export function useRunChecks(id: string, enabled: boolean = true) {
  return useQuery({
    queryKey: [...KEY, 'detail', id, 'checks'],
    queryFn: () => apiJson<RunCheck[]>(`/v1/payroll/runs/${id}/checks`),
    enabled: !!id && enabled,
    staleTime: 30_000,
  })
}

// BW-52: /v1/payroll/runs/{id}/statutory — this run's PF, ESI, PT, LWF and TDS (TDS only if the run has a TDS line).
export interface RunStatutoryLine {
  scheme: 'PF' | 'ESI' | 'PT' | 'LWF' | 'TDS'
  employeeShare: number
  employerShare: number
  total: number
  /** Legal due date where it's the same everywhere (PF/ESI 15th of next month, TDS 7th of next month); null for PT. */
  dueDate?: string | null
}

export function useRunStatutory(id: string, enabled: boolean = true) {
  return useQuery({
    queryKey: [...KEY, 'detail', id, 'statutory'],
    queryFn: () => apiJson<RunStatutoryLine[]>(`/v1/payroll/runs/${id}/statutory`),
    enabled: !!id && enabled,
  })
}

// BW-57: /v1/payroll/runs/{id}/bank-readiness — who can be paid and who still needs an account on file, before the bank file is built.
export interface BankReadiness {
  total: number
  ready: number
  notReady: number
  people: {
    employeeId: string
    employeeCode: string
    employeeName: string
    status: 'READY' | 'MISSING' | 'INVALID_IFSC' | 'HOLD'
    problem: string | null
    bankName: string | null
    bankLast4: string | null
  }[]
}

export function useBankReadiness(id: string, enabled: boolean = true) {
  return useQuery({
    queryKey: [...KEY, 'detail', id, 'bank-readiness'],
    queryFn: () => apiJson<BankReadiness>(`/v1/payroll/runs/${id}/bank-readiness`),
    enabled: !!id && enabled,
  })
}

// BW-58: /v1/payroll/employees/{employeeId}/payslips — HR and finance see one person's final payslips.
export function useEmployeePayslips(employeeId: string | null, enabled: boolean = true) {
  return useQuery({
    queryKey: [...KEY, 'employee', employeeId, 'payslips'],
    queryFn: () => apiJson<MyPayslip[]>(`/v1/payroll/employees/${employeeId}/payslips`),
    enabled: !!employeeId && enabled,
  })
}

// BW-55: My payslips — schedule, YTD and the month being prepared. See the P-MYPAY section of audit/pay.md §2.10.
export function useMyPaySchedule() {
  return useQuery({
    queryKey: ['hrms', 'payroll', 'me', 'schedule'],
    queryFn: () => apiJson<PaySchedule>('/v1/payroll/payslips/me/schedule'),
    staleTime: 5 * 60_000,
  })
}

export function useMyPayYtd() {
  return useQuery({
    queryKey: ['hrms', 'payroll', 'me', 'ytd'],
    queryFn: () => apiJson<MyYtd>('/v1/payroll/payslips/me/ytd'),
    staleTime: 60_000,
  })
}

export function useMyUpcoming() {
  return useQuery({
    queryKey: ['hrms', 'payroll', 'me', 'upcoming'],
    queryFn: () => apiJson<MyUpcoming[]>('/v1/payroll/payslips/me/upcoming'),
    staleTime: 60_000,
  })
}

// BW-59: Ask payroll. The employee asks about one payslip; the payroll team answers. Each role sees only what it may.
export interface PayslipQuery {
  id: string
  runId: string
  employeeId: string
  employeeName?: string | null
  employeeCode?: string | null
  period: string
  message: string
  status: 'OPEN' | 'ANSWERED'
  answer: string | null
  answeredByName: string | null
  answeredAt: string | null
  createdAt: string
}

export function useMyPayQueries(runId?: string | null) {
  const qs = runId ? `?runId=${runId}` : ''
  return useQuery({
    queryKey: ['hrms', 'payroll', 'me', 'queries', runId ?? 'all'],
    queryFn: () => apiJson<PayslipQuery[]>(`/v1/payroll/payslips/me/queries${qs}`),
    staleTime: 30_000,
  })
}

export function useAskPayroll(runId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (message: string) => apiJson<PayslipQuery>(`/v1/payroll/payslips/me/${runId}/queries`, { method: 'POST', body: JSON.stringify({ message }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hrms', 'payroll', 'me', 'queries'] })
    },
  })
}

/** Admin: the payroll team's queue of open and answered questions. */
export function usePayQueries(status: 'OPEN' | 'ANSWERED' | 'ALL' = 'OPEN', opts?: { enabled?: boolean }) {
  const qs = status === 'ALL' ? '' : `?status=${status}`
  return useQuery({
    queryKey: ['hrms', 'payroll', 'queries', status],
    queryFn: () => apiJson<PayslipQuery[]>(`/v1/payroll/queries${qs}`),
    enabled: opts?.enabled ?? true,
    staleTime: 30_000,
  })
}

export function useAnswerPayQuery() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, answer }: { id: string; answer: string }) =>
      apiJson<PayslipQuery>(`/v1/payroll/queries/${id}/answer`, { method: 'POST', body: JSON.stringify({ answer }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hrms', 'payroll', 'queries'] })
      qc.invalidateQueries({ queryKey: ['hrms', 'payroll', 'me', 'queries'] })
    },
  })
}

export function useDeletePayQuery() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiJson<void>(`/v1/payroll/queries/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hrms', 'payroll', 'queries'] })
      qc.invalidateQueries({ queryKey: ['hrms', 'payroll', 'me', 'queries'] })
    },
  })
}

// BW-56: Salary structures — the dashboard tiles + a server-paged list and my own history.
export interface StructuresSummary {
  activeEmployees: number
  withStructure: number
  withoutStructure: number
  averageCtcAnnual: number | null
  revisedThisYear: number
  fyLabel: string
  lastRevisionReason: string | null
  lastRevisionEffectiveFrom: string | null
  lastRevisionAt: string | null
  lastRevisionPeople: number | null
}

export function useStructuresSummary(opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['hrms', 'payroll', 'structures', 'summary'],
    queryFn: () => apiJson<StructuresSummary>('/v1/payroll/structures/summary'),
    staleTime: 60_000,
    enabled: opts?.enabled ?? true,
  })
}

export interface StructureListRow {
  employeeId: string
  employeeCode: string
  employeeName: string
  department: string | null
  designation: string | null
  companyId: string | null
  companyName: string | null
  hasStructure: boolean
  effectiveFrom: string | null
  ctcAnnual: number | null
  ctcMonthly: number | null
  grossMonthly: number | null
  netMonthly: number | null
  taxRegime: string | null
}

export interface StructuresPage {
  content: StructureListRow[]
  totalElements: number
  totalPages: number
  page: number
  size: number
}

export interface StructuresListFilters {
  page?: number
  size?: number
  q?: string
  companyId?: string
  departmentId?: string
  /** When true, filter server-side to people with no current structure. */
  noStructure?: boolean
}

export function useStructuresList(filters: StructuresListFilters = {}, opts?: { enabled?: boolean }) {
  const qs = new URLSearchParams()
  qs.set('page', String(filters.page ?? 0))
  qs.set('size', String(filters.size ?? 20))
  if (filters.q) qs.set('q', filters.q)
  if (filters.companyId) qs.set('companyId', filters.companyId)
  if (filters.departmentId) qs.set('departmentId', filters.departmentId)
  if (filters.noStructure) qs.set('noStructure', 'true')
  return useQuery({
    queryKey: ['hrms', 'payroll', 'structures', 'list', filters],
    queryFn: () => apiJson<StructuresPage>(`/v1/payroll/structures?${qs.toString()}`),
    enabled: opts?.enabled ?? true,
  })
}

export interface MyStructureRevision {
  id: string
  effectiveFrom: string
  ctcAnnual: number | null
  ctcMonthly: number | null
  grossMonthly: number | null
  netMonthly: number | null
  current: boolean
  reason: string | null
  revisionBatchId: string | null
}

export function useMyStructureHistory(opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['hrms', 'payroll', 'me', 'structure', 'history'],
    queryFn: () => apiJson<MyStructureRevision[]>('/v1/payroll/structures/me/history'),
    staleTime: 60_000,
    enabled: opts?.enabled ?? true,
  })
}

/** Short-money format, as the design draws it on the dashboard ("₹1.24 Cr", "₹2.10 L"). */
export function shortInr(n: number | null | undefined): string {
  const v = Number(n ?? 0)
  if (!Number.isFinite(v)) return '₹—'
  const abs = Math.abs(v)
  if (abs >= 1e7) return `₹${(v / 1e7).toFixed(2)} Cr`
  if (abs >= 1e5) return `₹${(v / 1e5).toFixed(2)} L`
  if (abs >= 1000) return `₹${Math.round(v / 1000)}K`
  return inr(v)
}
