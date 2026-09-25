// Onboarding & Assets (/hrms/onboarding/instances) on the module kit.
//
// Who sees what (the API decides the scope, the page follows it):
//   - HR (hrms.onboarding.instance.write): every new hire's run, can start,
//     hold, resume and reopen runs.
//   - Everyone else with instance.read (employees, managers, finance): the API
//     returns only their OWN runs, so the view is "Your onboarding" rather than
//     a table of colleagues' names they can't read.
//   - Assets: asset.read or instance.write. Templates: template.read.
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, MoreVertical, Plus } from 'lucide-react'
import { usePermission } from '@unifiedtree/sdk'
import { HrStatusPill, HrButton, TableCard, HrAvatar, type PillTone } from '@/shared/components/hr'
import { ModulePage, Views, useView, StatRow, State, RowList, Row, useDesignToast, dmy } from '@/design/module/ModuleKit'
import { AssetsTab } from './AssetsTab'
import { Templates } from './Templates'
import { useInstances, useUpdateInstanceStatus } from './api/useOnboarding'
import type { OnboardingInstance, OnboardingInstanceStatus } from './api/useOnboarding'
import { useEmployeesByIds } from '../api/useWorkforce'
import type { WorkforceEmployee } from '../api/useWorkforce'
import { useCompanies, useDepartments } from '../api/useOrg'

const PAGE_SIZE = 10

// The status column is a free string server-side; anything unrecognised
// falls through to a grey pill with the raw value rather than a wrong label.
type StatusKey = 'IN_PROGRESS' | 'COMPLETED' | 'ON_HOLD'
export const STATUS_LABEL: Record<StatusKey, string> = { IN_PROGRESS: 'In progress', COMPLETED: 'Completed', ON_HOLD: 'On hold' }
export const STATUS_TONE: Record<StatusKey, PillTone> = { IN_PROGRESS: 'warn', COMPLETED: 'ok', ON_HOLD: 'red' }
export function statusKeyOf(status: string): StatusKey | null {
  return status === 'IN_PROGRESS' || status === 'COMPLETED' || status === 'ON_HOLD' ? status : null
}
export const statusLabel = (s: string) => { const k = statusKeyOf(s); return k ? STATUS_LABEL[k] : s.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) }
export const statusTone = (s: string): PillTone => { const k = statusKeyOf(s); return k ? STATUS_TONE[k] : 'gray' }

/** Done = completed or skipped; the run closes itself when the last task is done. */
function progressOf(run: OnboardingInstance) {
  const tasks = run.instanceTasks ?? []
  const done = tasks.filter((t) => t.status === 'COMPLETED' || t.status === 'SKIPPED').length
  return { done, total: tasks.length }
}

function RowMenu({ items }: { items: { label: string; onClick: () => void }[] }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('pointerdown', onPointerDown); document.removeEventListener('keydown', onKey) }
  }, [open])
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-label="Row actions" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-text-tertiary transition-colors hover:bg-[var(--bg-subtle)] hover:text-text-primary">
        <MoreVertical size={16} />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-[calc(100%+4px)] z-50 w-52 overflow-hidden rounded-xl border border-border-default bg-[var(--bg-surface)] py-1 shadow-[0_16px_48px_-16px_rgba(15,110,86,0.25)]">
          {items.map((item) => (
            <button key={item.label} type="button" role="menuitem" onClick={() => { setOpen(false); item.onClick() }}
              className="block w-full px-3.5 py-2 text-left text-[13px] font-medium text-text-primary transition-colors hover:bg-[var(--bg-subtle)]">
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function Progress({ done, total }: { done: number; total: number }) {
  if (!total) return <span style={{ fontSize: 12.5, color: '#94a3b8' }}>No tasks</span>
  const pct = Math.round((done / total) * 100)
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 120 }}>
      <span aria-hidden="true" style={{ flex: 1, height: 6, borderRadius: 999, background: '#eef2f6', overflow: 'hidden', minWidth: 60 }}>
        <span style={{ display: 'block', height: '100%', width: `${pct}%`, background: '#059669', borderRadius: 999 }} />
      </span>
      <span style={{ fontSize: 12.5, color: '#475569', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{`${done}/${total}`}</span>
    </span>
  )
}

type Tab = 'hires' | 'assets' | 'templates'

export const Instances: React.FC = () => {
  const navigate = useNavigate()
  const canReadInstances = usePermission('hrms.onboarding.instance.read')
  const isHr = usePermission('hrms.onboarding.instance.write')
  const canReadAssets = usePermission('hrms.onboarding.asset.read') || isHr
  const canReadTemplates = usePermission('hrms.onboarding.template.read')
  const views = [
    ...(canReadInstances ? [{ key: 'hires', label: isHr ? 'New hires' : 'Your onboarding', icon: 'clipboard' }] : []),
    ...(canReadAssets ? [{ key: 'assets', label: 'Assets', icon: 'briefcase' }] : []),
    ...(canReadTemplates ? [{ key: 'templates', label: 'Checklist templates', icon: 'list' }] : []),
  ]
  const [tab, setTab] = useView(views.map((v) => v.key)) as [Tab, (k: string) => void]
  return (
    <ModulePage crumb="Recruitment" title="Onboarding & assets"
      subtitle={isHr ? 'Bring new hires on board, follow their checklists and track the equipment you hand out.' : canReadAssets ? 'Your joining checklist, and the equipment handed out in the company.' : 'Your joining checklist.'}
      actions={isHr ? <HrButton onClick={() => navigate('/hrms/onboarding/instances/new')}><Plus size={15} /> Start onboarding</HrButton> : undefined}>
      <div style={{ display: 'grid', gap: 16, minWidth: 0 }}>
        {views.length > 1 && <Views items={views} active={tab} onChange={setTab} label="Onboarding views" />}
        {views.length === 0 && <State kind="empty" icon="lock" title="No onboarding access" description="Ask an admin if you should see onboarding or assets." />}
        {tab === 'hires' && canReadInstances && (isHr ? <HiresView /> : <MyOnboarding />)}
        {tab === 'assets' && canReadAssets && <AssetsTab />}
        {tab === 'templates' && canReadTemplates && <Templates embedded />}
      </div>
    </ModulePage>
  )
}

/** Non-HR: the API returns only the viewer's own runs. */
function MyOnboarding() {
  const navigate = useNavigate()
  const { data: runs = [], isLoading, error, refetch } = useInstances(undefined, true)
  if (isLoading) return <State kind="loading" />
  if (error) return <State kind="error" title="Couldn’t load your onboarding" description={(error as Error).message} onRetry={() => refetch()} />
  if (!runs.length) return <State kind="empty" icon="clipboard" title="No onboarding checklist" description="When HR starts your onboarding, your joining tasks appear here." />
  return (
    <RowList>
      {runs.map((run) => {
        const p = progressOf(run)
        return (
          <Row key={run.id} onClick={() => navigate(`/hrms/onboarding/instances/${run.id}`)}
            title={`Onboarding started ${dmy(run.startedAt)}`}
            meta={run.completedAt ? `Completed ${dmy(run.completedAt)}` : `${p.total - p.done} ${p.total - p.done === 1 ? 'task' : 'tasks'} left`}
            trail={<><Progress {...p} /><HrStatusPill tone={statusTone(run.status)}>{statusLabel(run.status)}</HrStatusPill></>} />
        )
      })}
    </RowList>
  )
}

function HiresView() {
  const navigate = useNavigate()
  const { show, node } = useDesignToast()
  const [status, setStatus] = useState<'' | StatusKey>('')
  const [page, setPage] = useState(0)
  // by-ids needs hrms.employee.read; without it names stay a quiet dash.
  const canReadEmployees = usePermission('hrms.employee.read')
  const canReadTemplates = usePermission('hrms.onboarding.template.read')
  // Tiles count every run, so the list is fetched unfiltered and narrowed here.
  const { data: instances = [], isLoading, error, refetch } = useInstances(undefined, true)
  const ids = useMemo(() => instances.map((r) => r.employeeId).filter((id): id is string => !!id), [instances])
  const { data: people } = useEmployeesByIds(ids, { enabled: canReadEmployees })
  const byId = useMemo(() => { const m = new Map<string, WorkforceEmployee>(); (people ?? []).forEach((e) => m.set(e.id, e)); return m }, [people])
  const { data: companies = [] } = useCompanies()
  const { data: departments = [] } = useDepartments(companies[0]?.id ?? '')
  const deptName = useMemo(() => new Map(departments.map((d) => [d.id, d.name])), [departments])

  const counts = useMemo(() => {
    const c = { total: instances.length, IN_PROGRESS: 0, COMPLETED: 0, ON_HOLD: 0 }
    instances.forEach((r) => { const k = statusKeyOf(r.status); if (k) c[k] += 1 })
    return c
  }, [instances])
  const filtered = useMemo(() => (status ? instances.filter((r) => r.status === status) : instances), [instances, status])
  const total = filtered.length
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const safePage = Math.min(page, totalPages - 1)
  useEffect(() => { setPage(0) }, [status])
  const rows = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE)

  // ON_HOLD is only reachable by hand; IN_PROGRESS -> COMPLETED happens when the last task is done.
  const updateStatus = useUpdateInstanceStatus()
  const setRowStatus = async (instanceId: string, next: OnboardingInstanceStatus, done: string) => {
    try { await updateStatus.mutateAsync({ instanceId, status: next }); show(done) } catch (e) { show('Couldn’t update the onboarding', true, (e as Error)?.message) }
  }
  const nameOf = (r: OnboardingInstance) => {
    const e = byId.get(r.employeeId)
    return [e?.firstName, e?.lastName].filter(Boolean).join(' ').trim() || 'Employee'
  }
  const pick = (k: '' | StatusKey) => setStatus((cur) => (cur === k ? '' : k))

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {isLoading ? <State kind="loading" height={96} /> : <StatRow tiles={[
        { icon: 'clipboard', color: 'blue', label: 'All onboarding', value: String(counts.total), sub: 'Every run so far', onClick: () => pick('') },
        { icon: 'userCheck', color: 'orange', label: 'In progress', value: String(counts.IN_PROGRESS), sub: 'Tasks still open', onClick: () => pick('IN_PROGRESS') },
        { icon: 'checkCircle', color: 'green', label: 'Completed', value: String(counts.COMPLETED), sub: 'Every task done', onClick: () => pick('COMPLETED') },
        { icon: 'clock', color: 'red', label: 'On hold', value: String(counts.ON_HOLD), sub: 'Paused by HR', onClick: () => pick('ON_HOLD') },
      ]} />}

      {isLoading ? <State kind="loading" height={260} />
        : error ? <State kind="error" title="Couldn’t load onboarding" description={(error as Error).message} onRetry={() => refetch()} />
          : instances.length === 0 ? <State kind="empty" icon="clipboard" title="No one is being onboarded yet" description="Use “Start onboarding” to add a new hire and give them a joining checklist." />
            : (
              <TableCard
                actions={
                  <>
                    <select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value as '' | StatusKey)} className="ut-select ut-select-sm w-auto">
                      <option value="">All statuses</option>
                      {(Object.keys(STATUS_LABEL) as StatusKey[]).map((k) => <option key={k} value={k}>{STATUS_LABEL[k]}</option>)}
                    </select>
                    {status && <HrButton size="sm" variant="ghost" onClick={() => setStatus('')}>Clear filter</HrButton>}
                  </>
                }
                footer={total > 0 ? (
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-text-secondary">Showing <span className="font-semibold text-text-primary">{safePage * PAGE_SIZE + 1}–{Math.min((safePage + 1) * PAGE_SIZE, total)}</span> of <span className="font-semibold text-text-primary">{total}</span></p>
                    <div className="flex items-center gap-2">
                      <button aria-label="Previous page" onClick={() => setPage(safePage - 1)} disabled={safePage === 0} className="rounded-lg border border-border-default p-1.5 text-text-secondary hover:text-text-primary disabled:opacity-40"><ChevronLeft size={15} /></button>
                      <span className="px-1 text-xs font-semibold text-text-primary">{safePage + 1} / {totalPages}</span>
                      <button aria-label="Next page" onClick={() => setPage(safePage + 1)} disabled={safePage >= totalPages - 1} className="rounded-lg border border-border-default p-1.5 text-text-secondary hover:text-text-primary disabled:opacity-40"><ChevronRight size={15} /></button>
                    </div>
                  </div>
                ) : undefined}
              >
                <table className="hr-table">
                  <thead>
                    <tr>
                      <th>New hire</th>
                      <th className="hidden lg:table-cell">Department</th>
                      <th className="hidden sm:table-cell">Joining date</th>
                      <th className="hidden md:table-cell">Checklist</th>
                      <th>Status</th>
                      <th className="w-32"><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 && (
                      <tr><td colSpan={6} className="!p-0"><State kind="empty" icon="clipboard" title="No onboarding with this status" description="Clear the filter to see every run." /></td></tr>
                    )}
                    {rows.map((r, i) => {
                      const emp = byId.get(r.employeeId)
                      const dept = emp?.departmentId ? deptName.get(emp.departmentId) : undefined
                      // The run has no joining date of its own: the hire's date of joining, else when it started.
                      const joining = emp?.dateOfJoining ?? r.startedAt
                      const key = statusKeyOf(r.status)
                      const open = () => navigate(`/hrms/onboarding/instances/${r.id}`)
                      return (
                        <tr key={r.id} onClick={open} className="cursor-pointer">
                          <td>{canReadEmployees ? <HrAvatar name={nameOf(r)} sub={emp?.email} seed={safePage * PAGE_SIZE + i} /> : <span className="text-text-tertiary" title="Your role can’t read employee names">—</span>}</td>
                          <td className="hidden lg:table-cell text-text-secondary">{dept || '—'}</td>
                          <td className="hidden sm:table-cell text-text-secondary">{dmy(joining)}</td>
                          <td className="hidden md:table-cell"><Progress {...progressOf(r)} /></td>
                          <td><HrStatusPill tone={statusTone(r.status)}>{statusLabel(r.status)}</HrStatusPill></td>
                          <td onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center gap-1">
                              <HrButton variant="ghost" size="sm" onClick={open}>Open</HrButton>
                              <RowMenu items={[
                                { label: 'Open checklist', onClick: open },
                                ...(key === 'IN_PROGRESS' ? [{ label: 'Put on hold', onClick: () => setRowStatus(r.id, 'ON_HOLD', 'Onboarding put on hold') }] : []),
                                ...(key === 'ON_HOLD' ? [{ label: 'Resume onboarding', onClick: () => setRowStatus(r.id, 'IN_PROGRESS', 'Onboarding resumed') }] : []),
                                ...(key === 'COMPLETED' ? [{ label: 'Reopen onboarding', onClick: () => setRowStatus(r.id, 'IN_PROGRESS', 'Onboarding reopened') }] : []),
                                ...(canReadEmployees && emp ? [{ label: 'Open employee profile', onClick: () => navigate(`/hrms/employees/${emp.id}`) }] : []),
                                ...(canReadTemplates ? [{ label: 'Open template', onClick: () => navigate(`/hrms/onboarding/templates/${r.templateId}`) }] : []),
                              ]} />
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </TableCard>
            )}
      {node}
    </div>
  )
}
