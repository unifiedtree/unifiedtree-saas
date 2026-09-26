// Work from home (/me/wfh), in the module kit's style. Same rules as the
// mobile screen: no past start date, end on or after start, a 10–500
// character reason, and no overlap with a pending or approved request. An
// approved day lets the person check in from anywhere (the geofence is lifted).
// POST /v1/wfh, GET /v1/wfh/my, POST /v1/wfh/{id}/cancel.
import { useMemo, useState } from 'react'
import { Field, Modal } from '@unifiedtree/ui-kit'
import { DateField } from '@/shared/components/calendar'
import { HrButton, HrStatusPill, type PillTone } from '@/shared/components/hr'
import { dashIcon } from '@/design/dc/icons'
import { ModulePage, Panel, State, RowList, Row, Note, SubHeading, useDesignToast, range, stamp, todayIso } from '@/design/module/ModuleKit'
import { useMyWfhRequests, useApplyWfh, useCancelWfh, type WfhApprovalStatus, type WfhRequestResponse } from '../api/useWfh'

const STATUS: Record<WfhApprovalStatus, [string, PillTone]> = { PENDING: ['Pending', 'warn'], APPROVED: ['Approved', 'ok'], REJECTED: ['Rejected', 'red'], CANCELLED: ['Cancelled', 'gray'], PENDING_L2: ['Awaiting HR', 'purple'] }
const span = (a: string, b: string) => { if (!a || !b || b < a) return 0; const [y1, m1, d1] = a.split('-').map(Number), [y2, m2, d2] = b.split('-').map(Number); return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 864e5) + 1 }

export function ApplyWfh() {
  const today = todayIso()
  const [from, setFrom] = useState(today)
  const [to, setTo] = useState(today)
  const [reason, setReason] = useState('')
  const [asking, setAsking] = useState<WfhRequestResponse | null>(null)
  const mine = useMyWfhRequests(0, 100)
  const apply = useApplyWfh(), cancel = useCancelWfh()
  const { show, node } = useDesignToast()
  const list = useMemo(() => mine.data?.content ?? [], [mine.data])
  const overlap = useMemo(() => list.find((r) => ['PENDING', 'APPROVED', 'PENDING_L2'].includes(r.status) && r.fromDate <= to && r.toDate >= from) || null, [list, from, to])
  const n = span(from, to), r = reason.trim()
  const problem = !from ? 'Pick a start date.' : !to ? 'Pick an end date.' : from < today ? 'The start date can’t be in the past.' : to < from ? 'The end date must be on or after the start date.'
    : r.length < 10 ? `The reason needs at least 10 characters (${r.length}/10).` : reason.length > 500 ? 'The reason can be 500 characters at most.' : overlap ? 'You already have a request on these dates.' : null
  const submit = async () => {
    if (problem) return
    try { await apply.mutateAsync({ fromDate: from, toDate: to, reason: r }); show('Work-from-home request sent', false, 'Your approver has been notified.'); setReason(''); setFrom(today); setTo(today) } catch (e) { show('Couldn’t send the request', true, (e as Error)?.message) }
  }
  const doCancel = async () => {
    if (!asking) return
    try { await cancel.mutateAsync(asking.id); show('Request cancelled'); setAsking(null) } catch (e) { show('Couldn’t cancel the request', true, (e as Error)?.message) }
  }
  return (
    <ModulePage crumb="My workspace" title="Work from home" subtitle="Ask to work from home on one or more days.">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,340px),1fr))', gap: 16, alignItems: 'start' }}>
        <Panel title="New request" sub="Your approver is notified as soon as you send it.">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,150px),1fr))', gap: 12 }}>
            <Field label="From *"><DateField min={today} value={from} onChange={(e) => { setFrom(e.target.value); if (to < e.target.value) setTo(e.target.value) }} /></Field>
            <Field label="To *"><DateField min={from || today} value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          </div>
          <label style={{ display: 'grid', gap: 6 }}>
            <span style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 600, color: '#334155' }}>Reason *<span style={{ fontWeight: 500, color: '#94a3b8' }}>{reason.length}/500</span></span>
            <textarea value={reason} maxLength={500} rows={3} onChange={(e) => setReason(e.target.value)} placeholder="At least 10 characters"
              style={{ font: 'inherit', fontSize: 14, padding: '9px 12px', border: '1px solid #cbd5e1', borderRadius: 10, outline: 'none', resize: 'vertical' }} />
          </label>
          {overlap && <Note tone="red">{`You already have a ${(STATUS[overlap.status]?.[0] || '').toLowerCase()} request for ${range(overlap.fromDate, overlap.toDate)}.`}</Note>}
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingTop: 4, borderTop: '1px solid #f1f5f9' }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: problem ? '#64748b' : '#0f6e56' }}>{problem || `${n} ${n === 1 ? 'day' : 'days'} from home`}</span>
            <HrButton onClick={submit} disabled={!!problem || apply.isPending}>{dashIcon('home', 15)} {apply.isPending ? 'Sending…' : 'Send request'}</HrButton>
          </div>
        </Panel>
        <Panel title="How it works" sub="What an approved day changes">
          <Note>On an approved day you can check in from anywhere: the office geofence doesn’t apply, and the day is marked as work from home.</Note>
          <Note>Requests you haven’t been answered on can be cancelled below. Ask your approver if a decision is taking long.</Note>
        </Panel>
      </div>
      <div style={{ display: 'grid', gap: 12 }}>
        <SubHeading>Your requests</SubHeading>
        {mine.isLoading ? <State kind="loading" />
          : mine.error ? <State kind="error" title="Couldn’t load your requests" description={(mine.error as Error).message} onRetry={() => mine.refetch()} />
            : list.length === 0 ? <State kind="empty" icon="home" title="No work-from-home requests yet" description="Requests you send appear here with their status." />
              : (
                <RowList>
                  {list.slice(0, 20).map((w) => {
                    const [lab, tone] = STATUS[w.status] || [w.status, 'gray' as PillTone], d = span(w.fromDate, w.toDate)
                    return <Row key={w.id} title={`${range(w.fromDate, w.toDate)} · ${d} ${d === 1 ? 'day' : 'days'}`} meta={`Asked ${stamp(w.createdAt)}${w.decisionNote ? ` · “${w.decisionNote}”` : ''}`} note={w.reason ? `“${w.reason}”` : undefined}
                      trail={<><HrStatusPill tone={tone}>{lab}</HrStatusPill>{(w.status === 'PENDING' || w.status === 'PENDING_L2') && <HrButton size="sm" variant="ghost" onClick={() => setAsking(w)}>Cancel</HrButton>}</>} />
                  })}
                </RowList>
              )}
      </div>
      <Modal open={!!asking} onOpenChange={(o: boolean) => { if (!o) setAsking(null) }} title="Cancel this request?" description={asking ? `Work from home, ${range(asking.fromDate, asking.toDate)}.` : ''} size="sm">
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
          <HrButton variant="ghost" onClick={() => setAsking(null)}>Keep it</HrButton>
          <HrButton variant="danger" onClick={doCancel} disabled={cancel.isPending}>{cancel.isPending ? 'Cancelling…' : 'Cancel request'}</HrButton>
        </div>
      </Modal>
      {node}
    </ModulePage>
  )
}
