import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiJson } from '@/core/api/client'
import type { EmployeeKpiRow, KpiPage } from './usePerformance'

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
}
export interface KpiProgressEntry {
  id: string
  previousValue?: number
  newValue: number
  progressPct: number
  notes?: string
  updatedBy?: string
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
