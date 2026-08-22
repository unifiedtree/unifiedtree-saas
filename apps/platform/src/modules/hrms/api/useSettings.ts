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
    // Reference data, but NOT immutable — HR adds holidays from the mobile app
    // and the open web calendar has to catch up without a browser reload.
    // staleTime: Infinity meant "never re-fetch this tab, ever".
    staleTime: 5 * 60_000,
    // 'always' (not true) — refetch on focus even inside the staleTime window,
    // so tabbing back from the app shows the new holiday immediately. Opted in
    // per-query because the global default stays false (see QueryProvider).
    refetchOnWindowFocus: 'always',
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

// ── HR configuration (per-company) ─────────────────────────────────────────
export interface HrConfigResponse {
  id: string
  companyId: string
  fiscalYearStart?: string
  defaultNoticePeriodDays?: number
  probationPeriodMonths?: number
  retirementAge?: number
  enableLateAutoDeduction: boolean
  lateGraceMinutes?: number
  enforceGeofencingForMobile: boolean
  allowWorkFromHome: boolean
  workweekStartDay?: number
  weekendDays?: number[]
  employeeCodePrefix: string
  employeeCodeNextNumber: number
  employeeCodePadding: number
}

export function useHrConfig(companyId: string | undefined) {
  return useQuery({
    queryKey: ['hrms', 'settings', 'hr-config', companyId],
    queryFn: () => apiJson<HrConfigResponse>(`/v1/settings/hr-configuration?companyId=${companyId}`),
    enabled: !!companyId,
    staleTime: 60_000,
  })
}

export function useUpdateHrConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { companyId: string; body: Partial<Omit<HrConfigResponse, 'id' | 'companyId'>> }) =>
      apiJson<HrConfigResponse>(`/v1/settings/hr-configuration?companyId=${input.companyId}`, {
        method: 'PUT',
        body: JSON.stringify(input.body),
      }),
    onSuccess: (_, vars) =>
      qc.invalidateQueries({ queryKey: ['hrms', 'settings', 'hr-config', vars.companyId] }),
  })
}

// Preview of the next auto-generated employee code (non-consuming — the
// backend atomically issues + increments on the actual employee-create).
export interface NextEmployeeCodePreview {
  preview: string
  prefix: string
  nextNumber: number
  padding: number
}

export function useNextEmployeeCode(companyId: string | undefined) {
  return useQuery({
    queryKey: ['hrms', 'settings', 'next-employee-code', companyId],
    queryFn: () =>
      apiJson<NextEmployeeCodePreview>(`/v1/settings/employee-code/preview?companyId=${companyId}`),
    enabled: !!companyId,
    // Re-fetch every time the form opens; another admin may have created an
    // employee since we last saw a preview.
    staleTime: 0,
    gcTime: 0,
  })
}
