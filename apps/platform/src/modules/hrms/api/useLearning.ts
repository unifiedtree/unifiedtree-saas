import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiJson } from '@/core/api/client'

// Mirrors backend com.hrms.learning.enums
export type ProgramStatus = 'PLANNED' | 'ONGOING' | 'COMPLETED' | 'CANCELLED'
export type EnrollmentStatus = 'ENROLLED' | 'COMPLETED' | 'DROPPED'

export const PROGRAM_STATUSES: ProgramStatus[] = ['PLANNED', 'ONGOING', 'COMPLETED', 'CANCELLED']

/**
 * Legal next states, mirroring validateStatusTransition() in LearningService.
 * The status dropdown used to list all four for any open program, so picking
 * COMPLETED on a PLANNED program threw INVALID_TRANSITION 400 at the user.
 * COMPLETED and CANCELLED are terminal and have no entry.
 */
export const ALLOWED_TRANSITIONS: Record<ProgramStatus, ProgramStatus[]> = {
  PLANNED:   ['PLANNED', 'ONGOING', 'CANCELLED'],
  ONGOING:   ['ONGOING', 'COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
}

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

/**
 * What /v1/learning/programs actually returns — LearningService.PageDto, whose
 * fields are `items` and `total`, NOT Spring Data's `content`/`totalElements`.
 * This page read `data.content` and therefore rendered an empty table and four
 * zeroed stat cards no matter how many programs existed. normalisePage() maps
 * the wire shape onto the Page<T> the components expect.
 */
interface WirePage<T> {
  items?: T[]
  content?: T[]
  page?: number
  size?: number
  total?: number
  totalElements?: number
}

function normalisePage<T>(raw: WirePage<T>, requestedSize: number): Page<T> {
  const content = raw.items ?? raw.content ?? []
  const total = raw.total ?? raw.totalElements ?? content.length
  const size = raw.size || requestedSize
  const totalPages = size > 0 ? Math.ceil(total / size) : 1
  const page = raw.page ?? 0
  return { content, page, size, totalElements: total, totalPages, last: page >= totalPages - 1 }
}

// ── Programs ─────────────────────────────────────────────────────────────────

export function useTrainingPrograms(page = 0, enabled = true) {
  return useQuery({
    queryKey: ['hrms', 'learning', 'programs', page],
    queryFn: async () =>
      normalisePage(
        await apiJson<WirePage<TrainingProgram>>(`/v1/learning/programs?page=${page}&size=20`),
        20,
      ),
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

/**
 * There is no POST /programs/{id}/status route and never was — every status
 * change 404'd. The real route is PUT /programs/{id}, whose UpdateProgramRequest
 * already carries `status`. It is null-guarded field by field on the server, so
 * sending status alone leaves title/dates/capacity untouched.
 */
export function useChangeProgramStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: ProgramStatus }) =>
      apiJson<TrainingProgram>(`/v1/learning/programs/${id}`, {
        method: 'PUT',
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

/** Backend route is /enrollments/me — /my-enrollments never existed (404). */
export function useMyEnrollments() {
  return useQuery({
    queryKey: ['hrms', 'learning', 'my-enrollments'],
    queryFn: () => apiJson<Enrollment[]>('/v1/learning/enrollments/me'),
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

/** Backend route is /skills/me — /my-skills never existed (404). */
export function useMySkills() {
  return useQuery({
    queryKey: ['hrms', 'learning', 'my-skills'],
    queryFn: () => apiJson<EmployeeSkill[]>('/v1/learning/skills/me'),
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
