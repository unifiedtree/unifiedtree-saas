import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiJson } from '@/core/api/client'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface EmployeeAddress {
  id: string
  employeeId: string
  addressType: 'PERMANENT' | 'CURRENT' | 'OFFICE'
  line1?: string | null
  line2?: string | null
  city?: string | null
  state?: string | null
  country?: string | null
  pincode?: string | null
}

export interface EmployeeIdentityResponse {
  id?: string | null
  employeeId: string
  pan?: string | null
  aadhaarLast4?: string | null
  aadhaar?: string | null
  uan?: string | null
  esicNumber?: string | null
  passportNumber?: string | null
  passportExpiry?: string | null
}

export interface EmployeeBankAccountResponse {
  id: string
  employeeId: string
  accountHolderName: string
  bankName?: string | null
  branchName?: string | null
  ifscCode: string
  accountNumberLast4: string
  accountNumber?: string | null
  primary: boolean
  verified: boolean
}

export interface EmployeeEducation {
  id: string
  employeeId: string
  degree: string
  fieldOfStudy?: string | null
  institution: string
  startYear?: number | null
  endYear?: number | null
  gradeOrPercentage?: string | null
  highest: boolean
}

export interface EmployeeExperience {
  id: string
  employeeId: string
  companyName: string
  designation?: string | null
  startDate: string
  endDate?: string | null
  current: boolean
  description?: string | null
  location?: string | null
}

export interface EmployeeDependent {
  id: string
  employeeId: string
  name: string
  relationship: string
  dateOfBirth?: string | null
  gender?: string | null
  nominee: boolean
  nomineePercentage?: number | null
}

export interface EmergencyContact {
  id: string
  employeeId: string
  name: string
  relationship?: string | null
  phone?: string | null
  email?: string | null
  isPrimary: boolean
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const key = (employeeId: string, section: string) =>
  ['hrms', 'employee', employeeId, section] as const

// ── Addresses ─────────────────────────────────────────────────────────────────

export function useEmployeeAddresses(employeeId: string) {
  return useQuery({
    queryKey: key(employeeId, 'addresses'),
    queryFn: () => apiJson<EmployeeAddress[]>(`/v1/employees/${employeeId}/profile/addresses`),
    enabled: !!employeeId,
  })
}

export function useCreateAddress(employeeId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Omit<EmployeeAddress, 'id' | 'employeeId'>) =>
      apiJson<EmployeeAddress>(`/v1/employees/${employeeId}/profile/addresses`, {
        method: 'POST', body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: key(employeeId, 'addresses'), exact: true }),
  })
}

export function useDeleteAddress(employeeId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (addressId: string) =>
      apiJson<void>(`/v1/employees/${employeeId}/profile/addresses/${addressId}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: key(employeeId, 'addresses'), exact: true }),
  })
}

// ── Identity (PII) ────────────────────────────────────────────────────────────

export function useEmployeeIdentity(employeeId: string) {
  return useQuery({
    queryKey: key(employeeId, 'identity'),
    queryFn: () => apiJson<EmployeeIdentityResponse>(`/v1/employees/${employeeId}/profile/identity`),
    enabled: !!employeeId,
  })
}

export function useSaveIdentity(employeeId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: {
      pan?: string; aadhaar?: string; uan?: string
      esicNumber?: string; passportNumber?: string; passportExpiry?: string
    }) =>
      apiJson<EmployeeIdentityResponse>(`/v1/employees/${employeeId}/profile/identity`, {
        method: 'PUT', body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: key(employeeId, 'identity'), exact: true }),
  })
}

// ── Bank Accounts (PII) ───────────────────────────────────────────────────────

export function useBankAccounts(employeeId: string) {
  return useQuery({
    queryKey: key(employeeId, 'bank-accounts'),
    queryFn: () => apiJson<EmployeeBankAccountResponse[]>(`/v1/employees/${employeeId}/profile/bank-accounts`),
    enabled: !!employeeId,
  })
}

export function useAddBankAccount(employeeId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: {
      accountNumber: string; ifscCode: string; bankName?: string
      branchName?: string; accountHolderName: string; primary: boolean
    }) =>
      apiJson<EmployeeBankAccountResponse>(`/v1/employees/${employeeId}/profile/bank-accounts`, {
        method: 'POST', body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: key(employeeId, 'bank-accounts'), exact: true }),
  })
}

export function useDeleteBankAccount(employeeId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (accountId: string) =>
      apiJson<void>(`/v1/employees/${employeeId}/profile/bank-accounts/${accountId}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: key(employeeId, 'bank-accounts'), exact: true }),
  })
}

// ── Education ─────────────────────────────────────────────────────────────────

export function useEmployeeEducation(employeeId: string) {
  return useQuery({
    queryKey: key(employeeId, 'education'),
    queryFn: () => apiJson<EmployeeEducation[]>(`/v1/employees/${employeeId}/profile/education`),
    enabled: !!employeeId,
  })
}

export function useAddEducation(employeeId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Omit<EmployeeEducation, 'id' | 'employeeId'>) =>
      apiJson<EmployeeEducation>(`/v1/employees/${employeeId}/profile/education`, {
        method: 'POST', body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: key(employeeId, 'education'), exact: true }),
  })
}

export function useDeleteEducation(employeeId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (educationId: string) =>
      apiJson<void>(`/v1/employees/${employeeId}/profile/education/${educationId}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: key(employeeId, 'education'), exact: true }),
  })
}

// ── Experience ────────────────────────────────────────────────────────────────

export function useEmployeeExperience(employeeId: string) {
  return useQuery({
    queryKey: key(employeeId, 'experience'),
    queryFn: () => apiJson<EmployeeExperience[]>(`/v1/employees/${employeeId}/profile/experience`),
    enabled: !!employeeId,
  })
}

export function useAddExperience(employeeId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Omit<EmployeeExperience, 'id' | 'employeeId'>) =>
      apiJson<EmployeeExperience>(`/v1/employees/${employeeId}/profile/experience`, {
        method: 'POST', body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: key(employeeId, 'experience'), exact: true }),
  })
}

export function useDeleteExperience(employeeId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (experienceId: string) =>
      apiJson<void>(`/v1/employees/${employeeId}/profile/experience/${experienceId}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: key(employeeId, 'experience'), exact: true }),
  })
}

// ── Dependents ────────────────────────────────────────────────────────────────

export function useEmployeeDependents(employeeId: string) {
  return useQuery({
    queryKey: key(employeeId, 'dependents'),
    queryFn: () => apiJson<EmployeeDependent[]>(`/v1/employees/${employeeId}/profile/dependents`),
    enabled: !!employeeId,
  })
}

export function useAddDependent(employeeId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Omit<EmployeeDependent, 'id' | 'employeeId'>) =>
      apiJson<EmployeeDependent>(`/v1/employees/${employeeId}/profile/dependents`, {
        method: 'POST', body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: key(employeeId, 'dependents'), exact: true }),
  })
}

export function useDeleteDependent(employeeId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (dependentId: string) =>
      apiJson<void>(`/v1/employees/${employeeId}/profile/dependents/${dependentId}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: key(employeeId, 'dependents'), exact: true }),
  })
}

// ── Emergency Contacts ────────────────────────────────────────────────────────

export function useEmergencyContacts(employeeId: string) {
  return useQuery({
    queryKey: key(employeeId, 'emergency-contacts'),
    queryFn: () => apiJson<EmergencyContact[]>(`/v1/employees/${employeeId}/profile/emergency-contacts`),
    enabled: !!employeeId,
  })
}

export function useAddEmergencyContact(employeeId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Omit<EmergencyContact, 'id' | 'employeeId'>) =>
      apiJson<EmergencyContact>(`/v1/employees/${employeeId}/profile/emergency-contacts`, {
        method: 'POST', body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: key(employeeId, 'emergency-contacts'), exact: true }),
  })
}

export function useDeleteEmergencyContact(employeeId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (contactId: string) =>
      apiJson<void>(`/v1/employees/${employeeId}/profile/emergency-contacts/${contactId}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: key(employeeId, 'emergency-contacts'), exact: true }),
  })
}
