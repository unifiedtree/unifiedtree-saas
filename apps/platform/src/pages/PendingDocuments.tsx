// Documents to review (/hrms/documents/pending, and /documents/pending for old
// bell links), on the module kit. Every document employees uploaded that is
// waiting for HR (GET /v1/document/pending, hrms.document.verify).
// "View file" fetches the document (which returns a signed link) because the
// queue itself carries no link. Reject needs a reason the employee is shown.
import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { HrButton } from '@/shared/components/hr'
import { apiJson } from '@/core/api/client'
import { ModulePage, State, DecisionCard, Note, useDesignToast, stamp } from '@/design/module/ModuleKit'
import { fileSize } from '@/shared/export/fileExport'
import { usePendingDocumentQueue, useVerifyDocument, useRejectDocument, type EmployeeDocument } from '@/modules/hrms/api/useDocument'

export const PendingDocuments: React.FC = () => {
  const { data: rows = [], isLoading, isError, error, refetch, isFetching } = usePendingDocumentQueue()
  const verify = useVerifyDocument()
  const reject = useRejectDocument()
  const { show, node } = useDesignToast()
  const [rejectingId, setRejectingId] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [opening, setOpening] = useState<string | null>(null)
  const open = async (id: string) => {
    // Open the tab synchronously so pop-up blockers allow it, then point it at the signed link.
    const win = window.open('', '_blank')
    setOpening(id)
    try {
      const doc = await apiJson<EmployeeDocument>(`/v1/document/documents/${id}`)
      if (doc.fileUrl) { if (win) win.location.href = doc.fileUrl; else window.open(doc.fileUrl, '_blank') }
      else { win?.close(); show('This file can’t be opened here', true, 'Document storage isn’t set up on this server.') }
    } catch (e) { win?.close(); show('Couldn’t open the file', true, (e as Error)?.message) } finally { setOpening(null) }
  }
  const onVerify = async (id: string) => {
    try { await verify.mutateAsync(id); show('Verified') } catch (e) { show('Couldn’t verify it', true, (e as Error)?.message) }
  }
  const onReject = async (id: string) => {
    try { await reject.mutateAsync({ id, reason: reason.trim() }); show('Rejected; the employee has been told why'); setRejectingId(null); setReason('') } catch (e) { show('Couldn’t reject it', true, (e as Error)?.message) }
  }
  return (
    <ModulePage crumb="Documents" title="Documents to review" subtitle="What employees uploaded themselves, waiting for you to check it."
      actions={<HrButton variant="ghost" onClick={() => refetch()} disabled={isFetching}>{isFetching ? 'Refreshing…' : 'Refresh'}</HrButton>}>
      <div style={{ display: 'grid', gap: 12, minWidth: 0 }}>
        {isLoading ? <State kind="loading" height={220} />
          : isError ? <State kind="error" title="Couldn’t load the queue" description={(error as Error)?.message} onRetry={() => refetch()} />
            : rows.length === 0 ? <State kind="empty" icon="checkCircle" title="All caught up" description="No documents are waiting for review." />
              : <>
                <Note>{`${rows.length} ${rows.length === 1 ? 'document is' : 'documents are'} waiting. Open each file before you verify it.`}</Note>
                {rows.map((r) => (
                  <DecisionCard key={r.id} name={r.employeeName || 'Employee'} sub={r.employeeCode} status={['Waiting for review', 'warn']}
                    facts={[
                      { k: 'Document', v: r.title },
                      { k: 'Type', v: r.documentTypeName || 'Other' },
                      { k: 'File', v: r.originalFilename ? `${r.originalFilename}${r.fileSizeBytes ? ` · ${fileSize(r.fileSizeBytes)}` : ''}` : '—' },
                    ]}
                    raised={stamp(r.createdAt)}
                    details={rejectingId === r.id ? (
                      <div style={{ display: 'grid', gap: 8 }}>
                        <label className="text-[13px] font-semibold text-text-secondary" htmlFor={`rej-${r.id}`}>Why it’s rejected (shown to the employee)</label>
                        <input id={`rej-${r.id}`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. The photo is blurry, please upload it again" className="ut-input" autoFocus />
                        <div className="flex flex-wrap gap-2">
                          <HrButton size="sm" variant="danger" disabled={reason.trim().length < 3 || reject.isPending} onClick={() => onReject(r.id)}>{reject.isPending ? 'Rejecting…' : 'Reject and tell them'}</HrButton>
                          <HrButton size="sm" variant="ghost" onClick={() => { setRejectingId(null); setReason('') }}>Cancel</HrButton>
                        </div>
                      </div>
                    ) : <Link to={`/hrms/employees/${r.employeeId}?tab=documents`} className="text-[13px] font-semibold text-accent-fg hover:underline">Open their documents →</Link>}
                    actions={<>
                      <HrButton size="sm" variant="ghost" disabled={opening === r.id} onClick={() => open(r.id)}>{opening === r.id ? 'Opening…' : 'View file'}</HrButton>
                      {rejectingId !== r.id && <HrButton size="sm" variant="ghost" onClick={() => { setRejectingId(r.id); setReason('') }}>Reject</HrButton>}
                      <HrButton size="sm" disabled={verify.isPending} onClick={() => onVerify(r.id)}>Verify</HrButton>
                    </>} />
                ))}
              </>}
      </div>
      {node}
    </ModulePage>
  )
}

export default PendingDocuments
