// The workspace's report export log (GET /v1/reports/exports) and scheduled
// report emails (/v1/reports/schedules). See ReportExportController.java and
// ReportScheduleController.java.
import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiJson } from '@/core/api/client'

export interface ExportLogRow {
  id: string
  report: string
  label: string
  format: 'CSV' | 'XLSX' | 'PDF' | 'PNG'
  source: 'SERVER' | 'BROWSER' | 'SCHEDULE'
  fileName: string | null
  companyId: string | null
  companyName: string | null
  filters: Record<string, string | number | boolean | null>
  rowCount: number | null
  sizeBytes: number | null
  scheduleId: string | null
  createdAt: string
  userId: string | null
  userName: string | null
  userEmail: string | null
  mine: boolean
}
export interface ExportLogPage { content: ExportLogRow[]; total: number; page: number; size: number; scope: 'all' | 'mine'; canSeeAll: boolean }

/** One page of the export log. The server decides who sees what (everyone's with hrms.report.exports.read_all). */
export function useExportLog(scope: 'all' | 'mine' | undefined, page: number, size: number, enabled = true) {
  const qc = useQueryClient()
  // Downloads made anywhere in this tab refresh the list.
  useEffect(() => {
    const f = () => { qc.invalidateQueries({ queryKey: ['reports', 'exports'] }) }
    window.addEventListener('ut-downloads', f)
    return () => window.removeEventListener('ut-downloads', f)
  }, [qc])
  const qs = new URLSearchParams({ page: String(page), size: String(size), ...(scope ? { scope } : {}) })
  return useQuery({
    queryKey: ['reports', 'exports', scope ?? 'default', page, size],
    queryFn: () => apiJson<ExportLogPage>(`/v1/reports/exports?${qs}`),
    enabled,
    staleTime: 15_000,
  })
}

export interface ScheduleRecipient { id: string; name: string | null; email: string | null; active: boolean }
export interface ReportSchedule {
  id: string
  report: string
  reportLabel: string
  companyId: string
  companyName: string | null
  frequency: 'WEEKLY' | 'MONTHLY'
  dayOfWeek: number | null
  dayOfMonth: number | null
  recipients: ScheduleRecipient[]
  active: boolean
  nextRunOn: string
  lastRunAt: string | null
  lastStatus: 'SENT' | 'PARTIAL' | 'FAILED' | 'SKIPPED' | null
  lastMessage: string | null
  createdBy: string | null
  createdByName: string | null
}
export interface ScheduleInput {
  report: string
  companyId: string
  frequency: 'WEEKLY' | 'MONTHLY'
  dayOfWeek: number | null
  dayOfMonth: number | null
  recipientIds: string[]
  active: boolean
}
export interface EligibleRecipient { id: string; name: string | null; email: string | null }
export interface SendResult { status: 'SENT' | 'PARTIAL' | 'FAILED' | 'SKIPPED'; sent: number; failed: number; skipped: number; message: string }

const KEY = ['reports', 'schedules']

export function useReportSchedules(enabled: boolean) {
  return useQuery({ queryKey: KEY, queryFn: () => apiJson<ReportSchedule[]>('/v1/reports/schedules'), enabled, staleTime: 15_000 })
}

/** Workspace members who can open the report (the only people who may receive it). */
export function useScheduleRecipients(report: string, enabled: boolean) {
  return useQuery({
    queryKey: [...KEY, 'recipients', report],
    queryFn: () => apiJson<EligibleRecipient[]>(`/v1/reports/schedules/recipients?report=${encodeURIComponent(report)}`),
    enabled: enabled && !!report,
    staleTime: 60_000,
  })
}

export function useSaveSchedule() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id?: string | null; input: ScheduleInput }) =>
      apiJson<ReportSchedule>(`/v1/reports/schedules${id ? `/${id}` : ''}`, { method: id ? 'PUT' : 'POST', body: JSON.stringify(input) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}

export function useDeleteSchedule() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiJson<void>(`/v1/reports/schedules/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}

export function useSendScheduleNow() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiJson<SendResult>(`/v1/reports/schedules/${id}/send-now`, { method: 'POST' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); qc.invalidateQueries({ queryKey: ['reports', 'exports'] }) },
  })
}
