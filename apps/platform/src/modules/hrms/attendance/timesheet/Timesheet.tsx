// Timesheet (EmpTime "Timesheet", BW-36): what you worked on, per project and day, a week at a time;
// Submit week sends it to your approver and locks its entries until it's decided (a rejected week
// opens again). Approvers (hrms.timesheet.approve, team scope) decide submitted weeks here too.
// Time entries never change attendance punches or pay.
//   GET/POST/PUT/DELETE /v1/ess/timesheets(?from&to | /{id})   GET /v1/ess/timesheets/projects
//   GET /v1/ess/timesheets/weeks?from&to                        POST /v1/ess/timesheets/weeks/{monday}/submit
//   GET /v1/timesheets/approvals?status=   GET /v1/timesheets/weeks/{id}/entries   POST …/{id}/decision
// Keys: ['ess','time-entries',…] (today's prefix) and ['timesheets',…] (the shared contract's).
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiJson } from '@/core/api/client'
import { isFeatureNotReady } from '@/core/api/featureNotReady'
import { Button, Callout, PageHeader, ProgressBar, Section, StatusPill, type StatusTone } from '@/design/kit/display'
import { ApprovalRow, FieldGrid, Input, PanelButton, Select, SidePanel, Textarea, useToast } from '@/design/kit/overlays'
import { fmtWd, istToday } from '@/design/dc/dates'
import { useTimesheetDecision } from '../../api/shared/useTimesheetDecision'
import type { TimesheetWeek } from '../../api/shared/contracts'
import { useMyDay } from '../webpunch/useMyDay'
import type { DailyPerms } from '../daily/DailyTracking'
import { hours, mondayOf, shiftWeek, submitBlocker, weekDays, weekGrid, weekLabel, type TimeEntry } from './week'
import { RangeFilter, useRangeParam } from '@/design/kit/RangeFilter'
import { overlapsRange, wholeList } from '@/design/kit/rangeFilterModel'

interface Project { id: string; name: string; code: string | null }
const WEEK_STATE: Record<string, { label: string; tone: StatusTone }> = {
  SUBMITTED: { label: 'Waiting for approval', tone: 'amber' }, APPROVED: { label: 'Approved', tone: 'success' }, REJECTED: { label: 'Sent back', tone: 'danger' },
}
const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export function Timesheet({ perms }: { perms: DailyPerms }) {
  const mine = perms.self && perms.personalPages
  return (
    <>
      <PageHeader title="Timesheet" sub={mine ? 'What you worked on this week, by project. It doesn’t change your attendance or pay.' : 'Timesheets your team sent for approval.'} />
      {mine && <MyWeek />}
      {perms.timesheetApprove && <Approvals />}
    </>
  )
}

function MyWeek() {
  const qc = useQueryClient()
  const toast = useToast()
  const today = istToday()
  const [monday, setMonday] = useState(mondayOf(today))
  const [edit, setEdit] = useState<Partial<TimeEntry> | null>(null)
  const days = weekDays(monday)
  const from = days[0], to = days[6]
  const entries = useQuery({
    queryKey: ['ess', 'time-entries', from, to],
    queryFn: () => apiJson<TimeEntry[]>(`/v1/ess/timesheets?from=${from}&to=${to}`),
  })
  const weeks = useQuery({
    queryKey: ['timesheets', 'weeks', 'mine', from],
    queryFn: () => apiJson<TimesheetWeek[]>(`/v1/ess/timesheets/weeks?from=${from}&to=${to}`),
    retry: false,
  })
  const myDay = useMyDay()
  const week = (weeks.data ?? []).find((w) => w.weekStart === monday) || null
  const list = useMemo(() => (entries.data ?? []).map((e) => ({ ...e, workDate: String(e.workDate).slice(0, 10) })), [entries.data])
  const weekend = list.some((e) => e.workDate >= days[5])
  const shown = weekend ? days : days.slice(0, 5)
  const g = weekGrid(list, shown)
  const aim = myDay.data?.shift?.workingHours ? Math.round(myDay.data.shift.workingHours * 60) : null
  const locked = list.some((e) => e.locked) || week?.status === 'SUBMITTED' || week?.status === 'APPROVED'
  const blocker = submitBlocker(monday, today, g.total, week?.status ?? null)
  const submit = useMutation({
    mutationFn: () => apiJson<TimesheetWeek>(`/v1/ess/timesheets/weeks/${monday}/submit`, { method: 'POST', body: '{}' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['timesheets'] }); qc.invalidateQueries({ queryKey: ['ess', 'time-entries'] })
      toast.success('Week sent for approval. Its entries are locked until it’s decided.')
    },
    onError: (e) => toast.error(isFeatureNotReady(e) ? 'Submitting weeks isn’t switched on yet.' : 'Couldn’t submit the week', { detail: isFeatureNotReady(e) ? undefined : (e as Error)?.message }),
  })
  const weeksReady = !(weeks.isError && isFeatureNotReady(weeks.error))

  return (
    <>
      <Section variant="section" body="flush"
        title={`${monday === mondayOf(today) ? 'This week' : 'Week'} · ${weekLabel(days, weekend)}`}
        sub={<>{`${hours(g.total) === '—' ? '0h' : hours(g.total)} logged`}{aim ? ` · aim for ${hours(aim)} a day` : ''}{week ? <> · <StatusPill tone={WEEK_STATE[week.status].tone} size="xs">{WEEK_STATE[week.status].label}</StatusPill></> : null}</>}
        actions={
          <span className="udt-filters">
            <Button size={32} icon="chevronLeft" aria-label="Previous week" onClick={() => setMonday(shiftWeek(monday, -1))} />
            <Button size={32} icon="chevronRight" aria-label="Next week" disabled={monday >= mondayOf(today)} onClick={() => setMonday(shiftWeek(monday, 1))} />
            <Button size={36} disabled={locked} title={locked ? 'This week is locked while it’s waiting or approved' : undefined} onClick={() => setEdit({ workDate: today < to ? (today >= from ? today : from) : to, minutes: 60 })}>Add time</Button>
            {weeksReady && (
              <Button size={36} variant="primary" loading={submit.isPending} disabled={!!blocker} title={blocker ?? undefined} onClick={() => submit.mutate()}>Submit week</Button>
            )}
          </span>
        }
        loading={entries.isLoading} skeleton="table" error={entries.isError ? entries.error : undefined} onRetry={() => void entries.refetch()}
        empty={!entries.isLoading && list.length === 0 ? { title: 'No time logged this week', hint: locked ? undefined : 'Add what you worked on with “Add time”.' } : undefined}>
        {week?.status === 'REJECTED' && week.note && <div className="udt-pad"><Callout tone="danger">{`Sent back${week.decidedByName ? ' by ' + week.decidedByName : ''}: ${week.note}. Fix the entries and submit again.`}</Callout></div>}
        <div className="udt-tswrap">
          <table className="udt-ts" aria-label="Time this week">
            <thead>
              <tr><th scope="col">Project</th>{shown.map((d, i) => <th key={d} scope="col">{WD[i]} {Number(d.slice(8, 10))}</th>)}<th scope="col" className="udt-right">Total</th></tr>
            </thead>
            <tbody>
              {g.rows.map((r) => (
                <tr key={r.key}>
                  <th scope="row"><span className="udt-two"><span>{r.name}</span>{r.code && <span className="udt-q">{r.code}</span>}</span></th>
                  {r.perDay.map((m, i) => <td key={i} className="udt-num">{hours(m)}</td>)}
                  <td className="udt-num udt-right"><b>{hours(r.total)}</b></td>
                </tr>
              ))}
              <tr className="udt-ts__day">
                <th scope="row">Each day</th>
                {g.perDay.map((m, i) => (
                  <td key={i}><span className="udt-num">{hours(m)}</span>{aim ? <ProgressBar value={Math.min(m, aim)} max={aim} height={4} /> : null}</td>
                ))}
                <td className="udt-num udt-right"><b>{hours(g.total)}</b></td>
              </tr>
            </tbody>
          </table>
        </div>
        <ul className="udt-mine" aria-label="Entries this week">
          {[...list].sort((a, b) => a.workDate.localeCompare(b.workDate)).map((e) => (
            <li key={e.id} className="udt-mine__row">
              <span className="udt-two"><span>{e.projectName || e.description || 'Work'}</span><span className="udt-q">{fmtWd(e.workDate).replace(/ \d{4}$/, '')}{e.projectName && e.description ? ` · ${e.description}` : ''}</span></span>
              <span className="udt-row-acts">
                <span className="udt-num">{hours(e.minutes)}</span>
                {!e.locked && !locked && <Button size={30} variant="ghost" onClick={() => setEdit(e)}>Edit</Button>}
              </span>
            </li>
          ))}
        </ul>
      </Section>
      {edit && <EntryPanel entry={edit} days={days} today={today} onClose={() => setEdit(null)} />}
    </>
  )
}

function EntryPanel({ entry, days, today, onClose }: { entry: Partial<TimeEntry>; days: string[]; today: string; onClose: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [workDate, setDate] = useState(entry.workDate || days[0])
  const [projectId, setProject] = useState(entry.projectId || '')
  const [description, setDescription] = useState(entry.description || '')
  const [h, setH] = useState(String(Math.floor((entry.minutes ?? 60) / 60)))
  const [m, setM] = useState(String((entry.minutes ?? 60) % 60))
  const [tried, setTried] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const projects = useQuery({ queryKey: ['timesheets', 'projects'], queryFn: () => apiJson<Project[]>('/v1/ess/timesheets/projects'), retry: false, staleTime: 300_000 })
  const minutes = (Number(h) || 0) * 60 + (Number(m) || 0)
  const problems = {
    time: minutes < 1 ? 'Enter the time you spent.' : minutes > 1440 ? 'A day has at most 24 hours.' : null,
    what: !projectId && !description.trim() ? 'Pick a project or say what you worked on.' : null,
  }
  const blocked = problems.time || problems.what
  const save = useMutation({
    mutationFn: (remove: boolean) => apiJson(`/v1/ess/timesheets${entry.id ? `/${entry.id}` : ''}`, {
      method: remove ? 'DELETE' : entry.id ? 'PUT' : 'POST',
      ...(remove ? {} : { body: JSON.stringify({ workDate, description: description.trim(), minutes, ...(projectId ? { projectId } : {}) }) }),
    }),
    onSuccess: (_d, remove) => {
      qc.invalidateQueries({ queryKey: ['ess', 'time-entries'] }); qc.invalidateQueries({ queryKey: ['timesheets'] })
      toast.success(remove ? 'Time entry deleted' : entry.id ? 'Time entry saved' : 'Time entry added')
      onClose()
    },
    onError: (e) => toast.error('Couldn’t save the time entry', { detail: (e as Error)?.message }),
  })
  const dayOptions = days.filter((d) => d <= today).map((d) => ({ value: d, label: fmtWd(d).replace(/ \d{4}$/, '') }))
  const projOptions = projects.data ?? []

  return (
    <SidePanel open onClose={onClose} title={entry.id ? 'Edit time' : 'Add time'} sub="What you worked on, and for how long." busy={save.isPending}
      footerAlign={entry.id ? 'between' : 'end'}
      footer={<>
        {entry.id && (confirmDelete
          ? <PanelButton size="lg" variant="danger" busy={save.isPending} onClick={() => save.mutate(true)}>Delete this entry</PanelButton>
          : <PanelButton size="lg" variant="ghost" onClick={() => setConfirmDelete(true)}>Delete</PanelButton>)}
        <span className="udt-panel-acts">
          <PanelButton size="lg" onClick={onClose}>Cancel</PanelButton>
          <PanelButton size="lg" variant="primary" busy={save.isPending} blockedReason={blocked} tipAlign="end" onBlockedClick={() => setTried(true)}
            onClick={() => { setTried(true); if (!blocked) save.mutate(false) }}>{entry.id ? 'Save' : 'Add time'}</PanelButton>
        </span>
      </>}>
      <FieldGrid columns={2}>
        <Select label="Day" full value={workDate} onChange={(e) => setDate(e.target.value)} options={dayOptions} />
        {projOptions.length > 0 && (
          <Select label="Project" full value={projectId} onChange={(e) => setProject(e.target.value)}
            options={[{ value: '', label: 'No project' }, ...projOptions.map((p) => ({ value: p.id, label: p.code ? `${p.name} · ${p.code}` : p.name }))]} />
        )}
        <Input label="Hours" type="number" min={0} max={24} value={h} onChange={(e) => setH(e.target.value)} />
        <Input label="Minutes" type="number" min={0} max={59} step={5} value={m} onChange={(e) => setM(e.target.value)} error={tried ? problems.time : undefined} />
        <Textarea label={projectId ? 'Notes (optional)' : 'What did you work on?'} full rows={3} maxLength={1000} value={description}
          onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Month-end reconciliation for Sales" error={tried ? problems.what : undefined} />
      </FieldGrid>
    </SidePanel>
  )
}

function Approvals() {
  const toast = useToast()
  const [open, setOpen] = useState<string | null>(null)
  const [busy, setBusy] = useState<Record<string, 'approve' | 'reject'>>({})
  const waiting = useQuery({
    queryKey: ['timesheets', 'approvals', 'SUBMITTED'],
    queryFn: () => apiJson<{ content: TimesheetWeek[]; totalElements: number }>('/v1/timesheets/approvals?status=SUBMITTED&size=50'),
    retry: false,
  })
  const entries = useQuery({
    queryKey: ['timesheets', 'week-entries', open],
    queryFn: () => apiJson<TimeEntry[]>(`/v1/timesheets/weeks/${open}/entries`),
    enabled: !!open,
  })
  const decide = useTimesheetDecision()
  const run = (w: TimesheetWeek, what: 'approve' | 'reject', note: string) => {
    if (what === 'reject' && !note.trim()) { toast.error('Add a note saying what to fix before sending it back'); return }
    setBusy((b) => ({ ...b, [w.id]: what }))
    decide.mutateAsync({ weekId: w.id, status: what === 'approve' ? 'APPROVED' : 'REJECTED', comment: note.trim() || undefined })
      .then((r) => {
        if (!r.available) toast.info('Timesheet approval isn’t switched on yet.')
        else toast.success(what === 'approve' ? `${w.employeeName}’s week approved` : `${w.employeeName}’s week sent back`)
      })
      .catch((e) => { toast.error('Couldn’t record the decision', { detail: (e as Error)?.message }); void waiting.refetch() })
      .finally(() => setBusy((b) => { const n = { ...b }; delete n[w.id]; return n }))
  }
  // The start / end calendar (?from=&to=) keeps the queue to weeks that touch those days. Up to 50 weeks come
  // at once, so the queue is kept here; a longer one says only the oldest 50 are searched.
  const [range, setRange] = useRangeParam()
  if (waiting.isError && isFeatureNotReady(waiting.error)) return null
  const all = waiting.data?.content ?? []
  const list = range ? all.filter((w) => overlapsRange(w.weekStart, weekDays(w.weekStart)[6], range)) : all
  const partial = !!range && !wholeList(all.length, waiting.data?.totalElements)
  const facts = (w: TimesheetWeek) => {
    const days = weekDays(w.weekStart)
    const base = [{ label: 'Week', value: weekLabel(days, false) }, { label: 'Logged', value: hours(w.totalMinutes) }]
    if (open !== w.id) return base
    if (entries.isLoading) return [...base, { label: 'Entries', value: 'Loading…' }]
    const g = weekGrid((entries.data ?? []).map((e) => ({ ...e, workDate: String(e.workDate).slice(0, 10) })), days)
    return [...base, ...g.rows.map((r) => ({ label: r.name, value: hours(r.total) }))]
  }
  return (
    <Section title="Waiting for approval" count={list.length || null} countTone="gold" variant="section" body="list"
      sub={partial ? `Only the first ${all.length} weeks waiting are searched.` : undefined}
      actions={all.length > 0 ? <RangeFilter value={range} onChange={setRange} label="Week dates" filterKey="timesheet-dates" align="end" /> : undefined}
      loading={waiting.isLoading} error={waiting.isError ? waiting.error : undefined} onRetry={() => void waiting.refetch()}
      empty={list.length === 0 ? (all.length ? { title: 'Nothing on these dates', hint: 'No weeks waiting touch these days.' } : { title: 'No timesheets waiting', hint: 'Weeks your team submits show here.', variant: 'success' }) : undefined}>
      <div className="udt-cards">
        {list.map((w) => (
          <ApprovalRow key={w.id} variant="card" withNote notePlaceholder="Note (needed to send it back)" name={w.employeeName} kind="Timesheet"
            title={`Week of ${fmtWd(w.weekStart).replace(/ \d{4}$/, '')} · ${hours(w.totalMinutes)}`} status="pending" busy={busy[w.id] || false}
            facts={facts(w)} onOpen={() => setOpen(open === w.id ? null : w.id)}
            onApprove={(n) => run(w, 'approve', n)} onReject={(n) => run(w, 'reject', n)} />
        ))}
      </div>
    </Section>
  )
}
