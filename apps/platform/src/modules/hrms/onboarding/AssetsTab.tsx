// Onboarding & assets › Assets (P-HIRE; prototype PgTalent h-onb tab Assets): register
// equipment, give it to someone, take it back, see its history, and look after the problems
// people report (BW-70).
// Read: hrms.onboarding.asset.read or instance.write; changes: asset.write or instance.write.
// Holder names come from the server only for callers with hrms.employee.read (BW-69); others
// see "An employee". Problem reports: hrms.onboarding.asset.write.
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePermission } from '@unifiedtree/sdk'
import { Button, CellActions, CellStack, MiniStat, MiniStatGrid, Section, SegmentedControl, StatusPill, Table, type TableColumn } from '@/design/kit/display'
import { Dialog, FieldGrid, Input, PanelButton, Select, SidePanel, Textarea, useToast } from '@/design/kit/overlays'
import { useCompanies } from '../api/useOrg'
import { useEmployeesByIds } from '../api/useWorkforce'
import { PersonSearch, fullName } from '../letters/components/PersonSearch'
import { useAssets, useAssetActions, useAssetIssues, useResolveAssetIssue, type Asset, type AssetIssue } from './api/useAssets'
import { problemLabel } from './myAssetsApi'
import { AssetHistory } from './AssetHistory'
import { assetDates, assetState, inStore } from './onboardingModel'
import { dayMon, istDateOf, istTodayIso } from '../hiring/hiringModel'
import '../hiring/hiring.css'

const ALL = 'all'
const errText = (e: unknown) => (e instanceof Error && e.message) || 'Please try again.'
type Filter = typeof ALL | 'ASSIGNED' | 'STORE'

export function AssetsTab({ registering, onRegisterDone }: { registering: boolean; onRegisterDone: () => void }) {
  const toast = useToast()
  const assetRead = usePermission('hrms.onboarding.asset.read')
  const assetWrite = usePermission('hrms.onboarding.asset.write')
  const instanceWrite = usePermission('hrms.onboarding.instance.write')
  const directoryRead = usePermission('hrms.employee.read')
  const canWrite = assetWrite || instanceWrite
  const query = useAssets(assetRead || instanceWrite)
  const assets = useMemo(() => query.data ?? [], [query.data])
  // Older servers don't send holder names: look them up as before (employee read only).
  const missing = useMemo(() => assets.filter((a) => a.status === 'ASSIGNED' && a.employeeId && a.holderName === undefined).map((a) => a.employeeId as string), [assets])
  const people = useEmployeesByIds(missing, { enabled: directoryRead && missing.length > 0 })
  const issues = useAssetIssues(assetWrite)
  const [filter, setFilter] = useState<Filter>(ALL)
  const [search, setSearch] = useState('')
  const [giving, setGiving] = useState<Asset | null>(null)
  const [taking, setTaking] = useState<Asset | null>(null)
  const [history, setHistory] = useState<Asset | null>(null)
  const today = istTodayIso()

  const counts = useMemo(() => ({ all: assets.length, with: assets.filter((a) => a.status === 'ASSIGNED').length, store: assets.filter((a) => inStore(a.status)).length }), [assets])
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return assets.filter((a) => (filter === ALL || (filter === 'STORE' ? inStore(a.status) : a.status === filter))
      && (!q || [a.assetTag, a.assetName, a.assetType, a.serialNo].some((v) => v?.toLowerCase().includes(q))))
  }, [assets, search, filter])

  const holder = (a: Asset): string | null => {
    if (a.holderName) return a.holderName
    const p = people.data?.find((e) => e.id === a.employeeId)
    return p ? fullName(p) : null
  }

  const columns: TableColumn<Asset>[] = [
    { key: 'asset', header: 'Asset', primary: true, width: '24%', render: (a) => <CellStack primary={a.assetTag} secondary={[a.assetName, a.serialNo].filter(Boolean).join(' · ')} /> },
    { key: 'category', header: 'Category', render: (a) => a.assetType || '—' },
    {
      key: 'with', header: 'With', render: (a) => {
        if (a.status !== 'ASSIGNED' || !a.employeeId) return <span className="hi-muted">—</span>
        const name = holder(a)
        return directoryRead
          ? <Link to={`/hrms/employees/${a.employeeId}`} className="hi-link">{name || 'View employee'}</Link>
          : <span>{name || 'An employee'}</span>
      },
    },
    {
      key: 'dates', header: 'Dates', render: (a) => (
        <CellStack primary={<span className="hi-num">{assetDates(a, today)}</span>}
          secondary={[a.status !== 'ASSIGNED' && a.lastHolderName ? `by ${a.lastHolderName}` : null, a.conditionNotes].filter(Boolean).join(' · ') || undefined} />
      ),
    },
    {
      key: 'status', header: 'Status', render: (a) => {
        const s = assetState(a.status)
        return (
          <span className="hi-pills">
            <StatusPill tone={s.tone}>{s.label}</StatusPill>
            {a.openIssue && <StatusPill tone="danger" size="xs" title={a.openIssue.note || undefined}>{problemLabel(a.openIssue.kind)}</StatusPill>}
            {!a.openIssue && a.status === 'ASSIGNED' && a.confirmationPending && <StatusPill tone="warning" size="xs">Not confirmed yet</StatusPill>}
          </span>
        )
      },
    },
    {
      key: 'actions', header: <span className="uk-sr">Actions</span>, label: 'Actions', align: 'right', render: (a) => (
        <CellActions>
          {canWrite && (a.status === 'ASSIGNED'
            ? <Button size={30} variant="secondary" onClick={() => setTaking(a)}>Take back</Button>
            : <Button size={30} variant="soft" onClick={() => setGiving(a)}>Give to</Button>)}
          <Button size={30} variant="secondary" onClick={() => setHistory(a)}>History</Button>
        </CellActions>
      ),
    },
  ]

  if (!assetRead && !instanceWrite) return null
  return (
    <>
      <Section title="Equipment" body="tight" loading={query.isLoading} skeleton="stats" error={query.error} onRetry={() => query.refetch()} retrying={query.isFetching}>
        <MiniStatGrid>
          <MiniStat label="All assets" value={counts.all} note="Registered" tone="neutral" />
          <MiniStat label="With employees" value={counts.with} note="Handed out" tone="success" />
          <MiniStat label="In store" value={counts.store} note="Ready to hand out" tone="info" />
        </MiniStatGrid>
      </Section>
      {issues.data && issues.data.length > 0 && <ProblemReports issues={issues.data} today={today} />}
      <Section title="Assets" body="flush" loading={query.isLoading} skeleton="table" error={query.error} onRetry={() => query.refetch()} retrying={query.isFetching}
        actions={assets.length > 0 ? (
          <SegmentedControl<Filter> label="Filter by status" semantics="toggle" size="sm" value={filter} onChange={setFilter}
            options={[{ value: ALL, label: 'All statuses' }, { value: 'ASSIGNED', label: 'With employee' }, { value: 'STORE', label: 'In store' }]} />
        ) : undefined}
        empty={!query.isLoading && !query.error && assets.length === 0 ? {
          title: 'No assets registered', icon: 'briefcase',
          hint: canWrite ? 'Register laptops, phones and ID cards here, then give them to new hires.' : 'Equipment HR registers appears here.',
        } : undefined}>
        <div className="hi-toolbar">
          <Input type="search" aria-label="Search assets" size="md" fieldClassName="hi-filter__sel" value={search} placeholder="Search tag, name or serial"
            onChange={(e) => setSearch(e.target.value)} />
          <span className="hi-toolbar__count">{rows.length === assets.length ? `${assets.length} ${assets.length === 1 ? 'asset' : 'assets'}` : `${rows.length} of ${assets.length}`}</span>
        </div>
        <Table label="Assets" columns={columns} rows={rows} rowKey={(a) => a.id} mobile="cards"
          empty={<span className="hi-muted">Nothing matches. Clear the search or the status filter.</span>} />
      </Section>
      {registering && <RegisterAssetPanel categories={[...new Set(assets.map((a) => a.assetType).filter(Boolean))].sort()} onClose={onRegisterDone} />}
      {giving && <GiveAssetPanel asset={giving} onClose={() => setGiving(null)} onDone={(name) => { toast.success(`Handed to ${name}`, { detail: giving.assetTag }); setGiving(null) }} />}
      {taking && <TakeBackPanel asset={taking} onClose={() => setTaking(null)} />}
      {history && <AssetHistory assetId={history.id} tag={history.assetTag} onClose={() => setHistory(null)} />}
    </>
  )
}

/** Problems people reported with the equipment they hold (BW-70), for whoever manages assets. */
function ProblemReports({ issues, today }: { issues: AssetIssue[]; today: string }) {
  const [resolving, setResolving] = useState<AssetIssue | null>(null)
  const columns: TableColumn<AssetIssue>[] = [
    { key: 'asset', header: 'Asset', primary: true, width: '24%', render: (i) => <CellStack primary={i.assetTag} secondary={i.assetName} /> },
    { key: 'who', header: 'Reported by', render: (i) => i.employeeName || 'An employee' },
    { key: 'what', header: 'Problem', render: (i) => <CellStack primary={problemLabel(i.kind)} secondary={i.note || undefined} /> },
    { key: 'when', header: 'Reported', render: (i) => <span className="hi-num">{dayMon(istDateOf(i.reportedAt), today)}</span> },
    { key: 'actions', header: <span className="uk-sr">Actions</span>, label: 'Actions', align: 'right', render: (i) => <CellActions><Button size={30} variant="soft" onClick={() => setResolving(i)}>Mark resolved</Button></CellActions> },
  ]
  return (
    <>
      <Section title="Problems reported" count={issues.length} countTone="gold" countLabel={`${issues.length} open`} sub="People told you something is wrong with equipment they have." body="flush">
        <Table label="Problems reported" columns={columns} rows={issues} rowKey={(i) => i.id} mobile="cards" />
      </Section>
      {resolving && <ResolveDialog issue={resolving} onClose={() => setResolving(null)} />}
    </>
  )
}

function ResolveDialog({ issue, onClose }: { issue: AssetIssue; onClose: () => void }) {
  const toast = useToast()
  const resolve = useResolveAssetIssue()
  const [note, setNote] = useState('')
  const submit = async () => {
    try { await resolve.mutateAsync({ id: issue.id, note }); toast.success('Problem resolved', { detail: issue.assetTag }); onClose() }
    catch (e) { toast.error('Couldn’t resolve the problem', { detail: errText(e) }) }
  }
  return (
    <Dialog open onClose={onClose} busy={resolve.isPending} icon="checkCircle" title={`Resolve the problem with ${issue.assetTag}?`}
      sub={`${problemLabel(issue.kind)}${issue.employeeName ? ` by ${issue.employeeName}` : ''}.`}
      footer={<><PanelButton onClick={onClose} disabled={resolve.isPending}>Cancel</PanelButton><PanelButton variant="primary" busy={resolve.isPending} onClick={submit}>Mark resolved</PanelButton></>}>
      <Textarea id="issue-note" label="What was done" rows={3} maxLength={1000} value={note} placeholder="Optional, e.g. replaced the charger" onChange={(e) => setNote(e.target.value)} />
    </Dialog>
  )
}

/** Register an asset in a company's store. Category is free text; the list suggests the ones already used. */
function RegisterAssetPanel({ categories, onClose }: { categories: string[]; onClose: () => void }) {
  const toast = useToast()
  const companies = useCompanies()
  const { create } = useAssetActions()
  const list = companies.data ?? []
  const [form, setForm] = useState({ companyId: list.length === 1 ? list[0].id : '', assetTag: '', assetType: '', assetName: '', serialNo: '', conditionNotes: '' })
  const companyId = form.companyId || (list.length === 1 ? list[0].id : '')
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }))
  const submit = async () => {
    if (!companyId) { toast.error('Choose the company that owns this asset'); return }
    if (!form.assetTag.trim() || !form.assetType.trim() || !form.assetName.trim()) { toast.error('Add the asset tag, category and name'); return }
    try {
      await create.mutateAsync({ companyId, assetTag: form.assetTag.trim(), assetType: form.assetType.trim(), assetName: form.assetName.trim(), serialNo: form.serialNo.trim() || undefined, conditionNotes: form.conditionNotes.trim() || undefined })
      toast.success('Asset registered', { detail: form.assetTag.trim() })
      onClose()
    } catch (e) { toast.error('Couldn’t register the asset', { detail: errText(e) }) }
  }
  return (
    <SidePanel open onClose={onClose} width={560} busy={create.isPending} closeLabel="Close panel" title="Register an asset" sub="Choose the company that owns this asset."
      footer={<><PanelButton size="lg" onClick={onClose} disabled={create.isPending}>Cancel</PanelButton><PanelButton size="lg" variant="primary" busy={create.isPending} onClick={submit}>Register asset</PanelButton></>}>
      <form id="asset-create" onSubmit={(e) => { e.preventDefault(); void submit() }} noValidate>
        <FieldGrid columns={2}>
          <Select id="asset-company" label="Company" required full value={companyId} placeholder="Choose a company" onChange={(e) => set('companyId')(e.target.value)}
            options={list.map((c) => ({ value: c.id, label: c.name }))} error={companies.isError ? 'Couldn’t load companies. Close the panel and try again.' : undefined} />
          <Input id="asset-assetTag" label="Asset tag" required maxLength={80} placeholder="e.g. LAP-0042" value={form.assetTag} onChange={(e) => set('assetTag')(e.target.value)} />
          <Input id="asset-assetType" label="Category" required maxLength={80} placeholder="e.g. Laptop" list="asset-category-options" value={form.assetType} onChange={(e) => set('assetType')(e.target.value)} />
          <Input id="asset-assetName" label="Asset name" required maxLength={200} placeholder="e.g. ThinkPad T14" value={form.assetName} onChange={(e) => set('assetName')(e.target.value)} />
          <Input id="asset-serialNo" label="Serial number" maxLength={120} placeholder="Optional" value={form.serialNo} onChange={(e) => set('serialNo')(e.target.value)} />
          <Textarea id="asset-cond" label="Condition notes" full rows={2} maxLength={4000} placeholder="Optional, e.g. new in box" value={form.conditionNotes} onChange={(e) => set('conditionNotes')(e.target.value)} />
        </FieldGrid>
        <datalist id="asset-category-options">{categories.map((c) => <option key={c} value={c} />)}</datalist>
      </form>
    </SidePanel>
  )
}

/** Hand an asset to someone in its company (dated today; the server refuses future dates). */
function GiveAssetPanel({ asset, onClose, onDone }: { asset: Asset; onClose: () => void; onDone: (name: string) => void }) {
  const toast = useToast()
  const { assign } = useAssetActions()
  const [employee, setEmployee] = useState({ id: '', name: '' })
  const submit = async () => {
    if (!employee.id) return
    try { await assign.mutateAsync({ id: asset.id, employeeId: employee.id }); onDone(employee.name) } catch (e) { toast.error('Couldn’t hand over the asset', { detail: errText(e) }) }
  }
  return (
    <SidePanel open onClose={onClose} width={520} busy={assign.isPending} closeLabel="Close panel" title={`Give ${asset.assetTag} to someone`}
      sub={[asset.assetName, asset.serialNo].filter(Boolean).join(' · ')}
      footer={<><PanelButton size="lg" onClick={onClose} disabled={assign.isPending}>Cancel</PanelButton>
        <PanelButton size="lg" variant="primary" busy={assign.isPending} disabled={!employee.id} onClick={submit}>Confirm assignment</PanelButton></>}>
      <div className="hi-stack">
        {employee.id && <p className="hi-copy">{`Giving it to `}<strong>{employee.name}</strong></p>}
        <PersonSearch companyId={asset.companyId} selectedId={employee.id} onPick={(e) => setEmployee({ id: e.id, name: fullName(e) })} />
      </div>
    </SidePanel>
  )
}

/** Record the asset coming back, with its condition. */
function TakeBackPanel({ asset, onClose }: { asset: Asset; onClose: () => void }) {
  const toast = useToast()
  const { receive } = useAssetActions()
  const [notes, setNotes] = useState('')
  const submit = async () => {
    try { await receive.mutateAsync({ id: asset.id, notes }); toast.success('Return recorded', { detail: asset.assetTag }); onClose() } catch (e) { toast.error('Couldn’t record the return', { detail: errText(e) }) }
  }
  return (
    <SidePanel open onClose={onClose} width={520} busy={receive.isPending} closeLabel="Close panel" title={`Take back ${asset.assetTag}`}
      sub={[asset.assetName, asset.serialNo].filter(Boolean).join(' · ')}
      footer={<><PanelButton size="lg" onClick={onClose} disabled={receive.isPending}>Cancel</PanelButton>
        <PanelButton size="lg" variant="primary" busy={receive.isPending} onClick={submit}>Record return</PanelButton></>}>
      <Textarea id="asset-return" label="Condition on return" rows={3} maxLength={4000} value={notes} placeholder="Optional, e.g. screen scratched" onChange={(e) => setNotes(e.target.value)} />
    </SidePanel>
  )
}
