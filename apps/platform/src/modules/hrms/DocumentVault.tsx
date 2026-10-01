// Employee vault (/hrms/documents) on the kit (P-DOCS; prototypes PgTalent h-vault
// and EmpDocs e-files). Views as inline pill tabs, today's names and order:
//   - My documents (hrms.document.read.self): your own file, as cards; upload your own.
//   - Employee documents (hrms.document.read): counts across everyone (BW-77), then
//     whose file, that person's department and counts, and their documents.
//   - Letter templates (hrms.letters.template.read): kept, as today.
// hrms.document.write: Add document (a file, typed or free-form, or an existing
// link), Edit (details, type, or replace the file), Bulk upload and Delete.
// File links come back signed from the API; when document storage isn't set up
// the API returns no link, and the row says so instead of a dead link.
import React, { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { usePermission } from '@unifiedtree/sdk'
import {
  Button, Callout, CellActions, CellStack, EmptyState, KeyValueGrid, MiniStat, MiniStatGrid, PageFrame, PageHeader, PillTabs,
  Section, StatusPill, Table, type TableColumn,
} from '@/design/kit/display'
import { Pager, SectionCell, SectionGrid, UploadDrop, UploadFile } from '@/design/kit/data'
import { DateInput, FieldGrid, Input, PanelButton, Select, SidePanel, Textarea, useToast } from '@/design/kit/overlays'
import { todayIso, useView } from '@/design/module/ModuleKit'
import { useConfirmDialog } from '@/shared/components/ConfirmDialog'
import { apiJson } from '@/core/api/client'
import { LetterTemplates } from './letters/LetterTemplates'
import { PersonSearch, fullName } from './letters/components/PersonSearch'
import { MyDocuments } from './vault/MyDocuments'
import { day, expiryState, reviewPill } from './vault/vaultModel'
import {
  useEmployeeDocuments, useCreateDocument, useDeleteDocument, useDocumentTypes, useEditDocument,
  useDocumentSummary, useEmployeeDocumentSummary,
  categoryForType, typeFormats, fileProblem,
  DOCUMENT_CATEGORIES, DOCUMENT_PAGE_SIZE,
  type DocumentCategory, type DocumentType, type EmployeeDocumentV2,
} from './api/useDocument'
import './letters/components/letters.css'

const fmtCat = (c: string) => c.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (m) => m.toUpperCase())
const CATEGORY_OPTIONS = DOCUMENT_CATEGORIES.map((c) => ({ value: c, label: fmtCat(c) }))
/** Expiry pickers reach decades ahead (IDs and licences can run 20+ years). */
const EXPIRY_TO_YEAR = new Date().getFullYear() + 50

type Tab = 'my' | 'all' | 'letters'
const SUB: Record<Tab, string> = {
  my: 'Your copy of the paperwork HR holds for you. Payroll uses the verified ones.',
  all: 'The paperwork HR holds for each person.',
  letters: 'Reusable letters with merge fields. They live under Letters too.',
}

export const DocumentVault: React.FC = () => {
  const canReadTemplates = usePermission('hrms.letters.template.read')
  const canReadSelf = usePermission('hrms.document.read.self')
  const canRead = usePermission('hrms.document.read')
  const canWrite = usePermission('hrms.document.write')
  const [adding, setAdding] = useState(false)
  const [bulk, setBulk] = useState(false)
  const views = [
    ...(canReadSelf ? [{ key: 'my', label: 'My documents' }] : []),
    ...(canRead ? [{ key: 'all', label: 'Employee documents' }] : []),
    ...(canReadTemplates ? [{ key: 'letters', label: 'Letter templates' }] : []),
  ]
  const [tab, setTab] = useView(views.map((v) => v.key)) as [Tab, (k: string) => void]
  const onlyMine = views.length === 1 && views[0].key === 'my'
  return (
    <PageFrame label="Employee vault" width={onlyMine ? 'narrow' : 'wide'} className="lt-page">
      <PageHeader eyebrow={onlyMine ? undefined : 'Hiring & onboarding'} title={onlyMine ? 'My documents' : 'Employee vault'}
        sub={views.length ? SUB[tab] : undefined}
        actions={canWrite ? <><Button variant="secondary" icon="upload" onClick={() => setBulk(true)}>Bulk upload</Button><Button variant="primary" icon="plus" onClick={() => setAdding(true)}>Add document</Button></> : undefined} />
      {views.length > 1 && <PillTabs label="Document views" semantics="toggle" activeKey={tab} onSelect={setTab} items={views} />}
      {views.length === 0 && (canWrite ? <Callout tone="neutral">Use “Add document” to store a document on someone’s file.</Callout>
        : <EmptyState icon="lock" title="No document access" hint="Ask an admin if you should see documents." />)}
      {tab === 'my' && canReadSelf && <MyDocuments />}
      {tab === 'all' && canRead && <AllDocumentsTab />}
      {tab === 'letters' && canReadTemplates && <LetterTemplates />}
      {adding && <AddDocumentPanel onClose={() => setAdding(false)} />}
      {bulk && <BulkUploadPanel onClose={() => setBulk(false)} />}
    </PageFrame>
  )
}

/** Counts across every employee's documents (BW-77). Hidden on servers that don't have them. */
function WorkspaceCounts() {
  const canVerify = usePermission('hrms.document.verify')
  const q = useDocumentSummary()
  if (q.notAvailable) return null
  const s = q.data
  return (
    <Section title={s?.people != null ? `Across ${s.people} ${s.people === 1 ? 'person' : 'people'}` : 'Across everyone'} body="tight" cardClass={false}
      loading={q.isLoading} skeleton="stats" error={q.error} onRetry={() => q.refetch()}>
      {s && (
        <MiniStatGrid>
          <MiniStat label="On file" value={s.onFile} note="Documents" tone="neutral" />
          <MiniStat label="Expiring soon" value={s.expiringSoon} note="Within 30 days" tone="warning" />
          <MiniStat label="Expired" value={s.expired} note="Needs a new copy" tone="danger" />
          {canVerify && s.waitingForReview != null && <MiniStat label="Waiting for review" value={s.waitingForReview} note="In Docs to review" tone="info" />}
        </MiniStatGrid>
      )}
    </Section>
  )
}

function AllDocumentsTab() {
  const toast = useToast()
  const confirm = useConfirmDialog()
  const canWrite = usePermission('hrms.document.write')
  const [employee, setEmployee] = useState({ id: '', name: '' })
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(DOCUMENT_PAGE_SIZE)
  const { data, isLoading, error, refetch, isFetching } = useEmployeeDocuments(employee.id || undefined, page, true, pageSize)
  const summary = useEmployeeDocumentSummary(employee.id || undefined)
  const documents = (data?.content ?? []) as EmployeeDocumentV2[]
  const total = data?.totalElements ?? 0
  const remove = useDeleteDocument()
  const [editing, setEditing] = useState<EmployeeDocumentV2 | null>(null)
  const today = todayIso()

  const onDelete = async (d: EmployeeDocumentV2) => {
    const ok = await confirm({ title: `Delete “${d.title}”?`, body: 'This can’t be undone, and it disappears from their My documents too.', confirmLabel: 'Delete', tone: 'danger' })
    if (!ok) return
    try { await remove.mutateAsync(d.id); toast.success('Document deleted') } catch (e) { toast.error('Couldn’t delete the document', { detail: (e as Error)?.message }) }
  }

  const columns: TableColumn<EmployeeDocumentV2>[] = [
    {
      key: 'doc', header: 'Document', primary: true, render: (d) => (
        <CellStack primary={d.fileUrl ? <a href={d.fileUrl} target="_blank" rel="noreferrer" className="lt-doclink">{`${d.title} ↗`}</a> : d.title}
          secondary={d.verificationStatus === 'REJECTED' && d.rejectionReason ? <span className="lt-danger-text">{d.rejectionReason}</span>
            : !d.fileUrl ? 'File can’t be opened here (document storage isn’t set up)' : undefined} />
      ),
    },
    { key: 'type', header: 'Type', render: (d) => d.documentTypeName || fmtCat(d.category) },
    { key: 'issued', header: 'Issued', render: (d) => day(d.issuedDate) },
    {
      key: 'expiry', header: 'Expiry', render: (d) => {
        const e = expiryState(d.expiryDate, today)
        return d.expiryDate ? <span className="lt-pills">{day(d.expiryDate)}{e && !e.expired && <StatusPill tone={e.tone}>{e.label}</StatusPill>}</span> : '—'
      },
    },
    { key: 'review', header: 'Review', render: (d) => { const p = reviewPill(d, today); return p ? <StatusPill tone={p.tone}>{p.label}</StatusPill> : '—' } },
    ...(canWrite ? [{
      key: 'actions', header: <span className="sr-only">Actions</span>, label: 'Actions', align: 'right' as const,
      render: (d: EmployeeDocumentV2) => (
        <CellActions>
          <Button size={30} variant="secondary" onClick={() => setEditing(d)} aria-label={`Edit ${d.title}`}>Edit</Button>
          <Button size={30} variant="secondary" onClick={() => onDelete(d)} aria-label={`Delete ${d.title}`}>Delete</Button>
        </CellActions>
      ),
    }] : []),
  ]

  const s = summary.data
  return (
    <div className="lt-stack">
      <WorkspaceCounts />
      <SectionGrid>
        <SectionCell width="half">
          <Section title="Whose file?" sub={employee.id ? `Showing ${employee.name}` : 'Search by name, code or email.'} cardClass={false}>
            <PersonSearch selectedId={employee.id} onPick={(e) => { setEmployee({ id: e.id, name: fullName(e) }); setPage(0) }} />
          </Section>
        </SectionCell>
        <SectionCell width="half">
          <Section title={employee.name || 'No one picked yet'} cardClass={false} loading={!!employee.id && summary.isLoading} skeleton="text"
            empty={!employee.id ? { title: 'Pick someone to see their file', icon: 'users' } : undefined}>
            {employee.id && (
              <KeyValueGrid items={[
                ...(s?.departmentName !== undefined ? [{ label: 'Department', value: s?.departmentName }] : []),
                { label: 'On file', value: `${s?.onFile ?? total} ${(s?.onFile ?? total) === 1 ? 'document' : 'documents'}` },
                ...(s ? [{ label: 'Expired', value: s.expiredTitles.length ? s.expiredTitles.join(', ') : 'None' }] : []),
                ...(s && s.expiringSoon ? [{ label: 'Expiring soon', value: s.expiringTitles.join(', ') }] : []),
              ]} />
            )}
          </Section>
        </SectionCell>
      </SectionGrid>
      {employee.id && (
        <Section title={`${employee.name}’s file`} body="flush" cardClass={false}
          loading={isLoading} skeleton="table" error={error} onRetry={() => refetch()} retrying={isFetching}
          empty={!isLoading && !error && documents.length === 0 ? {
            title: 'No documents on their file yet',
            hint: canWrite ? 'Use “Add document” to store their offer letter, contract, ID proofs or certificates. They see them under My documents.' : 'Nothing has been added to their file yet.',
          } : undefined}
          footer={total > 0 ? <Pager page={page} pageSize={pageSize} total={total} onPageChange={setPage}
            onPageSizeChange={(n) => { setPageSize(n); setPage(0) }} pageSizes={[20, 50, 100]} noun="documents" /> : undefined}>
          <Table label={`${employee.name}’s documents`} columns={columns} rows={documents} rowKey={(d) => d.id} mobile="cards" />
        </Section>
      )}
      {editing && <EditDocumentPanel doc={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

/**
 * Edit a stored document: title, type, category, dates, notes, and the file
 * itself (PUT /v1/document/documents/{id}). The server re-checks every rule:
 * a newly chosen type must be active and fit the file that stays.
 */
function EditDocumentPanel({ doc, onClose }: { doc: EmployeeDocumentV2; onClose: () => void }) {
  const toast = useToast()
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
    if (!title.trim()) { toast.error('Give the document a title'); return }
    if (issuedDate && expiryDate && expiryDate < issuedDate) { toast.error('The expiry date is before the issue date'); return }
    if (file) { const problem = fileProblem(file, type); if (problem) { toast.error(problem); return } }
    if (!storedFile && !file && link.trim() && !/^https?:\/\//i.test(link.trim())) { toast.error('Enter a link starting with http:// or https://'); return }
    try {
      await edit.mutateAsync({
        id: doc.id, title: title.trim(), category, documentTypeId: typeId || null,
        issuedDate: issuedDate || null, expiryDate: expiryDate || null, notes: notes.trim() || null,
        // Only a link HR actually changed is sent; the server keeps the stored one otherwise.
        fileUrl: !storedFile && !file && link.trim() && link.trim() !== (doc.fileUrl || '') ? link.trim() : undefined, file,
      })
      toast.success('Document updated', file ? { detail: 'The new file replaced the old one and is marked verified.' } : undefined)
      onClose()
    } catch (e) { toast.error('Couldn’t update the document', { detail: (e as Error)?.message }) }
  }
  return (
    <SidePanel open onClose={() => { if (!edit.isPending) onClose() }} width={600} busy={edit.isPending} closeLabel="Close panel"
      title={`Edit “${doc.title}”`} sub={`${doc.employeeName ? `On ${doc.employeeName}’s file.` : 'On the employee’s file.'}${doc.originalFilename ? ` Stored file: ${doc.originalFilename}.` : ''}`}
      footer={<><PanelButton size="lg" onClick={onClose} disabled={edit.isPending}>Cancel</PanelButton><PanelButton size="lg" variant="primary" busy={edit.isPending} onClick={submit}>Save changes</PanelButton></>}>
      <FieldGrid columns={2}>
        <Select id="edit-doc-type" label="Document type" full value={typeId} onChange={(e) => onType(e.target.value)}
          options={[{ value: '', label: 'Other (free-form)' }, ...options.map((t) => ({ value: t.id, label: `${t.displayName}${t.active ? '' : ' (switched off)'}` }))]}
          hint={type ? `${formats.join(', ').toUpperCase()} · up to ${type.maxSizeMb} MB${type.expiryTracked ? ' · has an expiry date' : ''}` : undefined} />
        <Input id="edit-doc-title" label="Title" full value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} />
        <Select id="edit-doc-cat" label="Category" value={category} onChange={(e) => setCategory(e.target.value as DocumentCategory)} options={CATEGORY_OPTIONS} />
        <DateInput id="edit-doc-issued" label="Issued" value={issuedDate} onChange={(e) => setIssuedDate(e.target.value)} clearable />
        <DateInput id="edit-doc-exp" label="Expires" min={issuedDate || undefined} toYear={EXPIRY_TO_YEAR} value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} clearable />
        <Textarea id="edit-doc-notes" label="Notes" full value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={2000} placeholder="Optional" />
        {!storedFile && !file && <Input id="edit-doc-url" label="Link" full value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://…" />}
      </FieldGrid>
      <div className="lt-stack" style={{ marginTop: 16 }}>
        <p className="lt-label">{storedFile ? 'Replace the file' : 'Upload a file instead'}</p>
        {file ? <UploadFile name={file.name} size={file.size} onRemove={() => setFile(null)} />
          : <UploadDrop variant="box" accept={formats.map((f) => `.${f}`).join(',')} title="Drop a file here, or click to choose it"
            hint={`Optional. ${formats.join(', ').toUpperCase()}, up to ${type?.maxSizeMb ?? 10} MB.`} onFiles={(f) => setFile(f[0] ?? null)}
            onReject={(r) => toast.error(r[0]?.message ?? 'That file can’t be used')} ariaLabel={storedFile ? 'Replace the file' : 'Upload a file instead'} />}
        {file && <Callout tone="warning">Saving replaces the stored file for good: the old file is deleted, and the new one is marked verified because HR added it. The employee sees the new file under My documents.</Callout>}
      </div>
    </SidePanel>
  )
}

function AddDocumentPanel({ onClose }: { onClose: () => void }) {
  const toast = useToast()
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
    if (!employee.id) { toast.error('Pick whose document this is'); return }
    if (!title.trim()) { toast.error('Give the document a title'); return }
    if (!file && !fileUrl.trim()) { toast.error('Choose a file or paste a link'); return }
    if (file) {
      const ext = file.name.split('.').pop()?.toLowerCase() || ''
      if (!formats.includes(ext)) { toast.error(`Use one of: ${formats.join(', ').toUpperCase()}`); return }
      if (file.size > maxMb * 1024 * 1024) { toast.error(`The file must be ${maxMb} MB or smaller`); return }
    }
    if (!file && !/^https?:\/\//i.test(fileUrl.trim())) { toast.error('Enter a link starting with http:// or https://'); return }
    if (issuedDate && expiryDate && expiryDate < issuedDate) { toast.error('The expiry date is before the issue date'); return }
    try {
      await create.mutateAsync({ employeeId: employee.id, title: title.trim(), category, fileUrl: fileUrl.trim(), file: file ?? undefined, issuedDate: issuedDate || undefined, expiryDate: expiryDate || undefined, notes: notes.trim() || undefined, ...(file && typeId ? { documentTypeId: typeId } : {}) })
      toast.success('Document stored', { detail: `It’s on ${employee.name}’s file and they can see it under My documents.` })
      onClose()
    } catch (e) { toast.error('Couldn’t store the document', { detail: (e as Error)?.message }) }
  }
  return (
    <SidePanel open onClose={() => { if (!create.isPending) onClose() }} width={600} busy={create.isPending} closeLabel="Close panel"
      title="Add a document" sub="Whose file, what it is and when it expires."
      footer={<><PanelButton size="lg" onClick={onClose} disabled={create.isPending}>Cancel</PanelButton><PanelButton size="lg" variant="primary" busy={create.isPending} onClick={submit}>Store document</PanelButton></>}>
      <div className="lt-stack">
        <div className="lt-field-block">
          <p className="lt-label">Whose file</p>
          {employee.id && <p className="lt-chosen"><strong>{employee.name}</strong></p>}
          <PersonSearch selectedId={employee.id} onPick={(e) => setEmployee({ id: e.id, name: fullName(e) })} />
        </div>
        <FieldGrid columns={2}>
          {activeTypes.length > 0 && (
            <Select id="doc-type" label="Document type" full value={typeId}
              onChange={(e) => { setTypeId(e.target.value); const t = activeTypes.find((x) => x.id === e.target.value); if (t && !title.trim()) setTitle(t.displayName) }}
              options={[{ value: '', label: 'Other (free-form)' }, ...activeTypes.map((t) => ({ value: t.id, label: t.displayName }))]}
              hint={type ? `${formats.join(', ').toUpperCase()} · up to ${maxMb} MB${type.expiryTracked ? ' · has an expiry date' : ''}` : undefined} />
          )}
          <Input id="doc-title" label="Title" full value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Employment contract 2026" />
          <Select id="doc-cat" label="Category" value={category} onChange={(e) => setCategory(e.target.value as DocumentCategory)} options={CATEGORY_OPTIONS} />
          <DateInput id="doc-issued" label="Issued" value={issuedDate} onChange={(e) => setIssuedDate(e.target.value)} clearable />
          <DateInput id="doc-exp" label="Expires" min={issuedDate || undefined} toYear={EXPIRY_TO_YEAR} value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} clearable />
        </FieldGrid>
        <div className="lt-field-block">
          <p className="lt-label">File</p>
          {file ? <UploadFile name={file.name} size={file.size} onRemove={() => setFile(null)} />
            : <UploadDrop variant="box" accept={formats.map((f) => `.${f}`).join(',')} maxSize={maxMb * 1024 * 1024} title="Drop a file here, or click to choose it"
              hint={`${formats.join(', ').toUpperCase()}, up to ${maxMb} MB. Or paste a link below instead.`} onFiles={(f) => setFile(f[0] ?? null)}
              onReject={(r) => toast.error(r[0]?.message ?? 'That file can’t be used')} ariaLabel="Choose the file" />}
        </div>
        {!file && <Input id="doc-url" label="Or a link to an existing document" full value={fileUrl} onChange={(e) => setFileUrl(e.target.value)} placeholder="https://…" />}
        <Textarea id="doc-notes" label="Notes" full value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Optional" />
        <Callout tone="neutral">Documents HR adds are marked verified straight away. Documents employees upload themselves wait under Docs to review.</Callout>
      </div>
    </SidePanel>
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
function BulkUploadPanel({ onClose }: { onClose: () => void }) {
  const toast = useToast()
  const qc = useQueryClient()
  const types = useDocumentTypes()
  const active = (types.data ?? []).filter((t) => t.active)
  const [rows, setRows] = useState<BulkRow[]>([])
  const [defaultEmployee, setDefaultEmployee] = useState({ id: '', name: '' })
  const [defaultTypeId, setDefaultTypeId] = useState('')
  const [picking, setPicking] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const seq = useRef(0)
  const typeOf = (id: string): DocumentType | undefined => active.find((t) => t.id === id)
  const problemOf = (r: BulkRow) => !r.employee.id ? 'Pick whose file this goes on' : !r.typeId ? 'Pick a document type' : !r.title.trim() ? 'Give it a title' : fileProblem(r.file, typeOf(r.typeId))
  const set = (key: string, patch: Partial<BulkRow>) => setRows((all) => all.map((r) => (r.key === key ? { ...r, ...patch, state: patch.state ?? (r.state === 'done' ? 'done' : 'ready'), error: patch.error ?? '' } : r)))
  const addFiles = (files: File[]) => {
    if (!files.length) return
    const room = MAX_BULK - rows.length
    if (files.length > room) toast.error(`Up to ${MAX_BULK} files at a time; the first ${Math.max(room, 0)} were added`)
    const t = typeOf(defaultTypeId)
    const added = files.slice(0, Math.max(room, 0)).map((file) => ({
      key: `${++seq.current}-${file.name}`, file, employee: { ...defaultEmployee }, typeId: defaultTypeId,
      title: t ? t.displayName : file.name.replace(/\.[^.]+$/, ''), state: 'ready' as const, error: '',
    }))
    setRows((all) => [...all, ...added])
  }
  const pending = rows.filter((r) => r.state !== 'done')
  const blocked = pending.filter((r) => problemOf(r))
  const uploadAll = async () => {
    if (!pending.length) return
    if (blocked.length) { toast.error(`${blocked.length} ${blocked.length === 1 ? 'file needs' : 'files need'} fixing first`, { detail: problemOf(blocked[0]) }); return }
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
    if (failed) toast.error(`${stored} stored, ${failed} failed`, { detail: 'The failed files keep their reason below. Fix them and upload again.' })
    else toast.success(`${stored} ${stored === 1 ? 'document' : 'documents'} stored`, { detail: 'Each is on the employee’s file, marked verified.' })
  }
  const TONE: Record<BulkRow['state'], [string, 'neutral' | 'info' | 'success' | 'danger']> = { ready: ['Ready', 'neutral'], uploading: ['Uploading…', 'info'], done: ['Stored', 'success'], failed: ['Failed', 'danger'] }
  const label = `Upload ${pending.length || ''} ${pending.length === 1 ? 'document' : 'documents'}`.replace('  ', ' ')
  return (
    <SidePanel open onClose={() => { if (!running) onClose() }} width={720} busy={running} closeLabel="Close panel"
      title="Bulk upload documents" sub="Drop many files at once. Choose the person and type per file, or set defaults."
      footer={<><PanelButton size="lg" onClick={onClose} disabled={running}>{rows.length && !pending.length ? 'Done' : 'Cancel'}</PanelButton>
        <PanelButton size="lg" variant="primary" busy={running} disabled={!pending.length} onClick={uploadAll}>{label}</PanelButton></>}>
      <div className="lt-stack">
        <Section title="Defaults for new files" sub="Optional. Files you add next start with these; change any row below." cardClass={false} variant="panel">
          <FieldGrid columns={2}>
            <div className="lt-field-block">
              <p className="lt-label">Employee</p>
              {picking === 'default'
                ? <PersonSearch selectedId={defaultEmployee.id} onPick={(e) => { setDefaultEmployee({ id: e.id, name: fullName(e) }); setPicking(null) }} />
                : <div className="lt-pills"><span>{defaultEmployee.name || 'None'}</span><Button size={30} variant="ghost" onClick={() => setPicking('default')}>{defaultEmployee.id ? 'Change' : 'Choose'}</Button></div>}
            </div>
            <Select id="bulk-default-type" label="Document type" value={defaultTypeId} onChange={(e) => setDefaultTypeId(e.target.value)}
              options={[{ value: '', label: 'Choose per file' }, ...active.map((t) => ({ value: t.id, label: t.displayName }))]} />
          </FieldGrid>
        </Section>
        <UploadDrop variant="zone" multiple accept=".pdf,.png,.jpg,.jpeg" title="Drop files here, or click to choose" disabled={running || rows.length >= MAX_BULK}
          hint={`PDF, PNG or JPEG. Up to ${MAX_BULK} files at a time; each type sets its own formats and size limit.`} onFiles={addFiles} ariaLabel="Files" />
        {active.length === 0 && !types.isLoading && <Callout tone="warning">No document types are switched on. Add or switch one on under HR setup before uploading.</Callout>}
        {rows.map((r, i) => {
          const t = typeOf(r.typeId), problem = r.state !== 'done' ? problemOf(r) : ''
          const locked = running || r.state === 'done'
          return (
            <Section key={r.key} level={3} variant="panel" cardClass={false}
              title={<span title={r.file.name}>{`${i + 1}. ${r.file.name}`}</span>} sub={`${(r.file.size / 1024 / 1024).toFixed(1)} MB`}
              actions={<span className="lt-pills"><StatusPill tone={TONE[r.state][1]}>{TONE[r.state][0]}</StatusPill>
                {!locked && <Button size={30} variant="ghost" icon="trash" aria-label={`Remove ${r.file.name}`} onClick={() => setRows((all) => all.filter((x) => x.key !== r.key))} />}</span>}>
              <FieldGrid columns={2}>
                <div className="lt-field-block">
                  <p className="lt-label">Employee</p>
                  {picking === r.key && !locked
                    ? <PersonSearch selectedId={r.employee.id} onPick={(e) => { set(r.key, { employee: { id: e.id, name: fullName(e) } }); setPicking(null) }} />
                    : <div className="lt-pills"><span>{r.employee.name || 'Not chosen'}</span>{!locked && <Button size={30} variant="ghost" onClick={() => setPicking(r.key)}>{r.employee.id ? 'Change' : 'Choose'}</Button>}</div>}
                </div>
                <Select id={`bulk-type-${r.key}`} label="Document type" value={r.typeId} disabled={locked}
                  onChange={(e) => { const nt = typeOf(e.target.value); set(r.key, { typeId: e.target.value, ...(nt && (!r.title.trim() || r.title === t?.displayName || r.title === r.file.name.replace(/\.[^.]+$/, '')) ? { title: nt.displayName } : {}) }) }}
                  options={[{ value: '', label: 'Choose a type' }, ...active.map((x) => ({ value: x.id, label: x.displayName }))]}
                  hint={t ? `${typeFormats(t).join(', ').toUpperCase()} · up to ${t.maxSizeMb} MB` : undefined} />
                <Input id={`bulk-title-${r.key}`} label="Title" full value={r.title} disabled={locked} maxLength={300} onChange={(e) => set(r.key, { title: e.target.value })} />
              </FieldGrid>
              {(r.error || problem) && <p role={r.error ? 'alert' : undefined} className="lt-error" style={{ marginTop: 8 }}>{r.error || problem}</p>}
            </Section>
          )
        })}
      </div>
    </SidePanel>
  )
}

