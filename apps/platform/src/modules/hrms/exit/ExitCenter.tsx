// Resignation & exit (/hrms/exit) on the redesign kit (P-GROW; prototype PgGrow x-res). Who is
// leaving, in three views kept in ?tab= (notice · exited · terminated, the registry's keys):
//   - On notice: notice started, last working day, days left, reason; Edit dates (with Withdraw
//     notice) and Mark exited.
//   - Exited / Terminated: last working day, exit type or reason, and their full & final status
//     (BW-64), which opens the matching Full & final tab.
// Data: BW-91 exit lists (reason and department; hrms.employee.write), BW-90 counts (exited this
// year), BW-64 F&F status (hrms.fnf.read). Without employee.write the lists come from the
// directory, as before, without the reason (it's for HR only). The route needs employee.read or
// .write; actions need .write; F&F links need fnf.read / fnf.process.
import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { usePermission } from '@unifiedtree/sdk'
import {
  Button, Callout, CellActions, CellPerson, EmptyState, KeyValueGrid, MiniStat, MiniStatGrid, PageFrame, PageHeader, PillTabs, Section, StatusPill, Table,
  errorText, type TableColumn,
} from '@/design/kit/display'
import { Pager } from '@/design/kit/data'
import { DateInput, Dialog, Input, PanelButton, Select, SidePanel, Textarea, useToast } from '@/design/kit/overlays'
import { istToday } from '@/design/dc/dates'
import {
  useCancelNotice, useEmployeeCounts, useEmployeeDirectory, useExitEmployee, useStartNotice, useUpdateWorkforceEmployee,
  EXIT_TYPES, exitTypeLabel, type ExitType, type WorkforceEmployee,
} from '../api/useWorkforce'
import { useEmployeeStats } from '../api/shared/useEmployeeStats'
import { useFnfStatus } from '../api/shared/useFnfStatus'
import { daysLeft, dayMon, fnfState } from '../performance/growModel'
import { useDebounce } from '@/shared/hooks/useDebounce'
import { exitName, useExitList, type ExitRow, type ExitStatus } from './useExits'
import '../performance/grow.css'

type Tab = 'notice' | 'exited' | 'terminated'
const TABS: { key: Tab; label: string; status: ExitStatus; sub: string }[] = [
  { key: 'notice', label: 'On notice', status: 'NOTICE_PERIOD', sub: 'Serving their notice period.' },
  { key: 'exited', label: 'Exited', status: 'EXITED', sub: 'Left the company.' },
  { key: 'terminated', label: 'Terminated', status: 'TERMINATED', sub: 'Employment ended by the company.' },
]
const PAGE = 20
const toRow = (e: WorkforceEmployee): ExitRow => ({
  employeeId: e.id, companyId: e.companyId, employeeCode: e.employeeCode, firstName: e.firstName, lastName: e.lastName,
  departmentId: e.departmentId ?? null, departmentName: null, employmentStatus: e.employmentStatus as ExitStatus,
  noticeStartDate: e.noticeStartDate ?? null, lastWorkingDay: e.lastWorkingDay ?? null, exitType: e.exitType ?? null, exitReason: null,
})

export function ExitCenter() {
  const canRead = usePermission('hrms.employee.read')
  const canWrite = usePermission('hrms.employee.write')
  const canSettle = usePermission('hrms.fnf.read')
  const canProcess = usePermission('hrms.fnf.process')
  const navigate = useNavigate()
  const today = istToday()
  const [params, setParams] = useSearchParams()
  const tab: Tab = TABS.find((t) => t.key === params.get('tab'))?.key ?? 'notice'
  const current = TABS.find((t) => t.key === tab)!
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [starting, setStarting] = useState(false)
  const [editing, setEditing] = useState<ExitRow | null>(null)
  const [exiting, setExiting] = useState<ExitRow | null>(null)
  const [confirming, setConfirming] = useState<ExitRow | null>(null)
  // Typing must not fire a request per keystroke; the server does the matching either way.
  const query = useDebounce(search.trim(), 300)
  const searching = query.length > 0
  const stats = useEmployeeStats(undefined, { enabled: canRead })
  const counts = useEmployeeCounts(undefined, { enabled: canRead && stats.notAvailable })
  // HR (employee.write): the exit list with reasons; the search and the paging are the server's.
  const exits = useExitList(current.status, page, PAGE, query, { enabled: canWrite })
  // Read-only: the directory, as before (no reason).
  const dir = useEmployeeDirectory({ status: current.status, search: query || undefined, page, pageSize: PAGE }, { enabled: canRead && !canWrite })
  const exitEmployee = useExitEmployee()
  const rows: ExitRow[] = useMemo(() => (
    canWrite ? exits.data?.content ?? [] : (dir.data?.content ?? []).map(toRow)
  ), [canWrite, exits.data, dir.data])
  const total = (canWrite ? exits.data?.totalElements : dir.data?.totalElements) ?? 0
  const list = canWrite ? exits : dir
  const fnf = useFnfStatus(tab === 'notice' ? [] : rows.map((r) => r.employeeId), { enabled: canSettle })
  const fnfOf = useMemo(() => new Map((fnf.data ?? []).map((f) => [f.employeeId, f])), [fnf.data])

  const setTab = (next: string) => {
    const sp = new URLSearchParams(params)
    sp.set('tab', next)
    setParams(sp, { replace: true })
    setPage(0)
  }
  const markExited = (r: ExitRow) => {
    if (!r.lastWorkingDay) { setEditing(r); return }
    if (!r.exitType) { setExiting(r); return }
    // Exit type already recorded: confirm first — it's hard to undo (they lose access and move lists).
    setConfirming(r)
  }

  const person: TableColumn<ExitRow> = {
    key: 'employee', header: 'Employee', primary: true, render: (r) => (
      <Link to={`/hrms/employees/${r.employeeId}?tab=exit`} className="grw-link" style={{ color: 'inherit' }}>
        <CellPerson name={exitName(r)} sub={r.departmentName || r.employeeCode} />
      </Link>
    ),
  }
  const reason: TableColumn<ExitRow> = { key: 'reason', header: 'Reason', render: (r) => <span className="grw-clip" style={{ maxWidth: 220 }} title={r.exitReason || undefined}>{r.exitReason || '—'}</span> }
  const settlement: TableColumn<ExitRow> = {
    key: 'fnf', header: 'Full & final', render: (r) => {
      if (!canSettle) return '—'
      if (fnf.notAvailable) return <span className="grw-muted">—</span>
      const s = fnfState(fnfOf.get(r.employeeId)?.status)
      return fnf.isLoading ? <span className="grw-muted">…</span> : <StatusPill tone={s.tone}>{s.label}</StatusPill>
    },
  }
  const leaverActions: TableColumn<ExitRow> = {
    key: 'act', header: <span className="uk-sr">Actions</span>, label: 'Actions', align: 'right', render: (r) => {
      const s = fnfState(fnfOf.get(r.employeeId)?.status)
      const href = s.tab ? `/hrms/fnf?tab=${s.tab}` : canProcess ? `/hrms/fnf?tab=create&employeeId=${r.employeeId}` : '/hrms/fnf'
      return (
        <CellActions>
          {(canSettle || canProcess) && <Button variant="soft" size={30} onClick={() => navigate(href)}>Settlement</Button>}
          <Button variant="secondary" size={30} onClick={() => navigate(`/hrms/employees/${r.employeeId}?tab=exit`)}>Profile</Button>
        </CellActions>
      )
    },
  }
  const columns: TableColumn<ExitRow>[] = tab === 'notice' ? [
    person,
    { key: 'start', header: 'Notice started', render: (r) => dayMon(r.noticeStartDate, today) },
    { key: 'lwd', header: 'Last working day', render: (r) => dayMon(r.lastWorkingDay, today) },
    { key: 'left', header: 'Days left', render: (r) => <DaysLeft lwd={r.lastWorkingDay} today={today} /> },
    ...(canWrite ? [reason] : [{ key: 'type', header: 'Exit type', render: (r: ExitRow) => exitTypeLabel(r.exitType) }]),
    ...(canWrite ? [{
      key: 'act', header: <span className="uk-sr">Actions</span>, label: 'Actions', align: 'right' as const, render: (r: ExitRow) => (
        <CellActions>
          {canWrite && <Button variant="secondary" size={30} onClick={() => setEditing(r)}>Edit dates</Button>}
          {canWrite && <Button variant="soft" size={30} disabled={exitEmployee.isPending} onClick={() => markExited(r)}>Mark exited</Button>}
        </CellActions>
      ),
    }] : []),
  ] : tab === 'exited' ? [
    person,
    { key: 'lwd', header: 'Last working day', render: (r) => dayMon(r.lastWorkingDay, today) },
    { key: 'type', header: 'Exit type', render: (r) => exitTypeLabel(r.exitType) },
    settlement, leaverActions,
  ] : [
    person,
    { key: 'lwd', header: 'Last working day', render: (r) => dayMon(r.lastWorkingDay, today) },
    ...(canWrite ? [reason] : [{ key: 'type', header: 'Exit type', render: (r: ExitRow) => exitTypeLabel(r.exitType) }]),
    settlement, leaverActions,
  ]

  if (!canRead && !canWrite) {
    return (
      <PageFrame label="Resignation & exit">
        <PageHeader eyebrow="Employee exit" title="Resignation & exit" />
        <EmptyState icon="lock" title="No access to employee exits" hint="Ask an admin if you need to see who is leaving." />
      </PageFrame>
    )
  }
  const s = stats.data
  const c = counts.data
  const empty = tab === 'notice' ? (searching ? 'No one on notice matches this search.' : 'No one is serving notice.')
    : searching ? 'No leavers match this search.' : tab === 'exited' ? 'No exited employees yet.' : 'No terminated employees.'
  return (
    <PageFrame label="Resignation & exit" className="grw-page">
      <PageHeader eyebrow="Employee exit" title="Resignation & exit" sub={current.sub}
        actions={canWrite ? <Button variant="primary" icon="plus" onClick={() => setStarting(true)}>Start notice period</Button> : undefined} />
      <PillTabs label="Exit views" semantics="toggle" activeKey={tab} onSelect={setTab}
        items={TABS.map((t) => ({ key: t.key, label: t.label }))} />
      <Section title="Leavers" loading={stats.isLoading || (stats.notAvailable && counts.isLoading)} skeleton="stats" error={stats.error ?? counts.error}
        onRetry={() => { void stats.refetch(); void counts.refetch() }}>
        {(s || c) && (
          <MiniStatGrid>
            <MiniStat label="On notice" value={s ? s.counts.notice : c?.notice ?? 0} note="Serving their notice period" tone="warning" />
            {/* terminatedThisYear is the terminated share of exitedThisYear (same people, same year); a server
                from before it existed doesn't send it, so that case keeps the plain wording. */}
            <MiniStat label="Exited" value={s ? s.exitedThisYear : c?.exited ?? 0} tone="neutral"
              note={s ? (typeof s.terminatedThisYear === 'number'
                ? `This year: ${s.exitedThisYear - s.terminatedThisYear} resigned or left, ${s.terminatedThisYear} terminated`
                : 'Left this year, including terminations')
                : `Left the company, including terminations · ${c?.terminated ?? 0} terminated in all`} />
            <MiniStat label="Terminated" value={s ? s.counts.terminated : c?.terminated ?? 0} note="Employment ended by the company" tone="danger" />
          </MiniStatGrid>
        )}
      </Section>
      <Section title={current.label} body="flush" error={list.error} onRetry={() => list.refetch()}
        actions={<div style={{ width: 'min(100%, 300px)' }}><Input label={`Search ${current.label.toLowerCase()}`} type="search" value={search} placeholder="Name, code or department"
          onChange={(e) => { setSearch(e.target.value); setPage(0) }} /></div>}
        footer={total > PAGE ? <Pager page={page} pageSize={PAGE} total={total} onPageChange={setPage} noun="people" /> : undefined}>
        <Table label={current.label} columns={columns} rows={rows} rowKey={(r) => r.employeeId} loading={list.isLoading} mobile="cards"
          empty={<EmptyState variant="plain" icon="userMinus" title={empty}
            hint={tab === 'notice' ? 'Start a notice period from here or from an employee’s Exit tab.' : 'Employees appear here once HR marks them as exited or terminated.'}
            action={tab === 'notice' && canWrite && !searching ? <Button variant="primary" icon="plus" onClick={() => setStarting(true)}>Start notice period</Button> : undefined} />} />
      </Section>
      {starting && <StartNoticePanel onClose={() => setStarting(false)} onDone={() => { setStarting(false); setTab('notice') }} />}
      {editing && <SeparationPanel row={editing} onClose={() => setEditing(null)} />}
      {exiting && <MarkExitedPanel row={exiting} onClose={() => setExiting(null)} />}
      {confirming && <ConfirmExitDialog row={confirming} onClose={() => setConfirming(null)} />}
    </PageFrame>
  )
}

function DaysLeft({ lwd, today }: { lwd?: string | null; today: string }) {
  const left = daysLeft(lwd, today)
  if (left == null) return <span className="grw-muted">—</span>
  if (left < 0) return <StatusPill tone="danger">{`${Math.abs(left)} ${Math.abs(left) === 1 ? 'day' : 'days'} overdue`}</StatusPill>
  if (left === 0) return <StatusPill tone="warning">Last day today</StatusPill>
  return <span className="grw-num" style={left <= 7 ? { fontWeight: 500 } : undefined}>{left}</span>
}

function ExitTypeField({ value, onChange }: { value: ExitType | ''; onChange: (v: ExitType) => void }) {
  return (
    <Select label="Exit type" value={value} onChange={(e) => onChange(e.target.value as ExitType)}
      hint="Why the person is leaving. The attrition report counts the exit as resigned, terminated or other from it."
      options={[...(value ? [] : [{ value: '', label: 'Not recorded' }]), ...EXIT_TYPES.map((t) => ({ value: t.value, label: t.label }))]} />
  )
}

/** Pick an active employee and record their notice period (POST …/notice). */
function StartNoticePanel({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const start = useStartNotice()
  const toast = useToast()
  const [query, setQuery] = useState('')
  const [employee, setEmployee] = useState<WorkforceEmployee | null>(null)
  const [noticeStart, setNoticeStart] = useState(istToday())
  const [lastDay, setLastDay] = useState('')
  const [reason, setReason] = useState('')
  const [exitType, setExitType] = useState<ExitType>('RESIGNATION')
  const [error, setError] = useState('')
  // No status filter: new hires are PROBATION, not ACTIVE, and they resign too. Rows already leaving are disabled.
  const candidates = useEmployeeDirectory({ search: query.trim() || undefined, page: 0, pageSize: 8 }, { enabled: !employee && query.trim().length >= 2 })
  const eligible = (e: WorkforceEmployee) => e.employmentStatus === 'ACTIVE' || e.employmentStatus === 'PROBATION'
  const badOrder = Boolean(noticeStart && lastDay && lastDay < noticeStart)
  const blocked = !employee ? 'Choose the employee' : !noticeStart || !lastDay ? 'Set both dates' : badOrder ? 'The last working day is before the notice start' : null
  const save = async () => {
    if (!employee || blocked) return
    setError('')
    try {
      await start.mutateAsync({ id: employee.id, noticeStart, lastWorkingDay: lastDay, reason: reason.trim() || undefined, exitType })
      toast.success(`${exitName(employee)} is now serving notice until ${dayMon(lastDay)}`); onDone()
    } catch (e) { setError(errorText(e, 'Unable to start the notice period.')) }
  }
  return (
    <SidePanel open onClose={() => { if (!start.isPending) onClose() }} busy={start.isPending} width={540} title="Start notice period"
      sub="Last working day must be on or after the notice start date. They stay active with full access until you mark them exited."
      footer={<>
        <PanelButton variant="secondary" size="lg" disabled={start.isPending} onClick={onClose}>Cancel</PanelButton>
        <PanelButton variant="primary" size="lg" busy={start.isPending} blockedReason={blocked} onClick={save}>Start notice</PanelButton>
      </>}>
      <div className="grw-form">
        {employee ? (
          <div className="grw-row grw-row--between" style={{ padding: 12, borderRadius: 12, background: 'var(--u-sf2, #F7F9F8)' }}>
            <CellPerson name={exitName(employee)} sub={employee.employeeCode} />
            <Button variant="secondary" size={30} onClick={() => setEmployee(null)}>Change</Button>
          </div>
        ) : (
          <div className="grw-stack grw-stack--tight">
            <Input id="notice-employee-search" label="Employee" value={query} autoFocus onChange={(e) => setQuery(e.target.value)} placeholder="Type at least 2 characters of a name, code or email" />
            {query.trim().length >= 2 && (
              <div className="grw-results" role="listbox" aria-label="Matching active employees">
                {candidates.isPending ? <p className="grw-muted" role="status" style={{ margin: 0, padding: 12 }}>Searching…</p>
                  : candidates.isError ? <p role="alert" style={{ margin: 0, padding: 12, color: 'var(--u-rdt, #B42318)' }}>Unable to search employees.</p>
                    : (candidates.data?.content ?? []).length === 0 ? <p className="grw-muted" style={{ margin: 0, padding: 12 }}>No employee matches.</p>
                      : (candidates.data?.content ?? []).map((c) => (
                        <button key={c.id} type="button" role="option" aria-selected={false} className="grw-result" disabled={!eligible(c)} onClick={() => setEmployee(c)}>
                          <CellPerson name={exitName(c)} sub={c.employeeCode} />
                          {eligible(c) ? <span className="grw-muted">{c.email}</span> : <StatusPill tone="muted" size="sm">{c.employmentStatus === 'NOTICE_PERIOD' ? 'On notice' : c.employmentStatus}</StatusPill>}
                        </button>
                      ))}
              </div>
            )}
          </div>
        )}
        <ExitTypeField value={exitType} onChange={setExitType} />
        <DateInput label="Notice start date" required value={noticeStart} max={lastDay || undefined} onChange={(e) => setNoticeStart(e.target.value)} />
        <DateInput label="Last working day" required value={lastDay} min={noticeStart || undefined} onChange={(e) => setLastDay(e.target.value)} />
        <Textarea id="notice-reason" label="Reason (optional)" rows={3} maxLength={100} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Not shared with the employee" />
        {badOrder && <span role="alert" style={{ color: 'var(--u-rdt, #B42318)', fontSize: 13 }}>Last working day must be on or after the notice start date.</span>}
        {error && <Callout tone="danger" icon="alert"><span role="alert">{error}</span></Callout>}
      </div>
    </SidePanel>
  )
}

/** Edit dates (prefilled) and Withdraw notice (confirmed), as the profile's Exit tab offers. */
function SeparationPanel({ row, onClose }: { row: ExitRow; onClose: () => void }) {
  const update = useUpdateWorkforceEmployee()
  const cancel = useCancelNotice()
  const toast = useToast()
  const [noticeStart, setNoticeStart] = useState(row.noticeStartDate || '')
  const [lastDay, setLastDay] = useState(row.lastWorkingDay || '')
  const [reason, setReason] = useState(row.exitReason || '')
  const [exitType, setExitType] = useState<ExitType | ''>(row.exitType || '')
  const [withdrawing, setWithdrawing] = useState(false)
  const [error, setError] = useState('')
  const badOrder = Boolean(noticeStart && lastDay && lastDay < noticeStart)
  const busy = update.isPending || cancel.isPending
  const save = async () => {
    try {
      // An empty reason box must not wipe a recorded reason.
      await update.mutateAsync({ id: row.employeeId, data: { noticeStartDate: noticeStart || undefined, lastWorkingDay: lastDay, exitReason: reason.trim() || undefined, exitType: exitType || undefined } })
      toast.success('Separation details saved'); onClose()
    } catch (e) { setError(errorText(e, 'Unable to update separation details.')) }
  }
  const withdraw = async () => {
    try { await cancel.mutateAsync(row.employeeId); toast.success(`Notice withdrawn. ${exitName(row)} is active again`); setWithdrawing(false); onClose() }
    catch (e) { toast.error('Unable to withdraw the notice', { detail: errorText(e, 'Try again in a moment.') }) }
  }
  return (
    <SidePanel open onClose={() => { if (!busy) onClose() }} busy={busy} width={520} title={`Edit dates · ${row.firstName}`}
      sub="Last working day must be on or after the notice start date." footerAlign="between"
      footer={<>
        {row.employmentStatus === 'NOTICE_PERIOD' ? <PanelButton variant="secondary" size="lg" disabled={busy} onClick={() => setWithdrawing(true)}>Withdraw notice</PanelButton> : <span />}
        <PanelButton variant="primary" size="lg" busy={update.isPending} blockedReason={!lastDay || !noticeStart ? 'Set both dates' : badOrder ? 'The last working day is before the notice start' : null} onClick={save}>Save dates</PanelButton>
      </>}>
      <div className="grw-form">
        <CellPerson name={exitName(row)} sub={row.departmentName || row.employeeCode} />
        <ExitTypeField value={exitType} onChange={setExitType} />
        <DateInput label="Notice start date" required value={noticeStart} max={lastDay || undefined} onChange={(e) => setNoticeStart(e.target.value)} />
        <DateInput label="Last working day" required value={lastDay} min={noticeStart || undefined} onChange={(e) => setLastDay(e.target.value)} />
        <Textarea id="separation-reason" label="Reason" rows={3} maxLength={100} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Not shared with the employee" />
        {badOrder && <span role="alert" style={{ color: 'var(--u-rdt, #B42318)', fontSize: 13 }}>Last working day must be on or after the notice start date.</span>}
        {error && <Callout tone="danger" icon="alert"><span role="alert">{error}</span></Callout>}
      </div>
      <Dialog open={withdrawing} onClose={() => setWithdrawing(false)} busy={cancel.isPending} title={`Withdraw ${exitName(row)}'s notice?`}
        sub="The employee returns to Active. The recorded notice dates and reason are kept on the profile until edited."
        footer={<>
          <PanelButton variant="secondary" onClick={() => setWithdrawing(false)}>Keep notice</PanelButton>
          <PanelButton variant="danger" busy={cancel.isPending} onClick={withdraw}>Withdraw notice</PanelButton>
        </>} />
    </SidePanel>
  )
}

/**
 * Mark exited when the exit type is already recorded: confirm by typing the person's name or code.
 * Marking exited is hard to undo (they lose access and move to the Exited list), and the rows sit
 * next to each other — so the typed value is matched against THIS row only, never the whole list.
 */
function ConfirmExitDialog({ row, onClose }: { row: ExitRow; onClose: () => void }) {
  const exit = useExitEmployee()
  const toast = useToast()
  const [typed, setTyped] = useState('')
  const [error, setError] = useState('')
  const same = (a: string, b: string | null | undefined) => !!b && a === b.trim().toLowerCase()
  const entered = typed.trim().toLowerCase()
  const matches = entered.length > 0 && (same(entered, exitName(row)) || same(entered, row.employeeCode))
  const confirm = async () => {
    if (!matches) return
    setError('')
    try {
      await exit.mutateAsync({ id: row.employeeId, lastWorkingDay: row.lastWorkingDay!, exitType: row.exitType! })
      toast.success(`${row.firstName} is marked exited. Full & final can start.`); onClose()
    } catch (e) { setError(errorText(e, 'Unable to mark the employee as exited.')) }
  }
  return (
    <Dialog open onClose={() => { if (!exit.isPending) onClose() }} busy={exit.isPending} tone="danger" role="alertdialog" width={520}
      title={`Mark ${exitName(row)} as exited?`}
      sub="They lose access immediately and move to the Exited list; payroll and settlement records are unaffected."
      footer={<>
        <PanelButton variant="secondary" disabled={exit.isPending} onClick={onClose}>Cancel</PanelButton>
        <PanelButton variant="danger" busy={exit.isPending} onClick={confirm}
          blockedReason={matches ? null : 'Type their name or employee code to confirm'}>Mark exited</PanelButton>
      </>}>
      <div className="grw-form">
        <CellPerson name={exitName(row)} sub={row.departmentName || row.employeeCode} />
        <KeyValueGrid items={[
          { label: 'Employee code', value: row.employeeCode },
          { label: 'Department', value: row.departmentName || row.employeeCode },
          { label: 'Exit type', value: exitTypeLabel(row.exitType) },
          { label: 'Last working day', value: dayMon(row.lastWorkingDay) },
        ]} />
        <Input id="confirm-exit-name" label="Type the name or employee code to confirm" autoFocus value={typed}
          onChange={(e) => setTyped(e.target.value)} placeholder={row.employeeCode}
          hint={`Enter “${exitName(row)}” or “${row.employeeCode}” exactly, to be sure this is the right person.`} />
        {error && <Callout tone="danger" icon="alert"><span role="alert">{error}</span></Callout>}
      </div>
    </Dialog>
  )
}

/** Mark exited when no exit type is recorded yet: ask for it (it drives the attrition split). */
function MarkExitedPanel({ row, onClose }: { row: ExitRow; onClose: () => void }) {
  const exit = useExitEmployee()
  const toast = useToast()
  const [exitType, setExitType] = useState<ExitType>('RESIGNATION')
  const save = async () => {
    try {
      await exit.mutateAsync({ id: row.employeeId, lastWorkingDay: row.lastWorkingDay!, exitType })
      toast.success(`${row.firstName} is marked exited (${exitTypeLabel(exitType)}). Full & final can start.`); onClose()
    } catch (e) { toast.error('Unable to mark the employee as exited', { detail: errorText(e, 'Try again in a moment.') }) }
  }
  return (
    <SidePanel open onClose={() => { if (!exit.isPending) onClose() }} busy={exit.isPending} width={480} title={`Mark ${exitName(row)} as exited`}
      sub={`Last working day ${dayMon(row.lastWorkingDay)}. They lose access and move to the Exited list; payroll and settlement records are unaffected.`}
      footer={<>
        <PanelButton variant="secondary" size="lg" disabled={exit.isPending} onClick={onClose}>Cancel</PanelButton>
        <PanelButton variant="danger" size="lg" busy={exit.isPending} onClick={save}>Mark exited</PanelButton>
      </>}>
      <div className="grw-form"><ExitTypeField value={exitType} onChange={setExitType} /></div>
    </SidePanel>
  )
}
