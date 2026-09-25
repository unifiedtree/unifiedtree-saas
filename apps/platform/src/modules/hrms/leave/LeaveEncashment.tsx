// Leave encashment (V143.23), in the module kit. Employees ask to cash in
// unused days of an encashable leave type; HR (hrms.leave.encash.approve)
// decides, and can raise one for an employee. Approved days come off the
// balance at once and are paid by the next payroll run at one day's Basic each.
import { useMemo, useState } from 'react'
import { Field, Input } from '@unifiedtree/ui-kit'
import { HrButton, HrSelect, HrStatusPill, type PillTone } from '@/shared/components/hr'
import { useCurrentUser } from '@/shared/hooks/useCurrentUser'
import { dashIcon } from '@/design/dc/icons'
import {
  StatRow, SubHeading, State, ApprovalList, RowList, Row, Panel, Note, Facts, days, stamp, dmy, type Approval,
} from '@/design/module/ModuleKit'
import { useEmployeeDirectory } from '../api/useWorkforce'
import {
  useMyEncashOptions, useMyEncashments, useRequestEncashment, useCancelEncashment, useEncashments, useEncashOptionsFor,
  useDecideEncashment, type Encashment, type EncashmentOption, type EncashmentStatus,
} from '../api/useLeaveYearEnd'

type Toast = (m: string, err?: boolean, d?: string) => void
const errMsg = (e: unknown) => (e instanceof Error && e.message ? e.message : undefined)
const STATUS: Record<EncashmentStatus, [string, PillTone]> = {
  PENDING: ['Waiting for HR', 'warn'], APPROVED: ['Approved · paid next payroll', 'ok'], REJECTED: ['Rejected', 'red'],
  CANCELLED: ['Cancelled', 'gray'], PAID: ['Paid', 'green'],
}
const pill = (s: EncashmentStatus) => { const [l, t] = STATUS[s] || [s, 'gray']; return <HrStatusPill tone={t}>{l}</HrStatusPill> }
export const inr = (n?: number | null) => (n == null ? '—' : `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`)
const REASON_MAX = 500
const lead = <span aria-hidden="true" style={{ width: 36, height: 36, borderRadius: 11, background: '#f8fafc', border: '1px solid #eef2f6', color: '#0f6e56', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{dashIcon('banknote', 17)}</span>

/** The request form, shared by the employee's own view and HR's "raise for someone". */
function RequestForm({ options, loading, onSubmit, busy, cta }: {
  options: EncashmentOption[]; loading: boolean; busy: boolean; cta: string
  onSubmit: (p: { leaveTypeId: string; days: number; reason?: string }) => Promise<boolean>
}) {
  const [f, setF] = useState({ leaveTypeId: '', days: '', reason: '' })
  const sel = options.find((o) => o.leaveTypeId === f.leaveTypeId)
  const n = Number(f.days)
  const problem = !f.leaveTypeId ? 'Choose a leave type.' : f.days === '' ? 'Enter how many days.'
    : !(n > 0) || n * 2 !== Math.round(n * 2) ? 'Use whole or half days, like 2 or 2.5.'
      : sel && n > sel.canRequest ? `Up to ${days(sel.canRequest)} of ${sel.leaveTypeName} can be encashed now.` : null
  const submit = async () => {
    if (problem || busy) return
    if (await onSubmit({ leaveTypeId: f.leaveTypeId, days: n, reason: f.reason.trim() || undefined })) setF({ leaveTypeId: '', days: '', reason: '' })
  }
  if (loading) return <State kind="loading" height={120} />
  if (!options.length) return <Note>None of these leave types can be encashed. HR decides which ones can, in Leave rules.</Note>
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={{ display: 'grid', gap: 6 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#334155' }}>Leave type *</span>
        <HrSelect value={f.leaveTypeId} onChange={(v) => setF({ ...f, leaveTypeId: v })} placeholder="Choose a leave type"
          options={options.map((o) => ({ value: o.leaveTypeId, label: `${o.leaveTypeName} · up to ${days(o.canRequest)}` }))} />
      </div>
      <Field label="Days to encash *"><Input type="number" min={0.5} step={0.5} value={f.days} onChange={(e: any) => setF({ ...f, days: e.target.value })} /></Field>
      <label style={{ display: 'grid', gap: 6 }}>
        <span style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 600, color: '#334155' }}>Reason<span style={{ fontWeight: 500, color: '#94a3b8' }}>{f.reason.length}/{REASON_MAX}</span></span>
        <textarea value={f.reason} maxLength={REASON_MAX} rows={2} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="Optional"
          style={{ font: 'inherit', fontSize: 14, padding: '9px 12px', border: '1px solid #cbd5e1', borderRadius: 10, outline: 'none', resize: 'vertical' }} />
      </label>
      {sel && <Note>{sel.perDayRate != null
        ? `About ${inr(n > 0 ? n * sel.perDayRate : 0)} before tax: one day’s Basic (${inr(sel.perDayRate)}) for each day. The exact amount is worked out when HR approves.`
        : 'The amount is one day’s Basic for each day, worked out from the salary structure when HR approves.'}</Note>}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingTop: 4, borderTop: '1px solid #f1f5f9' }}>
        <span style={{ fontSize: 12.5, color: problem ? '#64748b' : '#0f6e56', fontWeight: 600 }}>{problem || `${days(n)} held from the balance until HR decides`}</span>
        <HrButton onClick={submit} disabled={!!problem || busy}>{busy ? 'Sending…' : cta}</HrButton>
      </div>
    </div>
  )
}

function OptionFacts({ options }: { options: EncashmentOption[] }) {
  return <Facts items={options.map((o) => ({
    k: o.leaveTypeName,
    v: `${days(o.canRequest)} now · ${days(o.available)} left${o.maxPerYear != null ? ` · limit ${o.maxPerYear} a year` : ''}`,
  }))} />
}

function EncashRow({ r, trail, showName }: { r: Encashment; trail?: React.ReactNode; showName?: boolean }) {
  const who = showName ? `${r.employeeName || 'Employee'}${r.employeeCode ? ` · ${r.employeeCode}` : ''} · ` : ''
  return (
    <Row lead={lead}
      title={`${who}${r.leaveTypeName || 'Leave'} · ${days(Number(r.days))}`}
      meta={`${r.amount != null ? `${inr(r.amount)} · ` : ''}asked ${stamp(r.createdAt)}${r.raisedByHr ? ` · raised by ${r.raisedByName || 'HR'}` : ''}${r.decidedAt ? ` · decided ${dmy(r.decidedAt)}${r.decidedByName ? ` by ${r.decidedByName}` : ''}` : ''}${r.paidAt ? ` · paid ${dmy(r.paidAt)}` : ''}`}
      note={r.decisionNote ? `Note: “${r.decisionNote}”` : r.reason ? `“${r.reason}”` : undefined}
      trail={<>{pill(r.status)}{trail}</>} />
  )
}

// ── Employee ─────────────────────────────────────────────────────────────────
export function MyEncashment({ toast }: { toast: Toast }) {
  const opts = useMyEncashOptions(), mine = useMyEncashments()
  const request = useRequestEncashment(), cancel = useCancelEncashment()
  const rows = mine.data ?? []
  const waiting = rows.filter((r) => r.status === 'PENDING').length
  const unpaid = rows.filter((r) => r.status === 'APPROVED').reduce((s, r) => s + Number(r.amount || 0), 0)
  const onSubmit = async (p: { leaveTypeId: string; days: number; reason?: string }) => {
    try { await request.mutateAsync(p); toast('Encashment request sent', false, 'HR has been told. The days are held from your balance until they decide.'); return true }
    catch (e) { toast('Couldn’t send the request', true, errMsg(e)); return false }
  }
  const doCancel = async (r: Encashment) => {
    try { await cancel.mutateAsync(r.id); toast('Request cancelled', false, 'The days are back in your balance.') } catch (e) { toast('Couldn’t cancel it', true, errMsg(e)) }
  }
  if (opts.error) return <State kind="error" title="Couldn’t load what you can encash" description={errMsg(opts.error)} onRetry={() => opts.refetch()} />
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <StatRow tiles={[
        { icon: 'banknote', color: 'green', label: 'Can encash now', value: days((opts.data ?? []).reduce((s, o) => s + o.canRequest, 0)), sub: 'Across encashable leave types' },
        { icon: 'clock', color: 'orange', label: 'Waiting for HR', value: String(waiting), sub: waiting ? 'Days held from your balance' : 'Nothing waiting' },
        { icon: 'checkCircle', color: 'blue', label: 'Approved, to be paid', value: inr(unpaid), sub: 'Paid with your next salary' },
      ]} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,320px),1fr))', gap: 16, alignItems: 'start' }}>
        <Panel title="Encash leave" sub="Cash in unused days. HR decides; approved days come off your balance and are paid with your next salary.">
          <RequestForm options={opts.data ?? []} loading={opts.isLoading} busy={request.isPending} cta="Send request" onSubmit={onSubmit} />
        </Panel>
        <Panel title="What you can encash" sub={`Leave year ${new Date().getFullYear()}`}>
          {opts.isLoading ? <State kind="loading" height={100} /> : (opts.data ?? []).length ? <OptionFacts options={opts.data ?? []} /> : <Note>Nothing to encash this year.</Note>}
        </Panel>
      </div>
      <SubHeading>Your encashment requests</SubHeading>
      {mine.isLoading ? <State kind="loading" />
        : mine.error ? <State kind="error" title="Couldn’t load your requests" description={errMsg(mine.error)} onRetry={() => mine.refetch()} />
          : rows.length === 0 ? <State kind="empty" icon="banknote" title="No encashment requests yet" description="Requests you send appear here with their status." />
            : <RowList>{rows.map((r) => <EncashRow key={r.id} r={r} trail={r.status === 'PENDING' ? <HrButton size="sm" variant="ghost" disabled={cancel.isPending} onClick={() => doCancel(r)}>Cancel</HrButton> : undefined} />)}</RowList>}
    </div>
  )
}

// ── HR ───────────────────────────────────────────────────────────────────────
export function EncashmentAdmin({ toast }: { toast: Toast }) {
  const { data: me } = useCurrentUser()
  const pending = useEncashments('PENDING'), decided = useEncashments('DECIDED')
  const decide = useDecideEncashment(), request = useRequestEncashment()
  const dir = useEmployeeDirectory({ page: 0, pageSize: 200 })
  const [emp, setEmp] = useState('')
  const empOpts = useEncashOptionsFor(emp)
  const people = useMemo(() => (dir.data?.content ?? [])
    .filter((e) => !['EXITED', 'TERMINATED'].includes(String(e.employmentStatus || '')))
    .map((e) => ({ value: e.id, label: `${[e.firstName, e.lastName].filter(Boolean).join(' ') || e.employeeCode}${e.employeeCode ? ` · ${e.employeeCode}` : ''}` })), [dir.data])
  const rows = pending.data ?? [], done = decided.data ?? []
  const own = new Map(rows.map((r) => [r.id, r.employeeId === me?.employeeId]))
  const items: Approval[] = rows.map((r) => ({
    id: r.id, name: r.employeeName || 'Employee', sub: [r.employeeCode, r.raisedByHr ? `raised by ${r.raisedByName || 'HR'}` : null].filter(Boolean).join(' · '),
    facts: [{ k: 'Leave', v: r.leaveTypeName || 'Leave' }, { k: 'Days', v: days(Number(r.days)) }, { k: 'Year', v: String(r.year) }],
    reason: r.reason || '—', raised: stamp(r.createdAt),
  }))
  const approvedUnpaid = done.filter((r) => r.status === 'APPROVED')
  const onDecide = async (id: string, status: 'APPROVED' | 'REJECTED', note: string) => {
    try {
      const r = await decide.mutateAsync({ id, approved: status === 'APPROVED', note: note.trim() || undefined })
      toast(status === 'APPROVED' ? 'Encashment approved' : 'Encashment rejected', false,
        status === 'APPROVED' ? (r.amount != null ? `${inr(r.amount)} is paid in the next payroll run.` : 'No salary structure yet: the amount is worked out when payroll runs.') : 'The days are back in their balance.')
    } catch (e) { toast('Couldn’t save the decision', true, errMsg(e)) }
  }
  const onRaise = async (p: { leaveTypeId: string; days: number; reason?: string }) => {
    try { await request.mutateAsync({ ...p, employeeId: emp }); toast('Encashment raised', false, 'It’s waiting for a decision below.'); return true }
    catch (e) { toast('Couldn’t raise it', true, errMsg(e)); return false }
  }
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <StatRow tiles={[
        { icon: 'inbox', color: 'orange', label: 'Waiting for a decision', value: String(rows.length), sub: rows.length ? 'Days held from their balances' : 'Nothing waiting' },
        { icon: 'banknote', color: 'green', label: 'Approved, to be paid', value: inr(approvedUnpaid.reduce((s, r) => s + Number(r.amount || 0), 0)), sub: `${approvedUnpaid.length} for the next payroll run` },
        { icon: 'checkCircle', color: 'blue', label: 'Paid', value: String(done.filter((r) => r.status === 'PAID').length), sub: 'Paid through payroll' },
      ]} />
      <SubHeading>Waiting for your OK</SubHeading>
      {pending.isLoading ? <State kind="loading" />
        : pending.error ? <State kind="error" title="Couldn’t load encashment requests" description={errMsg(pending.error)} onRetry={() => pending.refetch()} />
          : items.length === 0 ? <State kind="empty" icon="checkCircle" title="All caught up" description="No leave encashment is waiting for a decision." />
            : <ApprovalList items={items} onDecide={onDecide} busy={decide.isPending} approveLabel="Approve"
              approveTip="Takes the days off their balance and pays them in the next payroll run" canDecide={(a) => !own.get(a.id)} />}
      <Panel title="Raise an encashment for someone" sub="For an employee who asked HR directly. It still needs a decision above.">
        <div style={{ display: 'grid', gap: 14 }}>
          <div style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#334155' }}>Employee *</span>
            <HrSelect value={emp} onChange={setEmp} placeholder={dir.isLoading ? 'Loading…' : 'Choose an employee'} options={people} />
          </div>
          {emp && (empOpts.error ? <Note tone="red">{errMsg(empOpts.error) || 'Couldn’t load what they can encash.'}</Note>
            : <RequestForm key={emp} options={empOpts.data ?? []} loading={empOpts.isLoading} busy={request.isPending} cta="Raise request" onSubmit={onRaise} />)}
        </div>
      </Panel>
      <SubHeading>Already decided</SubHeading>
      {decided.isLoading ? <State kind="loading" />
        : done.length === 0 ? <State kind="empty" icon="fileText" title="No decisions yet" description="Encashments you approve or reject are listed here." />
          : <RowList>{done.map((r) => <EncashRow key={r.id} r={r} showName />)}</RowList>}
    </div>
  )
}
