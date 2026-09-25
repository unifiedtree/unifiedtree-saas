import { useState, type FormEvent } from 'react'
import { usePermission } from '@unifiedtree/sdk'
import { HrButton, HrStatusPill, TableCard } from '@/shared/components/hr'
import { HrPagination } from '@/shared/components/HrPagination'
import { useToast } from '@/shared/hooks/useToast'
import { useCompanies } from '../api/useOrg'
import {
  useHiringOffers,
  useCreateHiringOffer,
  useUpdateHiringOfferStatus,
  useEditHiringOffer,
  useEmailHiringOffer,
  downloadOfferPdf,
  inr,
  type HiringOffer,
  type OfferStatus,
} from '../api/useHiring'

const nextStatuses: Record<OfferStatus, OfferStatus[]> = {
  DRAFT: ['SENT', 'WITHDRAWN'],
  SENT: ['ACCEPTED', 'DECLINED', 'WITHDRAWN'],
  ACCEPTED: [],
  DECLINED: [],
  WITHDRAWN: [],
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
  const edit = useEditHiringOffer()
  const email = useEmailHiringOffer()
  const [emailOffer, setEmailOffer] = useState<HiringOffer | null>(null)
  const [recipient, setRecipient] = useState('')
  const [editing, setEditing] = useState<HiringOffer | null>(null)
  const [downloading, setDownloading] = useState<string | null>(null)
  const emptyForm = {
    companyId: '',
    candidateName: '',
    roleTitle: '',
    offeredCtc: '',
    joiningDate: '',
    notes: '',
    offerTerms: '',
  }
  const { toast } = useToast()
  const [form, setForm] = useState(emptyForm)
  async function save(event: FormEvent) {
    event.preventDefault()
    try {
      const payload = {
        ...form,
        candidateName: form.candidateName.trim(),
        roleTitle: form.roleTitle.trim(),
        offeredCtc: Number(form.offeredCtc),
        joiningDate: form.joiningDate || undefined,
      }
      if (editing)
        await edit.mutateAsync({
          ...payload,
          id: editing.id,
          candidateId: editing.candidateId,
          requisitionId: editing.requisitionId,
        })
      else await create.mutateAsync(payload)
      setCreating(false)
      setPage(0)
      setForm(emptyForm)
      setEditing(null)
      toast(editing ? 'Offer draft updated' : 'Offer draft created', 'success')
    } catch (error) {
      toast((error as Error).message, 'error')
    }
  }
  function startEdit(offer: HiringOffer) {
    setEditing(offer)
    setForm({
      companyId: offer.companyId,
      candidateName: offer.candidateName,
      roleTitle: offer.roleTitle,
      offeredCtc: String(offer.offeredCtc),
      joiningDate: offer.joiningDate || '',
      notes: offer.notes || '',
      offerTerms: offer.offerTerms || '',
    })
    setCreating(true)
  }
  async function download(id: string) {
    setDownloading(id)
    try {
      await downloadOfferPdf(id)
    } catch (error) {
      toast((error as Error).message, 'error')
    } finally {
      setDownloading(null)
    }
  }
  async function changeStatus(id: string, status: OfferStatus) {
    try {
      await update.mutateAsync({ id, status })
      toast('Offer status updated', 'success')
    } catch (error) {
      toast((error as Error).message, 'error')
    }
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-text-secondary">
          Track offer drafts, issue status and candidate decisions.
        </p>
        {canWrite && (
          <HrButton
            onClick={() => {
              setCreating(!creating)
              setEditing(null)
              setForm(emptyForm)
            }}
          >
            {creating ? 'Cancel' : 'Create offer'}
          </HrButton>
        )}
      </div>
      {emailOffer && (
        <form
          className="ut-card space-y-3 p-5"
          onSubmit={async (e) => {
            e.preventDefault()
            try {
              await email.mutateAsync({ id: emailOffer.id, recipient: recipient.trim() })
              setEmailOffer(null)
              setRecipient('')
              toast('Offer accepted by the mail service', 'success')
            } catch (error) {
              toast((error as Error).message, 'error')
            }
          }}
        >
          <h2 className="font-semibold">Email offer to {emailOffer.candidateName}</h2>
          <p className="text-sm text-text-secondary">
            The message includes the saved offer terms and PDF. Sending freezes the draft.
            Mail-service acceptance does not confirm inbox delivery.
          </p>
          <label className="block text-sm">
            Candidate email
            <input
              aria-label="Candidate email"
              type="email"
              required
              maxLength={254}
              className="ut-input mt-1"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
            />
          </label>
          {email.isError && (
            <p role="alert" className="text-sm text-red-700">
              The email could not be confirmed. Check your mail provider before retrying to avoid a
              duplicate message.
            </p>
          )}
          <div className="flex gap-2">
            <HrButton type="submit" disabled={email.isPending}>
              {email.isPending ? 'Submitting...' : 'Send offer email'}
            </HrButton>
            <HrButton
              variant="ghost"
              disabled={email.isPending}
              onClick={() => setEmailOffer(null)}
            >
              Cancel email
            </HrButton>
          </div>
        </form>
      )}
      {creating && (
        <form onSubmit={save} className="ut-card grid gap-4 p-5 sm:grid-cols-2">
          <label className="text-sm">
            Company
            <select
              aria-label="Company"
              disabled={!!editing}
              required
              className="ut-select mt-1"
              value={form.companyId}
              onChange={(e) => setForm({ ...form, companyId: e.target.value })}
            >
              <option value="">Select company</option>
              {companies.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Candidate name
            <input
              required
              maxLength={200}
              className="ut-input mt-1"
              value={form.candidateName}
              onChange={(e) => setForm({ ...form, candidateName: e.target.value })}
            />
          </label>
          <label className="text-sm">
            Role
            <input
              required
              maxLength={200}
              className="ut-input mt-1"
              value={form.roleTitle}
              onChange={(e) => setForm({ ...form, roleTitle: e.target.value })}
            />
          </label>
          <label className="text-sm">
            Annual offered CTC (INR)
            <input
              required
              type="number"
              min="0"
              step="0.01"
              className="ut-input mt-1"
              value={form.offeredCtc}
              onChange={(e) => setForm({ ...form, offeredCtc: e.target.value })}
            />
          </label>
          <label className="text-sm">
            Joining date
            <input
              type="date"
              className="ut-input mt-1"
              value={form.joiningDate}
              onChange={(e) => setForm({ ...form, joiningDate: e.target.value })}
            />
          </label>
          <label className="text-sm">
            Internal notes
            <textarea
              maxLength={10000}
              className="ut-input mt-1"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </label>
          <label className="text-sm sm:col-span-2">
            Offer terms (included in PDF)
            <textarea
              aria-label="Offer terms"
              maxLength={20000}
              rows={6}
              className="ut-input mt-1"
              value={form.offerTerms}
              onChange={(e) => setForm({ ...form, offerTerms: e.target.value })}
            />
            <span className="mt-1 block text-xs text-text-secondary">
              Enter the approved candidate-facing terms. Internal notes are never included in the
              document.
            </span>
          </label>
          {companies.isError && (
            <p role="alert">
              Companies could not be loaded.{' '}
              <button type="button" onClick={() => companies.refetch()}>
                Retry
              </button>
            </p>
          )}
          <div>
            <HrButton
              type="submit"
              disabled={create.isPending || edit.isPending || !form.companyId}
            >
              {create.isPending || edit.isPending ? 'Saving...' : 'Save draft'}
            </HrButton>
          </div>
        </form>
      )}
      {query.isError ? (
        <div className="ut-card p-5" role="alert">
          <p>{query.error.message}</p>
          <HrButton onClick={() => query.refetch()}>Retry</HrButton>
        </div>
      ) : (
        <TableCard>
          <div className="overflow-x-auto">
            <table className="hr-table">
              <thead>
                <tr>
                  <th>Candidate</th>
                  <th>Role</th>
                  <th>Offered CTC</th>
                  <th>Joining date</th>
                  <th>Status</th>
                  <th>Document</th>
                  {canWrite && <th>Update status</th>}
                </tr>
              </thead>
              <tbody>
                {query.isLoading ? (
                  <tr>
                    <td colSpan={canWrite ? 7 : 6}>Loading offers...</td>
                  </tr>
                ) : !query.data?.content.length ? (
                  <tr>
                    <td colSpan={canWrite ? 7 : 6} className="py-12 text-center">
                      No offers yet. Create a draft to begin tracking an offer.
                    </td>
                  </tr>
                ) : (
                  query.data.content.map((offer) => (
                    <tr key={offer.id}>
                      <td>
                        <span className="font-semibold">{offer.candidateName}</span>
                        {offer.notes && (
                          <p className="max-w-xs whitespace-normal text-xs text-text-secondary">
                            {offer.notes}
                          </p>
                        )}
                      </td>
                      <td>{offer.roleTitle}</td>
                      <td>{inr(offer.offeredCtc)}</td>
                      <td>{offer.joiningDate ? new Date(`${offer.joiningDate}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Not set'}</td>
                      <td>
                        <HrStatusPill
                          tone={
                            offer.status === 'ACCEPTED'
                              ? 'green'
                              : offer.status === 'DECLINED'
                                ? 'red'
                                : offer.status === 'SENT'
                                  ? 'warn'
                                  : 'gray'
                          }
                        >
                          {String(offer.status).charAt(0) + String(offer.status).slice(1).toLowerCase()}
                        </HrStatusPill>
                      </td>
                      <td>
                        <HrButton
                          variant="ghost"
                          disabled={downloading !== null}
                          onClick={() => download(offer.id)}
                        >
                          {downloading === offer.id ? 'Preparing...' : 'Download PDF'}
                        </HrButton>
                        {offer.emailSubmittedAt ? (
                          <p className="mt-2 text-xs text-text-secondary">
                            Submitted to {offer.emailRecipient}
                            <br />
                            {new Date(offer.emailSubmittedAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
                          </p>
                        ) : (
                          canWrite &&
                          (offer.status === 'DRAFT' || offer.status === 'SENT') && (
                            <HrButton
                              variant="ghost"
                              onClick={() => {
                                setEmailOffer(offer)
                                setRecipient('')
                                email.reset()
                              }}
                            >
                              Email offer
                            </HrButton>
                          )
                        )}
                      </td>
                      {canWrite && (
                        <td>
                          {offer.status === 'DRAFT' && (
                            <HrButton variant="ghost" onClick={() => startEdit(offer)}>
                              Edit draft
                            </HrButton>
                          )}
                          {nextStatuses[offer.status].length ? (
                            <select
                              aria-label={`Update offer for ${offer.candidateName}`}
                              className="ut-select"
                              value=""
                              disabled={update.isPending}
                              onChange={(e) =>
                                changeStatus(offer.id, e.target.value as OfferStatus)
                              }
                            >
                              <option value="">Choose action</option>
                              {nextStatuses[offer.status].map((status) => (
                                <option key={status} value={status}>
                                  {status === 'SENT' ? 'Mark as sent' : status}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span className="text-text-secondary">Final decision</span>
                          )}
                        </td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </TableCard>
      )}
      {query.data && (
        <HrPagination
          page={page}
          pageSize={20}
          totalElements={query.data.totalElements}
          totalPages={query.data.totalPages}
          onPageChange={setPage}
        />
      )}
    </div>
  )
}
