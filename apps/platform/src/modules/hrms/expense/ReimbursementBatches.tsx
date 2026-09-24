import { useState } from 'react'
import { usePermission } from '@unifiedtree/sdk'
import { Plus, Receipt } from 'lucide-react'
import { HrButton, HrDrawer, HrStatusPill, TableCard, HrAvatar, type PillTone } from '@/shared/components/hr'
import { DataTable } from '@/shared/components/DataTable'
import { HrPagination, useClampedPage } from '@/shared/components/HrPagination'
import { useToast } from '@/shared/hooks/useToast'
import { useCompanies } from '../api/useOrg'
import { useExpenseClaim } from '../api/useExpense'
import { expenseStatusLabel } from './expenseStatus'
import { useBuildExpenseBatch, useExpenseBatch, useExpenseBatches, useExpenseBatchAction, type ExpenseBatch } from '../api/useExpenseBatches'

const tones: Record<string, PillTone> = { DRAFT: 'gray', POSTED: 'info', PAID: 'ok', CANCELLED: 'gray', APPROVED: 'ok', APPROVED_FOR_PAY: 'info', REIMBURSED: 'teal', REJECTED: 'red', SUBMITTED: 'warn' }
// Batch, claim and category enums share one readable mapping with the Expense Center pills.
const label = expenseStatusLabel
const amount = (value: number, currency?: string | null) => {
  try { if (currency) return new Intl.NumberFormat('en-IN', { style: 'currency', currency }).format(value) } catch { /* Keep an unknown currency readable without crashing the batch. */ }
  return `${value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${currency ? ` ${currency}` : ''}`
}
const date = (value?: string) => value ? new Date(value.length === 10 ? value + 'T12:00:00' : value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Not recorded'
function ErrorMessage({ error, retry }: { error: unknown; retry?: () => void }) {
  return <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800"><p>{error instanceof Error ? error.message : 'Unable to complete this request.'}</p>{retry && <HrButton variant="ghost" size="sm" className="mt-2" onClick={retry}>Try again</HrButton>}</div>
}

export function ReimbursementBatches() {
  const canBuild = usePermission('hrms.reimb_batch.build')
  const canPay = usePermission('hrms.reimb_batch.post')
  const companies = useCompanies()
  const [companyId, setCompanyId] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(0)
  const batches = useExpenseBatches(companyId || undefined, status || undefined)
  const [creating, setCreating] = useState(false)
  const [selectedId, setSelectedId] = useState('')
  const total = batches.data?.length ?? 0
  useClampedPage(page, Math.ceil(total / 25), setPage)
  return <div className="space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold">Reimbursement batches</h2><p className="mt-1 text-sm text-text-secondary">Group approved expenses, review the claimants, and record completed payments.</p></div>{canBuild && <HrButton onClick={() => setCreating(true)}><Plus size={16} /> Build batch</HrButton>}</div>
    <div className="flex flex-wrap gap-3"><label className="text-xs font-medium text-text-secondary">Company<select aria-label="Filter company" className="ut-select mt-1" value={companyId} onChange={event => { setCompanyId(event.target.value); setPage(0) }}><option value="">All companies</option>{companies.data?.map(company => <option key={company.id} value={company.id}>{company.name}</option>)}</select></label><label className="text-xs font-medium text-text-secondary">Batch status<select aria-label="Batch status" className="ut-select mt-1" value={status} onChange={event => { setStatus(event.target.value); setPage(0) }}><option value="">All statuses</option>{['DRAFT','POSTED','PAID','CANCELLED'].map(status => <option key={status} value={status}>{label(status)}</option>)}</select></label></div>
    {companies.isError && <ErrorMessage error={companies.error} retry={() => companies.refetch()} />}
    {batches.isError ? <ErrorMessage error={batches.error} retry={() => batches.refetch()} /> : <TableCard footer={<HrPagination page={page} pageSize={25} totalElements={total} totalPages={Math.ceil(total / 25)} onPageChange={setPage} />}><DataTable<ExpenseBatch> data={(batches.data ?? []).slice(page * 25, (page + 1) * 25)} keyField="id" loading={batches.isLoading} emptyMessage="No reimbursement batches match this selection." columns={[
      { key: 'batchReference', header: 'Batch', render: batch => <button className="text-left font-semibold text-[#0F6E56] hover:underline" onClick={() => setSelectedId(batch.id)}>{batch.batchReference}<span className="mt-1 block text-xs font-normal text-text-secondary">{companies.data?.find(company => company.id === batch.companyId)?.name || 'Company expenses'}</span></button> },
      { key: 'cutoffDate', header: 'Approved through', render: batch => <span className="whitespace-nowrap">{date(batch.cutoffDate)}</span> },
      { key: 'claimCount', header: 'Claims' },
      { key: 'totalAmount', header: 'Amount', render: batch => <span className="whitespace-nowrap font-semibold tabular-nums">{amount(batch.totalAmount, batch.currency)}</span> },
      { key: 'status', header: 'Status', render: batch => <HrStatusPill tone={tones[batch.status] || 'gray'}>{label(batch.status)}</HrStatusPill> },
      { key: 'paymentReference', header: 'Payment reference', render: batch => batch.paymentReference || 'Not recorded' },
      { key: 'actions', header: 'Details', render: batch => <HrButton variant="ghost" size="sm" onClick={() => setSelectedId(batch.id)}>View batch</HrButton> },
    ]} /></TableCard>}
    {creating && <BuildBatchDrawer initialCompany={companyId} onClose={() => setCreating(false)} onBuilt={id => { setCreating(false); setSelectedId(id) }} />}
    {selectedId && <BatchDrawer id={selectedId} canBuild={canBuild} canPay={canPay} onClose={() => setSelectedId('')} />}
  </div>
}

function BuildBatchDrawer({ initialCompany, onClose, onBuilt }: { initialCompany: string; onClose: () => void; onBuilt: (id: string) => void }) {
  const companies = useCompanies()
  const build = useBuildExpenseBatch()
  const [company, setCompany] = useState(initialCompany)
  const [cutoffDate, setCutoff] = useState(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()))
  const [notes, setNotes] = useState('')
  const [currency, setCurrency] = useState('INR')
  const [error, setError] = useState('')
  const companyId = company || (companies.data?.length === 1 ? companies.data[0].id : '')
  const submit = async () => {
    if (!companyId || !cutoffDate) { setError('Choose a company and approval cutoff date.'); return }
    if (!/^[A-Z]{3}$/.test(currency.trim())) { setError('Enter the three-letter claim currency, for example INR.'); return }
    setError('')
    try { const result = await build.mutateAsync({ companyId, cutoffDate, currency: currency.trim(), notes: notes.trim() || undefined }); onBuilt(result.batch.id) } catch { /* Inline error. */ }
  }
  return <HrDrawer title="Build reimbursement batch" onClose={() => { if (!build.isPending) onClose() }} footer={<><HrButton variant="ghost" disabled={build.isPending} onClick={onClose}>Cancel</HrButton><HrButton disabled={build.isPending || companies.isLoading || companies.isError} onClick={submit}>{build.isPending ? 'Building...' : 'Build draft batch'}</HrButton></>}><div className="space-y-5"><p className="text-sm text-text-secondary">Includes approved claims through the cutoff date that are not already reserved in another batch. An existing draft for the same company and cutoff is refreshed.</p>{companies.isError ? <ErrorMessage error={companies.error} retry={() => companies.refetch()} /> : <label className="block text-sm font-medium">Company<select aria-label="Company" className="ut-select mt-1" value={companyId} onChange={event => setCompany(event.target.value)}><option value="">Choose company</option>{companies.data?.map(company => <option key={company.id} value={company.id}>{company.name}</option>)}</select></label>}<label className="block text-sm font-medium">Approval cutoff date<input className="ut-input mt-1" type="date" value={cutoffDate} onChange={event => setCutoff(event.target.value)} /></label><label className="block text-sm font-medium">Claim currency<input className="ut-input mt-1 uppercase" maxLength={3} value={currency} onChange={event => setCurrency(event.target.value.toUpperCase())} placeholder="INR" /><span className="mt-1 block text-xs font-normal text-text-secondary">Only approved claims in this currency are included.</span></label><label className="block text-sm font-medium">Batch notes<textarea className="ut-input mt-1" rows={3} value={notes} onChange={event => setNotes(event.target.value)} placeholder="Optional payment run context" /></label>{error && <p role="alert" className="text-sm text-red-700">{error}</p>}{build.isError && <ErrorMessage error={build.error} />}</div></HrDrawer>
}

function BatchDrawer({ id, canBuild, canPay, onClose }: { id: string; canBuild: boolean; canPay: boolean; onClose: () => void }) {
  const query = useExpenseBatch(id)
  const action = useExpenseBatchAction()
  const rebuild = useBuildExpenseBatch()
  const canReadClaim = usePermission('hrms.expense.claim.read')
  const { toast } = useToast()
  const [confirm, setConfirm] = useState<'post' | 'cancel' | 'mark-paid' | null>(null)
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')
  const [validation, setValidation] = useState('')
  const [claimId, setClaimId] = useState('')
  const [itemPage, setItemPage] = useState(0)
  const batch = query.data?.batch
  const items = query.data?.items ?? []
  useClampedPage(itemPage, query.data ? Math.ceil(items.length / 20) : undefined, setItemPage)
  const currencies = [...new Set(items.flatMap(item => item.currency ? [item.currency] : []))]
  const execute = async () => {
    if (!confirm) return
    if (confirm === 'mark-paid' && !reference.trim()) { setValidation('Enter the payment reference or UTR from the completed transfer.'); return }
    setValidation('')
    try { await action.mutateAsync({ id, action: confirm, paymentReference: reference.trim(), notes: notes.trim() || undefined }); toast(confirm === 'mark-paid' ? 'Payment recorded and claims reimbursed' : confirm === 'post' ? 'Batch posted and ready for payment' : 'Batch cancelled and claims released', 'success'); setConfirm(null) } catch { /* Inline error. */ }
  }
  return <HrDrawer title={batch?.batchReference || 'Reimbursement batch'} width="max-w-3xl" onClose={() => { if (!action.isPending) onClose() }}><div className="space-y-5">
    {query.isLoading ? <p role="status">Loading batch and claim details...</p> : query.isError ? <ErrorMessage error={query.error} retry={() => query.refetch()} /> : batch && <>
      <div className="flex items-start justify-between gap-3"><div><p className="text-sm text-text-secondary">Claims approved through {date(batch.cutoffDate)}</p><p className="mt-1 text-xs text-text-secondary">Created {date(batch.createdAt)}</p></div><HrStatusPill tone={tones[batch.status]}>{label(batch.status)}</HrStatusPill></div>
      <div className="flex justify-between gap-4 rounded-lg bg-[#E6F4F1] p-4"><div><p className="text-xs text-text-secondary">Total reimbursement</p><strong className="mt-1 block text-2xl text-[#0A5240]">{amount(batch.totalAmount, batch.currency || (currencies.length === 1 ? currencies[0] : undefined))}</strong></div><div className="text-right"><p className="text-xs text-text-secondary">Claims included</p><strong className="mt-1 block text-2xl text-[#0A5240]">{batch.claimCount}</strong></div></div>
      {batch.notes && <p className="text-sm"><strong>Batch notes: </strong>{batch.notes}</p>}
      {batch.paymentReference && <div className="rounded-lg border border-border-default p-4 text-sm"><p><strong>Payment reference: </strong>{batch.paymentReference}</p><p className="mt-1 text-text-secondary">Payment recorded {date(batch.paidAt)}</p></div>}
      <section><h4 className="mb-3 font-semibold">Employees & claims</h4>{items.length === 0 ? <p className="rounded-lg border border-border-default p-4 text-sm text-text-secondary">No eligible approved claims were found. Approve claims first, then refresh the draft using the same cutoff date.</p> : <div className="space-y-3">{items.slice(itemPage * 20, (itemPage + 1) * 20).map(item => <div key={item.id} className="rounded-lg border border-border-default p-4"><div className="flex flex-wrap justify-between gap-3"><HrAvatar name={item.employeeName || 'Employee'} sub={item.employeeCode || item.employeeId} /><strong className="text-sm tabular-nums">{amount(item.amount, item.currency)}</strong></div><div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border-default pt-3"><div><p className="font-medium">{item.claimTitle}</p>{item.claimNotes && <p className="mt-1 text-sm text-text-secondary">{item.claimNotes}</p>}</div><HrStatusPill tone={tones[item.claimStatus] || 'gray'}>{label(item.claimStatus)}</HrStatusPill></div>{canReadClaim && <HrButton size="sm" variant="ghost" className="mt-3" onClick={() => setClaimId(claimId === item.claimId ? '' : item.claimId)}><Receipt size={14} />{claimId === item.claimId ? 'Hide expense items' : 'View expense items'}</HrButton>}{claimId === item.claimId && <ExpenseItems id={item.claimId} />}</div>)}<HrPagination page={itemPage} pageSize={20} totalElements={items.length} totalPages={Math.ceil(items.length / 20)} onPageChange={setItemPage} /></div>}</section>
      {confirm ? <section className="space-y-3 rounded-lg border border-[#0F6E56]/30 p-4"><h4 className="font-semibold">{confirm === 'post' ? 'Post this batch?' : confirm === 'cancel' ? 'Cancel this batch?' : 'Record completed payment'}</h4><p className="text-sm text-text-secondary">{confirm === 'post' ? 'The included claims will be reserved for payment. Review the employees and amounts above before posting.' : confirm === 'cancel' ? 'This batch will be cancelled and its unpaid claims released for a future reimbursement batch.' : 'Record a transfer already completed through your bank. This action marks all included claims reimbursed.'}</p>{confirm === 'mark-paid' && <><label className="block text-sm font-medium">Payment reference / UTR<input maxLength={120} className="ut-input mt-1" value={reference} onChange={event => setReference(event.target.value)} /></label><label className="block text-sm font-medium">Payment notes<textarea rows={2} className="ut-input mt-1" value={notes} onChange={event => setNotes(event.target.value)} /></label></>}{validation && <p role="alert" className="text-sm text-red-700">{validation}</p>}<div className="flex flex-wrap gap-2"><HrButton disabled={action.isPending} onClick={execute}>{action.isPending ? 'Saving...' : confirm === 'mark-paid' ? 'Confirm payment recorded' : confirm === 'post' ? 'Confirm post batch' : 'Confirm cancel batch'}</HrButton><HrButton variant="ghost" disabled={action.isPending} onClick={() => setConfirm(null)}>Keep reviewing</HrButton></div></section> : <div className="flex flex-wrap gap-2 border-t border-border-default pt-4">{batch.status === 'DRAFT' && canBuild && <><HrButton disabled={batch.claimCount === 0 || rebuild.isPending} onClick={() => setConfirm('post')}>Post batch</HrButton><HrButton variant="ghost" disabled={rebuild.isPending} onClick={async () => { try { await rebuild.mutateAsync({ companyId: batch.companyId, cutoffDate: batch.cutoffDate, notes: batch.notes, currency: batch.currency || undefined }); toast('Draft batch refreshed', 'success') } catch { /* Inline error. */ } }}>{rebuild.isPending ? 'Refreshing...' : 'Refresh draft'}</HrButton></>}{batch.status === 'POSTED' && canPay && <HrButton onClick={() => setConfirm('mark-paid')}>Record payment</HrButton>}{(batch.status === 'DRAFT' || batch.status === 'POSTED') && canPay && <HrButton variant="ghost" disabled={rebuild.isPending} onClick={() => setConfirm('cancel')}>Cancel batch</HrButton>}</div>}
      {action.isError && <ErrorMessage error={action.error} />}{rebuild.isError && <ErrorMessage error={rebuild.error} />}
    </>}
  </div></HrDrawer>
}

function ExpenseItems({ id }: { id: string }) {
  const claim = useExpenseClaim(id)
  return <div className="mt-3 rounded-lg bg-bg-base p-3 text-sm">{claim.isLoading ? <p role="status">Loading expense items...</p> : claim.isError ? <ErrorMessage error={claim.error} retry={() => claim.refetch()} /> : <>{claim.data?.approverComment && <p className="mb-3"><strong>Approval note: </strong>{claim.data.approverComment}</p>}{!claim.data?.items?.length ? <p>No expense line items available.</p> : <ul className="divide-y divide-border-default">{claim.data.items.map((item, index) => <li key={item.id || index} className="py-3 first:pt-0 last:pb-0"><div className="flex justify-between gap-3"><strong>{label(item.category)}</strong><span>{amount(item.amount, claim.data?.currency)}</span></div><p className="mt-1 text-text-secondary">{date(item.expenseDate)}{item.merchantName ? ` · ${item.merchantName}` : ''}</p>{item.description && <p className="mt-1">{item.description}</p>}{item.receiptUrl && /^https?:\/\//i.test(item.receiptUrl) && <a className="mt-2 inline-block text-[#0F6E56] underline" href={item.receiptUrl} target="_blank" rel="noopener noreferrer">View receipt</a>}</li>)}</ul>}</>}</div>
}
