import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiJson } from '@/core/api/client'

// Mirrors backend com.hrms.policy.enums.PolicyStatus: DRAFT → ACTIVE → ARCHIVED.
// DRAFT has existed server-side since Bundle H (2026-08-13, the QA finding that
// every save was silently promoted to ACTIVE) but never made it into this type,
// so a DRAFT row coming back from the API was typed as a lie and the SPA had no
// way to name the state at all.
export type PolicyStatus = 'DRAFT' | 'ACTIVE' | 'ARCHIVED'

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

/**
 * List policies in ONE lifecycle state.
 *
 * `status` is optional and the server defaults to ACTIVE (PolicyController
 * listPolicies → PolicyService.listPolicies maps null → ACTIVE), so an
 * existing `usePolicies(0)` call fetches exactly what it always did.
 *
 * WHY status is in the query key: without it the admin screen's ARCHIVED page
 * and the employee screen's ACTIVE page would share one cache entry, and
 * whichever fetched last would be rendered by the other — an employee landing
 * on Documents right after an admin browsed Archived would be shown archived
 * policies to acknowledge. `status ?? 'ACTIVE'` deliberately collapses the
 * omitted and explicit-ACTIVE cases onto the same entry because the server
 * answers both with the same rows.
 *
 * There is NO "all statuses" option, by design and not by omission:
 * HrPolicyRepository exposes only findByStatusOrderByEffectiveDateDescCreatedAtDesc
 * and the service maps null → ACTIVE, so an "All" filter could only ever
 * re-show the Active rows under a label promising more than it delivers.
 * Callers pick one state.
 */
export function usePolicies(page = 0, status?: PolicyStatus) {
  return useQuery({
    queryKey: ['hrms', 'policy', 'list', page, status ?? 'ACTIVE'],
    queryFn: () =>
      apiJson<Page<Policy>>(
        `/v1/policy/policies?page=${page}&size=50${status ? `&status=${status}` : ''}`,
      ),
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
    // Prefix invalidation, so every per-status list entry refetches: the row
    // has to leave Active AND appear under Archived in the same beat.
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'policy'] }),
  })
}

/**
 * ARCHIVED → ACTIVE (POST /v1/policy/policies/{id}/unarchive, added
 * 2026-09-09 with the endpoint itself).
 *
 * WHY this exists: archiving was a one-click, unconfirmed, IRREVERSIBLE
 * destruction. The admin table only ever fetched ACTIVE, so a misclick made a
 * published policy vanish from the product with no path back — recovery was a
 * manual UPDATE against prod. There is no delete endpoint precisely because
 * archive was meant to be the safe, undoable option; it just had no undo.
 *
 * The backend rejects a non-archived policy with 400 POLICY_NOT_ARCHIVED
 * (PolicyService.unarchivePolicy) — HttpError carries that message through to
 * the caller's toast, which matters when two admins act on the same row.
 */
export function useUnarchivePolicy() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiJson<Policy>(`/v1/policy/policies/${id}/unarchive`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'policy'] }),
  })
}

// ── Acknowledgements ─────────────────────────────────────────────────────────

/**
 * Policy ids the signed-in employee has acknowledged AT THE POLICY'S CURRENT
 * VERSION.
 *
 * The version qualifier is the whole contract, and it is enforced server-side
 * (PolicyService.getMyAcknowledgedPolicyIds, fixed 2026-09-09). Until that fix
 * the endpoint returned every ack ever recorded regardless of version, so once
 * an admin bumped a policy version the id stayed in this list forever and the
 * Documents tab kept rendering the static "You acknowledged this policy" label
 * — re-acknowledgement was impossible from the web for the exact policy change
 * that demanded it.
 *
 * Consequence for callers: an id DISAPPEARING from this list is a real signal
 * ("you must acknowledge the new version"), not a glitch. Do not cache it into
 * component state, do not union it with a previous response, and do not keep a
 * local "acked" flag — derive straight from this query so a version bump can
 * take the acknowledgement away again.
 */
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
    // Returns 204 No Content; apiJson maps an empty body to null rather than
    // throwing on JSON.parse(''), so this resolves and onSuccess really fires.
    mutationFn: (id: string) =>
      apiJson<void>(`/v1/policy/policies/${id}/acknowledge`, { method: 'POST' }),
    // Prefix invalidation covers BOTH ['hrms','policy','my-acks'] (so the
    // button flips to the acknowledged label) and every ['hrms','policy','list',…]
    // entry (so acknowledgementCount, which the server computes per version,
    // is refetched instead of drifting).
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'policy'] }),
  })
}
