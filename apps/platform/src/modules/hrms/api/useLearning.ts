import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiJson } from '@/core/api/client'

// Mirrors backend com.hrms.learning.enums
export type ProgramStatus = 'PLANNED' | 'ONGOING' | 'COMPLETED' | 'CANCELLED'

/**
 * LearningService.ENROLLMENT_STATES is
 * {ENROLLED, IN_PROGRESS, COMPLETED, DROPPED} — IN_PROGRESS was missing here.
 * No write path sets it today, but `status` is a plain VARCHAR(30) with no
 * CHECK constraint (V073) and complete() explicitly treats it as a legal
 * starting state, so a row can carry it. Omitting it made the tone lookup in
 * Learning.tsx return undefined and the pill render unstyled.
 */
export type EnrollmentStatus = 'ENROLLED' | 'IN_PROGRESS' | 'COMPLETED' | 'DROPPED'

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

/** How a program is delivered (V143.21). Null = not set. */
export type ProgramMode = 'IN_PERSON' | 'ONLINE' | 'HYBRID' | 'SELF_PACED'
export const PROGRAM_MODE_LABEL: Record<ProgramMode, string> = {
  IN_PERSON: 'In person', ONLINE: 'Online', HYBRID: 'Hybrid', SELF_PACED: 'Self-paced',
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
  updatedAt?: string
  mode?: ProgramMode | null
}

/**
 * Field-for-field mirror of LearningService.EnrollmentDto, in record order:
 *   id, programId, programTitle, employeeId, employeeName,
 *   status, score, completedAt, createdAt, updatedAt
 *
 * 2026-09-09 drift fix. This interface declared `employeeCode`, which the DTO
 * has never carried — the roster column bound to it would have rendered blank
 * forever with tsc perfectly happy, exactly how the UAN/ESI field-drop got
 * through review. `updatedAt` was missing in the other direction. Nullable
 * members are the ones the record genuinely hands back null for: programTitle
 * and employeeName come from LEFT JOINs, score/completedAt are unset until an
 * enrollment is completed.
 */
export interface Enrollment {
  id: string
  programId: string
  programTitle?: string | null
  employeeId: string
  employeeName?: string | null
  status: EnrollmentStatus
  score?: number | null
  completedAt?: string | null
  createdAt: string
  updatedAt?: string | null
}

export interface EmployeeSkill {
  id: string
  employeeId: string
  skillName: string
  proficiency: number
  certified: boolean
  certificationName?: string
  expiresOn?: string
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
  mode?: ProgramMode
}

/**
 * PUT /v1/learning/programs/{id} (hrms.learning.write). Fields left undefined are
 * not changed; an empty string clears description, category, trainer, mode or a
 * date. `unlimitedSeats: true` removes the seat limit. The server refuses seats
 * below the people already enrolled, an end date before the start date, and any
 * detail change on a completed or cancelled program.
 */
export interface UpdateProgramPayload {
  title?: string
  description?: string
  category?: string
  trainer?: string
  startDate?: string
  endDate?: string
  capacity?: number
  unlimitedSeats?: boolean
  mode?: ProgramMode | ''
}

export function useUpdateProgram() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: UpdateProgramPayload & { id: string }) =>
      apiJson<TrainingProgram>(`/v1/learning/programs/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'learning'] }),
  })
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
export function useMyEnrollments(enabled = true) {
  return useQuery({
    queryKey: ['hrms', 'learning', 'my-enrollments'],
    queryFn: () => apiJson<Enrollment[]>('/v1/learning/enrollments/me'),
    staleTime: 30_000,
    enabled,
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

/** Mirrors LearningService.BulkEnrollResult — counts, never an error, so the
 *  caller must render all three or a fully-rejected batch looks like success. */
export interface BulkEnrollResult {
  enrolled: number
  alreadyEnrolled: number
  rejectedForCapacity: number
}

/**
 * HR enrolling other people. POST /programs/{id}/enrollments/bulk, gated on
 * hrms.learning.write — the self-enrol route takes its employee id from the
 * token and cannot be used to enrol somebody else.
 */
export function useBulkEnroll() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ programId, employeeIds }: { programId: string; employeeIds: string[] }) =>
      apiJson<BulkEnrollResult>(`/v1/learning/programs/${programId}/enrollments/bulk`, {
        method: 'POST',
        body: JSON.stringify({ employeeIds }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'learning'] }),
  })
}

/**
 * HR/manager drops someone else's enrollment (hrms.learning.write).
 *
 * Distinct from useDropEnrollment on purpose: /drop is the self-service route
 * and the service rejects it with ENROLLMENT_NOT_OWN when the actor's
 * employee_id is not the enrollment's owner (the IDOR fix from 2026-08-11), so
 * pointing an admin roster at /drop would fail for every row but the actor's.
 */
export function useAdminDropEnrollment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiJson<Enrollment>(`/v1/learning/enrollments/${id}/admin-drop`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'learning'] }),
  })
}

/** Employee leaves their OWN program (hrms.learning.enroll.self). */
export function useDropEnrollment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiJson<Enrollment>(`/v1/learning/enrollments/${id}/drop`, { method: 'POST' }),
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
  expiresOn?: string
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

// ── Skill self-assessment (V143.21) ─────────────────────────────────────────
// Employees propose a level for their own skills (hrms.learning.skill.assess.self);
// their manager (team only) or HR (hrms.learning.write) approves or rejects it
// (hrms.learning.skill.approve). Approving updates the skill matrix.

export type SkillAssessmentStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN'

/** Mirrors SkillAssessmentService.AssessmentDto. */
export interface SkillAssessment {
  id: string
  employeeId: string
  employeeName?: string | null
  employeeCode?: string | null
  department?: string | null
  skillId?: string | null
  skillName: string
  currentProficiency?: number | null
  proposedProficiency: number
  employeeNote?: string | null
  status: SkillAssessmentStatus
  decidedByName?: string | null
  decidedAt?: string | null
  decisionNote?: string | null
  createdAt: string
}

export function useMySkillAssessments(enabled = true) {
  return useQuery({
    queryKey: ['hrms', 'learning', 'skill-assessments', 'me'],
    queryFn: () => apiJson<SkillAssessment[]>('/v1/learning/skill-assessments/me'),
    enabled,
    staleTime: 15_000,
  })
}

export function useProposeSkillLevel() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { skillName: string; proposedProficiency: number; note?: string }) =>
      apiJson<SkillAssessment>('/v1/learning/skill-assessments', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'learning', 'skill-assessments'] }),
  })
}

export function useWithdrawSkillAssessment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiJson<SkillAssessment>(`/v1/learning/skill-assessments/${id}/withdraw`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'learning', 'skill-assessments'] }),
  })
}

/** PENDING: waiting for a decision (oldest first). DECIDED: the 50 most recent decisions. */
export function useSkillAssessmentQueue(view: 'PENDING' | 'DECIDED', enabled = true) {
  return useQuery({
    queryKey: ['hrms', 'learning', 'skill-assessments', 'queue', view],
    queryFn: () => apiJson<SkillAssessment[]>(`/v1/learning/skill-assessments?view=${view}`),
    enabled,
    staleTime: 15_000,
  })
}

export function useDecideSkillAssessment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, decision, note }: { id: string; decision: 'APPROVED' | 'REJECTED'; note?: string }) =>
      apiJson<SkillAssessment>(`/v1/learning/skill-assessments/${id}/decide`, {
        method: 'POST', body: JSON.stringify({ decision, note: note || undefined }),
      }),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['hrms', 'learning', 'skill-assessments'] }),
        qc.invalidateQueries({ queryKey: ['hrms', 'learning', 'skills'] }),
      ])
    },
  })
}
