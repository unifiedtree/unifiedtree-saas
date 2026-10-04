// Leave (/hrms/leave) rebuilt on the redesign kit (`@/design/kit`, `@/design/
// module/ModuleKit`), screens from `design/prototype/PgLeave.dc.html`,
// `PgTime.dc.html` page `l-ops`, and `EmpLeave.dc.html`. Views, and who sees
// which (DECISIONS 21 + ess-1 §7):
//   My leave · Apply · Balances          non-admin (admins don't apply for themselves)
//   Approvals · Decided                  hrms.leave.approve.l1 (WFH rows: wfh.approve)
//   All balances                         hrms.leave.employee.read or hrms.report.leave
//                                        (new, after Decided; needs READY_PAGES += P-LEAVE)
//   Encash                               own (leave.request.self, non-admin) and
//                                        HR's queue (hrms.leave.encash.approve)
//   Year end                             hrms.leave.yearend.run
//   Calendar · Leave types · Holidays    everyone; editing is permission-gated inside
//
// The view lives in ?tab= so notifications and the dashboard deep-link.
// Inline pill tabs (`placement="inline"`) — never header; the shell shows the
// module's own pages at the top (SHELL CONTRACT UPDATE).
import { useMemo, useState } from 'react'
import { usePermission, P } from '@unifiedtree/sdk'
import { Modal } from '@unifiedtree/ui-kit'
import { DateField } from '@/shared/components/calendar'
import { HrButton, HrSelect, HrStatusPill, type PillTone } from '@/shared/components/hr'
import { HrPagination } from '@/shared/components/HrPagination'
import { useRoles } from '@/shared/hooks/useRoles'
import { useCurrentUser } from '@/shared/hooks/useCurrentUser'
import { dashIcon } from '@/design/dc/icons'
import {
  ModulePage, Views, useView, StatRow, SubHeading, State, RowList, Row, Panel, Note, Facts, useDesignToast,
  CARD, HEAD_FONT, days, range, dmy, todayIso, stamp, type Tile, type Approval, FONT,
} from '@/design/module/ModuleKit'
import { Button } from '@/design/kit/display'
import { decidedCount, decidedTotal, requestWho } from './leave/leaveLabels'
import {
  useMyLeaves, useMyBalances, useLeaveTypes, usePendingApprovals, useApprovalsHistory,
  useApplyLeave, useLeaveDecision, useCancelLeave, usePendingL2Approvals, useLeaveL2Decision,
  useLeaveBulkDecision, useLeaveApprovalStats, useLeavePreview, useColleaguesOff,
  type DecidedStatus, type LeaveApprovalStatus, type LeaveDuration, type LeaveRequestResponse,
} from './api/useLeave'
import { usePendingWfhApprovals, useWfhDecision } from './api/useWfh'
import { useCompanies } from './api/useOrg'
import { useWeekendDays, jsWeekendDays } from './api/useSettings'
import { useRecentDecisions } from './api/shared/useRecentDecisions'
import { useDecisionUndo } from './api/shared/useDecisionUndo'
import { useApprovers } from './api/shared/useApprovers'
import { LeaveTypes } from './leave/LeaveTypes'
import { HolidayCalendar } from './leave/HolidayCalendar'
import { LeaveCalendar } from './leave/LeaveCalendar'
import { MyEncashment, EncashmentAdmin } from './leave/LeaveEncashment'
import { LeaveYearEnd, LedgerRows } from './leave/LeaveYearEnd'
import { AllBalances } from './leave/AllBalances'
import { ApplyOnBehalfPanel } from './leave/ApplyOnBehalfPanel'
import { useEncashments, useMyLeaveLedger } from './api/useLeaveYearEnd'

// ── small helpers ───────────────────────────────────────────────────────────
const STATUS: Record<LeaveApprovalStatus, [string, PillTone]> = {
  PENDING: ['Pending', 'warn'], APPROVED: ['Approved', 'ok'], REJECTED: ['Rejected', 'red'],
  CANCELLED: ['Cancelled', 'gray'], PENDING_L2: ['Awaiting HR', 'purple'],
}
const pill = (s: LeaveApprovalStatus) => { const [l, t] = STATUS[s] || [s, 'gray']; return <HrStatusPill tone={t}>{l}</HrStatusPill> }
const TILE_COLORS: Tile['color'][] = ['green', 'blue', 'purple', 'teal', 'orange']
const errMsg = (e: unknown) => (e instanceof Error && e.message ? e.message : undefined)
/** Category → tinted chip background and ink (prototype PgLeave LV_TYPE). */
const CATEGORY_TINT: Record<string, [string, string]> = {
  CASUAL: ['var(--u-brs,#E8F3EE)', 'var(--u-brt,#0F6E56)'],
  EARNED: ['var(--u-brs2,#D2EADF)', 'var(--u-brt,#0F6E56)'],
  SICK: ['var(--u-rds,#FCEDEB)', 'var(--u-rdt,#B42318)'],
  COMPENSATORY: ['var(--u-gds,#FAF1E1)', 'var(--u-gdt,#8A5A10)'],
}
const typeChipColour = (cat?: string | null): [string, string] =>
  cat && CATEGORY_TINT[cat] ? CATEGORY_TINT[cat] : CATEGORY_TINT.CASUAL
const hr = (n: number | null | undefined) => (typeof n === 'number' ? `${n.toFixed(1)}h` : '—')

// ── My leave ────────────────────────────────────────────────────────────────
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
    try { await cancel.mutateAsync({ requestId: asking.id, reason: 'Cancelled by employee' }); toast('Leave cancelled'); setAsking(null) }
    catch (e) { toast('Couldn’t cancel the leave', true, errMsg(e)) }
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
                    lead={<span aria-hidden="true" style={{ width: 36, height: 36, borderRadius: 11, background: 'var(--u-sf2,#F7F9F8)', border: '1px solid var(--u-ln2,#EDF1EF)', color: 'var(--u-brt,#0F6E56)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{dashIcon('calendarDays', 17)}</span>}
                    title={`${r.leaveTypeName || 'Leave'} · ${range(r.startDate, r.endDate)}`}
                    meta={`${days(Number(r.totalDays))} · asked ${stamp(r.createdAt)}${requestWho(r) ? ` · ${requestWho(r)}` : ''}${r.approverComment ? ` · “${r.approverComment}”` : ''}`}
                    note={r.reason ? `“${r.reason}”` : undefined}
                    trail={<>{pill(r.status)}{(r.status === 'PENDING' || r.status === 'PENDING_L2' || r.status === 'APPROVED') && <HrButton size="sm" variant="ghost" onClick={() => setAsking(r)}>Cancel</HrButton>}</>}
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

// ── Apply (self) ────────────────────────────────────────────────────────────
const REASON_MAX = 500
function Apply({ onDone, toast }: { onDone: () => void; toast: (m: string, err?: boolean, d?: string) => void }) {
  const { data: companies = [] } = useCompanies()
  const { data: me } = useCurrentUser()
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

  // Server preview (BW-48): the exact days, balance after, approver, every
  // blocking reason. Falls back to the local client-side count while loading.
  const preview = useLeavePreview({ leaveTypeId: f.leaveTypeId, startDate: f.startDate, endDate: end, duration: f.duration, companyId })
  const approverPreview = useApprovers('leave', { enabled: !preview.data?.approverName })
  const localCount = useMemo(() => {
    if (!f.startDate || !end || end < f.startDate) return 0
    if (half) return 0.5
    let n = 0
    for (let d = new Date(`${f.startDate}T00:00:00`), stop = new Date(`${end}T00:00:00`), i = 0; d <= stop && i < 367; d.setDate(d.getDate() + 1), i++) if (!off.has(d.getDay())) n++
    return n
  }, [f.startDate, end, half, off])
  const count = preview.data?.workingDays ?? localCount
  const overlap = !!f.startDate && !!end && (mine.data?.content ?? []).some((l) => ['PENDING', 'PENDING_L2', 'APPROVED'].includes(l.status) && l.startDate <= end && l.endDate >= f.startDate)
  const approverName = preview.data?.approverName ?? approverPreview.data?.approver?.name ?? null

  // Colleagues off (BW-47): same-department, approved only, first names only.
  const teamOff = useColleaguesOff(f.startDate || undefined, (end || undefined), !!f.startDate && !!end)
  const clash = useMemo(() => {
    const names = new Set<string>()
    for (const d of teamOff.data?.days ?? []) for (const n of d.names) names.add(n)
    return [...names]
  }, [teamOff.data])

  const b = (bal.data ?? []).find((x) => x.leaveTypeId === f.leaveTypeId)
  const rlen = f.reason.trim().length
  // Local complaints first, then any server-side blocking reason.
  const localProblem = !f.leaveTypeId ? 'Choose a leave type.'
    : !f.startDate ? 'Pick a start date.'
      : f.startDate < today ? 'The start date can’t be in the past.'
        : !end ? 'Pick an end date.'
          : end < f.startDate ? 'The end date must be on or after the start date.'
            : rlen === 0 ? 'Add a reason.'
              : rlen < 10 ? `The reason needs at least 10 characters (${rlen}/10).`
                : null
  const refusal = preview.data?.blockingReasons?.[0]?.message || null
  const problem = localProblem || refusal
  const blocked = !!problem || overlap || apply.isPending

  const submit = async () => {
    if (blocked) return
    try {
      await apply.mutateAsync({ leaveTypeId: f.leaveTypeId, startDate: f.startDate, endDate: end, duration: f.duration, reason: f.reason.trim(), companyId: companyId || undefined })
      toast('Leave request sent', false, approverName ? `Sent to ${approverName}.` : 'Your approver has been notified.')
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
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--u-ink2,#4A5A54)' }}>Leave type *</span>
            <HrSelect value={f.leaveTypeId} onChange={(v) => setF({ ...f, leaveTypeId: v })} placeholder={types.isLoading ? 'Loading…' : 'Choose a leave type'}
              options={active.map((t) => { const x = (bal.data ?? []).find((y) => y.leaveTypeId === t.id); return { value: t.id, label: `${t.name}${x ? ` · ${days(x.available)} left` : ` · ${t.annualEntitlement} days a year`}` } })} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,150px),1fr))', gap: 12 }}>
            {/* The shared calendar (DateField) is the one date UI across the app now (see
                live tests, "Live tests pick dates through the shared calendar"); raw
                <input type="date"> opens the browser's own picker, which breaks consistency
                and the test selectors. */}
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--u-ink2,#4A5A54)' }}>From *</span>
              <DateField min={today} value={f.startDate} aria-label="From *"
                onChange={(e) => setF({ ...f, startDate: e.target.value })}
                style={{ font: 'inherit', fontSize: 14, padding: '9px 12px', border: '1px solid var(--u-ln,#E3E9E6)', borderRadius: 10, background: 'var(--u-sf,#fff)', color: 'inherit' }} />
            </label>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--u-ink2,#4A5A54)' }}>To *</span>
              <DateField min={f.startDate || today} value={end} disabled={half} aria-label="To *"
                onChange={(e) => setF({ ...f, endDate: e.target.value })}
                style={{ font: 'inherit', fontSize: 14, padding: '9px 12px', border: '1px solid var(--u-ln,#E3E9E6)', borderRadius: 10, background: half ? 'var(--u-hv,#F0F4F2)' : 'var(--u-sf,#fff)', color: 'inherit' }} />
            </label>
          </div>
          <div style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--u-ink2,#4A5A54)' }}>Duration</span>
            <HrSelect value={f.duration} onChange={(v) => setF({ ...f, duration: v as LeaveDuration })} options={[{ value: 'FULL_DAY', label: 'Full days' }, { value: 'HALF_DAY_MORNING', label: 'Half day · morning' }, { value: 'HALF_DAY_AFTERNOON', label: 'Half day · afternoon' }]} />
          </div>
          <label style={{ display: 'grid', gap: 6 }}>
            <span style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 600, color: 'var(--u-ink2,#4A5A54)' }}>Reason *<span style={{ fontWeight: 500, color: 'var(--u-ink3,#6A7A73)' }}>{f.reason.length}/{REASON_MAX}</span></span>
            <textarea value={f.reason} maxLength={REASON_MAX} rows={3} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="At least 10 characters"
              style={{ font: 'inherit', fontSize: 14, padding: '9px 12px', border: '1px solid var(--u-ln,#E3E9E6)', borderRadius: 10, outline: 'none', resize: 'vertical', background: 'var(--u-sf,#fff)', color: 'inherit' }} />
          </label>
          {overlap && <Note tone="red">You already have leave requested or approved on these dates.</Note>}
          {clash.length > 0 && !refusal && (
            <Note tone="amber">
              {clash.slice(0, 3).join(', ')}{clash.length > 3 ? ` and ${clash.length - 3} more` : ''} {clash.length === 1 ? 'is' : 'are'} already off then. Your approver may ask you to move a day.
            </Note>
          )}
          {refusal && <Note tone="red">{refusal}</Note>}
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingTop: 4, borderTop: '1px solid var(--u-ln2,#EDF1EF)' }}>
            <span style={{ fontSize: 12.5, color: problem ? 'var(--u-ink3,#6A7A73)' : 'var(--u-brt,#0F6E56)', fontWeight: 600 }}>
              {problem || `${days(Number(count))} of leave${!half ? ' · weekly offs and holidays skipped' : ''}`}
            </span>
            <HrButton onClick={submit} disabled={blocked}>{apply.isPending ? 'Sending…' : 'Send request'}</HrButton>
          </div>
        </div>
      </Panel>
      <Panel title="Your request" sub={`Leave year ${new Date().getFullYear()}`}>
        <Facts items={[
          { k: 'Working days', v: f.startDate && end ? days(Number(count)) : '—' },
          { k: b ? `${b.leaveTypeName} after this` : 'Balance after', v: b && typeof preview.data?.balanceAfter === 'number' ? days(preview.data.balanceAfter) : b ? days(Math.max(0, b.available - Number(count))) : '—' },
          { k: 'Approver', v: approverName || '—' },
        ]} />
        {bal.isLoading ? <State kind="loading" height={120} /> : (bal.data ?? []).length === 0
          ? <Note>No leave balances yet. Ask HR to set up leave types for your company.</Note>
          : <>
            <SubHeading>Balances</SubHeading>
            <Facts items={(bal.data ?? []).map((x) => ({ k: x.leaveTypeName, v: `${days(x.available)} left` }))} />
          </>}
        <Note>Weekends and holidays aren’t counted. You can cancel until the leave starts.</Note>
      </Panel>
    </div>
  )
}

// ── Balances (self) with next credit / reset / carry-forward cap notes ──────
function Balances() {
  const q = useMyBalances(new Date().getFullYear())
  const ledger = useMyLeaveLedger()
  if (q.isLoading) return <State kind="loading" height={140} />
  if (q.error) return <State kind="error" title="Couldn’t load your balances" description={errMsg(q.error)} onRetry={() => q.refetch()} />
  if (!(q.data ?? []).length) return <State kind="empty" icon="calendarDays" title="No leave balances yet" description="Ask HR to set up leave types for your company." />
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(min(100%,240px),1fr))', gap: 12 }}>
        {(q.data ?? []).map((b) => {
          const total = b.totalEntitlement + b.carryForward, pct = total ? Math.min(100, (b.used / total) * 100) : 0
          const notes: string[] = []
          if (b.nextCredit) notes.push(`+${days(b.nextCredit.days)} on ${dmy(b.nextCredit.on)}`)
          if (b.resetDate) notes.push(`Resets on ${dmy(b.resetDate)}`)
          if (b.carryForwardCap && b.carryForwardCap > 0) notes.push(`Carries up to ${days(b.carryForwardCap)}`)
          return (
            <div key={b.id} style={{ ...CARD, padding: '16px 18px', display: 'grid', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                <strong style={{ fontSize: 14 }}>{b.leaveTypeName}</strong>
                <span style={{ fontFamily: HEAD_FONT, fontSize: 24, fontWeight: 600, color: 'var(--u-brt,#0F6E56)' }}>
                  {Number.isInteger(b.available) ? b.available : b.available.toFixed(1)}
                </span>
              </div>
              <div aria-hidden="true" style={{ height: 6, borderRadius: 4, background: 'var(--u-hv,#F0F4F2)', overflow: 'hidden' }}>
                <div style={{ width: `${pct}%`, height: '100%', background: pct > 80 ? 'var(--u-rdt,#B42318)' : pct > 50 ? 'var(--u-gd,#C8912E)' : 'var(--u-br,#0F6E56)' }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, color: 'var(--u-ink3,#6A7A73)' }}>
                <span>{days(b.used)} used</span><span>{days(total)} in all</span>
              </div>
              {(b.pending > 0 || b.carryForward > 0) && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {b.pending > 0 && <HrStatusPill tone="warn">{`${days(b.pending)} pending`}</HrStatusPill>}
                  {b.carryForward > 0 && <HrStatusPill tone="blue">{`${days(b.carryForward)} carried forward`}</HrStatusPill>}
                </div>
              )}
              {notes.length > 0 && (
                <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 2, fontSize: 12, color: 'var(--u-ink3,#6A7A73)' }}>
                  {notes.map((n) => <li key={n}>{n}</li>)}
                </ul>
              )}
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

// ── Approvals (leave + WFH queue, PENDING_L2 for HR, bulk, Undo) ────────────

interface ApproverRow {
  id: string; kind: 'leave' | 'wfh' | 'leaveL2'
  name: string; sub: string; createdAt: string
  typeLabel: string; typeTint: [string, string]
  dates: string; daysLabel: string
  reason: string
  balanceAfter?: string | null
  conflicts: string[]
  canDecide: boolean
  rejectNeedsReason: boolean
  status: LeaveApprovalStatus
}

type Segment = 'pending' | 'approved' | 'rejected' | 'all'
const SEG_LABEL: Record<Segment, string> = { pending: 'Pending', approved: 'Approved', rejected: 'Rejected', all: 'All' }

/**
 * The approver's queue (Approvals) or what they already decided (Decided,
 * `decided`): the same list, but Decided opens on every decision and has no
 * Pending filter (audit 5 Oct 2026: it opened on the pending queue, so the two
 * tabs looked identical).
 */
function Approvals({ toast, decided = false }: { toast: (m: string, err?: boolean, d?: string) => void; decided?: boolean }) {
  const canLeave = usePermission(P.HRMS_LEAVE_APPROVE_L1)
  const canWfh = usePermission(P.WFH_APPROVE)
  const canL2 = usePermission(P.HRMS_LEAVE_APPROVE_L2)
  const segments: Segment[] = decided ? ['approved', 'rejected', 'all'] : ['pending', 'approved', 'rejected', 'all']
  const [seg, setSeg] = useState<Segment>(decided ? 'all' : 'pending')
  const [page, setPage] = useState(0)

  // Pending queues (polled). PENDING_L2 only for HR holders.
  const l1 = usePendingApprovals(page, canLeave)
  const l2 = usePendingL2Approvals(page, 20, canLeave && canL2)
  const wq = usePendingWfhApprovals(page, 20, canWfh)
  const stats = useLeaveApprovalStats(7, canLeave)
  const history = useApprovalsHistory(page, seg === 'all' ? undefined : (seg === 'pending' ? undefined : (seg.toUpperCase() as DecidedStatus)))
  const recent = useRecentDecisions({ enabled: canLeave })
  const decide = useLeaveDecision()
  const decideL2 = useLeaveL2Decision()
  const decideWfh = useWfhDecision()
  const bulk = useLeaveBulkDecision()
  const undo = useDecisionUndo()
  // Local note per card.
  const [notes, setNotes] = useState<Record<string, string>>({})
  const setNote = (id: string, v: string) => setNotes((n) => ({ ...n, [id]: v }))

  const l1Rows = l1.data?.content ?? []
  const l2Rows = l2.data?.content ?? []
  const wfhRows = wq.data?.content ?? []
  const histRows = history.data?.content ?? []

  const asLeave = (r: LeaveRequestResponse, kind: 'leave' | 'leaveL2'): ApproverRow => ({
    id: r.id, kind, name: r.employeeName || 'Employee',
    sub: [r.employeeCode, r.departmentName].filter(Boolean).join(' · ') || 'applied ' + stamp(r.createdAt),
    createdAt: r.createdAt,
    typeLabel: r.leaveTypeName || 'Leave',
    typeTint: typeChipColour(r.leaveTypeCategory),
    dates: range(r.startDate, r.endDate),
    daysLabel: days(Number(r.totalDays)),
    reason: r.reason || '—',
    balanceAfter: typeof r.balanceAvailable === 'number' ? `${days(r.balanceAvailable)} left after this` : null,
    conflicts: (r.conflicts || []).map((c) => c.text),
    canDecide: true, rejectNeedsReason: false, status: r.status,
  })

  const pendingLeave = [...l1Rows.map((r) => asLeave(r, 'leave')), ...(canL2 ? l2Rows.map((r) => asLeave(r, 'leaveL2')) : [])]
  const pendingWfh: ApproverRow[] = wfhRows.map((w) => {
    const n = Math.max(1, Math.round((new Date(w.toDate).getTime() - new Date(w.fromDate).getTime()) / 864e5) + 1)
    return {
      id: w.id, kind: 'wfh',
      name: w.employeeName || 'Employee',
      sub: [w.employeeCode, w.departmentName].filter(Boolean).join(' · ') || 'applied ' + stamp(w.createdAt),
      createdAt: w.createdAt,
      typeLabel: 'Work from home',
      typeTint: ['var(--u-brs,#E8F3EE)', 'var(--u-brt,#0F6E56)'],
      dates: range(w.fromDate, w.toDate),
      daysLabel: days(n),
      reason: w.reason || '—',
      balanceAfter: null,
      conflicts: [],
      canDecide: true,
      rejectNeedsReason: true,
      status: w.status,
    }
  })
  const pending = [...pendingLeave, ...pendingWfh].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
  const cleanPending = pendingLeave.filter((r) => r.conflicts.length === 0)
  const waiting = (l1.data?.totalElements ?? 0) + (canL2 ? (l2.data?.totalElements ?? 0) : 0) + (wq.data?.totalElements ?? 0)
  const counts = history.data?.counts ?? null

  // Stat tiles (BW-37)
  const month = new Date().toLocaleString('en-GB', { month: 'long' })
  const avgSpark = (stats.data?.months ?? []).map((m) => m.avgDecisionHours ?? 0)
  const tiles: Tile[] = [
    { icon: 'inbox', color: 'orange', label: 'Waiting for you', value: String(stats.data?.waiting ?? waiting),
      sub: typeof stats.data?.newLast24h === 'number' ? `${stats.data.newLast24h} new in the last 24 h` : 'Requests to decide' },
    { icon: 'checkCircle', color: 'green', label: `Approved in ${month}`, value: String(stats.data?.approvedThisMonth ?? 0),
      sub: typeof stats.data?.approvedLastMonth === 'number' ? `vs ${stats.data.approvedLastMonth} last month` : 'This calendar month' },
    { icon: 'calendarDays', color: 'blue', label: 'On leave today', value: String(stats.data?.onLeaveToday ?? 0),
      sub: stats.data?.nextWorkingDay ? `${stats.data.onLeaveNextWorkingDay} on ${dmy(stats.data.nextWorkingDay)}` : 'Approved leave covering today' },
    { icon: 'clock', color: 'teal', label: 'Average approval time', value: hr(stats.data?.avgDecisionHours ?? null),
      sub: avgSpark.length ? `Last ${avgSpark.length} months` : 'Over the last 7 months' },
  ]

  const onApprove = async (r: ApproverRow) => {
    const note = (notes[r.id] || '').trim()
    try {
      if (r.kind === 'wfh') await decideWfh.mutateAsync({ requestId: r.id, approved: true, comment: note || undefined })
      else if (r.kind === 'leaveL2') await decideL2.mutateAsync({ requestId: r.id, status: 'APPROVED', comment: note || undefined })
      else await decide.mutateAsync({ requestId: r.id, status: 'APPROVED', comment: note || undefined })
      toast(`${r.kind === 'wfh' ? 'Work from home' : 'Leave'} approved`, false, 'You can take it back for 10 minutes.')
    } catch (e) { toast('Couldn’t save the decision', true, errMsg(e)) }
  }
  const onReject = async (r: ApproverRow) => {
    const note = (notes[r.id] || '').trim()
    if (r.rejectNeedsReason && !note) { toast('Add a note to reject a work-from-home request', true); return }
    try {
      if (r.kind === 'wfh') await decideWfh.mutateAsync({ requestId: r.id, approved: false, comment: note || undefined })
      else if (r.kind === 'leaveL2') await decideL2.mutateAsync({ requestId: r.id, status: 'REJECTED', comment: note || undefined })
      else await decide.mutateAsync({ requestId: r.id, status: 'REJECTED', comment: note || undefined })
      toast(`${r.kind === 'wfh' ? 'Work from home' : 'Leave'} rejected`, false, 'You can take it back for 10 minutes.')
    } catch (e) { toast('Couldn’t save the decision', true, errMsg(e)) }
  }
  const onBulkApprove = async () => {
    const ids = cleanPending.map((r) => r.id)
    if (!ids.length) return
    try {
      await bulk.mutateAsync({ ids, status: 'APPROVED', comment: 'Bulk approve · no conflicts' })
      toast(`Approved ${ids.length} requests with no conflicts`, false, 'Each can still be taken back for 10 minutes.')
    } catch (e) { toast('Couldn’t approve the batch', true, errMsg(e)) }
  }

  // Undo offers (recent decisions still inside the 10-minute window).
  const now = Date.now()
  const undoable = (recent.data ?? []).filter((d) => (d.kind === 'LEAVE' || d.kind === 'WFH') && Date.parse(d.undoUntil) > now)
  const doUndo = async (kind: 'LEAVE' | 'WFH', requestId: string) => {
    try {
      const result = await undo.mutateAsync({ kind, requestId })
      if (!result.available) { toast('Undo isn’t switched on yet', true); return }
      toast('Decision taken back', false, result.value.employeeName ? `${result.value.employeeName} is waiting again.` : undefined)
    } catch (e) { toast('Couldn’t take back the decision', true, errMsg(e)) }
  }

  const loading = seg === 'pending' ? (l1.isLoading || wq.isLoading || (canL2 && l2.isLoading)) : history.isLoading
  const visiblePending = seg === 'pending' ? pending : []
  const decidedShown = (seg === 'pending' ? [] : histRows)
  // Missing statuses count 0 (an older server only sends the ones that occur;
  // the sum was NaN). Decided's "All" is every decision; the queue's adds what waits.
  const segCount = (s: Segment) =>
    s === 'pending' ? waiting
      : s === 'all' ? (decided ? 0 : waiting) + decidedTotal(counts)
        : decidedCount(counts, s.toUpperCase() as DecidedStatus)

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {stats.isLoading
        ? <State kind="loading" height={132} />
        : stats.error
          ? <StatRow tiles={tiles} />
          : <StatRow tiles={tiles} />}

      {undoable.length > 0 && (
        <section aria-label="Recent decisions" style={{ ...CARD, padding: 14, display: 'grid', gap: 10 }}>
          <strong style={{ fontSize: 13, color: 'var(--u-ink2,#4A5A54)' }}>You can still take these back</strong>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 6 }}>
            {undoable.map((d) => (
              <li key={d.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, fontSize: 13 }}>
                <span>{d.summary}<span style={{ color: 'var(--u-ink3,#6A7A73)' }}> · {d.decision === 'APPROVED' ? 'approved' : 'rejected'} {stamp(d.decidedAt)}</span></span>
                <Button variant="ghost" size={32} onClick={() => doUndo(d.kind as 'LEAVE' | 'WFH', d.requestId)}
                  disabled={undo.isPending}>Undo</Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <div role="tablist" aria-label="Request filter" style={{ display: 'inline-flex', padding: 3, borderRadius: 10, background: 'var(--u-hv,#F0F4F2)' }}>
          {segments.map((s) => {
            const active = seg === s
            return (
              <button key={s} role="tab" aria-selected={active}
                onClick={() => { setSeg(s); setPage(0) }}
                style={{ height: 30, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '0 12px', border: 0, borderRadius: 8,
                  background: active ? 'var(--u-sf,#fff)' : 'transparent',
                  color: active ? 'var(--u-ink,#0E1B16)' : 'var(--u-ink3,#6A7A73)',
                  font: 'inherit', fontSize: 13, fontWeight: 500, cursor: 'pointer',
                  boxShadow: active ? '0 1px 2px rgba(14,27,22,.1)' : undefined }}>
                {SEG_LABEL[s]}
                <span style={{ fontSize: 11.5, color: 'var(--u-ink3,#6A7A73)' }}>{segCount(s)}</span>
              </button>
            )
          })}
        </div>
        {seg === 'pending' && cleanPending.length > 1 && (
          <Button variant="primary" icon="check" onClick={onBulkApprove} disabled={bulk.isPending}>
            {bulk.isPending ? 'Approving…' : `Approve all without conflicts (${cleanPending.length})`}
          </Button>
        )}
      </div>

      <SubHeading>{seg === 'pending' ? 'Waiting for your OK' : 'Already decided'}</SubHeading>

      {loading ? <State kind="loading" />
        : (seg !== 'pending' && history.error) ? <State kind="error" title="Couldn’t load decisions" description={errMsg(history.error)} onRetry={() => history.refetch()} />
        : (seg === 'pending' && l1.error && wq.error) ? <State kind="error" title="Couldn’t load requests" description="Leave and work-from-home requests didn’t load." onRetry={() => { l1.refetch(); wq.refetch() }} />
          : (seg === 'pending' && visiblePending.length === 0) ? <State kind="empty" icon="checkCircle" title="All caught up" description="No requests are waiting for you." />
            : (seg !== 'pending' && decidedShown.length === 0) ? <State kind="empty" icon="fileText" title="No decisions yet" description="Leave you decide shows up here." />
              : (
                <div style={{ display: 'grid', gap: 10 }}>
                  {seg === 'pending' && visiblePending.map((r) => (
                    <ApproverCard key={r.id} r={r} note={notes[r.id] || ''} onNote={(v) => setNote(r.id, v)} onApprove={() => onApprove(r)} onReject={() => onReject(r)} busy={decide.isPending || decideL2.isPending || decideWfh.isPending} />
                  ))}
                  {seg !== 'pending' && (
                    <RowList>
                      {decidedShown.map((l) => (
                        <Row key={l.id}
                          title={`${l.employeeName || 'Employee'}${l.employeeCode ? ` · ${l.employeeCode}` : ''}`}
                          meta={`${l.leaveTypeName || 'Leave'} · ${range(l.startDate, l.endDate)} · ${days(Number(l.totalDays))}${l.departmentName ? ` · ${l.departmentName}` : ''}${l.decidedByName ? ` · by ${l.decidedByName}` : ''}`}
                          note={l.approverComment ? `Note: “${l.approverComment}”` : l.reason ? `“${l.reason}”` : undefined}
                          trail={pill(l.status)} />
                      ))}
                    </RowList>
                  )}
                </div>
              )}

      {(waiting > 20 || (history.data?.totalElements ?? 0) > 20) && (
        <HrPagination page={page} pageSize={20}
          totalElements={seg === 'pending' ? waiting : history.data?.totalElements ?? 0}
          totalPages={Math.ceil((seg === 'pending' ? waiting : history.data?.totalElements ?? 0) / 20)}
          onPageChange={setPage} />
      )}
    </div>
  )
}

/** One request card, in the design's PgLeave row style (avatar, type chip,
 *  dates/days, reason, balance line, amber conflict triangle, Reject/Approve). */
function ApproverCard({ r, note, onNote, onApprove, onReject, busy }: {
  r: ApproverRow; note: string; onNote: (v: string) => void
  onApprove: () => void; onReject: () => void; busy: boolean
}) {
  const [tbg, tfg] = r.typeTint
  const initials = r.name.split(/\s+/).map((p) => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()
  return (
    <article data-rise="" style={{ ...CARD, padding: '16px 20px', display: 'flex', flexWrap: 'wrap', gap: '12px 18px', alignItems: 'center', fontFamily: FONT }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flex: '1 1 220px' }}>
        <span aria-hidden="true" style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--u-brs2,#D2EADF)', color: 'var(--u-brt,#0F6E56)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 500 }}>{initials || '?'}</span>
        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: 14, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
          <span style={{ fontSize: 12.5, color: 'var(--u-ink3,#6A7A73)' }}>{r.sub} · applied {stamp(r.createdAt)}</span>
        </div>
      </div>
      <div style={{ flex: '2 1 260px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 500, lineHeight: '22px', padding: '0 8px', borderRadius: 7, background: tbg, color: tfg }}>{r.typeLabel}</span>
          <span style={{ fontSize: 14, fontWeight: 500 }}>{r.dates}</span>
          <span style={{ fontSize: 13, color: 'var(--u-ink3,#6A7A73)' }}>· {r.daysLabel}</span>
          {r.status === 'PENDING_L2' && <HrStatusPill tone="purple">Awaiting HR</HrStatusPill>}
        </div>
        <div style={{ fontSize: 13, color: 'var(--u-ink2,#4A5A54)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>“{r.reason}”</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', fontSize: 12.5 }}>
          {r.balanceAfter && <span style={{ color: 'var(--u-ink3,#6A7A73)' }}>{r.balanceAfter}</span>}
          {r.conflicts.map((c) => (
            <span key={c} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--u-gdt,#8A5A10)', fontWeight: 500 }}>
              <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3M12 9v4M12 17h.01" /></svg>
              {c}
            </span>
          ))}
        </div>
        <textarea
          value={note}
          onChange={(e) => onNote(e.target.value)}
          rows={1}
          placeholder={r.rejectNeedsReason ? 'Add a note (required to reject)' : 'Add a note (optional)'}
          aria-label={`Note on ${r.name}'s ${r.typeLabel.toLowerCase()}`}
          style={{ font: 'inherit', fontSize: 13, padding: '6px 10px', border: '1px solid var(--u-ln,#E3E9E6)', borderRadius: 8, background: 'var(--u-sf2,#F7F9F8)', color: 'inherit', minWidth: 0, resize: 'vertical' }}
        />
      </div>
      {r.canDecide && (
        <div style={{ display: 'flex', gap: 8, flexShrink: 0, marginLeft: 'auto' }}>
          <HrButton variant="ghost" onClick={onReject} disabled={busy}>Reject</HrButton>
          <HrButton onClick={onApprove} disabled={busy}>{dashIcon('check', 14)} Approve</HrButton>
        </div>
      )}
    </article>
  )
}

// Satisfies the ApprovalList unused-type guard for the file (kept for future bulk card).
const _unusedApproval: Approval | null = null
void _unusedApproval

// ── Page ────────────────────────────────────────────────────────────────────
export function Leave() {
  const { isAdmin } = useRoles()
  const canApprove = usePermission(P.HRMS_LEAVE_APPROVE_L1)
  const canEditHolidays = usePermission(P.SETTINGS_HOLIDAYS_WRITE)
  const canWfhApprove = usePermission(P.WFH_APPROVE)
  const canEncashSelf = usePermission('leave.request.self') && !isAdmin
  const canEncashApprove = usePermission('hrms.leave.encash.approve')
  const canYearEnd = usePermission('hrms.leave.yearend.run')
  const canEmpRead = usePermission('hrms.leave.employee.read')
  const canReportLeave = usePermission('hrms.report.leave')
  const canAllBalances = canEmpRead || canReportLeave
  const canApplyOnBehalf = usePermission('hrms.leave.apply.others')
  const canLeaveL2 = usePermission(P.HRMS_LEAVE_APPROVE_L2)
  const pendEncash = useEncashments('PENDING', canEncashApprove)
  const pend = usePendingApprovals(0, canApprove)
  const pendL2 = usePendingL2Approvals(0, 20, canApprove && canLeaveL2)
  const pendWfh = usePendingWfhApprovals(0, 20, canApprove && canWfhApprove)
  const waiting = canApprove ? (pend.data?.totalElements ?? 0) + (pendL2.data?.totalElements ?? 0) + (pendWfh.data?.totalElements ?? 0) : 0
  const { show, node } = useDesignToast()
  const [onBehalf, setOnBehalf] = useState(false)

  // The design puts the new "All balances" tab AFTER Decided; its key is
  // `all-balances` (DECISIONS §5.3; pageRegistry already has it under
  // pkg: 'P-LEAVE', so the launcher/deep-link only shows it once READY_PAGES
  // includes P-LEAVE — see the report).
  const views = [
    !isAdmin && { key: 'my', label: 'My leave', icon: 'calendarDays' },
    !isAdmin && { key: 'apply', label: 'Apply', icon: 'plus' },
    !isAdmin && { key: 'balances', label: 'Balances', icon: 'chart' },
    canApprove && { key: 'approvals', label: 'Approvals', icon: 'inbox', count: waiting || undefined, urgent: waiting > 0 },
    canApprove && { key: 'history', label: 'Decided', icon: 'checkCircle' },
    canAllBalances && { key: 'all-balances', label: 'All balances', icon: 'users' },
    (canEncashSelf || canEncashApprove) && { key: 'encash', label: 'Encash', icon: 'banknote', count: canEncashApprove ? (pendEncash.data?.length || undefined) : undefined, urgent: canEncashApprove && (pendEncash.data?.length ?? 0) > 0 },
    canYearEnd && { key: 'yearend', label: 'Year end', icon: 'calendarCheck' },
    { key: 'calendar', label: 'Calendar', icon: 'calendar' },
    { key: 'types', label: 'Leave types', icon: 'list' },
    { key: 'holidays', label: 'Holidays', icon: 'sun' },
  ].filter(Boolean) as { key: string; label: string; icon: string; count?: number; urgent?: boolean }[]
  const [view, setView] = useView(views.map((v) => v.key), 'tab')
  const subtitle = isAdmin
    ? 'Approve requests, see every balance, and manage leave types and holidays.'
    : canApprove ? 'Apply for leave, track your balance, and decide your team’s requests.' : 'Apply for leave and track your balance.'

  const actions = (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {!isAdmin && view !== 'apply' && <HrButton variant="ghost" onClick={() => setView('apply')}>{dashIcon('plus', 15)} Apply for leave</HrButton>}
      {canApplyOnBehalf && <HrButton onClick={() => setOnBehalf(true)}>{dashIcon('plus', 15)} Apply on behalf</HrButton>}
    </div>
  )

  return (
    <ModulePage crumb="Leave" title="Leave" subtitle={subtitle} actions={actions}>
      <div style={{ display: 'grid', gap: 16, minWidth: 0 }}>
        {/* Inline pill tabs; never header (SHELL CONTRACT UPDATE). */}
        <Views items={views} active={view} onChange={setView} label="Leave views" placement="inline" />
        {view === 'my' && <MyLeave toast={show} />}
        {view === 'apply' && <Apply onDone={() => setView('my')} toast={show} />}
        {view === 'balances' && <Balances />}
        {view === 'approvals' && <Approvals toast={show} />}
        {view === 'history' && <Approvals toast={show} decided />}
        {view === 'all-balances' && canAllBalances && <AllBalances />}
        {view === 'encash' && canEncashApprove && <EncashmentAdmin toast={show} />}
        {view === 'encash' && canEncashSelf && canEncashApprove && <SubHeading>Your own encashment</SubHeading>}
        {view === 'encash' && canEncashSelf && <MyEncashment toast={show} />}
        {view === 'yearend' && <LeaveYearEnd toast={show} />}
        {view === 'calendar' && <LeaveCalendar />}
        {view === 'types' && <LeaveTypes embedded />}
        {view === 'holidays' && <HolidayCalendar canEdit={canEditHolidays} embedded />}
      </div>
      <ApplyOnBehalfPanel open={onBehalf} onClose={() => setOnBehalf(false)} />
      {node}
    </ModulePage>
  )
}
