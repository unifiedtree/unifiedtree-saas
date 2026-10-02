import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiJson } from '@/core/api/client'

// Mirrors backend com.hrms.performance.enums
export type CycleStatus = 'DRAFT' | 'ACTIVE' | 'CLOSED'
export type ReviewStatus = 'PENDING' | 'IN_PROGRESS' | 'MISSED' | 'SUBMITTED' | 'ACKNOWLEDGED'
export type GoalStatus = 'ACTIVE' | 'AT_RISK' | 'COMPLETED' | 'DROPPED'

/** A cycle's step dates (BW-78). Null fields aren't set. */
export interface CycleMilestones {
  goalsBy: string | null
  selfReviewBy: string | null
  managerReviewBy: string | null
  shareOn: string | null
  holdUntilShared: boolean
  sharedAt: string | null
}

export interface ReviewCycle {
  id: string
  companyId: string
  name: string
  periodStart?: string
  periodEnd?: string
  status: CycleStatus
  createdAt: string
  /** BW-78: null until V143.61 is applied (then every cycle has one, empty when no dates are set). */
  milestones?: CycleMilestones | null
}

export interface PerformanceReview {
  id: string
  cycleId: string
  cycleName?: string
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
  /** BW-81: SELF, MANAGER, PEER, SKIP_LEVEL or DIRECT_REPORT. */
  reviewerType?: string | null
  /** BW-81: the reviewee's department. */
  department?: string | null
  /** BW-78: the date this review is due by, from the cycle's dates. */
  dueDate?: string | null
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
  targetValue?: number | null
  currentValue?: number | null
  unit?: string | null
  /** BW-84 (My goals): due date and the last progress update. */
  dueDate?: string | null
  lastNote?: string | null
  lastUpdatedAt?: string | null
  previousValue?: number | null
  /** BW-83: the company KPI this goal counts towards. */
  companyKpiId?: string | null
  companyKpiTitle?: string | null
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

/** Employee reviews. `status` (BW-81): WAITING, SUBMITTED or MISSED; omitted = every review, as before. */
export function useReviews(cycleId: string | undefined, page = 0, enabled = true, status?: 'WAITING' | 'SUBMITTED' | 'MISSED') {
  return useQuery({
    queryKey: ['hrms', 'performance', 'reviews', cycleId ?? 'all', page, status ?? 'any'],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), size: '20' })
      if (cycleId) params.set('cycleId', cycleId)
      if (status) params.set('status', status)
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

/** BW-84: save a review you write as a draft (it becomes IN_PROGRESS). Only its writer may. */
export function useSaveReviewDraft() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; overallRating?: number | null; strengths?: string; improvements?: string }) =>
      apiJson<PerformanceReview>(`/v1/performance/reviews/${id}/draft`, { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['hrms', 'performance', 'reviews'] }),
        qc.invalidateQueries({ queryKey: ['hrms', 'performance', 'my-current'] }),
      ])
    },
  })
}

/** One of my steps in a cycle (BW-84). */
export interface MyReviewStep {
  reviewId: string
  status: ReviewStatus
  reviewerName?: string | null
  submittedAt?: string | null
}

/** GET /v1/performance/cycles/my-current: the open cycles I'm reviewed in, with my steps. */
export interface MyCycle {
  cycleId: string
  name: string
  periodStart?: string | null
  periodEnd?: string | null
  status: CycleStatus
  milestones?: CycleMilestones | null
  goals: number
  goalsFirstSetAt?: string | null
  selfReview?: MyReviewStep | null
  managerReview?: MyReviewStep | null
  feedbackHeld: boolean
}

export function useMyCurrentCycles(enabled = true) {
  return useQuery({
    queryKey: ['hrms', 'performance', 'my-current'],
    queryFn: () => apiJson<MyCycle[]>('/v1/performance/cycles/my-current'),
    staleTime: 30_000,
    enabled,
  })
}

export function useSubmitReview() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: SubmitReviewPayload & { id: string }) =>
      apiJson<PerformanceReview>(`/v1/performance/reviews/${id}/submit`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['hrms', 'performance', 'reviews'] }),
        qc.invalidateQueries({ queryKey: ['hrms', 'performance', 'my-current'] }),
      ])
    },
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
  /** BW-84 */
  dueDate?: string
  /** BW-83 */
  companyKpiId?: string
}

export function useCreateGoal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateGoalPayload) =>
      apiJson<Goal>('/v1/performance/goals', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'performance', 'goals'] }),
  })
}

/** Employee updates a personal goal's percentage; the note (optional) is kept in the goal's history. */
export function useUpdateGoalProgress() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, progress, note }: { id: string; progress: number; note?: string }) =>
      apiJson<Goal>(`/v1/performance/goals/${id}/progress`, {
        method: 'PUT',
        body: JSON.stringify({ progress, note: note || undefined }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'performance', 'goals'] }),
  })
}

/** One recorded progress update (KpiService.ProgressUpdateDto). */
export interface GoalProgressEntry {
  id: string
  previousValue?: number | null
  newValue: number
  progressPct: number
  notes?: string | null
  updatedBy?: string | null
  updatedByName?: string | null
  updatedAt: string
}

/** GET /v1/performance/goals/my/{id}/history (hrms.performance.review.self): your own goal's history. */
export function useMyGoalHistory(id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['hrms', 'performance', 'goals', 'history', id],
    queryFn: () => apiJson<GoalProgressEntry[]>(`/v1/performance/goals/my/${id}/history`),
    enabled: enabled && !!id,
    staleTime: 15_000,
  })
}

/** Mirrors PerformanceInsightService.GoalSnapshotDto. */
export interface ReviewGoal {
  id: string
  title: string
  category?: string | null
  kpi: boolean
  targetValue?: number | null
  currentValue?: number | null
  unit?: string | null
  direction?: string | null
  progressPct: number
  weight: number
  dueDate?: string | null
  status: GoalStatus
  cycleId?: string | null
}

export interface ReviewGoals {
  reviewId: string
  employeeId: string
  employeeName?: string | null
  cycleId?: string | null
  cycleName?: string | null
  periodStart?: string | null
  periodEnd?: string | null
  goals: ReviewGoal[]
}

/**
 * GET /v1/performance/reviews/{id}/goals: the reviewee's goals and KPIs for the
 * review's cycle. Allowed for the assigned reviewer, the reviewee, and anyone
 * whose performance scope covers the reviewee.
 */
export function useReviewGoals(reviewId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['hrms', 'performance', 'review-goals', reviewId],
    queryFn: () => apiJson<ReviewGoals>(`/v1/performance/reviews/${reviewId}/goals`),
    enabled: enabled && !!reviewId,
    staleTime: 30_000,
    retry: false,
  })
}

// ─── Wave 1: Performance Directory ──────────────────────────────────────────

export interface EmployeePerformanceRow {
  employeeId: string
  employeeCode?: string | null
  employeeName: string
  department?: string | null
  departmentId?: string | null
  // Null when the employee has no submitted review — show a dash in the UI,
  // never treat as zero (zero would imply a bad review, which is different).
  overallRating?: number | null
  scorePct?: number | null           // rating / rating_scale_max * 100, 1 dp
  lastReviewCycleName?: string | null
  lastReviewSubmittedAt?: string | null
  lastReviewStatus?: 'PENDING' | 'SUBMITTED' | 'ACKNOWLEDGED' | null
  /** BW-82: ACTIVE, PROBATION, NOTICE_PERIOD, … */
  employmentStatus?: string | null
  /** BW-82: a review about them is still to be written in an open cycle. */
  pendingInOpenCycle?: boolean
}

export interface PerformanceDirectoryPage {
  items: EmployeePerformanceRow[]
  page: number
  size: number
  total: number
}

export interface PerformanceDirectoryFilters {
  departmentId?: string
  search?: string
  page?: number
  size?: number
}

/**
 * Paged directory of every active employee with their latest submitted
 * review's rating. Employees with no review still appear (null rating) so HR
 * sees the whole workforce, not just people who've been reviewed.
 */
export function usePerformanceDirectory(filters: PerformanceDirectoryFilters = {}) {
  const { departmentId, search, page = 0, size = 25 } = filters
  const qs = new URLSearchParams()
  if (departmentId) qs.set('departmentId', departmentId)
  if (search)       qs.set('search', search)
  qs.set('page', String(page))
  qs.set('size', String(size))
  return useQuery({
    queryKey: ['hrms', 'performance', 'directory', departmentId ?? '', search ?? '', page, size],
    queryFn: () => apiJson<PerformanceDirectoryPage>(`/v1/performance/employees?${qs.toString()}`),
    staleTime: 30_000,
  })
}

// ── KPIs / goals owned by ONE employee ───────────────────────────────────────
//
// GET /v1/performance/kpis already accepts `ownerId` (KpiController.list) and is
// gated on hrms.performance.read — it simply had no caller in the SPA. This is
// the only per-employee performance READ that exists: review history has no
// employeeId filter on the admin route (only the JWT-bound /reviews/my), so the
// employee profile deliberately shows goals + skills and says so, rather than
// paging the whole org's reviews to find one person's.

/** Mirrors KpiService.KpiRowDto. */
export interface EmployeeKpiRow {
  id: string
  ownerId: string
  ownerName?: string
  ownerCode?: string
  title: string
  description?: string
  category?: string
  targetValue?: number
  currentValue?: number
  unit?: string
  direction?: string
  progressPct?: number
  weight?: number
  dueDate?: string
  status?: string
  createdAt?: string
  updatedAt?: string
  /** BW-82: the owner's department. */
  department?: string | null
  /** BW-83: the company KPI it counts towards. */
  companyKpiId?: string | null
  companyKpiTitle?: string | null
}

/** Mirrors KpiService.PageDto — note `items`, NOT `content`. */
export interface KpiPage {
  items: EmployeeKpiRow[]
  page: number
  size: number
  total: number
}

export function useEmployeeKpis(
  employeeId: string | undefined,
  opts?: { enabled?: boolean; activeOnly?: boolean },
) {
  // activeOnly: only goals still being worked on (active or at risk), e.g. the Goals tile.
  const active = !!opts?.activeOnly
  return useQuery({
    queryKey: ['performance', 'kpis', 'owner', employeeId, active ? 'active' : 'all'],
    queryFn: () => apiJson<KpiPage>(
      `/v1/performance/kpis?ownerId=${employeeId}&page=0&size=${active ? 1 : 50}${active ? '&active=true' : ''}`,
    ),
    enabled: (opts?.enabled ?? true) && !!employeeId,
    staleTime: 60_000,
    retry: false,
  })
}

// ── One employee's performance page ─────────────────────────────────────────
// GET /v1/performance/employees/{id} (hrms.performance.read). HR / admin can open
// anyone; a department manager only their team (403 otherwise).

export interface ProfileReview {
  id: string
  cycleId?: string | null
  cycleName?: string | null
  periodStart?: string | null
  periodEnd?: string | null
  reviewerId?: string | null
  reviewerName?: string | null
  reviewerType?: string | null
  status: ReviewStatus
  overallRating?: number | null
  strengths?: string | null
  improvements?: string | null
  submittedAt?: string | null
  createdAt?: string | null
}

export interface RatingPoint {
  cycleId?: string | null
  cycleName?: string | null
  periodStart?: string | null
  periodEnd?: string | null
  averageRating: number
  reviewCount: number
  lastSubmittedAt?: string | null
}

export interface EmployeePerformanceProfile {
  employee: {
    id: string
    employeeCode?: string | null
    name: string
    department?: string | null
    designation?: string | null
    managerName?: string | null
    employmentStatus?: string | null
    dateOfJoining?: string | null
    active: boolean
  }
  summary: {
    latestRating?: number | null
    averageRating?: number | null
    activeGoals: number
    atRiskGoals: number
    completedGoals: number
    reviewsSubmitted: number
    reviewsPending: number
  }
  ratings: RatingPoint[]
  goals: EmployeeKpiRow[]
  reviews: ProfileReview[]
}

export function useEmployeePerformanceProfile(employeeId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['hrms', 'performance', 'profile', employeeId],
    queryFn: () => apiJson<EmployeePerformanceProfile>(`/v1/performance/employees/${employeeId}`),
    enabled: enabled && !!employeeId,
    staleTime: 15_000,
    retry: false,
  })
}
