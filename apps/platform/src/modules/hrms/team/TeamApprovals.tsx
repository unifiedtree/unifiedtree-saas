// Approvals (/team?view=approvals&tab=…; prototype TeamApprovals.dc.html): every request waiting
// for you in one list (GET /v1/team/approvals), with the tabs All · Leave · Attendance · Requests ·
// Expenses, each only with its permission. Approve and Reject go through each kind's own decide
// endpoint; a decision stays on the page with Undo while it can still be taken back.
import { useState } from 'react'
import { Button, Callout, EmptyState, FilterPills, PageHeader, SkeletonList, ErrorState, errorText } from '@/design/kit/display'
import { ApprovalRow, Dialog, PanelButton, useToast } from '@/design/kit/overlays'
import { Pager } from '@/design/kit/data'
import { useApprovalsInbox } from '../api/shared/useApprovalsInbox'
import { useRecentDecisions } from '../api/shared/useRecentDecisions'
import type { InboxRow, InboxTab, RecentDecision } from '../api/shared/contracts'
import { RejectReasonDialog } from './TeamDialogs'
import { useTeamDecisions } from './useTeamDecisions'
import {
  INBOX_TAB_LABEL, INBOX_TABS, KIND_LABEL, approvalsSub, decisionWord, decisionsInTab, easyRows, firstName, inboxWhat, relTime,
} from './teamModel'

const PAGE_SIZE = 50
type Busy = Record<string, 'approve' | 'reject' | 'undo'>

const UNAVAILABLE_WORD: Record<string, string> = {
  LEAVE: 'leave', WFH: 'work from home', CORRECTION: 'attendance fixes', SHIFT_CHANGE: 'shift changes', EXPENSE: 'expense claims', TIMESHEET: 'timesheets',
}

export function TeamApprovals({ tab, onTab }: { tab: InboxTab; onTab: (t: InboxTab) => void }) {
  const toast = useToast()
  const [page, setPage] = useState(0)
  const inbox = useApprovalsInbox({ tab, page, size: PAGE_SIZE })
  const recent = useRecentDecisions()
  const { decide, approveAll, undo } = useTeamDecisions()
  const [busy, setBusy] = useState<Busy>({})
  const [rejecting, setRejecting] = useState<InboxRow | null>(null)
  const [confirmAll, setConfirmAll] = useState(false)
  const [bulkBusy, setBulkBusy] = useState(false)
  const mark = (id: string, v?: Busy[string]) => setBusy((b) => { const n = { ...b }; if (v) n[id] = v; else delete n[id]; return n })

  const data = inbox.data
  const rows = data?.rows ?? []
  const decided = decisionsInTab(recent.data, tab)
  const pending = rows.filter((r) => !decided.some((d) => d.requestId === r.requestId))
  const easy = easyRows(pending)
  const waiting = data?.counts[tab] ?? 0
  const warned = pending.filter((r) => r.warnings.length > 0).length
  const tabs = (data?.tabs ?? []).filter((t) => (INBOX_TABS as readonly string[]).includes(t))

  const switchTab = (t: InboxTab) => { setPage(0); onTab(t) }

  const run = async (r: InboxRow, approve: boolean, note: string) => {
    mark(r.requestId, approve ? 'approve' : 'reject')
    try {
      await decide(r.kind, r.requestId, approve, note)
      toast.success(`${approve ? 'Approved' : 'Rejected'} · ${firstName(r.employeeName)} has been told`)
      setRejecting(null)
    } catch (e) {
      toast.error('Couldn’t save the decision', { detail: errorText(e, 'Try again in a moment.') })
    } finally {
      mark(r.requestId)
    }
  }
  const takeBack = async (d: RecentDecision) => {
    mark(d.requestId, 'undo')
    try {
      const r = await undo(d.kind, d.requestId)
      if (r.ok) toast.success(`Undone · ${firstName(r.employeeName)} has been told`)
      else toast.info('This decision can’t be taken back here.')
    } catch (e) {
      toast.error('Couldn’t undo the decision', { detail: errorText(e, 'Try again in a moment.') })
    } finally {
      mark(d.requestId)
    }
  }
  const approveEasy = async () => {
    setBulkBusy(true)
    try {
      const report = await approveAll(easy)
      setConfirmAll(false)
      if (!report.failed.length) toast.success(`Approved ${report.approved} ${report.approved === 1 ? 'request' : 'requests'}`, { detail: 'Everyone has been told.' })
      else {
        const first = report.failed[0]
        toast.error(`Approved ${report.approved} of ${report.approved + report.failed.length}`, {
          detail: `${report.failed.length === 1 ? '1 wasn’t' : `${report.failed.length} weren’t`} approved. ${firstName(first.row.employeeName)}: ${first.message}`,
        })
      }
    } finally {
      setBulkBusy(false)
    }
  }

  const header = (
    <PageHeader title="Approvals"
      sub={inbox.isLoading ? 'Loading what is waiting for you…' : inbox.error ? undefined : approvalsSub(waiting, warned, tab)}
      actions={easy.length > 1 ? (
        <Button variant="primary" size={40} icon="check" onClick={() => setConfirmAll(true)}>{`Approve ${easy.length} with no warnings`}</Button>
      ) : undefined} />
  )

  if (inbox.notAvailable) {
    return <>{header}<EmptyState variant="plain" icon="inbox" title="Approvals aren’t available yet" hint="Decide requests on the Leave, Attendance and Expenses pages for now." /></>
  }

  return (
    <>
      {header}
      {tabs.length > 1 && (
        <FilterPills label="Approval kinds" size="sm" value={tab} onChange={(v) => switchTab(v as InboxTab)}
          options={tabs.map((t) => ({ value: t, label: INBOX_TAB_LABEL[t], count: data?.counts[t] || null }))} />
      )}
      {data && data.unavailable.length > 0 && (
        <Callout tone="warning" icon="alertTriangle">
          {`Couldn’t load ${data.unavailable.map((k) => UNAVAILABLE_WORD[k] ?? k.toLowerCase()).join(', ')} just now; the rest is here.`}
          {' '}<Button variant="ghost" size={30} onClick={() => inbox.refetch()}>Try again</Button>
        </Callout>
      )}
      <section aria-label="Requests" className="tm-requests">
        {inbox.isLoading ? <SkeletonList rows={4} />
          : inbox.error ? <ErrorState title="Couldn’t load your approvals" error={inbox.error} onRetry={() => inbox.refetch()} />
            : pending.length === 0 && decided.length === 0 ? (
              <EmptyState variant="success" title="All caught up"
                hint="Nothing here is waiting for you. New requests from your team show up here and in the bell." />
            ) : (
              <>
                {decided.map((d) => (
                  <ApprovalRow key={`d-${d.id}`} variant="card" name={d.employeeName} title={d.summary}
                    status={d.decision === 'APPROVED' ? 'approved' : 'rejected'} statusLabel={decisionWord(d.decision)}
                    busy={busy[d.requestId] === 'undo' ? 'undo' : false} onUndo={() => takeBack(d)} undoUntil={d.undoUntil} />
                ))}
                {pending.map((r) => (
                  <ApprovalRow key={r.requestId} variant="card" name={r.employeeName} kind={KIND_LABEL[r.kind]}
                    meta={r.canDecide ? relTime(r.createdAt) : `${relTime(r.createdAt)} · not yours to decide`}
                    title={inboxWhat(r)} reason={r.reason || undefined}
                    facts={r.facts.map((f) => ({ label: f.label, value: f.value }))}
                    flag={r.warnings.length ? r.warnings.map((w) => w.text).join(' ') : undefined}
                    status="pending" busy={busy[r.requestId] ?? false} withNote={r.canDecide}
                    onApprove={r.canDecide ? (note) => run(r, true, note) : undefined}
                    onReject={r.canDecide ? (note) => (r.rejectNeedsReason && !note.trim() ? setRejecting(r) : run(r, false, note)) : undefined} />
                ))}
              </>
            )}
      </section>
      {data && data.totalElements > PAGE_SIZE && (
        <Pager page={page} pageSize={PAGE_SIZE} total={data.totalElements} onPageChange={setPage} noun="requests" />
      )}
      <RejectReasonDialog open={!!rejecting} name={rejecting?.employeeName ?? ''} busy={!!rejecting && busy[rejecting.requestId] === 'reject'}
        onClose={() => setRejecting(null)} onReject={(reason) => rejecting && run(rejecting, false, reason)} />
      <Dialog open={confirmAll} onClose={() => setConfirmAll(false)} busy={bulkBusy} icon="checkCircle"
        title={`Approve ${easy.length} requests?`}
        sub="None of them has a warning. Everyone is told."
        footer={(
          <>
            <PanelButton variant="secondary" onClick={() => setConfirmAll(false)} disabled={bulkBusy}>Cancel</PanelButton>
            <PanelButton variant="primary" busy={bulkBusy} onClick={approveEasy}>{`Approve ${easy.length}`}</PanelButton>
          </>
        )}>
        <ul className="tm-bulk-list">
          {easy.map((r) => <li key={r.requestId}><b>{r.employeeName}</b> · {inboxWhat(r)}</li>)}
        </ul>
      </Dialog>
    </>
  )
}
