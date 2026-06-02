import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiJson } from '@/core/api/client'

export type ProbationReminderType = 'UPCOMING' | 'OVERDUE' | 'FINAL'

export interface ProbationConfig {
  reminderDaysBefore: number
  autoExtendEnabled: boolean
  autoExtendDays: number
}

export interface UpcomingProbation {
  employeeId: string
  employeeCode: string
  employeeName: string
  probationEndDate: string
  daysRemaining: number
  jobTitle?: string | null
  managerName?: string | null
}

export interface ProbationReminder {
  id: string
  employeeId: string
  employeeName: string
  probationEndDate: string
  reminderType: ProbationReminderType
  sentAt: string
}

const KEY = ['hrms', 'probation'] as const

export function useProbationConfig() {
  return useQuery({
    queryKey: [...KEY, 'config'],
    queryFn: () => apiJson<ProbationConfig>('/v1/probation/config'),
    staleTime: 60_000,
  })
}

export function useUpdateProbationConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: ProbationConfig) =>
      apiJson<ProbationConfig>('/v1/probation/config', { method: 'PUT', body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...KEY, 'config'] }),
  })
}

export function useUpcomingProbations(days = 30) {
  return useQuery({
    queryKey: [...KEY, 'upcoming', days],
    queryFn: () => apiJson<UpcomingProbation[]>(`/v1/probation/upcoming?days=${days}`),
    staleTime: 30_000,
  })
}

export function useProbationReminders() {
  return useQuery({
    queryKey: [...KEY, 'reminders'],
    queryFn: () => apiJson<ProbationReminder[]>('/v1/probation/reminders'),
    staleTime: 30_000,
  })
}

export function useTriggerProbationScan() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => apiJson<{ scanned: number; remindersSent: number }>(
      '/v1/probation/scan-now', { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [...KEY, 'reminders'] })
      qc.invalidateQueries({ queryKey: [...KEY, 'upcoming'] })
    },
  })
}

export function useExtendProbation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ employeeId, newEndDate }: { employeeId: string; newEndDate: string }) =>
      apiJson<void>(`/v1/probation/employees/${employeeId}/extend?newEndDate=${newEndDate}`, { method: 'POST' }),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['hrms', 'employee', vars.employeeId] })
      qc.invalidateQueries({ queryKey: [...KEY, 'upcoming'] })
    },
  })
}
