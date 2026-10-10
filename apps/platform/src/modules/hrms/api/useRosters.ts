import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiBlob, apiJson } from '@/core/api/client'
import { errorCodeOf } from '@/core/api/featureNotReady'
import type {
  Checks, DraftBody, LockVersionBody, PlanRequest, PlanResponse, PlannerPerson, PublishBody, PublishResult,
  RosterDetail, RosterSettings, RosterSettingsBody, RosterSummary, RotationTemplate, ScheduleChange, TemplateBody,
} from './rosterTypes'

/**
 * Shift planning, Phase 1 — the planner's calls (design §1.5, endpoints 1–17 and 23).
 *
 * Backend: com.hrms.api.roster (RotationTemplateController, RosterController, RosterPlanningController) and
 * com.hrms.app.roster (the export). Tables V143_106, JDBC only.
 *   GET    /v1/rotation-templates?companyId=          → RotationTemplate[]   (attendance.roster.plan)
 *   POST   /v1/rotation-templates?companyId=          → RotationTemplate     (TemplateBody)
 *   PUT    /v1/rotation-templates/{id}                → RotationTemplate
 *   DELETE /v1/rotation-templates/{id}                → 204 (soft delete)
 *   GET    /v1/rosters/settings?companyId=            → RosterSettings       (plan or attendance.policy.manage)
 *   PUT    /v1/rosters/settings?companyId=            → RosterSettings       (attendance.policy.manage)
 *   GET    /v1/rosters?companyId=&from=&to=           → RosterSummary[]      (plan or publish)
 *   GET    /v1/rosters/people?companyId=&…            → PlannerPerson[]      (plan)
 *   POST   /v1/rosters/preview?companyId=             → PlanResponse         (stateless; saves nothing)
 *   POST   /v1/rosters?companyId=                     → RosterDetail (201)   (DraftBody)
 *   GET    /v1/rosters/{id}                           → RosterDetail
 *   PUT    /v1/rosters/{id}                           → RosterDetail         (DraftBody + lockVersion)
 *   DELETE /v1/rosters/{id}                           → 204, only a never-published draft
 *   GET    /v1/rosters/{id}/check                     → Checks (adds the database checks E1–E5)
 *   POST   /v1/rosters/{id}/publish                   → PublishResult        (attendance.roster.publish)
 *   POST   /v1/rosters/{id}/discard-changes           → RosterDetail
 *   GET    /v1/rosters/{id}/history?employeeId=       → ScheduleChange[]
 *   GET    /v1/rosters/{id}/export?published=         → XLSX
 * Until V143_106 is applied every call answers 503 FEATURE_NOT_READY (isFeatureNotReady); the planner tab shows its
 * own "not switched on yet" state and the rest of Shifts & overtime is untouched. React Query never retries it.
 */

const KEY = ['hrms', 'rosters'] as const
const TEMPLATES = ['hrms', 'rotation-templates'] as const

export const rosterKeys = {
  all: KEY,
  list: (companyId: string, from?: string, to?: string) => [...KEY, 'list', companyId, from ?? '', to ?? ''] as const,
  detail: (id: string) => [...KEY, 'detail', id] as const,
  people: (companyId: string, departmentId: string | null, branchId: string | null, from: string, to: string) =>
    [...KEY, 'people', companyId, departmentId ?? '', branchId ?? '', from, to] as const,
  settings: (companyId: string) => [...KEY, 'settings', companyId] as const,
  history: (id: string, employeeId?: string) => [...KEY, 'history', id, employeeId ?? ''] as const,
  templates: (companyId: string) => [...TEMPLATES, companyId] as const,
}

const qs = (o: Record<string, string | null | undefined>) => {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(o)) if (v) p.set(k, v)
  const s = p.toString()
  return s ? `?${s}` : ''
}

// ── Rotation patterns ───────────────────────────────────────────────────────

export function useRotationTemplates(companyId: string, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: rosterKeys.templates(companyId),
    queryFn: () => apiJson<RotationTemplate[]>(`/v1/rotation-templates${qs({ companyId })}`),
    enabled: !!companyId && (opts?.enabled ?? true),
    staleTime: 60_000,
  })
}

/** Creates a pattern (no id) or replaces one (id). */
export function useSaveTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ companyId, id, body }: { companyId: string; id?: string | null; body: TemplateBody }) => id
      ? apiJson<RotationTemplate>(`/v1/rotation-templates/${id}`, { method: 'PUT', body: JSON.stringify(body) })
      : apiJson<RotationTemplate>(`/v1/rotation-templates${qs({ companyId })}`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: (_r, v) => qc.invalidateQueries({ queryKey: rosterKeys.templates(v.companyId) }),
  })
}

export function useDeleteTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id }: { id: string; companyId: string }) => apiJson<void>(`/v1/rotation-templates/${id}`, { method: 'DELETE' }),
    onSuccess: (_r, v) => qc.invalidateQueries({ queryKey: rosterKeys.templates(v.companyId) }),
  })
}

// ── Settings ────────────────────────────────────────────────────────────────

export function useRosterSettings(companyId: string, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: rosterKeys.settings(companyId),
    queryFn: () => apiJson<RosterSettings>(`/v1/rosters/settings${qs({ companyId })}`),
    enabled: !!companyId && (opts?.enabled ?? true),
    staleTime: 5 * 60_000,
  })
}

export function useSaveRosterSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ companyId, body }: { companyId: string; body: RosterSettingsBody }) =>
      apiJson<RosterSettings>(`/v1/rosters/settings${qs({ companyId })}`, { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: (r, v) => qc.setQueryData(rosterKeys.settings(v.companyId), r),
  })
}

// ── Rosters ─────────────────────────────────────────────────────────────────

/** Rosters overlapping from…to (the server's default without them: today −90 … +120 days), newest first. */
export function useRosters(companyId: string, opts?: { from?: string; to?: string; enabled?: boolean }) {
  return useQuery({
    queryKey: rosterKeys.list(companyId, opts?.from, opts?.to),
    queryFn: () => apiJson<RosterSummary[]>(`/v1/rosters${qs({ companyId, from: opts?.from, to: opts?.to })}`),
    enabled: !!companyId && (opts?.enabled ?? true),
    staleTime: 30_000,
  })
}

/** Active people in the roster's scope, with what the planner needs about each (designation, joining, other rosters). */
export function usePlannerPeople(p: { companyId: string; departmentId: string | null; branchId: string | null; from: string; to: string }, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: rosterKeys.people(p.companyId, p.departmentId, p.branchId, p.from, p.to),
    queryFn: () => apiJson<PlannerPerson[]>(`/v1/rosters/people${qs({ companyId: p.companyId, departmentId: p.departmentId, branchId: p.branchId, from: p.from, to: p.to })}`),
    enabled: !!p.companyId && !!p.from && !!p.to && (opts?.enabled ?? true),
    staleTime: 60_000,
  })
}

export function useRoster(id: string | null | undefined, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: rosterKeys.detail(id ?? ''),
    queryFn: () => apiJson<RosterDetail>(`/v1/rosters/${id}`),
    enabled: !!id && (opts?.enabled ?? true),
    // The planner holds its own working copy once loaded; a refetch must not overwrite unsaved edits.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  })
}

/** The live preview: generate + coverage + checks, nothing saved. Called directly (debounced, abortable). */
export function previewPlan(companyId: string, body: PlanRequest, signal?: AbortSignal) {
  return apiJson<PlanResponse>(`/v1/rosters/preview${qs({ companyId })}`, { method: 'POST', body: JSON.stringify(body), signal })
}

/** Save draft: POST the first time (no id), PUT afterwards (lockVersion in the body). */
export function useSaveRoster() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ companyId, id, body }: { companyId: string; id?: string | null; body: DraftBody }) => id
      ? apiJson<RosterDetail>(`/v1/rosters/${id}`, { method: 'PUT', body: JSON.stringify(body) })
      : apiJson<RosterDetail>(`/v1/rosters${qs({ companyId })}`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: (r) => {
      qc.setQueryData(rosterKeys.detail(r.roster.id), r)
      return qc.invalidateQueries({ queryKey: [...KEY, 'list'] })
    },
  })
}

export function useDeleteRoster() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiJson<void>(`/v1/rosters/${id}`, { method: 'DELETE' }),
    onSuccess: (_r, id) => {
      qc.removeQueries({ queryKey: rosterKeys.detail(id) })
      return qc.invalidateQueries({ queryKey: [...KEY, 'list'] })
    },
  })
}

/** The full check of the saved roster (the preview's checks plus the database checks E1–E5). */
export function fetchRosterCheck(id: string) {
  return apiJson<Checks>(`/v1/rosters/${id}/check`)
}

export function usePublishRoster() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: PublishBody }) =>
      apiJson<PublishResult>(`/v1/rosters/${id}/publish`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...KEY, 'list'] }),
  })
}

export function useDiscardRosterChanges() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: LockVersionBody }) =>
      apiJson<RosterDetail>(`/v1/rosters/${id}/discard-changes`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: (r) => {
      qc.setQueryData(rosterKeys.detail(r.roster.id), r)
      return qc.invalidateQueries({ queryKey: [...KEY, 'list'] })
    },
  })
}

export function useRosterHistory(id: string | null | undefined, employeeId?: string, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: rosterKeys.history(id ?? '', employeeId),
    queryFn: () => apiJson<ScheduleChange[]>(`/v1/rosters/${id}/history${qs({ employeeId })}`),
    enabled: !!id && (opts?.enabled ?? true),
  })
}

/** Downloads the roster as the S13 Excel layout (the working copy, or the published days). */
export async function downloadRosterExport(roster: Pick<RosterSummary, 'id' | 'name'>, published = false) {
  const blob = await apiBlob(`/v1/rosters/${roster.id}/export${qs({ published: published ? 'true' : 'false' })}`)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${roster.name.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Roster'}.xlsx`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// ── Error answers the planner acts on (design §1.5 "Error codes") ──────────

export const ROSTER_CHANGED = 'ROSTER_CHANGED'
export const ROSTER_HAS_ERRORS = 'ROSTER_HAS_ERRORS'
export const ROSTER_HAS_WARNINGS = 'ROSTER_HAS_WARNINGS'

export const rosterErrorCode = (e: unknown) => errorCodeOf(e)

const isChecks = (v: unknown): v is Checks => !!v && typeof v === 'object' && Array.isArray((v as Checks).errors) && Array.isArray((v as Checks).warnings)

/**
 * The Checks a 409 ROSTER_HAS_ERRORS / ROSTER_HAS_WARNINGS carries. The design says "body: Checks" without saying
 * where in the error body; this reads the body itself and the usual nests (checks, details, data).
 */
export function checksFromError(e: unknown): Checks | null {
  const p = (e as { payload?: Record<string, unknown> } | null)?.payload
  if (!p || typeof p !== 'object') return null
  for (const v of [p, p.checks, p.details, p.data]) if (isChecks(v)) return { infos: [], summary: [], ...v }
  return null
}
