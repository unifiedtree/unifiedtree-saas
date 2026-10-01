import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiJson } from '@/core/api/client'
import { asAvailable, unmatchedPathParam, useAvailableQuery } from '../../api/shared/available'

export type DistributionStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'PARTIAL_FAILURE' | 'FAILED'
export type RecipientSendStatus = 'PENDING' | 'GENERATING' | 'SENT' | 'FAILED' | 'SKIPPED'
export type RecipientFilterType =
  | 'ALL_EMPLOYEES' | 'BY_COMPANY' | 'BY_DEPARTMENT' | 'BY_DESIGNATION' | 'BY_EMPLOYMENT_TYPE' | 'BY_BRANCH' | 'CUSTOM_LIST'

export interface RecipientFilter {
  type: RecipientFilterType
  values?: string[]       // department/designation/company/branch IDs, or employment-type names
  employeeIds?: string[]  // CUSTOM_LIST
}

export interface CreateDistributionRequest {
  templateId: string
  title: string
  customMessage?: string
  subjectOverride?: string
  recipientFilter: RecipientFilter
}

export interface DistributionRecipientDto {
  id: string
  employeeId: string
  email: string
  sendStatus: RecipientSendStatus
  sendAttemptedAt?: string
  sentAt?: string
  errorMessage?: string
  generatedLetterId?: string
}

export interface DistributionJobDto {
  id: string
  templateId: string
  title: string
  customMessage?: string
  subjectOverride?: string
  createdBy: string
  createdAt: string
  status: DistributionStatus
  totalRecipients: number
  sentCount: number
  failedCount: number
  completedAt?: string
  recipients?: DistributionRecipientDto[]
  /** The letter template's name (BW-72); absent on older servers. */
  templateName?: string | null
}

export interface PageResponse<T> {
  content: T[]
  page: number
  size: number
  totalElements: number
  totalPages: number
  last: boolean
}

const TERMINAL: DistributionStatus[] = ['COMPLETED', 'PARTIAL_FAILURE', 'FAILED']
export const isTerminalStatus = (s?: DistributionStatus): boolean => !!s && TERMINAL.includes(s)

export function useDistributions(page = 0) {
  return useQuery({
    queryKey: ['hrms', 'letters', 'distributions', 'list', page],
    queryFn: () => apiJson<PageResponse<DistributionJobDto>>(`/v1/letters/distributions?page=${page}&size=20`),
    staleTime: 10_000,
  })
}

export function useDistribution(jobId?: string) {
  return useQuery({
    queryKey: ['hrms', 'letters', 'distributions', 'detail', jobId],
    queryFn: () => apiJson<DistributionJobDto>(`/v1/letters/distributions/${jobId}`),
    enabled: !!jobId,
    // Poll every 3s while still running; STOP once the status is terminal so the
    // page doesn't keep hitting the server forever (no leak).
    refetchInterval: (query) => (isTerminalStatus(query.state.data?.status) ? false : 3000),
  })
}

export function useCreateDistribution() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (req: CreateDistributionRequest) =>
      apiJson<DistributionJobDto>('/v1/letters/distributions', { method: 'POST', body: JSON.stringify(req) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'letters', 'distributions'] }),
  })
}

export function useRetryDistribution() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (jobId: string) =>
      apiJson<{ retried: number }>(`/v1/letters/distributions/${jobId}/retry`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'letters', 'distributions'] }),
  })
}

// ── "Send on" (BW-73) ─────────────────────────────────────────────────────────

/** A distribution kept for a later date: SCHEDULED, STARTING (being started now) or FAILED (could not start). */
export interface ScheduledDistribution {
  id: string
  templateId: string
  templateName?: string | null
  title: string
  customMessage?: string | null
  subjectOverride?: string | null
  recipientFilter?: RecipientFilter | null
  /** yyyy-MM-dd; it starts at 9:00 India time that day. */
  sendOn: string
  status: 'SCHEDULED' | 'STARTING' | 'FAILED'
  failureReason?: string | null
  /** How many people the recipients matched when it was scheduled. */
  recipientsAtSchedule?: number | null
  createdAt: string
}

export interface ScheduleDistributionRequest extends CreateDistributionRequest {
  sendOn: string
}

/**
 * Scheduled sends. Until the server has them (404, or 503 FEATURE_NOT_READY)
 * this is `notAvailable`: the page hides the block and "Send on".
 */
export function useScheduledDistributions(opts?: { enabled?: boolean }) {
  return useAvailableQuery<ScheduledDistribution[]>({
    queryKey: ['hrms', 'letters', 'distributions', 'scheduled'],
    // On a server without it, /scheduled falls into /{jobId} and answers 400 INVALID_PARAMETER: not built yet.
    queryFn: () => asAvailable(() => apiJson<ScheduledDistribution[]>('/v1/letters/distributions/scheduled'), unmatchedPathParam),
    enabled: opts?.enabled ?? true,
    staleTime: 10_000,
    retry: false,
  })
}

export function useScheduleDistribution() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (req: ScheduleDistributionRequest) =>
      apiJson<ScheduledDistribution>('/v1/letters/distributions/scheduled', { method: 'POST', body: JSON.stringify(req) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'letters', 'distributions'] }),
  })
}

export function useCancelScheduledDistribution() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiJson<void>(`/v1/letters/distributions/scheduled/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'letters', 'distributions'] }),
  })
}
