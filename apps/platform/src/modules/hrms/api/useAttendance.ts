import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiJson } from '@/core/api/client'
import type { PageResponse } from './useWorkforce'

export interface AttendanceDto {
  id: string
  attendanceDate: string
  checkInTime?: string
  checkOutTime?: string
  attendanceType?: string
  attendanceStatus?: string
  checkInMethod?: string
  checkOutMethod?: string
  workHours?: number
  faceConfidenceScore?: number
  locationName?: string
  checkInZoneName?: string
  checkOutZoneName?: string
  lateByMinutes?: number
  overtimeMinutes?: number
  manualEntry: boolean
}

export interface MonthlyStatsResponse {
  presentDays: number
  absentDays: number
  lateDays: number
  holidays: number
  onTimeDays: number
  attendanceScore: number
}

export interface DayRecordResponse {
  date: string
  status: string
  checkInTime?: string
  checkOutTime?: string
  workHours?: number
  /** Why the day has this status (attendance policy or a reviewer); V143.10. */
  note?: string | null
  manual?: boolean
}

export interface StaffStatusResponse {
  employeeId: string
  employeeCode: string
  fullName: string
  jobTitle?: string
  departmentId?: string
  departmentName?: string
  profilePhotoUrl?: string
  status: string
  checkInAt?: string
  checkOutAt?: string
  locationName?: string
  latitude?: number
  longitude?: number
  /**
   * True when the employee checked out before their assigned shift's end time
   * (IST wall-clock). False when there is no checkout, no shift assignment or
   * no end_time.
   *
   * The API has always returned this — see the Java record
   * `com.hrms.attendance.dto.StaffStatusResponse` — it was simply missing from
   * this interface, so no web screen could read it and the Early Out drill-down
   * had no way to filter. (Same omission as `earlyCheckout` on
   * AttendanceSummaryCounts, fixed 2026-08.) Optional here rather than required
   * so a cached/older response without the field still type-checks.
   */
  earlyCheckout?: boolean
  /**
   * OFFICE / WFH / FIELD — the record's attendance TYPE, a different axis from
   * `status`. The dashboard's "Work From Home" tile counts by this field, never
   * by status, so without it the WFH drill-down could not reproduce its own
   * tile. Undefined when the employee has no record for the date.
   */
  attendanceType?: string
  /**
   * True when the employee has APPROVED leave covering the date. "On Leave" is
   * counted from this, and "Absent" is "no punch AND not on leave" — neither is
   * derivable from the punch alone because leave lives in another module.
   */
  onLeave?: boolean
  /** The shift in force on the date; null when the employee has no assignment. */
  shiftName?: string | null
  /** Scheduled check-in (shift start on the date). */
  expectedCheckInAt?: string | null
  graceMinutes?: number | null
  /** Minutes after the scheduled start — set only for LATE records. */
  lateByMinutes?: number | null
  /**
   * V143.10: the day's effective status — the company attendance policy (grace,
   * half-day rules, late allowance) plus any reviewer's change. PRESENT · LATE ·
   * HALF_DAY · ABSENT · NOT_MARKED · ON_LEAVE · HOLIDAY · WEEKLY_OFF · NOT_TRACKED.
   * `status` keeps the older words the mobile app reads.
   */
  effectiveStatus?: string | null
  /** Why the day has this status, in plain English. */
  statusNote?: string | null
  /** A reviewer set or excused the day by hand. */
  statusManual?: boolean
  lossOfPay?: boolean
  withinAllowance?: boolean
  outsideGeofence?: boolean
  punchRejected?: boolean
  earlyByMinutes?: number | null
  workedMinutes?: number | null
}

export interface AttendanceSummaryCounts {
  present: number
  absent: number
  late: number
  halfDay: number
  onLeave: number
  workFromHome: number
  notMarked: number
  /** Checked out before the assigned shift end. The API has always returned
   *  this; it was simply missing from the type, so no screen could read it. */
  earlyCheckout: number
}

export interface TeamDashboardResponse {
  date: string
  counts: AttendanceSummaryCounts
  staffStatuses: StaffStatusResponse[]
}

export interface AttendanceLogResponse {
  eventId: string
  attendanceRecordId?: string
  employeeId: string
  employeeName?: string
  employeeCode?: string
  departmentName?: string
  eventDate: string
  eventAt: string
  eventType?: string
  attendanceStatus?: string
  locationName?: string
  zoneName?: string
  note?: string
}

export interface AttendanceRecordResponse {
  id: string
  employeeId: string
  attendanceDate: string
  checkInAt?: string
  checkOutAt?: string
  attendanceStatus: string
  attendanceType?: string
  workingHours?: number
  // ── Fields the Java DTO has always returned but this type never declared ──
  // AttendanceRecordResponse (hrms-attendance/dto) projects all of the below.
  // Declaring them is what lets the employee-profile attendance table show a
  // late/overtime/regularised column without an `as unknown as { … }` cast —
  // and a cast is exactly what stops the compiler noticing when the server
  // drops a field. Same reasoning as the WorkforceEmployee widening (2026-09-09).
  checkInMethod?: string
  checkOutMethod?: string
  regularized?: boolean
  locationName?: string
  checkInZoneName?: string
  checkOutZoneName?: string
  lateByMinutes?: number
  overtimeMinutes?: number
  manualEntry?: boolean
}

/** One day inside {@link WeeklySummaryResponse}. Mirrors WeeklyDayResponse. */
export interface WeeklyDayResponse {
  date: string
  hours: number
  /** ON_TIME | LATE | WEEKEND | HOLIDAY | ON_LEAVE | ABSENT | UPCOMING (future) | NOT_MARKED (today with no punch yet, or before attendance started) */
  status: string
  checkInTime?: string
  checkOutTime?: string
  lateByMinutes?: number
  note?: string | null
  manual?: boolean
}

/**
 * Mirrors WeeklySummaryResponse. Week-offs, holidays and approved leave are
 * overlaid SERVER-side, so `days[].status` is authoritative — the UI must not
 * try to recompute "was this a working day" from the raw records.
 */
export interface WeeklySummaryResponse {
  totalHours: number
  overtimeHours: number
  presentDays: number
  avgArrivalTime?: string
  dailyTargetHours?: number
  days: WeeklyDayResponse[]
}

export interface CorrectionRequestResponse {
  id: string
  employeeId: string
  employeeName?: string
  employeeCode?: string
  departmentName?: string
  attendanceRecordId?: string
  requestedDate: string
  requestedCheckInAt?: string
  requestedCheckOutAt?: string
  reason: string
  attachmentUrl?: string
  status: string
  approverId?: string
  approverComment?: string
  decidedAt?: string
  createdAt: string
}

// ── Employee self-service ──────────────────────────────────────────────────────

export function useTodayAttendance() {
  return useQuery({
    queryKey: ['hrms', 'attendance', 'today'],
    queryFn: () => apiJson<AttendanceDto>('/v1/attendance/today').catch(() => null),
    staleTime: 5_000,
    refetchInterval: 60_000,
  })
}

export function useMonthlyStats(
  year?: number,
  month?: number,
  options?: { enabled?: boolean },
) {
  const params = new URLSearchParams()
  if (year) params.set('year', String(year))
  if (month) params.set('month', String(month))
  return useQuery({
    queryKey: ['hrms', 'attendance', 'monthly-stats', year, month],
    queryFn: () => apiJson<MonthlyStatsResponse>(`/v1/attendance/monthly-stats?${params}`),
    staleTime: 30_000,
    enabled: options?.enabled ?? true,
  })
}

export function useAttendanceHistory(year?: number, month?: number, options?: { enabled?: boolean }) {
  const params = new URLSearchParams()
  if (year) params.set('year', String(year))
  if (month) params.set('month', String(month))
  return useQuery({
    queryKey: ['hrms', 'attendance', 'history', year, month],
    queryFn: () => apiJson<DayRecordResponse[]>(`/v1/attendance/history?${params}`),
    staleTime: 30_000,
    enabled: options?.enabled ?? true,
  })
}

export function useMyAttendance() {
  return useQuery({
    queryKey: ['hrms', 'attendance', 'my'],
    queryFn: () => apiJson<{ content: AttendanceRecordResponse[]; totalElements: number }>('/v1/attendance/my'),
    staleTime: 30_000,
  })
}

export function useMyCorrections() {
  return useQuery({
    queryKey: ['hrms', 'attendance', 'corrections', 'my'],
    queryFn: () => apiJson<{ content: CorrectionRequestResponse[]; totalElements: number }>('/v1/attendance/corrections/my'),
    staleTime: 30_000,
  })
}

// ── Manager / Admin ───────────────────────────────────────────────────────────

/** One point on the dashboard attendance trend chart. */
export interface DailyAttendanceCounts {
  date: string
  present: number
  onLeave: number
  late: number
  halfDay: number
  workFromHome: number
  notMarked: number
  absent: number
  /** Total overtime clocked that day across the roster, in minutes. */
  overtimeMinutes: number
  // Added by V143.25; absent on older servers.
  /** People who checked in that day, each counted once. */
  checkedIn?: number
  /** Of those, who worked from home and was neither late nor half-day. */
  workFromHomeOnTime?: number
  /** People expected at work that day (joined, not on their weekly off). */
  scheduled?: number
  /** People whose own weekly off is that day. */
  weeklyOff?: number
  /** The day is a weekly off for everyone in scope. */
  weeklyOffDay?: boolean
}

/** One capture-method bucket from the attendance-source panel. */
export interface SourceCount {
  method: string
  count: number
}

export interface AttendanceSourceBreakdown {
  date: string
  sources: SourceCount[]
  unknown: number
}

/** How today's punches arrived — face, GPS, PIN, device, manual, override. */
export function useAttendanceSources(date?: string, departmentId?: string, enabled: boolean = true) {
  const params = new URLSearchParams()
  if (date) params.set('date', date)
  if (departmentId) params.set('departmentId', departmentId)
  return useQuery({
    queryKey: ['hrms', 'attendance', 'dashboard', 'sources', date, departmentId],
    queryFn: () => apiJson<AttendanceSourceBreakdown>(`/v1/attendance/dashboard/sources?${params}`),
    staleTime: 60_000,
    enabled,
  })
}

/**
 * Per-day attendance counts for the trend chart.
 *
 * Defaults to the trailing 7 days when no range is given. The server clamps
 * anything longer than 31 days and fills gaps with zero rows, so the series is
 * always dense — the chart never has to guess at missing dates.
 */
export function useAttendanceTrend(from?: string, to?: string, departmentId?: string, enabled: boolean = true) {
  const params = new URLSearchParams()
  if (from) params.set('from', from)
  if (to) params.set('to', to)
  if (departmentId) params.set('departmentId', departmentId)
  return useQuery({
    queryKey: ['hrms', 'attendance', 'dashboard', 'trend', from, to, departmentId],
    queryFn: () => apiJson<DailyAttendanceCounts[]>(`/v1/attendance/dashboard/trend?${params}`),
    staleTime: 60_000,
    enabled,
  })
}

export function useTeamDashboard(date?: string, departmentId?: string, enabled: boolean = true) {
  const params = new URLSearchParams()
  if (date) params.set('date', date)
  if (departmentId) params.set('departmentId', departmentId)
  return useQuery({
    queryKey: ['hrms', 'attendance', 'dashboard', date, departmentId],
    queryFn: () => apiJson<TeamDashboardResponse>(`/v1/attendance/dashboard?${params}`),
    staleTime: 5_000,
    refetchInterval: 60_000,
    enabled,
  })
}

export function useAttendanceLogs(date?: string, departmentId?: string, search?: string, enabled: boolean = true) {
  const params = new URLSearchParams()
  if (date) params.set('date', date)
  if (departmentId) params.set('departmentId', departmentId)
  if (search) params.set('search', search)
  return useQuery({
    queryKey: ['hrms', 'attendance', 'logs', date, departmentId, search],
    queryFn: () => apiJson<AttendanceLogResponse[]>(`/v1/attendance/logs?${params}`),
    staleTime: 5_000,
    refetchInterval: 30_000,
    enabled,
  })
}

export function useCorrectionApprovals(status = 'PENDING', opts?: { enabled?: boolean; page?: number; size?: number }) {
  return useQuery({
    queryKey: ['hrms', 'attendance', 'corrections', 'approvals', status, opts?.page ?? 0, opts?.size ?? 20],
    queryFn: () =>
      apiJson<{ content: CorrectionRequestResponse[]; totalElements: number; totalPages: number }>(
        `/v1/attendance/corrections/approvals?status=${status}&page=${opts?.page ?? 0}&size=${opts?.size ?? 20}`
      ),
    staleTime: 30_000,
    // Approval queue — poll so a correction raised from the app appears while
    // the approver sits on the screen. Paused automatically when `enabled` is
    // false, so non-managers still never hit the 403-ing endpoint.
    refetchInterval: 30_000,
    // Gated by the caller — the approvals endpoint 403s for non-managers,
    // so an unconditional fetch by an employee threw a red toast every time
    // they opened the Corrections tab. Default remains true for callers
    // that already gate the render.
    enabled: opts?.enabled ?? true,
  })
}

// ── Mutations ─────────────────────────────────────────────────────────────────

export function useCheckIn() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: { latitude?: number; longitude?: number; checkInMethod?: string; locationName?: string; offlineCaptured?: boolean }) =>
      apiJson<AttendanceDto>('/v1/attendance/checkin', { method: 'POST', body: JSON.stringify({ latitude: 0, longitude: 0, checkInMethod: 'MANUAL', offlineCaptured: false, ...data }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hrms', 'attendance', 'today'] })
      qc.invalidateQueries({ queryKey: ['hrms', 'attendance', 'monthly-stats'] })
    },
  })
}

export function useCheckOut() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: { latitude?: number; longitude?: number } = {}) =>
      apiJson<AttendanceDto>('/v1/attendance/checkout', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hrms', 'attendance', 'today'] })
      qc.invalidateQueries({ queryKey: ['hrms', 'attendance', 'monthly-stats'] })
    },
  })
}

export function useCreateCorrection() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: { requestedDate: string; requestedCheckInAt?: string; requestedCheckOutAt?: string; reason: string; attachmentUrl?: string }) =>
      apiJson<CorrectionRequestResponse>('/v1/attendance/corrections', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'attendance'] }),
  })
}

export function useDecideCorrection() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, status, comment }: { id: string; status: 'APPROVED' | 'REJECTED'; comment?: string }) =>
      apiJson<CorrectionRequestResponse>(`/v1/attendance/corrections/${id}/decision`, {
        method: 'POST',
        body: JSON.stringify({ status, comment }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'attendance'] }),
  })
}

// Admin / HR punch-on-behalf. Backend: POST /v1/attendance/manual-entry
// (see ManualAttendanceRequest — employeeId, attendanceDate, checkInAt, checkOutAt,
// attendanceType, attendanceStatus, latitude, longitude, locationName, reason).
export interface ManualEntryPayload {
  employeeId: string
  attendanceDate: string           // yyyy-MM-dd
  checkInAt?: string               // ISO instant, optional
  checkOutAt?: string              // ISO instant, optional
  attendanceType?: string
  attendanceStatus?: string
  latitude?: number
  longitude?: number
  locationName?: string
  reason: string
}

export function useManualEntry() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: ManualEntryPayload) =>
      apiJson<AttendanceDto>('/v1/attendance/manual-entry', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    // Refresh muster roll + team dashboard so the new punch shows up immediately.
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hrms', 'attendance', 'dashboard'] })
      qc.invalidateQueries({ queryKey: ['hrms', 'attendance', 'logs'] })
      qc.invalidateQueries({ queryKey: ['hrms', 'attendance', 'today'] })
    },
  })
}

// ── One employee's attendance (manager/admin view) ────────────────────────────
//
// Both endpoints below carry a server-side object-scope guard on top of the
// `attendance.team.read` authority: AttendanceController.assertCanReadEmployeeAttendance
// allows self, the employee's direct manager, or HR/admin authorities, and
// throws AccessDeniedException otherwise (B7 IDOR fix, audit 2026-08-15).
// So a 403 here is a NORMAL, expected outcome for a manager opening a profile
// outside their team — callers must render that as a permission state, not as
// "no attendance records". Neither hook retries, because a 403 will never
// succeed on retry and the profile should settle immediately.

/**
 * Paged attendance rows for ONE employee, newest first.
 *
 * The sort is explicit because the backend's repository method
 * (findByEmployeeId) has no OrderBy and @PageableDefault supplies none — without
 * `sort` the rows come back in physical table order, which looks like random
 * dates to the user.
 */
export function useEmployeeAttendanceRecords(
  employeeId: string | undefined,
  page = 0,
  pageSize = 31,
  opts?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: ['attendance', 'employee', employeeId, 'records', page, pageSize],
    queryFn: () => apiJson<PageResponse<AttendanceRecordResponse>>(
      `/v1/attendance/employee/${employeeId}/records?page=${page}&size=${pageSize}&sort=attendanceDate,desc`,
    ),
    enabled: (opts?.enabled ?? true) && !!employeeId,
    staleTime: 60_000,
    retry: false,
  })
}

/**
 * One employee's week. `weekStart` is snapped to that week's Monday server-side;
 * omit it for the current week.
 */
export function useEmployeeWeeklySummary(
  employeeId: string | undefined,
  weekStart?: string,
  opts?: { enabled?: boolean },
) {
  const qs = weekStart ? `?weekStart=${weekStart}` : ''
  return useQuery({
    queryKey: ['attendance', 'employee', employeeId, 'weekly-summary', weekStart ?? 'current'],
    queryFn: () => apiJson<WeeklySummaryResponse>(
      `/v1/attendance/employee/${employeeId}/weekly-summary${qs}`,
    ),
    enabled: (opts?.enabled ?? true) && !!employeeId,
    staleTime: 60_000,
    retry: false,
  })
}
