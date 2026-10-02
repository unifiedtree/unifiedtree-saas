// Shifts & overtime · Roster: who works which shift today, with "Since", filters per shift and "No shift yet", and
// Change / Assign shift from a start date with a note (POST /v1/shifts/employee/{id}, attendance.workforce.admin).
// The week grid and rotations are shift planning, which is on hold (DECISIONS 21), so this stays today's list.
import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiJson } from '@/core/api/client'
import { Button, CellPerson, FilterPills, Section, StatusPill, Table, errorText, type TableColumn } from '@/design/kit/display'
import { DateInput, Input, PanelButton, SidePanel, Textarea, useToast } from '@/design/kit/overlays'
import { fmtShort } from '@/design/dc/dates'
import type { ShiftPolicy } from '../../api/useShiftPolicies'
import { timeRange } from './shiftModel'

export interface RosterRow { id: string; name: string; code: string; dept: string; shift: string | null; since: string | null; joinedOn: string | null }

export function RosterView({ rows, shifts, loading, error, onRetry, canEdit, filter, onFilter, today }: {
  rows: RosterRow[]
  shifts: ShiftPolicy[]
  loading: boolean
  error: unknown
  onRetry: () => void
  canEdit: boolean
  filter: string
  onFilter: (f: string) => void
  today: string
}) {
  const toast = useToast()
  const qc = useQueryClient()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<RosterRow | null>(null)
  const [f, setF] = useState({ shift: '', date: today, note: '' })
  const byId = useMemo(() => new Map(shifts.map((s) => [s.id, s])), [shifts])
  const assign = useMutation({
    mutationFn: ({ emp, sid, from, note }: { emp: string; sid: string; from: string; note?: string }) =>
      apiJson(`/v1/shifts/employee/${emp}`, { method: 'POST', body: JSON.stringify({ shiftPolicyId: sid, effectiveFrom: from, ...(note ? { note } : {}) }) }),
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: ['team', 'schedule'] }), qc.invalidateQueries({ queryKey: ['shifts'] }),
      qc.invalidateQueries({ queryKey: ['hrms', 'attendance'] }), qc.invalidateQueries({ queryKey: ['hrms', 'shift-policies'] })]),
  })

  const has = (r: RosterRow) => !!r.shift && byId.has(r.shift)
  const noShift = rows.filter((r) => !has(r)).length
  const options = [
    { value: 'all', label: 'Everyone', count: rows.length },
    ...shifts.map((s) => ({ value: s.id, label: s.name, count: rows.filter((r) => r.shift === s.id).length })),
    ...(noShift ? [{ value: 'none', label: 'No shift yet', count: noShift }] : []),
  ]
  const active = options.some((o) => o.value === filter) ? filter : 'all'
  const shown = rows.filter((r) => (active === 'all' || (active === 'none' ? !has(r) : r.shift === active))
    && (!q.trim() || `${r.name} ${r.code} ${r.dept}`.toLowerCase().includes(q.trim().toLowerCase())))
  const fc = options.find((o) => o.value === active)?.count ?? rows.length

  const start = (r: RosterRow) => { setOpen(r); setF({ shift: '', date: today, note: '' }) }
  const cur = open && open.shift ? byId.get(open.shift) : undefined
  const pick = f.shift ? byId.get(f.shift) : undefined
  const save = async () => {
    if (!open || !f.shift || !f.date) return
    try {
      await assign.mutateAsync({ emp: open.id, sid: f.shift, from: f.date, note: f.note.trim() || undefined })
      toast.success(`${open.name} moves to ${pick?.name ?? 'the new shift'} from ${fmtShort(f.date)}`)
      setOpen(null)
    } catch (e) {
      toast.error('Couldn’t change the shift', { detail: errorText(e, 'Try again in a moment.') })
    }
  }

  const columns: TableColumn<RosterRow>[] = [
    { key: 'name', header: 'Employee', primary: true, render: (r) => <CellPerson name={r.name} sub={[r.code, r.dept].filter((x) => x && x !== '—').join(' · ') || undefined} /> },
    {
      key: 'shift', header: 'Shift', render: (r) => {
        const s = r.shift ? byId.get(r.shift) : undefined
        return s ? <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}><StatusPill tone="brand">{s.name}</StatusPill><span className="apl-num apl-muted">{timeRange(s.startTime, s.endTime)}</span></span>
          : <StatusPill tone="warning">No shift yet</StatusPill>
      },
    },
    { key: 'since', header: 'Since', render: (r) => (has(r) && r.since ? fmtShort(r.since) : !has(r) && r.joinedOn ? `Joined ${fmtShort(r.joinedOn)}` : '—') },
    ...(canEdit ? [{
      key: 'action', header: <span className="uk-sr">Actions</span>, label: 'Actions', align: 'right' as const,
      render: (r: RosterRow) => <Button variant="secondary" size={30} onClick={() => start(r)}>{has(r) ? 'Change shift' : 'Assign'}</Button>,
    }] : []),
  ]

  return (
    <>
      <FilterPills label="Shifts" size="sm" value={active} onChange={onFilter} options={options} />
      <Section title="Roster" body="flush" sub={`Showing ${shown.length} of ${fc} ${fc === 1 ? 'person' : 'people'}`} error={error} onRetry={onRetry}
        actions={<div className="apl-search"><Input type="search" leading="search" aria-label="Find a person" placeholder="Find a person" value={q} onChange={(e) => setQ(e.target.value)} /></div>}>
        <Table label="Roster" columns={columns} rows={shown} rowKey={(r) => r.id} loading={loading} mobile="cards"
          empty={rows.length ? 'No one matches.' : 'Nothing rostered. People appear here once they’re in your team.'} />
      </Section>

      <SidePanel open={!!open} onClose={() => setOpen(null)} busy={assign.isPending}
        title={open ? (cur ? `Change shift · ${open.name}` : `Assign a shift · ${open.name}`) : ''}
        sub={open ? (cur ? `Right now: ${cur.name}, ${timeRange(cur.startTime, cur.endTime)}${open.since ? ` (since ${fmtShort(open.since)})` : ''}` : 'Right now: no shift yet') : undefined}
        footer={(
          <>
            <PanelButton variant="secondary" size="lg" onClick={() => setOpen(null)} disabled={assign.isPending}>Cancel</PanelButton>
            <PanelButton variant="primary" size="lg" busy={assign.isPending} blockedReason={!f.shift ? 'Pick a shift first' : !f.date ? 'Choose the start date' : null} onClick={save}>
              {cur ? 'Save change' : 'Assign shift'}
            </PanelButton>
          </>
        )}>
        {open && (
          <div className="apl-form">
            <div className="apl-pick" role="group" aria-label="New shift">
              {shifts.map((s) => {
                const isCur = cur?.id === s.id
                return (
                  <button key={s.id} type="button" className="apl-pick__opt" aria-pressed={f.shift === s.id} disabled={isCur} onClick={() => setF({ ...f, shift: s.id })}>
                    <span><b style={{ fontWeight: 500 }}>{s.name}</b> <span className="apl-muted apl-num">{timeRange(s.startTime, s.endTime)}</span></span>
                    {isCur && <StatusPill tone="mint">Current</StatusPill>}
                  </button>
                )
              })}
            </div>
            <DateInput label="Starts on" required min={today} value={f.date} onChange={(_e, v) => setF({ ...f, date: v })}
              hint={pick ? `${open.name.split(' ')[0]} starts ${pick.name} on ${fmtShort(f.date)}.` : 'Pick a shift above first.'} />
            <Textarea label="Note (optional)" maxLength={500} rows={3} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })}
              hint="Kept with the change and shown in their shift history." />
          </div>
        )}
      </SidePanel>
    </>
  )
}
