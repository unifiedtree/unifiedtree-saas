import { useState } from 'react'
import { Link } from 'react-router-dom'
import { usePermission, P } from '@unifiedtree/sdk'
import { HrButton, HrAvatar } from '@/shared/components/hr'
import { useToast } from '@/shared/hooks/useToast'
import { useEmployeesByIds } from '../api/useWorkforce'
import { usePendingShiftRequests, useDecideShiftRequest } from '../api/useShiftRequests'

export function ShiftRequestApprovals() {
  const query = usePendingShiftRequests()
  const requests = query.data ?? []
  const canReadEmployee = usePermission(P.HRMS_EMPLOYEE_READ)
  const employees = useEmployeesByIds(requests.map(r => r.employeeId), { enabled: canReadEmployee })
  const decision = useDecideShiftRequest()
  const [notes, setNotes] = useState<Record<string, string>>({})
  const { toast } = useToast()
  async function decide(id: string, approved: boolean) {
    try {
      await decision.mutateAsync({ id, approved, comment: notes[id]?.trim() || undefined })
      toast(approved ? 'Request approved and employee shift updated' : 'Shift request rejected', 'success')
    } catch (error) { toast(error instanceof Error ? error.message : 'Could not save the decision', 'error') }
  }
  return <section className="ut-card overflow-hidden" aria-label="Shift change requests">
    <div className="border-b border-border-default p-5"><h2 className="font-semibold">Shift change requests</h2>
      <p className="mt-1 text-sm text-text-secondary">Review employee requests. Approval assigns the requested shift from today.</p></div>
    {query.isPending ? <p className="p-6" role="status">Loading requests…</p>
      : query.isError ? <div className="p-6" role="alert"><p>Could not load shift requests.</p><HrButton onClick={() => query.refetch()}>Try again</HrButton></div>
      : requests.length === 0 ? <p className="p-8 text-center text-sm text-text-secondary">No shift changes waiting for approval.</p>
      : <div className="divide-y divide-border-default">{requests.map(request => {
        const employee = employees.data?.find(e => e.id === request.employeeId)
        const name = employee ? [employee.firstName, employee.lastName].filter(Boolean).join(' ') : request.employeeId
        return <article key={request.id} className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            {canReadEmployee ? <Link to={`/hrms/employees/${request.employeeId}`} className="hover:underline"><HrAvatar name={name} sub={employee?.employeeCode ?? (employees.isPending ? 'Loading employee…' : 'Employee details unavailable')} /></Link>
              : <HrAvatar name="Employee shift request" sub={request.employeeId} />}
            <time className="text-xs text-text-secondary">{new Date(request.createdAt).toLocaleDateString('en-IN')}</time>
          </div>
          <div className="my-4 grid gap-3 rounded-lg bg-bg-base p-4 text-sm sm:grid-cols-2">
            <div><p className="text-xs text-text-secondary">Current shift</p><p className="mt-1 font-medium">{request.currentShiftName || 'Not assigned'}</p></div>
            <div><p className="text-xs text-text-secondary">Requested shift</p><p className="mt-1 font-medium">{request.requestedShiftName || 'Shift details unavailable'}</p></div>
          </div>
          <p className="text-sm"><strong>Reason: </strong>{request.reason || 'No reason provided'}</p>
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <label className="min-w-48 flex-1 text-xs text-text-secondary">Decision note (optional)<input className="ut-input mt-1" value={notes[request.id] ?? ''} maxLength={1000} onChange={e => setNotes(prev => ({ ...prev, [request.id]: e.target.value }))} /></label>
            <HrButton variant="ghost" disabled={decision.isPending} onClick={() => decide(request.id, false)}>Reject</HrButton>
            <HrButton disabled={decision.isPending} onClick={() => decide(request.id, true)}>Approve change</HrButton>
          </div>
        </article>
      })}</div>}
  </section>
}
