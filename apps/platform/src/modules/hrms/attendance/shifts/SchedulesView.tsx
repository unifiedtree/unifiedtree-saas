// Shifts & overtime · Shift Schedules (prototype PgTime a-shifts tab 0): the company's shifts with timing, grace,
// weekly offs and the people on each today (BW-32). Add, edit and delete need attendance.workforce.admin; a shift
// people are still on can't be deleted (409 SHIFT_IN_USE), as before.
import { useEffect, useState } from 'react'
import { Avatar, Button, CellActions, Section, SectionLink, Table, errorText, type TableColumn } from '@/design/kit/display'
import { Dialog, FieldGrid, Input, PanelButton, SidePanel, useToast } from '@/design/kit/overlays'
import { useCreateShiftPolicy, useDeleteShiftPolicy, useUpdateShiftPolicy, type ShiftPolicy } from '../../api/useShiftPolicies'
import { hhmm, hm, overnight, span, timeRange, weeklyOffLabel } from './shiftModel'

interface Draft { id: string | null; name: string; start: string; end: string; grace: string; breakMin: string }

const addMin = (t: string, n: number) => { const [h, m] = t.split(':').map(Number); const x = ((((h || 0) * 60 + (m || 0) + n) % 1440) + 1440) % 1440; return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}` }

export function SchedulesView({ companyId, shifts, loading, error, onRetry, canEdit, addKey, people, noShift, onSeePeople }: {
  companyId: string
  shifts: ShiftPolicy[]
  loading: boolean
  error: unknown
  onRetry: () => void
  canEdit: boolean
  /** Changes when the header's "Add shift" is pressed. */
  addKey: number
  /** People per shift from today's roster, for servers without employeeCount. */
  people: Map<string, number>
  noShift: number
  onSeePeople: (shiftId: string) => void
}) {
  const toast = useToast()
  const create = useCreateShiftPolicy(), update = useUpdateShiftPolicy(), remove = useDeleteShiftPolicy()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [confirm, setConfirm] = useState<ShiftPolicy | null>(null)
  const busy = create.isPending || update.isPending

  const openNew = () => setDraft({ id: null, name: '', start: '09:00', end: '17:00', grace: '15', breakMin: '60' })
  useEffect(() => { if (addKey && canEdit) openNew() }, [addKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const peopleOn = (s: ShiftPolicy) => (typeof s.employeeCount === 'number' ? s.employeeCount : people.get(s.id) ?? 0)
  const breakOf = (s: ShiftPolicy) => (s.workingHoursPerDay ? Math.max(0, span(s.startTime, s.endTime) - Math.round(s.workingHoursPerDay * 60)) : 0)
  const edit = (s: ShiftPolicy) => setDraft({ id: s.id, name: s.name, start: hhmm(s.startTime), end: hhmm(s.endTime), grace: String(s.gracePeriodMinutes ?? 0), breakMin: String(breakOf(s)) })

  const save = async () => {
    if (!draft || !companyId) return
    const prev = draft.id ? shifts.find((x) => x.id === draft.id) : undefined
    // Flexible and rotational shifts keep their type; otherwise a shift past midnight is NIGHT, the rest FIXED.
    const shiftType: ShiftPolicy['shiftType'] = prev?.shiftType === 'FLEXIBLE' || prev?.shiftType === 'ROTATIONAL' ? prev.shiftType : prev?.shiftType === 'NIGHT' || overnight(draft.start, draft.end) ? 'NIGHT' : 'FIXED'
    const breakMin = Math.max(0, Number(draft.breakMin) || 0)
    const sameHours = !!prev && hhmm(prev.startTime) === draft.start && hhmm(prev.endTime) === draft.end && breakOf(prev) === breakMin
    const hours = sameHours ? prev!.workingHoursPerDay ?? undefined : Math.min(24, Math.max(0.5, Math.round(((span(draft.start, draft.end) - breakMin) / 60) * 100) / 100))
    const body = {
      name: draft.name.trim(), shiftType, startTime: `${draft.start}:00`, endTime: `${draft.end}:00`,
      gracePeriodMinutes: Math.max(0, Math.min(120, Math.round(Number(draft.grace)) || 0)), ...(hours != null ? { workingHoursPerDay: hours } : {}),
    }
    try {
      if (draft.id) await update.mutateAsync({ id: draft.id, companyId, data: body })
      else await create.mutateAsync({ companyId, data: body })
      toast.success(draft.id ? `${body.name} shift updated` : `${body.name} shift added`)
      setDraft(null)
    } catch (e) {
      toast.error('Couldn’t save the shift', { detail: errorText(e, 'Try again in a moment.') })
    }
  }
  const doDelete = async () => {
    if (!confirm) return
    try {
      await remove.mutateAsync({ id: confirm.id, companyId })
      toast.success(`${confirm.name} deleted`)
      setConfirm(null)
    } catch (e) {
      toast.error('Couldn’t delete the shift', { detail: errorText(e, 'Try again in a moment.') })
    }
  }

  const columns: TableColumn<ShiftPolicy>[] = [
    {
      key: 'name', header: 'Shift', primary: true, render: (s) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
          <Avatar name={s.name} size={32} />
          <span style={{ display: 'grid' }}>
            <span style={{ fontWeight: 500 }}>{s.name}</span>
            <span className="apl-muted" style={{ fontSize: 12.5 }}>{[s.code, overnight(s.startTime, s.endTime) ? 'Goes past midnight' : null].filter(Boolean).join(' · ') || `${hm(span(s.startTime, s.endTime))} a day`}</span>
          </span>
        </span>
      ),
    },
    { key: 'timing', header: 'Timing', render: (s) => <span className="apl-num">{timeRange(s.startTime, s.endTime)}</span> },
    { key: 'grace', header: 'Grace', render: (s) => <span className="apl-num">{`${s.gracePeriodMinutes ?? 0} min`}</span> },
    { key: 'offs', header: 'Weekly offs', render: (s) => weeklyOffLabel(s.weeklyOffDays) ?? <span className="apl-muted">Company’s</span> },
    { key: 'people', header: 'People', numeric: true, render: (s) => <span className="apl-num">{peopleOn(s)}</span> },
    {
      key: 'actions', header: <span className="uk-sr">Actions</span>, label: 'Actions', align: 'right', render: (s) => (
        <CellActions>
          <Button variant="secondary" size={30} onClick={() => onSeePeople(s.id)}>People</Button>
          {canEdit && <Button variant="secondary" size={30} onClick={() => edit(s)}>Edit</Button>}
          {canEdit && <Button variant="ghost" size={30} onClick={() => setConfirm(s)} aria-label={`Delete ${s.name}`}>Delete</Button>}
        </CellActions>
      ),
    },
  ]

  const valid = !!draft && !!draft.name.trim() && !!draft.start && !!draft.end && draft.start !== draft.end
  const ov = draft ? overnight(draft.start, draft.end) : false
  const blockedPeople = confirm ? peopleOn(confirm) : 0
  return (
    <>
      <Section title="Shifts" body="flush" count={shifts.length || undefined} countLabel="shifts"
        actions={noShift > 0 ? <SectionLink size="sm" arrow label={`${noShift} ${noShift === 1 ? 'person has' : 'people have'} no shift yet`} onClick={() => onSeePeople('none')} /> : undefined}
        error={error} onRetry={onRetry}>
        <Table label="Shifts" columns={columns} rows={shifts} rowKey={(s) => s.id} loading={loading} mobile="cards"
          empty={(
            <div style={{ display: 'grid', gap: 10, justifyItems: 'center', padding: '24px 12px', textAlign: 'center' }}>
              <strong style={{ fontWeight: 500 }}>No shifts yet</strong>
              <span className="apl-muted">Add a shift so lateness and overtime can be measured.</span>
              {canEdit && <Button icon="plus" onClick={openNew}>Add shift</Button>}
            </div>
          )} />
      </Section>

      <SidePanel open={!!draft} onClose={() => setDraft(null)} busy={busy}
        title={draft?.id ? `Edit ${draft.name || 'shift'}` : 'Add a shift'} sub="Work timings people are measured against for lateness and overtime."
        footer={(
          <>
            <PanelButton variant="secondary" size="lg" onClick={() => setDraft(null)} disabled={busy}>Cancel</PanelButton>
            <PanelButton variant="primary" size="lg" busy={busy} blockedReason={valid ? null : draft && draft.start === draft.end ? 'The start and end can’t be the same' : 'Give the shift a name'} onClick={save}>
              {draft?.id ? 'Save changes' : 'Add shift'}
            </PanelButton>
          </>
        )}>
        {draft && (
          <div className="apl-form">
            <Input label="Name" required placeholder="e.g. Early morning" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            <FieldGrid columns={2}>
              <Input label="Starts" type="time" required value={draft.start} onChange={(e) => setDraft({ ...draft, start: e.target.value })} />
              <Input label="Ends" type="time" required value={draft.end} onChange={(e) => setDraft({ ...draft, end: e.target.value })}
                hint={ov ? 'Ends the next day' : undefined} error={draft.start && draft.start === draft.end ? 'The start and end can’t be the same' : undefined} />
              <Input label="Grace (minutes)" type="number" min={0} max={120} value={draft.grace} onChange={(e) => setDraft({ ...draft, grace: e.target.value })}
                hint="How late someone can be before they’re marked late." />
              <Input label="Break (minutes)" type="number" min={0} max={240} value={draft.breakMin} onChange={(e) => setDraft({ ...draft, breakMin: e.target.value })}
                hint="Not counted as working time." />
            </FieldGrid>
            {draft.start && draft.end && draft.start !== draft.end && (
              <p className="apl-note">
                {`${timeRange(draft.start, draft.end)}${ov ? ' (next day)' : ''} · ${hm(span(draft.start, draft.end))} a day. People who check in after ${addMin(draft.start, Number(draft.grace) || 0)} are marked late.`}
              </p>
            )}
          </div>
        )}
      </SidePanel>

      <Dialog open={!!confirm} onClose={() => setConfirm(null)} busy={remove.isPending} tone="danger" icon="trash"
        title={blockedPeople > 0 ? `${confirm?.name} is still in use` : `Delete ${confirm?.name}?`}
        sub={blockedPeople > 0
          ? `${blockedPeople === 1 ? '1 person is' : `${blockedPeople} people are`} on this shift. Move them to another shift on the Roster first.`
          : 'It disappears from the shift lists. People’s past days keep it.'}
        footer={blockedPeople > 0 ? (
          <>
            <PanelButton variant="secondary" onClick={() => setConfirm(null)}>Close</PanelButton>
            <PanelButton variant="primary" onClick={() => { const s = confirm; setConfirm(null); if (s) onSeePeople(s.id) }}>See who</PanelButton>
          </>
        ) : (
          <>
            <PanelButton variant="secondary" onClick={() => setConfirm(null)} disabled={remove.isPending}>Cancel</PanelButton>
            <PanelButton variant="danger" busy={remove.isPending} onClick={doDelete}>Delete shift</PanelButton>
          </>
        )} />
    </>
  )
}
