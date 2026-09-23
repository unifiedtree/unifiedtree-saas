import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { usePermission, P } from '@unifiedtree/sdk'
import { apiJson } from '@/core/api/client'
import { HrButton, HrDrawer } from '@/shared/components/hr'
import { useToast } from '@/shared/hooks/useToast'
import { useEmployeeShift, useShiftPolicies } from '../api/useShiftPolicies'

export function EmployeeShiftAction({ employeeId, companyId, name }: { employeeId: string; companyId: string; name: string }) {
  const allowed = usePermission(P.ATTENDANCE_REGULARIZATION_APPROVE)
  const [open, setOpen] = useState(false)
  if (!allowed) return null
  return <><HrButton variant="ghost" onClick={() => setOpen(true)}>Change shift</HrButton>
    {open && <AssignmentDrawer employeeId={employeeId} companyId={companyId} name={name} onClose={() => setOpen(false)} />}</>
}

function AssignmentDrawer({ employeeId, companyId, name, onClose }: { employeeId: string; companyId: string; name: string; onClose: () => void }) {
  const current = useEmployeeShift(employeeId)
  const policies = useShiftPolicies(companyId)
  const [selected, setSelected] = useState('')
  const client = useQueryClient()
  const { toast } = useToast()
  const save = useMutation({
    mutationFn: () => apiJson(`/v1/shifts/employee/${employeeId}`, { method: 'POST', body: JSON.stringify({ shiftPolicyId: selected }) }),
    onSuccess: async () => {
      await Promise.all([client.invalidateQueries({ queryKey: ['shifts'] }), client.invalidateQueries({ queryKey: ['hrms', 'attendance'] })])
      toast('Employee shift updated', 'success'); onClose()
    },
  })
  return <HrDrawer title="Change employee shift" onClose={() => { if (!save.isPending) onClose() }}
    footer={<div className="flex justify-end gap-3"><HrButton variant="ghost" disabled={save.isPending} onClick={onClose}>Cancel</HrButton>
      <HrButton disabled={!selected || selected === current.data?.shiftPolicyId || save.isPending || current.isError || policies.isError} onClick={() => save.mutate()}>{save.isPending ? 'Saving…' : 'Save shift'}</HrButton></div>}>
    <div className="space-y-5"><div><h3 className="font-semibold">{name}</h3><p className="mt-1 text-sm text-text-secondary">The new assignment starts today. Previous assignments remain in history.</p></div>
      {current.isPending || policies.isPending ? <p role="status">Loading shift schedules…</p>
        : current.isError || policies.isError ? <div role="alert"><p>Unable to load shift schedules.</p><HrButton onClick={() => { current.refetch(); policies.refetch() }}>Try again</HrButton></div>
        : <><div className="rounded-lg bg-bg-base p-4 text-sm"><p className="text-xs text-text-secondary">Current shift</p><p className="mt-1 font-medium">{current.data?.shiftName || 'No shift assigned'}</p>
          {current.data?.startTime && <p className="mt-1 text-text-secondary">{current.data.startTime.slice(0, 5)} – {current.data.endTime?.slice(0, 5)}</p>}</div>
          <label className="block text-sm font-medium">New shift<select className="ut-input mt-2" value={selected} onChange={e => setSelected(e.target.value)}><option value="">Select a shift</option>
            {(policies.data ?? []).map(policy => <option key={policy.id} value={policy.id}>{policy.name} · {policy.startTime?.slice(0, 5)} – {policy.endTime?.slice(0, 5)}</option>)}</select></label>
          {policies.data?.length === 0 && <p className="text-sm text-text-secondary">Create a shift in Attendance → Shifts & Overtime first.</p>}
        </>}
      {save.isError && <p role="alert" className="text-sm text-danger">{save.error instanceof Error ? save.error.message : 'Shift could not be saved. Please retry.'}</p>}
    </div>
  </HrDrawer>
}
