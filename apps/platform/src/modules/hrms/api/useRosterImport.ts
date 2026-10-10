import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiBlob, apiJson } from '@/core/api/client'
import type { ImportValidation, RosterDetail, RosterSummary } from './rosterTypes'

/**
 * Shift planning, Phase 1 — the roster's Excel import (design §1.5 endpoints 20–22, §1.7).
 *
 * Backend: com.hrms.app.roster.RosterImportController (attendance.roster.plan).
 *   GET  /v1/rosters/import/template?companyId=&startDate=&endDate=&departmentId=&branchId=  → XLSX (S13 layout)
 *   POST /v1/rosters/import/validate?…  multipart file (+ rosterId?)                         → ImportValidation (saves nothing)
 *   POST /v1/rosters/import/apply?…     multipart file (+ name?, rosterId?, lockVersion?)     → RosterDetail: a DRAFT
 * The query string carries companyId (the company-access filter checks it there) and the rest of the scope; the
 * body is only the file. Every call answers 503 FEATURE_NOT_READY until V143_106 is applied (isFeatureNotReady).
 * The roster list shares its cache key with the planner's (['hrms', 'rosters', 'list', …]).
 */

/** The roster a file is for: the company, the period and the optional department and building. */
export interface ImportScope {
  companyId: string
  startDate: string
  endDate: string
  departmentId: string | null
  branchId: string | null
}

const ROSTERS = ['hrms', 'rosters'] as const

const query = (o: Record<string, string | number | null | undefined>) => {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(o)) if (v !== null && v !== undefined && v !== '') p.set(k, String(v))
  return p.toString()
}

const scopeQuery = (s: ImportScope, extra: Record<string, string | number | null | undefined> = {}) =>
  query({ companyId: s.companyId, startDate: s.startDate, endDate: s.endDate, departmentId: s.departmentId, branchId: s.branchId, ...extra })

const formWith = (file: File) => {
  const fd = new FormData()
  fd.append('file', file)
  return fd
}

/** Saves a blob as a file (the browser's download). */
function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Downloads the template: the people in scope, one column per day of the period, the codes on a second sheet. */
export async function downloadRosterTemplate(scope: ImportScope, fileName = `Roster template ${scope.startDate} to ${scope.endDate}.xlsx`) {
  const blob = await apiBlob(`/v1/rosters/import/template?${scopeQuery(scope)}`)
  saveBlob(blob, fileName)
}

export function useDownloadRosterTemplate() {
  return useMutation({ mutationFn: (scope: ImportScope) => downloadRosterTemplate(scope) })
}

/** Checks a file: matched people, problems by row and column, and the planner's preview. Saves nothing. */
export function useValidateRosterImport() {
  return useMutation({
    mutationFn: ({ file, scope, rosterId }: { file: File; scope: ImportScope; rosterId?: string | null }) =>
      apiJson<ImportValidation>(`/v1/rosters/import/validate?${scopeQuery(scope, { rosterId })}`, { method: 'POST', body: formWith(file) }),
  })
}

/** Creates a draft from the file, or replaces the days of a draft that was never published. */
export function useApplyRosterImport() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ file, scope, name, rosterId, lockVersion }: {
      file: File; scope: ImportScope; name?: string; rosterId?: string | null; lockVersion?: number | null
    }) => apiJson<RosterDetail>(`/v1/rosters/import/apply?${scopeQuery(scope, { name, rosterId, lockVersion })}`, {
      method: 'POST', body: formWith(file),
    }),
    onSuccess: (detail) => {
      qc.invalidateQueries({ queryKey: [...ROSTERS, 'list'] })
      qc.setQueryData([...ROSTERS, 'detail', detail.roster.id], detail)
    },
  })
}

/** The company's rosters overlapping a window (the drafts an import may replace come from it). */
export function useImportRosters(companyId: string, from: string, to: string, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: [...ROSTERS, 'list', companyId, from, to],
    queryFn: () => apiJson<RosterSummary[]>(`/v1/rosters?${query({ companyId, from, to })}`),
    enabled: !!companyId && (opts?.enabled ?? true),
    staleTime: 30_000,
  })
}
