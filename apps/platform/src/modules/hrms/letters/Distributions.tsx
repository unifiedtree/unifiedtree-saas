import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { HrStatusPill, TableCard, type PillTone } from '@/shared/components/hr'
import { State, stamp } from '@/design/module/ModuleKit'
import { useDistributions, type DistributionStatus } from './api/useDistribution'

const STATUS_TONE: Record<DistributionStatus, { label: string; tone: PillTone }> = {
  PENDING:         { label: 'Pending',    tone: 'gray' },
  PROCESSING:      { label: 'Processing', tone: 'info' },
  COMPLETED:       { label: 'Completed',  tone: 'ok' },
  PARTIAL_FAILURE: { label: 'Partial',    tone: 'warn' },
  FAILED:          { label: 'Failed',     tone: 'red' },
}

/** Bulk letter sends, newest first, 20 per page. Opens a distribution's own page on click. */
export function DistributionsList() {
  const navigate = useNavigate()
  const [page, setPage] = useState(0)
  const { data, isLoading, isError, error, refetch } = useDistributions(page)
  const jobs = data?.content ?? []
  const total = data?.totalElements ?? 0
  const totalPages = data?.totalPages ?? 1

  if (isLoading) return <State kind="loading" height={220} />
  if (isError) return <State kind="error" title="Couldn’t load distributions" description={(error as Error)?.message} onRetry={() => refetch()} />
  if (jobs.length === 0) return <State kind="empty" icon="fileText" title="No distributions yet" description="Send a letter, like a policy update, to many people at once." />
  return (
    <TableCard
      footer={total > 20 ? (
        <div className="flex items-center justify-between">
          <p className="text-xs text-text-secondary">Showing {page * 20 + 1}–{Math.min((page + 1) * 20, total)} of {total}</p>
          <div className="flex items-center gap-1">
            <button onClick={() => setPage((p) => p - 1)} disabled={page === 0} aria-label="Previous page" className="rounded-lg border border-border-default p-1.5 text-text-secondary hover:text-text-primary disabled:opacity-30"><ChevronLeft size={15} /></button>
            <span className="px-2 text-xs text-text-secondary">{page + 1} / {totalPages}</span>
            <button onClick={() => setPage((p) => p + 1)} disabled={page >= totalPages - 1} aria-label="Next page" className="rounded-lg border border-border-default p-1.5 text-text-secondary hover:text-text-primary disabled:opacity-30"><ChevronRight size={15} /></button>
          </div>
        </div>
      ) : undefined}
    >
      <table className="hr-table">
        <thead>
          <tr><th>Title</th><th>Recipients</th><th>Status</th><th className="hidden sm:table-cell">Created</th></tr>
        </thead>
        <tbody>
          {jobs.map((j) => {
            const s = STATUS_TONE[j.status] ?? { label: j.status, tone: 'gray' as PillTone }
            return (
              <tr key={j.id} onClick={() => navigate(`/hrms/letters/distributions/${j.id}`)} className="cursor-pointer">
                <td className="font-medium text-text-primary">{j.title}</td>
                <td className="text-text-secondary">
                  {`${j.sentCount} of ${j.totalRecipients} sent${j.failedCount > 0 ? ` · ${j.failedCount} failed` : ''}`}
                </td>
                <td><HrStatusPill tone={s.tone}>{s.label}</HrStatusPill></td>
                <td className="hidden sm:table-cell text-text-secondary">{j.createdAt ? stamp(j.createdAt) : '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </TableCard>
  )
}
