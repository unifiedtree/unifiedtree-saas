import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiJson } from '@/core/api/client'

export type ComponentCategory = 'EARNING' | 'DEDUCTION' | 'EMPLOYER_CONTRIBUTION' | 'REIMBURSEMENT'

export interface PayrollSettings {
  pfEnabled: boolean
  pfEmployeePercent: number
  pfEmployerPercent: number
  pfWageCeiling: number
  pfApplyCeiling: boolean
  pfEstablishmentCode?: string | null
  esiEnabled: boolean
  esiEmployeePercent: number
  esiEmployerPercent: number
  esiWageCeiling: number
  esiEstablishmentCode?: string | null
  ptEnabled: boolean
  ptStateCode?: string | null
  lwfEnabled: boolean
  lwfEmployeeAmount: number
  lwfEmployerAmount: number
  sandwichRuleEnabled: boolean
  lateMarkLopThreshold?: number | null
  payrollCycleStartDay: number
  payrollCycleEndDay: number
  salaryProcessingDay: number
}

export interface SalaryComponent {
  id: string
  code: string
  name: string
  category: ComponentCategory
  isStatutory: boolean
  isTaxable: boolean
  computationType: string
  percentValue?: number | null
  displayOrder: number
  isSystem: boolean
  isActive: boolean
}

export interface StructureLine {
  componentId: string
  componentCode: string
  componentName: string
  category: ComponentCategory
  monthlyAmount: number
}

export interface EmployeeSalaryStructure {
  id: string
  employeeId: string
  ctcAnnual: number
  ctcMonthly: number
  pfApplicable: boolean
  pfStatus: string
  taxRegime: 'OLD' | 'NEW'
  effectiveFrom: string
  isCurrent: boolean
  revisionNote?: string | null
  lines: StructureLine[]
}

export interface PtSlab {
  id: string
  stateCode: string
  stateName: string
  minSalary: number
  maxSalary?: number | null
  monthlyTax: number
}

export interface CreateStructurePayload {
  employeeId: string
  ctcAnnual: number
  effectiveFrom: string
  taxRegime?: 'OLD' | 'NEW'
  pfApplicable?: boolean
  revisionNote?: string
  components?: { componentId: string; monthlyAmount: number }[]
}

const KEY = ['hrms', 'payroll'] as const

export function usePayrollSettings() {
  return useQuery({
    queryKey: [...KEY, 'settings'],
    queryFn: () => apiJson<PayrollSettings>('/v1/payroll/settings'),
    staleTime: 60_000,
  })
}

export function useUpdatePayrollSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Partial<PayrollSettings>) =>
      apiJson<PayrollSettings>('/v1/payroll/settings', { method: 'PUT', body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...KEY, 'settings'] }),
  })
}

export function useSalaryComponents() {
  return useQuery({
    queryKey: [...KEY, 'components'],
    queryFn: () => apiJson<SalaryComponent[]>('/v1/payroll/components'),
    staleTime: 30_000,
  })
}

export function useSeedDefaultComponents() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => apiJson<{ seeded: boolean; componentCount: number }>(
      '/v1/payroll/components/seed-defaults', { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...KEY, 'components'] }),
  })
}

export function useCreateComponent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Partial<SalaryComponent>) =>
      apiJson('/v1/payroll/components', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...KEY, 'components'] }),
  })
}

export function useUpdateComponent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<SalaryComponent> }) =>
      apiJson(`/v1/payroll/components/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...KEY, 'components'] }),
  })
}

export function useDeleteComponent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiJson<void>(`/v1/payroll/components/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...KEY, 'components'] }),
  })
}

export function useEmployeeStructure(employeeId: string) {
  return useQuery({
    queryKey: [...KEY, 'structure', 'employee', employeeId],
    queryFn: () => apiJson<EmployeeSalaryStructure | null>(`/v1/payroll/structures/employee/${employeeId}`),
    enabled: !!employeeId,
  })
}

export function useStructureHistory(employeeId: string) {
  return useQuery({
    queryKey: [...KEY, 'structure', 'history', employeeId],
    queryFn: () => apiJson<EmployeeSalaryStructure[]>(`/v1/payroll/structures/employee/${employeeId}/history`),
    enabled: !!employeeId,
  })
}

export function useMySalaryStructure() {
  return useQuery({
    queryKey: [...KEY, 'structure', 'me'],
    queryFn: () => apiJson<EmployeeSalaryStructure | null>('/v1/payroll/structures/me'),
  })
}

export function useUpsertStructure() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateStructurePayload) =>
      apiJson<EmployeeSalaryStructure>('/v1/payroll/structures', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: [...KEY, 'structure', 'employee', vars.employeeId] })
      qc.invalidateQueries({ queryKey: [...KEY, 'structure', 'history', vars.employeeId] })
    },
  })
}

export function usePtSlabs(state: string | undefined) {
  return useQuery({
    queryKey: [...KEY, 'pt-slabs', state],
    queryFn: () => apiJson<PtSlab[]>(`/v1/payroll/pt-slabs/${state}`),
    enabled: !!state,
    staleTime: Infinity,
  })
}

// ─── Wave 1: Payroll Dashboard aggregates ───────────────────────────────────

export interface PayrollDashboardKpis {
  totalPayrollCost: number
  averageSalary: number
  pendingDisbursals: number
  tdsLiability: number
  currentPeriodLabel: string
  currentPeriodMonth: number
  currentPeriodYear: number
}

export interface PayrollTrendPoint {
  periodMonth: number
  periodYear: number
  label: string            // "MAR", "APR", ...
  totalPayrollCost: number
  runCount: number
}

/**
 * Current-period KPI tiles for the Payroll landing page. Aggregates over
 * payroll.payslip_lines for the LATEST period that has at least one run —
 * falls back to zeros for a fresh tenant, so the dashboard never crashes.
 */
export function usePayrollDashboardKpis() {
  return useQuery({
    queryKey: [...KEY, 'dashboard', 'kpis'],
    queryFn: () => apiJson<PayrollDashboardKpis>('/v1/payroll/dashboard/kpis'),
    // Numbers are aggregates of frozen LOCKED runs, so 60s is enough — no
    // reason to re-fetch on every render but also fine to be a minute stale.
    staleTime: 60_000,
  })
}

/**
 * Trailing N-month cost trend for the chart. Always returns exactly `months`
 * points; empty periods come back with 0 so the chart draws a continuous line.
 */
export function usePayrollCostTrend(months: number = 6) {
  return useQuery({
    queryKey: [...KEY, 'dashboard', 'trend', months],
    queryFn: () => apiJson<PayrollTrendPoint[]>(`/v1/payroll/dashboard/trend?months=${months}`),
    staleTime: 60_000,
  })
}
