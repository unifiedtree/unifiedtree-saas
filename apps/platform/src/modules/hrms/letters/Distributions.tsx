// Distributions, on the kit (P-DOCS; prototype PgTalent h-letters tab 2): one
// letter sent to many people. Scheduled sends ("Send on", BW-73) come first,
// with their date and Cancel; then every distribution, newest first: its name,
// the letter, how many people, when, and how it went, in the words the server
// can stand behind ("sent", "failed"). A row opens the distribution.
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { P, usePermission } from '@unifiedtree/sdk'
import { Button, CellActions, CellStack, Section, StatusPill, Table, type TableColumn } from '@/design/kit/display'
import { Pager } from '@/design/kit/data'
import { useToast } from '@/design/kit/overlays'
import { useConfirmDialog } from '@/shared/components/ConfirmDialog'
import {
  useCancelScheduledDistribution, useDistributions, useScheduledDistributions,
  type DistributionJobDto, type ScheduledDistribution,
} from './api/useDistribution'
import { distributionStatus, localDay, scheduleStatus, shortDay } from './lettersModel'

function Scheduled() {
  const toast = useToast()
  const confirm = useConfirmDialog()
  const canDistribute = usePermission(P.HRMS_LETTERS_DISTRIBUTE)
  const q = useScheduledDistributions()
  const cancel = useCancelScheduledDistribution()
  const rows = q.data ?? []
  if (q.notAvailable || (q.isSuccess && rows.length === 0)) return null
  const remove = async (s: ScheduledDistribution) => {
    const failed = s.status === 'FAILED'
    const ok = await confirm({
      title: failed ? `Remove “${s.title}”?` : `Cancel “${s.title}”?`,
      body: failed ? 'It never started, so nothing was sent.' : `It won’t be sent on ${shortDay(s.sendOn)}. Nothing has been sent yet.`,
      confirmLabel: failed ? 'Remove' : 'Cancel the send', cancelLabel: 'Keep it', tone: 'danger',
    })
    if (!ok) return
    try { await cancel.mutateAsync(s.id); toast.success(failed ? 'Removed' : 'Scheduled send cancelled') } catch (e) { toast.error('Couldn’t cancel it', { detail: (e as Error)?.message }) }
  }
  const columns: TableColumn<ScheduledDistribution>[] = [
    { key: 'title', header: 'Distribution', primary: true, render: (s) => <CellStack primary={s.title} secondary={s.failureReason ?? undefined} /> },
    { key: 'letter', header: 'Letter', render: (s) => s.templateName ?? '—' },
    { key: 'recipients', header: 'Recipients', numeric: true, render: (s) => (s.recipientsAtSchedule ?? '—') },
    { key: 'status', header: 'Status', render: (s) => { const st = scheduleStatus(s); return <StatusPill tone={st.tone}>{st.label}</StatusPill> } },
    ...(canDistribute ? [{
      key: 'actions', header: <span className="sr-only">Actions</span>, label: 'Actions', align: 'right' as const,
      render: (s: ScheduledDistribution) => s.status === 'STARTING' ? null : (
        <CellActions><Button size={30} variant="secondary" aria-label={`${s.status === 'FAILED' ? 'Remove' : 'Cancel'} ${s.title}`} onClick={() => remove(s)}>
          {s.status === 'FAILED' ? 'Remove' : 'Cancel'}</Button></CellActions>
      ),
    }] : []),
  ]
  return (
    <Section title="Scheduled" count={rows.length} sub="Sends at 9:00 India time on its date, to the people who match then." body="flush" cardClass={false}
      loading={q.isLoading} skeleton="table" error={q.error} onRetry={() => q.refetch()}>
      <Table label="Scheduled distributions" columns={columns} rows={rows} rowKey={(s) => s.id} mobile="cards" />
    </Section>
  )
}

/** Bulk letter sends, newest first, 20 per page. Opens a distribution's own page on click. */
export function DistributionsList() {
  const navigate = useNavigate()
  const [page, setPage] = useState(0)
  const { data, isLoading, error, refetch, isFetching } = useDistributions(page)
  const jobs = data?.content ?? []
  const total = data?.totalElements ?? 0
  const columns: TableColumn<DistributionJobDto>[] = [
    { key: 'title', header: 'Distribution', primary: true, render: (j) => j.title },
    { key: 'letter', header: 'Letter', render: (j) => j.templateName ?? '—' },
    { key: 'recipients', header: 'Recipients', numeric: true, render: (j) => j.totalRecipients },
    { key: 'sent', header: 'Sent', render: (j) => shortDay(localDay(j.completedAt ?? j.createdAt)) },
    { key: 'status', header: 'Status', render: (j) => { const s = distributionStatus(j); return <StatusPill tone={s.tone}>{s.label}</StatusPill> } },
  ]
  return (
    <div className="lt-stack">
      <Scheduled />
      <Section title="Distributions" body="flush" cardClass={false}
        loading={isLoading} skeleton="table" error={error} onRetry={() => refetch()} retrying={isFetching}
        empty={!isLoading && !error && jobs.length === 0 ? { title: 'No distributions yet', hint: 'Send a letter, like a policy update, to many people at once.' } : undefined}
        footer={total > 20 ? <Pager page={page} pageSize={20} total={total} onPageChange={setPage} noun="distributions" /> : undefined}>
        <Table label="Distributions" columns={columns} rows={jobs} rowKey={(j) => j.id} mobile="cards"
          onRowClick={(j) => navigate(`/hrms/letters/distributions/${j.id}`)} rowHref={(j) => `/hrms/letters/distributions/${j.id}`} />
      </Section>
    </div>
  )
}
