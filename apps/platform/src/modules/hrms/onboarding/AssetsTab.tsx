// Assets view inside Onboarding & assets, on the redesign kit (prototype PgTalent h-onb "Assets"):
// the equipment figures, problems people reported (BW-70), and every asset with who has it,
// since when, and Give to / Take back / History.
// Read: hrms.onboarding.asset.read or instance.write; changes: asset.write or instance.write;
// problem reports: asset.write. Holder names come from the server only for callers with
// hrms.employee.read, and link to the employee page with that permission.
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePermission } from '@unifiedtree/sdk'
import {
  Button, Callout, CellActions, EmptyState, MiniStat, MiniStatGrid, SegmentedControl, Section, StatusPill, Table, errorText, type TableColumn,
} from '@/design/kit/display'
import { Dialog, Input, PanelButton, Select, SidePanel, Textarea, useToast } from '@/design/kit/overlays'
import { useCompanies } from '../api/useOrg'
import { useEmployeesByIds } from '../api/useWorkforce'
import { PersonSearch, personName } from '../performance/PersonSearch'
import { useAssets, useAssetActions, useAssetIssues, useResolveAssetIssue, type Asset, type AssetInput, type AssetIssue } from './api/useAssets'
import { AssetHistory } from './AssetHistory'
import { assetDates, assetMatches, assetPill, fullDate, issueKindLabel, type AssetFilter } from './onboardingModel'
import '../performance/grow.css'
import './onboarding.css'

const EMPTY: AssetInput = { companyId: '', assetTag: '', assetType: '', assetName: '', serialNo: '', conditionNotes: '' }
const FIELDS = [
  { key: 'assetTag', label: 'Asset tag', max: 80, required: true, ph: 'e.g. LAP-0042' },
  { key: 'assetType', label: 'Category', max: 80, required: true, ph: 'e.g. Laptop' },
  { key: 'assetName', label: 'Asset name', max: 200, required: true, ph: 'e.g. ThinkPad T14' },
  { key: 'serialNo', label: 'Serial number', max: 120, required: false, ph: 'Optional' },
] as const

/** Register an asset: the company that owns it, tag, category, name, serial and condition. */
export function RegisterAssetPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const companies = useCompanies()
  const { create } = useAssetActions()
  const toast = useToast()
  const [form, setForm] = useState<AssetInput>({ ...EMPTY })
  const [error, setError] = useState('')
  // Categories already in use, offered as suggestions so the list stays tidy (Laptop, not laptop / Laptops).
  const existing = useAssets(open)
  const categories = useMemo(() => [...new Set((existing.data ?? []).map((a) => a.assetType).filter(Boolean))].sort(), [existing.data])
  useEffect(() => {
    if (!open) return
    setForm({ ...EMPTY, companyId: companies.data?.length === 1 ? companies.data[0].id : '' }); setError('')
  }, [open, companies.data])
  const missing = !form.companyId ? 'Choose the company that owns this asset'
    : FIELDS.some((f) => f.required && !String(form[f.key] ?? '').trim()) ? 'Fill in the tag, category and name' : null
  const close = () => { if (!create.isPending) onClose() }
  const save = async () => {
    if (missing) return
    setError('')
    try { await create.mutateAsync(form); toast.success('Asset registered'); onClose() }
    catch (e) { setError(errorText(e, 'Couldn’t register the asset.')) }
  }
  return (
    <SidePanel open={open} onClose={close} busy={create.isPending} width={520} closeLabel="Close panel" title="Register an asset" sub="Choose the company that owns this asset."
      footer={<>
        <PanelButton variant="secondary" size="lg" disabled={create.isPending} onClick={close}>Cancel</PanelButton>
        <PanelButton variant="primary" size="lg" busy={create.isPending} blockedReason={missing} onClick={save}>Register asset</PanelButton>
      </>}>
      <form className="onb-form" onSubmit={(e) => { e.preventDefault(); void save() }}>
        <Select id="asset-company" label="Company" required value={form.companyId} placeholder="Choose a company"
          onChange={(e) => setForm({ ...form, companyId: e.target.value })} options={(companies.data ?? []).map((c) => ({ value: c.id, label: c.name }))} />
        {companies.isError && <Callout tone="danger" icon="alert"><span role="alert">Couldn’t load companies. <button type="button" className="onb-link" onClick={() => companies.refetch()}>Try again</button></span></Callout>}
        <div className="onb-wiz-grid">
          {FIELDS.map((f) => (
            <Input key={f.key} id={`asset-${f.key}`} label={f.label} required={f.required} maxLength={f.max} placeholder={f.ph} list={f.key === 'assetType' ? 'asset-category-options' : undefined}
              value={form[f.key] ?? ''} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
          ))}
        </div>
        <datalist id="asset-category-options">{categories.map((c) => <option key={c} value={c} />)}</datalist>
        <Textarea id="asset-cond" label="Condition notes" rows={2} maxLength={4000} placeholder="Optional, e.g. new in box" value={form.conditionNotes ?? ''}
          onChange={(e) => setForm({ ...form, conditionNotes: e.target.value })} />
        {error && <Callout tone="danger" icon="alert"><span role="alert">{error}</span></Callout>}
      </form>
    </SidePanel>
  )
}

export function AssetsTab() {
  const assetRead = usePermission('hrms.onboarding.asset.read')
  const assetWrite = usePermission('hrms.onboarding.asset.write')
  const instanceWrite = usePermission('hrms.onboarding.instance.write')
  const directoryRead = usePermission('hrms.employee.read')
  const canWrite = assetWrite || instanceWrite
  const query = useAssets(assetRead || instanceWrite)
  const assets = useMemo(() => query.data ?? [], [query.data])
  // An older server sends no holder names: look them up as before (directory read only).
  const needNames = directoryRead && assets.some((a) => a.status === 'ASSIGNED' && a.employeeId && a.holderName === undefined)
  const employees = useEmployeesByIds(needNames ? assets.flatMap((a) => (a.employeeId ? [a.employeeId] : [])) : [], { enabled: needNames })
  const [selected, setSelected] = useState<Asset>()
  const [history, setHistory] = useState<Asset>()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<AssetFilter>('all')

  const counts = useMemo(() => ({
    all: assets.length,
    with: assets.filter((a) => a.status === 'ASSIGNED').length,
    store: assets.filter((a) => a.status !== 'ASSIGNED').length,
  }), [assets])
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return assets.filter((a) => assetMatches(a.status, filter)
      && (!q || [a.assetTag, a.assetName, a.assetType, a.serialNo, a.holderName].some((v) => v?.toLowerCase().includes(q))))
  }, [assets, search, filter])
  const holderOf = (a: Asset) => {
    if (a.holderName) return a.holderName
    const p = employees.data?.find((e) => e.id === a.employeeId)
    return p ? personName(p) : ''
  }

  if (!assetRead && !instanceWrite) return <EmptyState icon="lock" title="No access to assets" hint="Ask an admin if you hand out or track equipment." />

  const columns: TableColumn<Asset>[] = [
    {
      key: 'asset', header: 'Asset', primary: true, render: (a) => (
        <span className="onb-cell2"><span className="onb-strong">{a.assetTag}</span><span className="onb-muted">{a.assetName}{a.serialNo ? ` · ${a.serialNo}` : ''}</span></span>
      ),
    },
    { key: 'type', header: 'Category', render: (a) => a.assetType },
    {
      key: 'with', header: 'With', render: (a) => {
        if (a.status !== 'ASSIGNED' || !a.employeeId) return <span className="onb-muted">—</span>
        const who = holderOf(a)
        return directoryRead ? <Link to={`/hrms/employees/${a.employeeId}`} className="onb-link" style={{ textDecoration: 'none' }}>{who || 'View employee'}</Link>
          : <span className="onb-muted">An employee</span>
      },
    },
    {
      key: 'dates', header: 'Dates', render: (a) => (
        <span className="onb-cell2"><span className="onb-clip" title={assetDates(a)}>{assetDates(a)}</span>{a.conditionNotes && <span className="onb-muted onb-clip" title={a.conditionNotes}>{a.conditionNotes}</span>}</span>
      ),
    },
    {
      key: 'status', header: 'Status', render: (a) => {
        const p = assetPill(a.status)
        return (
          <span className="onb-row" style={{ gap: 6 }}>
            <StatusPill tone={p.tone}>{p.label}</StatusPill>
            {a.openIssue && <StatusPill tone="danger" size="xs" title={a.openIssue.note || undefined}>{`Problem: ${issueKindLabel(a.openIssue.kind).toLowerCase()}`}</StatusPill>}
            {a.status === 'ASSIGNED' && a.confirmationPending && <StatusPill tone="muted" size="xs">Not confirmed yet</StatusPill>}
          </span>
        )
      },
    },
    {
      key: 'act', header: <span className="uk-sr">Actions</span>, label: 'Actions', align: 'right', render: (a) => (
        <CellActions>
          {canWrite && (a.status === 'ASSIGNED'
            ? <Button variant="secondary" size={30} onClick={() => setSelected(a)}>Take back</Button>
            : <Button variant="soft" size={30} onClick={() => setSelected(a)}>Give to</Button>)}
          <Button variant="secondary" size={30} onClick={() => setHistory(a)}>History</Button>
        </CellActions>
      ),
    },
  ]

  return (
    <>
      <Section title="Equipment" loading={query.isLoading} skeleton="stats" skeletonRows={3}>
        {!query.isError && (
          <MiniStatGrid>
            <MiniStat label="All assets" value={counts.all} note="Registered" tone="neutral" />
            <MiniStat label="With employees" value={counts.with} note="Handed out" tone="success" />
            <MiniStat label="In store" value={counts.store} note="Ready to hand out" tone="info" />
          </MiniStatGrid>
        )}
      </Section>

      {assetWrite && <ReportedProblems />}

      <Section title="Assets" body="flush" loading={query.isLoading} skeleton="table" error={query.error} onRetry={() => query.refetch()} retrying={query.isRefetching}
        empty={assets.length === 0 ? { title: 'No assets registered', icon: 'briefcase', variant: 'plain', hint: canWrite ? 'Register laptops, phones and ID cards here, then give them to new hires.' : 'Equipment HR registers appears here.' } : undefined}
        actions={assets.length > 0 ? (
          <div className="onb-row">
            <div style={{ width: 'min(100%, 240px)' }}>
              <Input aria-label="Search assets" type="search" size="md" value={search} placeholder="Search tag, name or serial" onChange={(e) => setSearch(e.target.value)} />
            </div>
            <SegmentedControl label="Filter by status" semantics="toggle" size="sm" value={filter} onChange={setFilter}
              options={[{ value: 'all', label: 'All statuses' }, { value: 'with', label: 'With employee' }, { value: 'store', label: 'In store' }]} />
          </div>
        ) : undefined}>
        <Table label="Assets" columns={columns} rows={rows} rowKey={(a) => a.id} mobile="cards"
          empty={<EmptyState variant="plain" icon="briefcase" title="Nothing matches" hint="Clear the search or the status filter." />} />
      </Section>

      {selected && <AssetMovePanel asset={selected} onClose={() => setSelected(undefined)} />}
      {history && <AssetHistory assetId={history.id} tag={history.assetTag} onClose={() => setHistory(undefined)} />}
    </>
  )
}

/** Give an asset to someone, or record it coming back with its condition. */
function AssetMovePanel({ asset, onClose }: { asset: Asset; onClose: () => void }) {
  const { assign, receive } = useAssetActions()
  const toast = useToast()
  const taking = asset.status === 'ASSIGNED'
  const [employee, setEmployee] = useState({ id: '', name: '' })
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')
  const busy = assign.isPending || receive.isPending
  const close = () => { if (!busy) onClose() }
  const act = async () => {
    setError('')
    try {
      if (taking) await receive.mutateAsync({ id: asset.id, notes })
      else await assign.mutateAsync({ id: asset.id, employeeId: employee.id })
      toast.success(taking ? 'Return recorded' : `Given to ${employee.name}`); onClose()
    } catch (e) { setError(errorText(e, 'Couldn’t update the asset.')) }
  }
  return (
    <SidePanel open onClose={close} busy={busy} width={520} closeLabel="Close panel" title={taking ? `Take back ${asset.assetTag}` : `Give ${asset.assetTag} to someone`}
      sub={`${asset.assetName}${asset.serialNo ? ` · ${asset.serialNo}` : ''}`}
      footer={<>
        <PanelButton variant="secondary" size="lg" disabled={busy} onClick={close}>Cancel</PanelButton>
        <PanelButton variant="primary" size="lg" busy={busy} blockedReason={!taking && !employee.id ? 'Choose who gets it' : null} onClick={act}>
          {taking ? 'Record return' : 'Confirm assignment'}
        </PanelButton>
      </>}>
      <div className="onb-form">
        {taking
          ? <Textarea id="asset-return" label="Condition on return" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional, e.g. screen scratched" />
          : <PersonSearch companyId={asset.companyId} value={employee.id} selectedLabel={employee.name}
            onChange={(e) => setEmployee({ id: e.id, name: personName(e) })} />}
        {error && <Callout tone="danger" icon="alert"><span role="alert">{error}</span></Callout>}
      </div>
    </SidePanel>
  )
}

/** Open problem reports from the people holding the equipment (BW-70); hidden until the feature is switched on, and when there are none. */
function ReportedProblems() {
  const issues = useAssetIssues('OPEN', true)
  const resolve = useResolveAssetIssue()
  const toast = useToast()
  const [resolving, setResolving] = useState<AssetIssue | null>(null)
  const [note, setNote] = useState('')
  if (issues.notAvailable || (!issues.isLoading && !issues.error && !(issues.data ?? []).length)) return null
  const done = async () => {
    if (!resolving) return
    try { await resolve.mutateAsync({ id: resolving.id, note: note.trim() || undefined }); toast.success('Problem marked resolved'); setResolving(null); setNote('') }
    catch (e) { toast.error('Couldn’t resolve the problem', { detail: errorText(e, 'Try again in a moment.') }) }
  }
  const columns: TableColumn<AssetIssue>[] = [
    { key: 'asset', header: 'Asset', primary: true, render: (r) => <span className="onb-cell2"><span className="onb-strong">{r.assetTag}</span><span className="onb-muted">{r.assetName}</span></span> },
    { key: 'who', header: 'Reported by', render: (r) => r.employeeName || <span className="onb-muted">An employee</span> },
    { key: 'kind', header: 'Problem', render: (r) => <span className="onb-cell2"><span>{issueKindLabel(r.kind)}</span>{r.note && <span className="onb-muted onb-clip" title={r.note}>{r.note}</span>}</span> },
    { key: 'when', header: 'Reported', render: (r) => <span className="onb-num">{fullDate(r.reportedAt)}</span> },
    {
      key: 'act', header: <span className="uk-sr">Actions</span>, label: 'Actions', align: 'right', render: (r) => (
        <CellActions><Button variant="soft" size={30} onClick={() => { setNote(''); setResolving(r) }} aria-label={`Resolve the problem with ${r.assetTag}`}>Resolve</Button></CellActions>
      ),
    },
  ]
  return (
    <Section title="Reported problems" sub="Lost, damaged or broken equipment the holder told you about." count={issues.data?.length || undefined} countTone="gold"
      body="flush" loading={issues.isLoading} skeleton="table" skeletonRows={2} error={issues.error} onRetry={() => issues.refetch()} retrying={issues.isRefetching}>
      <Table label="Reported problems" columns={columns} rows={issues.data ?? []} rowKey={(r) => r.id} mobile="cards" />
      <Dialog open={!!resolving} onClose={() => { if (!resolve.isPending) setResolving(null) }} busy={resolve.isPending} icon="checkCircle"
        title={resolving ? `Resolve the problem with ${resolving.assetTag}?` : 'Resolve the problem?'}
        sub="The report closes. Note what was done, for example repaired or replaced."
        footer={<>
          <PanelButton variant="secondary" disabled={resolve.isPending} onClick={() => setResolving(null)}>Cancel</PanelButton>
          <PanelButton variant="primary" busy={resolve.isPending} onClick={done}>Mark resolved</PanelButton>
        </>}>
        <Textarea id="issue-resolve-note" label="What was done (optional)" rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Screen replaced" />
      </Dialog>
    </Section>
  )
}
