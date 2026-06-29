import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiJson } from '@/core/api/client'

// Mirrors backend com.hrms.performance.enums
export type CycleStatus = 'DRAFT' | 'ACTIVE' | 'CLOSED'
export type ReviewStatus = 'PENDING' | 'SUBMITTED' | 'ACKNOWLEDGED'
export type GoalStatus = 'ACTIVE' | 'COMPLETED' | 'DROPPED'

export interface ReviewCycle {
  id: string
  companyId: string
  name: string
  periodStart?: string
  periodEnd?: string
  status: CycleStatus
  createdAt: string
}

export interface PerformanceReview {
  id: string
  cycleId: string
  employeeId: string
  employeeName?: string
  employeeCode?: string
  reviewerId?: string
  reviewerName?: string
  status: ReviewStatus
  overallRating?: number | null
  strengths?: string
  improvements?: string
  submittedAt?: string
  createdAt: string
}

export interface Goal {
  id: string
  employeeId: string
  cycleId?: string
  title: string
  description?: string
  weight: number
  progress: number
  status: GoalStatus
  createdAt: string
}

export interface Page<T> {
  content: T[]
  page: number
  size: number
  totalElements: number
  totalPages: number
  last: boolean
}

// ── Cycles ─────────────────────────────────────────────────────────────────

export function useReviewCycles(enabled = true) {
  return useQuery({
    queryKey: ['hrms', 'performance', 'cycles'],
    queryFn: () => apiJson<ReviewCycle[]>('/v1/performance/cycles'),
    staleTime: 30_000,
    enabled,
  })
}

export interface CreateCyclePayload {
  companyId?: string
  name: string
  periodStart?: string
  periodEnd?: string
}

export function useCreateCycle() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateCyclePayload) =>
      apiJson<ReviewCycle>('/v1/performance/cycles', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'performance', 'cycles'] }),
  })
}

export function useActivateCycle() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiJson<ReviewCycle>(`/v1/performance/cycles/${id}/activate`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'performance', 'cycles'] }),
  })
}

// ── Reviews ────────────────────────────────────────────────────────────────

export function useMyReviews() {
  return useQuery({
    queryKey: ['hrms', 'performance', 'reviews', 'my'],
    queryFn: () => apiJson<PerformanceReview[]>('/v1/performance/reviews/my'),
    staleTime: 30_000,
  })
}

export function useReviews(cycleId: string | undefined, page = 0, enabled = true) {
  return useQuery({
    queryKey: ['hrms', 'performance', 'reviews', cycleId ?? 'all', page],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), size: '20' })
      if (cycleId) params.set('cycleId', cycleId)
      return apiJson<Page<PerformanceReview>>(`/v1/performance/reviews?${params.toString()}`)
    },
    staleTime: 15_000,
    enabled,
  })
}

export interface CreateReviewPayload {
  cycleId: string
  employeeId: string
}

export function useCreateReview() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateReviewPayload) =>
      apiJson<PerformanceReview>('/v1/performance/reviews', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'performance', 'reviews'] }),
  })
}

export interface SubmitReviewPayload {
  overallRating: number
  strengths?: string
  improvements?: string
}

export function useSubmitReview() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: SubmitReviewPayload & { id: string }) =>
      apiJson<PerformanceReview>(`/v1/performance/reviews/${id}/submit`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'performance', 'reviews'] }),
  })
}

// ── Goals ──────────────────────────────────────────────────────────────────

export function useMyGoals() {
  return useQuery({
    queryKey: ['hrms', 'performance', 'goals', 'my'],
    queryFn: () => apiJson<Goal[]>('/v1/performance/goals/my'),
    staleTime: 30_000,
  })
}

export interface CreateGoalPayload {
  title: string
  description?: string
  weight?: number
  cycleId?: string
}

export function useCreateGoal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateGoalPayload) =>
      apiJson<Goal>('/v1/performance/goals', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'performance', 'goals'] }),
  })
}

export function useUpdateGoalProgress() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, progress }: { id: string; progress: number }) =>
      apiJson<Goal>(`/v1/performance/goals/${id}/progress`, {
        method: 'PUT',
        body: JSON.stringify({ progress }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'performance', 'goals'] }),
  })
}
