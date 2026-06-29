import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiJson } from '@/core/api/client'

// Mirrors backend com.hrms.policy.enums.PolicyStatus
export type PolicyStatus = 'ACTIVE' | 'ARCHIVED'

export interface Policy {
  id: string
  companyId: string
  title: string
  category?: string
  content?: string
  version?: string
  effectiveDate?: string
  status: PolicyStatus
  acknowledgementCount: number
  createdAt: string
}

export interface PolicyAcknowledgement {
  id: string
  policyId: string
  employeeId: string
  employeeName?: string
  employeeCode?: string
  acknowledgedAt: string
}

export interface Page<T> {
  content: T[]
  page: number
  size: number
  totalElements: number
  totalPages: number
  last: boolean
}

// ── Policies ─────────────────────────────────────────────────────────────────

export function usePolicies(page = 0) {
  return useQuery({
    queryKey: ['hrms', 'policy', 'list', page],
    queryFn: () => apiJson<Page<Policy>>(`/v1/policy/policies?page=${page}&size=50`),
    staleTime: 30_000,
  })
}

export function usePolicy(id: string | undefined) {
  return useQuery({
    queryKey: ['hrms', 'policy', 'one', id],
    queryFn: () => apiJson<Policy>(`/v1/policy/policies/${id}`),
    enabled: !!id,
  })
}

export interface PolicyPayload {
  companyId?: string
  title: string
  category?: string
  content?: string
  version?: string
  effectiveDate?: string
}

export function useCreatePolicy() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ companyId, ...body }: PolicyPayload & { companyId: string }) =>
      apiJson<Policy>(`/v1/policy/policies?companyId=${companyId}`, {
        method: 'POST',
        body: JSON.stringify({ ...body, companyId }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'policy'] }),
  })
}

export function useUpdatePolicy() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: PolicyPayload & { id: string }) =>
      apiJson<Policy>(`/v1/policy/policies/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'policy'] }),
  })
}

export function useArchivePolicy() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiJson<Policy>(`/v1/policy/policies/${id}/archive`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'policy'] }),
  })
}

// ── Acknowledgements ─────────────────────────────────────────────────────────

export function useMyAcknowledgements() {
  return useQuery({
    queryKey: ['hrms', 'policy', 'my-acks'],
    queryFn: () => apiJson<string[]>(`/v1/policy/my-acknowledgements`),
    staleTime: 30_000,
  })
}

export function usePolicyAcknowledgements(policyId: string | undefined, page = 0, enabled = true) {
  return useQuery({
    queryKey: ['hrms', 'policy', 'acks', policyId, page],
    queryFn: () =>
      apiJson<Page<PolicyAcknowledgement>>(`/v1/policy/policies/${policyId}/acknowledgements?page=${page}&size=50`),
    enabled: !!policyId && enabled,
  })
}

export function useAcknowledgePolicy() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiJson<void>(`/v1/policy/policies/${id}/acknowledge`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'policy'] }),
  })
}
