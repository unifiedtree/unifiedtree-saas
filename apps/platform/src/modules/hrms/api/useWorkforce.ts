import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiJson } from '@/core/api/client'

export type EmploymentStatus = 'DRAFT' | 'INVITED' | 'ACTIVE' | 'PROBATION' | 'ON_NOTICE' | 'EXITED' | 'TERMINATED'
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
  branchId?: string
  reportingManagerId?: string
  employmentType?: EmploymentType
  dateOfJoining?: string
  ctcAnnual?: number
  panNumber?: string
  aadhaarNumber?: string
  passportNumber?: string
  bankName?: string
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

export function useEmployeeDirectory(filters: EmployeeDirectoryFilters) {
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'employees'] }),
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
    },
  })
}
