// Daily Logs row ⋮ "Mark leave": apply for leave on someone's behalf (BW-43, P-LEAVE's endpoint).
//   POST /v1/leave/apply/for/{employeeId}  { leaveTypeId, startDate, endDate, duration, reason? }
//   hrms.leave.apply.others; the request then follows the usual approval, and the person is told.
// The leave types are the company's active ones (GET /v1/leave/types?companyId=).
import { useState } from 'react'
import { Callout } from '@/design/kit/display'
import { FieldGrid, Input, PanelButton, Select, SidePanel, Textarea, useToast } from '@/design/kit/overlays'
import { fmtWd } from '@/design/dc/dates'
import { useLeaveTypes, type LeaveDuration } from '../../api/useLeave'
import { useApplyLeaveOnBehalf } from '../../api/shared/useApplyLeaveOnBehalf'

export function MarkLeavePanel({ person, date, companyId, onClose }: {
  person: { id: string; name: string } | null; date: string; companyId: string; onClose: () => void
}) {
  if (!person) return null
  return <OpenMarkLeave person={person} date={date} companyId={companyId} onClose={onClose} />
}

function OpenMarkLeave({ person, date, companyId, onClose }: { person: { id: string; name: string }; date: string; companyId: string; onClose: () => void }) {
  const toast = useToast()
  const types = useLeaveTypes(companyId)
  const apply = useApplyLeaveOnBehalf()
  const active = (types.data ?? []).filter((t) => t.isActive !== false)
  const [typeId, setTypeId] = useState('')
  const [from, setFrom] = useState(date)
  const [to, setTo] = useState(date)
  const [duration, setDuration] = useState<LeaveDuration>('FULL_DAY')
  const [reason, setReason] = useState('')
  const [tried, setTried] = useState(false)
  const leaveTypeId = typeId || active[0]?.id || ''
  const oneDay = from === to
  const problems = {
    type: !leaveTypeId ? 'Choose the leave type.' : null,
    dates: !from || !to ? 'Choose the days.' : to < from ? 'The last day is before the first day.' : null,
  }
  const blocked = problems.type || problems.dates
  const save = () => {
    setTried(true)
    if (blocked || apply.isPending) return
    apply.mutateAsync({ employeeId: person.id, leaveTypeId, startDate: from, endDate: to, duration: oneDay ? duration : 'FULL_DAY', ...(reason.trim() ? { reason: reason.trim() } : {}) })
      .then((r) => {
        if (!r.available) { toast.info('Applying for someone else isn’t switched on yet.'); return }
        toast.success(`Leave applied for ${person.name} · ${oneDay ? fmtWd(from) : `${fmtWd(from)} – ${fmtWd(to)}`}. It goes for approval as usual.`)
        onClose()
      })
      .catch((e) => toast.error('Couldn’t apply the leave', { detail: (e as Error)?.message }))
  }
  return (
    <SidePanel open onClose={onClose} title="Mark leave" sub={`For ${person.name}. It goes for approval as their own request would, and they’re told.`} busy={apply.isPending}
      footer={<>
        <PanelButton size="lg" onClick={onClose}>Cancel</PanelButton>
        <PanelButton size="lg" variant="primary" busy={apply.isPending} blockedReason={blocked} tipAlign="end" onBlockedClick={() => setTried(true)} onClick={save}>Apply leave</PanelButton>
      </>}>
      {types.isError && <Callout tone="danger">Couldn’t load the leave types.</Callout>}
      <FieldGrid columns={2}>
        <Select label="Leave type" full value={leaveTypeId} onChange={(e) => setTypeId(e.target.value)} error={tried ? problems.type : undefined}
          options={active.length ? active.map((t) => ({ value: t.id, label: t.name })) : [{ value: '', label: types.isLoading ? 'Loading…' : 'No leave types' }]} />
        <Input label="From" type="date" value={from} onChange={(e) => { setFrom(e.target.value); if (to < e.target.value) setTo(e.target.value) }} />
        <Input label="To" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} error={tried ? problems.dates : undefined} />
        {oneDay && (
          <Select label="How much of the day" full value={duration} onChange={(e) => setDuration(e.target.value as LeaveDuration)}
            options={[{ value: 'FULL_DAY', label: 'Full day' }, { value: 'HALF_DAY_MORNING', label: 'First half' }, { value: 'HALF_DAY_AFTERNOON', label: 'Second half' }]} />
        )}
        <Textarea label="Reason (optional)" full rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Called in sick" />
      </FieldGrid>
    </SidePanel>
  )
}
