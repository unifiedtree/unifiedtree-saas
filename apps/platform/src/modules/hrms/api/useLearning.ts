import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiJson } from '@/core/api/client'

// Mirrors backend com.hrms.learning.enums
export type ProgramStatus = 'PLANNED' | 'ONGOING' | 'COMPLETED' | 'CANCELLED'
export type EnrollmentStatus = 'ENROLLED' | 'COMPLETED' | 'DROPPED'

export const PROGRAM_STATUSES: ProgramStatus[] = ['PLANNED', 'ONGOING', 'COMPLETED', 'CANCELLED']

export interface TrainingProgram {
  id: string
  companyId: string
  title: string
  description?: string
  category?: string
  trainer?: string
  startDate?: string
  endDate?: string
  capacity?: number | null
  status: ProgramStatus
  enrolledCount: number
  createdAt: string
}

export interface Enrollment {
  id: string
  programId: string
  programTitle?: string
  employeeId: string
  employeeName?: string
  employeeCode?: string
  status: EnrollmentStatus
  completedAt?: string
  score?: number | null
  createdAt: string
}

export interface EmployeeSkill {
  id: string
  employeeId: string
  skillName: string
  proficiency: number
  certified: boolean
  certificationName?: string
  certifiedOn?: string
  createdAt: string
}

export interface Page<T> {
  content: T[]
  page: number
  size: number
  totalElements: number
  totalPages: number
  last: boolean
}

// ── Programs ─────────────────────────────────────────────────────────────────

export function useTrainingPrograms(page = 0, enabled = true) {
  return useQuery({
    queryKey: ['hrms', 'learning', 'programs', page],
    queryFn: () => apiJson<Page<TrainingProgram>>(`/v1/learning/programs?page=${page}&size=20`),
    staleTime: 30_000,
    enabled,
  })
}

export function useTrainingProgram(id: string | undefined) {
  return useQuery({
    queryKey: ['hrms', 'learning', 'program', id],
    queryFn: () => apiJson<TrainingProgram>(`/v1/learning/programs/${id}`),
    enabled: !!id,
  })
}

export interface CreateProgramPayload {
  companyId?: string
  title: string
  description?: string
  category?: string
  trainer?: string
  startDate?: string
  endDate?: string
  capacity?: number | null
}

export function useCreateProgram() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateProgramPayload) =>
      apiJson<TrainingProgram>('/v1/learning/programs', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'learning', 'programs'] }),
  })
}

export function useChangeProgramStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: ProgramStatus }) =>
      apiJson<TrainingProgram>(`/v1/learning/programs/${id}/status`, {
        method: 'POST',
        body: JSON.stringify({ status }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'learning'] }),
  })
}

// ── Enrollments ──────────────────────────────────────────────────────────────

export function useEnroll() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (programId: string) =>
      apiJson<Enrollment>(`/v1/learning/programs/${programId}/enroll`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'learning'] }),
  })
}

export function useProgramEnrollments(programId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['hrms', 'learning', 'enrollments', programId],
    queryFn: () => apiJson<Enrollment[]>(`/v1/learning/programs/${programId}/enrollments`),
    enabled: !!programId && enabled,
  })
}

export function useMyEnrollments() {
  return useQuery({
    queryKey: ['hrms', 'learning', 'my-enrollments'],
    queryFn: () => apiJson<Enrollment[]>('/v1/learning/my-enrollments'),
    staleTime: 30_000,
  })
}

export function useCompleteEnrollment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, score }: { id: string; score?: number | null }) =>
      apiJson<Enrollment>(`/v1/learning/enrollments/${id}/complete`, {
        method: 'POST',
        body: JSON.stringify({ score: score ?? null }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'learning'] }),
  })
}

// ── Skills & certifications ────────────────────────────────────────────────

export function useEmployeeSkills(employeeId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['hrms', 'learning', 'skills', employeeId],
    queryFn: () => apiJson<EmployeeSkill[]>(`/v1/learning/skills/${employeeId}`),
    enabled: !!employeeId && enabled,
  })
}

export function useMySkills() {
  return useQuery({
    queryKey: ['hrms', 'learning', 'my-skills'],
    queryFn: () => apiJson<EmployeeSkill[]>('/v1/learning/my-skills'),
    staleTime: 30_000,
  })
}

export interface UpsertSkillPayload {
  employeeId: string
  skillName: string
  proficiency?: number
  certified?: boolean
  certificationName?: string
  certifiedOn?: string
}

export function useUpsertSkill() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: UpsertSkillPayload) =>
      apiJson<EmployeeSkill>('/v1/learning/skills', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'learning', 'skills'] }),
  })
}
