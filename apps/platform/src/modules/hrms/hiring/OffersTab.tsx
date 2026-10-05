// Hiring › Offers (P-HIRE; prototype PgTalent h-pipe tab 3). Offers carry salary: reading
// needs hrms.hiring.offer.read; creating, editing a draft, emailing and status changes need
// hrms.hiring.offer.write or hrms.hiring.write (the API's rule).
//   - Create offer (header button) / Edit draft: the offer panel. The candidate email
//     (BW-67) is stored with the offer, so "Send offer email" starts from it.
//   - Send offer email asks once for the address (the stored one is filled in): sending
//     freezes the draft, and the mail service accepting it doesn't prove delivery.
//   - A draft's row offers Edit draft and Send offer email, any other offer Download PDF (the
//     design's actions); the draft's PDF and the status changes (Mark as sent, accepted,
//     declined, Withdraw) are in the row's menu; a final decision has no status to change.
import { useState, type FormEvent } from 'react'
import { MoreHorizontal } from 'lucide-react'
import { usePermission } from '@unifiedtree/sdk'
import { Button, Callout, CellActions, CellPerson, Section, StatusPill, Table, type TableColumn } from '@/design/kit/display'
import { Pager } from '@/design/kit/data'
import { DateInput, Dialog, FieldGrid, Input, Menu, PanelButton, Select, SidePanel, Textarea, useToast, type MenuEntry } from '@/design/kit/overlays'
import { useCompanies } from '../api/useOrg'
import { useCurrentCompany } from '../company/CurrentCompany'
import {
  useHiringOffers, useCreateHiringOffer, useUpdateHiringOfferStatus, useEditHiringOffer, useEmailHiringOffer, downloadOfferPdf, inr,
  type HiringOffer, type OfferStatus,
} from '../api/useHiring'
import { OFFER_ACTION, OFFER_LABEL, OFFER_NEXT, OFFER_TONE, istTodayIso, weekdayDay } from './hiringModel'

const PAGE = 20
const errText = (e: unknown) => (e instanceof Error && e.message) || 'Please try again.'
const stampOf = (iso: string) => new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

export function OffersTab({ creating, onCreateDone }: { creating: boolean; onCreateDone: () => void }) {
  const toast = useToast()
  const canOfferWrite = usePermission('hrms.hiring.offer.write')
  const canHiringWrite = usePermission('hrms.hiring.write')
  const canWrite = canOfferWrite || canHiringWrite
  const [page, setPage] = useState(0)
  const query = useHiringOffers(page)
  const update = useUpdateHiringOfferStatus()
  const [editing, setEditing] = useState<HiringOffer | null>(null)
  const [emailing, setEmailing] = useState<HiringOffer | null>(null)
  const [downloading, setDownloading] = useState<string | null>(null)
  const offers = query.data?.content ?? []
  const total = query.data?.totalElements ?? 0
  const today = istTodayIso()

  const download = async (o: HiringOffer) => {
    setDownloading(o.id)
    try { await downloadOfferPdf(o.id) } catch (e) { toast.error('Couldn’t download the offer', { detail: errText(e) }) } finally { setDownloading(null) }
  }
  const changeStatus = async (o: HiringOffer, status: OfferStatus) => {
    try {
      await update.mutateAsync({ id: o.id, status })
      toast.success(`Offer ${OFFER_LABEL[status].toLowerCase()}`, { detail: o.candidateName })
    } catch (e) { toast.error('Couldn’t update the offer', { detail: errText(e) }) }
  }

  const columns: TableColumn<HiringOffer>[] = [
    {
      key: 'candidate', header: 'Candidate', primary: true, width: '24%', render: (o) => (
        <CellPerson name={o.candidateName} sub={o.candidateEmail || o.emailRecipient || (o.notes ? <span title={o.notes}>{o.notes}</span> : undefined)} />
      ),
    },
    { key: 'role', header: 'Role', render: (o) => o.roleTitle },
    { key: 'ctc', header: 'Offered CTC', render: (o) => <span className="hi-num">{inr(o.offeredCtc)}</span> },
    { key: 'joining', header: 'Joining date', render: (o) => <span className="hi-num">{o.joiningDate ? weekdayDay(o.joiningDate, today) : '—'}</span> },
    {
      key: 'status', header: 'Status', render: (o) => (
        <span className="hi-cellwrap">
          <StatusPill tone={OFFER_TONE[o.status]}>{OFFER_LABEL[o.status]}</StatusPill>
          {o.emailSubmittedAt && <span className="hi-small" title={o.emailRecipient ?? undefined}>{`Submitted to ${o.emailRecipient ?? 'the candidate'}`}<br />{stampOf(o.emailSubmittedAt)}</span>}
        </span>
      ),
    },
    {
      // The design's row actions: a draft is edited and emailed, any other offer downloaded. The
      // rest (the draft's PDF, the status changes) is in the row's menu; a final decision has no
      // status to change.
      key: 'actions', header: <span className="uk-sr">Actions</span>, label: 'Actions', align: 'right', width: 300, render: (o) => {
        const draft = canWrite && o.status === 'DRAFT'
        const next = canWrite ? OFFER_NEXT[o.status] : []
        const pdf = () => download(o)
        const items: MenuEntry[] = [
          ...(draft ? [{ key: 'pdf', label: 'Download PDF', icon: 'download', disabled: downloading !== null, onSelect: pdf }] : []),
          ...next.map((s) => ({ key: s, label: OFFER_ACTION[s], danger: s === 'WITHDRAWN' || s === 'DECLINED', disabled: update.isPending, onSelect: () => changeStatus(o, s) })),
        ]
        return (
          <CellActions>
            {draft
              ? <Button size={30} variant="secondary" onClick={() => setEditing(o)}>Edit draft</Button>
              : <Button size={30} variant="secondary" loading={downloading === o.id} disabled={downloading !== null && downloading !== o.id} onClick={pdf}>Download PDF</Button>}
            {canWrite && !o.emailSubmittedAt && (o.status === 'DRAFT' || o.status === 'SENT') && <Button size={30} variant="soft" onClick={() => setEmailing(o)}>Send offer email</Button>}
            {items.length > 0 && (
              <Menu label={`More for ${o.candidateName}`} width={230} placement="bottom-end" items={items}
                trigger={({ props }) => <Button {...props} size={30} variant="plain" icon={<MoreHorizontal size={16} />} aria-label={`More for ${o.candidateName}`} />} />
            )}
          </CellActions>
        )
      },
    },
  ]

  return (
    <>
      <Section title="Offers" body="flush" loading={query.isLoading} skeleton="table" error={query.error} onRetry={() => query.refetch()} retrying={query.isFetching}
        empty={!query.isLoading && !query.error && total === 0 ? { title: 'No offers yet. Create a draft to begin tracking an offer.', icon: 'fileText' } : undefined}
        footer={total > PAGE ? <Pager page={page} pageSize={PAGE} total={total} onPageChange={setPage} noun="offers" /> : undefined}>
        <Table label="Offers" columns={columns} rows={offers} rowKey={(o) => o.id} mobile="cards" minWidth={960} />
      </Section>
      {(creating || editing) && <OfferPanel offer={editing} onClose={() => { setEditing(null); onCreateDone() }} onSaved={() => setPage(0)} />}
      {emailing && <EmailOfferDialog offer={emailing} onClose={() => setEmailing(null)} />}
    </>
  )
}

/** Create an offer draft, or edit one (`offer`). Offer terms go into the PDF; internal notes stay with HR. */
function OfferPanel({ offer, onClose, onSaved }: { offer: HiringOffer | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast()
  const companies = useCompanies()
  const create = useCreateHiringOffer()
  const edit = useEditHiringOffer()
  const busy = create.isPending || edit.isPending
  // A new offer starts in the company the top bar's selector is on (two or more companies).
  const { companyId: currentCompanyId, multi } = useCurrentCompany()
  const [form, setForm] = useState(() => ({
    companyId: offer?.companyId ?? (multi ? currentCompanyId : ''),
    candidateName: offer?.candidateName ?? '',
    candidateEmail: offer?.candidateEmail ?? '',
    roleTitle: offer?.roleTitle ?? '',
    offeredCtc: offer ? String(offer.offeredCtc) : '',
    joiningDate: offer?.joiningDate ?? '',
    notes: offer?.notes ?? '',
    offerTerms: offer?.offerTerms ?? '',
  }))
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }))
  const save = async (e?: FormEvent) => {
    e?.preventDefault()
    if (!form.companyId) { toast.error('Choose the company making the offer'); return }
    if (!form.candidateName.trim() || !form.roleTitle.trim()) { toast.error('Add the candidate’s name and the role'); return }
    if (form.offeredCtc === '' || Number(form.offeredCtc) < 0) { toast.error('Add the annual offered CTC'); return }
    const payload = {
      companyId: form.companyId, candidateName: form.candidateName.trim(), roleTitle: form.roleTitle.trim(), offeredCtc: Number(form.offeredCtc),
      joiningDate: form.joiningDate || undefined, notes: form.notes, offerTerms: form.offerTerms,
      // Edit: an emptied field removes the stored email; create: none is sent when it's empty.
      candidateEmail: offer ? form.candidateEmail.trim() : form.candidateEmail.trim() || undefined,
    }
    try {
      if (offer) await edit.mutateAsync({ ...payload, id: offer.id, candidateId: offer.candidateId, requisitionId: offer.requisitionId })
      else await create.mutateAsync(payload)
      toast.success(offer ? 'Offer draft updated' : 'Offer draft created')
      onSaved()
      onClose()
    } catch (err) { toast.error(offer ? 'Couldn’t update the offer' : 'Couldn’t create the offer', { detail: errText(err) }) }
  }
  return (
    <SidePanel open onClose={onClose} width={620} busy={busy} closeLabel="Close panel"
      title={offer ? 'Edit offer draft' : 'Create offer'} sub="Offer terms go into the PDF. Internal notes stay with HR."
      footer={<><PanelButton size="lg" onClick={onClose} disabled={busy}>Cancel</PanelButton>
        <PanelButton size="lg" variant="primary" busy={busy} disabled={!form.companyId} onClick={() => save()}>Save draft</PanelButton></>}>
      <form id="offer-form" onSubmit={save} noValidate className="hi-stack">
        <FieldGrid columns={2}>
          <Select id="offer-company" label="Company" full value={form.companyId} disabled={!!offer} placeholder="Select company"
            options={(companies.data ?? []).map((c) => ({ value: c.id, label: c.name }))} onChange={(e) => set('companyId')(e.target.value)} />
          <Input id="offer-name" label="Candidate name" value={form.candidateName} maxLength={200} onChange={(e) => set('candidateName')(e.target.value)} />
          <Input id="offer-email" label="Candidate email" type="email" value={form.candidateEmail} maxLength={254} placeholder="name@email.com"
            hint="Used by Send offer email." onChange={(e) => set('candidateEmail')(e.target.value)} />
          <Input id="offer-role" label="Role" value={form.roleTitle} maxLength={200} onChange={(e) => set('roleTitle')(e.target.value)} />
          <Input id="offer-ctc" label="Annual offered CTC (INR)" type="number" min={0} step="0.01" value={form.offeredCtc} onChange={(e) => set('offeredCtc')(e.target.value)} />
          <DateInput id="offer-joining" label="Joining date" full value={form.joiningDate} onChange={(e) => set('joiningDate')(e.target.value)} clearable />
          <Textarea id="offer-terms" label="Offer terms (included in PDF)" aria-label="Offer terms" full rows={6} maxLength={20000} value={form.offerTerms}
            hint="Enter the approved candidate-facing terms. Internal notes are never included in the document." onChange={(e) => set('offerTerms')(e.target.value)} />
          <Textarea id="offer-notes" label="Internal notes" full rows={3} maxLength={10000} value={form.notes} placeholder="Not shown to the candidate" onChange={(e) => set('notes')(e.target.value)} />
        </FieldGrid>
        {companies.isError && (
          <Callout tone="warning">Companies could not be loaded. <button type="button" className="hi-link" style={{ border: 0, background: 'none', padding: 0, cursor: 'pointer' }} onClick={() => companies.refetch()}>Try again</button></Callout>
        )}
      </form>
    </SidePanel>
  )
}

/** Email the offer (its terms and PDF) to the candidate. The stored candidate email is filled in. */
function EmailOfferDialog({ offer, onClose }: { offer: HiringOffer; onClose: () => void }) {
  const toast = useToast()
  const email = useEmailHiringOffer()
  const [recipient, setRecipient] = useState(offer.candidateEmail ?? '')
  const send = async (e?: FormEvent) => {
    e?.preventDefault()
    if (!recipient.trim()) { toast.error('Add the candidate’s email'); return }
    try {
      await email.mutateAsync({ id: offer.id, recipient: recipient.trim() })
      toast.success('Offer accepted by the mail service', { detail: `Sent to ${recipient.trim()}` })
      onClose()
    } catch { /* the dialog shows why below */ }
  }
  return (
    <Dialog open onClose={onClose} busy={email.isPending} icon="mail" width={520} title={`Email the offer to ${offer.candidateName}`}
      sub="The message includes the saved offer terms and PDF. Sending freezes the draft."
      footer={<><PanelButton onClick={onClose} disabled={email.isPending}>Cancel</PanelButton>
        <PanelButton variant="primary" busy={email.isPending} onClick={() => send()}>Send offer email</PanelButton></>}>
      <form onSubmit={send} noValidate className="hi-stack">
        <Input id="offer-recipient" label="Candidate email" type="email" maxLength={254} value={recipient} autoFocus
          hint="The mail service accepting the message doesn’t confirm it reached the inbox." onChange={(e) => setRecipient(e.target.value)} />
        {email.isError && (
          <p role="alert" className="hi-copy" style={{ color: 'var(--u-danger-text, #B4302A)' }}>
            {`The email could not be confirmed: ${errText(email.error)} Check your mail provider before retrying to avoid a duplicate message.`}
          </p>
        )}
      </form>
    </Dialog>
  )
}
