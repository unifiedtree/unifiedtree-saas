// Onboarding & assets (/hrms/onboarding/instances) on the redesign kit (prototype PgTalent h-onb).
// Three views kept in ?view= (hires · assets · templates, the registry's keys; today's order):
//   - New hires (HR, hrms.onboarding.instance.write): this month's figures and every run with the
//     hire's name, department, joining date, checklist and progress (BW-69 overview, one call), with
//     a status filter, Open record and hold / resume / reopen. Everyone else with instance.read gets
//     "Your onboarding": the API returns only their own runs.
//   - Assets: asset.read or instance.write. Checklist templates: template.read.
// The page's main action follows the view (Start onboarding · Register an asset · New template).
import React, { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { MoreVertical } from 'lucide-react'
import { P, usePermission } from '@unifiedtree/sdk'
import {
  Button, CellActions, CellPerson, EmptyState, ListRow, ListRows, MiniStat, MiniStatGrid, PageFrame, PageHeader, PillTabs,
  SegmentedControl, Section, StatusPill, Table, errorText, type TableColumn,
} from '@/design/kit/display'
import { Pager } from '@/design/kit/data'
import { Menu, useToast } from '@/design/kit/overlays'
import { MONTHS, istToday } from '@/design/dc/dates'
import { AssetsTab, RegisterAssetPanel } from './AssetsTab'
import { CreateTemplatePanel, Templates } from './Templates'
import {
  useInstances, useOnboardingOverview, useTemplates, useUpdateInstanceStatus,
  type OnboardingInstanceStatus, type OnboardingOverview, type OnboardingOverviewRow,
} from './api/useOnboarding'
import { useEmployeesByIds } from '../api/useWorkforce'
import { useCompanies, useDepartments } from '../api/useOrg'
import {
  RUN_STATUS, RUN_STATUS_KEYS, fullDate, joiningText, progressOf, rowsFromInstances, runPill, runStatusKey, runStatusLabel, runStatusTone,
  tasksText, type RunStatusKey,
} from './onboardingModel'
import './onboarding.css'

const PAGE_SIZE = 10
type Tab = 'hires' | 'assets' | 'templates'

export const Instances: React.FC = () => {
  const navigate = useNavigate()
  const canReadInstances = usePermission('hrms.onboarding.instance.read')
  const isHr = usePermission('hrms.onboarding.instance.write')
  const canReadAssets = usePermission('hrms.onboarding.asset.read') || isHr
  const canWriteAssets = usePermission('hrms.onboarding.asset.write') || isHr
  const canReadTemplates = usePermission('hrms.onboarding.template.read')
  const canWriteTemplates = usePermission(P.HRMS_ONBOARDING_TEMPLATE_WRITE)
  const views: { key: Tab; label: string }[] = [
    ...(canReadInstances ? [{ key: 'hires' as const, label: isHr ? 'New hires' : 'Your onboarding' }] : []),
    ...(canReadAssets ? [{ key: 'assets' as const, label: 'Assets' }] : []),
    ...(canReadTemplates ? [{ key: 'templates' as const, label: 'Checklist templates' }] : []),
  ]
  const [params, setParams] = useSearchParams()
  const asked = params.get('view')
  const tab: Tab | '' = views.find((v) => v.key === asked)?.key ?? views[0]?.key ?? ''
  const setTab = (next: string) => {
    const sp = new URLSearchParams(params)
    sp.set('view', next)
    setParams(sp, { replace: true })
  }
  const [panel, setPanel] = useState<'template' | 'asset' | null>(null)

  const sub = tab === 'templates' ? 'Reusable task lists for new hires.'
    : tab === 'assets' ? 'Company equipment: who has it, and what’s in store.'
      : isHr ? 'Everyone joining, and how far they are through their checklist.'
        : 'Your joining checklist, and how far you are through it.'
  const action = tab === 'hires' && isHr
    ? <Button variant="primary" size={40} icon="plus" onClick={() => navigate('/hrms/onboarding/instances/new')}>Start onboarding</Button>
    : tab === 'templates' && canWriteTemplates
      ? <Button variant="primary" size={40} icon="plus" onClick={() => setPanel('template')}>New template</Button>
      : tab === 'assets' && canWriteAssets
        ? <Button variant="primary" size={40} icon="plus" onClick={() => setPanel('asset')}>Register an asset</Button>
        : undefined

  return (
    <PageFrame label="Onboarding & assets">
      <PageHeader eyebrow="Hiring & onboarding" title="Onboarding & assets" sub={views.length ? sub : undefined} actions={action} />
      {views.length > 1 && <PillTabs label="Onboarding views" semantics="toggle" activeKey={tab} onSelect={setTab} items={views} />}
      {views.length === 0 && <EmptyState icon="lock" title="No onboarding access" hint="Ask an admin if you should see onboarding or assets." />}
      {tab === 'hires' && (isHr ? <HiresView /> : <MyOnboarding />)}
      {tab === 'assets' && <AssetsTab />}
      {tab === 'templates' && <Templates embedded />}
      <CreateTemplatePanel open={panel === 'template'} onClose={() => setPanel(null)} />
      <RegisterAssetPanel open={panel === 'asset'} onClose={() => setPanel(null)} />
    </PageFrame>
  )
}

/** Not HR: the API returns only the viewer's own runs. */
function MyOnboarding() {
  const navigate = useNavigate()
  const { data: runs = [], isLoading, error, refetch, isRefetching } = useInstances(undefined, true)
  return (
    <Section title="Your onboarding" body="list" loading={isLoading} error={error} onRetry={() => refetch()} retrying={isRefetching}
      empty={!runs.length ? { title: 'No onboarding checklist', hint: 'When HR starts your onboarding, your joining tasks appear here.', icon: 'clipboard', variant: 'plain' } : undefined}>
      <ListRows label="Your onboarding checklists">
        {runs.map((run) => {
          const p = progressOf(run.instanceTasks ?? [])
          const left = p.total - p.done
          return (
            <ListRow key={run.id} chevron onClick={() => navigate(`/hrms/onboarding/instances/${run.id}`)}
              title={`Onboarding started ${fullDate(run.startedAt)}`}
              sub={run.completedAt ? `Completed ${fullDate(run.completedAt)}` : `${left} ${left === 1 ? 'task' : 'tasks'} left`}
              end={<span className="onb-row"><span className="onb-muted onb-num">{tasksText(p.done, p.total)}</span><StatusPill tone={runStatusTone(run.status)}>{runStatusLabel(run.status)}</StatusPill></span>} />
          )
        })}
      </ListRows>
    </Section>
  )
}

/** HR: the overview in one call; a server without it gets the same rows built from the plain list. */
function HiresView() {
  const overview = useOnboardingOverview()
  if (overview.notAvailable) return <LegacyHires />
  return <HiresBody data={overview.data} loading={overview.isLoading} error={overview.error} retrying={overview.isRefetching} onRetry={() => overview.refetch()} />
}

/** Today's way of building the list: the runs, then names (directory read only), departments and template names. */
function LegacyHires() {
  const today = istToday()
  const canReadEmployees = usePermission('hrms.employee.read')
  const canReadTemplates = usePermission('hrms.onboarding.template.read')
  const runs = useInstances(undefined, true)
  const ids = useMemo(() => (runs.data ?? []).map((r) => r.employeeId).filter((id): id is string => !!id), [runs.data])
  const people = useEmployeesByIds(ids, { enabled: canReadEmployees })
  const { data: companies = [] } = useCompanies()
  const { data: departments = [] } = useDepartments(companies[0]?.id ?? '')
  const templates = useTemplates(undefined, { enabled: canReadTemplates })
  const data: OnboardingOverview | undefined = useMemo(() => {
    if (!runs.data) return undefined
    const byId = new Map((people.data ?? []).map((e) => [e.id, e]))
    const dept = new Map(departments.map((d) => [d.id, d.name]))
    const tpl = new Map((templates.data ?? []).map((t) => [t.id, t.name]))
    return rowsFromInstances(runs.data, {
      person: (id) => {
        const e = byId.get(id)
        return e && { name: [e.firstName, e.lastName].filter(Boolean).join(' '), code: e.employeeCode, companyId: e.companyId, departmentId: e.departmentId, dateOfJoining: e.dateOfJoining }
      },
      department: (id) => dept.get(id),
      template: (id) => tpl.get(id),
    }, today)
  }, [runs.data, people.data, departments, templates.data, today])
  return <HiresBody data={data} loading={runs.isLoading} error={runs.error} retrying={runs.isRefetching} onRetry={() => runs.refetch()} />
}

function HiresBody({ data, loading, error, retrying, onRetry }: { data?: OnboardingOverview; loading: boolean; error: unknown; retrying?: boolean; onRetry: () => void }) {
  const navigate = useNavigate()
  const toast = useToast()
  const today = istToday()
  const canReadEmployees = usePermission('hrms.employee.read')
  const canReadTemplates = usePermission('hrms.onboarding.template.read')
  const [status, setStatus] = useState<'all' | RunStatusKey>('all')
  const [page, setPage] = useState(0)
  const updateStatus = useUpdateInstanceStatus()
  const rows = useMemo(() => data?.rows ?? [], [data])
  const counts = data?.counts
  const filtered = useMemo(() => (status === 'all' ? rows : rows.filter((r) => r.status === status)), [rows, status])
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, pages - 1)
  const pageRows = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE)
  const open = (r: OnboardingOverviewRow) => navigate(`/hrms/onboarding/instances/${r.instanceId}`)
  // ON_HOLD is only reachable by hand; IN_PROGRESS → COMPLETED happens when the last task is done.
  const setRunStatus = async (r: OnboardingOverviewRow, next: OnboardingInstanceStatus, done: string) => {
    try { await updateStatus.mutateAsync({ instanceId: r.instanceId, status: next }); toast.success(done) }
    catch (e) { toast.error('Couldn’t update the onboarding', { detail: errorText(e, 'Try again in a moment.') }) }
  }
  const pick = (next: 'all' | RunStatusKey) => { setStatus(next); setPage(0) }

  const columns: TableColumn<OnboardingOverviewRow>[] = [
    {
      key: 'hire', header: 'New hire', primary: true, render: (r) => r.employeeName
        ? <CellPerson name={r.employeeName} sub={r.departmentName || r.employeeCode || undefined} />
        : <span className="onb-muted" title="Your role can’t read employee names">—</span>,
    },
    // The run has no joining date of its own: the hire's date of joining, else when it started.
    { key: 'joining', header: 'Joining', render: (r) => <span className="onb-num">{joiningText(r.dateOfJoining ?? r.startedAt, today)}</span> },
    { key: 'template', header: 'Template', render: (r) => <span className="onb-clip" title={r.templateName || undefined}>{r.templateName || '—'}</span> },
    { key: 'progress', header: 'Progress', render: (r) => <span className="onb-num">{tasksText(r.tasksDone, r.tasksTotal)}</span> },
    { key: 'status', header: 'Status', render: (r) => { const p = runPill(r.status, r.dateOfJoining, today); return <StatusPill tone={p.tone}>{p.label}</StatusPill> } },
    {
      key: 'act', header: <span className="uk-sr">Actions</span>, label: 'Actions', align: 'right', render: (r) => {
        const key = runStatusKey(r.status)
        const name = r.employeeName || 'this new hire'
        return (
          <CellActions>
            <Button variant="secondary" size={30} onClick={() => open(r)}>Open record</Button>
            <Menu label={`More for ${name}`} width={240} placement="bottom-end"
              trigger={({ props }) => <button type="button" {...props} className="onb-more" aria-label={`More for ${name}`}><MoreVertical size={16} aria-hidden="true" /></button>}
              items={[
                { key: 'open', label: 'Open checklist', icon: 'clipboard', onSelect: () => open(r) },
                ...(key === 'IN_PROGRESS' ? [{ key: 'hold', label: 'Put on hold', icon: 'clock', onSelect: () => { void setRunStatus(r, 'ON_HOLD', 'Onboarding put on hold') } }] : []),
                ...(key === 'ON_HOLD' ? [{ key: 'resume', label: 'Resume onboarding', icon: 'arrowRight', onSelect: () => { void setRunStatus(r, 'IN_PROGRESS', 'Onboarding resumed') } }] : []),
                ...(key === 'COMPLETED' ? [{ key: 'reopen', label: 'Reopen onboarding', icon: 'arrowRight', onSelect: () => { void setRunStatus(r, 'IN_PROGRESS', 'Onboarding reopened') } }] : []),
                ...(canReadEmployees ? [{ key: 'profile', label: 'Open employee profile', icon: 'users', onSelect: () => navigate(`/hrms/employees/${r.employeeId}`) }] : []),
                ...(canReadTemplates && r.templateId ? [{ key: 'template', label: 'Open template', icon: 'list', onSelect: () => navigate(`/hrms/onboarding/templates/${r.templateId}`) }] : []),
              ]} />
          </CellActions>
        )
      },
    },
  ]

  const month = MONTHS[Number(today.slice(5, 7)) - 1]
  return (
    <>
      {!error && (
        <Section title="This month" loading={loading} skeleton="stats" skeletonRows={3}>
          {counts && (
            <MiniStatGrid>
              <MiniStat label="In progress" value={counts.inProgress} note="Working through a checklist" tone="info" />
              <MiniStat label="Joining this month" value={counts.joiningThisMonth} note={month} tone="success" />
              <MiniStat label="Tasks overdue" value={counts.tasksOverdue} note="Past their due day" tone="warning" />
            </MiniStatGrid>
          )}
        </Section>
      )}
      <Section title="New hires" body="flush" loading={loading} skeleton="table" error={error} onRetry={onRetry} retrying={retrying}
        empty={!loading && !error && rows.length === 0 ? { title: 'No onboarding runs yet.', hint: 'Use “Start onboarding” when someone accepts an offer, to give them a joining checklist.', icon: 'clipboard', variant: 'plain' } : undefined}
        actions={rows.length > 0 && counts ? (
          <SegmentedControl label="Onboarding status" semantics="toggle" size="sm" value={status} onChange={pick}
            options={[{ value: 'all' as const, label: 'All', count: counts.all }, ...RUN_STATUS_KEYS.map((k) => ({
              value: k, label: RUN_STATUS[k].label, count: k === 'IN_PROGRESS' ? counts.inProgress : k === 'ON_HOLD' ? counts.onHold : counts.completed,
            }))]} />
        ) : undefined}
        footer={filtered.length > PAGE_SIZE ? <Pager page={safePage} pageSize={PAGE_SIZE} total={filtered.length} onPageChange={setPage} noun="new hires" /> : undefined}>
        <Table label="New hires" columns={columns} rows={pageRows} rowKey={(r) => r.instanceId} onRowClick={open} mobile="cards"
          empty={<EmptyState variant="plain" icon="clipboard" title="No onboarding with this status" hint="Choose All to see every run." />} />
      </Section>
    </>
  )
}
