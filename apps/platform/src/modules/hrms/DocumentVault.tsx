import React, { useMemo, useState } from 'react'
import { Plus, Trash2, FileText, FolderOpen, ShieldAlert, ExternalLink } from 'lucide-react'
import { format } from 'date-fns'
import { usePermission } from '@unifiedtree/sdk'
import { useToast } from '@/shared/hooks/useToast'
import {
  HrPageHeader, HrButton, HrStatCard, HrStatusPill, TableCard, HrAvatar, HrTabs, HrTabPanel, type PillTone,
} from '@/shared/components/hr'
import { hrPaginationFooter, useClampedPage } from '@/shared/components/HrPagination'
import { useCompanies } from './api/useOrg'
import { useEmployeeDirectory } from './api/useWorkforce'
import {
  useMyDocuments, useEmployeeDocuments, useCreateDocument, useDeleteDocument,
  DOCUMENT_CATEGORIES, DOCUMENT_PAGE_SIZE,
  type DocumentCategory, type EmployeeDocument,
} from './api/useDocument'

const CATEGORY_TONE: Record<DocumentCategory, PillTone> = {
  CONTRACT: 'purple', ID_PROOF: 'blue', CERTIFICATE: 'teal', PAYSLIP: 'green',
  POLICY: 'info', TAX: 'orange', OTHER: 'gray',
}

const fmtCat = (c: string) => c.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase())

/** Returns an expiry badge tone + label, or null when there is no expiry concern. */
function expiryBadge(expiryDate?: string): { tone: PillTone; label: string } | null {
  if (!expiryDate) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const exp = new Date(expiryDate)
  const days = Math.ceil((exp.getTime() - today.getTime()) / 86_400_000)
  if (days < 0) return { tone: 'red', label: 'Expired' }
  if (days <= 30) return { tone: 'warn', label: `Expires in ${days}d` }
  return null
}

type Tab = 'my' | 'all' | 'upload'

export const DocumentVault: React.FC = () => {
  const canReadSelf = usePermission('hrms.document.read.self')
  const canRead = usePermission('hrms.document.read')
  const canWrite = usePermission('hrms.document.write')
  const [tab, setTab] = useState<Tab>(canReadSelf ? 'my' : canRead ? 'all' : 'upload')

  const tabs: { key: Tab; label: string }[] = [
    ...(canReadSelf ? [{ key: 'my' as Tab, label: 'My Documents' }] : []),
    ...(canRead ? [{ key: 'all' as Tab, label: 'All Documents' }] : []),
    ...(canWrite ? [{ key: 'upload' as Tab, label: 'Upload' }] : []),
  ]

  return (
    <div className="mx-auto max-w-5xl p-6 sm:p-8">
      <HrPageHeader crumb="Document Vault" title="Employee Documents" subtitle="Store, browse, and access employee documents" />

      <HrTabs tabs={tabs} active={tab} onChange={(k) => setTab(k as Tab)} />

      {tab === 'my' && canReadSelf && <HrTabPanel tabKey="my"><MyDocumentsTab /></HrTabPanel>}
      {tab === 'all' && canRead && <HrTabPanel tabKey="all"><AllDocumentsTab /></HrTabPanel>}
      {tab === 'upload' && canWrite && <HrTabPanel tabKey="upload"><UploadTab onUploaded={() => setTab(canRead ? 'all' : 'upload')} /></HrTabPanel>}
    </div>
  )
}

// ── Shared document table ────────────────────────────────────────────────────

function DocumentTable({
  documents, isLoading, showOwner, canWrite, onDelete, footer,
}: {
  documents: EmployeeDocument[]
  isLoading: boolean
  showOwner?: boolean
  canWrite?: boolean
  onDelete?: (id: string) => void
  /** Pager built by the owning tab — see hrPaginationFooter. */
  footer?: React.ReactNode
}) {
  const cols = 4 + (showOwner ? 1 : 0) + (canWrite ? 1 : 0)
  return (
    <TableCard footer={footer}>
      <table className="hr-table">
        <thead>
          <tr>
            {showOwner && <th>Employee</th>}
            <th>Document</th>
            <th>Category</th>
            <th className="hidden sm:table-cell">Issued</th>
            <th>Expiry</th>
            {canWrite && <th></th>}
          </tr>
        </thead>
        <tbody>
          {isLoading ? (
            [...Array(4)].map((_, i) => <tr key={i}><td colSpan={cols} className="py-3"><div className="h-5 w-full animate-pulse rounded bg-bg-base" /></td></tr>)
          ) : documents.length === 0 ? (
            <tr><td colSpan={cols} className="py-14 text-center"><p className="text-sm font-semibold text-text-secondary">No documents found</p><p className="mt-1 text-xs text-text-tertiary">Documents stored in the vault will appear here.</p></td></tr>
          ) : documents.map((d, i) => {
            const badge = expiryBadge(d.expiryDate)
            return (
              <tr key={d.id}>
                {showOwner && <td><HrAvatar name={d.employeeName || 'Employee'} sub={d.employeeCode} seed={i} /></td>}
                <td>
                  <a href={d.fileUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 font-medium text-text-primary hover:text-[#047857]">
                    {d.title}
                    <ExternalLink size={13} className="text-text-tertiary" />
                  </a>
                </td>
                <td><HrStatusPill tone={CATEGORY_TONE[d.category]}>{fmtCat(d.category)}</HrStatusPill></td>
                <td className="hidden sm:table-cell text-text-secondary">{d.issuedDate ? format(new Date(d.issuedDate), 'd MMM yyyy') : '—'}</td>
                <td>
                  {d.expiryDate ? (
                    <div className="flex items-center gap-2">
                      <span className="text-text-secondary">{format(new Date(d.expiryDate), 'd MMM yyyy')}</span>
                      {badge && <HrStatusPill tone={badge.tone}>{badge.label}</HrStatusPill>}
                    </div>
                  ) : <span className="text-text-tertiary">—</span>}
                </td>
                {canWrite && (
                  <td>
                    <div className="flex items-center justify-end">
                      {onDelete && (
                        <button onClick={() => onDelete(d.id)} className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-tertiary)] transition-colors hover:bg-[#FEE2E2] hover:text-[#B91C1C]" title="Delete document" aria-label="Delete document">
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
    </TableCard>
  )
}

// ── My Documents ─────────────────────────────────────────────────────────────

function MyDocumentsTab() {
  // Was hard-coded to page 0 with no control, so an employee with more than
  // DOCUMENT_PAGE_SIZE documents simply could not reach the rest of their vault.
  const [page, setPage] = useState(0)
  const { data, isLoading } = useMyDocuments(page)
  const documents = data?.content ?? []
  const total = data?.totalElements ?? 0
  const totalPages = data?.totalPages ?? 1

  const stats = useMemo(() => {
    const expiring = documents.filter((d) => {
      const b = expiryBadge(d.expiryDate)
      return b?.tone === 'warn'
    }).length
    const expired = documents.filter((d) => expiryBadge(d.expiryDate)?.tone === 'red').length
    return { expiring, expired }
  }, [documents])

  // Expiry is derived client-side from the rows we hold, so these two counts
  // only ever describe the page on screen — there is no server-side expiry
  // aggregate to call. Say so on the card rather than let a "2 Expired" read as
  // the whole vault. "Total Documents" is different: totalElements is the real
  // tenant-wide figure, so it stays unqualified (it used to show
  // documents.length, i.e. never more than one page's worth).
  const pageScoped = totalPages > 1 ? 'On this page' : undefined

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <HrStatCard icon={<FileText size={18} />} color="blue" value={total} label="Total Documents" loading={isLoading} />
        <HrStatCard icon={<ShieldAlert size={18} />} color="orange" value={stats.expiring} label="Expiring Soon" sub={pageScoped} loading={isLoading} />
        <HrStatCard icon={<ShieldAlert size={18} />} color="red" value={stats.expired} label="Expired" sub={pageScoped} loading={isLoading} />
      </div>
      <DocumentTable
        documents={documents}
        isLoading={isLoading}
        footer={hrPaginationFooter({
          page, pageSize: DOCUMENT_PAGE_SIZE, totalElements: total, totalPages, onPageChange: setPage,
        })}
      />
    </div>
  )
}

// ── All Documents (admin) ────────────────────────────────────────────────────

function AllDocumentsTab() {
  const { toast } = useToast()
  const canWrite = usePermission('hrms.document.write')
  const { data: companies = [] } = useCompanies()
  const companyId = companies[0]?.id || ''
  const { data: dir } = useEmployeeDirectory({ companyId, pageSize: 200 }, { enabled: !!companyId })
  const employees = dir?.content ?? []

  const [employeeId, setEmployeeId] = useState('')
  // Was hard-coded to page 0 with no control, so anyone whose vault held more
  // than DOCUMENT_PAGE_SIZE documents appeared to be missing the rest.
  const [page, setPage] = useState(0)
  const { data, isLoading } = useEmployeeDocuments(employeeId || undefined, page)
  const documents = data?.content ?? []
  const total = data?.totalElements ?? 0
  const totalPages = data?.totalPages ?? 1
  const remove = useDeleteDocument()

  // Deleting the only row on the last page shrinks totalPages under us; without
  // this the next fetch asks for a page the server no longer has and the vault
  // reads as empty. Pass the RAW data?.totalPages, not the `?? 1` fallback —
  // that fallback is 1 while a page change is in flight and would bounce every
  // navigation straight back to page 1.
  useClampedPage(page, data?.totalPages, setPage)

  const onDelete = async (id: string) => {
    if (!window.confirm('Delete this document? This cannot be undone.')) return
    try {
      await remove.mutateAsync(id)
      toast('Document deleted', 'success')
    } catch (e) {
      toast((e as Error)?.message ?? 'Failed to delete', 'error')
    }
  }

  return (
    <div className="space-y-4">
      <div className="ut-card p-5">
        <label className="mb-1.5 block text-[13px] font-semibold text-text-secondary">Employee</label>
        <select
          value={employeeId}
          // Switching employee resets to page 0: the new vault may be shorter
          // than the old one, and holding page 3 would land the user on an
          // out-of-range page that renders as an empty table.
          onChange={(e) => { setEmployeeId(e.target.value); setPage(0) }}
          className="ut-select"
        >
          <option value="">Select an employee…</option>
          {employees.map((emp) => (
            <option key={emp.id} value={emp.id}>
              {`${emp.firstName}${emp.lastName ? ' ' + emp.lastName : ''}${emp.employeeCode ? ' (' + emp.employeeCode + ')' : ''}`}
            </option>
          ))}
        </select>
      </div>

      {employeeId ? (
        <DocumentTable
          documents={documents}
          isLoading={isLoading}
          showOwner
          canWrite={canWrite}
          onDelete={canWrite ? onDelete : undefined}
          footer={hrPaginationFooter({
            page, pageSize: DOCUMENT_PAGE_SIZE, totalElements: total, totalPages, onPageChange: setPage,
          })}
        />
      ) : (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border-default bg-white py-16 text-center">
          <FolderOpen size={28} className="text-text-tertiary" />
          <p className="text-sm font-semibold text-text-secondary">Select an employee to browse their vault</p>
        </div>
      )}
    </div>
  )
}

// ── Upload ───────────────────────────────────────────────────────────────────

function UploadTab({ onUploaded }: { onUploaded: () => void }) {
  const { toast } = useToast()
  const { data: companies = [] } = useCompanies()
  const companyId = companies[0]?.id || ''
  const { data: dir } = useEmployeeDirectory({ companyId, pageSize: 200 }, { enabled: !!companyId })
  const employees = dir?.content ?? []
  const create = useCreateDocument()

  const [employeeId, setEmployeeId] = useState('')
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState<DocumentCategory>('CONTRACT')
  const [fileUrl, setFileUrl] = useState('')
  const [issuedDate, setIssuedDate] = useState('')
  const [expiryDate, setExpiryDate] = useState('')
  const [notes, setNotes] = useState('')

  const handleSubmit = async () => {
    if (!employeeId) { toast('Select an employee', 'error'); return }
    if (!title.trim()) { toast('Give the document a title', 'error'); return }
    if (!fileUrl.trim()) { toast('Provide a document URL', 'error'); return }
    try {
      await create.mutateAsync({
        employeeId,
        companyId: companyId || undefined,
        title: title.trim(),
        category,
        fileUrl: fileUrl.trim(),
        issuedDate: issuedDate || undefined,
        expiryDate: expiryDate || undefined,
        notes: notes.trim() || undefined,
      })
      toast('Document stored', 'success')
      onUploaded()
    } catch (e) {
      toast((e as Error)?.message ?? 'Failed to store document', 'error')
    }
  }

  const inputCls = 'w-full rounded-lg border border-border-default bg-white px-3 py-2 text-sm text-text-primary focus:border-[#059669] focus:outline-none focus:ring-2 focus:ring-[#059669]/20'

  return (
    <div className="max-w-2xl">
      <div className="ut-card p-5">
        <h3 className="mb-4 text-[15px] font-semibold text-text-primary">Store Document</h3>
        <div className="grid grid-cols-2 gap-x-4 gap-y-5">
          <div className="col-span-2">
            <label className="mb-1.5 block text-[13px] font-semibold text-text-secondary">Employee *</label>
            <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className="ut-select">
              <option value="">Select employee…</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {`${emp.firstName}${emp.lastName ? ' ' + emp.lastName : ''}${emp.employeeCode ? ' (' + emp.employeeCode + ')' : ''}`}
                </option>
              ))}
            </select>
          </div>
          <div className="col-span-2">
            <label className="mb-1.5 block text-[13px] font-semibold text-text-secondary">Title *</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Employment contract 2026" className="ut-input" />
          </div>
          <div>
            <label className="mb-1.5 block text-[13px] font-semibold text-text-secondary">Category</label>
            <select value={category} onChange={(e) => setCategory(e.target.value as DocumentCategory)} className="ut-select">
              {DOCUMENT_CATEGORIES.map((c) => <option key={c} value={c}>{fmtCat(c)}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-[13px] font-semibold text-text-secondary">Document URL *</label>
            <input value={fileUrl} onChange={(e) => setFileUrl(e.target.value)} placeholder="https://…" className="ut-input" />
          </div>
          <div>
            <label className="mb-1.5 block text-[13px] font-semibold text-text-secondary">Issued Date</label>
            <input type="date" value={issuedDate} onChange={(e) => setIssuedDate(e.target.value)} className="ut-input" />
          </div>
          <div>
            <label className="mb-1.5 block text-[13px] font-semibold text-text-secondary">Expiry Date</label>
            <input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} className="ut-input" />
          </div>
          <div className="col-span-2">
            <label className="mb-1.5 block text-[13px] font-semibold text-text-secondary">Notes</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Optional context" className={inputCls} />
          </div>
        </div>

        <div className="mt-5 flex justify-end border-t border-border-default pt-4">
          <HrButton onClick={handleSubmit} disabled={create.isPending}>
            <Plus size={15} /> {create.isPending ? 'Storing…' : 'Store Document'}
          </HrButton>
        </div>
      </div>
    </div>
  )
}
