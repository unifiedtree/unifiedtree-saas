// Scheduled reports on the Reports center (prototype PgReports "Scheduled
// reports"): a report sent by email as a PDF and its rows as a CSV, every day,
// every weekday, every week or every month, at a chosen hour, to workspace
// members who can open it themselves. The switch pauses and resumes; Send now,
// Edit and Delete stay in each row's menu. Everything is saved to
// /v1/reports/schedules (hrms.report.schedule.manage). Daily, weekday and the
// send hour appear only once the server offers them (V143_62).
import { useEffect, useMemo, useState } from 'react'
import { Button, Callout, EmptyState, ErrorState, Section, SkeletonList, StatusPill, type StatusTone } from '@/design/kit/display'

import { Dialog, Menu, PanelButton, Select, SidePanel, Toggle } from '@/design/kit/overlays'
import {
  useDeleteSchedule, useReportSchedules, useSaveSchedule, useScheduleOptions, useScheduleRecipients, useSendScheduleNow,
  type ReportSchedule, type ScheduleFrequency, type ScheduleInput,
} from '@/modules/hrms/api/useReportExports'
import { useReportToast } from './ReportKit'
import { FIRST_RUN, WEEKDAYS, hh, ordinal, scheduleWhen } from './reportModel'
import type { useReportCompany } from './useReportCompany'

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const day = (iso: string) => { const [y, m, d] = iso.slice(0, 10).split('-').map(Number); return `${d} ${MON[m - 1]} ${y}` }
const COVERS: Record<ScheduleFrequency, string> = {
  DAILY: 'the day before', WEEKDAYS: 'the days since the previous weekday (Monday’s covers Friday to Sunday)',
  WEEKLY: 'the seven days before it', MONTHLY: 'the previous month',
}
const FREQ_LABEL: Record<ScheduleFrequency, string> = { DAILY: 'Every day', WEEKDAYS: 'Every weekday (Mon–Fri)', WEEKLY: 'Every week', MONTHLY: 'Every month' }
const STATUS: Record<string, { tone: StatusTone; label: string }> = {
  SENT: { tone: 'success', label: 'Sent' }, PARTIAL: { tone: 'warning', label: 'Partly sent' }, FAILED: { tone: 'danger', label: 'Failed' }, SKIPPED: { tone: 'neutral', label: 'Not sent' },
}
const errText = (e: unknown) => (e instanceof Error && e.message) || 'Please try again.'
const MailIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM22 6l-10 7L2 6" />
  </svg>
)

export interface SchedulableReport { key: string; label: string }

export function ScheduledEmails({ co, reports, id }: { co: ReturnType<typeof useReportCompany>; reports: SchedulableReport[]; id?: string }) {
  const list = useReportSchedules(true)
  const del = useDeleteSchedule(), send = useSendScheduleNow(), save = useSaveSchedule()
  const { show } = useReportToast()
  const [editing, setEditing] = useState<ReportSchedule | 'new' | null>(null)
  const [deleting, setDeleting] = useState<ReportSchedule | null>(null)
  const rows = list.data ?? []
  const allowed = new Set(reports.map((r) => r.key))

  const sendNow = async (s: ReportSchedule) => {
    try {
      const r = await send.mutateAsync(s.id)
      show(r.message, r.status === 'FAILED')
    } catch (e) { show(errText(e), true) }
  }
  const toggle = async (s: ReportSchedule) => {
    try {
      await save.mutateAsync({ id: s.id, input: { report: s.report, companyId: s.companyId, frequency: s.frequency, dayOfWeek: s.dayOfWeek, dayOfMonth: s.dayOfMonth, recipientIds: s.recipients.filter((r) => r.active).map((r) => r.id), active: !s.active, ...(s.sendHour != null ? { sendHour: s.sendHour } : {}) } })
      show(s.active ? `${s.reportLabel} email paused` : `${s.reportLabel} email turned back on`)
    } catch (e) { show(errText(e), true) }
  }
  const remove = async () => {
    if (!deleting) return
    try { await del.mutateAsync(deleting.id); setDeleting(null); show('Scheduled email deleted') } catch (e) { show(errText(e), true) }
  }

  return (
    <Section id={id} title="Scheduled reports" sub="Sent automatically by email as PDF and CSV" body="flush" rise
      actions={reports.length > 0 ? <Button variant="secondary" size={36} icon="plus" onClick={() => setEditing('new')}>Schedule</Button> : undefined}>
      {list.isLoading ? <div style={{ padding: '8px 20px 16px' }}><SkeletonList rows={2} /></div>
        : list.isError ? <ErrorState title="Couldn’t load the scheduled emails" error={list.error} onRetry={() => list.refetch()} />
          : rows.length === 0 ? (
            <EmptyState icon="calendarClock" title="No scheduled emails yet"
              hint="Send a report by email every day, weekday, week or month to people in this workspace who can open it." />
          ) : rows.map((s) => {
            const st = s.lastStatus ? STATUS[s.lastStatus] : null
            const mayEdit = allowed.has(s.report)
            const names = s.recipients.map((r) => r.name || r.email || 'Former member')
            return (
              <div key={s.id} className="rp-sched" data-schedule={s.id}>
                <span className="rp-sched__icon"><MailIcon /></span>
                <div className="rp-sched__main">
                  <div className="rp-sched__name">{s.reportLabel}</div>
                  <div className="rp-sched__to">{`${names.join(', ')} · ${names.length} ${names.length === 1 ? 'person' : 'people'}`}{s.companyName ? ` · ${s.companyName}` : ''}</div>
                </div>
                <span className="rp-sched__when">{scheduleWhen(s)}<small>{s.active ? `Next: ${day(s.nextRunOn)}` : 'Paused'}</small></span>
                <span className="rp-sched__last" title={s.lastMessage || undefined}>
                  {st ? <StatusPill tone={st.tone} size="xs">{st.label}</StatusPill> : 'Not sent yet'}
                </span>
                <span className="rp-sched__acts">
                  <button type="button" role="switch" aria-checked={s.active} aria-label={`${s.active ? 'Pause' : 'Resume'} ${s.reportLabel.toLowerCase()} email`}
                    className={`rp-switch${s.active ? ' is-on' : ''}`} disabled={!mayEdit || save.isPending} onClick={() => toggle(s)}><span /></button>
                  {mayEdit && (
                    <Menu label={`More actions for the ${s.reportLabel.toLowerCase()} email`} width={240}
                      items={[
                        { key: 'send', label: 'Send now', sub: 'The next scheduled date doesn’t change', icon: 'megaphone', onSelect: () => sendNow(s), disabled: send.isPending },
                        { key: 'edit', label: 'Edit', icon: 'pencil', onSelect: () => setEditing(s) },
                        { key: 'delete', label: 'Delete', icon: 'trash', danger: true, onSelect: () => setDeleting(s) },
                      ]}
                      trigger={({ props }) => <Button {...props} variant="ghost" size={32} icon="list" aria-label={`More actions for the ${s.reportLabel.toLowerCase()} email`} />} />
                  )}
                </span>
              </div>
            )
          })}
      {editing && <ScheduleDrawer key={editing === 'new' ? 'new' : editing.id} schedule={editing === 'new' ? null : editing} co={co} reports={reports}
        onClose={() => setEditing(null)} onSaved={(msg) => { setEditing(null); show(msg) }} />}
      <Dialog open={!!deleting} onClose={() => setDeleting(null)} title="Delete this scheduled email?" tone="danger" icon="trash" busy={del.isPending}
        footer={<><PanelButton variant="secondary" onClick={() => setDeleting(null)} disabled={del.isPending}>Cancel</PanelButton><PanelButton variant="danger" busy={del.isPending} onClick={remove}>Delete</PanelButton></>}>
        {deleting && <p className="rp-panel-copy">{`The ${deleting.reportLabel.toLowerCase()} will stop going to ${deleting.recipients.length} ${deleting.recipients.length === 1 ? 'person' : 'people'}. Emails already sent stay in their inboxes, and past sends stay in the download history.`}</p>}
      </Dialog>
    </Section>
  )
}

function ScheduleDrawer({ schedule, co, reports, onClose, onSaved }: {
  schedule: ReportSchedule | null; co: ReturnType<typeof useReportCompany>; reports: SchedulableReport[]; onClose: () => void; onSaved: (msg: string) => void
}) {
  const save = useSaveSchedule()
  const options = useScheduleOptions(true)
  const ready = options.data?.ready === true
  const frequencies: ScheduleFrequency[] = ready ? options.data!.frequencies : ['WEEKLY', 'MONTHLY']
  const first = options.data?.firstHour ?? FIRST_RUN, last = options.data?.lastHour ?? 23
  const [f, setF] = useState<ScheduleInput>(() => schedule
    ? { report: schedule.report, companyId: schedule.companyId, frequency: schedule.frequency, dayOfWeek: schedule.dayOfWeek, dayOfMonth: schedule.dayOfMonth, recipientIds: schedule.recipients.filter((r) => r.active).map((r) => r.id), active: schedule.active, sendHour: schedule.sendHour }
    : { report: reports[0]?.key || '', companyId: co.company, frequency: 'WEEKLY', dayOfWeek: 1, dayOfMonth: 1, recipientIds: [], active: true, sendHour: null })
  const [err, setErr] = useState('')
  const people = useScheduleRecipients(f.report, true)
  const eligible = useMemo(() => people.data ?? [], [people.data])
  // Switching reports keeps only the people who can open the new one.
  useEffect(() => {
    if (!people.data) return
    const ok = new Set(people.data.map((p) => p.id))
    setF((x) => (x.recipientIds.every((id) => ok.has(id)) ? x : { ...x, recipientIds: x.recipientIds.filter((id) => ok.has(id)) }))
  }, [people.data])
  const set = <K extends keyof ScheduleInput>(k: K, v: ScheduleInput[K]) => { setErr(''); setF((x) => ({ ...x, [k]: v })) }
  const togglePerson = (id: string) => set('recipientIds', f.recipientIds.includes(id) ? f.recipientIds.filter((x) => x !== id) : [...f.recipientIds, id])
  const valid = !!f.report && !!f.companyId && f.recipientIds.length > 0 && f.recipientIds.length <= 25
  const label = reports.find((r) => r.key === f.report)?.label || 'report'
  const submit = async () => {
    if (!valid || save.isPending) return
    try {
      const input: ScheduleInput = {
        ...f,
        dayOfWeek: f.frequency === 'WEEKLY' ? f.dayOfWeek || 1 : null,
        dayOfMonth: f.frequency === 'MONTHLY' ? f.dayOfMonth || 1 : null,
      }
      // The hour is only sent when the server takes it (V143_62); an old server keeps today's morning send.
      if (!ready || input.sendHour == null) delete input.sendHour
      await save.mutateAsync({ id: schedule?.id, input })
      onSaved(schedule ? 'Scheduled email saved' : 'Scheduled email set up')
    } catch (e) { setErr(errText(e)) }
  }
  const hours = Array.from({ length: Math.max(0, last - first) }, (_, i) => first + 1 + i)

  return (
    <SidePanel open onClose={onClose} title={schedule ? 'Edit scheduled email' : 'New scheduled email'} width={560} busy={save.isPending}
      sub={`The report goes as a PDF and its rows as a CSV, made fresh when it’s sent (India time).`}
      footer={<><PanelButton variant="secondary" size="lg" onClick={onClose}>Cancel</PanelButton><PanelButton size="lg" busy={save.isPending} blockedReason={valid ? null : 'Pick a report, a company and at least one person'} onClick={submit}>Save</PanelButton></>}>
      <div style={{ display: 'grid', gap: 16 }}>
        <Select label="Report" value={f.report} options={reports.map((r) => ({ value: r.key, label: r.label }))} onChange={(e) => set('report', e.target.value)} />
        <Select label="Company" value={f.companyId} options={co.options} onChange={(e) => set('companyId', e.target.value)} disabled={co.locked} placeholder={f.companyId ? undefined : 'Select company…'} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,160px),1fr))', gap: 12 }}>
          <Select label="How often" value={f.frequency} options={frequencies.map((x) => ({ value: x, label: FREQ_LABEL[x] }))} onChange={(e) => set('frequency', e.target.value as ScheduleFrequency)} />
          {f.frequency === 'WEEKLY' && <Select label="On" value={String(f.dayOfWeek || 1)} options={WEEKDAYS.map((d, i) => ({ value: String(i + 1), label: d }))} onChange={(e) => set('dayOfWeek', Number(e.target.value))} />}
          {f.frequency === 'MONTHLY' && <Select label="On day" hint="1 to 28, so every month has it" value={String(f.dayOfMonth || 1)} options={Array.from({ length: 28 }, (_, i) => ({ value: String(i + 1), label: `The ${ordinal(i + 1)}` }))} onChange={(e) => set('dayOfMonth', Number(e.target.value))} />}
          {ready && (
            <Select label="Send at" value={f.sendHour == null ? '' : String(f.sendHour)}
              options={[{ value: '', label: `${hh(first)} (first thing)` }, ...hours.map((x) => ({ value: String(x), label: hh(x) }))]}
              onChange={(e) => set('sendHour', e.target.value ? Number(e.target.value) : null)} />
          )}
        </div>
        <p className="rp-panel-copy">{`This email covers ${COVERS[f.frequency]}. Headcount is counted on the last day covered, and attrition shows the twelve months up to it.`}</p>
        <div style={{ display: 'grid', gap: 8 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontSize: 13.5, fontWeight: 500 }}>Send to</span>
            <span className="rp-note">{`${f.recipientIds.length} selected · only people who can open the ${label.toLowerCase()} are listed`}</span>
          </div>
          <div className="rp-people" role="group" aria-label="Send to">
            {people.isLoading ? <div style={{ padding: 8 }}><SkeletonList rows={2} /></div>
              : people.isError ? <p className="rp-panel-copy" style={{ padding: 12, color: 'var(--u-rdt,#B42318)' }}>{errText(people.error)}</p>
                : eligible.length === 0 ? <p className="rp-panel-copy" style={{ padding: 12 }}>Nobody in this workspace can open this report yet. Give someone its permission in Roles & permissions first.</p>
                  : eligible.map((p) => (
                    <label key={p.id} className="rp-people__row">
                      <input type="checkbox" checked={f.recipientIds.includes(p.id)} onChange={() => togglePerson(p.id)} />
                      <span style={{ flex: 1, minWidth: 0 }}><span style={{ fontWeight: 500 }}>{p.name || p.email}</span>{p.name && p.email ? <span className="rp-muted">{` · ${p.email}`}</span> : null}</span>
                    </label>
                  ))}
          </div>
        </div>
        <Toggle label="Send this email" description="Turn it off to pause the email without deleting it." checked={f.active} onChange={(v) => set('active', v)} />
        <Callout tone="amber">These emails carry your company’s people data outside this app. Only workspace members who can open this report can receive it, and anyone who loses that access is left out automatically. If the person who set it up loses access, it pauses.</Callout>
        {err && <Callout tone="danger" live>{err}</Callout>}
      </div>
    </SidePanel>
  )
}

