// People on notice or gone, for Resignation & exit (P-GROW). Uses P-WF-PEOPLE's BW-91:
//   GET /v1/hrms/employees/exits?status=&page&pageSize (hrms.employee.write) → reason, exit type,
//   department and last working day. The key sits under ['hrms', 'employees'], so the notice,
//   exit and cancel-notice mutations (useWorkforce) refresh it.
import { useQuery } from '@tanstack/react-query'
import { apiJson } from '@/core/api/client'
import type { ExitType } from '../api/useWorkforce'

export type ExitStatus = 'NOTICE_PERIOD' | 'EXITED' | 'TERMINATED'

export interface ExitRow {
  employeeId: string
  companyId: string
  employeeCode: string
  firstName: string
  lastName?: string | null
  departmentId?: string | null
  departmentName?: string | null
  designationName?: string | null
  employmentStatus: ExitStatus
  noticeStartDate?: string | null
  lastWorkingDay?: string | null
  exitType?: ExitType | null
  exitReason?: string | null
}

export interface ExitPage { content: ExitRow[]; page: number; size: number; totalElements: number; totalPages: number; last: boolean }

export function useExitList(status: ExitStatus, page: number, pageSize: number, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['hrms', 'employees', 'exits', status, page, pageSize],
    queryFn: () => apiJson<ExitPage>(`/v1/hrms/employees/exits?${new URLSearchParams({ status, page: String(page), pageSize: String(pageSize) })}`),
    enabled: opts?.enabled ?? true,
    staleTime: 15_000,
  })
}

export const exitName = (r: { firstName: string; lastName?: string | null; employeeCode?: string }) =>
  [r.firstName, r.lastName].filter(Boolean).join(' ') || r.employeeCode || 'Employee'

/** Rows matching a search over name, code and department (used while a search is typed). */
export function matchesSearch(r: ExitRow, q: string): boolean {
  const n = q.trim().toLowerCase()
  if (!n) return true
  return [exitName(r), r.employeeCode, r.departmentName].some((v) => (v ?? '').toLowerCase().includes(n))
}
