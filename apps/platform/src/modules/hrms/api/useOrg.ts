import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiJson, HttpError } from '@/core/api/client'
import { CURRENT_USER_KEY, type CurrentUser } from '@/shared/hooks/useCurrentUser'

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
  /**
   * 2026-09-10: colour + icon are now server-persisted (V118). Nullable so
   * pre-existing rows fall back to the SPA's default palette until edited.
   * Previously stored in localStorage — per-browser, so the admin who created
   * the department saw the colour and every other user saw the default.
   */
  colorHex?: string | null
  iconKey?: string | null
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

/**
 * Companies in this tenant.
 *
 * 2026-09-10: GET /v1/hrms/companies requires `org.company.read`, which a plain
 * EMPLOYEE (and any custom role without it) does not hold — it 403s. Roughly
 * twenty screens do `const activeCompany = companies[0]` and then pass
 * `activeCompany?.id ?? ''` into a downstream query, so for those users the
 * companyId was always empty and the dependent call either never fired or came
 * back with nothing. That is silent: no error toast, just a permanently empty
 * page. The Leave apply form was the worst case — no leave types loaded, so an
 * employee could not request leave at all from the web.
 *
 * On 403 we fall back to a single-entry list built from the caller's OWN
 * employee row (`GET /v1/users/me` → companyId/companyName), which every
 * authenticated user can read. That is exactly what an employee needs: they
 * belong to one company and have no business enumerating the others. Any other
 * error still propagates so real outages stay visible.
 */
export function useCompanies() {
  const qc = useQueryClient()
  return useQuery({
    queryKey: ['hrms', 'companies'],
    queryFn: async () => {
      try {
        return await apiJson<Company[]>('/v1/hrms/companies')
      } catch (err) {
        if (!(err instanceof HttpError) || err.status !== 403) throw err
        // fetchQuery (not a plain apiJson) so this shares the cache entry with
        // useCurrentUser instead of firing a second /users/me on every screen.
        const me = await qc.fetchQuery<CurrentUser>({
          queryKey: CURRENT_USER_KEY,
          queryFn: () => apiJson<CurrentUser>('/v1/users/me'),
          staleTime: 60_000,
        })
        if (!me?.companyId) throw err
        return [{
          id: me.companyId,
          name: me.companyName ?? 'My company',
          active: true,
        } as Company]
      }
    },
  })
}

export function useCreateCompany() {
  const qc = useQueryClient()
  return useMutation({
    // registrationNumber / panNumber / gstin were absent from this payload
    // type, so even though the Company response carries them they could never
    // be SENT — every company in prod had all three NULL (2026-09-08 audit).
    mutationFn: (data: { name: string; legalName?: string; industry?: string; currency?: string; country?: string; timezone?: string; registrationNumber?: string; panNumber?: string; gstin?: string }) =>
      apiJson<Company>('/v1/hrms/companies', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'companies'] }),
  })
}

export function useUpdateCompany() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string; name: string; legalName?: string; industry?: string; currency?: string; country?: string; timezone?: string; registrationNumber?: string; panNumber?: string; gstin?: string }) =>
      apiJson<Company>(`/v1/hrms/companies/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
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
    mutationFn: (data: { companyId: string; name: string; code?: string; description?: string; parentDepartmentId?: string; departmentHeadEmployeeId?: string; colorHex?: string; iconKey?: string }) =>
      apiJson<Department>('/v1/hrms/departments', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'departments'] }),
  })
}

/**
 * 2026-09-10: appearance (colour + icon) is a real tenant setting now — see
 * V118. Was localStorage per-browser. The endpoint accepts each field
 * independently; null/undefined means "leave alone".
 */
export function useSetDepartmentAppearance() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, colorHex, iconKey }: { id: string; colorHex?: string; iconKey?: string }) => {
      const params = new URLSearchParams()
      if (colorHex) params.set('colorHex', colorHex)
      if (iconKey)  params.set('iconKey', iconKey)
      return apiJson<Department>(`/v1/hrms/departments/${id}/appearance?${params.toString()}`, { method: 'PATCH' })
    },
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

/**
 * Edit a department's code and/or description.
 *
 * 2026-09-10: both were settable when creating a department and then frozen —
 * no route existed, so fixing a typo in a code meant archiving the department
 * and recreating it, which orphans every employee assigned to it.
 * Omit a field to leave it unchanged; pass '' to clear it.
 */
export function useUpdateDepartmentDetails() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, code, description }: { id: string; code?: string; description?: string }) => {
      const params = new URLSearchParams()
      // Deliberately `!== undefined`, not a truthiness check: '' is the
      // explicit "clear this field" signal and must still be sent.
      if (code !== undefined) params.set('code', code)
      if (description !== undefined) params.set('description', description)
      return apiJson<Department>(`/v1/hrms/departments/${id}/details?${params.toString()}`, { method: 'PATCH' })
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'departments'] }),
  })
}

export function useSetDepartmentHead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, employeeId }: { id: string; employeeId?: string }) => {
      const url = employeeId
        ? `/v1/hrms/departments/${id}/head?employeeId=${employeeId}`
        : `/v1/hrms/departments/${id}/head`
      return apiJson<Department>(url, { method: 'PATCH' })
    },
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

// PUT /v1/hrms/designations/{id} (hrms.designation.write) is a FULL REPLACE:
// DesignationService.update calls setDepartmentId / setReportsToDesignationId /
// setJobResponsibilities unconditionally, so every field omitted from the body
// is persisted as NULL. reportsToDesignationId was missing from this payload
// type entirely, which meant callers could not echo it back even if they
// wanted to — see the echo in OrgSetup's DesignationsTab.
export function useUpdateDesignation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string; title: string; grade?: string; departmentId?: string; reportsToDesignationId?: string; jobResponsibilities?: string }) =>
      apiJson<Designation>(`/v1/hrms/designations/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
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
    // Slow-moving reference data, not immutable — another admin (or the app)
    // can add a grade while this tab is open. staleTime: Infinity pinned the
    // list until a full browser reload.
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: 'always',
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
    // See useGrades — finite staleTime + focus refetch so a type added
    // elsewhere shows up in the Add Employee dropdowns without a reload.
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: 'always',
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
//
// There is deliberately NO shift hook here any more.
//
// `useShifts` / `useCreateShift` / `useUpdateShift` / `useDeleteShift` wrapped
// `/v1/hrms/shifts` (table `org.shifts`, grace column `grace_minutes`, default
// 10). Nothing in the attendance engine reads that table: the late-mark path is
// AttendanceService.getShiftProfile() → `attendance.shift_policies`
// (`grace_period_minutes`, default 15), with the cutoff derived as
// shiftStart.plusMinutes(grace). So every shift edit made through those hooks
// appeared to save and changed nothing — HR moved a shift to 10:00 with 30-min
// grace on the web while the app kept marking everyone late at 09:15, and a
// shift created in the app never showed up on the web at all.
//
// All web shift UI now uses ./useShiftPolicies (`/v1/shifts`), the same store
// the mobile client writes. Repointed callers: organization/OrgSetup.tsx
// (Shifts tab), attendance/ShiftsAndOt.tsx, and employees/EmployeeForm.tsx
// (the picker whose id feeds assignEmployeeShift below).
//
// `/v1/hrms/shifts` and `org.shifts` are intentionally untouched on the backend
// — only the frontend stopped pointing at them. If a genuinely non-attendance
// use for org.shifts appears, give it a narrowly-named hook of its own rather
// than resurrecting a generic `useShifts` that the next person will wire into
// attendance by mistake.

// Assign / reassign an employee to a shift. Backend endpoint is
// POST /v1/shifts/employee/{employeeId}  body {shiftPolicyId, effectiveFrom?}
// Used as a post-create side effect from the Add Employee wizard so the new
// hire's attendance is scored against the right start-time from day one.
//
// NOTE the parameter name: `shiftPolicyId`. EmployeeShiftService.assignShift
// resolves it via policyRepo.findById(...).orElseThrow, so it must be an
// attendance.shift_policies id — i.e. one that came out of ./useShiftPolicies.
// Feeding it an org.shifts id is rejected, which is exactly the failure that
// used to disappear into EmployeeForm's empty catch block.
export function assignEmployeeShift(
  employeeId: string,
  shiftPolicyId: string,
  effectiveFrom?: string,
) {
  return apiJson<unknown>(`/v1/shifts/employee/${employeeId}`, {
    method: 'POST',
    body: JSON.stringify({ shiftPolicyId, effectiveFrom }),
  })
}
