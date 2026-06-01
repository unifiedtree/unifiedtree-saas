import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiJson } from '@/core/api/client'

export interface Company {
  id: string
  name: string
  legalName?: string
  registrationNumber?: string
  panNumber?: string
  gstin?: string
  industry?: string
  country?: string
  timezone?: string
  currency?: string
  fiscalYearStart?: string
  logoUrl?: string
  employeeCount?: number
  active: boolean
}

export interface Branch {
  id: string
  companyId: string
  name: string
  code?: string
  addressLine?: string
  city?: string
  state?: string
  country?: string
  pincode?: string
  latitude?: number
  longitude?: number
  geoFenceRadiusMeters?: number
  geoFenceEnforced: boolean
  managerEmployeeId?: string
  employeeCount?: number
  headquarters: boolean
  active: boolean
}

export interface Department {
  id: string
  companyId: string
  name: string
  code?: string
  parentDepartmentId?: string
  departmentHeadEmployeeId?: string
  description?: string
  employeeCount?: number
  active: boolean
}

export interface Designation {
  id: string
  companyId: string
  title: string
  grade?: string
  departmentId?: string
  reportsToDesignationId?: string
  jobResponsibilities?: string
  headcount?: number
  active: boolean
}

// ── Companies ─────────────────────────────────────────────────────────────────

export function useCompanies() {
  return useQuery({
    queryKey: ['hrms', 'companies'],
    queryFn: () => apiJson<Company[]>('/v1/hrms/companies'),
  })
}

export function useCreateCompany() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: { name: string; legalName?: string; industry?: string; currency?: string; country?: string; timezone?: string }) =>
      apiJson<Company>('/v1/hrms/companies', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'companies'] }),
  })
}

export function useArchiveCompany() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiJson<void>(`/v1/hrms/companies/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'companies'] }),
  })
}

// ── Branches ──────────────────────────────────────────────────────────────────

export function useBranches(companyId?: string) {
  return useQuery({
    queryKey: ['hrms', 'branches', companyId ?? 'all'],
    queryFn: () => {
      const url = companyId ? `/v1/hrms/branches?companyId=${companyId}` : '/v1/hrms/branches'
      return apiJson<Branch[]>(url)
    },
  })
}

export function useCreateBranch() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: {
      companyId: string
      name: string
      code?: string
      addressLine?: string
      city?: string
      state?: string
      country?: string
      pincode?: string
      isHeadquarters?: boolean
    }) => apiJson<Branch>('/v1/hrms/branches', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'branches'] }),
  })
}

export function useArchiveBranch() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiJson<void>(`/v1/hrms/branches/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'branches'] }),
  })
}

// ── Departments ───────────────────────────────────────────────────────────────

export function useDepartments(companyId: string) {
  return useQuery({
    queryKey: ['hrms', 'departments', companyId],
    queryFn: () => apiJson<Department[]>(`/v1/hrms/departments?companyId=${companyId}`),
    enabled: !!companyId,
  })
}

export function useCreateDepartment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: { companyId: string; name: string; code?: string; description?: string; parentDepartmentId?: string }) =>
      apiJson<Department>('/v1/hrms/departments', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'departments'] }),
  })
}

export function useRenameDepartment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      apiJson<Department>(`/v1/hrms/departments/${id}/name?name=${encodeURIComponent(name)}`, { method: 'PATCH' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'departments'] }),
  })
}

export function useArchiveDepartment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiJson<void>(`/v1/hrms/departments/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'departments'] }),
  })
}

// ── Designations ──────────────────────────────────────────────────────────────

export function useDesignations(companyId: string, departmentId?: string) {
  return useQuery({
    queryKey: ['hrms', 'designations', companyId, departmentId ?? 'all'],
    queryFn: () => {
      let url = `/v1/hrms/designations?companyId=${companyId}`
      if (departmentId) url += `&departmentId=${departmentId}`
      return apiJson<Designation[]>(url)
    },
    enabled: !!companyId,
  })
}

export function useCreateDesignation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: { companyId: string; title: string; grade?: string; departmentId?: string; jobResponsibilities?: string }) =>
      apiJson<Designation>('/v1/hrms/designations', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'designations'] }),
  })
}

export function useArchiveDesignation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiJson<void>(`/v1/hrms/designations/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'designations'] }),
  })
}

// ── Grades ────────────────────────────────────────────────────────────────────

export interface Grade {
  id: string
  companyId: string
  name: string
  code?: string
  level: number
  description?: string
  active: boolean
}

export interface GradePayload {
  companyId: string
  name: string
  code?: string
  level?: number
  description?: string
}

export function useGrades(companyId: string) {
  return useQuery({
    queryKey: ['hrms', 'org', 'grades', companyId],
    queryFn: () => apiJson<Grade[]>(`/v1/hrms/grades?companyId=${companyId}`),
    enabled: !!companyId,
    staleTime: Infinity,
  })
}

export function useCreateGrade() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: GradePayload) =>
      apiJson<Grade>('/v1/hrms/grades', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: (_, variables) =>
      qc.invalidateQueries({ queryKey: ['hrms', 'org', 'grades', variables.companyId], exact: true }),
  })
}

export function useUpdateGrade() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...data }: GradePayload & { id: string }) =>
      apiJson<Grade>(`/v1/hrms/grades/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    onSuccess: (_, variables) =>
      qc.invalidateQueries({ queryKey: ['hrms', 'org', 'grades', variables.companyId], exact: true }),
  })
}

export function useDeleteGrade() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id }: { id: string; companyId: string }) =>
      apiJson<void>(`/v1/hrms/grades/${id}`, { method: 'DELETE' }),
    onSuccess: (_, variables) =>
      qc.invalidateQueries({ queryKey: ['hrms', 'org', 'grades', variables.companyId], exact: true }),
  })
}

// ── Employment Types ──────────────────────────────────────────────────────────

export interface EmploymentTypeRecord {
  id: string
  companyId: string
  name: string
  code?: string
  payrollEligible: boolean
  system: boolean
  active: boolean
}

export interface EmploymentTypePayload {
  companyId: string
  name: string
  code?: string
  payrollEligible?: boolean
}

export function useEmploymentTypes(companyId: string) {
  return useQuery({
    queryKey: ['hrms', 'org', 'employment-types', companyId],
    queryFn: () => apiJson<EmploymentTypeRecord[]>(`/v1/hrms/employment-types?companyId=${companyId}`),
    enabled: !!companyId,
    staleTime: Infinity,
  })
}

export function useCreateEmploymentType() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: EmploymentTypePayload) =>
      apiJson<EmploymentTypeRecord>('/v1/hrms/employment-types', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: (_, variables) =>
      qc.invalidateQueries({ queryKey: ['hrms', 'org', 'employment-types', variables.companyId], exact: true }),
  })
}

export function useUpdateEmploymentType() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...data }: EmploymentTypePayload & { id: string }) =>
      apiJson<EmploymentTypeRecord>(`/v1/hrms/employment-types/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    onSuccess: (_, variables) =>
      qc.invalidateQueries({ queryKey: ['hrms', 'org', 'employment-types', variables.companyId], exact: true }),
  })
}

export function useDeleteEmploymentType() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id }: { id: string; companyId: string }) =>
      apiJson<void>(`/v1/hrms/employment-types/${id}`, { method: 'DELETE' }),
    onSuccess: (_, variables) =>
      qc.invalidateQueries({ queryKey: ['hrms', 'org', 'employment-types', variables.companyId], exact: true }),
  })
}

// ── Shifts ────────────────────────────────────────────────────────────────────

export interface Shift {
  id: string
  companyId: string
  name: string
  code?: string
  startTime?: string
  endTime?: string
  breakMinutes: number
  graceMinutes: number
  daysBitmask: number
  nightShift: boolean
  active: boolean
}

export interface ShiftPayload {
  companyId: string
  name: string
  code?: string
  startTime?: string
  endTime?: string
  breakMinutes?: number
  graceMinutes?: number
  daysBitmask?: number
  isNightShift?: boolean
}

export function useShifts(companyId: string) {
  return useQuery({
    queryKey: ['hrms', 'org', 'shifts', companyId],
    queryFn: () => apiJson<Shift[]>(`/v1/hrms/shifts?companyId=${companyId}`),
    enabled: !!companyId,
    staleTime: Infinity,
  })
}

export function useCreateShift() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: ShiftPayload) =>
      apiJson<Shift>('/v1/hrms/shifts', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: (_, variables) =>
      qc.invalidateQueries({ queryKey: ['hrms', 'org', 'shifts', variables.companyId], exact: true }),
  })
}

export function useUpdateShift() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...data }: ShiftPayload & { id: string }) =>
      apiJson<Shift>(`/v1/hrms/shifts/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    onSuccess: (_, variables) =>
      qc.invalidateQueries({ queryKey: ['hrms', 'org', 'shifts', variables.companyId], exact: true }),
  })
}

export function useDeleteShift() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id }: { id: string; companyId: string }) =>
      apiJson<void>(`/v1/hrms/shifts/${id}`, { method: 'DELETE' }),
    onSuccess: (_, variables) =>
      qc.invalidateQueries({ queryKey: ['hrms', 'org', 'shifts', variables.companyId], exact: true }),
  })
}
