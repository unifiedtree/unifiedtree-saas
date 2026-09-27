// "Needs your action" (PgDashboard overview): three filter tiles — attendance follow-ups, correction requests,
// leave approvals (leave + WFH, as the Leave page) — and the items behind them, with Approve / Reject inline.
// Counts come from the same lists as the rows (§5.5). A past date shows the queues as they stood that day
// (the dashboard's alerts); the rows are today's and stay on their own pages.
// Not built yet: Undo after a decision (BW-06) and Remind (BW-10) — hidden, never faked.
import { useMemo, useState } from 'react'
import { Avatar, Button, EmptyState, Section } from '@/design/kit/display'
import { Dialog, Textarea, useToast } from '@/design/kit/overlays'
import { dashIcon } from '@/design/dc/icons'
import { fmtShort } from '@/design/dc/dates'
import { usePendingApprovals, useLeaveDecision } from '../api/useLeave'
import { usePendingWfhApprovals, useWfhDecision } from '../api/useWfh'
import { useCorrectionApprovals, useDecideCorrection, type StaffStatusResponse } from '../api/useAttendance'
import { attendanceExceptions, clockIst, dayRange, daysWord, relTime, wdShort } from './dashboardModel'

type Kind = 'att' | 'fix' | 'leave'
interface Item { id: string; type: Kind; src: 'leave' | 'wfh' | 'fix' | 'att'; name: string; kind: string; what: string; when: string }

const TILE_ICON: Record<Kind, string> = { att: 'timer', fix: 'swap', leave: 'calendarCheck' }
const FILTER_WORD: Record<Kind, string> = { att: 'attendance follow-ups', fix: 'correction requests', leave: 'leave requests' }

export interface NeedsActionProps {
  isPast: boolean
  sel: string
  canAtt: boolean
  canFix: boolean
  canLeave: boolean
  canWfh: boolean
  staff?: readonly StaffStatusResponse[]
  staffLoading?: boolean
  /** A past date: the counts that day from /v1/admin/dashboard/alerts (undefined when not readable). */
  pastCounts?: { leave?: number; fix?: number }
  onNavigate: (path: string) => void
  style?: React.CSSProperties
}

const first = (n: string) => n.split(' ')[0] || n

export function useInboxCounts(p: Pick<NeedsActionProps, 'isPast' | 'canAtt' | 'canFix' | 'canLeave' | 'canWfh' | 'staff' | 'pastCounts'>) {
  // A past date takes that day's counts from the alerts; a count with no history there is today's, marked "As of today".
  const leaveToday = p.isPast && p.pastCounts?.leave == null, fixToday = p.isPast && p.pastCounts?.fix == null
  const leave = usePendingApprovals(0, p.canLeave && (!p.isPast || leaveToday))
  const wfh = usePendingWfhApprovals(0, 20, p.canLeave && p.canWfh && (!p.isPast || leaveToday))
  const fix = useCorrectionApprovals('PENDING', { enabled: p.canFix && (!p.isPast || fixToday), size: 20 })
  const att = useMemo(() => (p.canAtt ? attendanceExceptions(p.staff ?? [], p.isPast) : []), [p.canAtt, p.staff, p.isPast])
  const listLeave = (leave.data?.totalElements ?? 0) + (p.canWfh ? wfh.data?.totalElements ?? 0 : 0)
  const counts: Record<Kind, number> = {
    att: att.length,
    fix: p.isPast && !fixToday ? p.pastCounts!.fix! : fix.data?.totalElements ?? 0,
    leave: p.isPast && !leaveToday ? p.pastCounts!.leave! : listLeave,
  }
  const asOfToday: Record<Kind, boolean> = { att: false, fix: fixToday, leave: leaveToday }
  const total = (p.canAtt ? counts.att : 0) + (p.canFix ? counts.fix : 0) + (p.canLeave ? counts.leave : 0)
  return { leave, wfh, fix, att, counts, asOfToday, total }
}

export type Inbox = ReturnType<typeof useInboxCounts>

export function NeedsAction(props: NeedsActionProps & { inbox: Inbox }) {
  const { isPast, sel, canAtt, canFix, canLeave, canWfh, onNavigate, staffLoading, style, inbox } = props
  const toast = useToast()
  const { leave, wfh, fix, att, counts, asOfToday, total } = inbox
  const [filter, setFilter] = useState<Kind | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [rejecting, setRejecting] = useState<Item | null>(null)
  const [reason, setReason] = useState('')
  const leaveDecision = useLeaveDecision()
  const wfhDecision = useWfhDecision()
  const fixDecision = useDecideCorrection()

  const tiles = ([
    canAtt && { key: 'att' as Kind, label: 'Attendance follow-up', yes: isPast ? 'Exceptions that day' : 'Exceptions today', no: isPast ? 'Nothing that day' : 'Nothing today' },
    canFix && { key: 'fix' as Kind, label: 'Correction requests', yes: 'Waiting on you', no: 'Nothing waiting' },
    canLeave && { key: 'leave' as Kind, label: 'Leave approvals', yes: 'Waiting on you', no: 'Nothing waiting' },
  ].filter(Boolean)) as { key: Kind; label: string; yes: string; no: string }[]

  const items: Item[] = useMemo(() => {
    const out: Item[] = []
    if (canAtt) for (const a of att) out.push({ id: 'att-' + a.id, type: 'att', src: 'att', name: a.name, kind: a.kind, what: a.what, when: a.when })
    if (isPast) return out
    if (canFix) for (const c of fix.data?.content ?? []) {
      const kind = c.requestedCheckInAt && c.requestedCheckOutAt ? 'Punch correction' : c.requestedCheckOutAt ? 'Missed punch-out' : 'Missed punch-in'
      const asks = c.requestedCheckOutAt ? clockIst(c.requestedCheckOutAt) : clockIst(c.requestedCheckInAt)
      out.push({ id: c.id, type: 'fix', src: 'fix', name: c.employeeName || 'Employee', kind, what: `${wdShort(c.requestedDate)}${asks ? ` · asks for ${asks}` : ''}`, when: relTime(c.createdAt) })
    }
    if (canLeave) {
      for (const l of leave.data?.content ?? []) out.push({ id: l.id, type: 'leave', src: 'leave', name: l.employeeName || 'Employee', kind: l.leaveTypeName || 'Leave', what: `${dayRange(l.startDate, l.endDate)} · ${daysWord(Number(l.totalDays) || 0)}`, when: relTime(l.createdAt) })
      if (canWfh) for (const w of wfh.data?.content ?? []) {
        const n = Math.round((new Date(w.toDate).getTime() - new Date(w.fromDate).getTime()) / 86400000) + 1
        out.push({ id: w.id, type: 'leave', src: 'wfh', name: w.employeeName || 'Employee', kind: 'Work from home', what: `${dayRange(w.fromDate, w.toDate)} · ${daysWord(n)}`, when: relTime(w.createdAt) })
      }
    }
    return out
  }, [att, fix.data, leave.data, wfh.data, canAtt, canFix, canLeave, canWfh, isPast])

  const shown = items.filter((it) => !filter || it.type === filter).slice(0, 4)
  const loading = (canLeave && !isPast && leave.isLoading) || (canFix && !isPast && fix.isLoading) || (canAtt && !!staffLoading)
  const errored = (canLeave && !isPast && leave.isError) || (canFix && !isPast && fix.isError) || (canLeave && canWfh && !isPast && wfh.isError)
  const retry = () => { leave.refetch(); fix.refetch(); wfh.refetch() }

  const decide = async (it: Item, approve: boolean, comment?: string) => {
    setBusy(it.id)
    const what = it.kind.toLowerCase()
    try {
      if (it.src === 'leave') await leaveDecision.mutateAsync({ requestId: it.id, status: approve ? 'APPROVED' : 'REJECTED', comment })
      else if (it.src === 'wfh') await wfhDecision.mutateAsync({ requestId: it.id, approved: approve, comment })
      else await fixDecision.mutateAsync({ id: it.id, status: approve ? 'APPROVED' : 'REJECTED', comment })
      toast.success(`${approve ? 'Approved' : 'Rejected'} ${first(it.name)}’s ${what}`)
      setRejecting(null); setReason('')
    } catch (e) {
      toast.error(approve ? 'Couldn’t approve it' : 'Couldn’t reject it', { detail: (e as Error)?.message || 'Please try again.' })
    } finally {
      setBusy(null)
    }
  }

  const target = (k: Kind | null): string => {
    const key = k ?? (canLeave && counts.leave ? 'leave' : canFix && counts.fix ? 'fix' : canAtt && counts.att ? 'att' : canLeave ? 'leave' : canFix ? 'fix' : 'att')
    return key === 'leave' ? '/hrms/leave?tab=approvals' : key === 'fix' ? '/hrms/attendance?tab=corrections' : `/hrms/attendance?tab=team&date=${sel}`
  }
  const footTotal = filter ? counts[filter] : total
  const filtered = !!filter && total > 0

  return (
    <Section
      variant="dashboard" title={isPast ? `Waiting on ${fmtShort(sel)}` : 'Needs your action'} count={total ? total : null} countTone="gold" countLabel={`${total} need you`}
      sub={isPast ? 'The queues as they stood that day. Pick a tile to filter.' : 'Attendance follow-ups and approvals. Pick a tile to filter.'}
      body="flush" style={style}
      footerLink={{ label: footTotal ? `View all ${footTotal} ${footTotal === 1 ? 'item' : 'items'}` : 'Open approvals', onClick: () => onNavigate(target(filter)) }}
    >
      <div className="ud-tiles" role="group" aria-label="Filter the items">
        {tiles.map((t) => (
          <button key={t.key} type="button" className="ud-tile" aria-pressed={filter === t.key} onClick={() => setFilter((f) => (f === t.key ? null : t.key))}>
            <span className="ud-tile__top"><span className="ud-tile__n">{counts[t.key]}</span><span className="ud-tile__ic" aria-hidden="true">{dashIcon(TILE_ICON[t.key], 18)}</span></span>
            <span className="ud-tile__label">{t.label}</span>
            <span className="ud-tile__sub">{asOfToday[t.key] ? 'As of today' : counts[t.key] ? t.yes : t.no}</span>
          </button>
        ))}
      </div>
      {isPast && (canFix || canLeave) && <p className="ud-note">Requests are decided on their own pages; open them from View all.{(canFix && asOfToday.fix) || (canLeave && asOfToday.leave) ? ' A count marked “As of today” keeps no history, so it shows today.' : ''}</p>}
      {loading ? (
        <div className="ud-inbox-list" aria-busy="true" role="status" aria-label="Loading items">
          {[0, 1, 2].map((i) => <div key={i} className="ud-inbox-row"><span className="uk-skel uk-skel--hv" style={{ width: 34, height: 34, borderRadius: '50%' }} /><span className="uk-skel uk-skel--ln" style={{ flex: 1, height: 12, borderRadius: 6 }} /></div>)}
        </div>
      ) : errored ? (
        <div className="ud-inbox-empty"><EmptyState title="Couldn’t load the requests" hint="Check your connection and try again." action={<Button size={32} onClick={retry}>Try again</Button>} /></div>
      ) : shown.length ? (
        <div className="ud-inbox-list" role="list" aria-label="Items waiting on you">
          {shown.map((it) => (
            <div key={it.id} role="listitem" className="ud-inbox-row">
              <Avatar name={it.name} size={34} />
              <div className="ud-inbox-row__txt">
                <div className="ud-inbox-row__name">{it.name}</div>
                <div className="ud-inbox-row__sub"><span className="ud-kind">{it.kind}</span> · {it.what}</div>
              </div>
              {it.when && <span className="ud-when">{it.when}</span>}
              {it.src !== 'att' && (
                <>
                  <button type="button" className="ud-ibtn" aria-label={`Reject ${it.name}’s ${it.kind.toLowerCase()}`} title="Reject" disabled={busy === it.id} onClick={() => { setReason(''); setRejecting(it) }}>
                    {dashIcon('x', 15)}
                  </button>
                  <button type="button" className="ud-ibtn ud-ibtn--ok" aria-label={`Approve ${it.name}’s ${it.kind.toLowerCase()}`} title="Approve" disabled={busy === it.id} onClick={() => decide(it, true)}>
                    {dashIcon('check', 15)}
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="ud-inbox-empty">
          <EmptyState variant="success" title={filtered ? `No ${FILTER_WORD[filter!]} waiting` : 'All caught up'}
            hint={filtered ? 'Pick another tile to see the rest.' : isPast ? 'Nothing was waiting that day.' : 'Nothing is waiting on you.'} />
        </div>
      )}
      <Dialog open={!!rejecting} onClose={() => { if (!busy) setRejecting(null) }} title={rejecting ? `Reject ${first(rejecting.name)}’s ${rejecting.kind.toLowerCase()}?` : ''}
        sub={rejecting ? rejecting.what : undefined} tone="danger" busy={!!busy}
        footer={<>
          <Button variant="ghost" onClick={() => setRejecting(null)} disabled={!!busy}>Cancel</Button>
          <Button variant="danger" loading={!!busy} disabled={rejecting?.src === 'wfh' && !reason.trim()} onClick={() => rejecting && decide(rejecting, false, reason.trim() || undefined)}>Reject</Button>
        </>}>
        <Textarea label={rejecting?.src === 'wfh' ? 'Reason' : 'Reason (optional)'} required={rejecting?.src === 'wfh'} rows={3} maxLength={500}
          value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Tell them why, so they can plan" />
      </Dialog>
    </Section>
  )
}

