// Assets view inside Onboarding & assets, on the module kit: register
// equipment, hand it to someone, take it back, see its history.
// Read: hrms.onboarding.asset.read or instance.write; changes: asset.write or
// instance.write. Names link to the employee page only with hrms.employee.read.
import { useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { usePermission } from '@unifiedtree/sdk'
import { HrButton, HrDrawer, HrStatusPill, HrSelect, TableCard, type PillTone } from '@/shared/components/hr'
import { StatRow, State, SubHeading, useDesignToast, dmy } from '@/design/module/ModuleKit'
import { useCompanies } from '../api/useOrg'
import { useEmployeesByIds } from '../api/useWorkforce'
import { PerformanceEmployeePicker as EmployeePicker } from '../performance/PerformanceEmployeePicker'
import { useAssets, useAssetActions, type Asset } from './api/useAssets'
import { AssetHistory } from './AssetHistory'

const label = 'mb-1.5 block text-[13px] font-semibold text-text-secondary'
const STATUS: Record<string, [string, PillTone]> = { AVAILABLE: ['In store', 'green'], ASSIGNED: ['With employee', 'info'], RETURNED: ['Returned', 'gray'] }
const statusOf = (s: string): [string, PillTone] => STATUS[s] ?? [s.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase()), 'gray']
const EMPTY = { companyId: '', assetTag: '', assetType: '', assetName: '', serialNo: '', conditionNotes: '' }
const FIELDS = [
  { key: 'assetTag', label: 'Asset tag', max: 80, required: true, ph: 'e.g. LAP-0042' },
  { key: 'assetType', label: 'Category', max: 80, required: true, ph: 'e.g. Laptop' },
  { key: 'assetName', label: 'Asset name', max: 200, required: true, ph: 'e.g. ThinkPad T14' },
  { key: 'serialNo', label: 'Serial number', max: 120, required: false, ph: 'Optional' },
] as const

export function AssetsTab() {
  const assetRead = usePermission('hrms.onboarding.asset.read')
  const assetWrite = usePermission('hrms.onboarding.asset.write')
  const instanceWrite = usePermission('hrms.onboarding.instance.write')
  const directoryRead = usePermission('hrms.employee.read')
  const canWrite = assetWrite || instanceWrite
  const query = useAssets(assetRead || instanceWrite)
  const companies = useCompanies()
  const employees = useEmployeesByIds(query.data?.flatMap((a) => (a.employeeId ? [a.employeeId] : [])), { enabled: directoryRead })
  const { create, assign, receive } = useAssetActions()
  const { show, node } = useDesignToast()
  const [creating, setCreating] = useState(false)
  const [selected, setSelected] = useState<Asset>()
  const [history, setHistory] = useState<Asset>()
  const [employee, setEmployee] = useState({ id: '', name: '' })
  const [notes, setNotes] = useState('')
  const [form, setForm] = useState({ ...EMPTY })
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('')

  const assets = useMemo(() => query.data ?? [], [query.data])
  const count = (s: string) => assets.filter((a) => a.status === s).length
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return assets.filter((a) => (!filter || (filter === 'STORE' ? a.status !== 'ASSIGNED' : a.status === filter)) && (!q || [a.assetTag, a.assetName, a.assetType, a.serialNo].some((v) => v?.toLowerCase().includes(q))))
  }, [assets, search, filter])

  const openCreate = () => { setForm({ ...EMPTY, companyId: companies.data?.length === 1 ? companies.data[0].id : '' }); setCreating(true) }
  async function save(e: FormEvent) {
    e.preventDefault()
    try { await create.mutateAsync(form); setCreating(false); show('Asset registered') } catch (err) { show('Couldn’t register the asset', true, (err as Error).message) }
  }
  async function act() {
    if (!selected) return
    try {
      if (selected.status === 'ASSIGNED') await receive.mutateAsync({ id: selected.id, notes })
      else await assign.mutateAsync({ id: selected.id, employeeId: employee.id })
      show(selected.status === 'ASSIGNED' ? 'Return recorded' : `Assigned to ${employee.name.trim()}`); setSelected(undefined)
    } catch (err) { show('Couldn’t update the asset', true, (err as Error).message) }
  }
  const nameOf = (a: Asset) => { const p = employees.data?.find((e) => e.id === a.employeeId); return p ? `${p.firstName} ${p.lastName || ''}`.trim() : '' }
  const pick = (s: string) => setFilter((cur) => (cur === s ? '' : s))

  if (!assetRead && !instanceWrite) return <State kind="empty" icon="lock" title="No access to assets" description="Ask an admin if you hand out or track equipment." />
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {query.isLoading ? <State kind="loading" height={96} /> : <StatRow tiles={[
        { icon: 'briefcase', color: 'blue', label: 'All assets', value: String(assets.length), sub: 'Registered', onClick: () => pick('') },
        { icon: 'userCheck', color: 'orange', label: 'With employees', value: String(count('ASSIGNED')), sub: 'Handed out', onClick: () => pick('ASSIGNED') },
        { icon: 'checkCircle', color: 'green', label: 'In store', value: String(count('AVAILABLE') + count('RETURNED')), sub: 'Ready to hand out', onClick: () => pick('STORE') },
      ]} />}

      <SubHeading aside={canWrite ? <HrButton size="sm" onClick={openCreate}><Plus size={14} /> Register asset</HrButton> : undefined}>Equipment</SubHeading>

      {query.isError ? <State kind="error" title="Couldn’t load assets" description={query.error.message} onRetry={() => query.refetch()} />
        : query.isLoading ? <State kind="loading" height={220} />
          : assets.length === 0 ? <State kind="empty" icon="briefcase" title="No assets registered" description={canWrite ? 'Register laptops, phones and ID cards here, then assign them to new hires.' : 'Equipment HR registers appears here.'} />
            : (
              <TableCard search={{ value: search, onChange: setSearch, placeholder: 'Search tag, name or serial' }} actions={<>
                <select aria-label="Filter by status" value={filter} onChange={(e) => setFilter(e.target.value)} className="ut-select ut-select-sm w-auto">
                  <option value="">All statuses</option>
                  <option value="ASSIGNED">With employee</option>
                  <option value="STORE">In store (new or returned)</option>
                </select>
              </>}>
                <div className="overflow-x-auto">
                  <table className="hr-table">
                    <thead><tr><th>Asset</th><th>Category</th><th>With</th><th className="hidden md:table-cell">Dates</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
                    <tbody>
                      {rows.length === 0 && <tr><td colSpan={6} className="!p-0"><State kind="empty" icon="briefcase" title="Nothing matches" description="Clear the search or status filter." /></td></tr>}
                      {rows.map((a) => {
                        const [st, tone] = statusOf(a.status)
                        const who = nameOf(a)
                        return (
                          <tr key={a.id}>
                            <td><strong className="text-[13.5px]">{a.assetTag}</strong><p className="text-[12.5px] text-text-secondary">{a.assetName}{a.serialNo ? ` · ${a.serialNo}` : ''}</p></td>
                            <td className="text-text-secondary">{a.assetType}</td>
                            <td>{a.status !== 'ASSIGNED' || !a.employeeId ? <span className="text-text-tertiary">—</span>
                              : directoryRead ? <Link to={`/hrms/employees/${a.employeeId}`} className="font-semibold text-accent-fg hover:underline">{who || 'View employee'}</Link>
                                : <span className="text-text-secondary">An employee</span>}</td>
                            <td className="hidden md:table-cell text-[12.5px] text-text-secondary">{a.assignedAt ? `Given ${dmy(a.assignedAt)}` : '—'}{a.returnedAt && <><br />Back {dmy(a.returnedAt)}</>}</td>
                            <td><HrStatusPill tone={tone}>{st}</HrStatusPill>{a.conditionNotes && <p className="mt-1 max-w-xs whitespace-normal text-xs text-text-secondary">{a.conditionNotes}</p>}</td>
                            <td>
                              <div className="flex flex-wrap items-center gap-1">
                                {canWrite && <HrButton size="sm" variant="ghost" onClick={() => { setSelected(a); setEmployee({ id: '', name: '' }); setNotes('') }}>{a.status === 'ASSIGNED' ? 'Take back' : 'Assign'}</HrButton>}
                                <HrButton size="sm" variant="ghost" onClick={() => setHistory(a)}>History</HrButton>
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </TableCard>
            )}

      {creating && (
        <HrDrawer title="Register an asset" onClose={() => setCreating(false)}
          footer={<><HrButton variant="ghost" onClick={() => setCreating(false)}>Cancel</HrButton><HrButton type="submit" form="asset-create" disabled={create.isPending}>{create.isPending ? 'Saving…' : 'Register asset'}</HrButton></>}>
          <form id="asset-create" onSubmit={save} className="space-y-4">
            <div><span className={label}>Company</span>
              <HrSelect value={form.companyId} onChange={(v) => setForm({ ...form, companyId: v })} placeholder="Choose a company" options={(companies.data ?? []).map((c) => ({ value: c.id, label: c.name }))} />
              {companies.isError && <p role="alert" className="mt-1 text-xs text-[#b91c1c]">Couldn’t load companies. <button type="button" className="underline" onClick={() => companies.refetch()}>Try again</button></p>}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {FIELDS.map((f) => (
                <div key={f.key}><label className={label} htmlFor={`asset-${f.key}`}>{f.label}</label>
                  <input id={`asset-${f.key}`} className="ut-input" required={f.required} maxLength={f.max} placeholder={f.ph} value={form[f.key]} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} /></div>
              ))}
            </div>
            <div><label className={label} htmlFor="asset-cond">Condition notes</label><textarea id="asset-cond" className="ut-input resize-none" rows={2} maxLength={4000} placeholder="Optional, e.g. new in box" value={form.conditionNotes} onChange={(e) => setForm({ ...form, conditionNotes: e.target.value })} /></div>
            {!form.companyId && <p className="text-xs text-text-secondary">Choose the company that owns this asset.</p>}
          </form>
        </HrDrawer>
      )}

      {selected && (
        <HrDrawer title={selected.status === 'ASSIGNED' ? `Take back ${selected.assetTag}` : `Assign ${selected.assetTag}`} onClose={() => setSelected(undefined)}
          footer={<><HrButton variant="ghost" onClick={() => setSelected(undefined)}>Cancel</HrButton>
            <HrButton disabled={assign.isPending || receive.isPending || (selected.status !== 'ASSIGNED' && !employee.id)} onClick={act}>{selected.status === 'ASSIGNED' ? 'Record return' : 'Confirm assignment'}</HrButton></>}>
          <div className="space-y-4">
            <p className="text-[13px] text-text-secondary">{selected.assetName}{selected.serialNo ? ` · ${selected.serialNo}` : ''}</p>
            {selected.status === 'ASSIGNED'
              ? <div><label className={label} htmlFor="asset-return">Condition on return</label><textarea id="asset-return" className="ut-input resize-none" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional, e.g. screen scratched" /></div>
              : <div><span className={label}>Give it to</span><EmployeePicker companyId={selected.companyId} value={employee.id} selectedLabel={employee.name} onChange={(e) => setEmployee({ id: e.id, name: `${e.firstName} ${e.lastName || ''}` })} /></div>}
          </div>
        </HrDrawer>
      )}

      {history && <AssetHistory assetId={history.id} tag={history.assetTag} onClose={() => setHistory(undefined)} />}
      {node}
    </div>
  )
}
