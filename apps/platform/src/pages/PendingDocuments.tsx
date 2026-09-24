import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { format } from 'date-fns'
import { CheckCircle2, ExternalLink, XCircle, Clock, RefreshCw, Inbox } from 'lucide-react'
import { HrPageHeader, HrButton } from '@/shared/components/hr'
import {
  usePendingDocumentQueue,
  useVerifyDocument,
  useRejectDocument,
} from '@/modules/hrms/api/useDocument'

/**
 * HR / admin queue of every PENDING employee document across the tenant.
 *
 * Backend: `GET /v1/document/pending` (gated on hrms.document.verify).
 * Verify writes {@link useVerifyDocument}; reject writes {@link useRejectDocument}
 * with a required rejection reason. Both invalidate the queue so the row leaves
 * the table on success.
 *
 * The bell notification produced by `DomainEventListener.onDocumentUploaded`
 * deep-links here (`data.route = "/documents/pending"`, which the router mounts
 * at both `/documents/pending` and `/hrms/documents/pending`).
 */
export const PendingDocuments: React.FC = () => {
  const { data: rows, isLoading, isError, refetch } = usePendingDocumentQueue()
  const verify = useVerifyDocument()
  const reject = useRejectDocument()
  const [rejectingId, setRejectingId] = useState<string | null>(null)
  const [reason, setReason] = useState('')

  const count = rows?.length || 0

  return (
    <div className="animate-fade-in mx-auto max-w-6xl p-6 sm:p-8">
      <HrPageHeader
        crumb="HR"
        title="Documents pending review"
        subtitle="Every document your employees have uploaded and are waiting for you to verify."
        actions={
          <HrButton size="sm" variant="ghost" onClick={() => refetch()}>
            <RefreshCw size={14} className="mr-1" /> Refresh
          </HrButton>
        }
      />

      <div className="ut-card ut-card-lg overflow-hidden">
        {isLoading ? (
          <p className="p-6 text-sm text-text-tertiary">Loading pending documents…</p>
        ) : isError ? (
          <p className="p-6 text-sm text-red-600">
            Couldn't load the queue. You may not have permission to verify documents — ask an admin.
          </p>
        ) : count === 0 ? (
          <div className="p-10 text-center">
            <Inbox size={40} className="mx-auto text-text-tertiary" />
            <p className="mt-3 text-sm font-semibold text-text-primary">All caught up</p>
            <p className="mt-1 text-xs text-text-tertiary">
              No documents are waiting for review right now.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <div className="border-b border-border-subtle bg-bg-subtle px-4 py-2 text-xs font-semibold text-text-secondary">
              {count} document{count === 1 ? '' : 's'} pending
            </div>
            <table className="w-full text-sm">
              <thead className="bg-bg-subtle text-left text-xs text-text-secondary">
                <tr>
                  <th className="px-4 py-2 font-semibold">Employee</th>
                  <th className="px-4 py-2 font-semibold">Document</th>
                  <th className="px-4 py-2 font-semibold">Type</th>
                  <th className="px-4 py-2 font-semibold">Uploaded</th>
                  <th className="px-4 py-2 font-semibold">Status</th>
                  <th className="px-4 py-2 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows!.map((r) => (
                  <React.Fragment key={r.id}>
                    <tr className="border-t border-border-subtle hover:bg-bg-subtle/40">
                      <td className="px-4 py-3">
                        <Link
                          to={`/hrms/employees/${r.employeeId}`}
                          className="font-medium text-text-primary hover:text-[#047857]"
                        >
                          {r.employeeName || r.employeeId.slice(0, 8)}
                        </Link>
                        {r.employeeCode && (
                          <div className="text-[11px] text-text-tertiary">{r.employeeCode}</div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-medium text-text-primary">{r.title}</span>
                        {r.originalFilename && (
                          <div className="text-[11px] text-text-tertiary">
                            {r.originalFilename}
                            {r.fileSizeBytes ? ` · ${formatSize(r.fileSizeBytes)}` : ''}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-text-secondary">
                        {r.documentTypeName || <span className="text-text-tertiary">—</span>}
                      </td>
                      <td className="px-4 py-3 text-text-secondary">
                        {format(new Date(r.createdAt), 'd MMM, h:mm a')}
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                          <Clock size={11} /> Pending
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Link
                            to={`/hrms/employees/${r.employeeId}?tab=documents`}
                            className="rounded-md p-1 text-text-tertiary hover:bg-bg-subtle hover:text-text-primary"
                            title="Open in employee profile"
                          >
                            <ExternalLink size={14} />
                          </Link>
                          <button
                            type="button"
                            onClick={() =>
                              verify.mutate(r.id, {
                                onSuccess: () => toast.success('Verified'),
                                onError: (err) =>
                                  toast.error('Verify failed', { description: (err as Error).message }),
                              })
                            }
                            disabled={verify.isPending}
                            className="rounded-md p-1 text-emerald-700 hover:bg-emerald-50 disabled:opacity-40"
                            title="Verify"
                          >
                            <CheckCircle2 size={16} />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setRejectingId(r.id === rejectingId ? null : r.id)
                              setReason('')
                            }}
                            className="rounded-md p-1 text-red-600 hover:bg-red-50"
                            title="Reject"
                          >
                            <XCircle size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                    {rejectingId === r.id && (
                      <tr className="border-t border-border-subtle bg-red-50/30">
                        <td colSpan={6} className="px-4 py-3">
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                            <div className="flex-1">
                              <label className="mb-1 block text-[11px] font-semibold uppercase text-text-tertiary">
                                Reason for rejection (min 3 chars, shown to the employee)
                              </label>
                              <input
                                type="text"
                                value={reason}
                                onChange={(e) => setReason(e.target.value)}
                                placeholder="e.g. Photo is blurry, please re-upload"
                                className="w-full rounded-xl border border-border-default bg-white px-3 py-2 text-sm outline-none focus:border-red-400 focus:ring-4 focus:ring-red-100"
                                autoFocus
                              />
                            </div>
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => setRejectingId(null)}
                                className="rounded-lg border border-border-default bg-white px-3 py-2 text-xs font-medium text-text-secondary hover:bg-bg-subtle"
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                disabled={reason.trim().length < 3 || reject.isPending}
                                onClick={() => {
                                  reject.mutate(
                                    { id: r.id, reason: reason.trim() },
                                    {
                                      onSuccess: () => {
                                        toast.success('Rejected — employee has been notified')
                                        setRejectingId(null)
                                        setReason('')
                                      },
                                      onError: (err) =>
                                        toast.error('Reject failed', { description: (err as Error).message }),
                                    },
                                  )
                                }}
                                className="rounded-lg bg-red-600 px-3 py-2 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-40"
                              >
                                {reject.isPending ? 'Rejecting…' : 'Reject and notify'}
                              </button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default PendingDocuments
