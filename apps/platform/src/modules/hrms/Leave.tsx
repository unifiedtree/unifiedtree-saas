// Leave (/hrms/leave) in the design language of the redesigned modules
// (design/module/ModuleKit): view tabs, stat tiles, approval cards and list
// rows. Views, and who sees them:
//   My leave · Apply · Balances   everyone except the admin bucket (client rule:
//                                 admins don't apply for their own leave)
//   Approvals · Decided           hrms.leave.approve.l1 (WFH rows: wfh.approve)
//   Encash                        your own (leave.request.self, not the admin
//                                 bucket) and HR's queue (hrms.leave.encash.approve)
//   Year end                      hrms.leave.yearend.run: accrual, carry forward, audit trail
//   Calendar · Leave types · Holidays   everyone; editing is permission-gated inside
// The view lives in ?tab= so notifications and the dashboard can deep-link.
import { useMemo, useState } from 'react'
import { usePermission, P } from '@unifiedtree/sdk'
import { Field, Input, Modal } from '@unifiedtree/ui-kit'
import { HrButton, HrSelect, HrStatusPill, type PillTone } from '@/shared/components/hr'
import { HrPagination } from '@/shared/components/HrPagination'
import { useRoles } from '@/shared/hooks/useRoles'
import { useCurrentUser } from '@/shared/hooks/useCurrentUser'
import { dashIcon } from '@/design/dc/icons'
import {
  ModulePage, Views, useView, StatRow, SubHeading, State, ApprovalList, RowList, Row, Panel, Note, Facts, useDesignToast,
  days, range, todayIso, stamp, CARD, HEAD_FONT, type Tile, type Approval,
} from '@/design/module/ModuleKit'
import {
  useMyLeaves, useMyBalances, useLeaveTypes, usePendingApprovals, useApprovalsHistory,
  useApplyLeave, useLeaveDecision, useCancelLeave,
  type LeaveApprovalStatus, type LeaveDuration, type LeaveRequestResponse,
} from './api/useLeave'
import { usePendingWfhApprovals, useWfhDecision } from './api/useWfh'
import { useCompanies } from './api/useOrg'
import { useWeekendDays, jsWeekendDays } from './api/useSettings'
import { LeaveTypes } from './leave/LeaveTypes'
import { HolidayCalendar } from './leave/HolidayCalendar'
import { LeaveCalendar } from './leave/LeaveCalendar'
import { MyEncashment, EncashmentAdmin } from './leave/LeaveEncashment'
import { LeaveYearEnd, LedgerRows } from './leave/LeaveYearEnd'
import { useEncashments, useMyLeaveLedger } from './api/useLeaveYearEnd'

const STATUS: Record<LeaveApprovalStatus, [string, PillTone]> = {
  PENDING: ['Pending', 'warn'], APPROVED: ['Approved', 'ok'], REJECTED: ['Rejected', 'red'], CANCELLED: ['Cancelled', 'gray'], PENDING_L2: ['Awaiting HR', 'purple'],
}
const pill = (s: LeaveApprovalStatus) => { const [l, t] = STATUS[s] || [s, 'gray']; return <HrStatusPill tone={t}>{l}</HrStatusPill> }
const TILE_COLORS: Tile['color'][] = ['green', 'blue', 'purple', 'teal', 'orange']
const errMsg = (e: unknown) => (e instanceof Error && e.message ? e.message : undefined)

// ── My leave ─────────────────────────────────────────────────────────────────
function MyLeave({ toast }: { toast: (m: string, err?: boolean, d?: string) => void }) {
  const [page, setPage] = useState(0)
  const [size, setSize] = useState(20)
  const q = useMyLeaves(page, size)
  const bal = useMyBalances(new Date().getFullYear())
  const cancel = useCancelLeave()
  const [asking, setAsking] = useState<LeaveRequestResponse | null>(null)
  const rows = q.data?.content ?? [], total = q.data?.totalElements ?? 0
  const pending = rows.filter((r) => r.status === 'PENDING' || r.status === 'PENDING_L2').length
  const tiles: Tile[] = (bal.data ?? []).slice(0, 3).map((b, i) => ({
    icon: 'calendarDays', color: TILE_COLORS[i % TILE_COLORS.length], label: b.leaveTypeName, value: days(b.available),
    sub: `left of ${days(b.totalEntitlement + b.carryForward)}${b.pending ? ` · ${days(b.pending)} pending` : ''}`,
  }))
  tiles.push({ icon: 'clock', color: 'orange', label: 'Waiting for approval', value: String(pending), sub: pending ? 'Requests not decided yet' : 'Nothing waiting', tip: '' })
  const doCancel = async () => {
    if (!asking) return
    try { await cancel.mutateAsync({ requestId: asking.id, reason: 'Cancelled by employee' }); toast('Leave cancelled'); setAsking(null) } catch (e) { toast('Couldn’t cancel the leave', true, errMsg(e)) }
  }
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {bal.isLoading ? <State kind="loading" height={96} /> : <StatRow tiles={tiles} />}
      <SubHeading>Your requests</SubHeading>
      {q.isLoading ? <State kind="loading" />
        : q.error ? <State kind="error" title="Couldn’t load your leave" description={errMsg(q.error)} onRetry={() => q.refetch()} />
          : rows.length === 0 ? <State kind="empty" icon="calendarDays" title="No leave requests yet" description="Requests you make appear here with their status." />
            : (
              <RowList>
                {rows.map((r) => (
                  <Row key={r.id}
                    lead={<span aria-hidden="true" style={{ width: 36, height: 36, borderRadius: 11, background: '#f8fafc', border: '1px solid #eef2f6', color: '#0f6e56', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{dashIcon('calendarDays', 17)}</span>}
                    title={`${r.leaveTypeName || 'Leave'} · ${range(r.startDate, r.endDate)}`}
                    meta={`${days(Number(r.totalDays))} · asked ${stamp(r.createdAt)}${r.approverComment ? ` · “${r.approverComment}”` : ''}`}
                    note={r.reason ? `“${r.reason}”` : undefined}
                    trail={<>{pill(r.status)}{(r.status === 'PENDING' || r.status === 'APPROVED') && <HrButton size="sm" variant="ghost" onClick={() => setAsking(r)}>Cancel</HrButton>}</>}
                  />
                ))}
              </RowList>
            )}
      <HrPagination page={page} pageSize={size} totalElements={total} totalPages={Math.max(1, Math.ceil(total / size))} onPageChange={setPage} onPageSizeChange={setSize} />
      <Modal open={!!asking} onOpenChange={(o: boolean) => { if (!o) setAsking(null) }} title="Cancel this leave?" description={asking ? `${asking.leaveTypeName || 'Leave'}, ${range(asking.startDate, asking.endDate)} (${days(Number(asking.totalDays))}). The days go back to your balance.` : ''} size="sm">
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
          <HrButton variant="ghost" onClick={() => setAsking(null)}>Keep it</HrButton>
          <HrButton variant="danger" onClick={doCancel} disabled={cancel.isPending}>{cancel.isPending ? 'Cancelling…' : 'Cancel leave'}</HrButton>
        </div>
      </Modal>
    </div>
  )
}

// ── Apply ────────────────────────────────────────────────────────────────────
const REASON_MAX = 500
function Apply({ onDone, toast }: { onDone: () => void; toast: (m: string, err?: boolean, d?: string) => void }) {
  const { data: companies = [] } = useCompanies()
  const { data: me } = useCurrentUser()
  // useCompanies self-heals the employee 403; me.companyId keeps the form usable meanwhile.
  const companyId = companies[0]?.id ?? me?.companyId ?? ''
  const types = useLeaveTypes(companyId)
  const mine = useMyLeaves(0)
  const bal = useMyBalances(new Date().getFullYear())
  const wk = useWeekendDays(companyId || undefined)
  const apply = useApplyLeave()
  const off = useMemo(() => jsWeekendDays(wk.data?.weekendDays), [wk.data])
  const today = todayIso()
  const [f, setF] = useState({ leaveTypeId: '', startDate: '', endDate: '', duration: 'FULL_DAY' as LeaveDuration, reason: '' })
  const half = f.duration !== 'FULL_DAY'
  const end = half ? f.startDate : f.endDate
  // Preview: calendar days minus the company's weekly off days. The server
  // also skips company holidays, so the final count can be lower.
  const count = useMemo(() => {
    if (!f.startDate || !end || end < f.startDate) return 0
    if (half) return 0.5
    let n = 0
    for (let d = new Date(`${f.startDate}T00:00:00`), stop = new Date(`${end}T00:00:00`), i = 0; d <= stop && i < 367; d.setDate(d.getDate() + 1), i++) if (!off.has(d.getDay())) n++
    return n
  }, [f.startDate, end, half, off])
  const overlap = !!f.startDate && !!end && (mine.data?.content ?? []).some((l) => ['PENDING', 'PENDING_L2', 'APPROVED'].includes(l.status) && l.startDate <= end && l.endDate >= f.startDate)
  const b = (bal.data ?? []).find((x) => x.leaveTypeId === f.leaveTypeId)
  const over = !!b && count > 0 && count > b.available
  const rlen = f.reason.trim().length
  const problem = !f.leaveTypeId ? 'Choose a leave type.' : !f.startDate ? 'Pick a start date.' : f.startDate < today ? 'The start date can’t be in the past.'
    : !end ? 'Pick an end date.' : end < f.startDate ? 'The end date must be on or after the start date.' : rlen === 0 ? 'Add a reason.' : rlen < 10 ? `The reason needs at least 10 characters (${rlen}/10).` : null
  const blocked = !!problem || overlap || over || apply.isPending
  const submit = async () => {
    if (blocked) return
    try {
      await apply.mutateAsync({ leaveTypeId: f.leaveTypeId, startDate: f.startDate, endDate: end, duration: f.duration, reason: f.reason.trim(), companyId: companyId || undefined })
      toast('Leave request sent', false, 'Your approver has been notified.')
      setF({ leaveTypeId: '', startDate: '', endDate: '', duration: 'FULL_DAY', reason: '' })
      onDone()
    } catch (e) { toast('Couldn’t send the request', true, errMsg(e)) }
  }
  const active = (types.data ?? []).filter((t) => t.isActive)
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,320px),1fr))', gap: 16, alignItems: 'start' }}>
      <Panel title="Apply for leave" sub="Your approver is notified as soon as you send it.">
        <div style={{ display: 'grid', gap: 14 }}>
          <div style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#334155' }}>Leave type *</span>
            <HrSelect value={f.leaveTypeId} onChange={(v) => setF({ ...f, leaveTypeId: v })} placeholder={types.isLoading ? 'Loading…' : 'Choose a leave type'}
              options={active.map((t) => { const x = (bal.data ?? []).find((y) => y.leaveTypeId === t.id); return { value: t.id, label: `${t.name}${x ? ` · ${days(x.available)} left` : ` · ${t.annualEntitlement} days a year`}` } })} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,150px),1fr))', gap: 12 }}>
            <Field label="From *"><Input type="date" min={today} value={f.startDate} onChange={(e: any) => setF({ ...f, startDate: e.target.value })} /></Field>
            <Field label="To *"><Input type="date" min={f.startDate || today} value={end} disabled={half} onChange={(e: any) => setF({ ...f, endDate: e.target.value })} /></Field>
          </div>
          <div style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#334155' }}>Duration</span>
            <HrSelect value={f.duration} onChange={(v) => setF({ ...f, duration: v as LeaveDuration })} options={[{ value: 'FULL_DAY', label: 'Full days' }, { value: 'HALF_DAY_MORNING', label: 'Half day · morning' }, { value: 'HALF_DAY_AFTERNOON', label: 'Half day · afternoon' }]} />
          </div>
          <label style={{ display: 'grid', gap: 6 }}>
            <span style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 600, color: '#334155' }}>Reason *<span style={{ fontWeight: 500, color: '#94a3b8' }}>{f.reason.length}/{REASON_MAX}</span></span>
            <textarea value={f.reason} maxLength={REASON_MAX} rows={3} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="At least 10 characters"
              style={{ font: 'inherit', fontSize: 14, padding: '9px 12px', border: '1px solid #cbd5e1', borderRadius: 10, outline: 'none', resize: 'vertical' }} />
          </label>
          {overlap && <Note tone="red">You already have leave requested or approved on these dates.</Note>}
          {over && b && <Note tone="red">That’s {days(count)}, but you have {days(b.available)} of {b.leaveTypeName} left.</Note>}
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingTop: 4, borderTop: '1px solid #f1f5f9' }}>
            <span style={{ fontSize: 12.5, color: problem ? '#64748b' : '#0f6e56', fontWeight: 600 }}>{problem || `${days(count)} of leave${!half ? ' · weekly offs skipped' : ''}`}</span>
            <HrButton onClick={submit} disabled={blocked}>{apply.isPending ? 'Sending…' : 'Send request'}</HrButton>
          </div>
        </div>
      </Panel>
      <Panel title="What you have" sub={`Leave year ${new Date().getFullYear()}`}>
        {bal.isLoading ? <State kind="loading" height={120} /> : (bal.data ?? []).length === 0
          ? <Note>No leave balances yet. Ask HR to set up leave types for your company.</Note>
          : <Facts items={(bal.data ?? []).map((x) => ({ k: x.leaveTypeName, v: `${days(x.available)} left` }))} />}
        <Note>The count above skips your company’s weekly off days. Company holidays are also left out when you send it, so the final count can be lower.</Note>
      </Panel>
    </div>
  )
}

// ── Balances ─────────────────────────────────────────────────────────────────
function Balances() {
  const q = useMyBalances(new Date().getFullYear())
  // Monthly / quarterly credits, carry forward and encashments on your balances (V143.23).
  const ledger = useMyLeaveLedger()
  if (q.isLoading) return <State kind="loading" height={140} />
  if (q.error) return <State kind="error" title="Couldn’t load your balances" description={errMsg(q.error)} onRetry={() => q.refetch()} />
  if (!(q.data ?? []).length) return <State kind="empty" icon="calendarDays" title="No leave balances yet" description="Ask HR to set up leave types for your company." />
  return (
    <div style={{ display: 'grid', gap: 16 }}>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(min(100%,240px),1fr))', gap: 12 }}>
      {(q.data ?? []).map((b) => {
        const total = b.totalEntitlement + b.carryForward, pct = total ? Math.min(100, (b.used / total) * 100) : 0
        return (
          <div key={b.id} style={{ ...CARD, padding: '16px 18px', display: 'grid', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
              <strong style={{ fontSize: 14 }}>{b.leaveTypeName}</strong>
              <span style={{ fontFamily: HEAD_FONT, fontSize: 24, fontWeight: 800, color: '#0f6e56' }}>{Number.isInteger(b.available) ? b.available : b.available.toFixed(1)}</span>
            </div>
            <div aria-hidden="true" style={{ height: 6, borderRadius: 4, background: '#f1f5f9', overflow: 'hidden' }}><div style={{ width: `${pct}%`, height: '100%', background: pct > 80 ? '#e11d48' : pct > 50 ? '#f59e0b' : '#0f6e56' }} /></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, color: '#64748b' }}><span>{days(b.used)} used</span><span>{days(total)} in all</span></div>
            {(b.pending > 0 || b.carryForward > 0) && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {b.pending > 0 && <HrStatusPill tone="warn">{`${days(b.pending)} pending`}</HrStatusPill>}
              {b.carryForward > 0 && <HrStatusPill tone="blue">{`${days(b.carryForward)} carried forward`}</HrStatusPill>}
            </div>}
          </div>
        )
      })}
    </div>
    {(ledger.data ?? []).length > 0 && <>
      <SubHeading>Credits, carry forward and encashments</SubHeading>
      <LedgerRows entries={ledger.data ?? []} />
    </>}
    </div>
  )
}

// ── Approvals (leave + WFH in one queue) ─────────────────────────────────────
function Approvals({ toast }: { toast: (m: string, err?: boolean, d?: string) => void }) {
  const [page, setPage] = useState(0)
  const canLeave = usePermission(P.HRMS_LEAVE_APPROVE_L1), canWfh = usePermission(P.WFH_APPROVE)
  // Each queue only for people who may decide it (the endpoints refuse everyone else).
  const lq = usePendingApprovals(page, canLeave), wq = usePendingWfhApprovals(page, 20, canWfh)
  const decide = useLeaveDecision(), decideWfh = useWfhDecision()
  const kinds = new Map<string, 'leave' | 'wfh'>()
  const items: (Approval & { at: string })[] = [
    ...(lq.data?.content ?? []).map((l) => { kinds.set(l.id, 'leave'); return { id: l.id, at: l.createdAt, name: l.employeeName || 'Employee', sub: [l.employeeCode, l.departmentName].filter(Boolean).join(' · '), facts: [{ k: 'Leave', v: l.leaveTypeName || 'Leave' }, { k: 'Dates', v: range(l.startDate, l.endDate) }, { k: 'Days', v: days(Number(l.totalDays)) }], reason: l.reason || '—', raised: stamp(l.createdAt) } }),
    ...(wq.data?.content ?? []).map((w) => {
      kinds.set(w.id, 'wfh')
      const n = Math.max(1, Math.round((new Date(w.toDate).getTime() - new Date(w.fromDate).getTime()) / 864e5) + 1)
      return { id: w.id, at: w.createdAt, name: w.employeeName || 'Employee', sub: [w.employeeCode, w.departmentName].filter(Boolean).join(' · '), facts: [{ k: 'Request', v: 'Work from home' }, { k: 'Dates', v: range(w.fromDate, w.toDate) }, { k: 'Days', v: days(n) }], reason: w.reason || '—', raised: stamp(w.createdAt) }
    }),
  ].sort((a, b) => (b.at || '').localeCompare(a.at || ''))
  const total = (lq.data?.totalElements ?? 0) + (wq.data?.totalElements ?? 0)
  const onDecide = async (id: string, status: 'APPROVED' | 'REJECTED', note: string) => {
    const kind = kinds.get(id), ok = status === 'APPROVED'
    // The server refuses a WFH rejection without a reason (WFH_REJECT_REASON_REQUIRED).
    if (kind === 'wfh' && !ok && !note.trim()) { toast('Add a note to reject a work-from-home request', true); return }
    try {
      if (kind === 'wfh') await decideWfh.mutateAsync({ requestId: id, approved: ok, comment: note.trim() || undefined })
      else await decide.mutateAsync({ requestId: id, status, comment: note.trim() || undefined })
      toast(`${kind === 'wfh' ? 'Work from home' : 'Leave'} ${ok ? 'approved' : 'rejected'}`)
    } catch (e) { toast('Couldn’t save the decision', true, errMsg(e)) }
  }
  const loading = lq.isLoading || wq.isLoading
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <StatRow tiles={[
        { icon: 'calendarDays', color: 'orange', label: 'Leave waiting', value: String(lq.data?.totalElements ?? 0), sub: 'Leave requests for you to decide' },
        { icon: 'home', color: 'purple', label: 'Work from home waiting', value: String(wq.data?.totalElements ?? 0), sub: 'WFH requests for you to decide' },
      ]} />
      <SubHeading>Waiting for your OK</SubHeading>
      {loading ? <State kind="loading" />
        : lq.error && wq.error ? <State kind="error" title="Couldn’t load requests" description="Leave and work-from-home requests didn’t load." onRetry={() => { lq.refetch(); wq.refetch() }} />
          : items.length === 0 ? <State kind="empty" icon="checkCircle" title="All caught up" description="No leave or work-from-home requests are waiting for you." />
            : <ApprovalList items={items} onDecide={onDecide} busy={decide.isPending || decideWfh.isPending} approveLabel="Approve" approveTip="Approves the request and updates their balance"
              canDecide={(a) => (kinds.get(a.id) === 'wfh' ? canWfh : canLeave)} />}
      {total > 20 && <HrPagination page={page} pageSize={20} totalElements={total} totalPages={Math.ceil(total / 20)} onPageChange={setPage} />}
    </div>
  )
}

// ── Decided ──────────────────────────────────────────────────────────────────
function Decided() {
  const [page, setPage] = useState(0)
  const q = useApprovalsHistory(page)
  const rows = q.data?.content ?? [], total = q.data?.totalElements ?? 0
  if (q.isLoading) return <State kind="loading" />
  if (q.error) return <State kind="error" title="Couldn’t load decisions" description={errMsg(q.error)} onRetry={() => q.refetch()} />
  if (!rows.length) return <State kind="empty" icon="fileText" title="No decisions yet" description="Leave you approve or reject is listed here." />
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <RowList>
        {rows.map((l) => (
          <Row key={l.id} title={`${l.employeeName || 'Employee'}${l.employeeCode ? ` · ${l.employeeCode}` : ''}`}
            meta={`${l.leaveTypeName || 'Leave'} · ${range(l.startDate, l.endDate)} · ${days(Number(l.totalDays))}${l.departmentName ? ` · ${l.departmentName}` : ''}`}
            note={l.approverComment ? `Note: “${l.approverComment}”` : l.reason ? `“${l.reason}”` : undefined} trail={pill(l.status)} />
        ))}
      </RowList>
      {total > 20 && <HrPagination page={page} pageSize={20} totalElements={total} totalPages={Math.ceil(total / 20)} onPageChange={setPage} />}
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────
export function Leave() {
  const { isAdmin } = useRoles()
  const canApprove = usePermission(P.HRMS_LEAVE_APPROVE_L1)
  const canEditHolidays = usePermission(P.SETTINGS_HOLIDAYS_WRITE)
  const canWfhApprove = usePermission(P.WFH_APPROVE)
  const canEncashSelf = usePermission('leave.request.self') && !isAdmin
  const canEncashApprove = usePermission('hrms.leave.encash.approve'), canYearEnd = usePermission('hrms.leave.yearend.run')
  const pendEncash = useEncashments('PENDING', canEncashApprove)
  const pend = usePendingApprovals(0, canApprove), pendWfh = usePendingWfhApprovals(0, 20, canApprove && canWfhApprove)
  const waiting = canApprove ? (pend.data?.totalElements ?? 0) + (pendWfh.data?.totalElements ?? 0) : 0
  const { show, node } = useDesignToast()
  const views = [
    !isAdmin && { key: 'my', label: 'My leave', icon: 'calendarDays' },
    !isAdmin && { key: 'apply', label: 'Apply', icon: 'plus' },
    !isAdmin && { key: 'balances', label: 'Balances', icon: 'chart' },
    canApprove && { key: 'approvals', label: 'Approvals', icon: 'inbox', count: waiting || undefined, urgent: waiting > 0 },
    canApprove && { key: 'history', label: 'Decided', icon: 'checkCircle' },
    (canEncashSelf || canEncashApprove) && { key: 'encash', label: 'Encash', icon: 'banknote', count: canEncashApprove ? (pendEncash.data?.length || undefined) : undefined, urgent: canEncashApprove && (pendEncash.data?.length ?? 0) > 0 },
    canYearEnd && { key: 'yearend', label: 'Year end', icon: 'calendarCheck' },
    { key: 'calendar', label: 'Calendar', icon: 'calendar' },
    { key: 'types', label: 'Leave types', icon: 'list' },
    { key: 'holidays', label: 'Holidays', icon: 'sun' },
  ].filter(Boolean) as { key: string; label: string; icon: string; count?: number; urgent?: boolean }[]
  const [view, setView] = useView(views.map((v) => v.key), 'tab')
  const subtitle = isAdmin ? 'Approve requests, and manage leave types and holidays.' : canApprove ? 'Apply for leave, track your balance, and decide your team’s requests.' : 'Apply for leave and track your balance.'
  return (
    <ModulePage crumb="Leave Management" title="Leave" subtitle={subtitle}
      actions={!isAdmin && view !== 'apply' ? <HrButton onClick={() => setView('apply')}>{dashIcon('plus', 15)} Apply for leave</HrButton> : undefined}>
      <div style={{ display: 'grid', gap: 16, minWidth: 0 }}>
        <Views items={views} active={view} onChange={setView} label="Leave views" />
        {view === 'my' && <MyLeave toast={show} />}
        {view === 'apply' && <Apply onDone={() => setView('my')} toast={show} />}
        {view === 'balances' && <Balances />}
        {view === 'approvals' && <Approvals toast={show} />}
        {view === 'history' && <Decided />}
        {view === 'encash' && canEncashApprove && <EncashmentAdmin toast={show} />}
        {view === 'encash' && canEncashSelf && canEncashApprove && <SubHeading>Your own encashment</SubHeading>}
        {view === 'encash' && canEncashSelf && <MyEncashment toast={show} />}
        {view === 'yearend' && <LeaveYearEnd toast={show} />}
        {view === 'calendar' && <LeaveCalendar />}
        {view === 'types' && <LeaveTypes embedded />}
        {view === 'holidays' && <HolidayCalendar canEdit={canEditHolidays} embedded />}
      </div>
      {node}
    </ModulePage>
  )
}
