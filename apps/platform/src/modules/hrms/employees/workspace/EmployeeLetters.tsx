/**
 * Letters — letters GENERATED for this employee (offer, appointment, …).
 *
 * Deliberately separate from Documents: a generated letter is produced by the
 * letters engine from a template, a document is a record someone filed against
 * the employee. Until 5A these were the same tab, labelled "Documents" and
 * showing letters — so uploaded documents had no home on the profile at all.
 */

import React, { useState } from 'react'
import { Info } from 'lucide-react'
import { SectionState } from './shared'
import type { GeneratedLetterDto } from '../../letters/api/useLetters'
import { Button, Field, Input, TableSkeleton, CardSkeleton } from '@unifiedtree/ui-kit'
import { Can, P, usePermission } from '@unifiedtree/sdk'
import { DataTable } from '@/shared/components/DataTable'
import { EmptyState } from '@/shared/components/EmptyState'
import { FileText, Plus } from 'lucide-react'
import { HrDrawer, HrStatusPill, HrButton, TableCard, type PillTone } from '@/shared/components/hr'
import { apiJson } from '@/core/api/client'
import { format } from 'date-fns'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'

// ── Tab: Documents ────────────────────────────────────────────────────────────
// TODO[backend]: POST /v1/employees/{id}/profile/documents (multipart/form-data, S3-compatible storage) — file upload stays out of scope for Phase 1

const LETTERS_PAGE_SIZE = 10

function GeneratedLettersList({ employeeId }: { employeeId: string }) {
  const navigate = useNavigate()

  // `employeeId` is sent, but LetterController.listGenerated(Pageable) declares
  // no such parameter — VERIFIED 2026-09-22 — so the SERVER ignores it and
  // returns the workspace's most recent letters. The client-side filter below
  // is therefore the only thing keeping another employee's letters off this
  // profile, and it is load-bearing, not defensive. The param stays so the page
  // starts working correctly the moment the backend honours it.
  //
  // There is deliberately NO pager. Paging here would walk the whole
  // workspace's letters hoping to find more of this employee's — the fan-out
  // this milestone forbids — and each page would be filtered down to a
  // near-empty table. One bounded request, plus a banner that admits the list
  // may be short, beats a pager that appears to work and does not.
  const { data, isLoading } = useQuery({
    queryKey: ['hrms', 'letters', 'generated', 'employee', employeeId],
    queryFn: () => apiJson<{ content: GeneratedLetterDto[]; totalElements: number; totalPages: number }>(
      `/v1/letters/generated?employeeId=${encodeURIComponent(employeeId)}&page=0&size=${LETTERS_PAGE_SIZE}`
    ),
    select: r => ({ ...r, content: r.content.filter(l => l.employeeId === employeeId) }),
    staleTime: 30_000,
    enabled: !!employeeId,
  })

  const letters = data?.content ?? []

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-text-primary">Generated Letters</h3>
        <Can code={P.HRMS_LETTERS_GENERATE}>
          <HrButton
            size="sm"
            onClick={() => navigate(`/hrms/letters/generated?employeeId=${employeeId}`)}
          >
            <Plus size={12} />
            Generate letter
          </HrButton>
        </Can>
      </div>

      {isLoading ? (
        <CardSkeleton />
      ) : letters.length === 0 ? (
        <EmptyState icon={FileText} title="No letters generated" description="Generate an offer, appointment, or experience letter for this employee." />
      ) : (
        <DataTable
          columns={[
            { key: 'type', header: 'Type', render: (l) => <HrStatusPill tone="purple">{l.type}</HrStatusPill> },
            { key: 'subject', header: 'Subject', render: (l) => <span className="text-text-primary max-w-xs truncate">{l.subject}</span> },
            { key: 'date', header: 'Date', render: (l) => format(new Date(l.createdAt), 'dd MMM yyyy') },
            { key: 'status', header: 'Status', render: (l) => <HrStatusPill tone={l.status === 'VOID' ? 'red' : l.status === 'SENT' ? 'info' : 'gray'}>{l.status}</HrStatusPill> },
            { key: 'action', header: '', render: (l) => (
              <button
                onClick={() => navigate(`/hrms/letters/generated/${l.id}`)}
                className="text-xs font-semibold text-[#047857] hover:text-[#059669] transition-colors"
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
    </div>
  )
}

// ── Section wrapper ──────────────────────────────────────────────────────────

/**
 * Letters generated for this employee.
 *
 * KNOWN INCOMPLETENESS, surfaced rather than hidden: GET /v1/letters/generated
 * takes a Pageable and nothing else — LetterController.listGenerated has no
 * employeeId parameter, so the `?employeeId=` this page sends is ignored by the
 * server and the list below is one page of the workspace's most recent letters
 * filtered in the browser. Letters genuinely belonging to this employee are
 * therefore never wrong, but they CAN be missing if newer letters were generated
 * for other people. The banner says so, because a silently short list reads as
 * "no letters were ever issued".
 *
 * The fix is a backend filter, not a bigger client-side sweep: paging the whole
 * workspace to assemble one employee's letters is exactly the fan-out this
 * milestone forbids.
 */
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
      <div className="ut-card p-4 flex gap-3">
        <Info size={15} className="text-text-tertiary shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-text-primary">This list may be incomplete</p>
          <p className="text-xs text-text-secondary mt-0.5">
            Letters can’t yet be queried per employee, so only recently generated letters are
            matched here. Open Letters → Generated for the full history.
          </p>
        </div>
      </div>
      <GeneratedLettersList employeeId={employeeId} />
    </div>
  )
}
