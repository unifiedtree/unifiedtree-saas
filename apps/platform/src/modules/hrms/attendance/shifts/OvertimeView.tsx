// Shifts & overtime · Overtime (prototype PgTime a-analytics tab 2 and a-shifts tab 2; AUDIT I: the design's
// analytics Overtime tab lives here). Overtime from punches and overtime people asked for, this month and anything
// still waiting from last month. The company's rules (DECISIONS 22): extra time under the minimum (1 hour unless
// changed) isn't overtime; from the minimum on, all of it counts; approvals stop at the monthly cap. The rules are
// read here and changed with attendance.policy.manage. Deciding needs attendance.overtime.approve; a rejection needs
// a note. Approved overtime is recorded, not paid.
import { useMemo, useState } from 'react'
import { ApprovalRow, Dialog, FieldGrid, Input, PanelButton, SidePanel, Textarea, Checkbox, useToast } from '@/design/kit/overlays'
import {
  Button, CellActions, CellPerson, EmptyState, FilterPills, KeyValueGrid, MiniStat, MiniStatGrid, Section, SkeletonList, StatusPill, Table, errorText,
  type TableColumn,
} from '@/design/kit/display'
import { addDays, fmtShort, fmtWd } from '@/design/dc/dates'
import { useOvertimeRules, useSaveOvertimeRules } from '../../api/shared/useOvertimeRules'
import {
  useDecideOvertime, useDecideOvertimeRequest, useOvertimeEntries, useTeamOvertimeRequests, type OvertimeEntry, type OvertimeRequest,
} from '../../api/useOvertime'
import { capLabel, counted, hm, isoDay, minimumLabel, overtimeTotals, statusOf, toMinutes } from './shiftModel'
import { MyOvertime } from './MyOvertime'

/** One row of the Overtime list, from punches or asked for. */
interface Row {
  key: string
  id: string
  source: 'punch' | 'request'
  employeeId: string
  name: string
  sub: string
  date: string
  minutes: number
  reason: string
  status: string
  note: string
  facts: { label: string; value: string }[]
}

const OT_RAISED: Record<string, string> = { EMPLOYEE: 'reason from the employee', FIX_REQUEST: 'times from an approved fix request', MANUAL_ENTRY: 'times entered by HR' }
const clock = (v?: string | number | null) => (v == null ? '—' : new Date(typeof v === 'number' ? v : v).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }))
const to12 = (t?: string | null) => { if (!t) return '—'; const [h, m] = t.split(':').map(Number); return `${h % 12 || 12}:${String(m || 0).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}` }

export function OvertimeView({ today, companyId, canTeam, canDecide, canPolicy, canSelf, who }: {
  today: string
  companyId: string
  canTeam: boolean
  canDecide: boolean
  canPolicy: boolean
  canSelf: boolean
  /** Code and department by employee id, from today's team. */
  who: (id: string) => { code: string; dept: string } | undefined
}) {
  const toast = useToast()
  const monthStart = today.slice(0, 8) + '01'
  const prevMonthStart = addDays(monthStart, -1).slice(0, 8) + '01'
  const entries = useOvertimeEntries(prevMonthStart, today, canTeam)
  const requests = useTeamOvertimeRequests(prevMonthStart, addDays(today, 30), canTeam)
  const rules = useOvertimeRules(companyId, { enabled: canTeam || canPolicy })
  const decideEntry = useDecideOvertime(), decideReq = useDecideOvertimeRequest()
  const [view, setView] = useState<'waiting' | 'month'>('waiting')
  const [busy, setBusy] = useState<Record<string, 'approve' | 'reject'>>({})
  const [rejecting, setRejecting] = useState<Row | null>(null)
  const [reason, setReason] = useState('')
  const [editing, setEditing] = useState(false)

  const rows: Row[] = useMemo(() => {
    const out: Row[] = []
    for (const o of (entries.data ?? []) as OvertimeEntry[]) {
      const iso = isoDay(o.date), p = who(o.employeeId)
      out.push({
        key: `p-${o.id}`, id: o.id, source: 'punch', employeeId: o.employeeId, name: o.employeeName, sub: p ? `${p.code} · ${p.dept}` : '',
        date: iso, minutes: counted(o), reason: o.reason || 'None given', status: o.status, note: o.note || '',
        facts: [
          { label: 'Day', value: fmtWd(iso) },
          { label: 'Shift ended', value: o.shiftEnd ? `${to12(o.shiftEnd)}${o.shiftName ? ' · ' + o.shiftName : ''}` : '—' },
          { label: 'Left at', value: clock(o.checkOutAt) },
          { label: 'Extra time', value: '+' + hm(counted(o)) },
          { label: 'Raised', value: (o.reasonSource && OT_RAISED[o.reasonSource]) || 'recorded automatically' },
        ],
      })
    }
    for (const r of (requests.data ?? []) as OvertimeRequest[]) {
      const p = who(r.employeeId)
      out.push({
        key: `r-${r.id}`, id: r.id, source: 'request', employeeId: r.employeeId, name: r.employeeName || 'Employee',
        sub: p ? `${p.code} · ${p.dept}` : r.employeeCode || '', date: r.date, minutes: r.minutes, reason: r.reason, status: r.status,
        note: r.decisionNote || '',
        facts: [{ label: 'Day', value: fmtWd(r.date) }, { label: 'Extra time', value: '+' + hm(r.minutes) }, { label: 'Asked', value: fmtShort(r.createdAt.slice(0, 10)) }],
      })
    }
    return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.name.localeCompare(b.name)))
  }, [entries.data, requests.data, who])
  const totals = useMemo(() => overtimeTotals(entries.data ?? [], requests.data ?? [], monthStart), [entries.data, requests.data, monthStart])
  const waiting = rows.filter((r) => r.status === 'PENDING')
  const month = rows.filter((r) => r.date >= monthStart && r.status !== 'CANCELLED')

  const decide = async (r: Row, approve: boolean, note: string) => {
    if (!approve && !note.trim()) { setRejecting(r); setReason(''); return }
    setBusy((b) => ({ ...b, [r.key]: approve ? 'approve' : 'reject' }))
    try {
      if (r.source === 'punch') await decideEntry.mutateAsync({ id: r.id, approve, note: note.trim() })
      else await decideReq.mutateAsync({ id: r.id, approve, note: note.trim() })
      toast.success(approve ? 'Overtime approved · recorded, not paid' : 'Overtime rejected', { detail: `${r.name.split(' ')[0]} has been told.` })
      setRejecting(null)
    } catch (e) {
      toast.error('Couldn’t record the decision', { detail: errorText(e, 'Try again in a moment.') })
      void entries.refetch(); void requests.refetch()
    } finally {
      setBusy((b) => { const n = { ...b }; delete n[r.key]; return n })
    }
  }

  const minimum = rules.data?.minimumMinutes ?? null
  const columns: TableColumn<Row>[] = [
    { key: 'name', header: 'Employee', primary: true, render: (r) => <CellPerson name={r.name} sub={r.sub || undefined} /> },
    { key: 'date', header: 'Date', render: (r) => fmtWd(r.date) },
    { key: 'extra', header: 'Extra time', render: (r) => <span className="apl-num">{hm(r.minutes)}</span> },
    { key: 'reason', header: 'Reason', render: (r) => <span>{r.source === 'request' ? `Asked for · ${r.reason}` : r.reason}</span> },
    { key: 'status', header: 'Status', render: (r) => <StatusPill tone={statusOf(r.status).tone} title={r.note || undefined}>{statusOf(r.status).label}</StatusPill> },
    ...(canDecide ? [{
      key: 'act', header: <span className="uk-sr">Actions</span>, label: 'Actions', align: 'right' as const, render: (r: Row) => (r.status === 'PENDING' ? (
        <CellActions>
          <Button variant="secondary" size={30} disabled={!!busy[r.key]} onClick={() => decide(r, false, '')}>Reject</Button>
          <Button variant="soft" size={30} loading={busy[r.key] === 'approve'} onClick={() => decide(r, true, '')}>Approve</Button>
        </CellActions>
      ) : null),
    }] : []),
  ]

  return (
    <>
      <Section title="Overtime this month" loading={entries.isLoading} skeleton="stats" error={entries.error} onRetry={() => entries.refetch()}>
        <MiniStatGrid>
          <MiniStat label="Hours logged" tone="info" countUp={false} value={hm(totals.logged)} note={`${totals.people} ${totals.people === 1 ? 'person' : 'people'}`} />
          <MiniStat label="Approved" tone="success" countUp={false} value={hm(totals.approved)} note="Recorded, not paid" />
          <MiniStat label="Waiting" tone="warning" countUp={false} value={hm(totals.waiting)} note="Needs a manager" />
        </MiniStatGrid>
      </Section>

      {!rules.notAvailable && (
        <Section title="Overtime rules" sub="When extra time counts as overtime, and how much can be approved."
          loading={rules.isLoading} skeleton="text" error={rules.error} onRetry={() => rules.refetch()}
          action={canPolicy && rules.data ? { label: 'Edit rules', icon: 'pencil', onClick: () => setEditing(true) } : undefined}>
          {rules.data && (
            <KeyValueGrid items={[
              { label: 'Minimum overtime', value: minimumLabel(rules.data.minimumMinutes, rules.data.minimumIsDefault) },
              { label: 'How it counts', value: rules.data.minimumMinutes ? `Under ${hm(rules.data.minimumMinutes)} isn’t overtime; from it, all the extra time counts` : 'Every extra minute counts' },
              { label: 'Monthly cap', value: capLabel(rules.data.monthlyCapMinutes) },
              { label: 'Needs approval from', value: 'A manager or HR who approves overtime' },
              { label: 'Paid through', value: 'Not paid: approved overtime is recorded' },
              { label: 'Last changed', value: rules.data.updatedByName ? `${rules.data.updatedByName}${rules.data.updatedAt ? ', ' + fmtShort(rules.data.updatedAt.slice(0, 10)) : ''}` : 'Never: the defaults apply' },
            ]} />
          )}
        </Section>
      )}

      <FilterPills label="Overtime views" size="sm" value={view} onChange={(v) => setView(v as 'waiting' | 'month')}
        options={[{ value: 'waiting', label: 'Waiting for you', count: waiting.length || null }, { value: 'month', label: 'This month' }]} />
      {view === 'waiting' ? (
        <Section title="Waiting for a decision" sub={minimum ? `Days under the ${hm(minimum)} minimum aren’t listed: they aren’t overtime.` : undefined}
          error={entries.error ?? requests.error} onRetry={() => { void entries.refetch(); void requests.refetch() }}>
          {entries.isLoading || requests.isLoading ? <SkeletonList rows={3} /> : waiting.length === 0 ? (
            <EmptyState variant="success" title="All caught up" hint="Overtime waiting for a decision shows up here." />
          ) : (
            <div style={{ display: 'grid', gap: 10 }}>
              {waiting.map((r) => (
                <ApprovalRow key={r.key} variant="card" name={r.name} kind={r.source === 'request' ? 'Asked for' : 'From punches'} meta={r.sub || undefined}
                  title={`+${hm(r.minutes)} on ${fmtWd(r.date)}`} reason={r.reason} facts={r.facts} status="pending" busy={busy[r.key] ?? false}
                  withNote={canDecide} notePlaceholder="Note (needed to reject)"
                  onApprove={canDecide ? (note) => decide(r, true, note) : undefined}
                  onReject={canDecide ? (note) => decide(r, false, note) : undefined} />
              ))}
            </div>
          )}
        </Section>
      ) : (
        <Section title="Overtime requests" body="flush" error={entries.error ?? requests.error} onRetry={() => { void entries.refetch(); void requests.refetch() }}>
          <Table label="Overtime this month" columns={columns} rows={month} rowKey={(r) => r.key} loading={entries.isLoading} mobile="cards"
            empty={<EmptyState variant="plain" icon="timer" title="No overtime requests" hint="Overtime from punches and requests this month shows up here." />} />
        </Section>
      )}

      {canSelf && <MyOvertime today={today} minimumMinutes={minimum} />}

      <Dialog open={!!rejecting} onClose={() => setRejecting(null)} busy={!!rejecting && busy[rejecting.key] === 'reject'} icon="xCircle" tone="danger"
        title={`Reject ${rejecting?.name.split(' ')[0] ?? ''}’s overtime?`} sub="Say why. They see this note."
        footer={(
          <>
            <PanelButton variant="secondary" onClick={() => setRejecting(null)}>Cancel</PanelButton>
            <PanelButton variant="danger" blockedReason={reason.trim() ? null : 'Add a note saying why'} busy={!!rejecting && busy[rejecting.key] === 'reject'}
              onClick={() => rejecting && decide(rejecting, false, reason)}>Reject overtime</PanelButton>
          </>
        )}>
        <Textarea label="Why it’s rejected" required rows={3} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Dialog>

      {rules.data && editing && <RulesPanel open={editing} onClose={() => setEditing(false)} companyId={companyId}
        minimum={rules.data.minimumMinutes} isDefault={rules.data.minimumIsDefault} defaultMinimum={rules.data.defaultMinimumMinutes} cap={rules.data.monthlyCapMinutes} />}
    </>
  )
}

function RulesPanel({ open, onClose, companyId, minimum, isDefault, defaultMinimum, cap }: {
  open: boolean; onClose: () => void; companyId: string; minimum: number; isDefault: boolean; defaultMinimum: number; cap: number | null
}) {
  const toast = useToast()
  const save = useSaveOvertimeRules(companyId)
  const [useDefault, setUseDefault] = useState(isDefault)
  const [minH, setMinH] = useState(String(Math.floor(minimum / 60)))
  const [minM, setMinM] = useState(minimum % 60 ? String(minimum % 60) : '')
  const [capH, setCapH] = useState(cap == null ? '' : String(Math.round((cap / 60) * 10) / 10))
  const minutes = useDefault ? null : toMinutes(minH, minM)
  const capMinutes = capH.trim() === '' ? null : /^\d+(\.\d)?$/.test(capH.trim()) ? Math.round(Number(capH) * 60) : NaN
  const blocked = !useDefault && (minutes == null || minutes > 1440) ? 'Enter a minimum of up to 24 hours'
    : Number.isNaN(capMinutes) || (capMinutes != null && capMinutes > 44640) ? 'Enter the cap in hours (up to 744)' : null
  const submit = async () => {
    if (blocked) return
    try {
      const res = await save.mutateAsync({ minimumMinutes: minutes, monthlyCapMinutes: capMinutes as number | null })
      if (!res.available) { toast.info('Overtime rules aren’t switched on yet.'); return }
      toast.success('Overtime rules saved')
      onClose()
    } catch (e) {
      toast.error('Couldn’t save the rules', { detail: errorText(e, 'Try again in a moment.') })
    }
  }
  return (
    <SidePanel open={open} onClose={onClose} busy={save.isPending} title="Overtime rules"
      sub="They change which extra time counts and how much can be approved. Hours worked and pay never change."
      footer={(
        <>
          <PanelButton variant="secondary" size="lg" onClick={onClose} disabled={save.isPending}>Cancel</PanelButton>
          <PanelButton variant="primary" size="lg" busy={save.isPending} blockedReason={blocked} onClick={submit}>Save rules</PanelButton>
        </>
      )}>
      <div className="apl-form">
        <Checkbox checked={useDefault} onChange={setUseDefault} label={`Use the default minimum (${hm(defaultMinimum)})`}
          description="Extra time under the minimum isn’t overtime. Once it’s reached, all the extra time counts." />
        {!useDefault && (
          <FieldGrid columns={2}>
            <Input label="Minimum: hours" type="number" min={0} max={24} value={minH} onChange={(e) => setMinH(e.target.value)} />
            <Input label="Minimum: minutes" type="number" min={0} max={59} value={minM} onChange={(e) => setMinM(e.target.value)} hint="0 and 0: every minute counts." />
          </FieldGrid>
        )}
        <Input label="Monthly cap (hours per person)" type="number" min={0} step={0.5} placeholder="No cap" value={capH} onChange={(e) => setCapH(e.target.value)}
          hint="Leave empty for no cap. Approvals stop once someone reaches it in a month." />
      </div>
    </SidePanel>
  )
}
