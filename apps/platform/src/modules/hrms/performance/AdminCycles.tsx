import { useState } from 'react'
import { P, usePermission } from '@unifiedtree/sdk'
import { Plus, CalendarRange } from 'lucide-react'
import { HrButton, HrDrawer, HrStatusPill, TableCard, HrAvatar } from '@/shared/components/hr'
import { DateField } from '@/shared/components/calendar'
import { DataTable } from '@/shared/components/DataTable'
import { useToast } from '@/shared/hooks/useToast'
import { useCompanies } from '../api/useOrg'
import { useEmployeesByIds } from '../api/useWorkforce'
import { HrPagination } from '@/shared/components/HrPagination'
import { useCreateCycle, useReviewCycles, type ReviewCycle } from '../api/usePerformance'
import { useCycleProgress, useInitiateReviews, useCloseCycle, type InitiationResult } from '../api/usePerformanceAdmin'
import { PerformanceError, PerformanceEmployeePicker } from './PerformanceEmployeePicker'
import { SubHeading, Note, dmy } from '@/design/module/ModuleKit'

const words = (v: string) => v.replace(/_/g, ' ').toLowerCase().replace(/^\w/, c => c.toUpperCase())
const period = (a?: string, b?: string) => `${a ? dmy(a) : 'Not set'} – ${b ? dmy(b) : 'Not set'}`

export function AdminCycles() {
  const canWrite = usePermission('hrms.performance.write')
  const canInitiate = usePermission('hrms.appraisal.initiate')
  const cycles = useReviewCycles()
  const [creating, setCreating] = useState(false)
  const [selected, setSelected] = useState<ReviewCycle | null>(null)
  return <div style={{ display: 'grid', gap: 16 }}>
    <SubHeading aside={canWrite ? <HrButton size="sm" onClick={() => setCreating(true)}><Plus size={14} /> Create cycle</HrButton> : undefined}>Review cycles</SubHeading>
    {!canWrite && !canInitiate && <Note>Each cycle’s progress shows your team only: everyone in the departments you head, or your direct reports.</Note>}
    {cycles.isError ? <PerformanceError error={cycles.error} retry={() => cycles.refetch()} /> : <TableCard><DataTable<ReviewCycle> data={cycles.data ?? []} keyField="id" loading={cycles.isLoading} emptyMessage="No review cycles yet. Create a cycle to begin." columns={[
      { key: 'name', header: 'Cycle', render: cycle => <button className="inline-flex items-center gap-2 text-left font-semibold text-[#0F6E56] hover:underline" onClick={() => setSelected(cycle)}><CalendarRange size={16} /> {cycle.name}</button> },
      { key: 'period', header: 'Review period', render: cycle => <span className="whitespace-nowrap">{period(cycle.periodStart, cycle.periodEnd)}</span> },
      { key: 'status', header: 'Status', render: cycle => <HrStatusPill tone={cycle.status === 'ACTIVE' ? 'ok' : cycle.status === 'CLOSED' ? 'info' : 'gray'}>{words(cycle.status)}</HrStatusPill> },
      { key: 'action', header: 'Manage', render: cycle => <HrButton size="sm" variant="ghost" onClick={() => setSelected(cycle)}>{cycle.status === 'DRAFT' && canInitiate ? 'Assign reviews' : 'View progress'}</HrButton> },
    ]} /></TableCard>}
    {creating && <CreateCycleDrawer onClose={() => setCreating(false)} />}
    {selected && <CycleDrawer cycle={selected} canInitiate={canInitiate} onClose={() => setSelected(null)} />}
  </div>
}

function CreateCycleDrawer({ onClose }: { onClose: () => void }) {
  const companies = useCompanies()
  const create = useCreateCycle()
  const { toast } = useToast()
  const [companyId, setCompanyId] = useState('')
  const [name, setName] = useState('')
  const [periodStart, setStart] = useState('')
  const [periodEnd, setEnd] = useState('')
  const [error, setError] = useState('')
  const selectedCompany = companyId || (companies.data?.length === 1 ? companies.data[0].id : '')
  const submit = async () => {
    if (!selectedCompany || !name.trim() || !periodStart || !periodEnd) { setError('Choose a company, name the cycle, and set both period dates.'); return }
    if (periodEnd < periodStart) { setError('The period end must be on or after the start.'); return }
    setError('')
    try { await create.mutateAsync({ companyId: selectedCompany, name: name.trim(), periodStart, periodEnd }); toast('Review cycle created. Assign reviews to begin.', 'success'); onClose() } catch { /* Inline error. */ }
  }
  return <HrDrawer title="Create review cycle" onClose={() => { if (!create.isPending) onClose() }} footer={<><HrButton variant="ghost" disabled={create.isPending} onClick={onClose}>Cancel</HrButton><HrButton disabled={create.isPending || companies.isLoading || companies.isError} onClick={submit}>{create.isPending ? 'Creating...' : 'Create cycle'}</HrButton></>}>
    <div className="space-y-5"><p className="text-sm text-text-secondary">The cycle starts as a draft. Choose employees and assign their reviewers after creating it.</p>
      {companies.isError ? <PerformanceError error={companies.error} retry={() => companies.refetch()} /> : <label className="block text-sm font-medium">Company<select className="ut-select mt-1" value={selectedCompany} onChange={e => setCompanyId(e.target.value)}><option value="">{companies.isLoading ? 'Loading companies...' : 'Choose company'}</option>{companies.data?.map(company => <option key={company.id} value={company.id}>{company.name}</option>)}</select></label>}
      <label className="block text-sm font-medium">Cycle name<input maxLength={200} className="ut-input mt-1" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. September 2026 performance review" /></label>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2"><label className="text-sm font-medium">Period start<DateField className="ut-input mt-1" value={periodStart} onChange={e => setStart(e.target.value)} /></label><label className="text-sm font-medium">Period end<DateField min={periodStart || undefined} className="ut-input mt-1" value={periodEnd} onChange={e => setEnd(e.target.value)} /></label></div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}{create.isError && <PerformanceError error={create.error} />}
    </div>
  </HrDrawer>
}

function CycleDrawer({ cycle, canInitiate, onClose }: { cycle: ReviewCycle; canInitiate: boolean; onClose: () => void }) {
  const progress = useCycleProgress(cycle.id)
  const initiate = useInitiateReviews()
  const close = useCloseCycle()
  const { toast } = useToast()
  const [reviewerTypes, setReviewerTypes] = useState<string[]>(['SELF'])
  const [peerCount, setPeerCount] = useState(3)
  const [scope, setScope] = useState<'selected' | 'all'>('selected')
  const [employees, setEmployees] = useState<{ id: string; name: string }[]>([])
  const [result, setResult] = useState<InitiationResult | null>(null)
  const [confirmClose, setConfirmClose] = useState(false)
  const [error, setError] = useState('')
  const busy = initiate.isPending || close.isPending
  const status = progress.data?.status || cycle.status
  const assign = async () => {
    if (scope === 'selected' && employees.length === 0) { setError('Choose at least one employee.'); return }
    if (!reviewerTypes.length) { setError('Choose at least one reviewer type.'); return }
    setError('')
    try { const created = await initiate.mutateAsync({ id: cycle.id, employeeIds: scope === 'selected' ? employees.map(employee => employee.id) : undefined, reviewerTypes, peerCount }); setResult(created); toast(`${created.reviewsCreated} reviews assigned`, 'success'); setEmployees([]) } catch { /* Inline error. */ }
  }
  return <HrDrawer title={cycle.name} width="max-w-2xl" onClose={() => { if (!busy) onClose() }}>
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3"><div><p className="text-sm text-text-secondary">{period(cycle.periodStart, cycle.periodEnd)}</p><p className="mt-1 text-xs text-text-secondary">Appraisal review cycle</p></div><HrStatusPill tone={status === 'ACTIVE' ? 'ok' : status === 'CLOSED' ? 'info' : 'gray'}>{words(status)}</HrStatusPill></div>
      {progress.isLoading ? <p role="status">Loading cycle progress...</p> : progress.isError ? <PerformanceError error={progress.error} retry={() => progress.refetch()} /> : progress.data && <>
        <div className="grid grid-cols-3 gap-2 rounded-lg bg-[#E6F4F1] p-4"><div><p className="text-xs text-text-secondary">Assigned</p><strong className="mt-1 block text-2xl text-[#0A5240]">{progress.data.totalAssignments}</strong></div><div><p className="text-xs text-text-secondary">Completed</p><strong className="mt-1 block text-2xl text-[#0A5240]">{progress.data.completedAssignments}</strong></div><div><p className="text-xs text-text-secondary">Completion</p><strong className="mt-1 block text-2xl text-[#0A5240]">{progress.data.overallPct}%</strong></div></div>
        <section><h4 className="mb-3 font-semibold">Assigned employees</h4>{!progress.data.reviewees.length ? <p className="text-sm text-text-secondary">No employee reviews assigned to this cycle yet.</p> : <div className="space-y-3">{progress.data.reviewees.map(employee => <div className="rounded-lg border border-border-default p-3" key={employee.revieweeId}><div className="flex items-center justify-between gap-2"><HrAvatar name={employee.revieweeName || 'Employee'} sub={employee.revieweeCode || undefined} /><span className="whitespace-nowrap text-sm font-semibold">{employee.completedAssignments} / {employee.totalAssignments}</span></div><ul className="mt-3 space-y-1 border-t border-border-default pt-2 text-xs text-text-secondary">{employee.assignments.map(assignment => <li key={`${assignment.reviewerId}-${assignment.reviewerType}`} className="flex justify-between gap-2"><span>{assignment.reviewerName || 'Reviewer'} · {words(assignment.reviewerType)}</span><span>{words(assignment.status)}</span></li>)}</ul></div>)}</div>}</section>
      </>}
      {canInitiate && status !== 'CLOSED' && <section className="space-y-4 border-t border-border-default pt-5"><h4 className="font-semibold">Assign reviews</h4><p className="text-sm text-text-secondary">Assigned reviewers complete these under My reviews. Existing assignments are kept; only new assignments are added.</p>
        <fieldset className="space-y-2"><legend className="mb-2 text-sm font-semibold">Reviewer types</legend><div className="grid grid-cols-1 gap-2 sm:grid-cols-2">{[{ key: 'SELF', label: 'Employee self-review' }, { key: 'MANAGER', label: 'Reporting manager' }, { key: 'PEER', label: 'Department peers' }, { key: 'SKIP_LEVEL', label: "Manager's manager" }, { key: 'DIRECT_REPORT', label: 'Direct reports (upward review)' }].map(type => <label key={type.key} className="flex items-center gap-2 text-sm"><input className="accent-[#0F6E56]" type="checkbox" checked={reviewerTypes.includes(type.key)} onChange={e => setReviewerTypes(current => e.target.checked ? [...current, type.key] : current.filter(item => item !== type.key))} />{type.label}</label>)}</div>{reviewerTypes.includes('PEER') && <label className="block text-sm">Peers per employee<select className="ut-select mt-1 max-w-32" value={peerCount} onChange={e => setPeerCount(Number(e.target.value))}>{[1,2,3,4,5,6,7,8,9,10].map(count => <option key={count} value={count}>{count}</option>)}</select></label>}<p className="text-xs text-text-secondary">Employees without eligible reviewers for a selected type are skipped. Peers are selected from the same department.</p></fieldset>
        <fieldset className="flex flex-wrap gap-4 text-sm"><legend className="sr-only">Employees to include</legend><label className="flex items-center gap-2"><input className="accent-[#0F6E56]" type="radio" name="review-scope" checked={scope === 'selected'} onChange={() => setScope('selected')} /> Choose employees</label><label className="flex items-center gap-2"><input className="accent-[#0F6E56]" type="radio" name="review-scope" checked={scope === 'all'} onChange={() => setScope('all')} /> All active employees in this company</label></fieldset>
        {scope === 'selected' && <><PerformanceEmployeePicker companyId={cycle.companyId} value="" onChange={employee => setEmployees(current => current.some(item => item.id === employee.id) ? current : [...current, { id: employee.id, name: `${employee.firstName} ${employee.lastName || ''}`.trim() }])} />{employees.length > 0 && <div className="flex flex-wrap gap-2">{employees.map(employee => <button key={employee.id} className="rounded-full bg-[#E6F4F1] px-3 py-1 text-sm text-[#0A5240]" aria-label={`Remove ${employee.name}`} onClick={() => setEmployees(current => current.filter(item => item.id !== employee.id))}>{employee.name} &times;</button>)}</div>}</>}
        {scope === 'all' && <p className="rounded-lg bg-[#E6F4F1] p-3 text-sm">This will assign the selected reviewer types for every active employee in the cycle's company and activate a draft cycle.</p>}
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}{initiate.isError && <PerformanceError error={initiate.error} />}
        <HrButton disabled={busy || progress.isError} onClick={assign}>{initiate.isPending ? 'Assigning...' : scope === 'all' ? 'Assign to all active employees' : `Assign reviews${employees.length ? ` (${employees.length})` : ''}`}</HrButton>
        {result && <div role="status" className="rounded-lg bg-[#E6F4F1] p-3 text-sm"><p>{result.revieweesConsidered} employees considered; {result.reviewsCreated} new reviews created.</p>{result.skips.length > 0 && <SkippedAssignments skips={result.skips} companyId={cycle.companyId} />}</div>}
      </section>}
      {canInitiate && status === 'ACTIVE' && <section className="border-t border-border-default pt-5">{confirmClose ? <div className="space-y-3"><h4 className="font-semibold">Close this cycle?</h4><p className="text-sm text-text-secondary">Pending reviews will be marked missed. The cycle cannot be reopened.</p><div className="flex gap-2"><HrButton disabled={busy} onClick={async () => { try { const result = await close.mutateAsync(cycle.id); toast(`Cycle closed. ${result.reviewsMissedMarked} pending reviews marked missed.`, 'success'); setConfirmClose(false) } catch { /* Inline error. */ } }}>{close.isPending ? 'Closing...' : 'Confirm close cycle'}</HrButton><HrButton disabled={busy} variant="ghost" onClick={() => setConfirmClose(false)}>Keep open</HrButton></div></div> : <HrButton variant="ghost" onClick={() => setConfirmClose(true)}>Close cycle</HrButton>}{close.isError && <PerformanceError error={close.error} />}</section>}
    </div>
  </HrDrawer>
}

function SkippedAssignments({ skips }: { skips: string[]; companyId: string }) {
  const [open, setOpen] = useState(false)
  const [page, setPage] = useState(0)
  const canRead = usePermission(P.HRMS_EMPLOYEE_READ)
  const rows = skips.map(skip => ({ id: /reviewee=([a-f0-9-]+)/i.exec(skip)?.[1], type: /type=(\w+)/.exec(skip)?.[1] }))
  const ids = [...new Set(rows.flatMap(row => row.id ? [row.id] : []))]
  const directory = useEmployeesByIds(ids.slice(page * 10, (page + 1) * 10), { enabled: open && canRead })
  return <div className="mt-3"><p>{skips.length} assignments skipped because eligible reviewers were unavailable.</p><HrButton size="sm" variant="ghost" className="mt-2" onClick={() => setOpen(!open)}>{open ? 'Hide skipped assignments' : 'View skipped assignments'}</HrButton>{open && <div className="mt-2 space-y-3">
    {!canRead ? <p className="text-xs">Employee directory permission is required to see the affected employees.</p> : directory.isError ? <PerformanceError error={directory.error} retry={() => directory.refetch()} /> : directory.isLoading ? <p role="status" className="text-xs">Loading employee details...</p> : <><ul className="space-y-2 text-xs">{directory.data?.map(employee => <li key={employee.id}><strong>{employee.firstName} {employee.lastName} ({employee.employeeCode})</strong><span className="block">No eligible reviewer: {rows.filter(row => row.id === employee.id).map(row => row.type?.toLowerCase().replaceAll('_', ' ')).join(', ')}</span></li>)}</ul><HrPagination page={page} pageSize={10} totalElements={ids.length} totalPages={Math.ceil(ids.length / 10)} onPageChange={setPage} /></>}
  </div>}</div>
}
