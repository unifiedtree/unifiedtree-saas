import React, { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { usePermission } from '@unifiedtree/sdk'
import { TableSkeleton, EmptyState } from '@unifiedtree/ui-kit'
import { HrPageHeader, HrButton, HrStatusPill, TableCard, HrAvatar } from '@/shared/components/hr'
import { useToast } from '@/shared/hooks/useToast'
import { useInstances, useTemplates, useCreateInstance } from './api/useOnboarding'
import type { OnboardingInstance } from './api/useOnboarding'
import { useEmployeesByIds, useEmployeeDirectory } from '../api/useWorkforce'
import { useCompanies } from '../api/useOrg'

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
  const { toast } = useToast()
  const [status, setStatus] = useState('')
  const canStart = usePermission('hrms.onboarding.instance.write')

  const { data: instances = [], isLoading, error, refetch } = useInstances(status || undefined)
  const { data: templates = [] } = useTemplates()

  // ── Start onboarding ────────────────────────────────────────────────────
  const [showStart, setShowStart] = useState(false)
  const [employeeId, setEmployeeId] = useState('')
  const [templateId, setTemplateId] = useState('')
  const [joiningDate, setJoiningDate] = useState('')

  const createInstance = useCreateInstance()
  const { data: companies = [] } = useCompanies()
  const pickerCompanyId = companies[0]?.id || ''
  const { data: directory } = useEmployeeDirectory(
    { companyId: pickerCompanyId, pageSize: 200 },
    { enabled: canStart && showStart && !!pickerCompanyId },
  )
  const pickableEmployees = directory?.content ?? []
  const activeTemplates = useMemo(() => templates.filter((t) => t.active), [templates])

  const resetStartForm = () => {
    setEmployeeId(''); setTemplateId(''); setJoiningDate('')
  }

  const onStartOnboarding = async () => {
    if (!employeeId) { toast('Select an employee', 'error'); return }
    if (!templateId) { toast('Select an onboarding template', 'error'); return }
    try {
      const created = await createInstance.mutateAsync({
        employeeId,
        templateId,
        joiningDate: joiningDate || undefined,
      })
      toast('Onboarding started', 'success')
      resetStartForm()
      setShowStart(false)
      if (created?.id) navigate(`/hrms/onboarding/instances/${created.id}`)
    } catch (e) {
      toast((e as Error)?.message ?? 'Failed to start onboarding', 'error')
    }
  }

  // B8 web-perf: fetch ONLY the employees that appear as instance.employeeId
  // on this page, via the by-ids batch endpoint. Previously this pulled a
  // pageSize:200 directory slice — meaning up to 200 full rows just to build
  // an id -> "First Last" lookup for the handful of instances shown.
  const instanceEmployeeIds = useMemo(
    () => instances.map((row) => row.employeeId).filter((id): id is string => !!id),
    [instances],
  )
  const { data: instanceEmployees } = useEmployeesByIds(instanceEmployeeIds)

  const templateName = useMemo(() => {
    const map = new Map<string, string>()
    templates.forEach((t) => map.set(t.id, t.name))
    return map
  }, [templates])

  const employeeName = useMemo(() => {
    const map = new Map<string, string>()
    ;(instanceEmployees ?? []).forEach((e) =>
      map.set(e.id, [e.firstName, e.lastName].filter(Boolean).join(' ').trim()),
    )
    return map
  }, [instanceEmployees])

  return (
    <div className="mx-auto max-w-5xl p-6 sm:p-8">
      <HrPageHeader
        crumb="Recruitment & Onboarding"
        title="Onboarding Instances"
        subtitle="Track active and completed employee onboarding runs"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-1 rounded-lg border border-border-default bg-white p-0.5">
              {STATUS_FILTERS.map((f) => (
                <button
                  key={f.value}
                  onClick={() => setStatus(f.value)}
                  className={
                    status === f.value
                      ? 'rounded-md bg-[#ECFDF5] px-3 py-1 text-xs font-semibold text-[#047857]'
                      : 'rounded-md px-3 py-1 text-xs font-medium text-text-secondary transition-colors hover:text-text-primary'
                  }
                >
                  {f.label}
                </button>
              ))}
            </div>
            {canStart && (
              <HrButton variant={showStart ? 'ghost' : 'primary'} onClick={() => setShowStart((s) => !s)}>
                <Plus size={15} /> {showStart ? 'Close' : 'Start Onboarding'}
              </HrButton>
            )}
          </div>
        }
      />

      {canStart && showStart && (
        <div className="ut-card mb-5 p-5">
          <h3 className="mb-4 text-[15px] font-semibold text-text-primary">Start onboarding for a new hire</h3>
          {activeTemplates.length === 0 ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              You have no active onboarding templates yet. Create one under{' '}
              <button className="font-semibold underline" onClick={() => navigate('/hrms/onboarding/templates')}>
                Onboarding Templates
              </button>{' '}
              first — the checklist a new hire receives comes from the template.
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-x-4 gap-y-5 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-[13px] font-semibold text-text-secondary">Employee *</label>
                  <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className="ut-select">
                    <option value="">Select an employee…</option>
                    {pickableEmployees.map((e) => (
                      <option key={e.id} value={e.id}>
                        {[e.firstName, e.lastName].filter(Boolean).join(' ').trim()}
                        {e.employeeCode ? ` (${e.employeeCode})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-[13px] font-semibold text-text-secondary">Template *</label>
                  <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} className="ut-select">
                    <option value="">Select a template…</option>
                    {activeTemplates.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-[13px] font-semibold text-text-secondary">Joining date</label>
                  <input
                    type="date"
                    value={joiningDate}
                    onChange={(e) => setJoiningDate(e.target.value)}
                    className="ut-input"
                  />
                  <p className="mt-1 text-xs text-text-tertiary">
                    Task due dates are offset from this date. Leave blank to use the employee's
                    recorded date of joining.
                  </p>
                </div>
              </div>
              <div className="mt-5 flex justify-end border-t border-border-default pt-4">
                <HrButton onClick={onStartOnboarding} disabled={createInstance.isPending}>
                  {createInstance.isPending ? 'Starting…' : 'Start Onboarding'}
                </HrButton>
              </div>
            </>
          )}
        </div>
      )}

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
          description={
            canStart
              ? 'Use “Start Onboarding” to assign a template to a new hire and generate their checklist.'
              : 'Onboarding runs started by HR will appear here.'
          }
          primaryAction={canStart ? { label: 'Start Onboarding', onClick: () => setShowStart(true) } : undefined}
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
                  <tr key={row.id} onClick={() => navigate(`/hrms/onboarding/instances/${row.id}`)} className="cursor-pointer">
                    <td><HrAvatar name={employeeName.get(row.employeeId) || 'Unknown employee'} seed={i} /></td>
                    <td className="hidden sm:table-cell text-text-secondary">{templateName.get(row.templateId) || '—'}</td>
                    <td><HrStatusPill tone={row.status === 'COMPLETED' ? 'ok' : 'info'}>{row.status}</HrStatusPill></td>
                    <td>
                      <div className="flex min-w-[140px] items-center gap-2">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-bg-base">
                          <div className="h-full rounded-full bg-[#059669] transition-all" style={{ width: `${pct}%` }} />
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
