// Attendance timing policy, review list, manual status changes, face punch
// decisions and regularization proof (V143.10, docs/Designs/STATIC-UI-TO-BUILD.md §4 / §8).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiJson } from '@/core/api/client'

export type AllowancePeriod = 'WEEK' | 'MONTH'
export type AfterAllowance = 'KEEP_LATE' | 'HALF_DAY' | 'LOSS_OF_PAY'

export interface AttendancePolicy {
  companyId: string
  graceMinutes: number
  /** "09:15" — start time for people without a shift. */
  defaultStartTime: string
  halfDayLateMinutes: number | null
  fullDayMinHours: number | null
  halfDayMinHours: number | null
  earlyLeaveMinutes: number
  lateAllowanceCount: number
  lateAllowancePeriod: AllowancePeriod
  afterAllowanceAction: AfterAllowance
  updatedAt?: string | null
  updatedByName?: string | null
}

export type AttendancePolicyUpdate = Omit<AttendancePolicy, 'companyId' | 'updatedAt' | 'updatedByName'>

/** One employee-day as the attendance rules see it (GET /v1/attendance/review/day, POST /status). */
export interface EffectiveDay {
  employeeId: string
  date: string
  status: string
  computedStatus: string
  checkIn?: string | null
  checkOut?: string | null
  lateMinutes?: number | null
  workedMinutes?: number | null
  earlyLeave: boolean
  withinAllowance: boolean
  lossOfPay: boolean
  payableFraction?: number | null
  manual: boolean
  manualReason?: string | null
  manualBy?: string | null
  punchRejected: boolean
  outsideGeofence: boolean
  note?: string | null
}

export interface ReviewException {
  id: string
  employeeId: string
  employeeName: string
  employeeCode: string
  departmentName?: string | null
  date: string
  /** LATE · HALF_DAY · ABSENT · EARLY_LEAVE · NO_CHECKOUT · OUTSIDE_ZONE · FACE_REJECTED */
  flags: string[]
  status: string
  note?: string | null
  checkIn?: string | null
  checkOut?: string | null
  lateMinutes?: number | null
  workedMinutes?: number | null
  earlyByMinutes?: number | null
  distanceMeters?: number | null
  shiftName?: string | null
  expectedStart?: string | null
  lossOfPay: boolean
}

export interface StatusChange {
  id: string
  employeeId: string
  date: string
  /** SET · EXCUSE · CLEAR · FACE_REJECT · FACE_CONFIRM */
  action: string
  fromStatus?: string | null
  toStatus?: string | null
  reason: string
  reviewerName?: string | null
  at: string
}

export interface FaceReviewEvent {
  id: string
  employeeId: string
  employeeName: string
  employeeCode: string
  departmentName?: string | null
  purpose: string
  result: string
  scoreBucket?: string | null
  createdAt: string
  date: string
  /** OK · REVIEW · CONFIRMED · FLAGGED · FAILED */
  status: string
  decision?: string | null
  decisionNote?: string | null
  decidedBy?: string | null
  decidedAt?: string | null
  /** The phone or kiosk the check was made on (V143.25); null when none was recorded. */
  device?: string | null
}

export function useAttendancePolicy(companyId: string | undefined) {
  return useQuery({
    queryKey: ['attendance', 'policy', companyId],
    queryFn: () => apiJson<AttendancePolicy>(`/v1/attendance/policy?companyId=${companyId}`),
    enabled: !!companyId,
    staleTime: 60_000,
  })
}

export function useSaveAttendancePolicy() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ companyId, body }: { companyId: string; body: AttendancePolicyUpdate }) =>
      apiJson<AttendancePolicy>(`/v1/attendance/policy?companyId=${companyId}`, { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: (_, v) => {
      qc.invalidateQueries({ queryKey: ['attendance', 'policy', v.companyId] })
      qc.invalidateQueries({ queryKey: ['hrms', 'settings', 'hr-config', v.companyId] })
      qc.invalidateQueries({ queryKey: ['hrms', 'attendance'] })
      qc.invalidateQueries({ queryKey: ['attendance', 'review'] })
    },
  })
}

export function useReviewExceptions(from: string, to: string, enabled = true) {
  return useQuery({
    queryKey: ['attendance', 'review', 'exceptions', from, to],
    queryFn: () => apiJson<ReviewException[]>(`/v1/attendance/review/exceptions?from=${from}&to=${to}`),
    enabled,
    staleTime: 30_000,
  })
}

export function useFaceReviewEvents(from: string, to: string, enabled = true) {
  return useQuery({
    queryKey: ['attendance', 'review', 'face', from, to],
    queryFn: () => apiJson<FaceReviewEvent[]>(`/v1/attendance/review/face-events?from=${from}&to=${to}`),
    enabled,
    staleTime: 30_000,
  })
}

export function useStatusHistory(employeeId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['attendance', 'review', 'history', employeeId],
    queryFn: () => apiJson<StatusChange[]>(`/v1/attendance/review/history?employeeId=${employeeId}`),
    enabled: enabled && !!employeeId,
  })
}

/** Everything a status change touches: the roster, the review list, history and stats. */
function invalidateAttendance(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['attendance'] })
  qc.invalidateQueries({ queryKey: ['hrms', 'attendance'] })
}

export function useChangeDayStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (b: { employeeId: string; date: string; status: string; reason: string }) =>
      apiJson<EffectiveDay>('/v1/attendance/review/status', { method: 'POST', body: JSON.stringify(b) }),
    onSuccess: () => invalidateAttendance(qc),
  })
}

export function useDecideFacePunch() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, decision, note }: { id: string; decision: 'CONFIRMED' | 'REJECTED'; note?: string }) =>
      apiJson<{ event: FaceReviewEvent; day: EffectiveDay | null }>(`/v1/attendance/review/face-events/${id}/decision`, {
        method: 'POST', body: JSON.stringify({ decision, note }),
      }),
    onSuccess: () => invalidateAttendance(qc),
  })
}

/** Uploads a proof file for a fix request; returns the attachmentUrl to send with it. */
export async function uploadCorrectionProof(file: File) {
  const body = new FormData()
  body.append('file', file)
  return apiJson<{ attachmentUrl: string; fileName: string; contentType: string; sizeBytes: number }>(
    '/v1/attendance/corrections/attachments', { method: 'POST', body })
}

/** A short-lived link to a fix request's proof (only the requester and their approvers get one). */
export async function correctionProofLink(correctionId: string) {
  return apiJson<{ url: string; fileName: string }>(`/v1/attendance/corrections/${correctionId}/attachment`)
}

/** Plain-English status names. */
export const STATUS_LABEL: Record<string, string> = {
  PRESENT: 'Present', LATE: 'Late', HALF_DAY: 'Half day', ABSENT: 'Absent', NOT_MARKED: 'Not marked',
  ON_LEAVE: 'On leave', HOLIDAY: 'Holiday', WEEKLY_OFF: 'Weekly off', NOT_TRACKED: 'Not tracked', UPCOMING: 'Upcoming',
}
export const statusLabel = (s?: string | null) => (s ? STATUS_LABEL[s] || s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ') : '—')
