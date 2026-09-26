// Documents (/hrms/documents) on the module kit.
//   - hrms.document.read.self: My documents (read-only copy of your file).
//   - hrms.document.read: anyone's documents, picked with the server-searched
//     employee picker (the old list stopped at the first 200 people).
//   - hrms.document.write: add a document (a file, typed or free-form, or an
//     existing link), edit one (details, type, or replace the file), bulk upload
//     several files at once (each to an employee and a type) and delete.
//   - hrms.letters.template.read: letter templates, as a view here too.
// File links come back signed from the API; when document storage isn't set
// up the API returns no link, and the row says so instead of a dead link.
import React, { useMemo, useRef, useState } from 'react'
import { Plus, Upload, Trash2 } from 'lucide-react'
import { usePermission } from '@unifiedtree/sdk'
import { HrButton, HrStatusPill, TableCard, HrAvatar, HrDrawer, type PillTone } from '@/shared/components/hr'
import { DateField } from '@/shared/components/calendar'
import { hrPaginationFooter, useClampedPage } from '@/shared/components/HrPagination'
import { ModulePage, Views, useView, StatRow, State, Panel, Note, useDesignToast, dmy, todayIso } from '@/design/module/ModuleKit'
import { LetterTemplates } from './letters/LetterTemplates'
import { PerformanceEmployeePicker as EmployeePicker } from './performance/PerformanceEmployeePicker'
import { useQueryClient } from '@tanstack/react-query'
import { apiJson } from '@/core/api/client'
import {
  useMyDocuments, useEmployeeDocuments, useCreateDocument, useDeleteDocument, useDocumentTypes, useEditDocument,
  categoryForType, typeFormats, fileProblem,
  DOCUMENT_CATEGORIES, DOCUMENT_PAGE_SIZE,
  type DocumentCategory, type DocumentType, type EmployeeDocument, type EmployeeDocumentV2,
} from './api/useDocument'

type Toast = (msg: string, err?: boolean, detail?: string) => void
const CATEGORY_TONE: Record<DocumentCategory, PillTone> = { CONTRACT: 'purple', ID_PROOF: 'blue', CERTIFICATE: 'teal', PAYSLIP: 'green', POLICY: 'info', TAX: 'orange', OTHER: 'gray' }
const VERIFY: Record<string, [string, PillTone]> = { VERIFIED: ['Verified', 'ok'], PENDING: ['Waiting for review', 'warn'], REJECTED: ['Rejected', 'red'] }
const fmtCat = (c: string) => c.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (m) => m.toUpperCase())
const label = 'mb-1.5 block text-[13px] font-semibold text-text-secondary'
/** Expiry pickers reach decades ahead (IDs and licences can run 20+ years). */
const EXPIRY_TO_YEAR = new Date().getFullYear() + 50

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
  const [bulk, setBulk] = useState(false)
  const views = [
    ...(canReadSelf ? [{ key: 'my', label: 'My documents', icon: 'fileText' }] : []),
    ...(canRead ? [{ key: 'all', label: 'Employee documents', icon: 'users' }] : []),
    ...(canReadTemplates ? [{ key: 'letters', label: 'Letter templates', icon: 'clipboard' }] : []),
  ]
  const [tab, setTab] = useView(views.map((v) => v.key)) as [Tab, (k: string) => void]
  return (
    <ModulePage crumb="Documents" title="Documents" subtitle={canRead ? 'Everyone’s paperwork in one place: contracts, ID proofs, certificates and tax forms.' : 'Your copy of the paperwork HR holds for you.'}
      actions={canWrite ? <><HrButton variant="ghost" onClick={() => setBulk(true)}><Upload size={15} /> Bulk upload</HrButton><HrButton onClick={() => setAdding(true)}><Plus size={15} /> Add document</HrButton></> : undefined}>
      <div style={{ display: 'grid', gap: 16, minWidth: 0 }}>
        {views.length > 1 && <Views items={views} active={tab} onChange={setTab} label="Document views" />}
        {views.length === 0 && (canWrite ? <Note>Use “Add document” to store a document on someone’s file.</Note> : <State kind="empty" icon="lock" title="No document access" description="Ask an admin if you should see documents." />)}
        {tab === 'my' && canReadSelf && <MyDocumentsTab />}
        {tab === 'all' && canRead && <AllDocumentsTab toast={show} />}
        {tab === 'letters' && canReadTemplates && <LetterTemplates />}
      </div>
      {adding && <AddDocumentDrawer onClose={() => setAdding(false)} toast={show} />}
      {bulk && <BulkUploadDrawer onClose={() => setBulk(false)} toast={show} />}
      {node}
    </ModulePage>
  )
}

function DocumentTable({ documents, isLoading, showOwner, onDelete, onEdit, footer, emptyTitle, emptyHint }: {
  documents: EmployeeDocumentV2[]; isLoading: boolean; showOwner?: boolean; onDelete?: (d: EmployeeDocument) => void; onEdit?: (d: EmployeeDocumentV2) => void; footer?: React.ReactNode; emptyTitle: string; emptyHint: string
}) {
  if (isLoading) return <State kind="loading" height={200} />
  if (!documents.length) return <State kind="empty" icon="fileText" title={emptyTitle} description={emptyHint} />
  return (
    <TableCard footer={footer}>
      <table className="hr-table">
        <thead><tr>{showOwner && <th>Employee</th>}<th>Document</th><th>Type</th><th className="hidden sm:table-cell">Issued</th><th>Expiry</th><th className="hidden md:table-cell">Review</th>{(onDelete || onEdit) && <th><span className="sr-only">Actions</span></th>}</tr></thead>
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
                {(onDelete || onEdit) && <td className="text-right"><div className="flex flex-wrap justify-end gap-1">
                  {onEdit && <HrButton size="sm" variant="ghost" onClick={() => onEdit(d)} aria-label={`Edit ${d.title}`}>Edit</HrButton>}
                  {onDelete && <HrButton size="sm" variant="ghost" onClick={() => onDelete(d)} aria-label={`Delete ${d.title}`}>Delete</HrButton>}
                </div></td>}
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
  const [editing, setEditing] = useState<EmployeeDocumentV2 | null>(null)
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
            <DocumentTable documents={documents} isLoading={isLoading} showOwner onDelete={canWrite ? onDelete : undefined} onEdit={canWrite ? setEditing : undefined}
              emptyTitle="No documents on their file yet"
              emptyHint={canWrite ? 'Use “Add document” to store their offer letter, contract, ID proofs or certificates. They see them under My documents.' : 'Nothing has been added to their file yet.'}
              footer={hrPaginationFooter({ page, pageSize, totalElements: total, totalPages, onPageChange: setPage, onPageSizeChange: setPageSize })} />
          </>}
      {editing && <EditDocumentDrawer doc={editing} onClose={() => setEditing(null)} toast={toast} />}
    </div>
  )
}

/**
 * Edit a stored document: title, type, category, dates, notes, and the file
 * itself (PUT /v1/document/documents/{id}). The server re-checks every rule:
 * a newly chosen type must be active and fit the file that stays.
 */
function EditDocumentDrawer({ doc, onClose, toast }: { doc: EmployeeDocumentV2; onClose: () => void; toast: Toast }) {
  const edit = useEditDocument()
  const types = useDocumentTypes(true)
  const all = types.data ?? []
  // Active types to choose from, plus the document's own type if HR has since switched it off.
  const options = all.filter((t) => t.active || t.id === doc.documentTypeId)
  // An uploaded file (vs a pasted link). Older uploads carry no file facts, but their link is
  // either absent (storage not set up here) or a signed storage link, never a link HR typed.
  const storedFile = !!doc.contentType || !!doc.originalFilename || !doc.fileUrl || /[?&]X-Amz-Signature=/i.test(doc.fileUrl)
  const [typeId, setTypeId] = useState(doc.documentTypeId || '')
  const [title, setTitle] = useState(doc.title)
  const [category, setCategory] = useState<DocumentCategory>(doc.category)
  const [issuedDate, setIssuedDate] = useState(doc.issuedDate || '')
  const [expiryDate, setExpiryDate] = useState(doc.expiryDate || '')
  const [notes, setNotes] = useState(doc.notes || '')
  const [link, setLink] = useState(!storedFile ? doc.fileUrl || '' : '')
  const [file, setFile] = useState<File | null>(null)
  const type = all.find((t) => t.id === typeId)
  const formats = typeFormats(type)
  const onType = (id: string) => { setTypeId(id); const t = all.find((x) => x.id === id); if (t) setCategory(categoryForType(t.code)) }
  const submit = async () => {
    if (!title.trim()) { toast('Give the document a title', true); return }
    if (issuedDate && expiryDate && expiryDate < issuedDate) { toast('The expiry date is before the issue date', true); return }
    if (file) { const problem = fileProblem(file, type); if (problem) { toast(problem, true); return } }
    if (!storedFile && !file && link.trim() && !/^https?:\/\//i.test(link.trim())) { toast('Enter a link starting with http:// or https://', true); return }
    try {
      await edit.mutateAsync({
        id: doc.id, title: title.trim(), category, documentTypeId: typeId || null,
        issuedDate: issuedDate || null, expiryDate: expiryDate || null, notes: notes.trim() || null,
        // Only a link HR actually changed is sent; the server keeps the stored one otherwise.
        fileUrl: !storedFile && !file && link.trim() && link.trim() !== (doc.fileUrl || '') ? link.trim() : undefined, file,
      })
      toast('Document updated', false, file ? 'The new file replaced the old one and is marked verified.' : undefined)
      onClose()
    } catch (e) { toast('Couldn’t update the document', true, (e as Error)?.message) }
  }
  return (
    <HrDrawer title={`Edit “${doc.title}”`} onClose={() => { if (!edit.isPending) onClose() }} width="max-w-xl"
      footer={<><HrButton variant="ghost" onClick={onClose} disabled={edit.isPending}>Cancel</HrButton><HrButton onClick={submit} disabled={edit.isPending}>{edit.isPending ? 'Saving…' : 'Save changes'}</HrButton></>}>
      <div className="space-y-4">
        <p className="text-sm text-text-secondary">{doc.employeeName ? `On ${doc.employeeName}’s file.` : 'On the employee’s file.'} {doc.originalFilename ? `Stored file: ${doc.originalFilename}.` : ''}</p>
        <div><label className={label} htmlFor="edit-doc-type">Document type</label>
          <select id="edit-doc-type" value={typeId} onChange={(e) => onType(e.target.value)} className="ut-select">
            <option value="">Other (free-form)</option>
            {options.map((t) => <option key={t.id} value={t.id}>{t.displayName}{t.active ? '' : ' (switched off)'}</option>)}
          </select>
          {type && <p className="mt-1 text-xs text-text-tertiary">{`${formats.join(', ').toUpperCase()} · up to ${type.maxSizeMb} MB${type.expiryTracked ? ' · has an expiry date' : ''}`}</p>}
        </div>
        <div><label className={label} htmlFor="edit-doc-title">Title</label><input id="edit-doc-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} className="ut-input" /></div>
        <div className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-3">
          <div><label className={label} htmlFor="edit-doc-cat">Category</label><select id="edit-doc-cat" value={category} onChange={(e) => setCategory(e.target.value as DocumentCategory)} className="ut-select">{DOCUMENT_CATEGORIES.map((c) => <option key={c} value={c}>{fmtCat(c)}</option>)}</select></div>
          <div><label className={label} htmlFor="edit-doc-issued">Issued</label><DateField id="edit-doc-issued" value={issuedDate} onChange={(e) => setIssuedDate(e.target.value)} className="ut-input" format="short" clearable /></div>
          <div><label className={label} htmlFor="edit-doc-exp">Expires</label><DateField id="edit-doc-exp" min={issuedDate || undefined} toYear={EXPIRY_TO_YEAR} value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} className="ut-input" format="short" clearable /></div>
        </div>
        <div><label className={label} htmlFor="edit-doc-notes">Notes</label><textarea id="edit-doc-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={2000} placeholder="Optional" className="ut-input resize-y" /></div>
        {!storedFile && !file && <div><label className={label} htmlFor="edit-doc-url">Link</label><input id="edit-doc-url" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://…" className="ut-input" /></div>}
        <div><label className={label} htmlFor="edit-doc-file">{storedFile ? 'Replace the file' : 'Upload a file instead'}</label>
          <input id="edit-doc-file" type="file" accept={formats.map((f) => `.${f}`).join(',')} className="text-[13px]" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <p className="mt-1 text-xs text-text-tertiary">{`Optional. ${formats.join(', ').toUpperCase()}, up to ${type?.maxSizeMb ?? 10} MB.`}</p></div>
        {file && <Note tone="amber">Saving replaces the stored file for good: the old file is deleted, and the new one is marked verified because HR added it. The employee sees the new file under My documents.</Note>}
      </div>
    </HrDrawer>
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
          <div><label className={label} htmlFor="doc-issued">Issued</label><DateField id="doc-issued" value={issuedDate} onChange={(e) => setIssuedDate(e.target.value)} className="ut-input" format="short" clearable /></div>
          <div><label className={label} htmlFor="doc-exp">Expires</label><DateField id="doc-exp" min={issuedDate || undefined} toYear={EXPIRY_TO_YEAR} value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} className="ut-input" format="short" clearable /></div>
        </div>
        <div><label className={label} htmlFor="doc-notes">Notes</label><textarea id="doc-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Optional" className="ut-input resize-y" /></div>
        <Note>Documents HR adds are marked verified straight away. Documents employees upload themselves wait under Docs to review.</Note>
      </div>
    </HrDrawer>
  )
}

/** One file waiting in the bulk upload list. */
interface BulkRow {
  key: string
  file: File
  employee: { id: string; name: string }
  typeId: string
  title: string
  state: 'ready' | 'uploading' | 'done' | 'failed'
  error: string
}
const MAX_BULK = 25

/**
 * Bulk upload: several files at once, each assigned to an employee and a
 * document type. Every file goes through the same upload endpoint as a single
 * add (POST /v1/document/upload), one at a time, so each stays under the upload
 * limit and the server enforces its type's formats and size. Rows that fail
 * keep their reason and can be retried; stored rows are marked done.
 */
function BulkUploadDrawer({ onClose, toast }: { onClose: () => void; toast: Toast }) {
  const qc = useQueryClient()
  const types = useDocumentTypes()
  const active = (types.data ?? []).filter((t) => t.active)
  const [rows, setRows] = useState<BulkRow[]>([])
  const [defaultEmployee, setDefaultEmployee] = useState({ id: '', name: '' })
  const [defaultTypeId, setDefaultTypeId] = useState('')
  const [picking, setPicking] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const typeOf = (id: string): DocumentType | undefined => active.find((t) => t.id === id)
  const problemOf = (r: BulkRow) => !r.employee.id ? 'Pick whose file this goes on' : !r.typeId ? 'Pick a document type' : !r.title.trim() ? 'Give it a title' : fileProblem(r.file, typeOf(r.typeId))
  const set = (key: string, patch: Partial<BulkRow>) => setRows((all) => all.map((r) => (r.key === key ? { ...r, ...patch, state: patch.state ?? (r.state === 'done' ? 'done' : 'ready'), error: patch.error ?? '' } : r)))
  const addFiles = (files: FileList | null) => {
    if (!files?.length) return
    const room = MAX_BULK - rows.length
    if (files.length > room) toast(`Up to ${MAX_BULK} files at a time; the first ${Math.max(room, 0)} were added`, true)
    const t = typeOf(defaultTypeId)
    const added = Array.from(files).slice(0, Math.max(room, 0)).map((file, i) => ({
      key: `${Date.now()}-${i}-${file.name}`, file, employee: { ...defaultEmployee }, typeId: defaultTypeId,
      title: t ? t.displayName : file.name.replace(/\.[^.]+$/, ''), state: 'ready' as const, error: '',
    }))
    setRows((all) => [...all, ...added])
    if (input.current) input.current.value = ''
  }
  const pending = rows.filter((r) => r.state !== 'done')
  const blocked = pending.filter((r) => problemOf(r))
  const uploadAll = async () => {
    if (!pending.length) return
    if (blocked.length) { toast(`${blocked.length} ${blocked.length === 1 ? 'file needs' : 'files need'} fixing first`, true, problemOf(blocked[0])); return }
    setRunning(true)
    let stored = 0, failed = 0
    for (const r of pending) {
      set(r.key, { state: 'uploading' })
      const t = typeOf(r.typeId)
      const body = new FormData()
      body.append('file', r.file)
      body.append('metadata', new Blob([JSON.stringify({ employeeId: r.employee.id, title: r.title.trim(), category: categoryForType(t?.code), documentTypeId: r.typeId })], { type: 'application/json' }))
      try {
        await apiJson('/v1/document/upload', { method: 'POST', body })
        stored++; set(r.key, { state: 'done' })
      } catch (e) {
        failed++; set(r.key, { state: 'failed', error: (e as Error)?.message || 'Upload failed' })
      }
    }
    setRunning(false)
    await qc.invalidateQueries({ queryKey: ['hrms', 'document'] })
    if (failed) toast(`${stored} stored, ${failed} failed`, true, 'The failed files keep their reason below. Fix them and upload again.')
    else toast(`${stored} ${stored === 1 ? 'document' : 'documents'} stored`, false, 'Each is on the employee’s file, marked verified.')
  }
  const TONE: Record<BulkRow['state'], [string, PillTone]> = { ready: ['Ready', 'gray'], uploading: ['Uploading…', 'info'], done: ['Stored', 'ok'], failed: ['Failed', 'red'] }
  return (
    <HrDrawer title="Bulk upload documents" onClose={() => { if (!running) onClose() }} width="max-w-2xl"
      footer={<><HrButton variant="ghost" onClick={onClose} disabled={running}>{rows.length && !pending.length ? 'Done' : 'Cancel'}</HrButton><HrButton onClick={uploadAll} disabled={running || !pending.length}>{running ? 'Uploading…' : `Upload ${pending.length || ''} ${pending.length === 1 ? 'document' : 'documents'}`.replace('  ', ' ')}</HrButton></>}>
      <div className="space-y-4">
        <p className="text-sm text-text-secondary">Add several files at once. Each goes on one employee’s file under a document type, and must meet that type’s formats and size. Documents HR uploads are marked verified.</p>
        <Panel title="Defaults for new files" sub="Optional. Files you add next start with these; change any row below.">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div><span className={label}>Employee</span>
              {picking === 'default'
                ? <EmployeePicker value={defaultEmployee.id} selectedLabel={defaultEmployee.name} onChange={(e) => { setDefaultEmployee({ id: e.id, name: `${e.firstName} ${e.lastName || ''}`.trim() }); setPicking(null) }} />
                : <div className="flex flex-wrap items-center gap-2"><span className="text-sm">{defaultEmployee.name || 'None'}</span><HrButton size="sm" variant="ghost" onClick={() => setPicking('default')}>{defaultEmployee.id ? 'Change' : 'Choose'}</HrButton></div>}
            </div>
            <div><label className={label} htmlFor="bulk-default-type">Document type</label>
              <select id="bulk-default-type" value={defaultTypeId} onChange={(e) => setDefaultTypeId(e.target.value)} className="ut-select">
                <option value="">Choose per file</option>
                {active.map((t) => <option key={t.id} value={t.id}>{t.displayName}</option>)}
              </select></div>
          </div>
        </Panel>
        <div><label className={label} htmlFor="bulk-files">Files</label>
          <input id="bulk-files" ref={input} type="file" multiple accept=".pdf,.png,.jpg,.jpeg" className="text-[13px]" disabled={running || rows.length >= MAX_BULK} onChange={(e) => addFiles(e.target.files)} />
          <p className="mt-1 text-xs text-text-tertiary">{`PDF, PNG or JPEG. Up to ${MAX_BULK} files at a time; each type sets its own formats and size limit.`}</p></div>
        {active.length === 0 && !types.isLoading && <Note tone="amber">No document types are switched on. Add or switch one on under HR setup before uploading.</Note>}
        {rows.map((r, i) => {
          const t = typeOf(r.typeId), problem = r.state !== 'done' ? problemOf(r) : ''
          const locked = running || r.state === 'done'
          return (
            <div key={r.key} className="ut-card p-4" style={{ borderRadius: 16 }}>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 truncate text-sm font-semibold text-text-primary" title={r.file.name}>{i + 1}. {r.file.name} <span className="font-normal text-text-tertiary">· {(r.file.size / 1024 / 1024).toFixed(1)} MB</span></span>
                <span className="flex items-center gap-2"><HrStatusPill tone={TONE[r.state][1]}>{TONE[r.state][0]}</HrStatusPill>
                  {!locked && <button type="button" onClick={() => setRows((all) => all.filter((x) => x.key !== r.key))} className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-tertiary)] transition-colors hover:bg-[#FEE2E2] hover:text-[#B91C1C]" aria-label={`Remove ${r.file.name}`}><Trash2 size={14} /></button>}</span>
              </div>
              <div className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2">
                <div><span className={label}>Employee</span>
                  {picking === r.key && !locked
                    ? <EmployeePicker value={r.employee.id} selectedLabel={r.employee.name} onChange={(e) => { set(r.key, { employee: { id: e.id, name: `${e.firstName} ${e.lastName || ''}`.trim() } }); setPicking(null) }} />
                    : <div className="flex flex-wrap items-center gap-2"><span className="text-sm">{r.employee.name || 'Not chosen'}</span>{!locked && <HrButton size="sm" variant="ghost" onClick={() => setPicking(r.key)}>{r.employee.id ? 'Change' : 'Choose'}</HrButton>}</div>}
                </div>
                <div><label className={label} htmlFor={`bulk-type-${r.key}`}>Document type</label>
                  <select id={`bulk-type-${r.key}`} value={r.typeId} disabled={locked} onChange={(e) => { const nt = typeOf(e.target.value); set(r.key, { typeId: e.target.value, ...(nt && (!r.title.trim() || r.title === t?.displayName || r.title === r.file.name.replace(/\.[^.]+$/, '')) ? { title: nt.displayName } : {}) }) }} className="ut-select">
                    <option value="">Choose a type</option>
                    {active.map((x) => <option key={x.id} value={x.id}>{x.displayName}</option>)}
                  </select>
                  {t && <p className="mt-1 text-xs text-text-tertiary">{`${typeFormats(t).join(', ').toUpperCase()} · up to ${t.maxSizeMb} MB`}</p>}</div>
                <div className="sm:col-span-2"><label className={label} htmlFor={`bulk-title-${r.key}`}>Title</label>
                  <input id={`bulk-title-${r.key}`} value={r.title} disabled={locked} maxLength={300} onChange={(e) => set(r.key, { title: e.target.value })} className="ut-input" /></div>
              </div>
              {(r.error || problem) && <p role={r.error ? 'alert' : undefined} className="mt-2 text-xs font-semibold text-[#b91c1c]">{r.error || problem}</p>}
            </div>
          )
        })}
      </div>
    </HrDrawer>
  )
}
