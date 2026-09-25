// Documents (/hrms/documents) on the module kit.
//   - hrms.document.read.self: My documents (read-only copy of your file).
//   - hrms.document.read: anyone's documents, picked with the server-searched
//     employee picker (the old list stopped at the first 200 people).
//   - hrms.document.write: add a document (a file, typed or free-form, or an
//     existing link) and delete.
//   - hrms.letters.template.read: letter templates, as a view here too.
// File links come back signed from the API; when document storage isn't set
// up the API returns no link, and the row says so instead of a dead link.
import React, { useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { usePermission } from '@unifiedtree/sdk'
import { HrButton, HrStatusPill, TableCard, HrAvatar, HrDrawer, type PillTone } from '@/shared/components/hr'
import { hrPaginationFooter, useClampedPage } from '@/shared/components/HrPagination'
import { ModulePage, Views, useView, StatRow, State, Panel, Note, useDesignToast, dmy, todayIso } from '@/design/module/ModuleKit'
import { LetterTemplates } from './letters/LetterTemplates'
import { PerformanceEmployeePicker as EmployeePicker } from './performance/PerformanceEmployeePicker'
import {
  useMyDocuments, useEmployeeDocuments, useCreateDocument, useDeleteDocument, useDocumentTypes,
  DOCUMENT_CATEGORIES, DOCUMENT_PAGE_SIZE,
  type DocumentCategory, type EmployeeDocument, type EmployeeDocumentV2,
} from './api/useDocument'

type Toast = (msg: string, err?: boolean, detail?: string) => void
const CATEGORY_TONE: Record<DocumentCategory, PillTone> = { CONTRACT: 'purple', ID_PROOF: 'blue', CERTIFICATE: 'teal', PAYSLIP: 'green', POLICY: 'info', TAX: 'orange', OTHER: 'gray' }
const VERIFY: Record<string, [string, PillTone]> = { VERIFIED: ['Verified', 'ok'], PENDING: ['Waiting for review', 'warn'], REJECTED: ['Rejected', 'red'] }
const fmtCat = (c: string) => c.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (m) => m.toUpperCase())
const label = 'mb-1.5 block text-[13px] font-semibold text-text-secondary'

/** Expired, or expiring within 30 days; nothing otherwise. */
function expiryBadge(expiryDate?: string): { tone: PillTone; label: string } | null {
  if (!expiryDate) return null
  const today = todayIso()
  if (expiryDate < today) return { tone: 'red', label: 'Expired' }
  const days = Math.round((new Date(`${expiryDate}T00:00`).getTime() - new Date(`${today}T00:00`).getTime()) / 864e5)
  return days <= 30 ? { tone: 'warn', label: days === 0 ? 'Expires today' : `Expires in ${days} ${days === 1 ? 'day' : 'days'}` } : null
}

type Tab = 'my' | 'all' | 'letters'

export const DocumentVault: React.FC = () => {
  const canReadTemplates = usePermission('hrms.letters.template.read')
  const canReadSelf = usePermission('hrms.document.read.self')
  const canRead = usePermission('hrms.document.read')
  const canWrite = usePermission('hrms.document.write')
  const { show, node } = useDesignToast()
  const [adding, setAdding] = useState(false)
  const views = [
    ...(canReadSelf ? [{ key: 'my', label: 'My documents', icon: 'fileText' }] : []),
    ...(canRead ? [{ key: 'all', label: 'Employee documents', icon: 'users' }] : []),
    ...(canReadTemplates ? [{ key: 'letters', label: 'Letter templates', icon: 'clipboard' }] : []),
  ]
  const [tab, setTab] = useView(views.map((v) => v.key)) as [Tab, (k: string) => void]
  return (
    <ModulePage crumb="Documents" title="Documents" subtitle={canRead ? 'Everyone’s paperwork in one place: contracts, ID proofs, certificates and tax forms.' : 'Your copy of the paperwork HR holds for you.'}
      actions={canWrite ? <HrButton onClick={() => setAdding(true)}><Plus size={15} /> Add document</HrButton> : undefined}>
      <div style={{ display: 'grid', gap: 16, minWidth: 0 }}>
        {views.length > 1 && <Views items={views} active={tab} onChange={setTab} label="Document views" />}
        {views.length === 0 && (canWrite ? <Note>Use “Add document” to store a document on someone’s file.</Note> : <State kind="empty" icon="lock" title="No document access" description="Ask an admin if you should see documents." />)}
        {tab === 'my' && canReadSelf && <MyDocumentsTab />}
        {tab === 'all' && canRead && <AllDocumentsTab toast={show} />}
        {tab === 'letters' && canReadTemplates && <LetterTemplates />}
      </div>
      {adding && <AddDocumentDrawer onClose={() => setAdding(false)} toast={show} />}
      {node}
    </ModulePage>
  )
}

function DocumentTable({ documents, isLoading, showOwner, onDelete, footer, emptyTitle, emptyHint }: {
  documents: EmployeeDocumentV2[]; isLoading: boolean; showOwner?: boolean; onDelete?: (d: EmployeeDocument) => void; footer?: React.ReactNode; emptyTitle: string; emptyHint: string
}) {
  if (isLoading) return <State kind="loading" height={200} />
  if (!documents.length) return <State kind="empty" icon="fileText" title={emptyTitle} description={emptyHint} />
  return (
    <TableCard footer={footer}>
      <table className="hr-table">
        <thead><tr>{showOwner && <th>Employee</th>}<th>Document</th><th>Type</th><th className="hidden sm:table-cell">Issued</th><th>Expiry</th><th className="hidden md:table-cell">Review</th>{onDelete && <th><span className="sr-only">Actions</span></th>}</tr></thead>
        <tbody>
          {documents.map((d, i) => {
            const badge = expiryBadge(d.expiryDate)
            const v = d.verificationStatus ? VERIFY[d.verificationStatus] : null
            return (
              <tr key={d.id}>
                {showOwner && <td><HrAvatar name={d.employeeName || 'Employee'} sub={d.employeeCode} seed={i} /></td>}
                <td>
                  {d.fileUrl
                    ? <a href={d.fileUrl} target="_blank" rel="noreferrer" className="font-semibold text-text-primary hover:text-[#047857]">{d.title} ↗</a>
                    : <span className="font-semibold text-text-primary">{d.title}</span>}
                  {!d.fileUrl && <p className="text-xs text-text-tertiary">File can’t be opened here (document storage isn’t set up)</p>}
                  {d.verificationStatus === 'REJECTED' && d.rejectionReason && <p className="text-xs text-[#b91c1c]">{d.rejectionReason}</p>}
                </td>
                <td>{d.documentTypeName ? <HrStatusPill tone="info">{d.documentTypeName}</HrStatusPill> : <HrStatusPill tone={CATEGORY_TONE[d.category] ?? 'gray'}>{fmtCat(d.category)}</HrStatusPill>}</td>
                <td className="hidden sm:table-cell text-text-secondary">{d.issuedDate ? dmy(d.issuedDate) : '—'}</td>
                <td>{d.expiryDate ? <div className="flex flex-wrap items-center gap-2"><span className="text-text-secondary">{dmy(d.expiryDate)}</span>{badge && <HrStatusPill tone={badge.tone}>{badge.label}</HrStatusPill>}</div> : <span className="text-text-tertiary">—</span>}</td>
                <td className="hidden md:table-cell">{v ? <HrStatusPill tone={v[1]}>{v[0]}</HrStatusPill> : <span className="text-text-tertiary">—</span>}</td>
                {onDelete && <td className="text-right"><HrButton size="sm" variant="ghost" onClick={() => onDelete(d)} aria-label={`Delete ${d.title}`}>Delete</HrButton></td>}
              </tr>
            )
          })}
        </tbody>
      </table>
    </TableCard>
  )
}

function Tiles({ documents, total, loading, pageScoped }: { documents: EmployeeDocument[]; total: number; loading: boolean; pageScoped?: string }) {
  const s = useMemo(() => ({
    expiring: documents.filter((d) => expiryBadge(d.expiryDate)?.tone === 'warn').length,
    expired: documents.filter((d) => expiryBadge(d.expiryDate)?.tone === 'red').length,
  }), [documents])
  if (loading) return <State kind="loading" height={96} />
  return <StatRow tiles={[
    { icon: 'fileText', color: 'blue', label: 'Documents', value: String(total), sub: 'On file' },
    { icon: 'clock', color: 'orange', label: 'Expiring soon', value: String(s.expiring), sub: pageScoped || 'Within 30 days' },
    { icon: 'alertTriangle', color: 'red', label: 'Expired', value: String(s.expired), sub: pageScoped || 'Needs a new copy' },
  ]} />
}

function MyDocumentsTab() {
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(DOCUMENT_PAGE_SIZE)
  const { data, isLoading, isError, error, refetch } = useMyDocuments(page, pageSize)
  const documents = (data?.content ?? []) as EmployeeDocumentV2[]
  const total = data?.totalElements ?? 0, totalPages = data?.totalPages ?? 1
  // Expiry is worked out from the rows on screen; there's no server-side total for it.
  const pageScoped = totalPages > 1 ? 'On this page' : undefined
  if (isError) return <State kind="error" title="Couldn’t load your documents" description={(error as Error)?.message} onRetry={() => refetch()} />
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Note>Your copy of the paperwork HR holds for you: offer letter, contract, ID proofs, certificates and tax documents. HR adds them; you can open them here any time.</Note>
      <Tiles documents={documents} total={total} loading={isLoading} pageScoped={pageScoped} />
      <DocumentTable documents={documents} isLoading={isLoading} emptyTitle="Nothing on your file yet"
        emptyHint="When HR adds a document to your file it appears here. Ask HR if you’re expecting something."
        footer={hrPaginationFooter({ page, pageSize, totalElements: total, totalPages, onPageChange: setPage, onPageSizeChange: setPageSize })} />
    </div>
  )
}

function AllDocumentsTab({ toast }: { toast: Toast }) {
  const canWrite = usePermission('hrms.document.write')
  const [employee, setEmployee] = useState({ id: '', name: '' })
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(DOCUMENT_PAGE_SIZE)
  const { data, isLoading, isError, error, refetch } = useEmployeeDocuments(employee.id || undefined, page, true, pageSize)
  const documents = (data?.content ?? []) as EmployeeDocumentV2[]
  const total = data?.totalElements ?? 0, totalPages = data?.totalPages ?? 1
  const remove = useDeleteDocument()
  // Deleting the last row on the last page shrinks totalPages; stay in range (raw value, not the ?? 1 fallback).
  useClampedPage(page, data?.totalPages, setPage)
  const onDelete = async (d: EmployeeDocument) => {
    if (!window.confirm(`Delete “${d.title}”? This can’t be undone, and it disappears from their My documents too.`)) return
    try { await remove.mutateAsync(d.id); toast('Document deleted') } catch (e) { toast('Couldn’t delete the document', true, (e as Error)?.message) }
  }
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Panel title="Whose file?" sub={employee.id ? `Showing ${employee.name}` : 'Search by name, code or email.'}>
        <EmployeePicker value={employee.id} selectedLabel={employee.name} onChange={(e) => { setEmployee({ id: e.id, name: `${e.firstName} ${e.lastName || ''}`.trim() }); setPage(0) }} />
      </Panel>
      {!employee.id ? <State kind="empty" icon="users" title="No one picked yet" description="Pick someone above to open their documents." />
        : isError ? <State kind="error" title="Couldn’t load their documents" description={(error as Error)?.message} onRetry={() => refetch()} />
          : <>
            <Tiles documents={documents} total={total} loading={isLoading} pageScoped={totalPages > 1 ? 'On this page' : undefined} />
            <DocumentTable documents={documents} isLoading={isLoading} showOwner onDelete={canWrite ? onDelete : undefined}
              emptyTitle="No documents on their file yet"
              emptyHint={canWrite ? 'Use “Add document” to store their offer letter, contract, ID proofs or certificates. They see them under My documents.' : 'Nothing has been added to their file yet.'}
              footer={hrPaginationFooter({ page, pageSize, totalElements: total, totalPages, onPageChange: setPage, onPageSizeChange: setPageSize })} />
          </>}
    </div>
  )
}

function AddDocumentDrawer({ onClose, toast }: { onClose: () => void; toast: Toast }) {
  const create = useCreateDocument()
  const types = useDocumentTypes()
  const activeTypes = (types.data ?? []).filter((t) => t.active)
  const [employee, setEmployee] = useState({ id: '', name: '' })
  const [typeId, setTypeId] = useState('')
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState<DocumentCategory>('CONTRACT')
  const [fileUrl, setFileUrl] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [issuedDate, setIssuedDate] = useState('')
  const [expiryDate, setExpiryDate] = useState('')
  const [notes, setNotes] = useState('')
  const type = activeTypes.find((t) => t.id === typeId)
  const formats = (type?.allowedFormats || 'pdf,png,jpg,jpeg').split(',').map((f) => f.trim().toLowerCase()).filter(Boolean)
  const maxMb = type?.maxSizeMb ?? 10
  const submit = async () => {
    if (!employee.id) { toast('Pick whose document this is', true); return }
    if (!title.trim()) { toast('Give the document a title', true); return }
    if (!file && !fileUrl.trim()) { toast('Choose a file or paste a link', true); return }
    if (file) {
      const ext = file.name.split('.').pop()?.toLowerCase() || ''
      if (!formats.includes(ext)) { toast(`Use one of: ${formats.join(', ').toUpperCase()}`, true); return }
      if (file.size > maxMb * 1024 * 1024) { toast(`The file must be ${maxMb} MB or smaller`, true); return }
    }
    if (!file && !/^https?:\/\//i.test(fileUrl.trim())) { toast('Enter a link starting with http:// or https://', true); return }
    if (issuedDate && expiryDate && expiryDate < issuedDate) { toast('The expiry date is before the issue date', true); return }
    try {
      await create.mutateAsync({ employeeId: employee.id, title: title.trim(), category, fileUrl: fileUrl.trim(), file: file ?? undefined, issuedDate: issuedDate || undefined, expiryDate: expiryDate || undefined, notes: notes.trim() || undefined, ...(file && typeId ? { documentTypeId: typeId } : {}) })
      toast('Document stored', false, `It’s on ${employee.name}’s file and they can see it under My documents.`)
      onClose()
    } catch (e) { toast('Couldn’t store the document', true, (e as Error)?.message) }
  }
  return (
    <HrDrawer title="Add a document" onClose={() => { if (!create.isPending) onClose() }} width="max-w-xl"
      footer={<><HrButton variant="ghost" onClick={onClose} disabled={create.isPending}>Cancel</HrButton><HrButton onClick={submit} disabled={create.isPending}>{create.isPending ? 'Storing…' : 'Store document'}</HrButton></>}>
      <div className="space-y-4">
        <div><span className={label}>Whose file</span>
          <EmployeePicker value={employee.id} selectedLabel={employee.name} onChange={(e) => setEmployee({ id: e.id, name: `${e.firstName} ${e.lastName || ''}`.trim() })} /></div>
        {activeTypes.length > 0 && (
          <div><label className={label} htmlFor="doc-type">Document type</label>
            <select id="doc-type" value={typeId} onChange={(e) => { setTypeId(e.target.value); const t = activeTypes.find((x) => x.id === e.target.value); if (t && !title.trim()) setTitle(t.displayName) }} className="ut-select">
              <option value="">Other (free-form)</option>
              {activeTypes.map((t) => <option key={t.id} value={t.id}>{t.displayName}</option>)}
            </select>
            {type && <p className="mt-1 text-xs text-text-tertiary">{`${formats.join(', ').toUpperCase()} · up to ${maxMb} MB${type.expiryTracked ? ' · has an expiry date' : ''}`}</p>}
          </div>
        )}
        <div><label className={label} htmlFor="doc-title">Title</label><input id="doc-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Employment contract 2026" className="ut-input" /></div>
        <div><label className={label} htmlFor="doc-file">File</label>
          <input id="doc-file" type="file" accept={formats.map((f) => `.${f}`).join(',')} className="text-[13px]" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <p className="mt-1 text-xs text-text-tertiary">{`${formats.join(', ').toUpperCase()}, up to ${maxMb} MB. Or paste a link below instead.`}</p></div>
        {!file && <div><label className={label} htmlFor="doc-url">Or a link to an existing document</label><input id="doc-url" value={fileUrl} onChange={(e) => setFileUrl(e.target.value)} placeholder="https://…" className="ut-input" /></div>}
        <div className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-3">
          <div><label className={label} htmlFor="doc-cat">Category</label><select id="doc-cat" value={category} onChange={(e) => setCategory(e.target.value as DocumentCategory)} className="ut-select">{DOCUMENT_CATEGORIES.map((c) => <option key={c} value={c}>{fmtCat(c)}</option>)}</select></div>
          <div><label className={label} htmlFor="doc-issued">Issued</label><input id="doc-issued" type="date" value={issuedDate} onChange={(e) => setIssuedDate(e.target.value)} className="ut-input" /></div>
          <div><label className={label} htmlFor="doc-exp">Expires</label><input id="doc-exp" type="date" min={issuedDate || undefined} value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} className="ut-input" /></div>
        </div>
        <div><label className={label} htmlFor="doc-notes">Notes</label><textarea id="doc-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Optional" className="ut-input resize-y" /></div>
        <Note>Documents HR adds are marked verified straight away. Documents employees upload themselves wait under Docs to review.</Note>
      </div>
    </HrDrawer>
  )
}
