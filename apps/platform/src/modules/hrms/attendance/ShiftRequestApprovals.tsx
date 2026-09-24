import { useState } from 'react'
import { Link } from 'react-router-dom'
import { format } from 'date-fns'
import { ArrowRight, CheckCircle2 } from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { usePermission, P } from '@unifiedtree/sdk'
import { apiJson } from '@/core/api/client'
import { HrButton, HrAvatar, HrStatusPill } from '@/shared/components/hr'
import { EmptyState } from '@/shared/components/EmptyState'
import { useToast } from '@/shared/hooks/useToast'
import { useEmployeesByIds, type WorkforceEmployee } from '../api/useWorkforce'
import { useDepartments } from '../api/useOrg'
import { useShiftPolicies } from '../api/useShiftPolicies'
import { usePendingShiftRequests, useDecideShiftRequest, type ShiftRequest } from '../api/useShiftRequests'
import { hhmm } from './shiftTime'

/**
 * Pending count for the "Shift requests" tab badge. Same query key as
 * usePendingShiftRequests so the badge and the list share one cache entry (and
 * the decision mutation's ['shifts'] invalidation refreshes both), but with an
 * `enabled` switch: GET /change-requests/pending is gated on
 * attendance.regularization.approve and a view-only manager must not fire it.
 */
export function usePendingShiftRequestCount(enabled: boolean) {
  const query = useQuery({
    queryKey: ['shifts', 'requests', 'pending'],
    queryFn: () => apiJson<ShiftRequest[]>('/v1/shifts/change-requests/pending'),
    refetchInterval: 30_000,
    enabled,
  })
  return query.data?.length
}

const fullName = (e: WorkforceEmployee) => [e.firstName, e.lastName].filter(Boolean).join(' ')

/**
 * HR/manager queue for employee shift-change requests (filed at /me/shift-change).
 * Mounted as the "Shift requests" tab on Shifts & Overtime; the page only renders
 * it for attendance.regularization.approve — the permission ShiftController
 * checks on both GET /change-requests/pending and POST …/{id}/decision.
 */
export function ShiftRequestApprovals({ companyId }: { companyId: string }) {
  const query = usePendingShiftRequests()
  const requests = query.data ?? []
  // /employees/by-ids answers hrms.employee.read; without it the request row
  // cannot be named, so the card says so instead of printing a raw UUID.
  const canReadEmployee = usePermission(P.HRMS_EMPLOYEE_READ)
  const employees = useEmployeesByIds(requests.map(r => r.employeeId), { enabled: canReadEmployee })

  return <section className="ut-card overflow-hidden" aria-label="Shift change requests">
    <div className="border-b border-border-default p-5"><h2 className="font-semibold">Shift change requests</h2>
      <p className="mt-1 text-sm text-text-secondary">Review employee requests. Approval assigns the requested shift from today; rejection leaves the current shift in place.</p></div>
    {query.isPending ? <div className="space-y-3 p-5" role="status" aria-label="Loading requests…">
        {[0, 1].map(i => <div key={i} className="h-24 w-full animate-pulse rounded-lg bg-bg-base" />)}
      </div>
      : query.isError ? <div className="space-y-3 p-6" role="alert"><p className="text-sm">Could not load shift requests.{query.error instanceof Error && query.error.message ? ` ${query.error.message}` : ''}</p><HrButton onClick={() => query.refetch()}>Try again</HrButton></div>
      : requests.length === 0 ? <EmptyState icon={CheckCircle2} title="All caught up" description="No shift changes waiting for approval. Requests employees file from Self Service appear here." />
      : <div className="divide-y divide-border-default">{requests.map(request => <RequestCard
          key={request.id}
          request={request}
          companyId={companyId}
          canReadEmployee={canReadEmployee}
          employee={employees.data?.find(e => e.id === request.employeeId)}
          employeesPending={canReadEmployee && employees.isPending}
        />)}</div>}
  </section>
}

function RequestCard({ request, companyId, canReadEmployee, employee, employeesPending }: {
  request: ShiftRequest
  companyId: string
  canReadEmployee: boolean
  employee?: WorkforceEmployee
  employeesPending: boolean
}) {
  const { toast } = useToast()
  const client = useQueryClient()
  const decision = useDecideShiftRequest()
  const [note, setNote] = useState('')
  // Department names need hrms.department.read (WorkforceController); the
  // employee row only carries departmentId. Keyed by the employee's own company
  // so a multi-company tenant resolves the right list — react-query dedupes it.
  const canReadDepartments = usePermission(P.HRMS_DEPARTMENT_READ)
  const departments = useDepartments(canReadDepartments && employee ? employee.companyId : '')
  // The request DTO carries shift names only; timings come from the same
  // attendance.shift_policies list the schedules tab shows.
  const policies = useShiftPolicies(employee?.companyId || companyId)
  const timing = (id?: string) => {
    const p = id ? policies.data?.find(s => s.id === id) : undefined
    return p ? `${hhmm(p.startTime)} – ${hhmm(p.endTime)}` : null
  }

  const name = employee ? fullName(employee) : canReadEmployee ? (employeesPending ? 'Loading employee…' : 'Employee details unavailable') : 'Employee name hidden'
  const department = !employee || !canReadDepartments ? null
    : !employee.departmentId ? 'No department'
    : departments.data?.find(d => d.id === employee.departmentId)?.name ?? (departments.isPending ? null : 'Department unavailable')
  const sub = employee ? [employee.employeeCode, department].filter(Boolean).join(' · ')
    : canReadEmployee ? undefined : 'Employee directory access is needed to see who raised this'
  const current = request.currentShiftName || 'Not assigned'
  const requested = request.requestedShiftName || 'Shift details unavailable'
  const deciding = decision.isPending ? (decision.variables?.approved ? 'approve' : 'reject') : null

  async function decide(approved: boolean) {
    try {
      await decision.mutateAsync({ id: request.id, approved, comment: note.trim() || undefined })
      const who = employee ? fullName(employee) : 'The employee'
      toast(approved ? `${who} moves to ${requested} from today` : `Shift request rejected — ${who} stays on ${current}`, 'success')
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not save the decision', 'error')
      // A 422 SHIFT_CHANGE_NOT_PENDING means someone else already decided it —
      // refresh so the stale card drops instead of waiting for the 30s poll.
      client.invalidateQueries({ queryKey: ['shifts', 'requests', 'pending'] })
    }
  }

  const avatar = <HrAvatar name={name} sub={sub} />
  return <article className="p-5" aria-label={`Shift request from ${employee ? fullName(employee) : 'employee'}`}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      {employee && canReadEmployee ? <Link to={`/hrms/employees/${request.employeeId}`} className="hover:underline">{avatar}</Link> : avatar}
      <div className="flex items-center gap-2">
        <HrStatusPill tone="warn">Pending approval</HrStatusPill>
        {request.createdAt && <span className="text-xs text-text-secondary">Submitted <time dateTime={request.createdAt}>{format(new Date(request.createdAt), 'd MMM yyyy')}</time></span>}
      </div>
    </div>
    <div className="my-4 grid items-center gap-3 rounded-lg bg-bg-base p-4 text-sm sm:grid-cols-[1fr_auto_1fr]">
      <div><p className="text-xs text-text-secondary">Current shift</p><p className="mt-1 font-medium">{current}</p>
        {timing(request.currentShiftPolicyId) && <p className="text-xs text-text-secondary">{timing(request.currentShiftPolicyId)}</p>}</div>
      <ArrowRight size={16} className="hidden text-text-tertiary sm:block" aria-hidden />
      <div><p className="text-xs text-text-secondary">Requested shift</p><p className="mt-1 font-medium">{requested}</p>
        {timing(request.requestedShiftPolicyId) && <p className="text-xs text-text-secondary">{timing(request.requestedShiftPolicyId)}</p>}</div>
    </div>
    <p className="text-sm"><strong>Reason: </strong>{request.reason || 'No reason provided'}</p>
    <div className="mt-4 flex flex-wrap items-end gap-3">
      <label className="min-w-48 flex-1 text-xs text-text-secondary">Decision note (optional)<input className="ut-input mt-1" value={note} maxLength={1000} onChange={e => setNote(e.target.value)} /></label>
      <HrButton variant="ghost" disabled={decision.isPending} onClick={() => decide(false)}>{deciding === 'reject' ? 'Rejecting…' : 'Reject'}</HrButton>
      <HrButton disabled={decision.isPending} onClick={() => decide(true)}>{deciding === 'approve' ? 'Approving…' : 'Approve change'}</HrButton>
    </div>
  </article>
}
