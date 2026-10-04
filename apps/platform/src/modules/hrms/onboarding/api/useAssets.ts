import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiJson } from '@/core/api/client'
import { asAvailable, useAvailableQuery } from '../../api/shared/available'
import type { AssetIssueBrief, AssetProblemKind } from '../myAssetsApi'

export interface Asset {
  id: string; companyId: string; employeeId?: string; assetTag: string; assetType: string;
  assetName: string; serialNo?: string; status: string; assignedAt?: string; returnedAt?: string; conditionNotes?: string
  // BW-69 / BW-70 (absent on older servers):
  /** Who has it now; only for callers who may read employee records. */
  holderName?: string | null
  /** Who had it last, once it is back; same rule. */
  lastHolderName?: string | null
  /** The holder confirmed they have it (or it counted as confirmed when confirmations started). */
  confirmedAt?: string | null
  confirmationSource?: string | null
  /** Handed over and not confirmed yet. */
  confirmationPending?: boolean | null
  /** A problem the holder reported that hasn't been resolved. */
  openIssue?: AssetIssueBrief | null
}
export type AssetInput = Pick<Asset, 'companyId' | 'assetTag' | 'assetType' | 'assetName' | 'serialNo' | 'conditionNotes'>
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

/** A problem an employee reported with their asset, as HR's list shows it (BW-70). */
export interface AssetIssue {
  id: string
  assetId: string
  assetTag: string
  assetName: string
  assetType: string | null
  companyId: string | null
  employeeId: string | null
  /** Only for callers who may read employee records. */
  employeeName: string | null
  kind: AssetProblemKind | string
  note: string | null
  status: string
  reportedAt: string
  resolvedAt: string | null
  resolvedByName: string | null
  resolutionNote: string | null
}

/**
 * GET /v1/onboarding/assets/issues?status=OPEN (hrms.onboarding.asset.write). Until V143.59
 * is applied the server answers FEATURE_NOT_READY: `notAvailable`, and the page leaves the
 * list out.
 */
export function useAssetIssues(enabled: boolean) {
  return useAvailableQuery<AssetIssue[]>({
    queryKey: [...key, 'issues', 'OPEN'],
    queryFn: () => asAvailable(() => apiJson<AssetIssue[]>('/v1/onboarding/assets/issues?status=OPEN')),
    enabled,
  })
}

/** HR marks a reported problem resolved, with an optional note. */
export function useResolveAssetIssue() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, note }: { id: string; note?: string }) =>
      apiJson<AssetIssue>(`/v1/onboarding/assets/issues/${id}/resolve`, { method: 'POST', body: JSON.stringify({ note: note?.trim() || undefined }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  })
}
