import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  CheckCircle2, ChevronLeft, ChevronRight, ClipboardList, MoreVertical, PauseCircle, Plus, UserPlus,
} from 'lucide-react'
import { usePermission } from '@unifiedtree/sdk'
import { TableSkeleton, EmptyState } from '@unifiedtree/ui-kit'
import {
  HrStatCard, HrStatusPill, HrPageHeader, HrButton, TableCard, HrAvatar, HrTabs, HrTabPanel, type PillTone,
} from '@/shared/components/hr'
import { useToast } from '@/shared/hooks/useToast'
import { useInstances, useUpdateInstanceStatus } from './api/useOnboarding'
import type { OnboardingInstance, OnboardingInstanceStatus } from './api/useOnboarding'
import { useEmployeesByIds } from '../api/useWorkforce'
import type { WorkforceEmployee } from '../api/useWorkforce'
import { useCompanies, useDepartments } from '../api/useOrg'

const PAGE_SIZE = 10

// ── Status vocabulary ────────────────────────────────────────────────────────
// OnboardingInstance.status is 'IN_PROGRESS' | 'COMPLETED' | string — the
// column is a free string server-side, so ON_HOLD is carried here (the
// dashboard has a tile for it) and anything unrecognised falls through to a
// neutral grey pill showing the raw value rather than being mislabelled.
type StatusKey = 'IN_PROGRESS' | 'COMPLETED' | 'ON_HOLD'

const STATUS_LABEL: Record<StatusKey, string> = {
  IN_PROGRESS: 'In Progress',
  COMPLETED: 'Completed',
  ON_HOLD: 'On Hold',
}

const STATUS_TONE: Record<StatusKey, PillTone> = {
  IN_PROGRESS: 'warn',
  COMPLETED: 'ok',
  ON_HOLD: 'red',
}

const STATUSES: { value: '' | StatusKey; label: string }[] = [
  { value: '', label: 'All Statuses' },
  { value: 'IN_PROGRESS', label: 'In Progress' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'ON_HOLD', label: 'On Hold' },
]

function statusKeyOf(status: string): StatusKey | null {
  return status === 'IN_PROGRESS' || status === 'COMPLETED' || status === 'ON_HOLD' ? status : null
}

// ── Row action menu (the kebab beside "View") ────────────────────────────────
function RowMenu({ items }: { items: { label: string; onClick: () => void }[] }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="Row actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-text-tertiary transition-colors hover:bg-[var(--bg-subtle)] hover:text-text-primary"
      >
        <MoreVertical size={16} />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+4px)] z-50 w-52 overflow-hidden rounded-xl border border-border-default bg-[var(--bg-surface)] py-1 shadow-[0_16px_48px_-16px_rgba(15,110,86,0.25)]"
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              onClick={() => { setOpen(false); item.onClick() }}
              className="block w-full px-3.5 py-2 text-left text-[13px] font-medium text-text-primary transition-colors hover:bg-[var(--bg-subtle)]"
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function formatJoiningDate(value?: string | null): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

type Tab = 'onboard' | 'assets'

export const Instances: React.FC = () => {
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('onboard')
  const { toast } = useToast()
  const [status, setStatus] = useState<'' | StatusKey>('')
  const [page, setPage] = useState(0)
  const canStart = usePermission('hrms.onboarding.instance.write')
  // 2026-09-10: two lookups on this page 403 for roles that can legitimately
  // reach it (DEPT_MANAGER, EMPLOYEE). Firing them anyway rendered "—" and
  // "Unknown employee" that looked like real data. Both are now gated.
  //
  //   GET /v1/onboarding/templates    -> hrms.onboarding.template.read
  //   GET /v1/hrms/employees/by-ids   -> hrms.employee.read (or an HR role)
  const canReadTemplates = usePermission('hrms.onboarding.template.read')
  const canReadEmployees = usePermission('hrms.employee.read')

  // The stat cards count every run, so the list is fetched unfiltered and
  // narrowed client-side. A server-side ?status= filter would make three of
  // the four cards report the filtered slice instead of the real totals.
  const { data: instances = [], isLoading, error, refetch } = useInstances()

  // B8 web-perf: fetch ONLY the employees that appear as instance.employeeId
  // on this page, via the by-ids batch endpoint. Previously this pulled a
  // pageSize:200 directory slice — meaning up to 200 full rows just to build
  // an id -> "First Last" lookup for the handful of instances shown.
  const instanceEmployeeIds = useMemo(
    () => instances.map((row) => row.employeeId).filter((id): id is string => !!id),
    [instances],
  )
  const { data: instanceEmployees } = useEmployeesByIds(instanceEmployeeIds, { enabled: canReadEmployees })

  const employeeById = useMemo(() => {
    const map = new Map<string, WorkforceEmployee>()
    ;(instanceEmployees ?? []).forEach((e) => map.set(e.id, e))
    return map
  }, [instanceEmployees])

  // The employee DTO carries departmentId, not a name — this resolves it for
  // the Department column.
  const { data: companies = [] } = useCompanies()
  const { data: departments = [] } = useDepartments(companies[0]?.id ?? '')
  const departmentName = useMemo(() => {
    const map = new Map<string, string>()
    departments.forEach((d) => map.set(d.id, d.name))
    return map
  }, [departments])

  // ── Card counts (always over the full, unfiltered list) ──────────────────
  const counts = useMemo(() => {
    const c = { total: instances.length, IN_PROGRESS: 0, COMPLETED: 0, ON_HOLD: 0 }
    instances.forEach((row) => {
      const key = statusKeyOf(row.status)
      if (key) c[key] += 1
    })
    return c
  }, [instances])

  const filtered = useMemo(
    () => (status ? instances.filter((row) => row.status === status) : instances),
    [instances, status],
  )

  // Clamp the page whenever the filter shrinks the list under the current
  // offset, otherwise filtering from page 3 lands on an empty table.
  const total = filtered.length
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const safePage = Math.min(page, totalPages - 1)
  useEffect(() => { setPage(0) }, [status])

  const pageRows = useMemo(
    () => filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE),
    [filtered, safePage],
  )

  // ── Hold / resume ────────────────────────────────────────────────────────
  // The only way to reach ON_HOLD: IN_PROGRESS -> COMPLETED happens on its own
  // when the last task is ticked off.
  const updateStatus = useUpdateInstanceStatus()
  const setRowStatus = async (instanceId: string, next: OnboardingInstanceStatus, done: string) => {
    try {
      await updateStatus.mutateAsync({ instanceId, status: next })
      toast(done, 'success')
    } catch (e) {
      toast((e as Error)?.message ?? 'Could not update the onboarding status', 'error')
    }
  }

  const rowName = (row: OnboardingInstance) => {
    const emp = employeeById.get(row.employeeId)
    const full = [emp?.firstName, emp?.lastName].filter(Boolean).join(' ').trim()
    return full || `Employee ${row.employeeId.slice(0, 6)}`
  }

  return (
    <div className="max-w-7xl mx-auto space-y-8 p-4 sm:p-8">
      {/* Header */}
      <HrPageHeader
        crumb="Recruitment & Onboarding"
        title="Onboarding & Assets"
        subtitle="Manage new hire onboarding, create employee records, and track assets"
      />

      <HrTabs
        tabs={[
          { key: 'onboard', label: 'New Employee Onboarding' },
          { key: 'assets', label: 'Asset Allocation' },
        ]}
        active={tab}
        onChange={(k) => setTab(k as Tab)}
      />

      <HrTabPanel tabKey="onboard">
        <div className="space-y-6">
          <div className="flex justify-end">
            {canStart && (
              <HrButton onClick={() => navigate('/hrms/onboarding/instances/new')}>
                <Plus size={15} /> Start Onboarding
              </HrButton>
            )}
          </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <HrStatCard icon={<ClipboardList size={18} />} color="blue"   value={counts.total}       label="Total"       loading={isLoading} />
        <HrStatCard icon={<UserPlus size={18} />}      color="purple" value={counts.IN_PROGRESS} label="In Progress" loading={isLoading} />
        <HrStatCard icon={<CheckCircle2 size={18} />}  color="green"  value={counts.COMPLETED}   label="Completed"   loading={isLoading} />
        <HrStatCard icon={<PauseCircle size={18} />}   color="orange" value={counts.ON_HOLD}     label="On Hold"     loading={isLoading} />
      </div>

      {/* Table card — the table chrome (toolbar, header row, footer) stays put
          whether or not there are rows. An empty list or a failed load renders
          centred INSIDE the table body rather than replacing the whole card,
          so the page never collapses to a bare message. */}
      {isLoading ? (
        <TableSkeleton />
      ) : (
        <TableCard
          actions={instances.length > 0 ? (
            <>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as '' | StatusKey)}
                className="ut-select ut-select-sm w-auto"
              >
                {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
              {status && (
                <button
                  onClick={() => setStatus('')}
                  className="h-9 whitespace-nowrap rounded-lg px-3 text-sm font-medium text-[var(--accent-fg-strong)] transition-colors hover:bg-[var(--accent-bg)]"
                >
                  Clear filter
                </button>
              )}
            </>
          ) : undefined}
          footer={total > 0 ? (
            <div className="flex items-center justify-between">
              <p className="text-xs text-text-secondary">
                Showing <span className="font-semibold text-text-primary">{safePage * PAGE_SIZE + 1}–{Math.min((safePage + 1) * PAGE_SIZE, total)}</span> of <span className="font-semibold text-text-primary">{total}</span>
              </p>
              <div className="flex items-center gap-2">
                <button onClick={() => setPage(safePage - 1)} disabled={safePage === 0}
                  className="rounded-lg border border-border-default p-1.5 text-text-secondary hover:text-text-primary disabled:opacity-40">
                  <ChevronLeft size={15} />
                </button>
                <span className="px-1 text-xs font-semibold text-text-primary">{safePage + 1} / {totalPages}</span>
                <button onClick={() => setPage(safePage + 1)} disabled={safePage >= totalPages - 1}
                  className="rounded-lg border border-border-default p-1.5 text-text-secondary hover:text-text-primary disabled:opacity-40">
                  <ChevronRight size={15} />
                </button>
              </div>
            </div>
          ) : undefined}
        >
          <table className="hr-table">
            <thead>
              <tr>
                <th className="w-14">S.No</th>
                <th>Employee Name</th>
                <th className="hidden md:table-cell">Email</th>
                <th className="hidden lg:table-cell">Department</th>
                <th className="hidden sm:table-cell">Joining Date</th>
                <th>Status</th>
                <th className="w-32">Action</th>
              </tr>
            </thead>
            <tbody>
              {error && (
                <tr>
                  <td colSpan={7} className="!p-0">
                    <EmptyState
                      variant="error"
                      title="Failed to load instances"
                      description={(error as Error).message}
                      primaryAction={{ label: 'Retry', onClick: () => refetch() }}
                    />
                  </td>
                </tr>
              )}
              {!error && pageRows.length === 0 && (
                <tr>
                  <td colSpan={7} className="!p-0">
                    {instances.length === 0 ? (
                      <EmptyState
                        variant="first-run"
                        title="No onboarding instances yet"
                        description={
                          canStart
                            ? 'Use “Start Onboarding” to create a new hire record and generate their checklist.'
                            : 'Onboarding runs started by HR will appear here.'
                        }
                        primaryAction={canStart ? { label: 'Start Onboarding', onClick: () => navigate('/hrms/onboarding/instances/new') } : undefined}
                      />
                    ) : (
                      /* Rows exist, the status filter just excludes them all —
                         a different situation from "nothing here yet", so it
                         gets its own copy and a way back. */
                      <EmptyState
                        variant="filtered"
                        title="No onboarding runs with this status"
                        description="Nothing matches the status filter. Clear it to see every onboarding run."
                        primaryAction={{ label: 'Clear filter', onClick: () => setStatus('') }}
                      />
                    )}
                  </td>
                </tr>
              )}
              {!error && pageRows.map((row, i) => {
                const serial = safePage * PAGE_SIZE + i + 1
                const emp = employeeById.get(row.employeeId)
                const dept = emp?.departmentId ? departmentName.get(emp.departmentId) : undefined
                // The instance itself has no joining date — it is the hire's
                // dateOfJoining, with startedAt as the fallback for runs begun
                // before the employee record carried one.
                const joining = emp?.dateOfJoining ?? row.startedAt
                const key = statusKeyOf(row.status)
                const open = () => navigate(`/hrms/onboarding/instances/${row.id}`)
                return (
                  <tr key={row.id} onClick={open} className="cursor-pointer">
                    <td className="text-text-tertiary">{serial}</td>
                    {/* Honest empty when the lookup is gated off: a hyphen with
                        a title is clearly-absent rather than "Unknown
                        employee", which reads like real data corruption. */}
                    <td>
                      {canReadEmployees
                        ? <HrAvatar name={rowName(row)} seed={serial} />
                        : <span className="text-text-tertiary" title="Your role cannot read employee names">—</span>}
                    </td>
                    <td className="hidden md:table-cell text-text-secondary">
                      {canReadEmployees
                        ? (emp?.email || '—')
                        : <span className="text-text-tertiary" title="Your role cannot read employee emails">—</span>}
                    </td>
                    <td className="hidden lg:table-cell text-text-secondary">{dept || '—'}</td>
                    <td className="hidden sm:table-cell text-text-secondary">{formatJoiningDate(joining)}</td>
                    <td>
                      <HrStatusPill tone={key ? STATUS_TONE[key] : 'gray'}>
                        {key ? STATUS_LABEL[key] : row.status}
                      </HrStatusPill>
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-1">
                        <HrButton variant="ghost" size="sm" onClick={open}>View</HrButton>
                        <RowMenu
                          items={[
                            { label: 'View onboarding', onClick: open },
                            // Hold/resume needs instance.write — the same
                            // permission that gates Start Onboarding.
                            ...(canStart && key === 'IN_PROGRESS'
                              ? [{ label: 'Put on hold', onClick: () => setRowStatus(row.id, 'ON_HOLD', 'Onboarding put on hold') }]
                              : []),
                            ...(canStart && key === 'ON_HOLD'
                              ? [{ label: 'Resume onboarding', onClick: () => setRowStatus(row.id, 'IN_PROGRESS', 'Onboarding resumed') }]
                              : []),
                            ...(canStart && key === 'COMPLETED'
                              ? [{ label: 'Reopen onboarding', onClick: () => setRowStatus(row.id, 'IN_PROGRESS', 'Onboarding reopened') }]
                              : []),
                            ...(canReadEmployees && emp
                              ? [{ label: 'Open employee profile', onClick: () => navigate(`/hrms/employees/${emp.id}`) }]
                              : []),
                            ...(canReadTemplates
                              ? [{ label: 'Open template', onClick: () => navigate(`/hrms/onboarding/templates/${row.templateId}`) }]
                              : []),
                          ]}
                        />
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </TableCard>
      )}
        </div>
      </HrTabPanel>

      <HrTabPanel tabKey="assets">
        <AssetsTabStatic />
      </HrTabPanel>
    </div>
  )
}

// ── Assets (Static) ─────────────────────────────────────────────────────────

function AssetsTabStatic() {
  return (
    <div className="space-y-4">
      <div className="ut-card">
        <div className="flex items-center justify-between border-b border-border-default bg-bg-base p-4 rounded-t-xl">
          <div className="flex w-[300px] items-center gap-2 rounded-lg border border-border-default bg-white px-3 py-1.5">
            <span className="text-text-tertiary">🔍</span>
            <input type="text" placeholder="Search..." className="flex-1 bg-transparent text-sm outline-none" />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="hr-table">
            <thead className="bg-bg-subtle">
              <tr>
                <th>Asset ID</th>
                <th>Category</th>
                <th>Assigned To</th>
                <th>Allocation Date</th>
                <th>Condition</th>
                <th className="text-center w-16">Action</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="text-text-secondary">IT-LT-4029</td>
                <td className="text-text-secondary">Laptop (MacBook Pro)</td>
                <td className="font-semibold text-text-primary">John Smith</td>
                <td className="text-text-secondary">Jan 15, 2025</td>
                <td><HrStatusPill tone="green">Good</HrStatusPill></td>
                <td className="text-center"><button className="text-text-tertiary hover:text-text-primary">✎</button></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
