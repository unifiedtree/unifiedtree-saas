import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiJson } from '@/core/api/client'

// Mirrors backend com.hrms.hiring.enums
export type RequisitionStatus = 'OPEN' | 'ON_HOLD' | 'CLOSED'
export type CandidateStage = 'APPLIED' | 'SCREENING' | 'INTERVIEW' | 'OFFER' | 'HIRED' | 'REJECTED'

export const CANDIDATE_STAGES: CandidateStage[] = [
  'APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER', 'HIRED', 'REJECTED',
]

export const EMPLOYMENT_TYPES = [
  'FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN', 'TEMPORARY',
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

export function useRequisitions(page = 0, companyId?: string) {
  return useQuery({
    queryKey: ['hrms', 'hiring', 'requisitions', page, companyId ?? 'all'],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), size: '20' })
      if (companyId) params.set('companyId', companyId)
      return apiJson<Page<JobRequisition>>(`/v1/hiring/requisitions?${params.toString()}`)
    },
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
      apiJson<JobRequisition>('/v1/hiring/requisitions', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'hiring'] }),
  })
}

export function useUpdateRequisition() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: RequisitionPayload & { id: string }) =>
      apiJson<JobRequisition>(`/v1/hiring/requisitions/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
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
