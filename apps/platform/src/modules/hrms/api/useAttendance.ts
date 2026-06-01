import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiJson } from '@/core/api/client'

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
}

export interface AttendanceSummaryCounts {
  present: number
  absent: number
  late: number
  halfDay: number
  onLeave: number
  workFromHome: number
  notMarked: number
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
}

export interface CorrectionRequestResponse {
  id: string
  employeeId: string
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

export function useMonthlyStats(year?: number, month?: number) {
  const params = new URLSearchParams()
  if (year) params.set('year', String(year))
  if (month) params.set('month', String(month))
  return useQuery({
    queryKey: ['hrms', 'attendance', 'monthly-stats', year, month],
    queryFn: () => apiJson<MonthlyStatsResponse>(`/v1/attendance/monthly-stats?${params}`),
    staleTime: 30_000,
  })
}

export function useAttendanceHistory(year?: number, month?: number) {
  const params = new URLSearchParams()
  if (year) params.set('year', String(year))
  if (month) params.set('month', String(month))
  return useQuery({
    queryKey: ['hrms', 'attendance', 'history', year, month],
    queryFn: () => apiJson<DayRecordResponse[]>(`/v1/attendance/history?${params}`),
    staleTime: 30_000,
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

export function useCorrectionApprovals(status = 'PENDING') {
  return useQuery({
    queryKey: ['hrms', 'attendance', 'corrections', 'approvals', status],
    queryFn: () =>
      apiJson<{ content: CorrectionRequestResponse[]; totalElements: number }>(
        `/v1/attendance/corrections/approvals?status=${status}`
      ),
    staleTime: 30_000,
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
    mutationFn: (data: { requestedDate: string; requestedCheckInAt?: string; requestedCheckOutAt?: string; reason: string }) =>
      apiJson<CorrectionRequestResponse>('/v1/attendance/corrections', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'attendance', 'corrections'] }),
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'attendance', 'corrections'] }),
  })
}
