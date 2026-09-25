import { useEffect, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Plus, Trash2 } from 'lucide-react'
import { P, usePermission } from '@unifiedtree/sdk'
import { useToast } from '@/shared/hooks/useToast'
import { useCurrentUser } from '@/shared/hooks/useCurrentUser'
import { HrAvatar, HrButton, HrDrawer, HrStatusPill, TableCard, type PillTone } from '@/shared/components/hr'
import { ModulePage, Views, StatRow, State, Panel, Note, Facts } from '@/design/module/ModuleKit'
import { DataTable } from '@/shared/components/DataTable'
import { HrPagination, useClampedPage } from '@/shared/components/HrPagination'
import { useCompanies } from './api/useOrg'
import { useEmployeeDirectory, useWorkforceEmployee, type WorkforceEmployee } from './api/useWorkforce'
import { FNF_PAGE_SIZE, inr, useApproveSettlement, useCancelSettlement, useFnfSettlement, useFnfSettlements, usePaySettlement, useProcessSettlement, type FnfComponentType, type FnfSettlement, type FnfStatus } from './api/useFnf'

const tones: Record<FnfStatus, PillTone> = { INITIATED: 'gray', PROCESSED: 'warn', APPROVED: 'ok', PAID: 'teal', CANCELLED: 'gray' }
const date = (value?: string) => value ? new Date(value.length === 10 ? value + 'T12:00:00' : value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Not recorded'
const label = (value: string) => value.toLowerCase().replaceAll('_', ' ')
function Failure({ error, retry }: { error: unknown; retry?: () => void }) {
  return <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800"><p>{error instanceof Error ? error.message : 'Unable to load settlement information.'}</p>{retry && <HrButton size="sm" variant="ghost" className="mt-2" onClick={retry}>Try again</HrButton>}</div>
}

// Lifecycle tabs over the settlements ledger. `status: null` is the unfiltered "All" view.
type LedgerTab = 'pending-approval' | 'pending-payment' | 'settled' | 'all'
const LEDGER_TABS: { key: LedgerTab; label: string; status: FnfStatus | null; empty: string }[] = [
  { key: 'pending-approval', label: 'Pending approval', status: 'PROCESSED', empty: 'No settlements are waiting for approval' },
  { key: 'pending-payment', label: 'Pending payment', status: 'APPROVED', empty: 'No approved settlements are waiting for payment' },
  { key: 'settled', label: 'Settled', status: 'PAID', empty: 'No settlements have been paid yet' },
  { key: 'all', label: 'All', status: null, empty: '' },
]
const isLedgerTab = (key: string | null): key is LedgerTab => LEDGER_TABS.some(item => item.key === key)

export function FullAndFinal() {
  const canRead = usePermission('hrms.fnf.read')
  const canProcess = usePermission('hrms.fnf.process')
  const canApprove = usePermission('hrms.fnf.approve'), canPay = usePermission('hrms.fnf.pay')
  const first: LedgerTab = canPay && !canApprove ? 'pending-payment' : 'pending-approval'
  // The tab lives in the URL so the Exit page can deep-link into ?tab=create&employeeId=…
  // ("settlements" is the old single-list tab key and still lands on All).
  const [params, setParams] = useSearchParams()
  const requested = params.get('tab') === 'settlements' ? 'all' : params.get('tab')
  const tab = requested === 'create' && canProcess ? 'create' : isLedgerTab(requested) && canRead ? requested : canRead ? first : 'create'
  const setTab = (key: string) => setParams(current => { const next = new URLSearchParams(current); next.set('tab', key); if (key !== 'create') next.delete('employeeId'); return next }, { replace: true })
  const [selectedId, setSelectedId] = useState('')
  const create = canProcess ? <CreateSettlement initialEmployeeId={params.get('employeeId') || undefined} onCreated={id => { if (canRead) { setTab('pending-approval'); setSelectedId(id) } }} /> : null
  return <ModulePage crumb="Employee exit" title="Full & final settlements" subtitle="Review a leaver's earnings and deductions, approve their settlement, and record completed payment."
    actions={canProcess && tab !== 'create' ? <HrButton onClick={() => setTab('create')}><Plus size={15} /> Create settlement</HrButton> : undefined}>
    <div style={{ display: 'grid', gap: 16, minWidth: 0 }}>
      {canRead ? <Settlements tab={tab} onTab={setTab} canProcess={canProcess} create={create} onOpen={setSelectedId} />
        : canProcess ? create
        : <State kind="empty" icon="lock" title="No access to settlements" description="Ask an admin if you need to prepare or approve full & final settlements." />}
    </div>
    {selectedId && canRead && <SettlementDrawer id={selectedId} onClose={() => setSelectedId('')} />}
  </ModulePage>
}

function Settlements({ tab, onTab, canProcess, create, onOpen }: { tab: string; onTab: (key: string) => void; canProcess: boolean; create: ReactNode; onOpen: (id: string) => void }) {
  const [page, setPage] = useState(0)
  const query = useFnfSettlements(page)
  useClampedPage(page, query.data?.totalPages, setPage)
  const pageRows = query.data?.content ?? []
  // GET /v1/fnf/settlements takes no status parameter (FnfController#list passes only
  // the Pageable, although FnfService#getByStatus exists), so each lifecycle tab filters
  // the page already fetched. The pager still walks the server's full ledger; when the
  // ledger spans more than one page the tab counts are hidden and a note says the tab
  // covers this page only, so a filtered page is never presented as the whole ledger.
  const singlePage = (query.data?.totalPages ?? 0) <= 1
  const ledgerTab = LEDGER_TABS.find(item => item.key === tab)
  const rows = ledgerTab?.status ? pageRows.filter(row => row.status === ledgerTab.status) : pageRows
  const tabs = [...LEDGER_TABS.map(item => ({ key: item.key, label: item.label, count: query.data && singlePage ? (item.status ? pageRows.filter(row => row.status === item.status).length : query.data.totalElements) || undefined : undefined, urgent: item.key !== 'all' && item.key !== 'settled' })), ...(canProcess ? [{ key: 'create', label: 'Create settlement', icon: 'plus' }] : [])]
  const paid = pageRows.filter(row => row.status === 'PAID').reduce((sum, row) => sum + row.netSettlement, 0)
  const empty = !query.data?.totalElements || !ledgerTab?.status ? 'No settlements yet. Create a settlement after recording the employee\'s exit.' : singlePage ? `${ledgerTab.empty}.` : `${ledgerTab.empty} on this page.`
  return <><Views items={tabs} active={tab} onChange={onTab} label="Settlement views" />
    {tab === 'create' ? create : query.isError ? <State kind="error" title="Couldn’t load settlements" description={query.error instanceof Error ? query.error.message : undefined} onRetry={() => query.refetch()} /> : <div style={{ display: 'grid', gap: 16 }}>{query.isLoading ? <State kind="loading" height={96} /> : <StatRow tiles={[
    { icon: 'fileText', color: 'blue', label: 'Settlements', value: String(query.data?.totalElements ?? 0), sub: 'In the ledger' },
    { icon: 'clock', color: 'orange', label: 'Waiting for approval', value: String(pageRows.filter(row => row.status === 'PROCESSED').length), sub: 'On this page', onClick: () => onTab('pending-approval') },
    { icon: 'checkCircle', color: 'green', label: 'Approved, to be paid', value: String(pageRows.filter(row => row.status === 'APPROVED').length), sub: 'On this page', onClick: () => onTab('pending-payment') },
    { icon: 'creditCard', color: 'teal', label: 'Payment recorded', value: inr(paid), sub: 'On this page', onClick: () => onTab('settled') },
  ]} />}{ledgerTab?.status && !singlePage && <Note>Showing {rows.length} of the {pageRows.length} settlements on this page. Use the pager for older settlements.</Note>}<TableCard footer={<HrPagination page={page} pageSize={FNF_PAGE_SIZE} totalElements={query.data?.totalElements ?? 0} totalPages={query.data?.totalPages ?? 0} onPageChange={setPage} />}><DataTable<FnfSettlement> data={rows} keyField="id" loading={query.isLoading} emptyMessage={empty} columns={[
    { key: 'employeeName', header: 'Employee', render: row => <HrAvatar name={row.employeeName || 'Employee record unavailable'} sub={row.employeeCode} /> },
    { key: 'lastWorkingDay', header: 'Last working day', render: row => date(row.lastWorkingDay) },
    { key: 'netSettlement', header: 'Net settlement', render: row => <span className="whitespace-nowrap font-semibold tabular-nums">{inr(row.netSettlement)}</span> },
    { key: 'status', header: 'Status', render: row => <HrStatusPill tone={tones[row.status]}>{label(row.status)}</HrStatusPill> },
    { key: 'actions', header: 'Details', render: row => <HrButton variant="ghost" size="sm" onClick={() => onOpen(row.id)}>Review settlement</HrButton> },
  ]} /></TableCard></div>}
  </>
}

function SettlementDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const query = useFnfSettlement(id)
  const approve = useApproveSettlement()
  const pay = usePaySettlement()
  const cancel = useCancelSettlement()
  const canApprove = usePermission('hrms.fnf.approve')
  const canPay = usePermission('hrms.fnf.pay')
  const canProcess = usePermission('hrms.fnf.process')
  const current = useCurrentUser()
  const { toast } = useToast()
  const [confirm, setConfirm] = useState<'approve' | 'pay' | 'cancel' | null>(null)
  const settlement = query.data
  const actor = current.data?.employeeId || current.data?.id
  const ownSettlement = !!actor && actor === settlement?.employeeId
  const approvedByMe = !!actor && actor === settlement?.approverId
  const pending = approve.isPending || pay.isPending || cancel.isPending
  const mutation = confirm === 'approve' ? approve : confirm === 'pay' ? pay : cancel
  const choose = (action: 'approve' | 'pay' | 'cancel') => { approve.reset(); pay.reset(); cancel.reset(); setConfirm(action) }
  const execute = async () => {
    if (!confirm) return
    try { await mutation.mutateAsync(id); toast(confirm === 'approve' ? 'Settlement approved' : confirm === 'pay' ? 'Completed payment recorded' : 'Settlement cancelled', 'success'); setConfirm(null) } catch { /* Show the backend reason beside the confirmation. */ }
  }
  return <HrDrawer title="Settlement details" width="max-w-2xl" onClose={() => { if (!pending) onClose() }}><div className="space-y-5">
    {query.isLoading ? <p role="status">Loading settlement...</p> : query.isError ? <Failure error={query.error} retry={() => query.refetch()} /> : settlement && <>
      <div className="flex flex-wrap items-start justify-between gap-3"><HrAvatar name={settlement.employeeName || 'Employee record unavailable'} sub={settlement.employeeCode} /><HrStatusPill tone={tones[settlement.status]}>{label(settlement.status)}</HrStatusPill></div>
      <p className="text-sm text-text-secondary">Last working day: <strong className="text-text-primary">{date(settlement.lastWorkingDay)}</strong></p>
      <Facts min={140} items={[{ k: 'Earnings', v: inr(settlement.grossPayable) }, { k: 'Deductions', v: inr(settlement.totalDeductions) }, { k: 'Net payable', v: <span style={{ color: '#0f6e56' }}>{inr(settlement.netSettlement)}</span> }]} />
      <section><h3 className="mb-3 font-semibold">Settlement components</h3><div className="overflow-x-auto rounded-lg border border-border-default"><table className="hr-table"><thead><tr><th>Component</th><th>Type</th><th className="text-right">Amount</th></tr></thead><tbody>{settlement.components?.map((component, index) => <tr key={component.id || index}><td>{component.label}</td><td>{label(component.type)}</td><td className="text-right tabular-nums">{inr(component.amount)}</td></tr>)}</tbody></table></div></section>
      {settlement.notes && <p className="whitespace-pre-wrap rounded-lg border border-border-default p-3 text-sm"><strong>Notes: </strong>{settlement.notes}</p>}
      <dl className="grid grid-cols-2 gap-3 text-sm">{[['Processed', settlement.processedAt], ['Approved', settlement.approvedAt], ['Payment recorded', settlement.paidAt]].filter(([, value]) => value).map(([name, value]) => <div key={name}><dt className="text-xs text-text-secondary">{name}</dt><dd className="mt-1">{date(value)}</dd></div>)}</dl>
      {current.isError && <Failure error={current.error} retry={() => current.refetch()} />}
      {(ownSettlement || approvedByMe) && (settlement.status === 'PROCESSED' || settlement.status === 'APPROVED') && <p className="rounded-lg bg-bg-base p-3 text-sm text-text-secondary">{ownSettlement ? 'Another authorized colleague must approve and record payment for your own settlement.' : 'Another authorized colleague must record payment because you approved this settlement.'}</p>}
      {confirm ? <section className="space-y-3 rounded-lg border border-[#0F6E56]/30 p-4"><h3 className="font-semibold">{confirm === 'approve' ? 'Approve this settlement?' : confirm === 'pay' ? 'Record completed payment?' : 'Cancel this settlement?'}</h3><p className="text-sm text-text-secondary">{confirm === 'approve' ? 'Confirm the earnings, deductions and employee details above. Included advance recovery is applied on approval.' : confirm === 'pay' ? `Record that ${inr(settlement.netSettlement)} has already been paid to the employee. This records payment; it does not send a bank transfer.` : 'Cancel this unapproved settlement to prepare a corrected one. Approved and paid settlements cannot be cancelled.'}</p><div className="flex flex-wrap gap-2"><HrButton disabled={pending || current.isLoading} onClick={execute}>{pending ? 'Saving...' : confirm === 'approve' ? 'Confirm approval' : confirm === 'pay' ? 'Confirm payment recorded' : 'Confirm cancellation'}</HrButton><HrButton variant="ghost" disabled={pending} onClick={() => setConfirm(null)}>Keep reviewing</HrButton></div>{mutation.isError && <Failure error={mutation.error} />}</section> : <div className="flex flex-wrap gap-2 border-t border-border-default pt-4">
        {settlement.status === 'PROCESSED' && canApprove && <HrButton disabled={!actor || ownSettlement} onClick={() => choose('approve')}>Approve settlement</HrButton>}
        {settlement.status === 'APPROVED' && canPay && <HrButton disabled={!actor || ownSettlement || approvedByMe} onClick={() => choose('pay')}>Record payment</HrButton>}
        {(settlement.status === 'INITIATED' || settlement.status === 'PROCESSED') && canProcess && <HrButton variant="ghost" onClick={() => choose('cancel')}>Cancel settlement</HrButton>}
      </div>}
    </>}
  </div></HrDrawer>
}

type DraftComponent = { label: string; type: FnfComponentType; amount: string }
const isSeparated = (item: WorkforceEmployee) => item.employmentStatus === 'EXITED' || item.employmentStatus === 'TERMINATED'
function CreateSettlement({ initialEmployeeId, onCreated }: { initialEmployeeId?: string; onCreated: (id: string) => void }) {
  const companies = useCompanies()
  const [companyId, setCompanyId] = useState('')
  const [status, setStatus] = useState<'EXITED' | 'TERMINATED'>('EXITED')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const canReadEmployee = usePermission(P.HRMS_EMPLOYEE_READ)
  const employees = useEmployeeDirectory({ companyId: companyId || undefined, status, search: search.trim() || undefined, page, pageSize: 10 }, { enabled: canReadEmployee })
  const [employee, setEmployee] = useState<WorkforceEmployee | null>(null)
  // ?employeeId= (the Exit page's F&F hand-off) preselects that leaver once, and narrows
  // the picker to their exit status and code so the selection is visible in the list.
  const linked = useWorkforceEmployee(canReadEmployee ? initialEmployeeId : undefined)
  const [appliedId, setAppliedId] = useState('')
  useEffect(() => {
    const item = linked.data
    if (!item || appliedId === item.id) return
    setAppliedId(item.id)
    if (!isSeparated(item)) return
    setEmployee(item); setStatus(item.employmentStatus as 'EXITED' | 'TERMINATED'); setCompanyId(''); setSearch(item.employeeCode || ''); setPage(0)
  }, [linked.data, appliedId])
  const [components, setComponents] = useState<DraftComponent[]>([{ label: '', type: 'EARNING', amount: '' }])
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')
  const [reviewing, setReviewing] = useState(false)
  const process = useProcessSettlement()
  const { toast } = useToast()
  const gross = components.filter(item => item.type === 'EARNING').reduce((sum, item) => sum + (Number(item.amount) || 0), 0)
  const deductions = components.filter(item => item.type === 'DEDUCTION').reduce((sum, item) => sum + (Number(item.amount) || 0), 0)
  const patch = (index: number, value: Partial<DraftComponent>) => { setComponents(rows => rows.map((item, i) => i === index ? { ...item, ...value } : item)); setReviewing(false) }
  const validate = () => {
    if (!employee) return 'Choose the employee whose exit is recorded.'
    if (!employee.lastWorkingDay) return 'Record the employee\'s last working day in their exit record before creating a settlement.'
    if (!components.length || components.some(item => !item.label.trim() || !item.amount.trim() || !Number.isFinite(Number(item.amount)) || Number(item.amount) < 0)) return 'Complete every component with a label and a valid non-negative amount, or remove the incomplete row.'
    if (deductions > gross) return 'Deductions cannot exceed earnings. Resolve any remaining recovery before settlement.'
    return ''
  }
  const submit = async () => {
    const message = validate(); setError(message); if (message || !employee?.lastWorkingDay) return
    try { const result = await process.mutateAsync({ employeeId: employee.id, companyId: employee.companyId, lastWorkingDay: employee.lastWorkingDay, notes: notes.trim() || undefined, components: components.map(item => ({ label: item.label.trim(), type: item.type, amount: Number(item.amount) })) }); toast('Settlement processed and ready for approval', 'success'); onCreated(result.id); setReviewing(false); setEmployee(null); setComponents([{ label: '', type: 'EARNING', amount: '' }]); setNotes('') } catch { /* The server checks current debt and duplicate settlements. */ }
  }
  return <div style={{ display: 'grid', gap: 16, maxWidth: 900 }}>
    <Panel title="Choose a separated employee" sub="Record the employee's exit first. The settlement uses the last working day saved in their employee record.">
      <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm font-medium">Company<select className="ut-select mt-1" value={companyId} onChange={event => { setCompanyId(event.target.value); setPage(0) }}><option value="">All companies</option>{companies.data?.map(company => <option key={company.id} value={company.id}>{company.name}</option>)}</select></label><label className="text-sm font-medium">Exit status<select className="ut-select mt-1" value={status} onChange={event => { setStatus(event.target.value as 'EXITED' | 'TERMINATED'); setPage(0) }}><option value="EXITED">Exited</option><option value="TERMINATED">Terminated</option></select></label></div>
      {companies.isError && <Failure error={companies.error} retry={() => companies.refetch()} />}
      <label className="block text-sm font-medium">Find employee<input type="search" className="ut-input mt-1" placeholder="Search name, code or email" value={search} onChange={event => { setSearch(event.target.value); setPage(0) }} /></label>
      {linked.isError && <Failure error={linked.error} retry={() => linked.refetch()} />}
      {linked.data && !isSeparated(linked.data) && <p role="status" className="rounded-lg border border-border-default p-3 text-sm text-text-secondary">{linked.data.firstName} {linked.data.lastName} ({linked.data.employeeCode}) is not marked as exited or terminated yet. Record their exit on the Resignation & exit page before creating a settlement.</p>}
      {!canReadEmployee ? <p className="text-sm text-text-secondary">Employee directory access is required to choose a leaver.</p> : employees.isError ? <Failure error={employees.error} retry={() => employees.refetch()} /> : <><div className="max-h-64 overflow-y-auto rounded-lg border border-border-default" aria-busy={employees.isFetching}>{employees.isLoading ? <p role="status" className="p-3 text-sm">Loading employees...</p> : !employees.data?.content.length ? <p className="p-3 text-sm text-text-secondary">No separated employees match this selection.</p> : employees.data.content.map(item => <button type="button" key={item.id} aria-pressed={employee?.id === item.id} onClick={() => { setEmployee(item); setReviewing(false) }} className={`block w-full border-b border-border-default p-3 text-left last:border-0 hover:bg-[#E6F4F1] ${employee?.id === item.id ? 'bg-[#E6F4F1]' : ''}`}><span className="block text-sm font-semibold">{item.firstName} {item.lastName}</span><span className="text-xs text-text-secondary">{item.employeeCode} - Last working day {date(item.lastWorkingDay)}</span></button>)}</div><HrPagination page={page} pageSize={10} totalElements={employees.data?.totalElements ?? 0} totalPages={employees.data?.totalPages ?? 0} onPageChange={setPage} /></>}
      {employee && <Note tone="green"><strong>Selected: {employee.firstName} {employee.lastName} ({employee.employeeCode})</strong> · last working day {date(employee.lastWorkingDay)}</Note>}
    </Panel>
    <Panel title="Earnings & deductions" sub="Include salary dues, leave encashment and other agreed amounts. Outstanding advances need an Advance Recovery deduction matching the current balance.">{components.map((component, index) => <div key={index} className="ut-card space-y-3 p-4"><div className="flex justify-between"><h3 className="text-sm font-semibold">Component {index + 1}</h3>{components.length > 1 && <button type="button" aria-label={`Remove component ${index + 1}`} className="rounded p-1 text-text-secondary hover:bg-red-50 hover:text-red-700" onClick={() => { setComponents(rows => rows.filter((_, i) => i !== index)); setReviewing(false) }}><Trash2 size={15} /></button>}</div><div className="grid gap-3 sm:grid-cols-3"><label className="text-sm font-medium">Component label<input aria-label={`Component ${index + 1} label`} maxLength={200} className="ut-input mt-1" value={component.label} onChange={event => patch(index, { label: event.target.value })} placeholder="e.g. Salary dues" /></label><label className="text-sm font-medium">Type<select aria-label={`Component ${index + 1} type`} className="ut-select mt-1" value={component.type} onChange={event => patch(index, { type: event.target.value as FnfComponentType })}><option value="EARNING">Earning</option><option value="DEDUCTION">Deduction</option></select></label><label className="text-sm font-medium">Amount (INR)<input aria-label={`Component ${index + 1} amount`} type="number" min={0} step="0.01" className="ut-input mt-1" value={component.amount} onChange={event => patch(index, { amount: event.target.value })} /></label></div></div>)}<div className="flex flex-wrap gap-2"><HrButton variant="ghost" onClick={() => { setComponents(rows => [...rows, { label: '', type: 'EARNING', amount: '' }]); setReviewing(false) }}><Plus size={15} />Add earning</HrButton><HrButton variant="ghost" onClick={() => { setComponents(rows => [...rows, { label: '', type: 'DEDUCTION', amount: '' }]); setReviewing(false) }}><Plus size={15} />Add deduction</HrButton></div></Panel>
    <label className="block text-sm font-medium">Settlement notes<textarea className="ut-input mt-1" rows={3} value={notes} onChange={event => { setNotes(event.target.value); setReviewing(false) }} placeholder="Context for the approver" /></label>
    <div className="space-y-4 rounded-lg bg-[#E6F4F1] p-5"><div className="grid grid-cols-3 gap-3">{[['Earnings', gross], ['Deductions', deductions], ['Net payable', gross - deductions]].map(([name, value]) => <div key={name}><p className="text-xs text-text-secondary">{name}</p><p className="mt-1 text-lg font-semibold text-[#0A5240]">{inr(Number(value))}</p></div>)}</div>{reviewing ? <><p className="text-sm">Confirm these components and the selected employee's exit date. This creates a settlement awaiting approval.</p><div className="flex flex-wrap gap-2"><HrButton disabled={process.isPending} onClick={submit}>{process.isPending ? 'Processing...' : 'Confirm process settlement'}</HrButton><HrButton variant="ghost" disabled={process.isPending} onClick={() => setReviewing(false)}>Keep editing</HrButton></div></> : <HrButton onClick={() => { const message = validate(); setError(message); if (!message) { process.reset(); setReviewing(true) } }}>Review settlement</HrButton>}</div>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}{process.isError && <Failure error={process.error} />}
  </div>
}
