// One distribution (/hrms/letters/distributions/:jobId), on the kit (P-DOCS):
// sent, failed and still to send (the page follows a running send every 3
// seconds until it finishes), the message, every recipient with their status,
// and Retry for the failed ones.
import { useNavigate, useParams } from 'react-router-dom'
import { Can, P } from '@unifiedtree/sdk'
import {
  Button, Callout, EmptyState, ErrorState, MiniStat, MiniStatGrid, PageFrame, PageHeader, Section, SkeletonBlock,
  StatusPill, Table, type StatusTone, type TableColumn,
} from '@/design/kit/display'
import { useToast } from '@/design/kit/overlays'
import { useDistribution, useRetryDistribution, isTerminalStatus, type DistributionRecipientDto, type RecipientSendStatus } from './api/useDistribution'
import { dayText, distributionStatus, localDay } from './lettersModel'

const RECIP: Record<RecipientSendStatus, { label: string; tone: StatusTone }> = {
  PENDING: { label: 'Waiting', tone: 'neutral' },
  GENERATING: { label: 'Sending', tone: 'info' },
  SENT: { label: 'Sent', tone: 'success' },
  FAILED: { label: 'Failed', tone: 'danger' },
  SKIPPED: { label: 'Skipped', tone: 'warning' },
}

const at = (iso?: string) => (iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—')

export function DistributionDetail() {
  const { jobId } = useParams<{ jobId: string }>()
  const navigate = useNavigate()
  const toast = useToast()
  const { data: job, isLoading, isError, error, refetch } = useDistribution(jobId)
  const retry = useRetryDistribution()

  const back = <Button variant="secondary" onClick={() => navigate('/hrms/letters/distributions')}>← All distributions</Button>
  if (isLoading || !job) {
    return (
      <PageFrame label="Distribution">
        <PageHeader eyebrow="Letters · Distribution" title="Distribution" actions={back} />
        {isError ? <ErrorState title="Couldn’t load this distribution" error={error} onRetry={() => refetch()} />
          : isLoading ? <SkeletonBlock style={{ height: 220 }} /> : <EmptyState icon="fileText" title="Distribution not found" />}
      </PageFrame>
    )
  }

  const recipients = job.recipients ?? []
  const pending = recipients.filter((r) => r.sendStatus === 'PENDING' || r.sendStatus === 'GENERATING').length
  const running = !isTerminalStatus(job.status)
  const status = distributionStatus(job)

  const handleRetry = async () => {
    try {
      const r = await retry.mutateAsync(job.id)
      toast.success(`Retrying ${r.retried} failed recipient${r.retried === 1 ? '' : 's'}`)
    } catch (e) {
      toast.error('Couldn’t retry', { detail: (e as Error)?.message })
    }
  }

  const columns: TableColumn<DistributionRecipientDto>[] = [
    { key: 'email', header: 'Email', primary: true, render: (r) => r.email || <span className="lt-muted">No email</span> },
    { key: 'status', header: 'Status', render: (r) => <StatusPill tone={RECIP[r.sendStatus]?.tone ?? 'neutral'}>{RECIP[r.sendStatus]?.label ?? r.sendStatus}</StatusPill> },
    { key: 'sent', header: 'Sent at', render: (r) => at(r.sentAt) },
    { key: 'error', header: 'Why it failed', render: (r) => (r.errorMessage ? <span className="lt-danger-text" title={r.errorMessage}>{r.errorMessage}</span> : '') },
  ]

  return (
    <PageFrame label="Distribution">
      <PageHeader eyebrow="Letters · Distribution" title={job.title}
        sub={`${job.templateName ? `${job.templateName} · ` : ''}Created ${dayText(localDay(job.createdAt))}${running ? ' · still sending, this page updates by itself' : ''}`}
        actions={<>{back}{job.failedCount > 0 && (
          <Can code={P.HRMS_LETTERS_DISTRIBUTE}>
            <Button icon="arrowRight" loading={retry.isPending} onClick={handleRetry}>Retry failed</Button>
          </Can>
        )}</>} />
      <Section title="Progress" actions={<StatusPill tone={status.tone}>{status.label}</StatusPill>} body="tight" cardClass={false}>
        <MiniStatGrid>
          <MiniStat label="Sent" value={job.sentCount} note={`Of ${job.totalRecipients}`} tone="success" />
          <MiniStat label="Failed" value={job.failedCount} note={job.failedCount ? 'Retry them from the top' : 'None'} tone="danger" />
          <MiniStat label="Still to send" value={pending} note={running ? 'Sending now' : 'Done'} tone="warning" />
        </MiniStatGrid>
      </Section>
      {job.customMessage && <Callout tone="neutral">{job.customMessage.replace(/<[^>]+>/g, '')}</Callout>}
      <Section title="Recipients" count={recipients.length} body="flush" cardClass={false}
        empty={!recipients.length ? { title: 'No recipients' } : undefined}>
        <Table label="Recipients" columns={columns} rows={recipients} rowKey={(r) => r.id} mobile="cards" />
      </Section>
    </PageFrame>
  )
}
