import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiJson, apiBlob } from '@/core/api/client'
import { asAvailable, useAvailableQuery } from './shared/available'

export type OfferStatus = 'DRAFT' | 'SENT' | 'ACCEPTED' | 'DECLINED' | 'WITHDRAWN'
export const OFFER_STATUSES: OfferStatus[] = ['DRAFT', 'SENT', 'ACCEPTED', 'DECLINED', 'WITHDRAWN']
export interface HiringOfferPayload {
  companyId: string
  requisitionId?: string
  candidateId?: string
  candidateName: string
  roleTitle: string
  offeredCtc: number
  joiningDate?: string
  notes?: string
  offerTerms?: string
  /**
   * The candidate's email for "Send offer email" (V143.59). Left out: kept as it
   * is on an edit, none on a create. Empty: removed.
   */
  candidateEmail?: string
}
export interface HiringOffer extends Omit<HiringOfferPayload, 'candidateEmail'> {
  id: string
  status: OfferStatus
  emailSubmittedAt?: string
  emailRecipient?: string
  sentAt?: string
  respondedAt?: string
  createdAt: string
  /** The email stored on the offer, else the linked candidate's; null when neither exists (or on older servers). */
  candidateEmail?: string | null
}
export function useHiringOffers(page: number) {
  return useQuery({
    queryKey: ['hrms', 'hiring', 'offers', page],
    queryFn: () => apiJson<Page<HiringOffer>>(`/v1/hiring/offers?page=${page}&size=20`),
  })
}
export function useCreateHiringOffer() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: HiringOfferPayload) =>
      apiJson<HiringOffer>('/v1/hiring/offers', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'hiring'] }),
  })
}
export function useUpdateHiringOfferStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: OfferStatus }) =>
      apiJson<HiringOffer>(`/v1/hiring/offers/${id}/status`, {
        method: 'POST',
        body: JSON.stringify({ status }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'hiring'] }),
  })
}

// Mirrors backend com.hrms.hiring.enums
export type RequisitionStatus = 'OPEN' | 'ON_HOLD' | 'CLOSED'
export type CandidateStage = 'APPLIED' | 'SCREENING' | 'INTERVIEW' | 'OFFER' | 'HIRED' | 'REJECTED' | 'WITHDRAWN'

export const CANDIDATE_STAGES: CandidateStage[] = [
  'APPLIED',
  'SCREENING',
  'INTERVIEW',
  'OFFER',
  'HIRED',
  'REJECTED',
  'WITHDRAWN',
]

/** The server's stage rules (HiringService.assertTransitionAllowed): one step forward, or out to Rejected / Withdrawn. */
export function canMoveStage(from: CandidateStage, to: CandidateStage): boolean {
  if (from === to || from === 'REJECTED' || from === 'WITHDRAWN') return false
  if (to === 'REJECTED' || to === 'WITHDRAWN') return true
  const funnel: CandidateStage[] = ['APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER', 'HIRED']
  return funnel.indexOf(to) === funnel.indexOf(from) + 1 && funnel.indexOf(from) >= 0
}

export const EMPLOYMENT_TYPES = [
  'FULL_TIME',
  'PART_TIME',
  'CONTRACT',
  'INTERN',
  'TEMPORARY',
] as const
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number]

export interface JobRequisition {
  id: string
  companyId: string
  title: string
  departmentId?: string
  openings: number
  status: RequisitionStatus
  employmentType?: string
  location?: string
  description?: string
  hiringManagerId?: string
  hiringManagerName?: string
  candidateCount: number
  createdAt: string
}

export interface Candidate {
  id: string
  requisitionId: string
  fullName: string
  email?: string
  phone?: string
  stage: CandidateStage
  source?: string
  expectedCtc?: number | null
  notes?: string
  createdAt: string
  /** Set once the HIRED candidate has been converted into an employee. */
  convertedEmployeeId?: string | null
  convertedAt?: string | null
}

export interface Page<T> {
  content: T[]
  page: number
  size: number
  totalElements: number
  totalPages: number
  last: boolean
}

export const inr = (n?: number | null) =>
  '₹' + (n ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })

// ── Requisitions ─────────────────────────────────────────────────────────────

export function useRequisitions(page = 0, companyId?: string, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['hrms', 'hiring', 'requisitions', page, companyId ?? 'all'],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), size: '20' })
      if (companyId) params.set('companyId', companyId)
      return apiJson<Page<JobRequisition>>(`/v1/hiring/requisitions?${params.toString()}`)
    },
    // Callers without hrms.hiring.read should pass { enabled: false } so this
    // does not 403 on every render (e.g. the hiring KPI on the main dashboard).
    enabled: opts?.enabled ?? true,
    staleTime: 30_000,
  })
}

export function useRequisition(id: string | undefined) {
  return useQuery({
    queryKey: ['hrms', 'hiring', 'requisition', id],
    queryFn: () => apiJson<JobRequisition>(`/v1/hiring/requisitions/${id}`),
    enabled: !!id,
  })
}

export interface RequisitionPayload {
  companyId?: string
  title: string
  departmentId?: string
  openings?: number
  employmentType?: string
  location?: string
  description?: string
  hiringManagerId?: string
}

export function useCreateRequisition() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: RequisitionPayload) =>
      apiJson<JobRequisition>('/v1/hiring/requisitions', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'hiring'] }),
  })
}

export function useUpdateRequisition() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: RequisitionPayload & { id: string }) =>
      apiJson<JobRequisition>(`/v1/hiring/requisitions/${id}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'hiring'] }),
  })
}

export function useCloseRequisition() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiJson<JobRequisition>(`/v1/hiring/requisitions/${id}/close`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'hiring'] }),
  })
}

// ── Candidates ───────────────────────────────────────────────────────────────

export function useCandidates(requisitionId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['hrms', 'hiring', 'candidates', requisitionId],
    queryFn: () => apiJson<Candidate[]>(`/v1/hiring/requisitions/${requisitionId}/candidates`),
    enabled: !!requisitionId && enabled,
    staleTime: 15_000,
  })
}

export interface CandidatePayload {
  fullName: string
  email?: string
  phone?: string
  source?: string
  expectedCtc?: number | null
  notes?: string
}

export function useAddCandidate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ requisitionId, ...body }: CandidatePayload & { requisitionId: string }) =>
      apiJson<Candidate>(`/v1/hiring/requisitions/${requisitionId}/candidates`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'hiring'] }),
  })
}

export function useUpdateCandidateStage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, stage }: { id: string; stage: CandidateStage }) =>
      apiJson<Candidate>(`/v1/hiring/candidates/${id}/stage`, {
        method: 'PUT',
        body: JSON.stringify({ stage }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'hiring'] }),
  })
}

/**
 * Convert a HIRED candidate into an employee (POST /v1/hiring/candidates/{id}/convert).
 * Server-side: one locked transaction through the normal employee-create
 * service, so seat quota and validation apply; a second call returns 409.
 */
export function useConvertCandidate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiJson<{
        candidate: Candidate; employee: { id: string; employeeCode: string; firstName: string; lastName?: string }
        /** Set when a checklist template fitted and their onboarding was started. */
        onboardingInstanceId?: string | null; onboardingTemplateName?: string | null
      }>(`/v1/hiring/candidates/${id}/convert`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hrms', 'hiring'] })
      qc.invalidateQueries({ queryKey: ['hrms', 'onboarding'] })
      qc.invalidateQueries({ queryKey: ['hrms', 'employees'] })
      qc.invalidateQueries({ queryKey: ['hrms', 'employee-counts'] })
    },
  })
}

export function useEditHiringOffer() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: HiringOfferPayload & { id: string }) =>
      apiJson<HiringOffer>(`/v1/hiring/offers/${id}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'hiring'] }),
  })
}
export async function downloadOfferPdf(id: string) {
  const blob = await apiBlob(`/v1/hiring/offers/${id}/pdf`)
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `offer-${id}.pdf`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function useEmailHiringOffer() {
  const qc = useQueryClient()
  return useMutation({
    retry: false,
    // No recipient: the server uses the offer's candidate email (V143.59) and refuses when there is none.
    mutationFn: ({ id, recipient }: { id: string; recipient?: string }) =>
      apiJson<HiringOffer>(`/v1/hiring/offers/${id}/email`, {
        method: 'POST',
        body: JSON.stringify(recipient ? { recipient } : {}),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'hiring'] }),
  })
}

// ── The Hiring page's figures (redesign BW-65, BW-66, BW-68) ────────────────
// Counted on the server, so they are right however many requisitions and
// candidates there are. 404 / 503 FEATURE_NOT_READY (an older server, or the
// funnel before V143.59) come back as `notAvailable`: the page shows "—" for
// that block instead of an error. Keys sit under ['hrms','hiring'], so every
// hiring change refreshes them.

/** GET /v1/hiring/summary (hrms.hiring.read). */
export interface HiringSummary {
  companyId: string | null
  requisitions: { open: number; onHold: number; closed: number; total: number }
  /** Openings on open and on-hold requisitions. */
  positionsToFill: number
  candidatesThisQuarter: number
  quarterStart: string
  quarterEnd: string
  /** Candidates on OPEN requisitions by their current stage, every stage listed. */
  openRoleStages: { stage: CandidateStage; count: number }[]
}

/** GET /v1/hiring/funnel (hrms.hiring.read): this quarter by default. */
export interface HiringFunnel {
  from: string
  to: string
  companyId: string | null
  /** When the stage history starts; null when there is none yet. */
  trackedFrom: string | null
  /** True when the whole period is inside the history. */
  exact: boolean
  trackedCandidates: number
  untrackedCandidates: number
  stages: { stage: CandidateStage; reached: number }[]
  /** `rate` is 0..1, null when nobody reached `from`. */
  conversions: { from: CandidateStage; to: CandidateStage; fromCount: number; toCount: number; rate: number | null }[]
  timeToHire: { averageDays: number | null; hires: number }
}

/** GET /v1/hiring/interviews/mine/summary (hrms.hiring.interview.self or hrms.hiring.read). */
export interface MyInterviewSummary {
  quarterStart: string
  quarterEnd: string
  tookThisQuarter: number
  scorecardsSubmittedThisQuarter: number
  scorecardsDue: number
  upcoming: number
}

export function useHiringSummary(enabled = true) {
  return useAvailableQuery<HiringSummary>({
    queryKey: ['hrms', 'hiring', 'summary'],
    queryFn: () => asAvailable(() => apiJson<HiringSummary>('/v1/hiring/summary')),
    enabled,
    staleTime: 30_000,
  })
}

export function useHiringFunnel(enabled = true) {
  return useAvailableQuery<HiringFunnel>({
    queryKey: ['hrms', 'hiring', 'funnel'],
    queryFn: () => asAvailable(() => apiJson<HiringFunnel>('/v1/hiring/funnel')),
    enabled,
    staleTime: 60_000,
  })
}

export function useMyInterviewSummary(enabled = true) {
  return useAvailableQuery<MyInterviewSummary>({
    queryKey: ['hrms', 'hiring', 'interviews', 'mine', 'summary'],
    queryFn: () => asAvailable(() => apiJson<MyInterviewSummary>('/v1/hiring/interviews/mine/summary')),
    enabled,
    staleTime: 30_000,
  })
}

/**
 * Every requisition in one call (up to 200, newest first), for the role
 * pickers: the pipeline's role filter and Add a candidate. The Requisitions
 * table pages through useRequisitions instead.
 */
export function useRequisitionOptions(enabled = true) {
  return useQuery({
    queryKey: ['hrms', 'hiring', 'requisitions', 'options'],
    queryFn: () => apiJson<Page<JobRequisition>>('/v1/hiring/requisitions?page=0&size=200'),
    enabled,
    staleTime: 30_000,
  })
}

// ── Interviews and scorecards (V143.20) ──────────────────────────────────────

export type InterviewMode = 'IN_PERSON' | 'VIDEO' | 'PHONE'
export type Recommendation = 'STRONG_YES' | 'YES' | 'NO' | 'STRONG_NO'
export const RECOMMENDATIONS: Recommendation[] = ['STRONG_YES', 'YES', 'NO', 'STRONG_NO']
export const RECOMMENDATION_LABEL: Record<Recommendation, string> = { STRONG_YES: 'Strong yes', YES: 'Yes', NO: 'No', STRONG_NO: 'Strong no' }
export const MODE_LABEL: Record<InterviewMode, string> = { IN_PERSON: 'In person', VIDEO: 'Video call', PHONE: 'Phone call' }
export const DEFAULT_CRITERIA = ['Role knowledge', 'Problem solving', 'Communication', 'Culture fit']
/** Interviews can be booked while the candidate is in one of these stages (the server's rule). */
export const SCHEDULABLE_STAGES: CandidateStage[] = ['SCREENING', 'INTERVIEW']

export interface ScorecardSummary { count: number; averageRating: number | null; recommendations: Record<Recommendation, number> }
/** A candidate on the board, with the role they applied for and their interview and scorecard summary. */
export interface CandidateCard extends Candidate {
  requisitionTitle: string
  upcomingInterviews: number
  nextInterviewAt?: string | null
  scorecards: ScorecardSummary
}
export interface InterviewRating { criterion: string; rating: number }
export interface InterviewScorecard {
  id: string; interviewerId: string; interviewerName: string; ratings: InterviewRating[]; overallRating: number
  strengths?: string | null; concerns?: string | null; recommendation: Recommendation; submittedAt: string; updatedAt: string
}
export interface Interview {
  id: string; candidateId: string; candidateName: string; candidateStage: CandidateStage; requisitionId: string; roleTitle: string
  title: string; scheduledAt: string; scheduledAtIst: string; durationMinutes: number; mode: InterviewMode; location?: string | null
  criteria: string[]; notes?: string | null; status: 'SCHEDULED' | 'CANCELLED'; cancelReason?: string | null; cancelledAt?: string | null
  interviewers: { employeeId: string; name: string; submitted: boolean }[]
  scorecards: InterviewScorecard[]
  /** The start time has passed (a scorecard can be submitted). */
  started: boolean
}
export interface SchedulePayload {
  title?: string
  /** India time, "2026-09-26T10:30". */
  scheduledAt: string
  durationMinutes: number
  mode: InterviewMode
  location?: string
  interviewerIds: string[]
  criteria?: string[]
  notes?: string
}
export interface ScorecardPayload { ratings: InterviewRating[]; strengths?: string; concerns?: string; recommendation: Recommendation }

/** "Sat 26 Sep, 10:30 am" in India time. */
export const istWhen = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '')

export function useCandidateBoard(filter: { requisitionId?: string; stage?: string }, enabled = true) {
  return useQuery({
    queryKey: ['hrms', 'hiring', 'board', filter.requisitionId ?? 'all', filter.stage ?? 'all'],
    queryFn: () => {
      const params = new URLSearchParams()
      if (filter.requisitionId) params.set('requisitionId', filter.requisitionId)
      if (filter.stage) params.set('stage', filter.stage)
      return apiJson<CandidateCard[]>(`/v1/hiring/candidates?${params.toString()}`)
    },
    enabled,
    staleTime: 15_000,
  })
}

export function useCandidateInterviews(candidateId: string | undefined) {
  return useQuery({
    queryKey: ['hrms', 'hiring', 'interviews', 'candidate', candidateId],
    queryFn: () => apiJson<Interview[]>(`/v1/hiring/candidates/${candidateId}/interviews`),
    enabled: !!candidateId,
  })
}

export function useUpcomingInterviews(enabled = true) {
  return useQuery({
    queryKey: ['hrms', 'hiring', 'interviews', 'upcoming'],
    queryFn: () => apiJson<Interview[]>('/v1/hiring/interviews'),
    enabled,
    staleTime: 30_000,
  })
}

export function useMyInterviews(enabled = true) {
  return useQuery({
    queryKey: ['hrms', 'hiring', 'interviews', 'mine'],
    queryFn: () => apiJson<Interview[]>('/v1/hiring/interviews/mine'),
    enabled,
    staleTime: 30_000,
  })
}

function useInterviewMutation<V>(fn: (v: V) => Promise<Interview>) {
  const qc = useQueryClient()
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'hiring'] }) })
}
export const useScheduleInterview = () => useInterviewMutation(({ candidateId, ...body }: SchedulePayload & { candidateId: string }) =>
  apiJson<Interview>(`/v1/hiring/candidates/${candidateId}/interviews`, { method: 'POST', body: JSON.stringify(body) }))
export const useRescheduleInterview = () => useInterviewMutation(({ id, ...body }: SchedulePayload & { id: string }) =>
  apiJson<Interview>(`/v1/hiring/interviews/${id}`, { method: 'PUT', body: JSON.stringify(body) }))
export const useCancelInterview = () => useInterviewMutation(({ id, reason }: { id: string; reason?: string }) =>
  apiJson<Interview>(`/v1/hiring/interviews/${id}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) }))
export const useSubmitScorecard = () => useInterviewMutation(({ id, ...body }: ScorecardPayload & { id: string }) =>
  apiJson<Interview>(`/v1/hiring/interviews/${id}/scorecard`, { method: 'PUT', body: JSON.stringify(body) }))
