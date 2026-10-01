// Docs to review (/hrms/documents/pending, and /documents/pending for old bell
// links), on the kit (P-DOCS; prototype PgTalent h-docs). Every document people
// uploaded themselves that is waiting for HR (GET /v1/document/pending,
// hrms.document.verify): counts (waiting, verified and rejected this week,
// BW-77), then each document with the person and their department, when it was
// uploaded and when it expires. "View file" fetches the document (which returns
// a signed link) because the queue itself carries no link. Reject asks for a
// reason the employee is shown.
import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Button, CellActions, CellPerson, CellStack, MiniStat, MiniStatGrid, PageFrame, PageHeader, Section, Table, type TableColumn,
} from '@/design/kit/display'
import { Dialog, PanelButton, Textarea, useToast } from '@/design/kit/overlays'
import { apiJson } from '@/core/api/client'
import { fileSize } from '@/shared/export/fileExport'
import {
  usePendingDocumentQueue, useReviewSummary, useVerifyDocument, useRejectDocument, type EmployeeDocument,
} from '@/modules/hrms/api/useDocument'
import { day } from '@/modules/hrms/vault/vaultModel'
import { shortDay, localDay } from '@/modules/hrms/letters/lettersModel'
import '@/modules/hrms/letters/components/letters.css'

type Row = NonNullable<ReturnType<typeof usePendingDocumentQueue>['data']>[number]

function Counts() {
  const q = useReviewSummary()
  if (q.notAvailable) return null
  const s = q.data
  return (
    <Section title="Review" body="tight" cardClass={false} loading={q.isLoading} skeleton="stats" error={q.error} onRetry={() => q.refetch()}>
      {s && (
        <MiniStatGrid>
          <MiniStat label="Waiting for review" value={s.waiting} tone="warning" />
          <MiniStat label="Verified this week" value={s.verifiedThisWeek} tone="success" />
          <MiniStat label="Rejected this week" value={s.rejectedThisWeek} tone="danger" />
        </MiniStatGrid>
      )}
    </Section>
  )
}

export const PendingDocuments: React.FC = () => {
  const { data: rows = [], isLoading, error, refetch, isFetching } = usePendingDocumentQueue()
  const verify = useVerifyDocument()
  const reject = useRejectDocument()
  const toast = useToast()
  const [rejecting, setRejecting] = useState<Row | null>(null)
  const [reason, setReason] = useState('')
  const [opening, setOpening] = useState<string | null>(null)
  const [verifying, setVerifying] = useState<string | null>(null)

  const open = async (id: string) => {
    // Open the tab synchronously so pop-up blockers allow it, then point it at the signed link.
    const win = window.open('', '_blank')
    setOpening(id)
    try {
      const doc = await apiJson<EmployeeDocument>(`/v1/document/documents/${id}`)
      if (doc.fileUrl) { if (win) win.location.href = doc.fileUrl; else window.open(doc.fileUrl, '_blank') }
      else { win?.close(); toast.error('This file can’t be opened here', { detail: 'Document storage isn’t set up on this server.' }) }
    } catch (e) { win?.close(); toast.error('Couldn’t open the file', { detail: (e as Error)?.message }) } finally { setOpening(null) }
  }
  const onVerify = async (r: Row) => {
    setVerifying(r.id)
    try { await verify.mutateAsync(r.id); toast.success(`${r.documentTypeName || r.title} verified`) } catch (e) { toast.error('Couldn’t verify it', { detail: (e as Error)?.message }) } finally { setVerifying(null) }
  }
  const onReject = async () => {
    if (!rejecting) return
    try {
      await reject.mutateAsync({ id: rejecting.id, reason: reason.trim() })
      toast.success('Rejected; the employee has been told why')
      setRejecting(null); setReason('')
    } catch (e) { toast.error('Couldn’t reject it', { detail: (e as Error)?.message }) }
  }

  const columns: TableColumn<Row>[] = [
    {
      key: 'employee', header: 'Employee', label: 'Employee', primary: true,
      render: (r) => <CellPerson name={r.employeeName || 'Employee'} sub={r.departmentName || r.employeeCode} />,
    },
    {
      key: 'document', header: 'Document', render: (r) => (
        <CellStack primary={r.documentTypeName || r.title}
          secondary={[r.documentTypeName && r.title !== r.documentTypeName ? r.title : null,
            r.originalFilename ? `${r.originalFilename}${r.fileSizeBytes ? ` · ${fileSize(r.fileSizeBytes)}` : ''}` : null].filter(Boolean).join(' · ') || undefined} />
      ),
    },
    { key: 'uploaded', header: 'Uploaded', render: (r) => shortDay(localDay(r.createdAt)) },
    { key: 'expiry', header: 'Expiry', render: (r) => (r.expiryDate ? day(r.expiryDate) : '—') },
    {
      key: 'actions', header: <span className="sr-only">Actions</span>, label: 'Actions', align: 'right', render: (r) => (
        <CellActions>
          <Button size={30} variant="ghost" loading={opening === r.id} onClick={() => open(r.id)} aria-label={`View file: ${r.title}`}>View file</Button>
          <Link to={`/hrms/employees/${r.employeeId}?tab=documents`} className="lt-link lt-small" aria-label={`Open their documents: ${r.employeeName ?? 'employee'}`}>Their file</Link>
          <Button size={30} variant="secondary" onClick={() => { setRejecting(r); setReason('') }} aria-label={`Reject ${r.title}`}>Reject</Button>
          <Button size={30} variant="soft" loading={verifying === r.id} onClick={() => onVerify(r)} aria-label={`Verify ${r.title}`}>Verify</Button>
        </CellActions>
      ),
    },
  ]

  const reasonProblem = reason.trim().length < 3 ? 'Say why, in at least 3 characters.' : null
  return (
    <PageFrame label="Docs to review" className="lt-page">
      <PageHeader eyebrow="Hiring & onboarding" title="Docs to review" sub="Documents people uploaded that need a check before payroll or onboarding uses them."
        actions={<Button variant="secondary" loading={isFetching && !isLoading} onClick={() => refetch()}>Refresh</Button>} />
      <Counts />
      <Section title="Waiting for review" count={rows.length || undefined} body="flush" cardClass={false}
        loading={isLoading} skeleton="table" error={error} onRetry={() => refetch()} retrying={isFetching}
        empty={!isLoading && !error && rows.length === 0 ? { title: 'Nothing to review', hint: 'Every uploaded document has been checked.', variant: 'success' } : undefined}>
        <Table label="Documents waiting for review" columns={columns} rows={rows} rowKey={(r) => r.id} mobile="cards" />
      </Section>
      <Dialog open={!!rejecting} onClose={() => setRejecting(null)} busy={reject.isPending} icon="circleX" tone="danger" title="Reject document"
        sub={rejecting ? `${rejecting.documentTypeName || rejecting.title} from ${rejecting.employeeName ?? 'the employee'}. They see your reason and can upload it again.` : undefined}
        footer={<>
          <PanelButton onClick={() => setRejecting(null)} disabled={reject.isPending}>Cancel</PanelButton>
          <PanelButton variant="danger" busy={reject.isPending} disabled={!!reasonProblem} onClick={onReject}>Reject and tell them</PanelButton>
        </>}>
        <Textarea label="Why it’s rejected (shown to the employee)" required full rows={3} maxLength={500} value={reason} autoFocus
          onChange={(e) => setReason(e.target.value)} placeholder="e.g. The photo is blurry, please upload it again" />
      </Dialog>
    </PageFrame>
  )
}

export default PendingDocuments
