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
import { format } from 'date-fns'
import { FileText, ExternalLink } from 'lucide-react'
import { usePermission } from '@unifiedtree/sdk'
import { useNavigate } from 'react-router-dom'
import { TableCard, HrStatusPill, HrButton, type PillTone } from '@/shared/components/hr'
import { hrPaginationFooter, useClampedPage } from '@/shared/components/HrPagination'
import { useEmployeeDocuments, type DocumentCategory } from '../../api/useDocument'
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
              <tr><th>Title</th><th>Category</th><th>Issued</th><th>Expires</th><th /></tr>
            </thead>
            <tbody>
              {docs.map((d) => {
                const exp = expiryState(d.expiryDate)
                return (
                  <tr key={d.id}>
                    <td>
                      <span className="text-text-primary font-medium">{d.title}</span>
                      {d.notes && <span className="block text-xs text-text-tertiary truncate max-w-xs">{d.notes}</span>}
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
                      {d.fileUrl ? (
                        <a
                          href={d.fileUrl}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="inline-flex items-center gap-1 text-xs font-semibold text-[#047857] hover:text-[#059669] transition-colors"
                        >
                          Open <ExternalLink size={11} />
                        </a>
                      ) : <span className="text-text-tertiary text-xs">No file</span>}
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
