import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiJson, apiBlob } from '@/core/api/client'

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
}
export interface HiringOffer extends HiringOfferPayload {
  id: string
  status: OfferStatus
  emailSubmittedAt?: string
  emailRecipient?: string
  sentAt?: string
  respondedAt?: string
  createdAt: string
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
    mutationFn: ({ id, recipient }: { id: string; recipient: string }) =>
      apiJson<HiringOffer>(`/v1/hiring/offers/${id}/email`, {
        method: 'POST',
        body: JSON.stringify({ recipient }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'hiring'] }),
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
