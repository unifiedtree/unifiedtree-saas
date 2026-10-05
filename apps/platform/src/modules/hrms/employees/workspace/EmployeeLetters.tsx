/**
 * Letters — letters GENERATED for this employee (offer, appointment, …).
 *
 * Deliberately separate from Documents: a generated letter is produced by the
 * letters engine from a template, a document is a record someone filed against
 * the employee. Until 5A these were the same tab, labelled "Documents" and
 * showing letters — so uploaded documents had no home on the profile at all.
 */

import React, { useState } from 'react'
import { HrPagination } from '@/shared/components/HrPagination'
import { Info } from 'lucide-react'
import { SectionState, SubSection, WsEmpty } from './shared'
import type { GeneratedLetterDto } from '../../letters/api/useLetters'
import { Button, Field, Input, TableSkeleton, CardSkeleton } from '@unifiedtree/ui-kit'
import { Can, P, usePermission } from '@unifiedtree/sdk'
import { DataTable } from '@/shared/components/DataTable'
import { EmptyState } from '@/shared/components/EmptyState'
import { FileText, Plus } from 'lucide-react'
import { HrDrawer, HrStatusPill, HrButton, TableCard, type PillTone } from '@/shared/components/hr'
import { apiJson } from '@/core/api/client'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { fmtDate } from './profileFormat'

// ── Tab: Documents ────────────────────────────────────────────────────────────
const LETTERS_PAGE_SIZE = 10

function GeneratedLettersList({ employeeId }: { employeeId: string }) {
  const navigate = useNavigate()
  const [page, setPage] = useState(0)
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['hrms', 'letters', 'generated', 'employee', employeeId, page],
    queryFn: () => apiJson<{ content: GeneratedLetterDto[]; totalElements: number; totalPages: number }>(
      `/v1/letters/generated?employeeId=${encodeURIComponent(employeeId)}&page=${page}&size=${LETTERS_PAGE_SIZE}`
    ),
    staleTime: 30_000,
    enabled: !!employeeId,
  })

  const letters = data?.content ?? []
  const canGenerate = usePermission(P.HRMS_LETTERS_GENERATE)

  return (
    <SubSection title="Generated letters" hint={data?.totalElements ? `${data.totalElements} letter${data.totalElements === 1 ? '' : 's'}` : undefined}
      action={canGenerate ? (
        <HrButton size="sm" onClick={() => navigate(`/hrms/letters/generated?employeeId=${employeeId}`)}>
          <Plus size={12} />
          Generate letter
        </HrButton>
      ) : undefined}>
      {error ? <div role="alert"><p>{error.message}</p><HrButton onClick={() => refetch()}>Retry</HrButton></div> : isLoading ? (
        <CardSkeleton />
      ) : letters.length === 0 ? (
        <WsEmpty icon={FileText} title="No letters generated" hint="Generate an offer, appointment, or experience letter for this employee." />
      ) : (
        <DataTable
          columns={[
            { key: 'type', header: 'Type', render: (l) => <HrStatusPill tone="purple">{l.type}</HrStatusPill> },
            { key: 'subject', header: 'Subject', render: (l) => <span className="text-text-primary max-w-xs truncate">{l.subject}</span> },
            // Signed date once the employee has signed (BW-71), else the issue date HR chose, else when it was made.
            { key: 'date', header: 'Date', render: (l) => l.signedAt ? `Signed ${fmtDate(l.signedAt)}` : `Issued ${fmtDate(l.issueDate || l.createdAt)}` },
            { key: 'status', header: 'Status', render: (l) => <HrStatusPill tone={l.status === 'VOID' ? 'red' : l.status === 'SIGNED' ? 'ok' : l.status === 'SENT' ? 'info' : 'gray'}>{l.status === 'SIGNED' ? 'Signed' : l.signatureRequested && !l.signedAt && l.status !== 'VOID' ? 'Waiting for signature' : l.status}</HrStatusPill> },
            { key: 'action', header: '', render: (l) => (
              <button
                onClick={() => navigate(`/hrms/letters/generated/${l.id}`)}
                className="text-xs font-semibold text-[var(--u-brt)] hover:underline transition-colors"
              >
                View
              </button>
            ) }
          ]}
          data={letters}
          keyField="id"
          emptyMessage="No letters generated"
        />
      )}
      <HrPagination page={page} pageSize={LETTERS_PAGE_SIZE} totalElements={data?.totalElements ?? 0} totalPages={data?.totalPages ?? 0} onPageChange={setPage} />
    </SubSection>
  )
}

// ── Section wrapper ──────────────────────────────────────────────────────────

/** Persisted letters filtered and paginated by employee on the server. */
export function EmployeeLetters({ employeeId }: { employeeId: string }) {
  const canRead = usePermission(P.HRMS_LETTERS_READ)

  if (!canRead) {
    return (
      <SectionState
        error={{ status: 403 }}
        forbiddenTitle="You don’t have access to letters"
        forbiddenHint="Viewing generated letters needs the letters read permission."
      />
    )
  }

  return (
    <div className="space-y-4">
      <GeneratedLettersList employeeId={employeeId} />
    </div>
  )
}
