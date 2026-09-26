import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { usePermission, P } from '@unifiedtree/sdk'
import { apiJson } from '@/core/api/client'
import { HrButton, HrDrawer } from '@/shared/components/hr'
import { DateField } from '@/shared/components/calendar'
import { useToast } from '@/shared/hooks/useToast'
import { useEmployeeShift, useShiftPolicies } from '../api/useShiftPolicies'

export function EmployeeShiftAction({ employeeId, companyId, name }: { employeeId: string; companyId: string; name: string }) {
  const allowed = usePermission(P.ATTENDANCE_REGULARIZATION_APPROVE)
  const [open, setOpen] = useState(false)
  if (!allowed) return null
  return <><HrButton variant="ghost" onClick={() => setOpen(true)}>Change shift</HrButton>
    {open && <AssignmentDrawer employeeId={employeeId} companyId={companyId} name={name} onClose={() => setOpen(false)} />}</>
}

const today = () => format(new Date(), 'yyyy-MM-dd')
const day = (iso: string) => format(new Date(`${iso}T00:00:00`), 'd MMM yyyy')

/**
 * The backend accepts an `effectiveFrom` date and closes the previous
 * assignment the day before it, so a change can be scheduled ahead ("night
 * shift from next Monday"). The drawer used to omit the date, which silently
 * made every change start today — the client's "shift change must take effect
 * on the right day" complaint. Now the date is explicit, defaults to today, and
 * cannot precede the assignment currently in force (the backend rejects that).
 */
function AssignmentDrawer({ employeeId, companyId, name, onClose }: { employeeId: string; companyId: string; name: string; onClose: () => void }) {
  const current = useEmployeeShift(employeeId)
  const policies = useShiftPolicies(companyId)
  const [selected, setSelected] = useState('')
  const [effectiveFrom, setEffectiveFrom] = useState(today())
  const client = useQueryClient()
  const { toast } = useToast()
  const minDate = current.data?.effectiveFrom ?? undefined
  const tooEarly = Boolean(minDate && effectiveFrom && effectiveFrom < minDate)
  const scheduled = effectiveFrom > today()
  // Re-selecting today's shift is a no-op — unless a later change is already
  // scheduled, in which case saving the current shift for that date cancels it.
  const sameAsCurrent = Boolean(selected) && selected === current.data?.shiftPolicyId && !current.data?.upcomingShiftPolicyId
  const chosen = (policies.data ?? []).find(policy => policy.id === selected)
  const save = useMutation({
    mutationFn: () => apiJson(`/v1/shifts/employee/${employeeId}`, { method: 'POST', body: JSON.stringify({ shiftPolicyId: selected, effectiveFrom }) }),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['shifts'] }),
        client.invalidateQueries({ queryKey: ['hrms', 'attendance'] }),
        client.invalidateQueries({ queryKey: ['team', 'schedule'] }),
      ])
      toast(scheduled
        ? `${name} moves to ${chosen?.name ?? 'the new shift'} from ${day(effectiveFrom)}`
        : `${name} is now on ${chosen?.name ?? 'the new shift'}`, 'success')
      onClose()
    },
  })
  const canSave = Boolean(selected) && Boolean(effectiveFrom) && !tooEarly && !sameAsCurrent
    && !save.isPending && !current.isError && !policies.isError
  return <HrDrawer title="Change employee shift" onClose={() => { if (!save.isPending) onClose() }}
    footer={<div className="flex justify-end gap-3"><HrButton variant="ghost" disabled={save.isPending} onClick={onClose}>Cancel</HrButton>
      <HrButton disabled={!canSave} onClick={() => save.mutate()}>{save.isPending ? 'Saving…' : scheduled ? 'Schedule shift change' : 'Save shift'}</HrButton></div>}>
    <div className="space-y-5"><div><h3 className="font-semibold">{name}</h3><p className="mt-1 text-sm text-text-secondary">Choose the shift and the day it takes effect. The roster and attendance use the new shift from that day; earlier assignments stay in history.</p></div>
      {current.isPending || policies.isPending ? <p role="status">Loading shift schedules…</p>
        : current.isError || policies.isError ? <div role="alert"><p>Unable to load shift schedules.</p><HrButton onClick={() => { current.refetch(); policies.refetch() }}>Try again</HrButton></div>
        : <><div className="rounded-lg bg-bg-base p-4 text-sm"><p className="text-xs text-text-secondary">Current shift</p><p className="mt-1 font-medium">{current.data?.shiftName || 'No shift assigned'}</p>
          {current.data?.startTime && <p className="mt-1 text-text-secondary">{current.data.startTime.slice(0, 5)} – {current.data.endTime?.slice(0, 5)}{current.data.effectiveFrom ? ` · since ${day(current.data.effectiveFrom)}` : ''}</p>}
          {current.data?.upcomingShiftName && current.data.upcomingEffectiveFrom && <p className="mt-2 text-xs font-semibold text-accent-fg">Scheduled: {current.data.upcomingShiftName} from {day(current.data.upcomingEffectiveFrom)}</p>}</div>
          <label className="block text-sm font-medium">New shift<select className="ut-input mt-2" value={selected} onChange={e => setSelected(e.target.value)}><option value="">Select a shift</option>
            {(policies.data ?? []).map(policy => <option key={policy.id} value={policy.id}>{policy.name} · {policy.startTime?.slice(0, 5)} – {policy.endTime?.slice(0, 5)}</option>)}</select></label>
          <label className="block text-sm font-medium">Effective from<DateField className="ut-input mt-2" value={effectiveFrom} min={minDate} required onChange={e => setEffectiveFrom(e.target.value)} />
            <span className="mt-1 block text-xs font-normal text-text-secondary">{scheduled ? `The change is scheduled for ${day(effectiveFrom)}; the current shift applies until then.` : 'Applies from today.'}</span></label>
          {tooEarly && minDate && <p role="alert" className="text-sm text-danger">The date cannot be before the current assignment started ({day(minDate)}).</p>}
          {sameAsCurrent && <p className="text-sm text-text-secondary">{name} is already on this shift.</p>}
          {policies.data?.length === 0 && <p className="text-sm text-text-secondary">Create a shift in Attendance → Shifts & Overtime first.</p>}
        </>}
      {save.isError && <p role="alert" className="text-sm text-danger">{save.error instanceof Error ? save.error.message : 'Shift could not be saved. Please retry.'}</p>}
    </div>
  </HrDrawer>
}
