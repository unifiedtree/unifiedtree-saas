// Scheduled report emails on the Reports Center: a report sent as a PDF every
// week or month to workspace members who can open it themselves. Built from
// the existing parts: the Reports Center's section card and table, HrDrawer,
// HrSelect, HrButton, HrStatusPill, the kit's Note and the settings toggle row.
// Everything is saved to /v1/reports/schedules (hrms.report.schedule.manage).
import { useEffect, useMemo, useState } from 'react'
import { Field } from '@unifiedtree/ui-kit'
import { HrButton, HrDrawer, HrSelect, HrStatusPill } from '@/shared/components/hr'
import { EmptyState } from '@/shared/components/EmptyState'
import { SkeletonRow } from '@/shared/components/SkeletonCard'
import { useConfirmDialog } from '@/shared/components/ConfirmDialog'
import { Note } from '@/design/module/ModuleKit'
import { SettingsToggleRow } from '@/design/settings/SettingsKit'
import {
  useDeleteSchedule, useReportSchedules, useSaveSchedule, useScheduleRecipients, useSendScheduleNow,
  type ReportSchedule, type ScheduleInput,
} from '@/modules/hrms/api/useReportExports'
import { Ico, SECTION, useReportToast } from './ReportKit'
import type { useReportCompany } from './useReportCompany'

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const day = (iso: string) => { const [y, m, d] = iso.slice(0, 10).split('-').map(Number); return `${d} ${MON[m - 1]} ${y}` }
const when = (s: Pick<ReportSchedule, 'frequency' | 'dayOfWeek' | 'dayOfMonth'>) =>
  s.frequency === 'WEEKLY' ? `Every ${WEEKDAYS[(s.dayOfWeek || 1) - 1]}` : `Monthly, on the ${ordinal(s.dayOfMonth || 1)}`
const covers = (f: 'WEEKLY' | 'MONTHLY') => (f === 'WEEKLY' ? 'the seven days before it' : 'the previous month')
const STATUS: Record<string, { tone: 'green' | 'orange' | 'red' | 'gray'; label: string }> = {
  SENT: { tone: 'green', label: 'Sent' }, PARTIAL: { tone: 'orange', label: 'Partly sent' }, FAILED: { tone: 'red', label: 'Failed' }, SKIPPED: { tone: 'gray', label: 'Not sent' },
}
const MAIL = 'M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2zM22 6l-10 7L2 6'
const errText = (e: unknown) => (e instanceof Error && e.message) || 'Please try again.'
const cell = { padding: '10px', borderBottom: '1px solid #f8fafc', verticalAlign: 'top' } as const

export interface SchedulableReport { key: string; label: string }

export function ScheduledEmails({ co, reports }: { co: ReturnType<typeof useReportCompany>; reports: SchedulableReport[] }) {
  const list = useReportSchedules(true)
  const del = useDeleteSchedule(), send = useSendScheduleNow(), save = useSaveSchedule()
  const confirm = useConfirmDialog()
  const { show, node } = useReportToast()
  const [editing, setEditing] = useState<ReportSchedule | 'new' | null>(null)
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
      await save.mutateAsync({ id: s.id, input: { report: s.report, companyId: s.companyId, frequency: s.frequency, dayOfWeek: s.dayOfWeek, dayOfMonth: s.dayOfMonth, recipientIds: s.recipients.filter((r) => r.active).map((r) => r.id), active: !s.active } })
      show(s.active ? 'Email paused' : 'Email turned back on')
    } catch (e) { show(errText(e), true) }
  }
  const remove = async (s: ReportSchedule) => {
    const ok = await confirm({ title: 'Delete this scheduled email?', body: `The ${s.reportLabel.toLowerCase()} will stop going to ${s.recipients.length} ${s.recipients.length === 1 ? 'person' : 'people'}. Emails already sent stay in their inboxes, and past sends stay in the download history.`, confirmLabel: 'Delete', tone: 'danger' })
    if (!ok) return
    try { await del.mutateAsync(s.id); show('Scheduled email deleted') } catch (e) { show(errText(e), true) }
  }

  return (
    <section style={SECTION}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 12px', marginBottom: 10 }}>
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Scheduled emails</h2>
        <span style={{ fontSize: 12.5, color: '#64748b', fontWeight: 500 }}>A report as a PDF, every week or month</span>
        <span style={{ flex: 1 }} />
        {reports.length > 0 && <HrButton size="sm" onClick={() => setEditing('new')}><Ico d="M12 5v14M5 12h14" size={14} width={2.4} />New scheduled email</HrButton>}
      </div>
      {list.isLoading ? <div>{[1, 2].map((x) => <SkeletonRow key={x} />)}</div>
        : list.isError ? (
          <div role="alert" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, padding: '6px 2px' }}>
            <span style={{ flex: '1 1 240px', fontSize: 13, color: '#64748b' }}>Couldn’t load the scheduled emails. {errText(list.error)}</span>
            <HrButton variant="ghost" size="sm" onClick={() => list.refetch()}>Try again</HrButton>
          </div>
        )
          : rows.length === 0 ? (
            <EmptyState icon={((p: { size?: number }) => Ico({ d: MAIL, size: p.size })) as any} title="No scheduled emails yet"
              description="Send a report as a PDF every week or month to people in this workspace who can open it. It goes out in the morning, India time." />
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 760 }}>
                <thead><tr style={{ textAlign: 'left', color: '#64748b', fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '.05em' }}>{['Report', 'Sent to', 'When', 'Last sent', ''].map((hd) => <th key={hd} style={{ padding: '8px 10px', fontWeight: 700, borderBottom: '1px solid #f1f5f9' }}>{hd}</th>)}</tr></thead>
                <tbody>
                  {rows.map((s) => {
                    const st = s.lastStatus ? STATUS[s.lastStatus] : null
                    const mayEdit = allowed.has(s.report)
                    return (
                      <tr key={s.id} style={{ opacity: s.active ? 1 : 0.7 }}>
                        <td style={cell}>
                          <div style={{ fontWeight: 700 }}>{s.reportLabel}</div>
                          <div style={{ fontSize: 12, color: '#64748b' }}>{s.companyName || '—'}{s.createdByName ? ` · set up by ${s.createdByName}` : ''}</div>
                        </td>
                        <td style={{ ...cell, color: '#475569', maxWidth: 260 }}>{s.recipients.map((r) => r.name || r.email || 'Former member').join(', ')}</td>
                        <td style={{ ...cell, whiteSpace: 'nowrap' }}>
                          <div>{when(s)}</div>
                          <div style={{ fontSize: 12, color: '#64748b' }}>{s.active ? `Next: ${day(s.nextRunOn)}` : 'Paused'}</div>
                        </td>
                        <td style={{ ...cell, maxWidth: 280 }}>
                          {st ? <><HrStatusPill tone={st.tone}>{st.label}</HrStatusPill><div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>{s.lastMessage}</div></> : <span style={{ color: '#94a3b8' }}>Not sent yet</span>}
                        </td>
                        <td style={{ ...cell, whiteSpace: 'nowrap', textAlign: 'right' }}>
                          {mayEdit && <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                            <HrButton variant="ghost" size="sm" disabled={send.isPending} onClick={() => sendNow(s)} title="Sends it now to the people on it who can still open the report. The next scheduled date doesn’t change.">Send now</HrButton>
                            <HrButton variant="ghost" size="sm" onClick={() => setEditing(s)}>Edit</HrButton>
                            <HrButton variant="ghost" size="sm" disabled={save.isPending} onClick={() => toggle(s)}>{s.active ? 'Pause' : 'Resume'}</HrButton>
                            <HrButton variant="ghost" size="sm" disabled={del.isPending} onClick={() => remove(s)}>Delete</HrButton>
                          </span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
      {editing && <ScheduleDrawer key={editing === 'new' ? 'new' : editing.id} schedule={editing === 'new' ? null : editing} co={co} reports={reports}
        onClose={() => setEditing(null)} onSaved={(msg) => { setEditing(null); show(msg) }} />}
      {node}
    </section>
  )
}

function ScheduleDrawer({ schedule, co, reports, onClose, onSaved }: {
  schedule: ReportSchedule | null; co: ReturnType<typeof useReportCompany>; reports: SchedulableReport[]; onClose: () => void; onSaved: (msg: string) => void
}) {
  const save = useSaveSchedule()
  const [f, setF] = useState<ScheduleInput>(() => schedule
    ? { report: schedule.report, companyId: schedule.companyId, frequency: schedule.frequency, dayOfWeek: schedule.dayOfWeek, dayOfMonth: schedule.dayOfMonth, recipientIds: schedule.recipients.filter((r) => r.active).map((r) => r.id), active: schedule.active }
    : { report: reports[0]?.key || '', companyId: co.company, frequency: 'WEEKLY', dayOfWeek: 1, dayOfMonth: 1, recipientIds: [], active: true })
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
      await save.mutateAsync({ id: schedule?.id, input: { ...f, dayOfWeek: f.frequency === 'WEEKLY' ? f.dayOfWeek || 1 : null, dayOfMonth: f.frequency === 'MONTHLY' ? f.dayOfMonth || 1 : null } })
      onSaved(schedule ? 'Scheduled email saved' : 'Scheduled email set up')
    } catch (e) { setErr(errText(e)) }
  }

  return (
    <HrDrawer title={schedule ? 'Edit scheduled email' : 'New scheduled email'} onClose={onClose} width="max-w-xl"
      footer={<><HrButton variant="ghost" onClick={onClose}>Cancel</HrButton><HrButton onClick={submit} disabled={!valid || save.isPending}>{save.isPending ? 'Saving…' : 'Save'}</HrButton></>}>
      <div style={{ display: 'grid', gap: 16 }}>
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: '#475569' }}>
          The report is attached as a PDF, made fresh on the day it goes out (in the morning, India time). A weekly email covers {covers('WEEKLY')}; a monthly email covers {covers('MONTHLY')}. Headcount is counted on the last day covered, and attrition shows the twelve months up to it.
        </p>
        <Field label="Report"><HrSelect value={f.report} options={reports.map((r) => ({ value: r.key, label: r.label }))} onChange={(v) => set('report', v)} /></Field>
        <Field label="Company"><HrSelect value={f.companyId} options={co.options} onChange={(v) => set('companyId', v)} disabled={co.locked} placeholder="Select company…" /></Field>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,180px),1fr))', gap: 12 }}>
          <Field label="How often"><HrSelect value={f.frequency} options={[{ value: 'WEEKLY', label: 'Every week' }, { value: 'MONTHLY', label: 'Every month' }]} onChange={(v) => set('frequency', v as ScheduleInput['frequency'])} /></Field>
          {f.frequency === 'WEEKLY'
            ? <Field label="On"><HrSelect value={String(f.dayOfWeek || 1)} options={WEEKDAYS.map((d, i) => ({ value: String(i + 1), label: d }))} onChange={(v) => set('dayOfWeek', Number(v))} /></Field>
            : <Field label="On day" hint="1 to 28, so every month has it"><HrSelect value={String(f.dayOfMonth || 1)} options={Array.from({ length: 28 }, (_, i) => ({ value: String(i + 1), label: `The ${ordinal(i + 1)}` }))} onChange={(v) => set('dayOfMonth', Number(v))} /></Field>}
        </div>
        <div style={{ display: 'grid', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontSize: 13.5, fontWeight: 600, color: '#0f172a' }}>Send to</span>
            <span style={{ fontSize: 12.5, color: '#64748b' }}>{`${f.recipientIds.length} selected · only people who can open the ${label.toLowerCase()} are listed`}</span>
          </div>
          <div style={{ border: '1px solid #e2e8f0', borderRadius: 12, maxHeight: 260, overflowY: 'auto' }}>
            {people.isLoading ? <div style={{ padding: 8 }}><SkeletonRow /></div>
              : people.isError ? <p style={{ margin: 0, padding: 12, fontSize: 13, color: '#b91c1c' }}>{errText(people.error)}</p>
                : eligible.length === 0 ? <p style={{ margin: 0, padding: 12, fontSize: 13, color: '#64748b' }}>Nobody in this workspace can open this report yet. Give someone its permission in Roles & permissions first.</p>
                  : eligible.map((p) => (
                    <label key={p.id} className="ut-row-hover" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderBottom: '1px solid #f1f5f9', cursor: 'pointer', fontSize: 13 }}>
                      <input type="checkbox" checked={f.recipientIds.includes(p.id)} onChange={() => togglePerson(p.id)} />
                      <span style={{ flex: 1, minWidth: 0 }}><b style={{ fontWeight: 600 }}>{p.name || p.email}</b>{p.name && p.email ? <span style={{ color: '#64748b' }}>{` · ${p.email}`}</span> : null}</span>
                    </label>
                  ))}
          </div>
        </div>
        <SettingsToggleRow label="Send this email" detail="Turn it off to pause the email without deleting it." on={f.active} onToggle={() => set('active', !f.active)} />
        <Note tone="amber">These emails carry your company’s people data outside this app. Only workspace members who can open this report can receive it, and anyone who loses that access is left out automatically. If the person who set it up loses access, it pauses.</Note>
        {err && <Note tone="red">{err}</Note>}
      </div>
    </HrDrawer>
  )
}
