// Daily time entries (/v1/ess/timesheets): what someone worked on, in
// minutes. They don't change attendance punches or payroll. Module kit style.
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { usePermission } from '@unifiedtree/sdk'
import { Field, Input } from '@unifiedtree/ui-kit'
import { apiJson } from '@/core/api/client'
import { HrButton } from '@/shared/components/hr'
import { DateField } from '@/shared/components/calendar'
import { Panel, State, Note, RowList, Row, useDesignToast, todayIso } from '@/design/module/ModuleKit'

interface Entry { id: string; workDate: string; description: string; minutes: number }
const hm = (n: number) => (n >= 60 ? `${Math.floor(n / 60)}h${n % 60 ? ` ${n % 60}m` : ''}` : `${n}m`)

export function TimeEntries() {
  const allowed = usePermission('attendance.checkin.self')
  const qc = useQueryClient()
  const { show, node } = useDesignToast()
  const [date, setDate] = useState(todayIso())
  const [description, setDescription] = useState('')
  const [minutes, setMinutes] = useState(60)
  const [editing, setEditing] = useState('')
  const [deleting, setDeleting] = useState('')
  const entries = useQuery({ queryKey: ['ess', 'time-entries', date], queryFn: () => apiJson<Entry[]>(`/v1/ess/timesheets?from=${date}&to=${date}`), enabled: allowed && !!date })
  const change = useMutation({
    mutationFn: ({ id, remove = false }: { id?: string; remove?: boolean }) => apiJson(`/v1/ess/timesheets${id ? `/${id}` : ''}`, { method: remove ? 'DELETE' : id ? 'PUT' : 'POST', ...(!remove ? { body: JSON.stringify({ workDate: date, description: description.trim(), minutes }) } : {}) }),
    onSuccess: (_d, v) => { qc.invalidateQueries({ queryKey: ['ess', 'time-entries'] }); show(v.remove ? 'Time entry deleted' : v.id ? 'Time entry saved' : 'Time entry added'); setEditing(''); setDeleting(''); setDescription(''); setMinutes(60) },
    onError: (e: Error) => show('Couldn’t save the time entry', true, e.message),
  })
  if (!allowed) return null
  const list = entries.data ?? [], total = list.reduce((s, e) => s + e.minutes, 0)
  const bad = !description.trim() || minutes < 1 || minutes > 1440
  return (
    <Panel title="Daily time entries" sub="What you worked on. These don’t change your attendance or pay." aside={
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12.5, fontWeight: 600, color: '#64748b' }}>Day
        <DateField aria-label="Time entry date" max={todayIso()} value={date} onChange={(e) => { if (e.target.value) { setDate(e.target.value); setEditing(''); setDeleting(''); setDescription('') } }}
          size="sm" format="short" style={{ width: 150 }} />
      </label>}>
      {entries.isLoading ? <State kind="loading" height={60} />
        : entries.isError ? <State kind="error" title="Couldn’t load your time entries" description={(entries.error as Error)?.message} onRetry={() => entries.refetch()} />
          : list.length === 0 ? <Note>Nothing recorded for this day yet.</Note>
            : (
              <RowList>
                {list.map((e) => (
                  <Row key={e.id} title={e.description} meta={hm(e.minutes)}
                    trail={deleting === e.id
                      ? <><span style={{ fontSize: 12.5, color: '#b91c1c', fontWeight: 600 }}>Delete this entry?</span><HrButton size="sm" variant="danger" disabled={change.isPending} onClick={() => change.mutate({ id: e.id, remove: true })}>Delete</HrButton><HrButton size="sm" variant="ghost" onClick={() => setDeleting('')}>Keep</HrButton></>
                      : <><HrButton size="sm" variant="ghost" disabled={change.isPending} onClick={() => { setEditing(e.id); setDescription(e.description); setMinutes(e.minutes) }}>Edit</HrButton><HrButton size="sm" variant="ghost" disabled={change.isPending} onClick={() => setDeleting(e.id)}>Delete</HrButton></>} />
                ))}
                <div style={{ padding: '10px 16px', fontSize: 12.5, fontWeight: 700, color: '#0f6e56' }}>Total {hm(total)}</div>
              </RowList>
            )}
      <form onSubmit={(e) => { e.preventDefault(); if (!bad) change.mutate({ id: editing || undefined }) }} style={{ display: 'grid', gap: 12, paddingTop: 4, borderTop: '1px solid #f1f5f9' }}>
        <label style={{ display: 'grid', gap: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#334155' }}>{editing ? 'Edit entry' : 'What did you work on?'}</span>
          <textarea aria-label="Work description" required maxLength={1000} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Month-end reconciliation for Sales"
            style={{ font: 'inherit', fontSize: 14, padding: '9px 12px', border: '1px solid #cbd5e1', borderRadius: 10, outline: 'none', resize: 'vertical' }} />
        </label>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 10 }}>
          <div style={{ width: 160 }}><Field label="Minutes"><Input aria-label="Time entry minutes" type="number" min={1} max={1440} value={String(minutes)} onChange={(e: any) => setMinutes(Number(e.target.value))} /></Field></div>
          <HrButton type="submit" disabled={change.isPending || bad}>{editing ? 'Save entry' : 'Add entry'}</HrButton>
          {editing && <HrButton variant="ghost" onClick={() => { setEditing(''); setDescription(''); setMinutes(60) }}>Cancel</HrButton>}
        </div>
      </form>
      {node}
    </Panel>
  )
}
