// Real-data container for the redesigned Payroll module (design/dc/PayrollModule):
// /hrms/payroll-dashboard, /hrms/salary-structure, /hrms/payroll/runs[/:id],
// /hrms/payroll/settings, /hrms/pli, /hrms/advances, /hrms/bank-disbursement.
// Each section loads only what it shows. Nothing is invented: where the API has
// no value the design shows a dash (see docs/Designs/STATIC-UI-TO-BUILD.md §5).
import { useMemo, useState } from 'react'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { jwtDecode } from 'jwt-decode'
import { getAccessToken, usePermission, P } from '@unifiedtree/sdk'
import { apiBlob, apiJson } from '@/core/api/client'
import { HrDrawer } from '@/shared/components/hr'
import { PayrollModule } from '@/design/dc/PayrollModule'
import { DesignFrame, useIsMobile } from '@/design/dc/DesignFrame'
import { istToday, addDays, fmtShort, MON, MONTHS } from '@/design/dc/dates'
import type { RunRow, RunStatus } from '@/design/dc/PayRuns'
import type { PayDashData } from '@/design/dc/PayDashboard'
import type { RunPageData } from '@/design/dc/PayrollRunPage'
import type { Payslip } from '@/design/dc/PayslipDrawer'
import type { StructureInfo, PayCalc, SalaryRow } from '@/design/dc/PaySalary'
import { designSplit } from '@/design/dc/PaySalary'
import type { ApiPayrollSettings } from '@/design/dc/PaySettings'
import type { PliRow } from '@/design/dc/PayPli'
import type { AdvRow, AdvPlanRow } from '@/design/dc/PayAdvances'
import type { BankData, BankBatch } from '@/design/dc/PayBank'
import { useCompanies, type Department } from '../api/useOrg'
import {
  useRuns, useRun, useRunEmployees, useRunSkipped, useEligibleEmployees, useRunPayslip, useCreateRun, useProcessRun, useLockRun, useReopenRun,
  downloadPayslipPdf, type PayrollRun, type EligibleEmployee,
} from '../api/usePayrollRuns'
import type { EmployeeSalaryStructure, SalaryComponent, PtSlab, PayrollDashboardKpis } from '../api/usePayroll'
import { downloadBatchFile, type DisbursementBatch, type BankProfile, type BatchDetail } from '../api/useDisbursement'
import type { AdvanceRequest, Page, AdvanceScheduleRow } from '../api/useAdvance'
import { useAdvanceDecision, useRequestAdvance } from '../api/useAdvance'
import type { PliTarget } from '../api/usePli'
import type { StatutoryFiling } from '../api/useCompliance'
import type { PageResponse, WorkforceEmployee } from '../api/useWorkforce'
import { AdvanceDecisionActions, AdvanceDetail } from '../advance/AdvanceAdmin'
import { AllAwardsTab, Pli } from '../Pli'
import { Advance } from '../Advance'

type St = 'live' | 'loading' | 'error'
const stateOf = (...qs: { isLoading: boolean; isError: boolean }[]): St => (qs.some((q) => q.isError) ? 'error' : qs.some((q) => q.isLoading) ? 'loading' : 'live')
const errText = (e: unknown) => (e instanceof Error && e.message) || 'Please try again.'
const num = (v: unknown) => Number(v || 0)
const STATUS: Record<string, RunStatus> = { DRAFT: 'draft', PROCESSING: 'processing', LOCKED: 'locked', PAID: 'paid', CANCELLED: 'cancelled' }
const runLabel = (r: { periodMonth: number; periodYear: number }) => `${MON[r.periodMonth - 1]} ${r.periodYear}`
/** "1 Sep, 4:40 pm" in IST. */
const stamp = (iso?: string | null) => {
  if (!iso) return ''
  const d = new Date(iso)
  const day = istToday(d)
  const t = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }).toLowerCase()
  return `${fmtShort(day)}, ${t}`
}
const dayOf = (iso?: string | null) => (iso ? fmtShort(istToday(new Date(iso))) : '')
const periodText = (r: PayrollRun) => `${fmtShort(r.periodStart)} – ${fmtShort(r.periodEnd)}`.replace(/ (\d{4}) – (\d+ \w+) \1$/, ' – $2 $1')
/** Every employee in the directory (pages of 200). */
async function loadDirectory() {
  const all: WorkforceEmployee[] = []
  for (let page = 0; page < 20; page++) {
    const r = await apiJson<PageResponse<WorkforceEmployee>>(`/v1/hrms/employees?page=${page}&pageSize=200`)
    all.push(...r.content)
    if (page + 1 >= r.totalPages) break
  }
  return all
}
const saveBlob = (blob: Blob, name: string) => { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url) }

export function PayrollContainer() {
  const navigate = useNavigate()
  const location = useLocation()
  const { id: runParam } = useParams()
  const [params] = useSearchParams()
  const mobile = useIsMobile()
  const qc = useQueryClient()
  const today = istToday()
  const path = location.pathname
  const section = path.startsWith('/hrms/payroll-dashboard') ? 'dashboard' : path.startsWith('/hrms/salary-structure') ? 'salary' : path.startsWith('/hrms/payroll/settings') ? 'settings'
    : path.startsWith('/hrms/pli') ? 'pli' : path.startsWith('/hrms/advances') ? 'advances' : path.startsWith('/hrms/bank-disbursement') ? 'bank' : 'runs'
  const runId = section === 'runs' ? runParam || '' : ''
  const [y, m] = [Number(today.slice(0, 4)), Number(today.slice(5, 7))]
  const monthStart = today.slice(0, 8) + '01', nextMonthStart = addDays(monthStart, 32).slice(0, 8) + '01'

  // ── permissions (the codes each endpoint checks) ──
  const canRuns = usePermission(P.PAYROLL_RUNS_READ), canManage = usePermission(P.PAYROLL_RUNS_MANAGE), canLock = usePermission(P.PAYROLL_RUNS_LOCK)
  const canStruct = usePermission(P.PAYROLL_STRUCTURE_READ), canStructManage = usePermission(P.PAYROLL_STRUCTURE_MANAGE)
  const canSettings = usePermission(P.PAYROLL_SETTINGS_READ), canSettingsEdit = usePermission(P.PAYROLL_SETTINGS_UPDATE)
  const canDisbRead = usePermission('hrms.disbursement.read'), canBuild = usePermission('hrms.disbursement.build'), canPost = usePermission('hrms.disbursement.post')
  const canProfiles = usePermission('hrms.bank_profile.read')
  const canPliRead = usePermission('hrms.pli.read'), canPliTarget = usePermission('hrms.pli.target.read'), canPliWrite = usePermission('hrms.pli.write'), canPliTargetWrite = usePermission('hrms.pli.target.write'), canPliSelf = usePermission('hrms.pli.read.self')
  const canAdvRead = usePermission('hrms.advance.read'), canAdvApprove = usePermission('hrms.advance.approve'), canAdvRequest = usePermission('hrms.advance.request.self')
  const canCompliance = usePermission('hrms.compliance.read'), canEmpRead = usePermission(P.HRMS_EMPLOYEE_READ)
  const pliAdmin = canPliRead || canPliTarget, advAdmin = canAdvRead
  const me = useMemo(() => { try { return jwtDecode<{ employee_id?: string; name?: string; given_name?: string }>(getAccessToken() || '') } catch { return {} as any } }, [])

  // ── shared data ──
  const { data: companies = [] } = useCompanies()
  const companyName = companies.length === 1 ? companies[0].name : companies.length ? 'All companies' : ''
  const runsQ = useRuns({}, { enabled: canRuns && ['dashboard', 'runs', 'salary', 'bank'].includes(section) })
  const runs = useMemo(() => runsQ.data ?? [], [runsQ.data])
  const byPeriod = (r: PayrollRun) => r.periodYear * 100 + r.periodMonth
  const sorted = useMemo(() => runs.slice().sort((a, b) => byPeriod(b) - byPeriod(a)), [runs])
  /** The run for this month (the dashboard's "this month's run"). */
  const thisMonthRun = sorted.find((r) => r.periodYear === y && r.periodMonth === m && r.status !== 'CANCELLED') || null
  const directoryQ = useQuery({ queryKey: ['hrms', 'employees', 'all-for-payroll'], queryFn: loadDirectory, enabled: canEmpRead && ['salary', 'pli', 'runs'].includes(section), staleTime: 300_000 })
  const directory = useMemo(() => directoryQ.data ?? [], [directoryQ.data])
  const deptIds = useMemo(() => [...new Set(companies.map((c) => c.id))], [companies])
  const deptQs = useQueries({ queries: deptIds.map((cid) => ({ queryKey: ['hrms', 'departments', cid], queryFn: () => apiJson<Department[]>(`/v1/hrms/departments?companyId=${cid}`), enabled: ['salary', 'pli', 'runs'].includes(section), staleTime: 300_000 })) })
  const deptName = useMemo(() => { const mp = new Map<string, string>(); deptQs.forEach((q) => (q.data ?? []).forEach((d) => mp.set(d.id, d.name))); return mp }, [deptQs])
  const empById = useMemo(() => new Map(directory.map((e) => [e.id, e])), [directory])
  const nameOfEmp = (e?: WorkforceEmployee) => (e ? [e.firstName, e.lastName].filter(Boolean).join(' ') : '')

  // ── Dashboard ──
  const kpisQ = useQuery({ queryKey: ['hrms', 'payroll', 'dashboard', 'kpis'], queryFn: () => apiJson<PayrollDashboardKpis>('/v1/payroll/dashboard/kpis'), enabled: canRuns && section === 'dashboard', staleTime: 60_000 })
  const allBatchesQ = useQuery({ queryKey: ['hrms', 'payroll', 'disbursement-batches', 'list', {}], queryFn: () => apiJson<DisbursementBatch[]>('/v1/payroll/disbursement/batches'), enabled: canDisbRead && ['dashboard', 'bank'].includes(section), staleTime: 15_000 })
  const filingsQ = useQuery({ queryKey: ['hrms', 'compliance', 'filings', undefined, 0, 50], queryFn: () => apiJson<Page<StatutoryFiling>>('/v1/compliance/filings?page=0&size=50'), enabled: canCompliance && section === 'dashboard', staleTime: 30_000 })
  const dashEligibleQ = useEligibleEmployees(thisMonthRun?.id || '', section === 'dashboard' && thisMonthRun?.status === 'DRAFT')

  // ── Runs + run page ──
  const createRun = useCreateRun()
  const runQ = useRun(runId)
  const run = runQ.data
  const runEmpsQ = useRunEmployees(run && run.status !== 'DRAFT' ? runId : '')
  const skippedQ = useRunSkipped(runId, !!run)
  const eligibleQ = useEligibleEmployees(runId, run?.status === 'DRAFT')
  const runBatchesQ = useQuery({ queryKey: ['hrms', 'payroll', 'disbursement-batches', 'list', { runId }], queryFn: () => apiJson<DisbursementBatch[]>(`/v1/payroll/disbursement/batches?runId=${runId}`), enabled: canDisbRead && !!runId, staleTime: 15_000 })
  const profilesQ = useQuery({ queryKey: ['hrms', 'payroll', 'bank-profiles', 'list', run?.companyId || 'all'], queryFn: () => apiJson<BankProfile[]>(`/v1/payroll/bank-profiles${run?.companyId ? `?companyId=${run.companyId}` : ''}`), enabled: canProfiles && (!!run || section === 'bank'), staleTime: 60_000 })
  const [slipEmp, setSlipEmp] = useState<string | null>(null)
  const slipQ = useRunPayslip(runId, slipEmp)
  const skippedIds = (skippedQ.data ?? []).map((k) => k.employeeId)
  const skippedStructQs = useQueries({ queries: skippedIds.map((id) => ({ queryKey: ['hrms', 'payroll', 'structure', 'employee', id], queryFn: () => apiJson<EmployeeSalaryStructure | null>(`/v1/payroll/structures/employee/${id}`).catch(() => null), enabled: canStruct })) })
  // Per-component totals: the API has none for a run, so small runs add up their payslips.
  const runEmps = runEmpsQ.data ?? []
  const totalsQ = useQuery({
    queryKey: ['hrms', 'payroll', 'runs', 'detail', runId, 'component-totals', run?.processedAt, runEmps.length],
    queryFn: async () => {
      const slips = await Promise.all(runEmps.map((e) => apiJson<{ earnings: { name: string; amount: number }[]; deductions: { name: string; amount: number }[] }>(`/v1/payroll/runs/${runId}/employees/${e.employeeId}/payslip`)))
      const add = (m: Map<string, number>, lines: { name: string; amount: number }[]) => lines.forEach((l) => m.set(l.name, (m.get(l.name) || 0) + num(l.amount)))
      const earn = new Map<string, number>(), ded = new Map<string, number>()
      slips.forEach((s) => { add(earn, s.earnings || []); add(ded, s.deductions || []) })
      return { earnings: [...earn.entries()], deductions: [...ded.entries()] }
    },
    enabled: !!run && run.status !== 'DRAFT' && runEmps.length > 0 && runEmps.length <= 60,
    staleTime: 300_000,
  })
  const activeAdvQ = useQuery({ queryKey: ['hrms', 'advance', 'company', 0, 'DISBURSED', 100], queryFn: () => apiJson<Page<AdvanceRequest>>('/v1/advance/requests?page=0&size=100&status=DISBURSED'), enabled: canAdvRead && (!!run || section === 'advances'), staleTime: 60_000 })
  const processRun = useProcessRun(runId), lockRun = useLockRun(runId), reopenRun = useReopenRun(runId)
  const buildBatch = useMutation({ mutationFn: (b: { runId: string; bankProfileId: string }) => apiJson<BatchDetail>('/v1/payroll/disbursement/batches', { method: 'POST', body: JSON.stringify(b) }), onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'payroll', 'disbursement-batches'] }) })
  const markPaid = useMutation({
    mutationFn: async ({ batch, utr }: { batch: { id: string; status: string }; utr: string }) => {
      // The API marks a batch paid only once it's posted (normally by downloading the file).
      if (batch.status === 'DRAFT') await apiJson(`/v1/payroll/disbursement/batches/${batch.id}/post`, { method: 'POST' })
      return apiJson<DisbursementBatch>(`/v1/payroll/disbursement/batches/${batch.id}/mark-paid`, { method: 'POST', body: JSON.stringify({ paymentReference: utr }) })
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['hrms', 'payroll'] }) },
  })
  const cancelBatch = useMutation({ mutationFn: (id: string) => apiJson(`/v1/payroll/disbursement/batches/${id}/cancel`, { method: 'POST' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'payroll', 'disbursement-batches'] }) })

  // ── Salary structure ──
  const [visible, setVisible] = useState<string[]>([])
  const salaryIds = section === 'salary' ? visible : []
  const structQs = useQueries({ queries: salaryIds.map((id) => ({ queryKey: ['hrms', 'payroll', 'structure', 'employee', id], queryFn: () => apiJson<EmployeeSalaryStructure | null>(`/v1/payroll/structures/employee/${id}`).catch((e) => { if (String(e?.message || '').includes('404')) return null; throw e }), enabled: canStruct })) })
  const settingsQ = useQuery({ queryKey: ['hrms', 'payroll', 'settings'], queryFn: () => apiJson<ApiPayrollSettings>('/v1/payroll/settings'), enabled: canSettings && ['salary', 'settings'].includes(section), staleTime: 60_000 })
  const [ptCode, setPtCode] = useState('')
  const slabCode = section === 'settings' ? ptCode : settingsQ.data?.ptEnabled ? settingsQ.data.ptStateCode || '' : ''
  const slabsQ = useQuery({ queryKey: ['hrms', 'payroll', 'pt-slabs', slabCode], queryFn: () => apiJson<PtSlab[]>(`/v1/payroll/pt-slabs/${slabCode}`), enabled: !!slabCode && ['salary', 'settings'].includes(section), staleTime: Infinity })
  const componentsQ = useQuery({ queryKey: ['hrms', 'payroll', 'components'], queryFn: () => apiJson<SalaryComponent[]>('/v1/payroll/components'), enabled: canStructManage && section === 'salary', staleTime: 30_000 })
  const salaryRun = sorted.find((r) => r.status === 'DRAFT' || r.status === 'PROCESSING') || thisMonthRun
  const salarySkippedQ = useRunSkipped(salaryRun?.id || '', section === 'salary' && !!salaryRun)
  const [newIds, setNewIds] = useState<string[]>([])
  const upsert = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiJson<EmployeeSalaryStructure>('/v1/payroll/structures', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: (_d, v) => { qc.invalidateQueries({ queryKey: ['hrms', 'payroll', 'structure', 'employee', v.employeeId as string] }); qc.invalidateQueries({ queryKey: ['hrms', 'payroll', 'structure', 'history', v.employeeId as string] }); qc.invalidateQueries({ queryKey: ['hrms', 'payroll', 'runs'] }) },
  })
  const saveSettings = useMutation({ mutationFn: (s: ApiPayrollSettings) => apiJson<ApiPayrollSettings>('/v1/payroll/settings', { method: 'PUT', body: JSON.stringify(s) }), onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'payroll', 'settings'] }) })

  // ── PLI ──
  const pliQ = useQuery({
    queryKey: ['hrms', 'pli', 'targets', 'all-pages'],
    queryFn: async () => { const all: PliTarget[] = []; for (let page = 0; page < 20; page++) { const r = await apiJson<Page<PliTarget>>(`/v1/pli/targets?page=${page}&size=20`); all.push(...r.content); if (r.last || page + 1 >= r.totalPages) break } return all },
    enabled: pliAdmin && section === 'pli', staleTime: 30_000,
  })
  const [awardsOpen, setAwardsOpen] = useState(false)
  const pliSave = useMutation({ mutationFn: ({ id, body }: { id: string | null; body: Record<string, unknown> }) => apiJson<PliTarget>(id ? `/v1/pli/targets/${id}` : '/v1/pli/targets', { method: id ? 'PUT' : 'POST', body: JSON.stringify(body) }), onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'pli'] }) })

  // ── Advances ──
  const advQ = useQuery({ queryKey: ['hrms', 'advance', 'company', 0, undefined, 100], queryFn: () => apiJson<Page<AdvanceRequest>>('/v1/advance/requests?page=0&size=100'), enabled: advAdmin && section === 'advances', staleTime: 30_000 })
  const [advView, setAdvView] = useState<string | null>(null)
  const [recoveryFor, setRecoveryFor] = useState<string | null>(null)
  const scheduleQ = useQuery({ queryKey: ['hrms', 'advance', 'schedule', advView], queryFn: () => apiJson<AdvanceScheduleRow[]>(`/v1/advance/${advView}/schedule`), enabled: !!advView && canAdvRead, staleTime: 30_000 })
  const decide = useAdvanceDecision(), requestAdv = useRequestAdvance()

  // ── Bank ──
  // ?run= (from a run's page) shows that run's bank file; otherwise this month's, or the latest locked one.
  const bankRunParam = section === 'bank' ? sorted.find((r) => r.id === params.get('run')) || null : null
  const bankRun = section === 'bank' ? bankRunParam ? bankRunParam : thisMonthRun && ['LOCKED', 'PAID', 'PROCESSING', 'DRAFT'].includes(thisMonthRun.status) ? thisMonthRun : sorted.find((r) => r.status === 'LOCKED') || sorted[0] || null : null
  const bankBatches = (allBatchesQ.data ?? [])
  const [bankView, setBankView] = useState<string | null>(null)
  const bankDetailQ = useQuery({ queryKey: ['hrms', 'payroll', 'disbursement-batches', 'detail', bankView], queryFn: () => apiJson<BatchDetail>(`/v1/payroll/disbursement/batches/${bankView}`), enabled: !!bankView && canDisbRead })
  // The current file's lines, to see who the server left out for missing bank details.
  const bankRunBatch = bankRun ? bankBatches.filter((b) => b.runId === bankRun.id && b.status !== 'CANCELLED').sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] || null : null
  const bankLinesQ = useQuery({ queryKey: ['hrms', 'payroll', 'disbursement-batches', 'detail', bankRunBatch?.id], queryFn: () => apiJson<BatchDetail>(`/v1/payroll/disbursement/batches/${bankRunBatch!.id}`), enabled: !!bankRunBatch && canDisbRead && (bankRunBatch.status === 'DRAFT' || bankRunBatch.status === 'POSTED') })
  const bankProfilesQ = useQuery({ queryKey: ['hrms', 'payroll', 'bank-profiles', 'list', bankRun?.companyId || 'all'], queryFn: () => apiJson<BankProfile[]>(`/v1/payroll/bank-profiles${bankRun?.companyId ? `?companyId=${bankRun.companyId}` : ''}`), enabled: canProfiles && section === 'bank', staleTime: 60_000 })

  const go = (path: string) => navigate(path)
  const done = (msg: string) => { toast.success(msg); return true }
  const failed = (title: string) => (e: unknown) => { toast.error(title, { description: errText(e) }); return false }
  const toRun = (r: PayrollRun): RunRow => {
    const status = STATUS[r.status] || 'draft', calc = status !== 'draft' && status !== 'cancelled'
    return {
      id: r.id, label: runLabel(r), companyId: r.companyId, company: r.companyName, year: r.periodYear, month: r.periodMonth, status,
      employees: calc ? r.employeeCount : null, gross: calc ? num(r.totalGross) : null, ded: calc ? num(r.totalDeductions) : null, net: calc ? num(r.totalNet) : null,
      processedAt: calc && r.processedAt ? dayOf(r.processedAt) : '', exceptions: calc ? r.skippedEmployeeCount || 0 : 0,
    }
  }
  const profileOf = (list: BankProfile[] | undefined, companyId?: string) => (list ?? []).filter((p) => p.isActive && (!companyId || p.companyId === companyId)).sort((a, b) => Number(b.isDefault) - Number(a.isDefault))[0] || null

  // ── px: each section's data and actions ──
  const px: Record<string, unknown> = {}
  if (section === 'dashboard') {
    const cur = thisMonthRun
    const prev = sorted.find((r) => byPeriod(r) < y * 100 + m && r.status !== 'DRAFT' && r.status !== 'CANCELLED')
    const grossBy = new Map<number, number>()
    for (const r of runs) if (r.status !== 'DRAFT' && r.status !== 'CANCELLED') grossBy.set(byPeriod(r), (grossBy.get(byPeriod(r)) || 0) + num(r.totalGross))
    const bars = Array.from({ length: 6 }, (_, i) => { const d = new Date(y, m - 1 - (5 - i), 1); return { m: MON[d.getMonth()], value: grossBy.get(d.getFullYear() * 100 + d.getMonth() + 1) || 0 } })
    const paidAt = new Map((allBatchesQ.data ?? []).filter((b) => b.status === 'PAID').map((b) => [b.runId, b.paidAt]))
    const LBL: Record<string, string> = { TDS: 'Income tax (TDS)', PF: 'Provident fund (PF)', ESI: 'ESI', PT: 'Professional tax', GRATUITY: 'Gratuity', OTHER: 'Other filing' }
    const data: PayDashData = {
      companyName, monthLabel: `${MON[m - 1]} ${y}`, monthShort: MON[m - 1],
      current: cur ? { id: cur.id, label: runLabel(cur), short: MON[cur.periodMonth - 1], status: STATUS[cur.status] || 'draft', net: cur.status === 'DRAFT' ? null : num(cur.totalNet), gross: cur.status === 'DRAFT' ? null : num(cur.totalGross), employees: cur.status === 'DRAFT' ? null : cur.employeeCount, eligible: dashEligibleQ.data ? dashEligibleQ.data.length : null, bankFile: (allBatchesQ.data ?? []).some((b) => b.runId === cur.id && (b.status === 'DRAFT' || b.status === 'POSTED')) } : null,
      prevGross: prev ? num(prev.totalGross) : null, pendingDisb: kpisQ.data ? kpisQ.data.pendingDisbursals : null, bars,
      dues: (filingsQ.data?.content ?? []).filter((f) => f.status === 'DUE' || f.status === 'LATE').sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 3)
        .map((f) => ({ what: LBL[f.filingType] || f.filingType, when: fmtShort(f.dueDate), amount: f.amount ? num(f.amount) : null, note: [f.period, f.status === 'LATE' ? 'overdue' : ''].filter(Boolean).join(' · ') })),
      recent: sorted.filter((r) => r.status === 'PAID' && r.id !== cur?.id).slice(0, 3).map((r) => ({ id: r.id, label: runLabel(r), employees: r.employeeCount, paidOn: dayOf(paidAt.get(r.id)), net: num(r.totalNet) })),
      hasRuns: runs.length > 0,
    }
    px.PayDashboard = { state: stateOf(runsQ), data, onRetry: () => { runsQ.refetch(); kpisQ.refetch() } }
  }
  if (section === 'runs' && !runId) {
    px.PayRuns = {
      // ?month=YYYY-MM (the dashboard's payroll chart) opens the list on that month.
      month: params.get('month') || '',
      state: stateOf(runsQ), runs: runs.map(toRun), companies: companies.map((c) => ({ id: c.id, name: c.name })), canManage, onRetry: () => runsQ.refetch(),
      onCreate: (q: { companyId: string; year: number; month: number }) => createRun.mutateAsync({ companyId: q.companyId, periodMonth: q.month, periodYear: q.year })
        .then((r) => { toast.success('Payroll run created'); navigate(`/hrms/payroll/runs/${r.id}`); return true }, failed('Could not create the run')),
    }
  }
  if (section === 'runs' && runId) {
    const status = run ? STATUS[run.status] || 'draft' : 'draft'
    const emps = runEmps.map((e) => { const w = empById.get(e.employeeId); return { id: e.employeeId, code: e.employeeCode, name: e.employeeName, role: '', dept: w?.departmentId ? deptName.get(w.departmentId) || '' : '', paidDays: num(e.paidDays), lop: num(e.lopDays), gross: num(e.gross), net: num(e.netPay) } })
    const skipped = (skippedQ.data ?? []).map((k: EligibleEmployee) => { const w = empById.get(k.employeeId); return { id: k.employeeId, code: k.employeeCode, name: k.employeeName, dept: w?.departmentId ? deptName.get(w.departmentId) || '' : '', joined: w?.dateOfJoining ? fmtShort(w.dateOfJoining) : '' } })
    const fixedIds = skippedIds.filter((id, i) => !!skippedStructQs[i]?.data)
    const batchesForRun = (runBatchesQ.data ?? []).filter((b) => b.status !== 'CANCELLED').sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    const batch = batchesForRun[0] || null
    const profile = profileOf(profilesQ.data, run?.companyId)
    const lop = emps.filter((e) => e.lop > 0), lopDays = lop.reduce((a, e) => a + e.lop, 0)
    const adv = (activeAdvQ.data?.content ?? []).filter((a) => a.companyId === run?.companyId && num(a.outstandingAmount) > 0)
    const monthName = run ? MONTHS[run.periodMonth - 1] : ''
    const paidBatch = (runBatchesQ.data ?? []).find((b) => b.status === 'PAID')
    const stamps = { created: run ? stamp(run.createdAt) : '', processed: run?.processedAt ? stamp(run.processedAt) : '', locked: run?.lockedAt ? stamp(run.lockedAt) : '', paid: paidBatch?.paidAt ? stamp(paidBatch.paidAt) : run?.status === 'PAID' ? 'Paid' : '' }
    const log: { what: string; who: string; when: string; kind: 'done' | 'warn' | 'info' }[] = []
    if (run) {
      log.push({ what: `Run created for ${runLabel(run)}`, who: '', when: stamps.created, kind: 'info' })
      if (run.processedAt) log.push({ what: `Processed · ${run.employeeCount} payslips calculated${run.skippedEmployeeCount ? `, ${run.skippedEmployeeCount} skipped` : ''}`, who: '', when: stamps.processed, kind: run.skippedEmployeeCount ? 'warn' : 'done' })
      if (run.lockedAt) log.push({ what: 'Locked · payslips are final', who: '', when: stamps.locked, kind: 'done' })
      if (batch || paidBatch) log.push({ what: `Bank file generated · ${(batch || paidBatch)!.batchReference}`, who: '', when: stamp((batch || paidBatch)!.createdAt), kind: 'done' })
      if (paidBatch) log.push({ what: `Marked as paid · reference ${paidBatch.paymentReference || '—'}`, who: '', when: stamps.paid, kind: 'done' })
    }
    const totals = totalsQ.data
    const data: RunPageData | undefined = run ? {
      run: { id: run.id, label: runLabel(run), company: run.companyName, period: periodText(run), status, fileTag: `${run.periodYear}-${String(run.periodMonth).padStart(2, '0')}`, employees: run.employeeCount, gross: num(run.totalGross), ded: num(run.totalDeductions), net: num(run.totalNet), eligible: eligibleQ.data ? eligibleQ.data.length : null, stamps },
      skipped, fixedIds, bankProfile: profile ? profile.profileName : null,
      batch: batch ? { id: batch.id, bank: profile?.id === batch.bankProfileId ? profile.profileName : 'Bank file', count: batch.beneficiaryCount, amount: num(batch.totalAmount), status: batch.status } : null,
      employees: emps,
      overview: {
        earnings: totals ? totals.earnings : null, deductions: totals ? totals.deductions : null,
        gross: num(run.totalGross), ded: num(run.totalDeductions), net: num(run.totalNet), employees: run.employeeCount, period: periodText(run),
        checks: [
          { key: 'att', icon: 'calendarCheck', title: `Attendance for ${monthName}`, detail: status === 'draft' ? 'Loss-of-pay days are worked out from attendance when you process.' : lopDays ? `${lopDays} loss-of-pay ${lopDays === 1 ? 'day' : 'days'} across ${lop.length} ${lop.length === 1 ? 'person' : 'people'}` : 'No loss-of-pay days', warn: false, cta: 'Daily Tracking', path: '/hrms/attendance?tab=team' },
          { key: 'pli', icon: 'target', title: 'Production-linked incentive', detail: 'Not added to payroll yet — PLI bonuses are paid out as awards.', warn: false, cta: 'PLI', path: '/hrms/pli' },
          { key: 'adv', icon: 'receipt', title: 'Advance & loan recoveries', detail: adv.length ? adv.slice(0, 2).map((a) => `${a.employeeName || 'Employee'} · ${new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(num(a.monthlyDeduction))} a month`).join(' · ') + (adv.length > 2 ? ` · ${adv.length - 2} more` : '') : canAdvRead ? 'No active recoveries' : 'Recoveries are deducted when you process', warn: false, cta: 'Advances', path: '/hrms/advances' },
          { key: 'sal', icon: 'fileText', title: 'Salary structures', detail: skipped.length ? `${skipped.length} ${skipped.length === 1 ? 'employee has' : 'employees have'} no salary structure and will be skipped` : 'Everyone in this run has a salary structure', warn: skipped.length > 0, cta: 'Salary Structure', path: '/hrms/salary-structure' },
        ],
        // Pay date and working days aren't kept by the API: a dash, not "Not yet".
        details: [['Period', periodText(run)], ['Pay date', '—'], ['Company', run.companyName], ['Employees', `${status === 'draft' ? eligibleQ.data?.length ?? '' : run.employeeCount}${skipped.length ? ` · ${skipped.length} skipped` : ''}`], ['Working days', '—'], ['Created', stamps.created], ['Processed', stamps.processed], ['Locked', stamps.locked], ['Paid', stamps.paid]],
        batch: batch ? { bank: profile?.id === batch.bankProfileId ? profile.profileName : 'Bank file', count: batch.beneficiaryCount, amount: num(batch.totalAmount), status: batch.status } : null,
        onDownloadBatch: batch ? () => downloadBatchFile(batch.id, `${batch.batchReference}.csv`).then(() => { qc.invalidateQueries({ queryKey: ['hrms', 'payroll', 'disbursement-batches'] }); toast.success('Bank file downloaded · upload it to your bank') }, failed('Could not download the file')) : undefined,
        log: log.reverse(),
      },
      slip: slipQ.data ? {
        name: slipQ.data.employeeName, code: slipQ.data.employeeCode, role: slipQ.data.designation || 'Employee', dept: (() => { const w = empById.get(slipQ.data!.employeeId); return w?.departmentId ? deptName.get(w.departmentId) || '—' : '—' })(),
        paidDays: slipQ.data.paidDays ?? null, workingDays: null, lop: slipQ.data.lopDays ?? null, pan: slipQ.data.panMasked || null, bank: slipQ.data.bankMasked || null,
        earnings: slipQ.data.earnings.map((l) => [l.name, num(l.amount)] as [string, number]), deductions: slipQ.data.deductions.map((l) => [l.name, num(l.amount)] as [string, number]),
        gross: num(slipQ.data.gross), ded: num(slipQ.data.totalDeductions), net: num(slipQ.data.netPay),
      } as Payslip : null,
      slipError: slipQ.isError ? 'Unable to load this payslip. It may no longer be available for this run.' : null,
    } : undefined
    px.PayrollRunPage = {
      state: runQ.isError ? 'error' : runQ.isLoading ? 'loading' : 'live', data, canManage, canLock, canBuild, canPost, initialTab: params.get('tab') || '',
      onRetry: () => { runQ.refetch(); runEmpsQ.refetch(); skippedQ.refetch() },
      actions: {
        retrySlip: () => { slipQ.refetch() },
        process: () => processRun.mutateAsync().then((r) => { qc.invalidateQueries({ queryKey: ['hrms', 'payroll', 'runs', 'detail', runId] }); qc.invalidateQueries({ queryKey: ['hrms', 'payroll', 'dashboard'] }); return done(`Payroll processed · ${r.employeeCount} payslips ready to review`) }, failed('Could not process payroll')),
        lock: () => lockRun.mutateAsync().then(() => { qc.invalidateQueries({ queryKey: ['hrms', 'payroll', 'dashboard'] }); return done('Payroll locked · payslips are final') }, failed('Could not lock the run')),
        reopen: async (reason: string) => {
          try {
            // The API won't reopen a run with a live bank file; cancel it first (as the dialog says).
            if (batch && (batch.status === 'DRAFT' || batch.status === 'POSTED')) await cancelBatch.mutateAsync(batch.id)
            await reopenRun.mutateAsync(reason)
            return done('Payroll reopened · payslips are back in draft')
          } catch (e) { return failed('Could not reopen the run')(e) }
        },
        prepare: () => profile && run ? buildBatch.mutateAsync({ runId: run.id, bankProfileId: profile.id }).then(() => done('Bank file ready to download'), failed('Could not prepare the bank file')) : false,
        markPaid: (utr: string) => batch ? markPaid.mutateAsync({ batch, utr }).then(() => done(`${run ? runLabel(run) : 'Run'} marked as paid`), failed('Could not mark the run as paid')) : (toast.error('Prepare the bank file first'), false),
        downloadRegister: () => apiBlob(`/v1/payroll/reports/salary-register?runId=${runId}`).then((b) => { saveBlob(b, `salary-register-${run ? runLabel(run).replace(' ', '-') : runId}.pdf`); toast.success('Payroll register downloaded') }, failed('Could not download the register')),
        openSlip: (empId: string | null) => setSlipEmp(empId),
        downloadSlip: (empId: string) => downloadPayslipPdf(runId, empId).then(() => toast.success('Payslip downloaded'), failed('Could not download the payslip')),
      },
    }
  }
  if (section === 'salary') {
    const active = directory.filter((e) => e.employmentStatus !== 'EXITED' && e.employmentStatus !== 'TERMINATED')
    const employees: SalaryRow[] = active.map((e) => ({ id: e.id, code: e.employeeCode, name: nameOfEmp(e), dept: e.departmentId ? deptName.get(e.departmentId) || '' : '', role: '' }))
      .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }))
    const structures: Record<string, StructureInfo | null | undefined> = {}
    salaryIds.forEach((id, i) => {
      const q = structQs[i], s = q?.data
      if (q?.isLoading) { structures[id] = undefined; return }
      if (!s) { structures[id] = null; return }
      const earn = (s.earnings ?? s.lines.filter((l) => l.category === 'EARNING'))
      const dedLines = (s.deductions ?? s.lines.filter((l) => l.category === 'DEDUCTION'))
      const amt = (code: string) => num(earn.find((l) => l.componentCode === code)?.monthlyAmount)
      const basic = amt('BASIC'), hra = amt('HRA'), gross = num(s.grossMonthly ?? earn.reduce((a, l) => a + num(l.monthlyAmount), 0))
      const codeName: Record<string, string> = { PF_EMPLOYEE: 'PF', PT: 'PT', ESI_EMPLOYEE: 'ESI', TDS: 'TDS', ADVANCE_RECOVERY: 'recovery' }
      structures[id] = {
        gross, net: num(s.netMonthly ?? gross - dedLines.reduce((a, l) => a + num(l.monthlyAmount), 0)), ctcAnnual: num(s.ctcAnnual), effectiveFrom: s.effectiveFrom,
        basic, hra, special: Math.max(0, gross - basic - hra), deductions: num(s.totalDeductions ?? dedLines.reduce((a, l) => a + num(l.monthlyAmount), 0)),
        dedCodes: dedLines.filter((l) => num(l.monthlyAmount) > 0).map((l) => codeName[l.componentCode] || l.componentCode).filter((v, i, a) => a.indexOf(v) === i),
        earnings: earn.filter((l) => l.componentId).map((l) => ({ componentId: l.componentId as string, code: l.componentCode, amount: num(l.monthlyAmount) })),
        ...({ raw: s } as object),
      } as StructureInfo
    })
    const st = settingsQ.data, slabs = slabsQ.data ?? []
    const calc: PayCalc | undefined = st ? {
      pfOn: st.pfEnabled, pfEmp: num(st.pfEmployeePercent), pfCeil: num(st.pfWageCeiling), pfApplyCeil: st.pfApplyCeiling, esiOn: st.esiEnabled, esiEmp: num(st.esiEmployeePercent), esiCeil: num(st.esiWageCeiling),
      ptFor: (g: number) => (st.ptEnabled ? num(slabs.find((sl) => g >= num(sl.minSalary) && (sl.maxSalary == null || g <= num(sl.maxSalary)))?.monthlyTax) : 0),
    } : undefined
    const missing = (salarySkippedQ.data ?? []).map((k) => { const w = empById.get(k.employeeId); return { id: k.employeeId, code: k.employeeCode, name: k.employeeName, dept: w?.departmentId ? deptName.get(w.departmentId) || '—' : '—', joined: w?.dateOfJoining ? fmtShort(w.dateOfJoining) : '—' } })
    const compId = new Map((componentsQ.data ?? []).map((c) => [c.code, c.id]))
    px.PaySalary = {
      state: stateOf(directoryQ), employees, structures, calc, missing, newIds, canEdit: canStructManage, focus: params.get('employee') || '',
      monthStart, nextMonthStart, runId: salaryRun?.id || '', runLabel: salaryRun ? runLabel(salaryRun) : '',
      onVisible: (ids: string[]) => setVisible((cur) => (cur.join(',') === ids.join(',') ? cur : ids)), onRetry: () => directoryQ.refetch(),
      onSave: async (q: { employeeId: string; name: string; monthly: number; effectiveFrom: string; isNew: boolean; lines: { componentId: string; code: string; amount: number }[] | null; current: (StructureInfo & { raw?: EmployeeSalaryStructure }) | null }) => {
        const cur = q.current?.raw
        let components: { componentId: string; monthlyAmount: number }[]
        if (q.lines) components = q.lines.map((l) => ({ componentId: l.componentId, monthlyAmount: l.amount }))
        else {
          const sp = designSplit(q.monthly)
          const missingCodes = Object.entries(sp).filter(([code, v]) => v > 0 && !compId.get(code)).map(([code]) => code)
          if (missingCodes.length) { toast.error('Salary components are missing', { description: `Add ${missingCodes.join(', ')} under Payroll Configuration first.` }); return false }
          components = Object.entries(sp).filter(([, v]) => v > 0).map(([code, v]) => ({ componentId: compId.get(code)!, monthlyAmount: v }))
        }
        const ctcAnnual = cur && q.current && q.current.gross ? Math.round((num(cur.ctcAnnual) * q.monthly) / q.current.gross) : q.monthly * 12
        const body = {
          employeeId: q.employeeId, ctcAnnual, effectiveFrom: q.effectiveFrom, taxRegime: cur?.taxRegime || 'NEW', pfApplicable: cur ? cur.pfApplicable : true, ...(cur ? { pfStatus: cur.pfStatus } : {}),
          revisionNote: 'Set on Salary Structure', components,
        }
        return upsert.mutateAsync(body).then(() => {
          if (q.isNew) setNewIds((ids) => [...ids, q.employeeId])
          return done(q.isNew ? `Salary structure added for ${q.name}` : `${q.name}’s salary structure saved · effective ${fmtShort(q.effectiveFrom)}`)
        }, failed('Could not save the salary structure'))
      },
    }
  }
  if (section === 'settings') {
    px.PaySettings = {
      state: settingsQ.isError ? 'error' : 'live', settings: settingsQ.data, access: canSettingsEdit ? 'edit' : canSettings ? 'view' : 'none', ptSlabs: slabsQ.data ?? [],
      onPtState: (code: string) => setPtCode(code), onRetry: () => settingsQ.refetch(), onGo: (sec: string) => sec === 'dashboard' && navigate('/hrms/payroll-dashboard'),
      onSave: (s: ApiPayrollSettings) => saveSettings.mutateAsync(s).then(() => ({ ok: true }), (e) => ({ ok: false, message: errText(e) })),
    }
  }
  if (section === 'pli') {
    const period = today.slice(0, 7), next = addDays(monthStart, 32).slice(0, 7)
    const headByDept = new Map<string, number>()
    for (const e of directory) if (e.departmentId && e.employmentStatus !== 'EXITED' && e.employmentStatus !== 'TERMINATED') headByDept.set(e.departmentId, (headByDept.get(e.departmentId) || 0) + 1)
    const targets = (pliQ.data ?? []).filter((t) => t.period === period)
    const rows: PliRow[] = targets.map((t) => ({
      id: t.id, team: t.title, target: num(t.targetValue), actual: num(t.actualValue), pool: num(t.payoutAmount), metric: t.metric,
      people: t.ownerType === 'EMPLOYEE' ? 1 : t.ownerType === 'DEPARTMENT' && t.ownerId ? headByDept.get(t.ownerId) ?? null : null,
    }))
    const reqOf = (t: PliTarget, patch: Record<string, unknown>) => ({ companyId: t.companyId, title: t.title, ownerType: t.ownerType, ownerId: t.ownerId, period: t.period, metric: t.metric, targetValue: num(t.targetValue), actualValue: num(t.actualValue), weightPercent: num(t.weightPercent), payoutAmount: num(t.payoutAmount), status: t.status, notes: t.notes, ...patch })
    px.PayPli = {
      state: stateOf(pliQ), rows, monthName: MONTHS[m - 1], nextMonthLabel: `${MONTHS[m % 12]} ${m === 12 ? y + 1 : y}`, periodKey: period, canWrite: canPliWrite || canPliTargetWrite,
      onRetry: () => pliQ.refetch(), onAwards: () => setAwardsOpen(true),
      onSave: (id: string, v: { targetValue: number; actualValue: number; payoutAmount: number }) => { const t = targets.find((x) => x.id === id); return t ? pliSave.mutateAsync({ id, body: reqOf(t, v) }).then(() => done(`PLI saved for ${t.title}`), failed('Could not save PLI')) : false },
      onSaveTargets: async (list: { row: PliRow; targetValue: number }[]) => {
        try {
          for (const { row, targetValue } of list) {
            const t = targets.find((x) => x.id === row.id)!
            const existing = (pliQ.data ?? []).find((x) => x.period === next && x.title === t.title && x.ownerType === t.ownerType && (x.ownerId || '') === (t.ownerId || ''))
            await pliSave.mutateAsync(existing ? { id: existing.id, body: reqOf(existing, { targetValue }) } : { id: null, body: reqOf(t, { period: next, targetValue, actualValue: 0, status: 'ACTIVE' }) })
          }
          return done(`Monthly targets saved for ${MON[m % 12]} ${m === 12 ? y + 1 : y}`)
        } catch (e) { return failed('Could not save the targets')(e) }
      },
    }
  }
  if (section === 'advances') {
    const rows: AdvRow[] = (advQ.data?.content ?? []).map((a) => ({
      id: a.id, empId: a.employeeId, name: a.employeeName || 'Employee', code: a.employeeCode || '', type: a.reason?.trim() ? a.reason.trim().slice(0, 40) : 'Salary advance',
      principal: num(a.amount), emi: num(a.monthlyDeduction), months: a.repaymentMonths, left: num(a.outstandingAmount), status: a.status, raw: a,
    }))
    const plan: AdvPlanRow[] | null = scheduleQ.data ? scheduleQ.data.map((r) => ({ month: r.scheduledMonth, amount: num(r.scheduledAmount), status: r.status })) : null
    px.PayAdvances = {
      state: stateOf(advQ), rows, plan, me: me.employee_id || '', meLabel: me.name || me.given_name || '', canApprove: canAdvApprove, canRequest: canAdvRequest,
      decisionActions: AdvanceDecisionActions, onView: (id: string) => setAdvView(id), onRecovery: (id: string) => setRecoveryFor(id), onRetry: () => advQ.refetch(),
      onApprove: (id: string) => decide.mutateAsync({ id, approved: true }).then(() => done('Advance approved'), failed('Could not approve the advance')),
      onRequest: (q: { amount: number; reason: string; repaymentMonths: number }) => requestAdv.mutateAsync(q).then(() => done('Advance request sent for approval'), failed('Could not send the request')),
    }
  }
  if (section === 'bank') {
    const rb = bankRun ? bankBatches.filter((b) => b.runId === bankRun.id && b.status !== 'CANCELLED').sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] || null : null
    const profiles = bankProfilesQ.data ?? []
    const nameOfProfile = (id: string) => profiles.find((p) => p.id === id)?.profileName || 'Bank file'
    const excludedOf = (b: DisbursementBatch) => (bankLinesQ.data && bankLinesQ.data.batch.id === b.id ? bankLinesQ.data.lines.filter((l) => l.status !== 'READY').map((l) => ({ id: l.employeeId, name: l.beneficiaryName || 'Employee', code: empById.get(l.employeeId)?.employeeCode || '' })) : undefined)
    const toBatch = (b: DisbursementBatch): BankBatch => ({ id: b.id, reference: b.batchReference, bank: nameOfProfile(b.bankProfileId), count: b.beneficiaryCount, amount: num(b.totalAmount), status: b.status, excluded: excludedOf(b) })
    const lines = bankDetailQ.data?.lines ?? null
    const data: BankData = {
      run: bankRun ? { id: bankRun.id, label: runLabel(bankRun), status: STATUS[bankRun.status] || 'draft', net: num(bankRun.totalNet), employees: bankRun.employeeCount } : null,
      batch: rb ? toBatch(rb) : null, profile: bankRun ? profileOf(profiles, bankRun.companyId)?.profileName || null : null,
      history: bankBatches.filter((b) => b.status === 'PAID' && b.runId !== bankRun?.id).sort((a, b) => (b.paidAt || '').localeCompare(a.paidAt || '')).map(toBatch),
      people: lines ? lines.map((l) => ({ name: l.beneficiaryName, code: empById.get(l.employeeId)?.employeeCode || '', acct: `•••• ${l.accountNoLast4}`, net: num(l.amount) })) : null,
    }
    px.PayBank = {
      state: stateOf(runsQ), data, canBuild, canPost, onRetry: () => { runsQ.refetch(); allBatchesQ.refetch() },
      onView: (id: string) => setBankView(id), onProfiles: () => navigate('/hrms/bank-disbursement/setup'),
      onDownload: (b: BankBatch) => downloadBatchFile(b.id, `${b.reference}.csv`).then(() => { qc.invalidateQueries({ queryKey: ['hrms', 'payroll', 'disbursement-batches'] }); toast.success('Bank file downloaded · upload it to your bank') }, failed('Could not download the file')),
      onConfirm: (b: BankBatch, utr: string) => markPaid.mutateAsync({ batch: b, utr }).then(() => done(`${b.bank} transfer confirmed · ${bankRun ? runLabel(bankRun) : 'run'} marked as paid`), failed('Could not confirm the transfer')),
      onFixEmployee: (id: string) => navigate(`/hrms/employees/${id}?tab=payroll`),
      // Building again for the same run and profile refreshes the draft from everyone's current bank details.
      onRebuild: () => (rb && bankRun ? buildBatch.mutateAsync({ runId: bankRun.id, bankProfileId: rb.bankProfileId }).then(() => { bankLinesQ.refetch(); return done('Bank file rebuilt from current bank details') }, failed('Could not rebuild the bank file')) : false),
      onCancelBatch: (b: BankBatch) => cancelBatch.mutateAsync(b.id).then(() => done('Bank file cancelled · prepare a new one from the run'), failed('Could not cancel the bank file')),
    }
  }

  // People without the admin view keep their own pages (My Incentives, My Advances).
  if (section === 'pli' && !pliAdmin) return <Pli />
  if (section === 'advances' && !advAdmin) return <Advance />

  const visibleSections = [
    canRuns && 'dashboard', canRuns && 'salary', canRuns && 'runs', canSettings && 'settings', (pliAdmin || canPliSelf) && 'pli', (advAdmin || canAdvRequest || canAdvApprove) && 'advances', canRuns && 'bank',
  ].filter(Boolean) as string[]
  return (
    <DesignFrame>
      {/* The design pulls the page up so its section bar sits right under the header. */}
      <div style={{ marginTop: -24 }}>
        <PayrollModule
          section={section} runId={runId} runTab={params.get('tab') || ''} focus={params.get('employee') || ''} sections={visibleSections}
          mobile={mobile} canManage={canManage} settingsAccess={canSettingsEdit ? 'edit' : canSettings ? 'view' : 'none'}
          onNavigate={go} onToast={(msg: string) => toast.message(msg)} px={px}
        />
      </div>
      {awardsOpen && (
        <HrDrawer title="PLI awards" onClose={() => setAwardsOpen(false)} width="max-w-4xl">
          <AllAwardsTab canWrite={canPliWrite} />
        </HrDrawer>
      )}
      {recoveryFor && <AdvanceDetail id={recoveryFor} onClose={() => setRecoveryFor(null)} />}
    </DesignFrame>
  )
}

