import React, { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { TableSkeleton, EmptyState } from '@unifiedtree/ui-kit'
import { HrPageHeader, HrStatusPill, TableCard, HrAvatar } from '@/shared/components/hr'
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

  return (
    <div className="mx-auto max-w-5xl p-6 sm:p-8">
      <HrPageHeader
        crumb="Recruitment & Onboarding"
        title="Onboarding Instances"
        subtitle="Track active and completed employee onboarding runs"
        actions={
          <div className="flex gap-1 rounded-lg border border-border-default bg-white p-0.5">
            {STATUS_FILTERS.map((f) => (
              <button
                key={f.value}
                onClick={() => setStatus(f.value)}
                className={
                  status === f.value
                    ? 'rounded-md bg-[#FFF4E1] px-3 py-1 text-xs font-semibold text-[#C16E00]'
                    : 'rounded-md px-3 py-1 text-xs font-medium text-text-secondary transition-colors hover:text-text-primary'
                }
              >
                {f.label}
              </button>
            ))}
          </div>
        }
      />

      {isLoading ? (
        <TableSkeleton />
      ) : error ? (
        <EmptyState
          variant="error"
          title="Failed to load instances"
          description={(error as Error).message}
          primaryAction={{ label: 'Retry', onClick: () => refetch() }}
        />
      ) : instances.length === 0 ? (
        <EmptyState
          variant="first-run"
          title="No onboarding instances yet"
          description="Instances are created when a new hire is assigned an onboarding template."
        />
      ) : (
        <TableCard>
          <table className="hr-table">
            <thead>
              <tr>
                <th>Employee</th>
                <th className="hidden sm:table-cell">Template</th>
                <th>Status</th>
                <th>Progress</th>
                <th className="hidden md:table-cell">Started</th>
              </tr>
            </thead>
            <tbody>
              {instances.map((row, i) => {
                const { done, total, pct } = progressOf(row)
                return (
                  <tr key={row.id} onClick={() => navigate(`/hrms/onboarding/instances/${row.employeeId}`)} className="cursor-pointer">
                    <td><HrAvatar name={employeeName.get(row.employeeId) || 'Unknown employee'} seed={i} /></td>
                    <td className="hidden sm:table-cell text-text-secondary">{templateName.get(row.templateId) || '—'}</td>
                    <td><HrStatusPill tone={row.status === 'COMPLETED' ? 'ok' : 'info'}>{row.status}</HrStatusPill></td>
                    <td>
                      <div className="flex min-w-[140px] items-center gap-2">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-bg-base">
                          <div className="h-full rounded-full bg-[#FF9D00] transition-all" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="whitespace-nowrap text-xs text-text-tertiary">{done}/{total}</span>
                      </div>
                    </td>
                    <td className="hidden md:table-cell text-text-secondary">{row.startedAt ? new Date(row.startedAt).toLocaleDateString() : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </TableCard>
      )}
    </div>
  )
}
