import React from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, RefreshCw, Loader2, CheckCircle2, XCircle, Clock } from 'lucide-react'
import { useToast } from '@/shared/hooks/useToast'
import { Can, P } from '@unifiedtree/sdk'
import { CardSkeleton } from '@unifiedtree/ui-kit'
import { format } from 'date-fns'
import { HrPageHeader, HrStatCard, HrStatusPill, HrButton, TableCard, type PillTone } from '@/shared/components/hr'
import { useDistribution, useRetryDistribution, isTerminalStatus, type RecipientSendStatus } from './api/useDistribution'

const RECIP_STYLE: Record<RecipientSendStatus, { label: string; tone: PillTone }> = {
  PENDING:    { label: 'Pending',    tone: 'gray' },
  GENERATING: { label: 'Generating', tone: 'info' },
  SENT:       { label: 'Sent',       tone: 'ok' },
  FAILED:     { label: 'Failed',     tone: 'red' },
  SKIPPED:    { label: 'Skipped',    tone: 'warn' },
}

export function DistributionDetail() {
  const { jobId } = useParams<{ jobId: string }>()
  const navigate = useNavigate()
  const { toast } = useToast()
  const { data: job, isLoading } = useDistribution(jobId)
  const retry = useRetryDistribution()

  if (isLoading || !job) {
    return <div className="mx-auto max-w-5xl p-6 sm:p-8"><CardSkeleton /></div>
  }

  const recipients = job.recipients ?? []
  const pending = recipients.filter((r) => r.sendStatus === 'PENDING' || r.sendStatus === 'GENERATING').length
  const running = !isTerminalStatus(job.status)

  const handleRetry = async () => {
    try {
      const r = await retry.mutateAsync(job.id)
      toast(`Retrying ${r.retried} failed recipient${r.retried === 1 ? '' : 's'}`, 'success')
    } catch {
      toast('Retry failed', 'error')
    }
  }

  const subtitle = (
    <>
      Created {job.createdAt ? format(new Date(job.createdAt), 'dd MMM yyyy, HH:mm') : '—'}
      {running && (
        <> · <span className="inline-flex items-center gap-1 text-[#C16E00]"><Loader2 size={12} className="animate-spin" /> live</span></>
      )}
    </>
  )

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-6 sm:p-8">
      <button onClick={() => navigate('/hrms/letters/distributions')}
        className="flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary">
        <ArrowLeft size={15} /> Distributions
      </button>

      <HrPageHeader
        crumb="Letters"
        title={job.title}
        subtitle={subtitle}
        actions={
          job.failedCount > 0 ? (
            <Can code={P.HRMS_LETTERS_DISTRIBUTE}>
              <HrButton onClick={handleRetry} disabled={retry.isPending}>
                <RefreshCw size={14} className={retry.isPending ? 'animate-spin' : ''} /> Retry Failed
              </HrButton>
            </Can>
          ) : undefined
        }
      />

      {job.customMessage && (
        <p className="max-w-2xl whitespace-pre-wrap text-sm text-text-secondary">
          {job.customMessage.replace(/<[^>]+>/g, '')}
        </p>
      )}

      <div className="grid max-w-2xl grid-cols-3 gap-3">
        <HrStatCard icon={<CheckCircle2 size={18} />} color="green" value={job.sentCount} label="Sent" />
        <HrStatCard icon={<XCircle size={18} />} color="red" value={job.failedCount} label="Failed" />
        <HrStatCard icon={<Clock size={18} />} color="orange" value={pending} label="Pending" />
      </div>

      <TableCard>
        <table className="hr-table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Status</th>
              <th>Sent At</th>
              <th>Error</th>
            </tr>
          </thead>
          <tbody>
            {recipients.map((r) => {
              const s = RECIP_STYLE[r.sendStatus]
              return (
                <tr key={r.id}>
                  <td className="text-text-primary">
                    {r.email || <span className="italic text-text-tertiary">no email</span>}
                  </td>
                  <td>
                    <HrStatusPill tone={s.tone}>{s.label}</HrStatusPill>
                  </td>
                  <td className="text-text-secondary">
                    {r.sentAt ? format(new Date(r.sentAt), 'dd MMM HH:mm') : '—'}
                  </td>
                  <td className="max-w-xs truncate text-xs text-[#B91C1C]" title={r.errorMessage ?? ''}>
                    {r.errorMessage ?? ''}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </TableCard>
    </div>
  )
}
