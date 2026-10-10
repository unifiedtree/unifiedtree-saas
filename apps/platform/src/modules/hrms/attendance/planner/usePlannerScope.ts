// Who plans what (design §1.5 "Planner scope", D-S1), as the web sees it. The server decides (PlannerScope, 403
// ROSTER_SCOPE); this only shapes the screens:
//   company-wide planner = attendance.roster.plan + attendance.workforce.admin: any department, any building;
//   department planner   = attendance.roster.plan alone: only the departments they head (hrms.departments
//                          .department_head_employee_id), and one of them is required;
//   publish              = attendance.roster.publish (HR/Admin by default).
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { P, usePermission } from '@unifiedtree/sdk'
import { apiJson } from '@/core/api/client'
import { useDepartments, type Department } from '../../api/useOrg'

export interface PlannerScopeInfo {
  canPlan: boolean
  canPublish: boolean
  /** Plans for the whole company (holds attendance.workforce.admin too). */
  companyWide: boolean
  /** Departments the planner may plan: all active ones, or the ones they head. */
  departments: Department[]
  loading: boolean
  /** The department list couldn't be read. */
  error: unknown
  /** A department planner who heads no department: HR plans for the company. */
  noDepartment: boolean
  canAddHoliday: boolean
  canPolicy: boolean
}

export function usePlannerScope(companyId: string): PlannerScopeInfo {
  const canPlan = usePermission(P.ATTENDANCE_ROSTER_PLAN)
  const canPublish = usePermission(P.ATTENDANCE_ROSTER_PUBLISH)
  const companyWide = usePermission('attendance.workforce.admin')
  const canAddHoliday = usePermission(P.SETTINGS_HOLIDAYS_WRITE)
  const canPolicy = usePermission('attendance.policy.manage')
  const deps = useDepartments(companyId)
  // The same query (and key) Shifts & overtime uses for the signed-in person's employee id.
  const me = useQuery({ queryKey: ['employees', 'me'], queryFn: () => apiJson<{ id: string }>('/v1/employees/me'), enabled: canPlan && !companyWide, staleTime: 300_000 })
  const departments = useMemo(() => {
    const active = (deps.data ?? []).filter((d) => d.active !== false).sort((a, b) => a.name.localeCompare(b.name))
    if (companyWide) return active
    const id = me.data?.id
    return id ? active.filter((d) => d.departmentHeadEmployeeId === id) : []
  }, [deps.data, me.data, companyWide])
  const loading = deps.isLoading || (!companyWide && canPlan && me.isLoading)
  return {
    canPlan, canPublish, companyWide, departments, loading, error: deps.error ?? (companyWide ? null : me.error),
    noDepartment: canPlan && !companyWide && !loading && !deps.error && !me.error && departments.length === 0,
    canAddHoliday, canPolicy,
  }
}
