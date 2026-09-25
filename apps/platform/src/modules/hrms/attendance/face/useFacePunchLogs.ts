import { useQuery } from '@tanstack/react-query'
import { apiJson } from '@/core/api/client'

// Mirrors backend com.unifiedtree.attendance.face.dto.FaceDtos. Both admin
// endpoints are gated on `attendance.face.admin.read` (FaceController).
//
// `employeeId` on both records is the employee's auth user id (the JWT subject
// the mobile app punched with), not an hrms.employees id — the backend joins it
// to auth.user_credentials for the email and returns no name or code. `device`
// is the phone or kiosk the check was made on, when known (V143.25).

export type FacePurpose = 'PUNCH_IN' | 'PUNCH_OUT' | 'ENROLLMENT_SAMPLE' | 'MANUAL_TEST'
export type FaceResult =
  | 'PASS' | 'FAIL_MULTIPLE_FACES' | 'FAIL_NO_FACE' | 'FAIL_LOW_QUALITY' | 'FAIL_LIVENESS'
  | 'FAIL_MATCH' | 'FAIL_NOT_ENROLLED' | 'FAIL_LOCKED' | 'FAIL_WORKER_UNAVAILABLE' | 'FAIL_OTHER'
/** Coarse match bucket — the backend never exposes the raw similarity score. */
export type FaceScoreBucket = 'HIGH' | 'MEDIUM' | 'LOW' | 'REJECTED' | 'UNKNOWN'

/** GET /v1/attendance/face/admin/events item. */
export interface FaceVerificationEvent {
  id: string
  employeeId: string
  purpose: FacePurpose
  result: FaceResult
  reason?: string | null
  scoreBucket?: FaceScoreBucket | null
  createdAt: string
  /** The phone or kiosk the check was made on; null for older events. */
  device?: string | null
}

/** GET /v1/attendance/face/admin/employees item. */
export interface FaceEnrollmentSummary {
  employeeId: string
  email?: string | null
  status: 'PENDING' | 'ACTIVE' | 'NEEDS_REENROLLMENT' | 'LOCKED' | 'REVOKED'
  samplesCaptured: number
  consecutiveFailures: number
  enrolledAt?: string | null
  lockedAt?: string | null
  lockedReason?: string | null
}

/**
 * Newest-first window the events endpoint returns in one call. The server caps
 * `limit` at 500 and has no page/date parameters, so this is the full reach of
 * the log from the web today.
 */
export const FACE_EVENT_LIMIT = 500

export function useFaceEvents(employeeId?: string, enabled = true) {
  return useQuery({
    queryKey: ['hrms', 'attendance', 'face', 'events', employeeId ?? 'all'],
    queryFn: () => apiJson<FaceVerificationEvent[]>(
      `/v1/attendance/face/admin/events?limit=${FACE_EVENT_LIMIT}${employeeId ? `&employeeId=${employeeId}` : ''}`),
    enabled,
    staleTime: 30_000,
  })
}

export function useFaceEnrollments(enabled = true) {
  return useQuery({
    queryKey: ['hrms', 'attendance', 'face', 'enrollments'],
    queryFn: () => apiJson<FaceEnrollmentSummary[]>('/v1/attendance/face/admin/employees'),
    enabled,
    staleTime: 60_000,
  })
}
