import { useState } from 'react'
import { usePermission } from '@unifiedtree/sdk'
import { Plus, Target } from 'lucide-react'
import { HrAvatar, HrButton, HrDrawer, HrStatusPill, TableCard, type PillTone } from '@/shared/components/hr'
import { HrPagination, useClampedPage } from '@/shared/components/HrPagination'
import { DataTable } from '@/shared/components/DataTable'
import { useToast } from '@/shared/hooks/useToast'
import type { EmployeeKpiRow } from '../api/usePerformance'
import { useAdminKpis, useSaveKpi, useDropKpi, useRecordKpiProgress, useKpiHistory, type KpiDirection, type KpiStatus } from '../api/usePerformanceAdmin'
import { PerformanceEmployeePicker, PerformanceError } from './PerformanceEmployeePicker'
import { SubHeading, Note, stamp } from '@/design/module/ModuleKit'

const STATUS_TONE: Record<string, PillTone> = { ACTIVE: 'info', AT_RISK: 'warn', COMPLETED: 'ok', DROPPED: 'gray' }
const statusLabel = (value?: string) => (value || 'ACTIVE').replaceAll('_', ' ').toLowerCase().replace(/^\w/, c => c.toUpperCase())
const dateLabel = (value?: string) => value ? new Date(value.length === 10 ? `${value}T12:00:00` : value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'No due date'

export function AdminKpis() {
  const manage = usePermission('hrms.kpi.manage')
  const write = usePermission('hrms.performance.write')
  // Department managers record progress for their own team's KPIs (hrms.kpi.progress, V143.9); the API enforces the team.
  const teamProgress = usePermission('hrms.kpi.progress')
  const canRecord = write || teamProgress
  const teamOnly = !write && !manage
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(0)
  const [size, setSize] = useState(25)
  const [editing, setEditing] = useState<EmployeeKpiRow | 'new' | null>(null)
  const [selected, setSelected] = useState<EmployeeKpiRow | null>(null)
  const query = useAdminKpis({ search, status, page, size })
  const totalPages = Math.ceil((query.data?.total ?? 0) / size)
  useClampedPage(page, totalPages, setPage)
  return <div style={{ display: 'grid', gap: 16 }}>
    <SubHeading aside={manage ? <HrButton size="sm" onClick={() => setEditing('new')}><Plus size={14} /> Create KPI</HrButton> : undefined}>{teamOnly ? 'Your team’s goals & KPIs' : 'Company goals & KPIs'}</SubHeading>
    {teamOnly && <Note>You see your team: everyone in the departments you head, or your direct reports if you don’t head one. Your own reviews and goals are under My reviews and My goals.</Note>}
    <div className="flex flex-wrap gap-3">
      <label className="min-w-[180px] flex-1 text-xs font-medium text-text-secondary">Search KPI titles<input className="ut-input mt-1" type="search" value={search} onChange={e => { setSearch(e.target.value); setPage(0) }} placeholder="Search company goals" /></label>
      <label className="text-xs font-medium text-text-secondary">Status<select aria-label="Status" className="ut-select mt-1" value={status} onChange={e => { setStatus(e.target.value); setPage(0) }}><option value="">All statuses</option><option value="ACTIVE">Active</option><option value="AT_RISK">At risk</option><option value="COMPLETED">Completed</option><option value="DROPPED">Dropped</option></select></label>
    </div>
    {query.isError ? <PerformanceError error={query.error} retry={() => query.refetch()} /> : <TableCard footer={<HrPagination page={page} pageSize={size} totalElements={query.data?.total ?? 0} totalPages={totalPages} onPageChange={setPage} onPageSizeChange={setSize} />}>
      <DataTable<EmployeeKpiRow> data={query.data?.items ?? []} keyField="id" loading={query.isLoading} emptyMessage={search || status ? 'No KPIs match these filters.' : 'No company KPIs yet. Create a target to start tracking progress.'} columns={[
        { key: 'title', header: 'Goal / KPI', render: row => <button className="max-w-xs text-left font-semibold text-[#0F6E56] hover:underline" onClick={() => setSelected(row)}>{row.title}<span className="mt-1 block text-xs font-normal text-text-secondary">{row.category || 'General'} · {dateLabel(row.dueDate)}</span></button> },
        { key: 'owner', header: 'Owner', render: row => <HrAvatar name={row.ownerName || 'Employee'} sub={row.ownerCode || undefined} /> },
        { key: 'target', header: 'Current / target', render: row => <span className="whitespace-nowrap tabular-nums">{row.currentValue ?? 0} / {row.targetValue ?? 'Not set'} {row.unit}</span> },
        { key: 'progress', header: 'Progress', render: row => <div className="min-w-[110px]"><span className="text-sm font-semibold">{row.progressPct ?? 0}%</span><div className="mt-1 h-1.5 rounded bg-[#E6F4F1]"><div className="h-full rounded bg-[#0F6E56]" style={{ width: `${Math.max(0, Math.min(100, row.progressPct ?? 0))}%` }} /></div></div> },
        { key: 'status', header: 'Status', render: row => <HrStatusPill tone={STATUS_TONE[row.status ?? 'ACTIVE'] || 'gray'}>{statusLabel(row.status)}</HrStatusPill> },
        { key: 'actions', header: 'Actions', render: row => <div className="flex gap-1"><HrButton size="sm" variant="ghost" onClick={() => setSelected(row)}>{canRecord && row.status !== 'DROPPED' ? 'Update progress' : 'View history'}</HrButton>{manage && <HrButton size="sm" variant="ghost" onClick={() => setEditing(row)}>Edit</HrButton>}</div> },
      ]} />
    </TableCard>}
    {editing && <KpiForm existing={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    {selected && <KpiDetails initial={selected} canWrite={canRecord} canManage={manage} onClose={() => setSelected(null)} />}
  </div>
}

function KpiForm({ existing, onClose }: { existing?: EmployeeKpiRow; onClose: () => void }) {
  const save = useSaveKpi()
  const { toast } = useToast()
  const [ownerId, setOwnerId] = useState(existing?.ownerId || '')
  const [ownerName, setOwnerName] = useState(existing?.ownerName || '')
  const [title, setTitle] = useState(existing?.title || '')
  const [description, setDescription] = useState(existing?.description || '')
  const [target, setTarget] = useState(String(existing?.targetValue ?? ''))
  const [current, setCurrent] = useState(String(existing?.currentValue ?? 0))
  const [unit, setUnit] = useState(existing?.unit || '')
  const [direction, setDirection] = useState<KpiDirection>((existing?.direction as KpiDirection) || 'HIGHER_IS_BETTER')
  const [weight, setWeight] = useState(String(existing?.weight ?? 1))
  const [category, setCategory] = useState(existing?.category || '')
  const [dueDate, setDueDate] = useState(existing?.dueDate || '')
  const [status, setStatus] = useState<KpiStatus>((existing?.status as KpiStatus) || 'ACTIVE')
  const [validation, setValidation] = useState('')
  const submit = async () => {
    if (!ownerId || !title.trim()) { setValidation('Choose an owner and enter a KPI title.'); return }
    if (!target.trim() || !Number.isFinite(Number(target)) || Number(target) <= 0) { setValidation('Enter a target greater than zero.'); return }
    if (!Number.isFinite(Number(current)) || Number(current) < 0 || !weight.trim() || !Number.isInteger(Number(weight)) || Number(weight) < 0 || Number(weight) > 100) { setValidation('Use a non-negative current value and a whole-number weight between 0 and 100.'); return }
    setValidation('')
    try {
      await save.mutateAsync({ id: existing?.id, payload: { ownerId, title: title.trim(), description: description.trim(), category: category.trim(), targetValue: Number(target), currentValue: Number(current), unit: unit.trim(), direction, weight: Number(weight), dueDate: dueDate || (existing ? '' : undefined), status: existing ? status : undefined } })
      toast(existing ? 'KPI updated' : 'KPI created', 'success'); onClose()
    } catch { /* Inline error keeps the entered form available. */ }
  }
  return <HrDrawer title={existing ? 'Edit KPI' : 'Create company KPI'} onClose={() => { if (!save.isPending) onClose() }} width="max-w-xl" footer={<><HrButton variant="ghost" disabled={save.isPending} onClick={onClose}>Cancel</HrButton><HrButton disabled={save.isPending} onClick={submit}>{save.isPending ? 'Saving...' : 'Save KPI'}</HrButton></>}>
    <div className="space-y-5">
      <PerformanceEmployeePicker value={ownerId} selectedLabel={ownerName} onChange={employee => { setOwnerId(employee.id); setOwnerName(`${employee.firstName} ${employee.lastName || ''}`.trim()) }} />
      <label className="block text-sm font-medium">KPI title<input maxLength={300} className="ut-input mt-1" value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Resolve customer requests within SLA" /></label>
      <label className="block text-sm font-medium">Description<textarea className="ut-input mt-1" rows={3} value={description} onChange={e => setDescription(e.target.value)} /></label>
      <div className="grid grid-cols-2 gap-4">
        <label className="text-sm font-medium">Target value<input className="ut-input mt-1" type="number" min="0.01" step="any" value={target} onChange={e => setTarget(e.target.value)} /></label>
        {!existing && <label className="text-sm font-medium">Starting value<input className="ut-input mt-1" type="number" min={0} step="any" value={current} onChange={e => setCurrent(e.target.value)} /></label>}
        <label className="text-sm font-medium">Unit<input className="ut-input mt-1" maxLength={24} value={unit} placeholder="%, tasks, hours" onChange={e => setUnit(e.target.value)} /></label>
        <label className="text-sm font-medium">Weight<input className="ut-input mt-1" type="number" min={0} max={100} step={1} value={weight} onChange={e => setWeight(e.target.value)} /></label>
        <label className="text-sm font-medium">Category<input className="ut-input mt-1" maxLength={40} value={category} onChange={e => setCategory(e.target.value)} /></label>
        <label className="text-sm font-medium">Due date<input className="ut-input mt-1" type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} /></label>
      </div>
      <label className="block text-sm font-medium">Success measure<select className="ut-select mt-1" value={direction} onChange={e => setDirection(e.target.value as KpiDirection)}><option value="HIGHER_IS_BETTER">Higher is better</option><option value="LOWER_IS_BETTER">Lower is better</option><option value="TARGET_EXACT">Match the target</option></select></label>
      {existing && <label className="block text-sm font-medium">Status<select aria-label="Status" className="ut-select mt-1" value={status} onChange={e => setStatus(e.target.value as KpiStatus)}><option value="ACTIVE">Active</option><option value="AT_RISK">At risk</option><option value="COMPLETED">Completed</option><option value="DROPPED">Dropped</option></select></label>}
      {validation && <p role="alert" className="text-sm text-red-700">{validation}</p>}
      {save.isError && <PerformanceError error={save.error} />}
    </div>
  </HrDrawer>
}

/** KPI progress & history drawer (also opened from a person's performance page). */
export function KpiDetails({ initial, canWrite, canManage, onClose }: { initial: EmployeeKpiRow; canWrite: boolean; canManage: boolean; onClose: () => void }) {
  const [kpi, setKpi] = useState(initial)
  const history = useKpiHistory(kpi.id)
  const update = useRecordKpiProgress()
  const drop = useDropKpi()
  const { toast } = useToast()
  const [value, setValue] = useState(String(kpi.currentValue ?? 0))
  const [notes, setNotes] = useState('')
  const [confirmDrop, setConfirmDrop] = useState(false)
  const [validation, setValidation] = useState('')
  const busy = update.isPending || drop.isPending
  const record = async () => {
    if (!value.trim() || !Number.isFinite(Number(value)) || Number(value) < 0) { setValidation('Enter a non-negative current value.'); return }
    setValidation('')
    try { const changed = await update.mutateAsync({ id: kpi.id, newValue: Number(value), notes: notes.trim() || undefined }); setKpi(changed); setNotes(''); toast('Progress recorded', 'success') } catch { /* Inline error. */ }
  }
  return <HrDrawer title="KPI progress & history" width="max-w-xl" onClose={() => { if (!busy) onClose() }}>
    <div className="space-y-6">
      <div><p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#0F6E56]"><Target size={14} className="mr-1 inline" /> {kpi.category || 'Company goal'}</p><h3 className="text-xl font-semibold">{kpi.title}</h3><p className="mt-2 text-sm text-text-secondary">{[kpi.ownerName || 'Owner', kpi.ownerCode, dateLabel(kpi.dueDate)].filter(Boolean).join(' · ')}</p>{kpi.description && <p className="mt-3 text-sm">{kpi.description}</p>}</div>
      <div className="flex items-center justify-between rounded-lg bg-[#E6F4F1] p-4"><div><p className="text-xs text-text-secondary">Current / target</p><p className="mt-1 text-xl font-semibold text-[#0A5240]">{kpi.currentValue ?? 0} / {kpi.targetValue ?? 'Not set'} {kpi.unit}</p></div><div className="text-right"><p className="text-xl font-semibold text-[#0A5240]">{kpi.progressPct ?? 0}%</p><HrStatusPill tone={STATUS_TONE[kpi.status || 'ACTIVE'] || 'gray'}>{statusLabel(kpi.status)}</HrStatusPill></div></div>
      {canWrite && kpi.status !== 'DROPPED' && <div className="space-y-3 rounded-lg border border-border-default p-4"><h4 className="font-semibold">Record progress</h4><label className="block text-sm">New current value<input className="ut-input mt-1" type="number" min={0} step="any" value={value} onChange={e => setValue(e.target.value)} /></label><label className="block text-sm">Progress note<textarea rows={2} className="ut-input mt-1" value={notes} onChange={e => setNotes(e.target.value)} placeholder="What changed since the last update?" /></label>{validation && <p role="alert" className="text-sm text-red-700">{validation}</p>}{update.isError && <PerformanceError error={update.error} />}<HrButton disabled={busy} onClick={record}>{update.isPending ? 'Saving...' : 'Record progress'}</HrButton></div>}
      <section><h4 className="mb-3 font-semibold">Progress history</h4>{history.isLoading ? <p role="status" className="text-sm">Loading history...</p> : history.isError ? <PerformanceError error={history.error} retry={() => history.refetch()} /> : !history.data?.length ? <p className="text-sm text-text-secondary">No progress updates recorded yet.</p> : <ol className="space-y-3">{history.data.map(entry => <li key={entry.id} className="border-l-2 border-[#0F6E56] pl-4"><div className="flex justify-between gap-2 text-sm"><strong>{entry.previousValue ?? 'Initial'} &rarr; {entry.newValue} {kpi.unit}</strong><span>{entry.progressPct}%</span></div><p className="mt-1 text-xs text-text-secondary">{[stamp(entry.updatedAt), entry.updatedByName ? `by ${entry.updatedByName}` : ''].filter(Boolean).join(' · ')}</p>{entry.notes && <p className="mt-1 text-sm">{entry.notes}</p>}</li>)}</ol>}</section>
      {canManage && kpi.status !== 'DROPPED' && <div className="border-t border-border-default pt-4">{confirmDrop ? <div className="space-y-3"><p className="text-sm">Drop this KPI? Its values and progress history will remain available under Dropped.</p><div className="flex gap-2"><HrButton disabled={busy} onClick={async () => { try { await drop.mutateAsync(kpi.id); toast('KPI dropped', 'success'); onClose() } catch { /* Inline error. */ } }}>Confirm drop</HrButton><HrButton disabled={busy} variant="ghost" onClick={() => setConfirmDrop(false)}>Keep KPI</HrButton></div></div> : <HrButton variant="ghost" onClick={() => setConfirmDrop(true)}>Drop KPI</HrButton>}{drop.isError && <PerformanceError error={drop.error} />}</div>}
    </div>
  </HrDrawer>
}
