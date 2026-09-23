import { useState } from 'react'
import { Link } from 'react-router-dom'
import { differenceInCalendarDays, format } from 'date-fns'
import { LogOut, UserMinus, Wallet } from 'lucide-react'
import { usePermission } from '@unifiedtree/sdk'
import { HrAvatar, HrButton, HrDrawer, HrPageHeader, HrStatCard, HrStatusPill, HrTabs, TableCard, type PillTone } from '@/shared/components/hr'
import { DataTable, type Column } from '@/shared/components/DataTable'
import { EmptyState } from '@/shared/components/EmptyState'
import { hrPaginationFooter } from '@/shared/components/HrPagination'
import { useConfirmDialog } from '@/shared/components/ConfirmDialog'
import { useToast } from '@/shared/hooks/useToast'
import {
  useCancelNotice, useEmployeeCounts, useEmployeeDirectory, useExitEmployee, useStartNotice, useUpdateWorkforceEmployee,
  type EmploymentStatus, type WorkforceEmployee,
} from '../api/useWorkforce'

/**
 * Resignation & Exit — the HR-side list of who is leaving.
 *
 * Until now the sidebar's "Resignation & Exit" leaf pointed at /hrms/fnf, the
 * same route as "Full & Final Settlement"; the shell dedupes by path, so the
 * leaf never rendered and the only way to see who was serving notice was to
 * open each profile's Exit tab. This page is that missing list. It reuses the
 * workforce notice/exit/cancel-notice APIs and the directory's status filter —
 * nothing new on the backend — and hands off to /hrms/fnf for the settlement.
 */

type TabKey = 'NOTICE_PERIOD' | 'EXITED' | 'TERMINATED'
const TABS: { key: TabKey; label: string }[] = [
  { key: 'NOTICE_PERIOD', label: 'On notice' },
  { key: 'EXITED', label: 'Exited' },
  { key: 'TERMINATED', label: 'Terminated' },
]
const STATUS_TONE: Record<string, PillTone> = { ACTIVE: 'ok', PROBATION: 'warn', NOTICE_PERIOD: 'late', SUSPENDED: 'warn', EXITED: 'red', TERMINATED: 'red' }
const STATUS_LABEL: Record<string, string> = { ACTIVE: 'Active', PROBATION: 'Probation', NOTICE_PERIOD: 'On notice', SUSPENDED: 'Suspended', EXITED: 'Exited', TERMINATED: 'Terminated' }
const PAGE_SIZE = 20

const fullName = (e: WorkforceEmployee) => [e.firstName, e.lastName].filter(Boolean).join(' ') || e.employeeCode
const today = () => format(new Date(), 'yyyy-MM-dd')
const day = (iso?: string | null) => (iso ? format(new Date(`${iso}T00:00:00`), 'd MMM yyyy') : '—')

export function ExitCenter() {
  const canRead = usePermission('hrms.employee.read')
  const canWrite = usePermission('hrms.employee.write')
  const canSettle = usePermission('hrms.fnf.read')
  const [tab, setTab] = useState<TabKey>('NOTICE_PERIOD')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [starting, setStarting] = useState(false)
  const [editing, setEditing] = useState<WorkforceEmployee | null>(null)
  const counts = useEmployeeCounts(undefined, { enabled: canRead })
  const list = useEmployeeDirectory({ status: tab as EmploymentStatus, search: search.trim() || undefined, page, pageSize: PAGE_SIZE }, { enabled: canRead })
  const confirm = useConfirmDialog()
  const { toast } = useToast()
  const cancelNotice = useCancelNotice()
  const exitEmployee = useExitEmployee()

  const switchTab = (next: TabKey) => { setTab(next); setPage(0) }

  const onCancelNotice = async (emp: WorkforceEmployee) => {
    const ok = await confirm({ title: `Withdraw ${fullName(emp)}'s notice?`, body: 'The employee returns to Active. The recorded notice dates and reason are kept on the profile until edited.', confirmLabel: 'Withdraw notice' })
    if (!ok) return
    try { await cancelNotice.mutateAsync(emp.id); toast(`${fullName(emp)} is active again`, 'success') }
    catch (e) { toast(e instanceof Error ? e.message : 'Unable to withdraw the notice.', 'error') }
  }
  const onMarkExited = async (emp: WorkforceEmployee) => {
    if (!emp.lastWorkingDay) { setEditing(emp); return }
    const ok = await confirm({ title: `Mark ${fullName(emp)} as exited?`, body: `Last working day ${day(emp.lastWorkingDay)}. The employee loses platform access and moves to the Exited list; payroll and settlement records are unaffected.`, confirmLabel: 'Mark exited', tone: 'danger' })
    if (!ok) return
    try { await exitEmployee.mutateAsync({ id: emp.id, lastWorkingDay: emp.lastWorkingDay, reason: emp.exitReason || undefined }); toast(`${fullName(emp)} marked as exited`, 'success') }
    catch (e) { toast(e instanceof Error ? e.message : 'Unable to mark the employee as exited.', 'error') }
  }

  const employeeCell: Column<WorkforceEmployee> = {
    key: 'employee', header: 'Employee',
    render: emp => <Link to={`/hrms/employees/${emp.id}?tab=exit`} className="hover:underline"><HrAvatar name={fullName(emp)} sub={emp.employeeCode} /></Link>,
  }
  const reasonCell: Column<WorkforceEmployee> = {
    key: 'exitReason', header: 'Reason',
    render: emp => <span className="block max-w-xs truncate text-text-secondary" title={emp.exitReason || undefined}>{emp.exitReason || '—'}</span>,
  }
  const noticeColumns: Column<WorkforceEmployee>[] = [
    employeeCell,
    { key: 'noticeStartDate', header: 'Notice started', render: emp => day(emp.noticeStartDate) },
    { key: 'lastWorkingDay', header: 'Last working day', render: emp => day(emp.lastWorkingDay) },
    { key: 'daysLeft', header: 'Days left', render: emp => <DaysLeft lastWorkingDay={emp.lastWorkingDay} /> },
    reasonCell,
    {
      key: 'actions', header: '',
      render: emp => (
        <div className="flex flex-wrap justify-end gap-2">
          {canWrite && <HrButton size="sm" variant="ghost" onClick={() => setEditing(emp)}>Edit dates</HrButton>}
          {canWrite && <HrButton size="sm" variant="ghost" disabled={cancelNotice.isPending} onClick={() => onCancelNotice(emp)}>Withdraw notice</HrButton>}
          {canSettle && <Link to="/hrms/fnf"><HrButton size="sm" variant="ghost"><Wallet size={14} /> F&amp;F</HrButton></Link>}
          {canWrite && <HrButton size="sm" variant="danger" disabled={exitEmployee.isPending} onClick={() => onMarkExited(emp)}>Mark exited</HrButton>}
        </div>
      ),
    },
  ]
  const leaverColumns: Column<WorkforceEmployee>[] = [
    employeeCell,
    { key: 'lastWorkingDay', header: 'Last working day', render: emp => day(emp.lastWorkingDay) },
    reasonCell,
    { key: 'employmentStatus', header: 'Status', render: emp => <HrStatusPill tone={STATUS_TONE[emp.employmentStatus ?? ''] ?? 'gray'}>{STATUS_LABEL[emp.employmentStatus ?? ''] ?? emp.employmentStatus ?? '—'}</HrStatusPill> },
    {
      key: 'actions', header: '',
      render: emp => (
        <div className="flex justify-end gap-2">
          <Link to={`/hrms/employees/${emp.id}?tab=exit`}><HrButton size="sm" variant="ghost">Profile</HrButton></Link>
          {canSettle && <Link to="/hrms/fnf"><HrButton size="sm" variant="ghost"><Wallet size={14} /> F&amp;F</HrButton></Link>}
        </div>
      ),
    },
  ]

  if (!canRead) return <p className="ut-card p-6 text-text-secondary">You do not have access to employee exits.</p>

  const rows = list.data?.content ?? []
  const emptyMessage = tab === 'NOTICE_PERIOD'
    ? (search ? 'No employees on notice match this search.' : 'No one is serving notice.')
    : search ? 'No leavers match this search.' : tab === 'EXITED' ? 'No exited employees yet.' : 'No terminated employees.'

  return (
    <div className="space-y-5">
      <HrPageHeader
        crumb="Employee exit"
        title="Resignation & exit"
        subtitle="Everyone serving notice, with their last working day and what happens next. Settlements are prepared under Full & Final."
        actions={canWrite ? <HrButton onClick={() => setStarting(true)}><LogOut size={16} /> Start notice</HrButton> : undefined}
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <HrStatCard icon={<LogOut size={18} />} color="orange" value={counts.data?.notice ?? '—'} label="On notice" loading={counts.isPending} onClick={() => switchTab('NOTICE_PERIOD')} />
        <HrStatCard icon={<UserMinus size={18} />} color="red" value={counts.data?.exited ?? '—'} label="Exited" loading={counts.isPending} onClick={() => switchTab('EXITED')} />
        <HrStatCard icon={<UserMinus size={18} />} color="red" value={counts.data?.terminated ?? '—'} label="Terminated" loading={counts.isPending} onClick={() => switchTab('TERMINATED')} />
      </div>
      <HrTabs tabs={TABS} active={tab} onChange={key => switchTab(key as TabKey)} />
      {list.isError ? (
        <div role="alert" className="ut-card p-6"><p className="font-semibold">Unable to load employees.</p><p className="mt-1 text-sm text-text-secondary">{list.error instanceof Error ? list.error.message : 'Please try again.'}</p><HrButton className="mt-4" variant="ghost" onClick={() => list.refetch()}>Try again</HrButton></div>
      ) : (
        <TableCard
          search={{ value: search, onChange: v => { setSearch(v); setPage(0) }, placeholder: 'Search name, code, email…' }}
          footer={list.data && hrPaginationFooter({ page, pageSize: PAGE_SIZE, totalElements: list.data.totalElements, totalPages: list.data.totalPages, onPageChange: setPage })}
        >
          {!list.isPending && rows.length === 0 ? (
            <EmptyState icon={UserMinus} title={emptyMessage} description={tab === 'NOTICE_PERIOD' ? 'Start a notice period from here or from an employee\'s Exit tab.' : 'Employees appear here once HR marks them as exited or terminated.'}
              action={tab === 'NOTICE_PERIOD' && canWrite && !search ? { label: 'Start notice', onClick: () => setStarting(true) } : undefined} />
          ) : (
            <DataTable<WorkforceEmployee> columns={tab === 'NOTICE_PERIOD' ? noticeColumns : leaverColumns} data={rows} keyField="id" loading={list.isPending} emptyMessage={emptyMessage} />
          )}
        </TableCard>
      )}
      {starting && <StartNoticeDrawer onClose={() => setStarting(false)} onDone={() => { setStarting(false); switchTab('NOTICE_PERIOD') }} />}
      {editing && <SeparationDrawer emp={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

function DaysLeft({ lastWorkingDay }: { lastWorkingDay?: string | null }) {
  if (!lastWorkingDay) return <span className="text-text-secondary">—</span>
  const left = differenceInCalendarDays(new Date(`${lastWorkingDay}T00:00:00`), new Date())
  if (left < 0) return <HrStatusPill tone="red">{Math.abs(left)} {Math.abs(left) === 1 ? 'day' : 'days'} overdue</HrStatusPill>
  if (left === 0) return <HrStatusPill tone="warn">Last day today</HrStatusPill>
  return <span className={left <= 7 ? 'font-semibold text-text-primary' : 'text-text-secondary'}>{left} {left === 1 ? 'day' : 'days'}</span>
}

/** Pick an active employee and record their notice period (POST …/notice). */
function StartNoticeDrawer({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const start = useStartNotice()
  const { toast } = useToast()
  const [query, setQuery] = useState('')
  const [employee, setEmployee] = useState<WorkforceEmployee | null>(null)
  const [noticeStart, setNoticeStart] = useState(today())
  const [lastDay, setLastDay] = useState('')
  const [reason, setReason] = useState('')
  // No status filter: new hires are PROBATION, not ACTIVE, and they resign too.
  // The directory page is shown as returned; rows already leaving are disabled.
  const candidates = useEmployeeDirectory({ search: query.trim() || undefined, page: 0, pageSize: 8 }, { enabled: !employee && query.trim().length >= 2 })
  const eligible = (c: WorkforceEmployee) => c.employmentStatus === 'ACTIVE' || c.employmentStatus === 'PROBATION'
  const invalidOrder = Boolean(noticeStart && lastDay && lastDay < noticeStart)
  const canSave = Boolean(employee && noticeStart && lastDay) && !invalidOrder && !start.isPending
  const save = async () => {
    if (!employee) return
    try {
      await start.mutateAsync({ id: employee.id, noticeStart, lastWorkingDay: lastDay, reason: reason.trim() || undefined })
      toast(`${fullName(employee)} is now serving notice until ${day(lastDay)}`, 'success'); onDone()
    } catch { /* Keep the form open and show the server error below. */ }
  }
  return <HrDrawer title="Start notice period" onClose={() => { if (!start.isPending) onClose() }}
    footer={<div className="flex justify-end gap-3"><HrButton variant="ghost" disabled={start.isPending} onClick={onClose}>Cancel</HrButton><HrButton disabled={!canSave} onClick={save}>{start.isPending ? 'Saving…' : 'Start notice'}</HrButton></div>}>
    <div className="space-y-5">
      <p className="text-sm text-text-secondary">Records a resignation or notice for an active employee. They stay active with full access until you mark them exited.</p>
      {employee ? (
        <div className="flex items-center justify-between rounded-lg bg-bg-base p-4"><HrAvatar name={fullName(employee)} sub={employee.employeeCode} /><HrButton size="sm" variant="ghost" onClick={() => setEmployee(null)}>Change</HrButton></div>
      ) : (
        <div>
          <label className="block text-sm font-medium" htmlFor="notice-employee-search">Employee</label>
          <input id="notice-employee-search" className="ut-input mt-2" placeholder="Type at least 2 characters of a name, code or email" value={query} onChange={e => setQuery(e.target.value)} autoFocus />
          {query.trim().length >= 2 && (
            <ul className="mt-2 divide-y divide-border-subtle rounded-lg border border-border-default" role="listbox" aria-label="Matching active employees">
              {candidates.isPending ? <li className="p-3 text-sm text-text-secondary" role="status">Searching…</li>
                : candidates.isError ? <li className="p-3 text-sm text-danger" role="alert">Unable to search employees.</li>
                : (candidates.data?.content ?? []).length === 0 ? <li className="p-3 text-sm text-text-secondary">No employee matches.</li>
                : (candidates.data?.content ?? []).map(c => (
                  <li key={c.id}><button type="button" role="option" aria-selected={false} disabled={!eligible(c)} className="flex w-full items-center justify-between gap-3 p-3 text-left hover:bg-bg-subtle disabled:cursor-not-allowed disabled:opacity-60" onClick={() => setEmployee(c)}>
                    <HrAvatar name={fullName(c)} sub={c.employeeCode} />
                    {eligible(c) ? <span className="text-xs text-text-secondary">{c.email}</span> : <HrStatusPill tone={STATUS_TONE[c.employmentStatus ?? ''] ?? 'gray'}>{STATUS_LABEL[c.employmentStatus ?? ''] ?? c.employmentStatus}</HrStatusPill>}
                  </button></li>
                ))}
            </ul>
          )}
        </div>
      )}
      <label className="block text-sm font-medium">Notice start date<input type="date" className="ut-input mt-2" value={noticeStart} onChange={e => setNoticeStart(e.target.value)} required max={lastDay || undefined} /></label>
      <label className="block text-sm font-medium">Last working day<input type="date" className="ut-input mt-2" value={lastDay} onChange={e => setLastDay(e.target.value)} required min={noticeStart || undefined} /></label>
      <div><label htmlFor="notice-reason" className="block text-sm font-medium">Reason <span className="font-normal text-text-secondary">(optional)</span></label><textarea id="notice-reason" className="ut-input mt-2" value={reason} maxLength={100} rows={3} onChange={e => setReason(e.target.value)} /></div>
      {invalidOrder && <p role="alert" className="text-sm text-danger">Last working day must be on or after the notice start date.</p>}
      {start.isError && <p role="alert" className="text-sm text-danger">{start.error instanceof Error ? start.error.message : 'Unable to start the notice period.'}</p>}
    </div>
  </HrDrawer>
}

/** Same edit the profile's Exit tab offers, reachable from the list (PUT employee dates/reason). */
function SeparationDrawer({ emp, onClose }: { emp: WorkforceEmployee; onClose: () => void }) {
  const update = useUpdateWorkforceEmployee()
  const { toast } = useToast()
  const [noticeStart, setNoticeStart] = useState(emp.noticeStartDate || '')
  const [lastDay, setLastDay] = useState(emp.lastWorkingDay || '')
  const [reason, setReason] = useState(emp.exitReason || '')
  const invalidOrder = Boolean(noticeStart && lastDay && lastDay < noticeStart)
  const save = async () => {
    try {
      await update.mutateAsync({ id: emp.id, data: { noticeStartDate: noticeStart || undefined, lastWorkingDay: lastDay, exitReason: reason.trim() } })
      toast('Separation details saved', 'success'); onClose()
    } catch { /* Keep input visible and display the server error. */ }
  }
  return <HrDrawer title={`Separation details — ${fullName(emp)}`} onClose={() => { if (!update.isPending) onClose() }}
    footer={<div className="flex justify-end gap-3"><HrButton variant="ghost" disabled={update.isPending} onClick={onClose}>Cancel</HrButton><HrButton disabled={!lastDay || !noticeStart || invalidOrder || update.isPending} onClick={save}>{update.isPending ? 'Saving…' : 'Save'}</HrButton></div>}>
    <div className="space-y-5">
      <label className="block text-sm font-medium">Notice start date<input type="date" className="ut-input mt-2" value={noticeStart} onChange={e => setNoticeStart(e.target.value)} required max={lastDay || undefined} /></label>
      <label className="block text-sm font-medium">Last working day<input type="date" className="ut-input mt-2" value={lastDay} onChange={e => setLastDay(e.target.value)} required min={noticeStart || undefined} /></label>
      <div><label htmlFor="separation-reason" className="block text-sm font-medium">Reason</label><textarea id="separation-reason" className="ut-input mt-2" value={reason} maxLength={100} rows={3} onChange={e => setReason(e.target.value)} /></div>
      {invalidOrder && <p role="alert" className="text-sm text-danger">Last working day must be on or after the notice start date.</p>}
      {update.isError && <p role="alert" className="text-sm text-danger">{update.error instanceof Error ? update.error.message : 'Unable to update separation details.'}</p>}
    </div>
  </HrDrawer>
}
