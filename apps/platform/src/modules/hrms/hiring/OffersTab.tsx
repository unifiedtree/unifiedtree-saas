import { useState, type FormEvent } from 'react'
import { usePermission } from '@unifiedtree/sdk'
import { HrButton, HrStatusPill, TableCard } from '@/shared/components/hr'
import { HrPagination } from '@/shared/components/HrPagination'
import { useToast } from '@/shared/hooks/useToast'
import { useCompanies } from '../api/useOrg'
import { useHiringOffers, useCreateHiringOffer, useUpdateHiringOfferStatus, inr, type OfferStatus } from '../api/useHiring'

const nextStatuses: Record<OfferStatus, OfferStatus[]> = {
  DRAFT: ['SENT', 'WITHDRAWN'], SENT: ['ACCEPTED', 'DECLINED', 'WITHDRAWN'],
  ACCEPTED: [], DECLINED: [], WITHDRAWN: [],
}
export function OffersTab() {
  const offerWrite = usePermission('hrms.hiring.offer.write')
  const hiringWrite = usePermission('hrms.hiring.write')
  const canWrite = offerWrite || hiringWrite
  const [page, setPage] = useState(0)
  const [creating, setCreating] = useState(false)
  const query = useHiringOffers(page)
  const companies = useCompanies()
  const create = useCreateHiringOffer()
  const update = useUpdateHiringOfferStatus()
  const { toast } = useToast()
  const [form, setForm] = useState({ companyId: '', candidateName: '', roleTitle: '', offeredCtc: '', joiningDate: '', notes: '' })
  async function save(event: FormEvent) {
    event.preventDefault()
    try {
      await create.mutateAsync({ ...form, candidateName: form.candidateName.trim(), roleTitle: form.roleTitle.trim(), offeredCtc: Number(form.offeredCtc), joiningDate: form.joiningDate || undefined })
      setCreating(false); setPage(0)
      setForm({ companyId: '', candidateName: '', roleTitle: '', offeredCtc: '', joiningDate: '', notes: '' })
      toast('Offer draft created', 'success')
    } catch (error) { toast((error as Error).message, 'error') }
  }
  async function changeStatus(id: string, status: OfferStatus) {
    try { await update.mutateAsync({ id, status }); toast('Offer status updated', 'success') }
    catch (error) { toast((error as Error).message, 'error') }
  }
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-text-secondary">Track offer drafts, issue status and candidate decisions.</p>
      {canWrite && <HrButton onClick={() => setCreating(!creating)}>{creating ? 'Cancel' : 'Create offer'}</HrButton>}
    </div>
    {creating && <form onSubmit={save} className="ut-card grid gap-4 p-5 sm:grid-cols-2">
      <label className="text-sm">Company<select required className="ut-select mt-1" value={form.companyId} onChange={e => setForm({ ...form, companyId: e.target.value })}>
        <option value="">Select company</option>{companies.data?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select></label>
      <label className="text-sm">Candidate name<input required maxLength={200} className="ut-input mt-1" value={form.candidateName} onChange={e => setForm({ ...form, candidateName: e.target.value })} /></label>
      <label className="text-sm">Role<input required maxLength={200} className="ut-input mt-1" value={form.roleTitle} onChange={e => setForm({ ...form, roleTitle: e.target.value })} /></label>
      <label className="text-sm">Annual offered CTC (INR)<input required type="number" min="0" step="0.01" className="ut-input mt-1" value={form.offeredCtc} onChange={e => setForm({ ...form, offeredCtc: e.target.value })} /></label>
      <label className="text-sm">Joining date<input type="date" className="ut-input mt-1" value={form.joiningDate} onChange={e => setForm({ ...form, joiningDate: e.target.value })} /></label>
      <label className="text-sm">Notes<textarea className="ut-input mt-1" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></label>
      {companies.isError && <p role="alert">Companies could not be loaded. <button type="button" onClick={() => companies.refetch()}>Retry</button></p>}
      <div><HrButton type="submit" disabled={create.isPending || !form.companyId}>{create.isPending ? 'Saving...' : 'Save draft'}</HrButton></div>
    </form>}
    {query.isError ? <div className="ut-card p-5" role="alert"><p>{query.error.message}</p><HrButton onClick={() => query.refetch()}>Retry</HrButton></div> :
      <TableCard><div className="overflow-x-auto"><table className="hr-table"><thead><tr><th>Candidate</th><th>Role</th><th>Offered CTC</th><th>Joining date</th><th>Status</th>{canWrite && <th>Update status</th>}</tr></thead>
        <tbody>{query.isLoading ? <tr><td colSpan={6}>Loading offers...</td></tr> : !query.data?.content.length ? <tr><td colSpan={6} className="py-12 text-center">No offers yet. Create a draft to begin tracking an offer.</td></tr> : query.data.content.map(offer => <tr key={offer.id}>
          <td><span className="font-semibold">{offer.candidateName}</span>{offer.notes && <p className="max-w-xs whitespace-normal text-xs text-text-secondary">{offer.notes}</p>}</td><td>{offer.roleTitle}</td><td>{inr(offer.offeredCtc)}</td><td>{offer.joiningDate || 'Not set'}</td>
          <td><HrStatusPill tone={offer.status === 'ACCEPTED' ? 'green' : offer.status === 'DECLINED' ? 'red' : 'gray'}>{offer.status}</HrStatusPill></td>
          {canWrite && <td>{nextStatuses[offer.status].length ? <select aria-label={`Update offer for ${offer.candidateName}`} className="ut-select" value="" disabled={update.isPending} onChange={e => changeStatus(offer.id, e.target.value as OfferStatus)}><option value="">Choose action</option>{nextStatuses[offer.status].map(status => <option key={status} value={status}>{status === 'SENT' ? 'Mark as sent' : status}</option>)}</select> : <span className="text-text-secondary">Final decision</span>}</td>}
        </tr>)}</tbody></table></div></TableCard>}
    {query.data && <HrPagination page={page} pageSize={20} totalElements={query.data.totalElements} totalPages={query.data.totalPages} onPageChange={setPage} />}
  </div>
}
