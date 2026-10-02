// People on notice or gone, for Resignation & exit (P-GROW). Uses P-WF-PEOPLE's BW-91:
//   GET /v1/hrms/employees/exits?status=&page&pageSize&search= (hrms.employee.write) → reason,
//   exit type, department and last working day. `search` is optional and matched server-side,
//   case-insensitive contains over full name, employee code and department name. The key sits
//   under ['hrms', 'employees'], so the notice, exit and cancel-notice mutations (useWorkforce)
//   refresh it.
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

export function useExitList(status: ExitStatus, page: number, pageSize: number, search?: string, opts?: { enabled?: boolean }) {
  const q = (search ?? '').trim()
  return useQuery({
    queryKey: ['hrms', 'employees', 'exits', status, page, pageSize, q],
    queryFn: () => {
      const sp = new URLSearchParams({ status, page: String(page), pageSize: String(pageSize) })
      if (q) sp.set('search', q)
      return apiJson<ExitPage>(`/v1/hrms/employees/exits?${sp}`)
    },
    enabled: opts?.enabled ?? true,
    staleTime: 15_000,
  })
}

export const exitName = (r: { firstName: string; lastName?: string | null; employeeCode?: string }) =>
  [r.firstName, r.lastName].filter(Boolean).join(' ') || r.employeeCode || 'Employee'
