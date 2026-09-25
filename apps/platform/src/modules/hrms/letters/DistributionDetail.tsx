import React from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { RefreshCw } from 'lucide-react'
import { useToast } from '@/shared/hooks/useToast'
import { Can, P } from '@unifiedtree/sdk'
import { HrStatusPill, HrButton, TableCard, type PillTone } from '@/shared/components/hr'
import { ModulePage, State, StatRow, Note, stamp } from '@/design/module/ModuleKit'
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
  const { data: job, isLoading, isError, error, refetch } = useDistribution(jobId)
  const retry = useRetryDistribution()

  const back = <HrButton variant="ghost" onClick={() => navigate('/hrms/letters/distributions')}>← All distributions</HrButton>
  if (isLoading || !job) {
    return (
      <ModulePage crumb="Letters" title="Distribution" actions={back}>
        {isError ? <State kind="error" title="Couldn’t load this distribution" description={(error as Error)?.message} onRetry={() => refetch()} />
          : isLoading ? <State kind="loading" height={220} /> : <State kind="empty" icon="fileText" title="Distribution not found" />}
      </ModulePage>
    )
  }

  const recipients = job.recipients ?? []
  const pending = recipients.filter((r) => r.sendStatus === 'PENDING' || r.sendStatus === 'GENERATING').length
  const running = !isTerminalStatus(job.status)

  const handleRetry = async () => {
    try {
      const r = await retry.mutateAsync(job.id)
      toast(`Retrying ${r.retried} failed recipient${r.retried === 1 ? '' : 's'}`, 'success')
    } catch (e) {
      toast((e as Error)?.message || 'Couldn’t retry', 'error')
    }
  }

  const subtitle = `Created ${job.createdAt ? stamp(job.createdAt) : '—'}${running ? ' · still sending, this page updates by itself' : ''}`

  return (
    <ModulePage crumb="Letters · Distribution" title={job.title} subtitle={subtitle}
      actions={<>{back}{job.failedCount > 0 && (
        <Can code={P.HRMS_LETTERS_DISTRIBUTE}>
          <HrButton onClick={handleRetry} disabled={retry.isPending}><RefreshCw size={14} className={retry.isPending ? 'animate-spin' : ''} /> Retry failed</HrButton>
        </Can>
      )}</>}>
      {job.customMessage && <Note>{job.customMessage.replace(/<[^>]+>/g, '')}</Note>}
      <StatRow tiles={[
        { icon: 'checkCircle', color: 'green', label: 'Sent', value: String(job.sentCount), sub: `Of ${job.totalRecipients}` },
        { icon: 'circleX', color: 'red', label: 'Failed', value: String(job.failedCount), sub: job.failedCount ? 'Retry them from the top' : 'None' },
        { icon: 'clock', color: 'orange', label: 'Still to send', value: String(pending), sub: running ? 'Sending now' : 'Done' },
      ]} />

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
                    {r.sentAt ? stamp(r.sentAt) : '—'}
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
    </ModulePage>
  )
}
