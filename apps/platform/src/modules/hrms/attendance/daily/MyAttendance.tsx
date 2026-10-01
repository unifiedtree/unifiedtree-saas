// My Attendance = EmpTime "This month": your day (check in and out from the web with a face scan,
// breaks, undo a check-out), the month's numbers, a month calendar with each day's punches, and the
// day you tap with its details and "Fix this day".
//   GET /v1/attendance/my-day (BW-25)           GET /v1/attendance/history?year&month (BW-15 details)
//   GET /v1/attendance/monthly-stats?year&month  GET /v1/payroll/payslips/me/schedule (BW-55)
// Breaks only pause the "Your day" timer: worked hours and pay never change because of them.
import { useMemo, useState } from 'react'
import { usePermission } from '@unifiedtree/sdk'
import { useNavigate } from 'react-router-dom'
import {
  Button, Callout, MonthCalendar, PageHeader, Section, StatCard, StatGrid, StatusPill,
  type CalendarDay, type CalendarTone,
} from '@/design/kit/display'
import { useToast } from '@/design/kit/overlays'
import { Timeline, type TimelineItem } from '@/design/kit/data'
import { MONTHS, fmtLong, istToday } from '@/design/dc/dates'
import { useAttendanceHistory, useMonthlyStats, type DayRecordResponse } from '../../api/useAttendance'
import { usePaySchedule } from '../../api/shared/usePaySchedule'
import { WebPunchDialog } from '../webpunch/WebPunchDialog'
import { useBreak, useMyDay, useUndoCheckOut } from '../webpunch/useMyDay'
import { FixDayPanel, type FixDayPrefill } from './FixDayPanel'
import { hhmmIst, hm, methodLabel, statusMeta } from './dailyModel'
import type { DailyPerms } from './DailyTracking'

/** One day of /attendance/history on the calendar: its colour and short line. */
export function dayCell(d: DayRecordResponse, today: string): CalendarDay {
  const inT = d.checkInTime ? hhmmIst(d.checkInTime) : null, outT = d.checkOutTime ? hhmmIst(d.checkOutTime) : null
  const home = d.attendanceType === 'WFH'
  const noOut = !!inT && !outT && d.date < today
  let tone: CalendarTone = 'none', label = ''
  switch (d.status) {
    case 'HOLIDAY': tone = 'holiday'; label = 'Holiday'; break
    case 'WEEKEND': case 'WEEKLY_OFF': tone = 'off'; label = 'Off'; break
    case 'ON_LEAVE': tone = 'leave'; label = 'Leave'; break
    case 'ABSENT': tone = 'absent'; label = d.date === today ? '' : 'No punch'; break
    case 'HALF_DAY': tone = 'half'; label = inT ? `Half day · ${inT}` : 'Half day'; break
    case 'LATE': tone = noOut ? 'fix' : 'late'; label = noOut ? 'No punch-out' : `Late · ${inT ?? ''}`.trim(); break
    default:
      if (inT) { tone = noOut ? 'fix' : home ? 'home' : 'present'; label = noOut ? 'No punch-out' : home ? `Home · ${inT}` : outT ? `${inT} – ${outT}` : `In · ${inT}` }
  }
  const tip = [statusMeta(d.status === 'WEEKEND' ? 'WEEKLY_OFF' : d.status).label, inT ? `in ${inT}` : null, outT ? `out ${outT}` : null, methodLabel(d.checkInMethod) || null].filter(Boolean).join(' · ')
  return { date: d.date, tone, label, tip }
}

const ymOf = (iso: string) => iso.slice(0, 7)
const monthShift = (ym: string, delta: number) => { const d = new Date(`${ym}-01T00:00:00`); d.setMonth(d.getMonth() + delta); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }

export function MyAttendance({ perms }: { perms: DailyPerms }) {
  const navigate = useNavigate()
  const toast = useToast()
  const today = istToday()
  const canWfh = usePermission('wfh.request.self')
  const [ym, setYm] = useState(ymOf(today))
  const [picked, setPicked] = useState<string>(today)
  const [punch, setPunch] = useState<'in' | 'out' | null>(null)
  const [fix, setFix] = useState<FixDayPrefill | null>(null)
  const y = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7))
  const history = useAttendanceHistory(y, m, { enabled: perms.self })
  const stats = useMonthlyStats(y, m, { enabled: perms.self })
  const myDay = useMyDay({ enabled: perms.self })
  const pay = usePaySchedule({ enabled: perms.self })
  const breakM = useBreak()
  const undo = useUndoCheckOut()

  const days = useMemo(() => history.data ?? [], [history.data])
  const byDate = useMemo(() => new Map(days.map((d) => [d.date, d])), [days])
  const cells = useMemo(() => days.map((d) => dayCell(d, today)), [days, today])
  const worked = days.filter((d) => d.workHours != null && d.workHours > 0)
  const avg = worked.length ? Math.round((worked.reduce((s, d) => s + (d.workHours || 0), 0) / worked.length) * 60) : null
  const lates = days.filter((d) => d.status === 'LATE')
  const toFix = cells.filter((c) => c.tone === 'fix')
  const home = days.filter((d) => d.attendanceType === 'WFH' && d.checkInTime).length
  const working = days.filter((d) => d.status !== 'HOLIDAY' && d.status !== 'WEEKEND' && d.status !== 'WEEKLY_OFF' && d.date <= today).length
  const s = stats.data

  // ── your day ──
  const md = myDay.data
  const dayLine = (() => {
    if (!md) return ''
    if (md.checkedOut) return `You’re checked out. You worked ${hm(md.activeMinutes)}${md.breakMinutes ? ` plus ${md.breakMinutes} min of breaks` : ''}.`
    if (md.onBreak) return `You’re on a break since ${hhmmIst(md.breakStartedAt)}.`
    if (md.checkedIn) return `You’re in.${md.shift?.end ? ` Shift ends at ${md.shift.end}.` : ''}`
    if (md.status === 'ON_LEAVE') return 'You’re on leave today.'
    if (md.status === 'HOLIDAY') return 'It’s a holiday today.'
    if (md.status === 'WEEKLY_OFF') return 'It’s your weekly off today.'
    return md.shift?.start ? `You haven’t checked in. Your shift starts at ${md.shift.start}.` : 'You haven’t checked in yet.'
  })()
  const doBreak = (action: 'start' | 'end') => breakM.mutateAsync(action)
    .then(() => toast.success(action === 'start' ? 'Break started. Your day timer is paused.' : 'Welcome back. Your day timer is running again.'))
    .catch((e) => toast.error(action === 'start' ? 'Couldn’t start the break' : 'Couldn’t end the break', { detail: (e as Error)?.message }))
  const doUndo = () => undo.mutateAsync()
    .then(() => toast.success('Check-out taken back. You’re checked in again.'))
    .catch((e) => toast.error('Couldn’t take the check-out back', { detail: (e as Error)?.message }))

  // ── the picked day ──
  const pd = byDate.get(picked)
  const isToday = picked === today
  const timeline: TimelineItem[] = []
  if (pd?.checkInTime) timeline.push({ key: 'in', time: hhmmIst(pd.checkInTime), label: 'Checked in', sub: [methodLabel(pd.checkInMethod), pd.locationName].filter(Boolean).join(' · ') || undefined, state: 'done' })
  if (isToday && md?.breaks?.length) for (const [i, b] of md.breaks.entries()) timeline.push({ key: `b${i}`, time: hhmmIst(b.startedAt), label: b.endedAt ? `Break until ${hhmmIst(b.endedAt)}` : 'On a break', state: b.endedAt ? 'done' : 'current' })
  if (pd?.checkOutTime) timeline.push({ key: 'out', time: hhmmIst(pd.checkOutTime), label: 'Checked out', sub: [methodLabel(pd.checkOutMethod), pd.workHours ? `${hm(Math.round(pd.workHours * 60))} worked` : null].filter(Boolean).join(' · ') || undefined, state: 'done' })
  else if (pd?.checkInTime && isToday && md?.checkedIn) timeline.push({ key: 'now', time: 'Now', label: md.onBreak ? 'On a break' : 'Still working', sub: md.activeMinutes != null ? `${hm(md.activeMinutes)} so far` : undefined, state: 'current' })
  else if (pd?.checkInTime && !isToday) timeline.push({ key: 'miss', time: '—', label: 'No check-out recorded', sub: 'Ask for a fix to add it', state: 'failed', stateLabel: 'missed' })
  const pdMeta = pd ? statusMeta(pd.status === 'WEEKEND' ? 'WEEKLY_OFF' : pd.status) : null
  const fixPrefill = (d?: DayRecordResponse): FixDayPrefill => ({
    date: picked, in: d?.checkInTime ? hhmmIst(d.checkInTime) : undefined, out: d?.checkOutTime ? hhmmIst(d.checkOutTime) : undefined,
  })

  const legend = [{ tone: 'present', label: 'On time' }, { tone: 'late', label: 'Late or leave' }, { tone: 'home', label: 'Home' }, { tone: 'fix', label: 'To fix' }] as const
  const payLine = pay.data?.nextPayDate ? `Payroll is processed on ${fmtLong(pay.data.nextPayDate)}. Fix any day before then.` : null

  return (
    <>
      <PageHeader title="Attendance" sub="Your days this month, straight from your punches. Tap a day to see it or fix it."
        actions={<>
          {canWfh && <Button onClick={() => navigate('/me/wfh')}>Work from home</Button>}
          <Button variant="primary" onClick={() => setFix({ date: today })}>Fix a day</Button>
        </>} />

      {!myDay.notAvailable && (
        <Section title="Your day" sub={md ? fmtLong(md.date) : undefined} variant="section" loading={myDay.isLoading}
          error={myDay.isError ? myDay.error : undefined} onRetry={() => void myDay.refetch()}>
          {md && (
            <div className="udt-myday">
              <div className="udt-myday__txt">
                <p className="udt-myday__line">{dayLine}</p>
                <div className="udt-myday__facts">
                  {md.shift && <span>{md.shift.name}{md.shift.start ? ` · ${md.shift.start}–${md.shift.end ?? ''}` : ''}</span>}
                  {md.checkedIn && <span>Worked <b className="udt-num">{hm(md.activeMinutes)}</b></span>}
                  {md.breakMinutes > 0 && <span>Breaks <b className="udt-num">{md.breakMinutes} min</b></span>}
                  {md.status && <StatusPill tone={statusMeta(md.status).tone} dot size="xs">{statusMeta(md.status).label}</StatusPill>}
                </div>
                {!md.webPunchAllowed && <Callout tone="neutral">Web check-in is turned off for your company. Check in and out from the mobile app.</Callout>}
              </div>
              {md.webPunchAllowed && (
                <div className="udt-myday__acts">
                  {!md.checkedIn && md.status !== 'ON_LEAVE' && <Button variant="primary" size={44} icon="scanFace" onClick={() => setPunch('in')}>Check in</Button>}
                  {md.checkedIn && !md.checkedOut && !md.onBreak && <Button size={44} icon="coffee" loading={breakM.isPending} onClick={() => void doBreak('start')}>Take a break</Button>}
                  {md.checkedIn && !md.checkedOut && md.onBreak && <Button size={44} variant="soft" icon="coffee" loading={breakM.isPending} onClick={() => void doBreak('end')}>End break</Button>}
                  {md.checkedIn && !md.checkedOut && <Button variant="primary" size={44} icon="scanFace" onClick={() => setPunch('out')} disabled={md.onBreak} title={md.onBreak ? 'End your break first' : undefined}>Check out</Button>}
                  {md.checkedOut && md.canUndoCheckOut && (
                    <Button size={44} variant="secondary" loading={undo.isPending} onClick={() => void doUndo()}>
                      {`Undo check-out${md.undoCheckOutUntil ? ` (until ${hhmmIst(md.undoCheckOutUntil)})` : ''}`}
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}
        </Section>
      )}

      <StatGrid min={170} label="This month at a glance">
        <StatCard variant="stat" label="Present" icon="userCheck" tone="brand" loading={stats.isLoading} value={s ? s.presentDays : null} note={`of ${working} working ${working === 1 ? 'day' : 'days'}`} />
        <StatCard variant="stat" label="Late" icon="clock" tone="gold" loading={history.isLoading} value={history.data ? lates.length : null}
          note={lates.length ? lates.slice(0, 3).map((d) => Number(d.date.slice(8, 10))).join(', ') + (lates.length > 3 ? '…' : '') : 'None this month'} />
        <StatCard variant="stat" label="Work from home" icon="home" tone="brand" loading={history.isLoading} value={history.data ? home : null} note="days this month" />
        <StatCard variant="stat" label="On leave" icon="calendarDays" tone="gray" loading={stats.isLoading} value={s ? s.leaveDays ?? null : null} note="days so far" />
        <StatCard variant="stat" label="Average day" icon="timer" tone="brand" loading={history.isLoading} value={avg != null ? hm(avg) : '—'}
          note={md?.shift?.workingHours ? `target ${hm(Math.round(md.shift.workingHours * 60))}` : 'from check-in to check-out'} />
        <StatCard variant="stat" label="To fix" icon="alert" tone={toFix.length ? 'red' : 'gray'} loading={history.isLoading} value={history.data ? toFix.length : null}
          note={toFix.length ? 'missed punch-out' : 'Nothing to fix'} onClick={toFix.length ? () => setPicked(toFix[0].date) : undefined} />
      </StatGrid>

      <div className="udt-split udt-split--cal">
        <Section title={`${MONTHS[m - 1]} ${y}`} variant="section" body="tight" className="udt-main"
          actions={<span className="udt-monthnav">
            <Button size={32} icon="chevronLeft" aria-label="Previous month" onClick={() => setYm(monthShift(ym, -1))} />
            <Button size={32} icon="chevronRight" aria-label="Next month" disabled={ym >= ymOf(today)} onClick={() => setYm(monthShift(ym, 1))} />
          </span>}
          loading={history.isLoading} skeleton="chart" error={history.isError ? history.error : undefined} onRetry={() => void history.refetch()}>
          <MonthCalendar month={ym} days={cells} variant="detail" today={today} selected={picked} onSelect={setPicked}
            onMonthChange={(d) => { if (d < 0 || ym < ymOf(today)) setYm(monthShift(ym, d)) }}
            legend={legend as never} label={`${MONTHS[m - 1]} ${y} attendance`} />
        </Section>
        <Section title={fmtLong(picked).split(', ')[1] || picked} sub={fmtLong(picked).split(', ')[0]} variant="section" className="udt-side">
          <div className="udt-dayinfo">
            {pdMeta && <StatusPill tone={pdMeta.tone} dot>{pdMeta.label}{pd?.attendanceType === 'WFH' ? ' · from home' : ''}</StatusPill>}
            {!pd && <p className="udt-q">{picked > today ? 'This day hasn’t happened yet.' : 'Nothing recorded for this day.'}</p>}
            {timeline.length > 0 && <Timeline variant="rail" label="The day’s punches" items={timeline} />}
            {pd?.lateMinutes ? <p className="udt-q">{`Came in ${pd.lateMinutes} min after the start time.`}</p> : null}
            {pd?.regularized && <p className="udt-q">These times were fixed (an approved request or an entry by HR).</p>}
            {pd?.note && <p className="udt-q">{pd.note}</p>}
            {picked <= today && pd?.status !== 'HOLIDAY' && pd?.status !== 'WEEKEND' && (
              <div className="udt-dayinfo__acts">
                {pd?.status === 'LATE' && <Button size={36} onClick={() => setFix({ ...fixPrefill(pd), reason: 'Late arrival: ' })}>Explain the late mark</Button>}
                <Button size={36} variant="soft" onClick={() => setFix(fixPrefill(pd))}>Fix this day</Button>
              </div>
            )}
            {payLine && <Callout tone="neutral" icon="calendar">{payLine}</Callout>}
          </div>
        </Section>
      </div>

      <WebPunchDialog open={!!punch} mode={punch ?? 'in'} onClose={() => setPunch(null)} onDone={() => { void history.refetch(); void stats.refetch() }} />
      <FixDayPanel open={!!fix} prefill={fix ?? undefined} onClose={() => setFix(null)} />
    </>
  )
}
