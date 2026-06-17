import React, { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Users } from 'lucide-react'
import {
  DataTable, Badge, TableSkeleton, EmptyState,
} from '@unifiedtree/ui-kit'
import type { Column } from '@unifiedtree/ui-kit'
import { useInstances, useTemplates } from './api/useOnboarding'
import type { OnboardingInstance } from './api/useOnboarding'
import { useEmployeeDirectory } from '../api/useWorkforce'

const STATUS_FILTERS = [
  { value: '', label: 'All' },
  { value: 'IN_PROGRESS', label: 'In progress' },
  { value: 'COMPLETED', label: 'Completed' },
] as const

function progressOf(instance: OnboardingInstance): { done: number; total: number; pct: number } {
  const tasks = instance.instanceTasks ?? []
  const total = tasks.length
  const done = tasks.filter((t) => t.status === 'COMPLETED' || t.status === 'SKIPPED').length
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  return { done, total, pct }
}

export const Instances: React.FC = () => {
  const navigate = useNavigate()
  const [status, setStatus] = useState('')

  const { data: instances = [], isLoading, error, refetch } = useInstances(status || undefined)
  const { data: templates = [] } = useTemplates()
  // Page size is generous so the name lookup covers the instances on this list.
  const { data: directory } = useEmployeeDirectory({ pageSize: 200 })

  const templateName = useMemo(() => {
    const map = new Map<string, string>()
    templates.forEach((t) => map.set(t.id, t.name))
    return map
  }, [templates])

  const employeeName = useMemo(() => {
    const map = new Map<string, string>()
    ;(directory?.content ?? []).forEach((e) =>
      map.set(e.id, [e.firstName, e.lastName].filter(Boolean).join(' ').trim()),
    )
    return map
  }, [directory])

  const columns: Column<OnboardingInstance>[] = [
    {
      key: 'employee',
      header: 'Employee',
      cell: (row) => (
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-accent-subtle">
            <Users size={13} className="text-accent-default" />
          </div>
          <p className="text-sm font-medium text-text-primary">
            {employeeName.get(row.employeeId) || 'Unknown employee'}
          </p>
        </div>
      ),
    },
    {
      key: 'template',
      header: 'Template',
      cell: (row) => (
        <span className="text-sm text-text-secondary">
          {templateName.get(row.templateId) || '—'}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (row) => (
        <Badge tone={row.status === 'COMPLETED' ? 'success' : 'info'}>{row.status}</Badge>
      ),
    },
    {
      key: 'progress',
      header: 'Progress',
      cell: (row) => {
        const { done, total, pct } = progressOf(row)
        return (
          <div className="flex items-center gap-2 min-w-[140px]">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-bg-base">
              <div
                className="h-full rounded-full bg-accent-default transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="text-xs text-text-tertiary whitespace-nowrap">{done}/{total}</span>
          </div>
        )
      },
    },
    {
      key: 'startedAt',
      header: 'Started',
      cell: (row) => (
        <span className="text-sm text-text-secondary">
          {row.startedAt ? new Date(row.startedAt).toLocaleDateString() : '—'}
        </span>
      ),
    },
  ]

  return (
    <div className="p-6 animate-fade-in">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-text-primary">Onboarding Instances</h1>
          <p className="mt-0.5 text-sm text-text-secondary">
            Track active and completed employee onboarding runs
          </p>
        </div>
        <div className="flex gap-1 rounded-lg border border-border-default bg-bg-surface p-0.5">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setStatus(f.value)}
              className={
                status === f.value
                  ? 'rounded-md bg-accent-subtle px-3 py-1 text-xs font-medium text-accent-default'
                  : 'rounded-md px-3 py-1 text-xs font-medium text-text-secondary hover:text-text-primary transition-colors'
              }
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <TableSkeleton />
      ) : error ? (
        <EmptyState
          variant="error"
          title="Failed to load instances"
          description={(error as Error).message}
          primaryAction={{ label: 'Retry', onClick: () => refetch() }}
        />
      ) : (
        <DataTable
          data={instances}
          columns={columns}
          getRowKey={(row) => row.id}
          onRowClick={(row) => navigate(`/hrms/onboarding/instances/${row.employeeId}`)}
          emptyTitle="No onboarding instances yet"
          emptyDescription="Instances are created when a new hire is assigned an onboarding template."
          emptyVariant="first-run"
        />
      )}
    </div>
  )
}
