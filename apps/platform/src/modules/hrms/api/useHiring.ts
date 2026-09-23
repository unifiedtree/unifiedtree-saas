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
export type CandidateStage = 'APPLIED' | 'SCREENING' | 'INTERVIEW' | 'OFFER' | 'HIRED' | 'REJECTED'

export const CANDIDATE_STAGES: CandidateStage[] = [
  'APPLIED',
  'SCREENING',
  'INTERVIEW',
  'OFFER',
  'HIRED',
  'REJECTED',
]

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
