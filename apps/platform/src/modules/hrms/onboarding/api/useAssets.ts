import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiJson } from '@/core/api/client'

export interface Asset {
  id: string; companyId: string; employeeId?: string; assetTag: string; assetType: string;
  assetName: string; serialNo?: string; status: string; assignedAt?: string; returnedAt?: string; conditionNotes?: string
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
