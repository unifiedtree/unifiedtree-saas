import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { apiJson } from '@/core/api/client'

// Must match backend WorkforceEmployee.EmploymentStatus exactly (@Enumerated(STRING)).
export type EmploymentStatus = 'PROBATION' | 'ACTIVE' | 'NOTICE_PERIOD' | 'SUSPENDED' | 'EXITED' | 'TERMINATED'
export type EmploymentType = 'FULL_TIME' | 'PART_TIME' | 'CONTRACT' | 'INTERN' | 'CONSULTANT'
export type Gender = 'MALE' | 'FEMALE' | 'OTHER' | 'PREFER_NOT_TO_SAY'

export interface WorkforceEmployee {
  id: string
  companyId: string
  employeeCode: string
  firstName: string
  middleName?: string
  lastName?: string
  email: string
  phone?: string
  dateOfBirth?: string
  gender?: Gender
  departmentId?: string
  designationId?: string
  branchId?: string
  reportingManagerId?: string
  employmentType?: EmploymentType
  employmentStatus?: EmploymentStatus
  dateOfJoining?: string
  probationEndDate?: string
  confirmationDate?: string
  lastWorkingDay?: string
  ctcAnnual?: number
  profilePhotoUrl?: string
  faceEnrolled: boolean
  hasAccount?: boolean
  active: boolean
}

export interface PageResponse<T> {
  content: T[]
  totalElements: number
  totalPages: number
  page: number
  pageSize: number
}

export interface EmployeeDirectoryFilters {
  companyId?: string
  departmentId?: string
  branchId?: string
  status?: EmploymentStatus
  search?: string
  page?: number
  pageSize?: number
}

export interface CreateWorkforceEmployeePayload {
  companyId: string
  employeeCode?: string
  firstName: string
  middleName?: string
  lastName?: string
  email: string
  phone?: string
  dateOfBirth?: string
  gender?: Gender
  departmentId?: string
  designationId?: string
  /** Free-text designation — mirrors mobile onboarding when no lookup exists. */
  designation?: string
  branchId?: string
  /** Geofence zone the new hire must punch in at (optional at onboarding). */
  geoFenceZoneId?: string
  /** Weekly off days CSV, ISO 1=Mon..7=Sun (e.g. "6,7" = Sat+Sun). */
  weeklyOffDays?: string
  reportingManagerId?: string
  employmentType?: EmploymentType
  dateOfJoining?: string
  ctcAnnual?: number
  /** MONTHLY|WEEKLY|DAILY — mobile parity, defaults to MONTHLY. */
  salaryFrequency?: string
  monthlySalary?: number
  /** Free-text city / site name — mirrors mobile Work Location field. */
  workLocation?: string
  panNumber?: string
  aadhaarNumber?: string
  /** 12-digit UPN — mirrors mobile onboarding UAN field. */
  uanNumber?: string
  /** 10–17-digit ESI number — mirrors mobile onboarding ESI field. */
  esiNumber?: string
  passportNumber?: string
  bankName?: string
  bankBranchName?: string
  bankAccountNumber?: string
  bankIfsc?: string
  currentAddressLine?: string
  currentAddressCity?: string
  currentAddressState?: string
  currentAddressPincode?: string
  emergencyContactName?: string
  emergencyContactRelation?: string
  emergencyContactPhone?: string
  onboardingTemplateId?: string
  roleCode?: string
}

export interface UpdateWorkforceEmployeePayload {
  firstName?: string
  middleName?: string
  lastName?: string
  email?: string
  phone?: string
  dateOfBirth?: string
  gender?: Gender
  departmentId?: string
  designationId?: string
  branchId?: string
  reportingManagerId?: string
  employmentType?: EmploymentType
  ctcAnnual?: number
  profilePhotoUrl?: string
}

/** Aggregated status counts for the Workforce Directory stat cards. */
export interface EmployeeCounts {
  total: number
  active: number
  notice: number
  exited: number
  terminated: number
}

/**
 * B8 web-perf: single grouped-count call to replace the previous five
 * parallel useEmployeeDirectory({ pageSize: 1 }) queries that only read
 * totalElements. companyId is optional; when omitted the backend counts
 * every employee in the tenant.
 */
export function useEmployeeCounts(companyId?: string, opts?: { enabled?: boolean }) {
  const params = new URLSearchParams()
  if (companyId) params.set('companyId', companyId)
  const qs = params.toString()
  return useQuery({
    queryKey: ['hrms', 'employee-counts', companyId ?? null],
    queryFn: () => apiJson<EmployeeCounts>(`/v1/hrms/employees/counts${qs ? `?${qs}` : ''}`),
    enabled: opts?.enabled ?? true,
  })
}

/**
 * B8 web-perf: fetch a specific set of employees by id in one round trip.
 * Backed by GET /v1/hrms/employees/by-ids (capped at 500 ids server-side).
 * Preferred over fetching a large directory page just to build a name lookup.
 */
export function useEmployeesByIds(ids: string[] | undefined, opts?: { enabled?: boolean }) {
  // Dedupe + sort so equivalent id sets produce the same query key (avoids
  // refetching when the same employees appear in a different order).
  const unique = Array.from(new Set(ids ?? [])).sort()
  return useQuery({
    queryKey: ['hrms', 'employees-by-ids', unique],
    queryFn: () =>
      apiJson<WorkforceEmployee[]>(`/v1/hrms/employees/by-ids?ids=${unique.join(',')}`),
    // Skip the call entirely when no ids are known yet — no point sending
    // ?ids= to the backend just to get an empty list.
    enabled: (opts?.enabled ?? true) && unique.length > 0,
  })
}

export function useEmployeeDirectory(filters: EmployeeDirectoryFilters, opts?: { enabled?: boolean }) {
  const params = new URLSearchParams()
  if (filters.companyId) params.set('companyId', filters.companyId)
  if (filters.departmentId) params.set('departmentId', filters.departmentId)
  if (filters.branchId) params.set('branchId', filters.branchId)
  if (filters.status) params.set('status', filters.status)
  if (filters.search) params.set('search', filters.search)
  params.set('page', String(filters.page ?? 0))
  params.set('pageSize', String(filters.pageSize ?? 50))

  return useQuery({
    queryKey: ['hrms', 'employees', filters],
    queryFn: () => apiJson<PageResponse<WorkforceEmployee>>(`/v1/hrms/employees?${params.toString()}`),
    enabled: opts?.enabled ?? true,
    // `filters` (which includes `search`) is part of the key, so every
    // keystroke starts a NEW query. Without this, `isLoading` flips true on
    // each one and Employees.tsx unmounts the whole <TableCard> — including
    // the search input the user is typing into. Focus jumped to <body> after
    // the first character and the rest were swallowed: typing "Aisha" left
    // "A" in the box (QA 2026-08-30, P0-6). Keeping the previous page's data
    // means isLoading is only ever true for the very first load, so the input
    // survives. The isFetching opacity treatment at Employees.tsx:161 was
    // clearly written expecting this behaviour.
    placeholderData: keepPreviousData,
  })
}

export function useWorkforceEmployee(id?: string) {
  return useQuery({
    queryKey: ['hrms', 'employee', id],
    queryFn: () => apiJson<WorkforceEmployee>(`/v1/hrms/employees/${id}`),
    enabled: !!id,
  })
}

export function useCreateWorkforceEmployee() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateWorkforceEmployeePayload) =>
      apiJson<WorkforceEmployee>('/v1/hrms/employees', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hrms', 'employees'] })
      // A new hire moves the workforce totals — refresh the stat cards.
      qc.invalidateQueries({ queryKey: ['hrms', 'employee-counts'] })
    },
  })
}

export function useUpdateWorkforceEmployee() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateWorkforceEmployeePayload }) =>
      apiJson<WorkforceEmployee>(`/v1/hrms/employees/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    onSuccess: (_result, { id }) => {
      qc.invalidateQueries({ queryKey: ['hrms', 'employees'] })
      qc.invalidateQueries({ queryKey: ['hrms', 'employee', id] })
      // Header status-cards read employee-counts — invalidate so lifecycle
      // transitions (confirm / notice / exit / cancel-notice) reflect in
      // the stat tiles instead of showing yesterday's counts.
      qc.invalidateQueries({ queryKey: ['hrms', 'employee-counts'] })
    },
  })
}

export function useConfirmEmployee() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, confirmationDate }: { id: string; confirmationDate: string }) =>
      apiJson<WorkforceEmployee>(`/v1/hrms/employees/${id}/confirm?confirmationDate=${confirmationDate}`, { method: 'POST' }),
    onSuccess: (_result, { id }) => {
      qc.invalidateQueries({ queryKey: ['hrms', 'employees'] })
      qc.invalidateQueries({ queryKey: ['hrms', 'employee', id] })
      // Header status-cards read employee-counts — invalidate so lifecycle
      // transitions (confirm / notice / exit / cancel-notice) reflect in
      // the stat tiles instead of showing yesterday's counts.
      qc.invalidateQueries({ queryKey: ['hrms', 'employee-counts'] })
    },
  })
}

export function useStartNotice() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, noticeStart, lastWorkingDay, reason }: { id: string; noticeStart: string; lastWorkingDay: string; reason?: string }) => {
      const params = new URLSearchParams({ noticeStart, lastWorkingDay })
      if (reason) params.set('reason', reason)
      return apiJson<WorkforceEmployee>(`/v1/hrms/employees/${id}/notice?${params}`, { method: 'POST' })
    },
    onSuccess: (_result, { id }) => {
      qc.invalidateQueries({ queryKey: ['hrms', 'employees'] })
      qc.invalidateQueries({ queryKey: ['hrms', 'employee', id] })
      // Header status-cards read employee-counts — invalidate so lifecycle
      // transitions (confirm / notice / exit / cancel-notice) reflect in
      // the stat tiles instead of showing yesterday's counts.
      qc.invalidateQueries({ queryKey: ['hrms', 'employee-counts'] })
    },
  })
}

export function useExitEmployee() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, lastWorkingDay, reason }: { id: string; lastWorkingDay: string; reason?: string }) => {
      const params = new URLSearchParams({ lastWorkingDay })
      if (reason) params.set('reason', reason)
      return apiJson<WorkforceEmployee>(`/v1/hrms/employees/${id}/exit?${params}`, { method: 'POST' })
    },
    onSuccess: (_result, { id }) => {
      qc.invalidateQueries({ queryKey: ['hrms', 'employees'] })
      qc.invalidateQueries({ queryKey: ['hrms', 'employee', id] })
      // Header status-cards read employee-counts — invalidate so lifecycle
      // transitions (confirm / notice / exit / cancel-notice) reflect in
      // the stat tiles instead of showing yesterday's counts.
      qc.invalidateQueries({ queryKey: ['hrms', 'employee-counts'] })
    },
  })
}

/** Withdraw an in-progress notice period and revert the employee to ACTIVE. */
export function useCancelNotice() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiJson<WorkforceEmployee>(`/v1/hrms/employees/${id}/cancel-notice`, { method: 'POST' }),
    onSuccess: (_result, id) => {
      qc.invalidateQueries({ queryKey: ['hrms', 'employees'] })
      qc.invalidateQueries({ queryKey: ['hrms', 'employee', id] })
      // Header status-cards read employee-counts — invalidate so lifecycle
      // transitions (confirm / notice / exit / cancel-notice) reflect in
      // the stat tiles instead of showing yesterday's counts.
      qc.invalidateQueries({ queryKey: ['hrms', 'employee-counts'] })
    },
  })
}
