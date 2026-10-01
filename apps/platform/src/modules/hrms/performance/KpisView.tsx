// Performance · Goals & KPIs (PgGrow p-center tab 2): the tiles (server counts in the caller's
// scope, BW-82), the company KPIs with their roll-up from linked goals (BW-83), the goals at
// risk with the owner's department, and every goal and KPI (search, status, paging) with
// add, edit, record progress, history and drop, as before.
//   read hrms.performance.read (managers: their team); add / edit / drop hrms.kpi.manage;
//   record progress hrms.performance.write or hrms.kpi.progress (team, V143.9).
import { useEffect, useState } from 'react'
import { usePermission } from '@unifiedtree/sdk'
import {
  BarList, Button, Callout, CellActions, CellPerson, EmptyState, MiniStat, MiniStatGrid, ProgressBar, Section, StatusPill, Table, errorText,
  type TableColumn,
} from '@/design/kit/display'
import { Pager, SectionCell, SectionGrid } from '@/design/kit/data'
import { DateInput, FieldGrid, Input, PanelButton, Select, SidePanel, Textarea, useToast } from '@/design/kit/overlays'
import { stamp } from '@/design/module/ModuleKit'
import { useCompanies } from '../api/useOrg'
import type { EmployeeKpiRow } from '../api/usePerformance'
import {
  useAdminKpis, useCompanyKpis, useDropKpi, useKpiHistory, useKpiSummary, useRecordKpiProgress, useSaveCompanyKpi, useSaveKpi,
  type CompanyKpi, type KpiDirection, type KpiStatus,
} from '../api/usePerformanceAdmin'
import { dateLong, kpiStatus } from './growModel'
import { PersonSearch, personName } from './PersonSearch'

const pctOf = (r: EmployeeKpiRow) => Math.max(0, Math.round(Number(r.progressPct ?? 0)))
const dueLabel = (v?: string | null) => (v ? dateLong(v) : 'No due date')
/** "45 / 100 tasks" (the format today's tests and people read). */
const valueLine = (r: EmployeeKpiRow) => `${r.currentValue ?? 0} / ${r.targetValue ?? 'Not set'}${r.unit ? ` ${r.unit}` : ''}`

export function KpisView({ addKey }: { addKey: number }) {
  const manage = usePermission('hrms.kpi.manage')
  const write = usePermission('hrms.performance.write')
  const teamProgress = usePermission('hrms.kpi.progress')
  const canRecord = write || teamProgress
  const teamOnly = !write && !manage
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(0)
  const [size, setSize] = useState(25)
  const [editing, setEditing] = useState<EmployeeKpiRow | 'new' | null>(null)
  const [selected, setSelected] = useState<EmployeeKpiRow | null>(null)
  const [companyKpi, setCompanyKpi] = useState<CompanyKpi | 'new' | null>(null)
  useEffect(() => { if (addKey) setEditing('new') }, [addKey])
  const summary = useKpiSummary()
  const companyKpis = useCompanyKpis()
  const atRisk = useAdminKpis({ search: '', status: 'AT_RISK', page: 0, size: 5 })
  const query = useAdminKpis({ search, status, page, size })
  const total = query.data?.total ?? 0
  useEffect(() => { const pages = Math.ceil(total / size); if (page > 0 && page >= pages) setPage(Math.max(0, pages - 1)) }, [total, size, page])

  const columns: TableColumn<EmployeeKpiRow>[] = [
    { key: 'title', header: 'Goal / KPI', primary: true, render: (r) => (
      <button type="button" className="grw-link" onClick={() => setSelected(r)} style={{ display: 'grid', gap: 2 }}>
        <span className="grw-strong">{r.title}</span>
        <span className="grw-muted">{[r.companyKpiTitle ? `Counts towards ${r.companyKpiTitle}` : r.category || 'General', dueLabel(r.dueDate)].join(' · ')}</span>
      </button>
    ) },
    { key: 'owner', header: 'Owner', render: (r) => <CellPerson name={r.ownerName || 'Employee'} sub={r.department || r.ownerCode || undefined} /> },
    { key: 'target', header: 'Current / target', render: (r) => <span className="grw-num" style={{ whiteSpace: 'nowrap' }}>{valueLine(r)}</span> },
    { key: 'progress', header: 'Progress', render: (r) => (
      <span style={{ display: 'grid', gap: 4, minWidth: 110 }}><span className="grw-num grw-strong">{`${pctOf(r)}%`}</span><ProgressBar value={Math.min(100, pctOf(r))} tone={r.status === 'AT_RISK' ? 'warning' : 'brand'} height={6} /></span>
    ) },
    { key: 'status', header: 'Status', render: (r) => { const s = kpiStatus(r.status); return <StatusPill tone={s.tone}>{s.label}</StatusPill> } },
    { key: 'act', header: <span className="uk-sr">Actions</span>, label: 'Actions', align: 'right', render: (r) => (
      <CellActions>
        <Button variant="secondary" size={30} onClick={() => setSelected(r)}>{canRecord && r.status !== 'DROPPED' ? 'Update progress' : 'View history'}</Button>
        {manage && <Button variant="secondary" size={30} onClick={() => setEditing(r)}>Edit</Button>}
      </CellActions>
    ) },
  ]
  const s = summary.data
  return (
    <>
      <Section title="Goals" loading={summary.isLoading} skeleton="stats" error={summary.error} onRetry={() => summary.refetch()}>
        {s && (
          <MiniStatGrid>
            <MiniStat label="Goals" value={s.total} note={teamOnly ? 'Across your team' : 'Across everyone'} tone="neutral" />
            <MiniStat label="Completed" value={s.completed} note={s.atRisk ? `${s.atRisk} at risk` : undefined} tone="success" />
            <MiniStat label="Reached" countUp={false} value={`${s.reachedPct}%`} note="Of all goals" tone="info" />
            <MiniStat label="Average progress" countUp={false} value={`${s.averageProgress}%`} note="Across all goals" tone="info" />
          </MiniStatGrid>
        )}
      </Section>
      <SectionGrid>
        {!companyKpis.notAvailable && (
          <SectionCell width="half">
            <Section title="Company KPIs" sub="Progress is the weighted average of the goals linked to each KPI." loading={companyKpis.isLoading} skeleton="list"
              error={companyKpis.error} onRetry={() => companyKpis.refetch()}
              action={manage ? { label: 'Add company KPI', icon: 'plus', onClick: () => setCompanyKpi('new') } : undefined}
              empty={companyKpis.data && companyKpis.data.length === 0 ? { title: 'No company KPIs yet', hint: manage ? 'Add one, then link goals to it.' : 'Company KPIs HR sets appear here.', icon: 'target' } : undefined}>
              {companyKpis.data && companyKpis.data.length > 0 && (
                <BarList label="Company KPIs" labelWidth="minmax(120px,200px)" valueWidth={56} max={100}
                  items={companyKpis.data.map((k) => ({
                    key: k.id, label: k.title, pct: k.progress ?? 0, amount: k.progress ?? 0,
                    value: k.progress == null ? 'No goals' : `${k.progress}%`, tone: k.status === 'COMPLETED' ? 'success' : (k.progress ?? 0) < 60 ? 'warning' : 'brand',
                    title: `${k.linkedGoals} linked ${k.linkedGoals === 1 ? 'goal' : 'goals'}${k.dueDate ? ` · due ${dateLong(k.dueDate)}` : ''}`,
                    onClick: manage ? () => setCompanyKpi(k) : undefined,
                  }))} />
              )}
            </Section>
          </SectionCell>
        )}
        <SectionCell width={companyKpis.notAvailable ? 'full' : 'half'}>
          <Section title="Goals at risk" body="flush" error={atRisk.error} onRetry={() => atRisk.refetch()}>
            <Table label="Goals at risk" rows={atRisk.data?.items ?? []} rowKey={(r) => r.id} loading={atRisk.isLoading} mobile="cards" density="compact"
              columns={[
                { key: 'owner', header: 'Owner', primary: true, render: (r) => <CellPerson name={r.ownerName || 'Employee'} sub={r.department || r.ownerCode || undefined} /> },
                { key: 'goal', header: 'Goal', render: (r) => <button type="button" className="grw-link grw-clip" title={r.title} onClick={() => setSelected(r)}>{r.title}</button> },
                { key: 'pct', header: 'Progress', render: (r) => <span className="grw-num">{`${pctOf(r)}%`}</span> },
                { key: 'st', header: 'Status', render: () => <StatusPill tone="danger">At risk</StatusPill> },
              ]}
              empty={<EmptyState variant="success" title="Nothing at risk" hint="Goals past their due date and short of 100% show here." />} />
          </Section>
        </SectionCell>
      </SectionGrid>
      {teamOnly && <Callout tone="neutral">You see your team: everyone in the departments you head, or your direct reports if you don’t head one. Your own reviews and goals are under My reviews and My goals.</Callout>}
      <Section title={teamOnly ? 'Your team’s goals & KPIs' : 'All goals & KPIs'} body="flush" error={query.error} onRetry={() => query.refetch()}
        actions={(
          <div className="grw-filters">
            <Input label="Search KPI titles" type="search" value={search} placeholder="Search goals" onChange={(e) => { setSearch(e.target.value); setPage(0) }} />
            <div className="grw-filters__fixed">
              <Select label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(0) }}
                options={[{ value: '', label: 'All statuses' }, { value: 'ACTIVE', label: 'Active' }, { value: 'AT_RISK', label: 'At risk' }, { value: 'COMPLETED', label: 'Completed' }, { value: 'DROPPED', label: 'Dropped' }]} />
            </div>
          </div>
        )}
        footer={total > size ? <Pager page={page} pageSize={size} total={total} onPageChange={setPage} onPageSizeChange={(n) => { setSize(n); setPage(0) }} noun="goals" /> : undefined}>
        <Table label={teamOnly ? 'Your team’s goals and KPIs' : 'Goals and KPIs'} columns={columns} rows={query.data?.items ?? []} rowKey={(r) => r.id} loading={query.isLoading} mobile="cards"
          empty={<EmptyState variant="plain" icon="target" title={search || status ? 'No goals match these filters' : 'No goals yet'} hint={search || status ? undefined : manage ? 'Use “Add goal” to set the first one.' : undefined} />} />
      </Section>
      {editing && <GoalForm existing={editing === 'new' ? undefined : editing} companyKpis={companyKpis.notAvailable ? null : companyKpis.data ?? []} onClose={() => setEditing(null)} />}
      {selected && <KpiDetails initial={selected} canWrite={canRecord} canManage={manage} onClose={() => setSelected(null)} />}
      {companyKpi && <CompanyKpiPanel existing={companyKpi === 'new' ? undefined : companyKpi} onClose={() => setCompanyKpi(null)} />}
    </>
  )
}

/** Add or edit a goal assigned to someone (hrms.kpi.manage): owner, target, weight, company KPI, due date. */
function GoalForm({ existing, companyKpis, onClose }: { existing?: EmployeeKpiRow; companyKpis: CompanyKpi[] | null; onClose: () => void }) {
  const save = useSaveKpi()
  const toast = useToast()
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
  const [kpiId, setKpiId] = useState(existing?.companyKpiId || '')
  const [validation, setValidation] = useState('')
  const openKpis = (companyKpis ?? []).filter((k) => k.status !== 'DROPPED')
  const submit = async () => {
    if (!ownerId || !title.trim()) { setValidation('Choose an owner and enter a KPI title.'); return }
    if (!target.trim() || !Number.isFinite(Number(target)) || Number(target) <= 0) { setValidation('Enter a target greater than zero.'); return }
    if (!Number.isFinite(Number(current)) || Number(current) < 0 || !weight.trim() || !Number.isInteger(Number(weight)) || Number(weight) < 0 || Number(weight) > 100) {
      setValidation('Use a non-negative current value and a whole-number weight between 0 and 100.'); return
    }
    setValidation('')
    try {
      await save.mutateAsync({ id: existing?.id, payload: {
        ownerId, title: title.trim(), description: description.trim(), category: category.trim(), targetValue: Number(target), currentValue: Number(current),
        unit: unit.trim(), direction, weight: Number(weight), dueDate: dueDate || (existing ? '' : undefined), status: existing ? status : undefined,
        companyKpiId: kpiId || undefined, clearCompanyKpi: existing && !kpiId && !!existing.companyKpiId ? true : undefined,
      } })
      toast.success(existing ? 'Goal updated' : 'Goal added'); onClose()
    } catch (e) { setValidation(errorText(e, 'Couldn’t save the goal.')) }
  }
  return (
    <SidePanel open onClose={() => { if (!save.isPending) onClose() }} busy={save.isPending} width={600}
      title={existing ? 'Edit goal' : 'Add goal'} sub={companyKpis ? 'Link it to a company KPI so progress rolls up.' : 'A measured goal for one person, with a target.'}
      footer={<>
        <PanelButton variant="secondary" size="lg" onClick={onClose} disabled={save.isPending}>Cancel</PanelButton>
        <PanelButton variant="primary" size="lg" busy={save.isPending} onClick={submit}>Save KPI</PanelButton>
      </>}>
      <div className="grw-form">
        <PersonSearch value={ownerId} selectedLabel={ownerName} onChange={(e) => { setOwnerId(e.id); setOwnerName(personName(e)) }} />
        <Input label="KPI title" maxLength={300} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Resolve customer requests within SLA" />
        <Textarea label="Description" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" />
        <FieldGrid columns={2}>
          <Input label="Target value" type="number" min="0.01" step="any" value={target} onChange={(e) => setTarget(e.target.value)} />
          {!existing && <Input label="Starting value" type="number" min={0} step="any" value={current} onChange={(e) => setCurrent(e.target.value)} />}
          <Input label="Unit" maxLength={24} value={unit} placeholder="%, tasks, hours" onChange={(e) => setUnit(e.target.value)} />
          <Input label="Weight" type="number" min={0} max={100} step={1} value={weight} onChange={(e) => setWeight(e.target.value)} hint="A whole number from 0 to 100" />
          <Input label="Category" maxLength={40} value={category} onChange={(e) => setCategory(e.target.value)} />
          <DateInput label="Due date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} clearable />
        </FieldGrid>
        {companyKpis && (
          <Select label="Company KPI" value={kpiId} onChange={(e) => setKpiId(e.target.value)}
            options={[{ value: '', label: 'None' }, ...openKpis.map((k) => ({ value: k.id, label: k.title }))]} />
        )}
        <Select label="Success measure" value={direction} onChange={(e) => setDirection(e.target.value as KpiDirection)}
          options={[{ value: 'HIGHER_IS_BETTER', label: 'Higher is better' }, { value: 'LOWER_IS_BETTER', label: 'Lower is better' }, { value: 'TARGET_EXACT', label: 'Match the target' }]} />
        {existing && (
          <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value as KpiStatus)}
            options={[{ value: 'ACTIVE', label: 'Active' }, { value: 'AT_RISK', label: 'At risk' }, { value: 'COMPLETED', label: 'Completed' }, { value: 'DROPPED', label: 'Dropped' }]} />
        )}
        {validation && <Callout tone="danger" icon="alert"><span role="alert">{validation}</span></Callout>}
      </div>
    </SidePanel>
  )
}

/** Progress & history of one goal (also opened from a person's performance page). */
export function KpiDetails({ initial, canWrite, canManage, onClose }: { initial: EmployeeKpiRow; canWrite: boolean; canManage: boolean; onClose: () => void }) {
  const [kpi, setKpi] = useState(initial)
  const history = useKpiHistory(kpi.id)
  const update = useRecordKpiProgress()
  const drop = useDropKpi()
  const toast = useToast()
  const [value, setValue] = useState(String(kpi.currentValue ?? 0))
  const [notes, setNotes] = useState('')
  const [confirmDrop, setConfirmDrop] = useState(false)
  const [validation, setValidation] = useState('')
  const busy = update.isPending || drop.isPending
  const st = kpiStatus(kpi.status)
  const record = async () => {
    if (!value.trim() || !Number.isFinite(Number(value)) || Number(value) < 0) { setValidation('Enter a non-negative current value.'); return }
    setValidation('')
    try { const changed = await update.mutateAsync({ id: kpi.id, newValue: Number(value), notes: notes.trim() || undefined }); setKpi(changed); setNotes(''); toast.success('Progress recorded') }
    catch (e) { setValidation(errorText(e, 'Couldn’t record the progress.')) }
  }
  return (
    <SidePanel open onClose={() => { if (!busy) onClose() }} busy={busy} width={600} title="KPI progress & history"
      sub={[kpi.ownerName || 'Owner', kpi.ownerCode, dueLabel(kpi.dueDate)].filter(Boolean).join(' · ')}>
      <div className="grw-stack">
        <div className="grw-stack grw-stack--tight">
          <span className="grw-muted">{kpi.companyKpiTitle ? `Counts towards ${kpi.companyKpiTitle}` : kpi.category || 'Company goal'}</span>
          <h3 className="grw-h2">{kpi.title}</h3>
          {kpi.description && <p style={{ margin: 0, fontSize: 13.5, color: 'var(--u-ink2, #4A5A54)' }}>{kpi.description}</p>}
        </div>
        <MiniStatGrid>
          <MiniStat label="Current / target" countUp={false} value={valueLine(kpi)} tone="info" />
          <MiniStat label="Progress" countUp={false} value={`${pctOf(kpi)}%`} note={<StatusPill tone={st.tone} size="sm">{st.label}</StatusPill>} tone="success" />
        </MiniStatGrid>
        {canWrite && kpi.status !== 'DROPPED' && kpi.targetValue == null && (
          <Callout tone="neutral">This goal has no target, so there’s no value to record. Its owner updates the percentage under My goals. Edit it and add a target to measure it with values.</Callout>
        )}
        {canWrite && kpi.status !== 'DROPPED' && kpi.targetValue != null && (
          <Section title="Record progress" level={3} cardClass={false} variant="panel">
            <div className="grw-form">
              <Input label="New current value" type="number" min={0} step="any" value={value} onChange={(e) => setValue(e.target.value)} />
              <Textarea label="Progress note" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What changed since the last update?" />
              {validation && <Callout tone="danger" icon="alert"><span role="alert">{validation}</span></Callout>}
              <div><Button loading={update.isPending} disabled={busy} onClick={record}>Record progress</Button></div>
            </div>
          </Section>
        )}
        <Section title="Progress history" level={3} cardClass={false} variant="panel" loading={history.isLoading} skeleton="list" error={history.error} onRetry={() => history.refetch()}
          empty={history.data && history.data.length === 0 ? { title: 'No progress updates recorded yet', variant: 'plain' } : undefined}>
          {history.data && history.data.length > 0 && (
            <ul className="grw-list">
              {history.data.map((h) => (
                <li key={h.id} style={{ display: 'grid', gap: 4 }}>
                  <span className="grw-row grw-row--between"><span className="grw-strong grw-num">{`${h.previousValue ?? 'Initial'} → ${h.newValue}${kpi.unit ? ` ${kpi.unit}` : ''}`}</span><span className="grw-num grw-muted">{`${h.progressPct}%`}</span></span>
                  <span className="grw-muted">{[stamp(h.updatedAt), h.updatedByName ? `by ${h.updatedByName}` : ''].filter(Boolean).join(' · ')}</span>
                  {h.notes && <span style={{ fontSize: 13.5 }}>{h.notes}</span>}
                </li>
              ))}
            </ul>
          )}
        </Section>
        {canManage && kpi.status !== 'DROPPED' && (
          <div style={{ borderTop: '1px solid var(--u-ln, #E3E9E6)', paddingTop: 16 }}>
            {confirmDrop ? (
              <div className="grw-stack grw-stack--tight">
                <p style={{ margin: 0, fontSize: 13.5 }}>Drop this KPI? Its values and progress history stay available under Dropped.</p>
                <div className="grw-row">
                  <Button variant="danger" disabled={busy} loading={drop.isPending} onClick={async () => {
                    try { await drop.mutateAsync(kpi.id); toast.success('KPI dropped'); onClose() }
                    catch (e) { toast.error('Couldn’t drop the KPI', { detail: errorText(e, 'Try again in a moment.') }) }
                  }}>Confirm drop</Button>
                  <Button variant="secondary" disabled={busy} onClick={() => setConfirmDrop(false)}>Keep KPI</Button>
                </div>
              </div>
            ) : <Button variant="secondary" onClick={() => setConfirmDrop(true)}>Drop KPI</Button>}
          </div>
        )}
      </div>
    </SidePanel>
  )
}

/** Add or change a company KPI (hrms.kpi.manage). */
function CompanyKpiPanel({ existing, onClose }: { existing?: CompanyKpi; onClose: () => void }) {
  const companies = useCompanies()
  const save = useSaveCompanyKpi()
  const toast = useToast()
  const list = companies.data ?? []
  const [companyId, setCompanyId] = useState(existing?.companyId || '')
  const [title, setTitle] = useState(existing?.title || '')
  const [description, setDescription] = useState(existing?.description || '')
  const [target, setTarget] = useState(existing?.targetValue != null ? String(existing.targetValue) : '')
  const [unit, setUnit] = useState(existing?.unit || '')
  const [dueDate, setDueDate] = useState(existing?.dueDate || '')
  const [status, setStatus] = useState(existing?.status || 'ACTIVE')
  const [error, setError] = useState('')
  const company = companyId || (list.length === 1 ? list[0].id : '')
  const submit = async () => {
    if (!title.trim()) { setError('Give the KPI a title.'); return }
    if (!existing && !company) { setError('Choose the company.'); return }
    if (target && !(Number(target) > 0)) { setError('The target must be more than zero.'); return }
    setError('')
    try {
      const r = await save.mutateAsync({ id: existing?.id, payload: {
        companyId: existing ? undefined : company, title: title.trim(), description: description.trim(), unit: unit.trim(),
        targetValue: target ? Number(target) : null, dueDate: dueDate || null, status: existing ? status : undefined,
      } })
      if (!r.available) { toast.info('Company KPIs aren’t switched on yet.'); return }
      toast.success(existing ? 'Company KPI saved' : 'Company KPI added'); onClose()
    } catch (e) { setError(errorText(e, 'Couldn’t save the company KPI.')) }
  }
  return (
    <SidePanel open onClose={() => { if (!save.isPending) onClose() }} busy={save.isPending} width={520}
      title={existing ? 'Company KPI' : 'Add company KPI'} sub={existing ? `${existing.linkedGoals} linked ${existing.linkedGoals === 1 ? 'goal' : 'goals'}${existing.progress != null ? ` · ${existing.progress}% so far` : ''}` : 'People link their goals to it; its progress rolls up from them.'}
      footer={<>
        <PanelButton variant="secondary" size="lg" onClick={onClose} disabled={save.isPending}>Cancel</PanelButton>
        <PanelButton variant="primary" size="lg" busy={save.isPending} onClick={submit}>{existing ? 'Save' : 'Add company KPI'}</PanelButton>
      </>}>
      <div className="grw-form">
        {!existing && list.length > 1 && <Select label="Company" value={company} onChange={(e) => setCompanyId(e.target.value)} placeholder="Choose company" options={list.map((c) => ({ value: c.id, label: c.name }))} />}
        <Input label="KPI" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. CSAT above 4.5" />
        <Textarea label="Description" rows={2} maxLength={1000} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" />
        <FieldGrid columns={2}>
          <Input label="Target" type="number" min="0.01" step="any" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="Optional" />
          <Input label="Unit" maxLength={24} value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="%, ₹ Cr, ms" />
          <DateInput label="Due date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} clearable />
          {existing && <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value as CompanyKpi['status'])}
            options={[{ value: 'ACTIVE', label: 'Active' }, { value: 'COMPLETED', label: 'Completed' }, { value: 'DROPPED', label: 'Dropped' }]} />}
        </FieldGrid>
        {error && <Callout tone="danger" icon="alert"><span role="alert">{error}</span></Callout>}
      </div>
    </SidePanel>
  )
}
