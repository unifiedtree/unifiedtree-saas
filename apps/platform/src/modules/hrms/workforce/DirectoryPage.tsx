// /hrms/employees — the Workforce directory (Employee Master) on the redesign kit (prototype
// PgDirectory). It runs on the Master data context (master/MasterContainer → masterApp.ts), so
// everything it did as the Master design's EmployeesPage stays:
//   - the URL's ?q, ?status, ?departmentId / ?dept (none = no department), ?branchId / ?branch,
//     ?filter=birthday|anniversary|retirement with ?from&to, and ?co are read as before;
//     ?add=1 opens Add employee (the dashboard's "Add employee" links here);
//   - the sub-pages (Employee Master · Contractor Master · Classification Rules) are the header's
//     segmented tabs (the Organization Setup look, 293fe825);
//   - figures (server BW-90 stats when present, the records otherwise) filter by status on click;
//   - search (name, code, email, designation), department (with sub-departments) / branch /
//     type / milestone filters, status pills, sorting, 10 a page, select the page;
//   - Import, Export (the same CSV and export log), Add employee, a row's quick profile, Edit
//     details, Start exit (last working day → notice or exited), bulk Change status and Export.
// Actions that change people need hrms.employee.write; Import needs hrms.employee.import.
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import { useSearchParams } from 'react-router-dom'
import { MoreVertical } from 'lucide-react'
import { P, usePermission } from '@unifiedtree/sdk'
import {
  Button, CellPerson, CellStack, Chip, EmptyState, ErrorState, FilterPills, PageFrame, PageHeader, PillTabs, SkeletonStats,
  SkeletonTable, StatCard, StatGrid, StatusPill, Table, type TableColumn,
} from '@/design/kit/display'
import { BulkBar, Pager } from '@/design/kit/data'
import { DateInput, Dialog, Dropdown, Input, Menu, PanelButton, type DropdownOption } from '@/design/kit/overlays'
import { TODAY, TODAY_ISO, pl } from '@/design/master/masterRuntime'
import { useEmployeeStats } from '../api/shared/useEmployeeStats'
import type { Rec } from '../master/masterData'
import { MASTER_ROUTES } from '../master/MasterContainer'
import {
  bulkStatusTargets, deptOptions, exitChange, filterEmployees, fmtDate, isLeaving, localActiveSeries, sortEmployees, statusOptions,
  statusTone, suggestedLastDay, tenure, typeOptions, type Sort, type SortKey,
} from './directoryModel'
import { EmployeeFormPanel } from './EmployeeFormPanel'
import { EmployeeProfilePanel } from './EmployeeProfilePanel'
import { useMaps, useMasterApp } from './masterApp'
import './directory.css'

const PAGE_SIZE = 10
const MONTH = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-GB', { month: 'short' })

export interface DirectoryPageProps {
  allowed: boolean
  failed: unknown
  loading: boolean
  retry: () => void
}

export function DirectoryPage({ allowed, failed, loading, retry }: DirectoryPageProps) {
  const { db, go, group, act } = useMasterApp()
  const canWrite = usePermission(P.HRMS_EMPLOYEE_WRITE)
  const canImport = usePermission(P.HRMS_EMPLOYEE_IMPORT)
  const canRead = usePermission(P.HRMS_EMPLOYEE_READ)
  // With two or more companies the directory is the chosen company's (act.globalCo), and so are its figures.
  const stats = useEmployeeStats(act.globalCo || null, { enabled: canRead && allowed })
  const coName = act.globalCo ? (db.companies || []).find((c) => c.id === act.globalCo)?.name as string | undefined : undefined

  const tabs = (group?.items || []).map((i) => ({ key: i.id, label: i.l, href: MASTER_ROUTES[i.id] }))
  const ready = allowed && !failed && !loading
  const people = db.employees || []
  const sub = ready
    ? coName
      ? `${pl(people.filter((e) => e.status !== 'Exited').length, 'person', 'people')} in ${coName}, across ${pl((db.branches || []).filter((b) => b.co === act.globalCo).length, 'branch', 'branches')}. Select a row to open their profile.`
      : `${pl(people.filter((e) => e.status !== 'Exited').length, 'person', 'people')} across ${pl(db.companies.length, 'company', 'companies')} and ${pl(db.branches.length, 'branch', 'branches')}. Select a row to open their profile.`
    : 'Everyone on the roster, with their role, branch and status.'

  const [form, setForm] = useState<{ emp?: Rec } | null>(null)
  const shown = useRef<Rec[] | null>(null)
  // ?add=1 (the dashboard's "Add employee") opens the form once the lists are in; the flag then leaves the URL.
  const [params, setParams] = useSearchParams()
  const wantsAdd = params.get('add') === '1'
  useEffect(() => {
    if (!wantsAdd || !ready) return
    if (canWrite) setForm({})
    setParams((cur) => { const n = new URLSearchParams(cur); n.delete('add'); return n }, { replace: true })
  }, [wantsAdd, ready, canWrite, setParams])

  const actions = ready ? (
    <>
      {canImport && <Button size={40} icon="upload" onClick={() => act.importEmployees()}>Import</Button>}
      <Button size={40} icon="download" onClick={() => act.exportEmployees(shown.current ?? people)}>Export</Button>
      {canWrite && <Button size={40} variant="primary" icon="plus" onClick={() => setForm({})}>Add employee</Button>}
    </>
  ) : undefined

  return (
    <PageFrame label="Workforce directory" className="wf-page">
      <PageHeader
        eyebrow={<span className="wf-crumbs"><button type="button" onClick={() => go('overview')}>Master</button><span aria-hidden="true">/</span>{group ? <button type="button" onClick={() => go(group.items[0].id)}>{group.l}</button> : null}</span>}
        title="Employee Master" sub={sub} actions={actions} />
      {tabs.length > 1 && <PillTabs label={`${group?.l || 'Workforce Directory'} pages`} semantics="nav" placement="hero" items={tabs} activeKey="employees" onSelect={(k) => go(k)} />}
      {!allowed ? <EmptyState icon="lock" title="You don’t have access to this section" hint="Ask an admin if you need it." />
        : failed ? <ErrorState title="This page couldn’t load" error={failed} onRetry={retry} />
          : loading ? <><SkeletonStats count={5} /><div className="ut-card wf-card"><SkeletonTable rows={8} cols={6} label="Loading employees" /></div></>
            : <Directory stats={stats.notAvailable ? null : stats.data ?? null} statsLoading={stats.isLoading} canWrite={canWrite} onEdit={(emp) => setForm({ emp })} shown={shown} />}
      {form && <EmployeeFormPanel emp={form.emp} onClose={() => setForm(null)} />}
    </PageFrame>
  )
}

interface DirectoryProps {
  stats: import('../api/shared/contracts').EmployeeStats | null
  statsLoading: boolean
  canWrite: boolean
  onEdit: (emp: Rec) => void
  /** The rows the filters leave: the header's Export exports them, as before. */
  shown: MutableRefObject<Rec[] | null>
}

function Directory({ stats, statsLoading, canWrite, onEdit, shown }: DirectoryProps) {
  const { db, update, toast, route, act } = useMasterApp()
  const M = useMaps(db)
  const E = db.employees
  const [q, setQ] = useState(route.q || '')
  const [status, setStatus] = useState(route.status || '')
  const [dept, setDept] = useState(route.dept || '')
  const [branch, setBranch] = useState(route.branch || '')
  const [type, setType] = useState('')
  const [sort, setSort] = useState<Sort>({ k: 'code', d: 1 })
  const [page, setPage] = useState(0)
  const [sel, setSel] = useState<string[]>([])
  const [view, setView] = useState<string | null>(null)
  const [exit, setExit] = useState<Rec | null>(null)
  const [lwd, setLwd] = useState(() => suggestedLastDay(db.classes, TODAY_ISO))

  const ms = act.milestone
  const rows = useMemo(() => sortEmployees(
    filterEmployees(E, { status, dept, branch, type, q, milestone: { on: !!ms.value, ids: ms.ids } }, M.look), sort, M.look),
  [E, status, dept, branch, type, q, ms.value, ms.ids, sort, M.look])
  useEffect(() => { setPage(0) }, [status, dept, branch, type, q, sort.k, sort.d, ms.value, ms.ids])
  shown.current = rows
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const cur = Math.min(page, pages - 1)
  const slice = rows.slice(cur * PAGE_SIZE, (cur + 1) * PAGE_SIZE)

  const any = !!(status || dept || branch || type || q.trim() || ms.value)
  const clear = () => { setStatus(''); setDept(''); setBranch(''); setType(''); setQ(''); ms.set('') }
  const toggleStatus = (s: string) => setStatus((x) => (x === s ? '' : s))

  // ── figures: the server's (BW-90) when it has them, else counted from the records ──
  const n = (s: string) => E.filter((e) => e.status === s).length
  const live = E.filter((e) => e.status !== 'Exited').length
  const yr = TODAY_ISO.slice(0, 4)
  const exitedYr = E.filter((e) => e.status === 'Exited' && (e.exitOn || '') >= `${yr}-01-01`).length
  const c = stats?.counts
  const series = stats?.activeSeries?.length ? stats.activeSeries.map((x) => x.active) : localActiveSeries(E.filter((e) => e.status === 'Active'), TODAY, n('Active'))
  const nextMonth = new Date(TODAY.getFullYear(), TODAY.getMonth() + 1, 15).toISOString().slice(0, 10)
  const since = stats?.suspendedSince?.length === 1 ? stats.suspendedSince[0].since : null
  const cards = [
    { key: 'Active', label: 'Active', icon: 'userCheck', tone: 'brand' as const, value: c ? c.active : n('Active'), spark: series,
      delta: stats ? `${stats.joinedThisMonth}` : undefined, note: stats ? 'joined this month' : `${live ? Math.round((n('Active') / live) * 100) : 0}% of headcount` },
    { key: 'Probation', label: 'On probation', icon: 'timer', tone: 'gold' as const, value: c ? c.probation : n('Probation'),
      delta: stats ? `${stats.probationReviewsDueNextMonth}` : undefined, note: stats ? `reviews due in ${MONTH(nextMonth)}` : 'Not yet confirmed' },
    { key: 'On notice', label: 'On notice', icon: 'logOut', tone: 'red' as const, value: c ? c.notice : n('On notice'),
      delta: stats ? `${stats.noticeStartedLast7Days}` : undefined, note: stats ? 'in the last 7 days' : undefined },
    { key: 'Suspended', label: 'Suspended', icon: 'userMinus', tone: 'gray' as const, value: c ? c.suspended : n('Suspended'),
      note: since ? `Since ${fmtDate(since)}` : undefined },
    { key: 'Exited', label: 'Exited this year', icon: 'userX', tone: 'gray' as const, value: stats ? stats.exitedThisYear : exitedYr,
      note: stats?.attritionPercent != null ? `${stats.attritionPercent}% attrition` : undefined },
  ]

  // ── filters ──
  const statusOpts = statusOptions(E)
  const deptOpts: DropdownOption[] = [{ value: '', label: 'All departments' }, ...deptOptions(db.depts).map((o) => ({ value: o.value, label: o.label, sub: o.sub })), { value: '__none', label: 'No department', sub: 'People without one' }]
  const branchOpts: DropdownOption[] = [{ value: '', label: 'All branches' }, ...db.branches.map((b) => ({ value: b.id, label: b.name, sub: b.city || undefined }))]
  const typeOpts: DropdownOption[] = [{ value: '', label: 'All types' }, ...typeOptions(E).map((t) => ({ value: t, label: t }))]
  const msOpts: DropdownOption[] = [{ value: '', label: 'All people' }, ...ms.options.map((o) => ({ value: o.v, label: o.l }))]

  // ── selection and bulk actions ──
  const bulkStatus = (to: 'Active' | 'Probation') => {
    const ch = bulkStatusTargets(E, new Set(sel), to)
    if (!ch.length) { toast(`No one selected can be marked ${to.toLowerCase()}`, 'info'); return }
    const ids = ch.map((e) => e.id)
    update('employees', (L) => L.map((e) => (ids.includes(e.id) ? { ...e, status: to } : e)))
    toast(`${pl(ch.length, 'employee', 'employees')} marked ${to.toLowerCase()}`)
    setSel([])
  }

  const startExit = (e: Rec) => { setLwd(suggestedLastDay(db.classes, TODAY_ISO)); setExit(e) }
  const doExit = () => {
    if (!exit || !lwd) return
    const ch = exitChange(lwd, TODAY_ISO)
    update('employees', (L) => L.map((e) => (e.id === exit.id ? { ...e, ...ch } : e)))
    toast(ch.status === 'Exited' ? `${exit.name} marked as exited` : `${exit.name} is now serving notice · last day ${fmtDate(lwd)}`)
    setExit(null)
  }
  const viewing = view ? E.find((e) => e.id === view) : null

  const columns: TableColumn<Rec>[] = [
    { key: 'name', header: 'Employee', sortable: true, primary: true, render: (e) => <CellPerson name={e.name} sub={e.email || M.desig[e.desig].name} /> },
    { key: 'code', header: 'Code', sortable: true, width: 120, render: (e) => <Chip variant="code">{e.code}</Chip> },
    { key: 'desig', header: 'Designation', sortable: true, render: (e) => <CellStack primary={M.desig[e.desig].name} secondary={`${M.dept[e.dept].name} · ${e.type}`} /> },
    { key: 'branch', header: 'Branch', render: (e) => M.branch[e.branch].name },
    { key: 'mgr', header: 'Reporting manager', hideOnCards: true, render: (e) => (e.mgrId && M.emp[e.mgrId]?.name) || <span className="wf-muted">—</span> },
    { key: 'joined', header: 'Date of joining', sortable: true, render: (e) => <CellStack primary={<span className="wf-num">{fmtDate(e.joined)}</span>} secondary={tenure(e.joined, TODAY)} /> },
    { key: 'status', header: 'Status', render: (e) => (
      <span className="wf-status">
        <StatusPill tone={statusTone(e.status)} dot>{e.statusLabel || e.status}</StatusPill>
        {e.status === 'On notice' && <span className="wf-muted">Last day {fmtDate(e.lwd)}</span>}
      </span>
    ) },
    { key: 'act', header: <span className="uk-sr">Actions</span>, label: 'Actions', width: 60, align: 'right', className: 'wf-td-act', render: (e) => (
      <Menu label={`Actions for ${e.name}`} width={220} placement="bottom-end"
        trigger={({ props }) => <button type="button" {...props} className="wf-more" aria-label="More actions" title={`More for ${e.name}`}><MoreVertical size={17} aria-hidden="true" /></button>}
        items={[
          { key: 'view', label: 'View profile', icon: 'eye', onSelect: () => setView(e.id) },
          ...(canWrite ? [{ key: 'edit', label: 'Edit details', icon: 'pencil', onSelect: () => onEdit(e) }] : []),
          ...(canWrite && !isLeaving(e) ? [{ key: 'sep', separator: true as const }, { key: 'exit', label: 'Start exit', icon: 'logOut', danger: true, onSelect: () => startExit(e) }] : []),
        ]} />
    ) },
  ]

  return (
    <>
      <StatGrid min={165} label="Workforce figures">
        {cards.map((k, i) => (
          <StatCard key={k.key} variant="stat" index={i} label={k.label} icon={k.icon} tone={k.tone} value={k.value} loading={statsLoading}
            spark={k.spark} sparkLabel={k.spark ? 'Active people, last months' : undefined} delta={k.delta} mood={k.delta && k.delta !== '0' ? 'good' : 'flat'} trend="up"
            note={k.note} active={status === k.key} onClick={() => toggleStatus(k.key)} ariaLabel={`${k.label}: ${k.value}. Show only them`} />
        ))}
      </StatGrid>

      <div className="ut-card wf-card">
        <div className="wf-bar">
          <Input fieldClassName="wf-search" leading="search" size="md" placeholder="Search name, code, email or role…" aria-label="Search employees"
            value={q} onChange={(e) => setQ(e.target.value)} />
          <Dropdown className="wf-filter" label="Department" options={deptOpts} value={dept} onChange={(x) => setDept(x)} searchable menuWidth={260} />
          <Dropdown className="wf-filter" label="Branch" options={branchOpts} value={branch} onChange={(x) => setBranch(x)} searchable={branchOpts.length > 7} menuWidth={240} />
          <Dropdown className="wf-filter" label="Type" options={typeOpts} value={type} onChange={(x) => setType(x)} searchable={false} menuWidth={200} />
          <Dropdown className="wf-filter wf-filter--wide wf-filter--milestone" label="Milestone" options={msOpts} value={ms.value} onChange={(x) => ms.set(x)} searchable={false} menuWidth={280} />
          {any && <Button size={36} variant="ghost" icon="x" onClick={clear}>Clear</Button>}
          <span className="wf-count" aria-live="polite">{rows.length} of {E.length} shown</span>
        </div>
        <div className="wf-pills">
          <FilterPills label="Status" size="sm" value={status} onChange={setStatus}
            options={[{ value: '', label: 'All', count: E.length }, ...statusOpts.map((s) => ({ value: s.value, label: s.value, count: s.count }))]} />
        </div>
        <Table<Rec> label="Employees" columns={columns} rows={slice} rowKey={(e) => e.id} rowLabel={(e) => e.name}
          onRowClick={(e) => setView(e.id)} selectable selected={sel}
          onSelectedChange={(keys) => setSel(keys.map(String))}
          sort={{ key: sort.k, dir: sort.d > 0 ? 'asc' : 'desc' }} onSort={(s) => setSort({ k: s.key as SortKey, d: s.dir === 'asc' ? 1 : -1 })}
          rowClassName={(e) => (e.status === 'Exited' ? 'wf-off' : undefined)} mobile="cards" minWidth={980}
          empty={<EmptyState title="No one matches these filters" hint="Try another name, or clear the filters to see everyone." action={<PanelButton onClick={clear}>Clear filters</PanelButton>} variant="plain" />} />
        <Pager page={cur} pageSize={PAGE_SIZE} total={rows.length} onPageChange={setPage} noun="employees" filteredFrom={E.length} className="wf-pager" />
      </div>

      <BulkBar count={sel.length} label="Selected employees" onClear={() => setSel([])}
        actions={[
          ...(canWrite ? [{ key: 'active', label: 'Mark as active', icon: 'checkCircle', onClick: () => bulkStatus('Active') }, { key: 'probation', label: 'Mark as probation', icon: 'timer', onClick: () => bulkStatus('Probation') }] : []),
          { key: 'export', label: 'Export', icon: 'download', onClick: () => { act.exportEmployees(E.filter((e) => sel.includes(e.id))); setSel([]) } },
        ]} />

      {viewing && !exit && (
        <EmployeeProfilePanel e={viewing} canWrite={canWrite} onClose={() => setView(null)}
          onEdit={() => { setView(null); onEdit(viewing) }} onExit={() => { setView(null); startExit(viewing) }} />
      )}
      {exit && (
        <Dialog open onClose={() => setExit(null)} title={`Start exit for ${exit.name}?`} icon="logOut" tone="warning"
          sub="They move to notice period until their last working day, then to Exited. Full and final settlement runs on that date."
          footer={<><PanelButton onClick={() => setExit(null)}>Cancel</PanelButton><PanelButton variant="primary" onClick={doExit} aria-disabled={!lwd || undefined}>Start exit</PanelButton></>}>
          <DateInput label="Last working day" value={lwd} onChange={(e) => setLwd(e.target.value)}
            hint={`Notice period for ${String(exit.type).toLowerCase()} employees is ${(db.classes.find((x) => x.type === exit.type) || {}).notice || suggestedNotice(db.classes)} days`} />
        </Dialog>
      )}
    </>
  )
}

const suggestedNotice = (classes: Rec[]) => Number(((classes.find((c) => c.code === 'FULL_TIME') || classes[0] || {}) as Rec).notice) || 60
