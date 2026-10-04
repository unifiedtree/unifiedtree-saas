// Onboarding & assets (/hrms/onboarding/instances) on the redesign kit (P-HIRE; prototype
// PgTalent h-onb). Today's views, in today's order, as in-page pills kept in ?view=:
// New hires · Assets · Checklist templates.
//
// Who sees what (the API decides the scope, the page follows it):
//   - HR (hrms.onboarding.instance.write): every new hire, with name, department, joining
//     day, checklist and progress in one call (BW-69); can start, hold, resume and reopen.
//   - Everyone else with instance.read (employees, managers, finance): the API returns only
//     their OWN onboarding, so the view is "Your onboarding" rather than a table of
//     colleagues they can't read.
//   - Assets: asset.read or instance.write. Templates: template.read.
import React, { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MoreHorizontal } from 'lucide-react'
import { P, usePermission } from '@unifiedtree/sdk'
import {
  Button, CellActions, CellPerson, EmptyState, ListRow, ListRows, MiniStat, MiniStatGrid, PageFrame, PageHeader, PillTabs, ProgressBar,
  Section, SegmentedControl, StatusPill, Table, type TableColumn,
} from '@/design/kit/display'
import { Pager } from '@/design/kit/data'
import { Menu, useToast, type MenuEntry } from '@/design/kit/overlays'
import { useView } from '@/design/module/ModuleKit'
import { AssetsTab } from './AssetsTab'
import { Templates } from './Templates'
import { useInstances, useOnboardingOverview, useTemplates, useUpdateInstanceStatus, type OnboardingInstanceStatus, type OnboardingOverviewRow } from './api/useOnboarding'
import { INSTANCE_STATUS_LABEL, instanceState, joiningLabel, overviewFromInstances, progressText, statusKeyOf, type InstanceStatusKey } from './onboardingModel'
import { useEmployeesByIds } from '../api/useWorkforce'
import { dayMon, istTodayIso } from '../hiring/hiringModel'
import '../hiring/hiring.css'

const PAGE_SIZE = 10
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

type Tab = 'hires' | 'assets' | 'templates'

export const Instances: React.FC = () => {
  const navigate = useNavigate()
  const canReadInstances = usePermission('hrms.onboarding.instance.read')
  const isHr = usePermission('hrms.onboarding.instance.write')
  const canReadAssets = usePermission('hrms.onboarding.asset.read') || isHr
  const canWriteAssets = usePermission('hrms.onboarding.asset.write') || isHr
  const canReadTemplates = usePermission('hrms.onboarding.template.read')
  const canWriteTemplates = usePermission(P.HRMS_ONBOARDING_TEMPLATE_WRITE)
  const views = [
    ...(canReadInstances ? [{ key: 'hires', label: isHr ? 'New hires' : 'Your onboarding' }] : []),
    ...(canReadAssets ? [{ key: 'assets', label: 'Assets' }] : []),
    ...(canReadTemplates ? [{ key: 'templates', label: 'Checklist templates' }] : []),
  ]
  const [tab, setTab] = useView(views.map((v) => v.key)) as [Tab, (k: string) => void]
  const [adding, setAdding] = useState<Tab | null>(null)
  const sub = tab === 'assets' ? 'Company equipment: who has it, and what’s in store.'
    : tab === 'templates' ? 'Reusable task lists for new hires.'
      : isHr ? 'Everyone joining, and how far they are through their checklist.' : 'Your joining checklist.'
  const action = tab === 'hires' && isHr ? <Button variant="primary" size={40} icon="plus" onClick={() => navigate('/hrms/onboarding/instances/new')}>Start onboarding</Button>
    : tab === 'assets' && canWriteAssets ? <Button variant="primary" size={40} icon="plus" onClick={() => setAdding('assets')}>Register an asset</Button>
      : tab === 'templates' && canWriteTemplates ? <Button variant="primary" size={40} icon="plus" onClick={() => setAdding('templates')}>New template</Button>
        : undefined
  return (
    <PageFrame label="Onboarding and assets" className="hi-page">
      <PageHeader eyebrow="Hiring & onboarding" title="Onboarding & assets" sub={views.length ? sub : undefined} actions={action} />
      {views.length > 1 && <PillTabs label="Onboarding views" semantics="toggle" activeKey={tab} onSelect={(k) => { setAdding(null); setTab(k) }} items={views} />}
      {views.length === 0 && <EmptyState icon="lock" title="No onboarding access" hint="Ask an admin if you should see onboarding or assets." />}
      {tab === 'hires' && canReadInstances && (isHr ? <HiresView /> : <MyOnboarding />)}
      {tab === 'assets' && canReadAssets && <AssetsTab registering={adding === 'assets'} onRegisterDone={() => setAdding(null)} />}
      {tab === 'templates' && canReadTemplates && <Templates embedded creating={adding === 'templates'} onCreateDone={() => setAdding(null)} />}
    </PageFrame>
  )
}

/** Non-HR: the API returns only the viewer's own onboarding, shown as a short list (no table). */
function MyOnboarding() {
  const navigate = useNavigate()
  const { data: runs = [], isLoading, error, refetch, isFetching } = useInstances(undefined, true)
  const today = istTodayIso()
  return (
    <Section title="Your onboarding" body="list" loading={isLoading} error={error} onRetry={() => refetch()} retrying={isFetching}
      empty={!isLoading && !error && runs.length === 0 ? { title: 'No onboarding checklist', hint: 'When HR starts your onboarding, your joining tasks appear here.', icon: 'clipboard' } : undefined}>
      <ListRows label="Your onboarding">
        {runs.map((run) => {
          const tasks = run.instanceTasks ?? []
          const done = tasks.filter((t) => t.status === 'COMPLETED' || t.status === 'SKIPPED').length
          const left = tasks.length - done
          const state = instanceState(run.status, null, today)
          return (
            <ListRow key={run.id} onClick={() => navigate(`/hrms/onboarding/instances/${run.id}`)}
              title={`Onboarding started ${dayMon(run.startedAt, today)}`}
              sub={run.completedAt ? `Completed ${dayMon(run.completedAt, today)}` : `${left} ${left === 1 ? 'task' : 'tasks'} left · ${progressText(done, tasks.length)}`}
              end={<StatusPill tone={state.tone}>{state.label}</StatusPill>} chevron />
          )
        })}
      </ListRows>
    </Section>
  )
}

const ALL = 'all'

function HiresView() {
  const navigate = useNavigate()
  const toast = useToast()
  const canReadEmployees = usePermission('hrms.employee.read')
  const canReadTemplates = usePermission('hrms.onboarding.template.read')
  const overview = useOnboardingOverview()
  const [status, setStatus] = useState<InstanceStatusKey | ''>('')
  const [page, setPage] = useState(0)
  const today = istTodayIso()
  // A server without the overview (404): build the rows from the instance list, as before.
  const fallback = overview.notAvailable
  const runs = useInstances(undefined, fallback)
  const ids = useMemo(() => (runs.data ?? []).map((r) => r.employeeId).filter((id): id is string => !!id), [runs.data])
  const people = useEmployeesByIds(ids, { enabled: fallback && canReadEmployees && ids.length > 0 })
  const templates = useTemplates(undefined, { enabled: fallback && canReadTemplates })
  const local = useMemo(() => (fallback ? overviewFromInstances(runs.data ?? [], people.data ?? [], templates.data ?? [], today) : null),
    [fallback, runs.data, people.data, templates.data, today])
  const data = local ?? overview.data
  const loading = overview.isLoading || (fallback && runs.isLoading)
  const error = overview.error || (fallback ? runs.error : null)
  const retry = () => { void overview.refetch(); if (fallback) void runs.refetch() }
  const counts = data?.counts
  const all = useMemo(() => data?.rows ?? [], [data])
  const filtered = useMemo(() => (status ? all.filter((r) => r.status === status) : all), [all, status])
  const rows = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE)
  // ON_HOLD is only reachable by hand; IN_PROGRESS → COMPLETED happens when the last task is done.
  const updateStatus = useUpdateInstanceStatus()
  const setRowStatus = async (r: OnboardingOverviewRow, next: OnboardingInstanceStatus, done: string) => {
    try { await updateStatus.mutateAsync({ instanceId: r.instanceId, status: next }); toast.success(done, { detail: r.employeeName ?? undefined }) }
    catch (e) { toast.error('Couldn’t update the onboarding', { detail: (e as Error)?.message }) }
  }
  const open = (r: OnboardingOverviewRow) => navigate(`/hrms/onboarding/instances/${r.instanceId}`)
  const pick = (v: string) => { setStatus(v === ALL ? '' : (v as InstanceStatusKey)); setPage(0) }

  const columns: TableColumn<OnboardingOverviewRow>[] = [
    { key: 'hire', header: 'New hire', primary: true, width: '26%', render: (r) => <CellPerson name={r.employeeName || 'Employee'} sub={r.departmentName || r.employeeCode || undefined} /> },
    { key: 'joining', header: 'Joining', render: (r) => <span className="hi-num">{r.dateOfJoining ? joiningLabel(r.dateOfJoining, today) : dayMon(r.startedAt, today)}</span> },
    { key: 'template', header: 'Template', render: (r) => r.templateName || '—' },
    {
      key: 'progress', header: 'Progress', render: (r) => (
        <span className="hi-progress">
          <span className="hi-progress__text">{progressText(r.tasksDone, r.tasksTotal)}</span>
          {r.tasksTotal > 0 && <ProgressBar value={r.tasksDone} max={r.tasksTotal} height={4} label={`${r.employeeName || 'Employee'}: ${progressText(r.tasksDone, r.tasksTotal)} done`} />}
        </span>
      ),
    },
    {
      key: 'status', header: 'Status', render: (r) => {
        const s = instanceState(r.status, r.dateOfJoining, today)
        return (
          <span className="hi-pills">
            <StatusPill tone={s.tone}>{s.label}</StatusPill>
            {r.tasksOverdue > 0 && r.status === 'IN_PROGRESS' && <StatusPill tone="danger" size="xs">{`${r.tasksOverdue} overdue`}</StatusPill>}
          </span>
        )
      },
    },
    {
      key: 'actions', header: <span className="uk-sr">Actions</span>, label: 'Actions', align: 'right', render: (r) => {
        const key = statusKeyOf(r.status)
        const items: MenuEntry[] = [
          ...(key === 'IN_PROGRESS' ? [{ key: 'hold', label: 'Put on hold', icon: 'clock', onSelect: () => setRowStatus(r, 'ON_HOLD', 'Onboarding put on hold') }] : []),
          ...(key === 'ON_HOLD' ? [{ key: 'resume', label: 'Resume onboarding', icon: 'arrowRight', onSelect: () => setRowStatus(r, 'IN_PROGRESS', 'Onboarding resumed') }] : []),
          ...(key === 'COMPLETED' ? [{ key: 'reopen', label: 'Reopen onboarding', icon: 'swap', onSelect: () => setRowStatus(r, 'IN_PROGRESS', 'Onboarding reopened') }] : []),
          ...(canReadEmployees && r.employeeId ? [{ key: 'profile', label: 'Open employee profile', icon: 'users', onSelect: () => navigate(`/hrms/employees/${r.employeeId}`) }] : []),
          ...(canReadTemplates && r.templateId ? [{ key: 'template', label: 'Open template', icon: 'list', onSelect: () => navigate(`/hrms/onboarding/templates/${r.templateId}`) }] : []),
        ]
        return (
          <CellActions>
            <Button size={30} variant="secondary" onClick={() => open(r)} aria-label={`Open ${r.employeeName || 'the'} onboarding record`}>Open record</Button>
            {items.length > 0 && (
              <Menu label={`More for ${r.employeeName || 'this onboarding'}`} width={240} placement="bottom-end" items={items}
                trigger={({ props }) => <Button {...props} size={30} variant="plain" icon={<MoreHorizontal size={16} />} aria-label={`More for ${r.employeeName || 'this onboarding'}`} />} />
            )}
          </CellActions>
        )
      },
    },
  ]

  const month = MONTHS[Number(today.slice(5, 7)) - 1]
  const filters = [
    { value: ALL, label: 'All', count: counts?.all },
    ...(Object.keys(INSTANCE_STATUS_LABEL) as InstanceStatusKey[]).map((k) => ({
      value: k, label: INSTANCE_STATUS_LABEL[k], count: k === 'IN_PROGRESS' ? counts?.inProgress : k === 'ON_HOLD' ? counts?.onHold : counts?.completed,
    })),
  ]
  const retrying = overview.isFetching || runs.isFetching
  return (
    <>
      <Section title="This month" body="tight" loading={loading} skeleton="stats" error={error} onRetry={retry} retrying={retrying}>
        <MiniStatGrid>
          <MiniStat label="In progress" value={counts?.inProgress} note="Working through a checklist" tone="info" />
          {/* Joining days need the employee records; without them (an older server, no employee read) it isn't counted. */}
          {(!fallback || canReadEmployees) && <MiniStat label="Joining this month" value={counts?.joiningThisMonth} note={month} tone="success" />}
          <MiniStat label="Tasks overdue" value={counts?.tasksOverdue} note="Past their due day" tone="warning" />
        </MiniStatGrid>
      </Section>
      <Section title="New hires" body="flush" loading={loading} skeleton="table" error={error} onRetry={retry} retrying={retrying}
        actions={all.length > 0 ? <SegmentedControl label="Filter by status" semantics="toggle" size="sm" options={filters} value={status || ALL} onChange={pick} /> : undefined}
        empty={!loading && !error && all.length === 0 ? { title: 'No one is being onboarded yet', hint: 'Use “Start onboarding” to add a new hire and give them a joining checklist.', icon: 'clipboard' } : undefined}
        footer={filtered.length > PAGE_SIZE ? <Pager page={page} pageSize={PAGE_SIZE} total={filtered.length} onPageChange={setPage} noun="new hires" /> : undefined}>
        <Table label="New hires" columns={columns} rows={rows} rowKey={(r) => r.instanceId} mobile="cards" onRowClick={open}
          empty={<span className="hi-muted">No onboarding with this status. Pick “All” to see every new hire.</span>} />
      </Section>
    </>
  )
}
