// My assets: confirm you got an asset, or report a problem with it (P-HIRE's
// BW-70 endpoints, used by P-DOCS's My assets page).
//   GET  /v1/me/assets                     canConfirm / confirmedAt / openIssue on each asset
//   POST /v1/me/assets/{assetId}/confirm   "Yes, I have it"
//   POST /v1/me/assets/{assetId}/problem   { kind: LOST | DAMAGED | NOT_WORKING | OTHER, note? }
// All hrms.onboarding.asset.self, and only for the asset the caller holds now.
// Until V143.59 is applied the list carries nothing to confirm and both actions
// answer FEATURE_NOT_READY; the page then hides them.
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiJson } from '@/core/api/client'
import { isFeatureNotReady } from '@/core/api/featureNotReady'
import type { MyAsset } from './api/useOnboarding'

export type AssetProblemKind = 'LOST' | 'DAMAGED' | 'NOT_WORKING' | 'OTHER'

export const PROBLEM_KINDS: { value: AssetProblemKind; label: string }[] = [
  { value: 'NOT_WORKING', label: 'It isn’t working' },
  { value: 'DAMAGED', label: 'It’s damaged' },
  { value: 'LOST', label: 'I lost it' },
  { value: 'OTHER', label: 'Something else' },
]

/** A problem I reported that HR hasn't resolved yet. */
export interface AssetIssueBrief { id: string; kind: AssetProblemKind; note?: string | null; reportedAt: string }

/** GET /v1/me/assets with the BW-70 fields (absent on older servers). */
export interface MyAssetCare extends MyAsset {
  confirmedAt?: string | null
  canConfirm?: boolean
  openIssue?: AssetIssueBrief | null
}

const MY_ASSETS = ['hrms', 'me', 'assets']

/** Resolves false when confirmations aren't switched on yet (FEATURE_NOT_READY). */
export function useConfirmMyAsset() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (assetId: string) => {
      try {
        await apiJson(`/v1/me/assets/${assetId}/confirm`, { method: 'POST' })
        return true
      } catch (e) {
        if (isFeatureNotReady(e)) return false
        throw e
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: MY_ASSETS }),
  })
}

/** Resolves false when problem reports aren't switched on yet (FEATURE_NOT_READY). */
export function useReportAssetProblem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ assetId, kind, note }: { assetId: string; kind: AssetProblemKind; note?: string }) => {
      try {
        await apiJson(`/v1/me/assets/${assetId}/problem`, { method: 'POST', body: JSON.stringify({ kind, note: note?.trim() || undefined }) })
        return true
      } catch (e) {
        if (isFeatureNotReady(e)) return false
        throw e
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: MY_ASSETS }),
  })
}

/** The kind of problem in words. */
export function problemLabel(kind?: string | null): string {
  switch (kind) {
    case 'LOST': return 'Reported lost'
    case 'DAMAGED': return 'Reported damaged'
    case 'NOT_WORKING': return 'Reported not working'
    default: return 'Problem reported'
  }
}
