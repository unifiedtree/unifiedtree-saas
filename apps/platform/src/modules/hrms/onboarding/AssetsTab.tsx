import { useState, type FormEvent } from 'react'
import { AssetHistory } from './AssetHistory'
import { Link } from 'react-router-dom'
import { usePermission } from '@unifiedtree/sdk'
import { HrButton, HrStatusPill, TableCard } from '@/shared/components/hr'
import { useToast } from '@/shared/hooks/useToast'
import { useCompanies } from '../api/useOrg'
import { useEmployeesByIds } from '../api/useWorkforce'
import { PerformanceEmployeePicker as EmployeePicker } from '../performance/PerformanceEmployeePicker'
import { useAssets, useAssetActions, type Asset } from './api/useAssets'

export function AssetsTab() {
  const assetRead = usePermission('hrms.onboarding.asset.read')
  const assetWrite = usePermission('hrms.onboarding.asset.write')
  const instanceWrite = usePermission('hrms.onboarding.instance.write')
  const directoryRead = usePermission('hrms.employee.read')
  const canWrite = assetWrite || instanceWrite
  const query = useAssets(assetRead || instanceWrite)
  const companies = useCompanies()
  const employees = useEmployeesByIds(query.data?.flatMap(a => a.employeeId ? [a.employeeId] : []), { enabled: directoryRead })
  const { create, assign, receive } = useAssetActions()
  const { toast } = useToast()
  const [creating, setCreating] = useState(false)
  const [selected, setSelected] = useState<Asset>()
  const [history, setHistory] = useState<Asset>()
  const [employee, setEmployee] = useState({ id: '', name: '' })
  const [notes, setNotes] = useState('')
  const [form, setForm] = useState({ companyId: '', assetTag: '', assetType: '', assetName: '', serialNo: '', conditionNotes: '' })
  async function save(e: FormEvent) {
    e.preventDefault()
    try { await create.mutateAsync(form); setCreating(false); setForm({ companyId: '', assetTag: '', assetType: '', assetName: '', serialNo: '', conditionNotes: '' }); toast('Asset registered', 'success') }
    catch (error) { toast((error as Error).message, 'error') }
  }
  async function act() {
    if (!selected) return
    try {
      if (selected.status === 'ASSIGNED') await receive.mutateAsync({ id: selected.id, notes })
      else await assign.mutateAsync({ id: selected.id, employeeId: employee.id })
      setSelected(undefined); toast('Asset updated', 'success')
    } catch (error) { toast((error as Error).message, 'error') }
  }
  if (!assetRead && !instanceWrite) return <p className="ut-card p-5">You do not have access to asset records.</p>
  return <div className="space-y-4">
    <div className="flex items-center justify-between gap-3"><p className="text-sm text-text-secondary">Register equipment, assign it to employees and record returns.</p>{canWrite && <HrButton onClick={() => setCreating(!creating)}>{creating ? 'Cancel' : 'Register asset'}</HrButton>}</div>
    {creating && <form className="ut-card grid gap-4 p-5 sm:grid-cols-2" onSubmit={save}>
      <label>Company<select aria-label="Asset company" required className="ut-select" value={form.companyId} onChange={e => setForm({ ...form, companyId: e.target.value })}><option value="">Select company</option>{companies.data?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      {(['assetTag', 'assetType', 'assetName', 'serialNo', 'conditionNotes'] as const).map(field => <label key={field}>{({ assetTag: 'Asset tag', assetType: 'Category', assetName: 'Asset name', serialNo: 'Serial number', conditionNotes: 'Condition notes' })[field]}<input className="ut-input" required={['assetTag', 'assetType', 'assetName'].includes(field)} maxLength={field === 'assetTag' || field === 'assetType' ? 80 : field === 'assetName' ? 200 : field === 'serialNo' ? 120 : 4000} value={form[field]} onChange={e => setForm({ ...form, [field]: e.target.value })} /></label>)}
      {companies.isError && <p role="alert">Unable to load companies. <button type="button" onClick={() => companies.refetch()}>Retry</button></p>}
      <div><HrButton type="submit" disabled={create.isPending}>{create.isPending ? 'Saving...' : 'Save asset'}</HrButton></div>
    </form>}
    {selected && <section className="ut-card space-y-3 p-5" aria-label="Asset action"><div className="flex justify-between"><h3 className="font-semibold">{selected.status === 'ASSIGNED' ? 'Receive return' : 'Assign asset'}: {selected.assetTag}</h3><HrButton variant="ghost" onClick={() => setSelected(undefined)}>Cancel</HrButton></div>
      {selected.status === 'ASSIGNED' ? <label>Condition on return<textarea className="ut-input" value={notes} onChange={e => setNotes(e.target.value)} /></label> : <EmployeePicker companyId={selected.companyId} value={employee.id} selectedLabel={employee.name} onChange={e => setEmployee({ id: e.id, name: `${e.firstName} ${e.lastName || ''}` })} />}
      <HrButton disabled={assign.isPending || receive.isPending || (selected.status !== 'ASSIGNED' && !employee.id)} onClick={act}>{selected.status === 'ASSIGNED' ? 'Record return' : 'Confirm assignment'}</HrButton>
    </section>}
    {query.isError ? <div role="alert" className="ut-card p-5"><p>{query.error.message}</p><HrButton onClick={() => query.refetch()}>Retry</HrButton></div> : <TableCard><div className="overflow-x-auto"><table className="hr-table"><thead><tr><th>Asset</th><th>Category</th><th>Employee</th><th>Dates</th><th>Status</th><th>Action</th></tr></thead><tbody>
      {query.isLoading ? <tr><td colSpan={6}>Loading assets...</td></tr> : !query.data?.length ? <tr><td colSpan={6}>No assets registered.</td></tr> : query.data.map(a => {
        const person = employees.data?.find(e => e.id === a.employeeId)
        return <tr key={a.id}><td><strong>{a.assetTag}</strong><p>{a.assetName}</p><p className="text-xs">{a.serialNo}</p></td><td>{a.assetType}</td><td>{a.employeeId ? directoryRead ? <Link to={`/hrms/employees/${a.employeeId}`}>{person ? `${person.firstName} ${person.lastName || ''}` : 'View employee'}</Link> : 'Assigned employee' : 'Unassigned'}</td><td><p>{a.assignedAt ? `Assigned: ${a.assignedAt}` : '-'}</p>{a.returnedAt && <p>Returned: {a.returnedAt}</p>}</td><td><HrStatusPill tone={a.status === 'ASSIGNED' ? 'info' : 'green'}>{a.status}</HrStatusPill><p className="max-w-xs whitespace-normal text-xs">{a.conditionNotes}</p></td><td>{canWrite && <HrButton variant="ghost" onClick={() => { setSelected(a); setEmployee({ id: '', name: '' }); setNotes('') }}>{a.status === 'ASSIGNED' ? 'Receive return' : 'Assign'}</HrButton>}<HrButton variant="ghost" onClick={() => setHistory(a)}>History</HrButton></td></tr>
      })}</tbody></table></div></TableCard>}
    {history && <AssetHistory assetId={history.id} tag={history.assetTag} onClose={() => setHistory(undefined)} />}
  </div>
}
