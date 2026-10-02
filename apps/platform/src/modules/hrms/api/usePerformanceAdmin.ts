import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiJson } from '@/core/api/client'
import type { CycleMilestones, EmployeeKpiRow, KpiPage } from './usePerformance'
import { asAvailable, useAvailableMutation, useAvailableQuery } from './shared/available'

export type KpiStatus = 'ACTIVE' | 'AT_RISK' | 'COMPLETED' | 'DROPPED'
export type KpiDirection = 'HIGHER_IS_BETTER' | 'LOWER_IS_BETTER' | 'TARGET_EXACT'
export interface KpiPayload {
  ownerId: string
  title: string
  description?: string
  category?: string
  targetValue: number
  currentValue?: number
  unit?: string
  direction: KpiDirection
  weight: number
  dueDate?: string
  status?: KpiStatus
  /** BW-83: link to a company KPI; `clearCompanyKpi` removes the link (edit only). */
  companyKpiId?: string
  clearCompanyKpi?: boolean
}
export interface KpiProgressEntry {
  id: string
  previousValue?: number
  newValue: number
  progressPct: number
  notes?: string
  updatedBy?: string
  /** Who recorded it (their name); null when unknown. */
  updatedByName?: string | null
  updatedAt: string
}
export interface CycleProgress {
  cycleId: string
  cycleName: string
  status: string
  totalAssignments: number
  completedAssignments: number
  overallPct: number
  reviewees: {
    revieweeId: string
    revieweeName?: string
    revieweeCode?: string
    totalAssignments: number
    completedAssignments: number
    completionPct: number
    assignments: { reviewerType: string; reviewerId: string; reviewerName?: string; status: string }[]
  }[]
}
export interface InitiationResult {
  cycleId: string
  revieweesConsidered: number
  assignmentsCreated: number
  reviewsCreated: number
  skips: string[]
}

export function useAdminKpis(filters: { search: string; status: string; page: number; size: number }) {
  const params = new URLSearchParams({ page: String(filters.page), size: String(filters.size) })
  if (filters.search) params.set('search', filters.search)
  if (filters.status) params.set('status', filters.status)
  return useQuery({
    queryKey: ['performance', 'kpis', 'admin', filters],
    queryFn: () => apiJson<KpiPage>(`/v1/performance/kpis?${params}`),
    staleTime: 15_000,
  })
}

function useRefreshPerformance() {
  const client = useQueryClient()
  return async () => { await Promise.all([
    client.invalidateQueries({ queryKey: ['performance', 'kpis'] }),
    client.invalidateQueries({ queryKey: ['hrms', 'performance'] }),
  ]) }
}

export function useSaveKpi() {
  const refresh = useRefreshPerformance()
  return useMutation({
    mutationFn: ({ id, payload }: { id?: string; payload: KpiPayload }) => {
      const { currentValue, ...update } = payload
      return apiJson<EmployeeKpiRow>(`/v1/performance/kpis${id ? `/${id}` : ''}`, {
        method: id ? 'PUT' : 'POST', body: JSON.stringify(id ? update : payload),
      })
    },
    onSuccess: refresh,
  })
}

export function useRecordKpiProgress() {
  const refresh = useRefreshPerformance()
  return useMutation({
    mutationFn: ({ id, newValue, notes }: { id: string; newValue: number; notes?: string }) =>
      apiJson<EmployeeKpiRow>(`/v1/performance/kpis/${id}/progress`, { method: 'PUT', body: JSON.stringify({ newValue, notes }) }),
    onSuccess: refresh,
  })
}

export function useDropKpi() {
  const refresh = useRefreshPerformance()
  return useMutation({
    mutationFn: (id: string) => apiJson<void>(`/v1/performance/kpis/${id}`, { method: 'DELETE' }),
    onSuccess: refresh,
  })
}

export function useKpiHistory(id: string) {
  return useQuery({ queryKey: ['performance', 'kpis', 'history', id], queryFn: () => apiJson<KpiProgressEntry[]>(`/v1/performance/kpis/${id}/history`) })
}

export function useCycleProgress(id: string) {
  return useQuery({ queryKey: ['hrms', 'performance', 'cycle-progress', id], queryFn: () => apiJson<CycleProgress>(`/v1/performance/cycles/${id}/progress`) })
}

export function useInitiateReviews() {
  const refresh = useRefreshPerformance()
  return useMutation({
    mutationFn: ({ id, employeeIds, reviewerTypes, peerCount }: { id: string; employeeIds?: string[]; reviewerTypes: string[]; peerCount?: number }) =>
      apiJson<InitiationResult>(`/v1/performance/cycles/${id}/initiate`, {
        method: 'POST', body: JSON.stringify({ reviewerTypes, revieweeIds: employeeIds, peerCount }),
      }),
    onSuccess: refresh,
  })
}

export function useCloseCycle() {
  const refresh = useRefreshPerformance()
  return useMutation({
    mutationFn: (id: string) => apiJson<{ cycleId: string; missedMarked: number; reviewsMissedMarked: number }>(`/v1/performance/cycles/${id}/close`, { method: 'POST' }),
    onSuccess: refresh,
  })
}

// ── Redesign P-GROW (BW-78 … BW-83) ─────────────────────────────────────────
// Writes and reads over V143.61's tables come back as "not available" (never an
// error, never retried) until the migration is applied: the page hides that block.

/** Reviews and submitted per cycle, in your performance scope (BW-79). */
export interface CycleCount { cycleId: string; reviews: number; submitted: number; missed: number; waiting: number }

export function useCycleSummary(enabled = true) {
  return useQuery({
    queryKey: ['hrms', 'performance', 'cycles', 'summary'],
    queryFn: () => apiJson<CycleCount[]>('/v1/performance/cycles/summary'),
    staleTime: 15_000,
    enabled,
  })
}

export interface StageRow { reviewerType: string; total: number; submitted: number; waiting: number; missed: number }
export interface CycleStages {
  cycleId: string
  name: string
  status: string
  periodStart?: string | null
  periodEnd?: string | null
  reviewees: number
  rows: StageRow[]
  milestones?: CycleMilestones | null
}

export function useCycleStages(id: string | undefined) {
  return useQuery({
    queryKey: ['hrms', 'performance', 'cycles', 'stages', id],
    queryFn: () => apiJson<CycleStages>(`/v1/performance/cycles/${id}/stages`),
    enabled: !!id,
    staleTime: 15_000,
  })
}

export interface CycleRatings { cycleId: string; total: number; average: number | null; buckets: { rating: number; count: number }[] }

export function useCycleRatings(id: string | undefined) {
  return useQuery({
    queryKey: ['hrms', 'performance', 'cycles', 'ratings', id],
    queryFn: () => apiJson<CycleRatings>(`/v1/performance/cycles/${id}/ratings`),
    enabled: !!id,
    staleTime: 15_000,
  })
}

export interface MilestonesPayload {
  goalsBy?: string | null
  selfReviewBy?: string | null
  managerReviewBy?: string | null
  shareOn?: string | null
  holdUntilShared?: boolean
}

/** PUT a cycle's step dates (hrms.performance.write). Resolves {available:false} before V143.61. */
export function useSaveMilestones() {
  const refresh = useRefreshPerformance()
  return useAvailableMutation<CycleMilestones, { id: string } & MilestonesPayload>({
    mutationFn: ({ id, ...body }) => asAvailable(() => apiJson<CycleMilestones>(`/v1/performance/cycles/${id}/milestones`, { method: 'PUT', body: JSON.stringify(body) })),
    onSuccess: refresh,
  })
}

/** Share a cycle's held feedback with the people reviewed (hrms.performance.write). */
export function useShareCycle() {
  const refresh = useRefreshPerformance()
  return useAvailableMutation<CycleMilestones, string>({
    mutationFn: (id) => asAvailable(() => apiJson<CycleMilestones>(`/v1/performance/cycles/${id}/share`, { method: 'POST' })),
    onSuccess: refresh,
  })
}

/** Remind a reviewer (hrms.performance.write): sends them a notification; once a day per review. */
export function useRemindReview() {
  const refresh = useRefreshPerformance()
  return useMutation({
    mutationFn: (id: string) => apiJson<{ reviewId: string; newReminderCount: number; sentAt: string }>(`/v1/performance/reviews/${id}/remind`, { method: 'POST' }),
    onSuccess: refresh,
  })
}

/** Goals & KPIs tiles, in the same scope as the list (BW-82). */
export interface KpiSummary { total: number; completed: number; atRisk: number; reachedPct: number; averageProgress: number }

export function useKpiSummary(enabled = true) {
  return useQuery({
    queryKey: ['performance', 'kpis', 'summary'],
    queryFn: () => apiJson<KpiSummary>('/v1/performance/kpis/summary'),
    staleTime: 15_000,
    enabled,
  })
}

/** A company KPI with the weighted average progress of the goals linked to it (BW-83). */
export interface CompanyKpi {
  id: string
  companyId: string
  title: string
  description?: string | null
  targetValue?: number | null
  unit?: string | null
  dueDate?: string | null
  status: 'ACTIVE' | 'COMPLETED' | 'DROPPED'
  /** Null when no goal is linked yet. */
  progress: number | null
  linkedGoals: number
}

export function useCompanyKpis(opts?: { companyId?: string; includeDropped?: boolean; enabled?: boolean }) {
  const qs = new URLSearchParams()
  if (opts?.companyId) qs.set('companyId', opts.companyId)
  if (opts?.includeDropped) qs.set('includeDropped', 'true')
  return useAvailableQuery<CompanyKpi[]>({
    queryKey: ['performance', 'company-kpis', opts?.companyId ?? 'all', !!opts?.includeDropped],
    queryFn: () => asAvailable(() => apiJson<CompanyKpi[]>(`/v1/performance/company-kpis${qs.size ? `?${qs}` : ''}`)),
    enabled: opts?.enabled ?? true,
    staleTime: 30_000,
  })
}

export interface CompanyKpiPayload {
  companyId?: string
  title?: string
  description?: string
  targetValue?: number | null
  unit?: string
  dueDate?: string | null
  status?: 'ACTIVE' | 'COMPLETED' | 'DROPPED'
}

export function useSaveCompanyKpi() {
  const qc = useQueryClient()
  return useAvailableMutation<CompanyKpi, { id?: string; payload: CompanyKpiPayload }>({
    mutationFn: ({ id, payload }) => asAvailable(() => apiJson<CompanyKpi>(`/v1/performance/company-kpis${id ? `/${id}` : ''}`, {
      method: id ? 'PUT' : 'POST', body: JSON.stringify(payload),
    })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['performance'] }),
  })
}
