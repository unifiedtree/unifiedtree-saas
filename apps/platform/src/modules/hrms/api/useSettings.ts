import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiJson } from '@/core/api/client'

export type HolidayType = 'NATIONAL' | 'FESTIVAL' | 'RESTRICTED' | 'REGIONAL' | 'OPTIONAL' | 'COMPANY'

export interface HolidayResponse {
  id: string
  companyId: string
  year: number
  holidayDate: string
  holidayName: string
  holidayType: HolidayType
  description?: string
  active: boolean
}

export function useHolidays(companyId: string, year?: number) {
  const params = new URLSearchParams({ companyId })
  if (year) params.set('year', String(year))
  return useQuery({
    queryKey: ['hrms', 'settings', 'holidays', companyId, year ?? 'all'],
    queryFn: () => apiJson<HolidayResponse[]>(`/v1/settings/holidays?${params}`),
    enabled: !!companyId,
    staleTime: Infinity,
  })
}

export function useCreateHoliday() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: {
      companyId: string
      holidayDate: string
      holidayName: string
      holidayType?: HolidayType
      description?: string
    }) => apiJson<HolidayResponse>('/v1/settings/holidays', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'settings', 'holidays'] }),
  })
}

export function useDeleteHoliday() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiJson<void>(`/v1/settings/holidays/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'settings', 'holidays'] }),
  })
}
