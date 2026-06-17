import React from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, RefreshCw, Loader2 } from 'lucide-react'
import { clsx } from 'clsx'
import { useToast } from '@/shared/hooks/useToast'
import { Can, P } from '@unifiedtree/sdk'
import { CardSkeleton } from '@unifiedtree/ui-kit'
import { format } from 'date-fns'
import { useDistribution, useRetryDistribution, isTerminalStatus, type RecipientSendStatus } from './api/useDistribution'

const RECIP_STYLE: Record<RecipientSendStatus, { label: string; cls: string }> = {
  PENDING:    { label: 'Pending',    cls: 'text-slate-500 bg-slate-100' },
  GENERATING: { label: 'Generating', cls: 'text-blue-600 bg-blue-50' },
  SENT:       { label: 'Sent',       cls: 'text-emerald-600 bg-emerald-50' },
  FAILED:     { label: 'Failed',     cls: 'text-red-600 bg-red-50' },
  SKIPPED:    { label: 'Skipped',    cls: 'text-amber-600 bg-amber-50' },
}

function Stat({ label, value, cls }: { label: string; value: number; cls: string }) {
  return (
    <div className="bg-white border border-border rounded-xl px-4 py-3">
      <p className="text-xs text-text-secondary">{label}</p>
      <p className={clsx('text-xl font-semibold mt-0.5', cls)}>{value}</p>
    </div>
  )
}

export function DistributionDetail() {
  const { jobId } = useParams<{ jobId: string }>()
  const navigate = useNavigate()
  const { toast } = useToast()
  const { data: job, isLoading } = useDistribution(jobId)
  const retry = useRetryDistribution()

  if (isLoading || !job) {
    return <div className="p-6"><CardSkeleton /></div>
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

  return (
    <div className="p-6 space-y-5">
      <button onClick={() => navigate('/hrms/letters/distributions')}
        className="flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary">
        <ArrowLeft size={15} /> Distributions
      </button>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-text-primary">{job.title}</h1>
          <p className="text-text-secondary text-sm mt-1">
            Created {job.createdAt ? format(new Date(job.createdAt), 'dd MMM yyyy, HH:mm') : '—'}
            {running && (
              <> · <span className="inline-flex items-center gap-1 text-blue-600"><Loader2 size={12} className="animate-spin" /> live</span></>
            )}
          </p>
          {job.customMessage && (
            <p className="text-text-secondary text-sm mt-2 max-w-2xl whitespace-pre-wrap">
              {job.customMessage.replace(/<[^>]+>/g, '')}
            </p>
          )}
        </div>
        {job.failedCount > 0 && (
          <Can code={P.HRMS_LETTERS_DISTRIBUTE}>
            <button onClick={handleRetry} disabled={retry.isPending}
              className="flex items-center gap-1.5 px-3 py-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-sm font-medium rounded-xl transition-colors flex-shrink-0">
              <RefreshCw size={14} className={retry.isPending ? 'animate-spin' : ''} /> Retry Failed
            </button>
          </Can>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3 max-w-md">
        <Stat label="Sent" value={job.sentCount} cls="text-emerald-600" />
        <Stat label="Failed" value={job.failedCount} cls="text-red-600" />
        <Stat label="Pending" value={pending} cls="text-slate-500" />
      </div>

      <div className="bg-white border border-border rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-text-secondary text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-3 font-medium">Email</th>
              <th className="text-left px-4 py-3 font-medium">Status</th>
              <th className="text-left px-4 py-3 font-medium">Sent At</th>
              <th className="text-left px-4 py-3 font-medium">Error</th>
            </tr>
          </thead>
          <tbody>
            {recipients.map((r) => {
              const s = RECIP_STYLE[r.sendStatus]
              return (
                <tr key={r.id} className="border-t border-border">
                  <td className="px-4 py-3 text-text-primary">
                    {r.email || <span className="text-text-secondary italic">no email</span>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={clsx('inline-flex px-2 py-0.5 rounded-full text-xs font-medium', s.cls)}>{s.label}</span>
                  </td>
                  <td className="px-4 py-3 text-text-secondary">
                    {r.sentAt ? format(new Date(r.sentAt), 'dd MMM HH:mm') : '—'}
                  </td>
                  <td className="px-4 py-3 text-red-600 text-xs max-w-xs truncate" title={r.errorMessage ?? ''}>
                    {r.errorMessage ?? ''}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
