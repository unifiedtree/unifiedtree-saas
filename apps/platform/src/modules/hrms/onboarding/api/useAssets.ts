import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiJson } from '@/core/api/client'
import { asAvailable, useAvailableQuery } from '../../api/shared/available'

/** A problem the holder reported that HR hasn't resolved yet (BW-70). */
export interface AssetIssueBrief { id: string; kind: string; note?: string | null; reportedAt: string }

export interface Asset {
  id: string; companyId: string; employeeId?: string; assetTag: string; assetType: string;
  assetName: string; serialNo?: string; status: string; assignedAt?: string; returnedAt?: string; conditionNotes?: string
  // Added by the redesign's asset list (BW-69, BW-70); absent on an older server.
  /** Who has it now; only for callers who can read employee records. */
  holderName?: string | null
  /** Who had it last, once it's back; same rule. */
  lastHolderName?: string | null
  /** The holder confirmed they have it. */
  confirmedAt?: string | null
  /** EMPLOYEE, or BACKFILL for hand-overs from before confirmations started. */
  confirmationSource?: string | null
  /** Handed over and not confirmed yet. Null while the confirmations table is missing. */
  confirmationPending?: boolean | null
  openIssue?: AssetIssueBrief | null
}
export type AssetInput = Pick<Asset, 'companyId' | 'assetTag' | 'assetType' | 'assetName' | 'serialNo' | 'conditionNotes'>

/** A reported problem as HR's list shows it. employeeName only for callers who can read employee records. */
export interface AssetIssue {
  id: string; assetId: string; assetTag: string; assetName: string; assetType: string; companyId: string
  employeeId: string | null; employeeName: string | null; kind: string; note: string | null; status: 'OPEN' | 'RESOLVED' | string
  reportedAt: string; resolvedAt: string | null; resolvedByName: string | null; resolutionNote: string | null
}

const key = ['hrms', 'onboarding', 'assets']
export function useAssets(enabled: boolean) {
  return useQuery({ queryKey: key, queryFn: () => apiJson<Asset[]>('/v1/onboarding/assets'), enabled })
}
export function useAssetActions() {
  const qc = useQueryClient()
  const refresh = () => qc.invalidateQueries({ queryKey: key })
  const create = useMutation({ mutationFn: (body: AssetInput) => apiJson<Asset>('/v1/onboarding/assets', { method: 'POST', body: JSON.stringify(body) }), onSuccess: refresh })
  const assign = useMutation({ mutationFn: ({ id, employeeId }: { id: string; employeeId: string }) => apiJson<Asset>(`/v1/onboarding/assets/${id}/assign`, { method: 'POST', body: JSON.stringify({ employeeId }) }), onSuccess: refresh })
  const receive = useMutation({ mutationFn: ({ id, notes }: { id: string; notes: string }) => apiJson<Asset>(`/v1/onboarding/assets/${id}/return`, { method: 'POST', body: JSON.stringify({ notes }) }), onSuccess: refresh })
  return { create, assign, receive }
}

/**
 * Problems employees reported with their equipment (GET /v1/onboarding/assets/issues,
 * hrms.onboarding.asset.write; OPEN by default). Until V143_59 is applied the server answers
 * 503 FEATURE_NOT_READY, which reads as not available (the block stays hidden).
 */
export function useAssetIssues(status: 'OPEN' | 'RESOLVED' | 'ALL', enabled: boolean) {
  return useAvailableQuery<AssetIssue[]>({
    queryKey: [...key, 'issues', status],
    queryFn: () => asAvailable(() => apiJson<AssetIssue[]>(`/v1/onboarding/assets/issues?status=${status}`)),
    enabled,
  })
}

/** HR marks a report resolved, with an optional note; the asset list's open problem clears with it. */
export function useResolveAssetIssue() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, note }: { id: string; note?: string }) =>
      apiJson<AssetIssue>(`/v1/onboarding/assets/issues/${id}/resolve`, { method: 'POST', body: JSON.stringify({ note: note || null }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  })
}
