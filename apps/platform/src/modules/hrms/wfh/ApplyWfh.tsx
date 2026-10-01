// Work from home (/me/wfh), redesign P-HOME (EmpTime.dc.html, e-wfh): pick separate days as chips,
// say why, send them in one go (POST /v1/wfh/batch: each run of days in a row is one request, one
// notification to the approver). Days with a holiday, leave or a request already on them can't be
// picked. The reason keeps today's 10–500 characters. An approved day lets the person check in from
// anywhere (the geofence is lifted). GET /v1/wfh/my, POST /v1/wfh/{id}/cancel as before.
import { useMemo, useState } from 'react'
import { Button, Callout, ListRow, ListRows, PageFrame, PageHeader, Section, StatusPill, type StatusTone } from '@/design/kit/display'
import { Dialog, PanelButton, Textarea, useToast } from '@/design/kit/overlays'
import { errorText } from '@/design/kit/EmptyState'
import { addDays, istToday } from '@/design/dc/dates'
import { useApprovers } from '../api/shared/useApprovers'
import { useMyLeaves } from '../api/useLeave'
import { useHolidays, useWeekendDays } from '../api/useSettings'
import { useApplyWfhBatch, useCancelWfh, useMyWfhRequests, type WfhApprovalStatus, type WfhRequestResponse } from '../api/useWfh'
import { useMeEmployee } from '../ess/home/homeApi'
import { dayRangeLong, leaveDays, monthOf, sentWhen, weeklyOffSet, wfhDaysInMonth } from '../ess/home/homeModel'
import { blockOf, chipDay, nextWorkingDay, pickLine, spanDays, wfhDayMap, withLine, workingDays } from './wfhModel'
import './wfh.css'

const STATUS: Record<WfhApprovalStatus, [string, StatusTone]> = {
  PENDING: ['Waiting', 'warning'], PENDING_L2: ['Waiting for HR', 'warning'], APPROVED: ['Approved', 'success'], REJECTED: ['Rejected', 'danger'], CANCELLED: ['Cancelled', 'muted'],
}
const PAGE = 10
const MAX_DAYS = 31
const REASON_MIN = 10
const REASON_MAX = 500

export function ApplyWfh() {
  const toast = useToast()
  const today = istToday()
  const me = useMeEmployee()
  const companyId = me.data?.companyId ?? ''
  const weekend = useWeekendDays(companyId || undefined)
  const year = Number(today.slice(0, 4))
  const holidays = useHolidays(companyId, year)
  const holidaysNext = useHolidays(companyId, year + 1)
  const leaves = useMyLeaves(0)
  const mine = useMyWfhRequests(0, 100)
  const approver = useApprovers('wfh')
  const send = useApplyWfhBatch()
  const cancel = useCancelWfh()

  const [start, setStart] = useState(today)
  const [history, setHistory] = useState<string[]>([])
  const [picked, setPicked] = useState<string[]>([])
  const [reason, setReason] = useState('')
  const [tried, setTried] = useState(false)
  const [asking, setAsking] = useState<WfhRequestResponse | null>(null)

  const off = useMemo(() => weeklyOffSet(me.data?.weeklyOffDays, weekend.data?.weekendDays), [me.data?.weeklyOffDays, weekend.data?.weekendDays])
  const list = useMemo(() => mine.data?.content ?? [], [mine.data])
  const ctx = useMemo(() => ({
    holidays: new Map([...(holidays.data ?? []), ...(holidaysNext.data ?? [])].filter((h) => h.active !== false).map((h) => [h.holidayDate, h.holidayName] as const)),
    leave: leaveDays(leaves.data?.content ?? []),
    wfh: wfhDayMap(list),
  }), [holidays.data, holidaysNext.data, leaves.data, list])
  const days = useMemo(() => workingDays(start, PAGE, off), [start, off])
  const lastDay = addDays(today, 365)
  const usedThisMonth = useMemo(() => wfhDaysInMonth(list, monthOf(today), off).length, [list, today, off])
  const who = approver.data?.approver?.name ?? null
  const noApprover = !approver.notAvailable && !!approver.data && !approver.data.approver

  const r = reason.trim()
  const reasonProblem = r.length < REASON_MIN ? `Say why in at least ${REASON_MIN} characters (${r.length}/${REASON_MIN}).`
    : reason.length > REASON_MAX ? `Keep the reason to ${REASON_MAX} characters.` : null

  function toggle(day: string) {
    setPicked((p) => (p.includes(day) ? p.filter((d) => d !== day) : p.length >= MAX_DAYS ? p : [...p, day].sort()))
  }
  function next() { setHistory((h) => [...h, start]); setStart(nextWorkingDay(days[days.length - 1] ?? start, off)) }
  function prev() {
    const back = history[history.length - 1]
    if (!back) return
    setHistory(history.slice(0, -1))
    setStart(back)
  }

  async function submit() {
    setTried(true)
    if (!picked.length || reasonProblem) return
    try {
      await send.mutateAsync({ dates: picked, reason: r })
      toast.success(`Sent${who ? ` to ${who}` : ''}: ${pickLine(picked).replace(/^\d+ days?: /, '')}`)
      setPicked([]); setReason(''); setTried(false)
    } catch (e) {
      toast.error(errorText(e, 'Couldn’t send the request. Try again.'))
    }
  }

  async function doCancel() {
    if (!asking) return
    try {
      await cancel.mutateAsync(asking.id)
      toast.success('Request cancelled')
      setAsking(null)
    } catch (e) {
      toast.error(errorText(e, 'Couldn’t cancel the request.'))
    }
  }

  const sub = noApprover
    ? 'Pick the days you want to work from home. No one can approve them yet: ask HR to set your manager.'
    : who ? `Pick the days you want to work from home. ${who} approves them.` : 'Pick the days you want to work from home.'
  const lastShown = days[days.length - 1]

  return (
    <PageFrame width="narrow" label="Work from home">
      <PageHeader title="Work from home" sub={sub} />
      <div className="uw-cols">
        <Section variant="panel" title="New request" sub={mine.data ? `${usedThisMonth} ${usedThisMonth === 1 ? 'day' : 'days'} from home this month` : undefined}>
          <div className="uw-form">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div className="uw-pager">
                <span className="uw-label" id="uw-pick">Pick days</span>
                <span style={{ display: 'inline-flex', gap: 6 }}>
                  <Button size={30} variant="ghost" icon="chevronLeft" aria-label="Earlier days" disabled={!history.length} onClick={prev} />
                  <Button size={30} variant="ghost" icon="chevronRight" aria-label="Later days" disabled={!lastShown || nextWorkingDay(lastShown, off) > lastDay} onClick={next} />
                </span>
              </div>
              <div className="uw-days" role="group" aria-labelledby="uw-pick">
                {days.map((d) => {
                  const c = chipDay(d)
                  const why = blockOf(d, ctx)
                  const on = picked.includes(d)
                  return (
                    <button key={d} type="button" className="uw-day" aria-pressed={on} disabled={!!why || (!on && picked.length >= MAX_DAYS)}
                      title={why === 'Holiday' ? ctx.holidays.get(d) : undefined} aria-label={`${c.dow} ${c.date}${why ? `, ${why.toLowerCase()}` : ''}`} onClick={() => toggle(d)}>
                      <span className="uw-day__dow">{c.dow}</span>
                      <span className="uw-day__date">{c.date}</span>
                      {why && <span className="uw-day__why">{why}</span>}
                    </button>
                  )
                })}
              </div>
            </div>
            <Textarea label="Reason" required rows={2} maxLength={REASON_MAX} value={reason} placeholder="For example: a delivery, or a focus day"
              hint={`${r.length}/${REASON_MAX}`} error={tried && reasonProblem ? reasonProblem : undefined}
              onChange={(e) => setReason(e.target.value)} />
            <div className="uw-foot">
              <span className="uw-foot__line" aria-live="polite">{tried && !picked.length ? 'Pick at least one day.' : pickLine(picked)}</span>
              <Button variant="primary" size={40} icon="home" loading={send.isPending} disabled={noApprover} onClick={() => void submit()}>Send request</Button>
            </div>
            <Callout tone="info">On an approved day you can check in from anywhere: the office geofence doesn’t apply, and the day is marked as work from home.</Callout>
          </div>
        </Section>

        <Section variant="panel" title="Your requests" body="list" loading={mine.isLoading} error={mine.error} onRetry={() => mine.refetch()}
          empty={!list.length ? { title: 'No work-from-home requests yet', hint: 'Requests you send show here with their status.', icon: 'home' } : undefined}>
          <ListRows label="Your work-from-home requests">
            {list.slice(0, 20).map((w) => {
              const [label, tone] = STATUS[w.status] ?? [w.status, 'muted' as StatusTone]
              const n = spanDays(w.fromDate, w.toDate)
              const line = [withLine(w), w.reason ? `“${w.reason}”` : '', w.decisionNote ? `Note: “${w.decisionNote}”` : '', `Sent ${sentWhen(w.createdAt, today)}`].filter(Boolean).join(' · ')
              const canCancel = w.status === 'PENDING' || w.status === 'PENDING_L2'
              return (
                <ListRow key={w.id} variant="divided" density="default" title={`${dayRangeLong(w.fromDate, w.toDate)} · ${n} ${n === 1 ? 'day' : 'days'}`} sub={line}
                  end={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <StatusPill tone={tone} size="sm">{label}</StatusPill>
                    {canCancel && <Button size={30} variant="ghost" onClick={() => setAsking(w)}>Cancel</Button>}
                  </span>} />
              )
            })}
          </ListRows>
        </Section>
      </div>

      <Dialog open={!!asking} onClose={() => setAsking(null)} busy={cancel.isPending} tone="danger" icon="home" closeLabel="Close panel"
        title="Cancel this request?" sub={asking ? `Work from home, ${dayRangeLong(asking.fromDate, asking.toDate)}.` : undefined}
        footer={<>
          <PanelButton variant="secondary" onClick={() => setAsking(null)}>Keep it</PanelButton>
          <PanelButton variant="danger" busy={cancel.isPending} onClick={() => void doCancel()}>Cancel request</PanelButton>
        </>} />
    </PageFrame>
  )
}
