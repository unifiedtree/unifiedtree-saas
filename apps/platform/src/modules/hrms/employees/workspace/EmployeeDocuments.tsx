/**
 * Documents — records filed against this employee.
 *
 * Until 5A the profile had a tab labelled "Documents" that rendered generated
 * LETTERS, so uploaded documents had no home on the employee page at all even
 * though `GET /v1/document/employee/{employeeId}` has existed and is already
 * wired as `useEmployeeDocuments`. That endpoint is paged, gated on
 * `hrms.document.read`, and resolves the owner's name in one batched lookup —
 * no N+1 and no new API.
 *
 * Read-only by design. Adding documents lives in the Document Vault, which owns
 * the category/expiry rules and the (URL-based) create form; duplicating it here
 * would mean two places to keep correct. The section links there instead.
 */

import React, { useState } from 'react'
import { toast } from 'sonner'
import { format } from 'date-fns'
import { FileText, ExternalLink, CheckCircle2, XCircle, Clock } from 'lucide-react'
import { usePermission } from '@unifiedtree/sdk'
import { useNavigate } from 'react-router-dom'
import { TableCard, HrStatusPill, HrButton, type PillTone } from '@/shared/components/hr'
import { hrPaginationFooter, useClampedPage } from '@/shared/components/HrPagination'
import {
  useEmployeeDocuments,
  useVerifyDocument,
  useRejectDocument,
  type DocumentCategory,
  type EmployeeDocumentV2,
} from '../../api/useDocument'
import { SectionState, SubSection } from './shared'

const CATEGORY_TONE: Record<string, PillTone> = {
  CONTRACT: 'purple', ID_PROOF: 'blue', CERTIFICATE: 'teal',
  PAYSLIP: 'green', POLICY: 'gray', TAX: 'orange', OTHER: 'gray',
}

/**
 * Exported so the Overview's document tile can request the SAME page size.
 * useEmployeeDocuments puts pageSize in its query key, so a tile that used the
 * hook's default (20) while this tab used 10 cached under two different keys
 * and paid for two round trips to the same endpoint.
 */
export const EMPLOYEE_DOCUMENTS_PAGE_SIZE = 10

/** Mirrors DocumentVault's expiry treatment so one document never reads two ways. */
function expiryState(expiryDate?: string): { tone: PillTone; label: string } | null {
  if (!expiryDate) return null
  const days = Math.ceil((new Date(expiryDate).getTime() - Date.now()) / 86_400_000)
  if (days < 0) return { tone: 'red', label: 'Expired' }
  if (days <= 30) return { tone: 'warn', label: `${days}d left` }
  return null
}

export function EmployeeDocuments({ employeeId }: { employeeId: string }) {
  const navigate = useNavigate()
  const [page, setPage] = useState(0)

  // The exact authority the backend declares on /v1/document/employee/{id}.
  // Note this is 'hrms.document.read', NOT the SDK's stale
  // HRMS_EMPLOYEE_DOCUMENT_READ constant ('hrms.employee.document.read'), which
  // no endpoint checks — gating on that would hide the section from the very
  // users who can read it. DocumentVault uses the same raw code.
  const canRead = usePermission('hrms.document.read')
  const canWrite = usePermission('hrms.document.write')
  const canVerify = usePermission('hrms.document.verify' as unknown as Parameters<typeof usePermission>[0])
  const verify = useVerifyDocument()
  const reject = useRejectDocument()

  const { data, isLoading, error, refetch } = useEmployeeDocuments(
    employeeId, page, canRead, EMPLOYEE_DOCUMENTS_PAGE_SIZE,
  )

  const docs = data?.content ?? []
  const total = data?.totalElements ?? 0
  const totalPages = data?.totalPages ?? 0
  useClampedPage(page, totalPages, setPage)

  if (!canRead) {
    return (
      <SectionState
        error={{ status: 403 }}
        forbiddenTitle="You don’t have access to documents"
        forbiddenHint="Viewing an employee’s documents needs the document read permission."
      />
    )
  }

  return (
    <SubSection
      title="Filed documents"
      hint={total ? `${total} document${total === 1 ? '' : 's'} on record` : 'Contracts, ID proofs, certificates and tax records.'}
      action={canWrite ? (
        <HrButton size="sm" variant="ghost" onClick={() => navigate('/hrms/documents')}>
          Open Document Vault
        </HrButton>
      ) : undefined}
    >
      <SectionState
        isLoading={isLoading}
        error={error}
        isEmpty={!isLoading && !error && docs.length === 0}
        emptyIcon={FileText}
        emptyTitle="No documents on record"
        emptyHint={canWrite
          ? 'Add this employee’s contract, ID proof or certificates from the Document Vault.'
          : 'Nothing has been filed against this employee yet.'}
        forbiddenTitle="You don’t have access to this employee’s documents"
        onRetry={() => refetch()}
      >
        <TableCard footer={hrPaginationFooter({
          page, totalPages, totalElements: total, pageSize: EMPLOYEE_DOCUMENTS_PAGE_SIZE, onPageChange: setPage,
        })}>
          <table className="hr-table">
            <thead>
              <tr><th>Title</th><th>Category</th><th>Issued</th><th>Expires</th><th>Verification</th><th /></tr>
            </thead>
            <tbody>
              {(docs as EmployeeDocumentV2[]).map((d) => {
                const exp = expiryState(d.expiryDate)
                const status = d.verificationStatus || 'PENDING'
                return (
                  <tr key={d.id}>
                    <td>
                      <span className="text-text-primary font-medium">{d.documentTypeName || d.title}</span>
                      {d.notes && <span className="block text-xs text-text-tertiary truncate max-w-xs">{d.notes}</span>}
                      {d.rejectionReason && (
                        <span className="mt-1 block rounded bg-red-50 px-2 py-1 text-[11px] text-red-700">
                          Rejected: {d.rejectionReason}
                        </span>
                      )}
                    </td>
                    <td>
                      <HrStatusPill tone={CATEGORY_TONE[d.category as DocumentCategory] ?? 'gray'}>
                        {String(d.category).replace(/_/g, ' ')}
                      </HrStatusPill>
                    </td>
                    <td>{d.issuedDate ? format(new Date(d.issuedDate), 'd MMM yyyy') : '—'}</td>
                    <td>
                      {d.expiryDate ? (
                        <span className="flex items-center gap-2">
                          {format(new Date(d.expiryDate), 'd MMM yyyy')}
                          {exp && <HrStatusPill tone={exp.tone}>{exp.label}</HrStatusPill>}
                        </span>
                      ) : '—'}
                    </td>
                    <td>
                      {status === 'VERIFIED' ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                          <CheckCircle2 size={11} /> Verified
                        </span>
                      ) : status === 'REJECTED' ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700">
                          <XCircle size={11} /> Rejected
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                          <Clock size={11} /> Pending
                        </span>
                      )}
                    </td>
                    <td>
                      <div className="flex items-center gap-2">
                        {d.fileUrl && (
                          <a
                            href={d.fileUrl}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="inline-flex items-center gap-1 text-xs font-semibold text-[#047857] hover:text-[#059669] transition-colors"
                          >
                            Open <ExternalLink size={11} />
                          </a>
                        )}
                        {canVerify && status !== 'VERIFIED' && (
                          <button
                            type="button"
                            onClick={() => {
                              verify.mutate(d.id, {
                                onSuccess: () => toast.success('Verified'),
                                onError: (err) => toast.error('Verify failed', { description: (err as Error).message }),
                              })
                            }}
                            disabled={verify.isPending}
                            className="rounded-md p-1 text-emerald-700 hover:bg-emerald-50"
                            title="Mark verified"
                          >
                            <CheckCircle2 size={14} />
                          </button>
                        )}
                        {canVerify && status !== 'REJECTED' && (
                          <button
                            type="button"
                            onClick={() => {
                              const reason = prompt('Reason for rejection?')
                              if (!reason || reason.trim().length < 3) return
                              reject.mutate(
                                { id: d.id, reason: reason.trim() },
                                {
                                  onSuccess: () => toast.success('Rejected — employee has been notified'),
                                  onError: (err) => toast.error('Reject failed', { description: (err as Error).message }),
                                },
                              )
                            }}
                            disabled={reject.isPending}
                            className="rounded-md p-1 text-red-600 hover:bg-red-50"
                            title="Reject"
                          >
                            <XCircle size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </TableCard>
      </SectionState>
    </SubSection>
  )
}
