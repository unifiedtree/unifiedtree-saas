// The self-service Home's cards (EmpHome.dc.html): Your day, Needs you, My
// requests, the month calendar, Leave, Pay, Upcoming events and Shortcuts.
// They only lay out what HomePage gives them; every value is real API data.
import type { ReactNode } from 'react'
import {
  Button, Callout, CalendarLegend, DateTile, IconTile, ListRow, ListRows, Meter, MonthCalendar, ProgressBar, Section, StatusPill,
  type CalendarDay,
} from '@/design/kit/display'
import { AmountMask, AmountToggle } from '@/design/kit/data'
import { dashIcon } from '@/design/dc/icons'
import { MON, dt } from '@/design/dc/dates'
import type { LeaveBalanceResponse } from '../../api/useLeave'
import type { AroundItem, MyDay, MyRequest, NeedsYouItem } from './homeApi'
import {
  balanceOf, dayLine, dueChip, eventSub, hm, needsLook, num, requestPill, requestSub, requestTitle, type LongWeekendTip,
} from './homeModel'
import './home.css'

// ── Your day ────────────────────────────────────────────────────────────────

export interface YourDayProps {
  day: MyDay
  /** Worked minutes net of breaks, running on (homeModel.liveActiveMinutes). */
  active: number | null
  /** The shift's working minutes, for "/ 9h 00m" and the bar. */
  target: number | null
  now: Date
  /** Breaks need the company's web check-in (my-day's webPunchAllowed). */
  onBreak?: () => void
  breakBusy?: boolean
}

export function YourDay({ day, active, target, now, onBreak, breakBusy }: YourDayProps) {
  const line = dayLine(day, now)
  const showTime = day.checkedIn && active != null
  const pct = showTime && target ? Math.min(100, Math.round((active / target) * 100)) : null
  const canBreak = !!onBreak && day.webPunchAllowed && day.checkedIn && !day.checkedOut
  return (
    <div role="status" aria-label="Your day" className="uh-day" data-rise="">
      <span className="uh-day__icon" aria-hidden="true">{dashIcon(day.onBreak ? 'coffee' : 'clock', 17)}</span>
      <span className="uh-day__tag">YOUR DAY</span>
      {showTime && (
        <span className="uh-day__time">{hm(active)}{target ? <span className="uh-day__of"> / {hm(target)}</span> : null}</span>
      )}
      {pct != null && <span className="uh-day__bar" role="img" aria-label={`${pct}% of your shift`}><span style={{ width: `${pct}%` }} /></span>}
      <span className="uh-day__text"><b>{line.lead}</b>{line.rest ? ` ${line.rest}` : ''}</span>
      {canBreak && (
        <button type="button" className="uh-day__btn" onClick={onBreak} disabled={breakBusy} aria-busy={breakBusy || undefined}>
          {dashIcon(day.onBreak ? 'clock' : 'coffee', 14)}{day.onBreak ? 'End break' : 'Take a break'}
        </button>
      )}
    </div>
  )
}

// ── Needs you ───────────────────────────────────────────────────────────────

export function NeedsYouCard({ items, count, loading, error, onRetry, today, onOpen }: {
  items: readonly NeedsYouItem[]; count: number; loading: boolean; error: unknown; onRetry: () => void; today: string; onOpen: (path: string) => void
}) {
  return (
    <Section variant="panel" title="Needs you" count={!loading && !error && count > 0 ? count : null} countTone="gold"
      countLabel={`${count} ${count === 1 ? 'thing needs' : 'things need'} you`} body="list" loading={loading} error={error} onRetry={onRetry}
      empty={!items.length ? { title: 'Nothing needs you right now', hint: 'Things only you can do show up here.', icon: 'checkCircle' } : undefined}>
      <ListRows bleed label="Things that need you">
        {items.map((n, i) => {
          const look = needsLook(n)
          const due = dueChip(n.dueDate, today)
          return (
            <ListRow key={`${n.kind}-${n.refId ?? i}`} density="comfy" chevron onClick={() => onOpen(n.link)}
              leading={<IconTile icon={look.icon} tone={look.tone} />}
              title={n.title} sub={n.detail ?? undefined}
              end={due ? <StatusPill tone={due === 'Overdue' ? 'danger' : 'warning'} size="xs">{due}</StatusPill> : undefined} />
          )
        })}
      </ListRows>
    </Section>
  )
}

// ── My requests ─────────────────────────────────────────────────────────────

const PILL_TONE = { wait: 'warning', ok: 'success', bad: 'danger', gray: 'neutral' } as const
const BAR_TONE = { wait: 'warning', ok: 'success', bad: 'danger', gray: 'muted' } as const

export function MyRequestsCard({ requests, loading, error, onRetry, today, onOpen }: {
  requests: readonly MyRequest[]; loading: boolean; error: unknown; onRetry: () => void; today: string; onOpen: (path: string) => void
}) {
  return (
    <Section variant="panel" title="My requests" body="list" loading={loading} error={error} onRetry={onRetry}
      empty={!requests.length ? { title: 'No requests yet', hint: 'Leave, work from home, fixes and claims you send show here with their progress.', icon: 'inbox' } : undefined}>
      {requests.map((r) => {
        const pill = requestPill(r)
        return (
          <button key={`${r.kind}-${r.id}`} type="button" className="uh-req" onClick={() => onOpen(r.link)}>
            <span className="uh-req__top">
              <span style={{ minWidth: 0 }}>
                <span className="uh-req__title">{requestTitle(r)}</span>
                <span className="uh-req__sub">{requestSub(r, today)}</span>
              </span>
              <StatusPill tone={PILL_TONE[pill]} size="sm">{r.statusLabel}</StatusPill>
            </span>
            <ProgressBar value={r.progress} height={4} tone={BAR_TONE[pill]} valueText={`${r.progress}% done`} />
          </button>
        )
      })}
    </Section>
  )
}

// ── The month calendar ──────────────────────────────────────────────────────

const LEGEND = [
  { tone: 'present', label: 'Present' }, { tone: 'late', label: 'Late' }, { tone: 'home', label: 'Home' },
  { tone: 'holiday', label: 'Holiday' }, { tone: 'leave', label: 'Leave' }, { tone: 'sick', label: 'Sick leave' }, { tone: 'fix', label: 'To fix' },
] as const

export function CalendarCard({ month, monthWord, days, sub, loading, error, onRetry, onOpen }: {
  month: string; monthWord: string; days: readonly CalendarDay[]; sub: string; loading: boolean; error: unknown; onRetry: () => void; onOpen: () => void
}) {
  return (
    <Section variant="panel" title={`${monthWord} attendance`} sub={sub || undefined} body="default" loading={loading} error={error} onRetry={onRetry}
      skeleton="chart" action={{ label: 'Open', onClick: onOpen, ariaLabel: 'Open my attendance' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <MonthCalendar month={month} days={days} variant="compact" label={`${monthWord} attendance`} />
        <CalendarLegend items={[...LEGEND]} />
      </div>
    </Section>
  )
}

// ── Leave ───────────────────────────────────────────────────────────────────

export function LeaveCard({ balances, loading, error, onRetry, onApply, tip }: {
  balances: readonly LeaveBalanceResponse[]; loading: boolean; error: unknown; onRetry: () => void; onApply?: () => void; tip: LongWeekendTip | null
}) {
  const shown = balances.slice(0, 3)
  return (
    <Section variant="panel" title="Leave" body="default" loading={loading} error={error} onRetry={onRetry} skeleton="text"
      action={onApply ? { label: 'Apply', onClick: onApply, ariaLabel: 'Apply for leave' } : undefined}
      empty={!balances.length ? { title: 'No leave balances yet', hint: 'Ask HR to add your leave types.', icon: 'calendar' } : undefined}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {shown.map((b, i) => (
          <Meter key={b.id} index={i} label={b.leaveTypeName} value={b.available} max={balanceOf(b)} tone="leave"
            display={<><b style={{ fontWeight: 500 }}>{num(b.available)}</b> <span style={{ color: 'var(--u-ink3, #6A7A73)' }}>/ {num(balanceOf(b))}</span></>}
            valueText={`${b.leaveTypeName}: ${num(b.available)} of ${num(balanceOf(b))} days left`} />
        ))}
        {tip && (
          <Callout tone="holiday" icon={null}>
            <b style={{ fontWeight: 500 }}>{wordDay(tip.holiday)} is a holiday.</b> Take {wordDay(tip.take)} for a {tip.days}-day weekend.
          </Callout>
        )}
      </div>
    </Section>
  )
}

const WDS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
/** "Fri 2 Oct". */
const wordDay = (iso: string) => { const d = dt(iso); return `${WDS[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}` }

// ── Pay ─────────────────────────────────────────────────────────────────────

export function PayCard({ periodLabel, net, hidden, onToggle, payday, loading, error, onRetry, onAll }: {
  /** "August". */
  periodLabel: string | null; net: string | null; hidden: boolean; onToggle: (hidden: boolean) => void
  /** "Next payday Wed, 30 Sep · in 5 days", or null when there's no pay date yet. */
  payday: ReactNode | null
  loading: boolean; error: unknown; onRetry: () => void; onAll: () => void
}) {
  return (
    <Section variant="panel" title="Pay" body="default" loading={loading} error={error} onRetry={onRetry} skeleton="text"
      actions={net ? <AmountToggle hidden={hidden} onToggle={onToggle} size="sm" controls="uh-pay-net" /> : undefined}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {net && periodLabel ? (
          <div id="uh-pay-net">
            <div className="uh-pay__label">{periodLabel} take-home</div>
            <div className="uh-pay__net"><AmountMask value={net} hidden={hidden} label={`${periodLabel} take-home`} /></div>
          </div>
        ) : (
          <div className="uh-pay__label">No payslip yet.</div>
        )}
        {payday && <Callout tone="info" icon="calendar">{payday}</Callout>}
        <div><Button size={32} onClick={onAll}>All payslips</Button></div>
      </div>
    </Section>
  )
}

// ── Upcoming events ─────────────────────────────────────────────────────────

const LONG_MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export function UpcomingEventsCard({ items, loading, error, onRetry, today, onOpen }: {
  items: readonly AroundItem[]; loading: boolean; error: unknown; onRetry: () => void; today: string; onOpen: (path: string) => void
}) {
  return (
    <Section variant="panel" title="Upcoming events" body="list" loading={loading} error={error} onRetry={onRetry}
      empty={!items.length ? { title: 'Nothing coming up', hint: 'Holidays, notices, birthdays, anniversaries and retirements show here.', icon: 'calendar' } : undefined}>
      <ListRows label="Upcoming events">
        {items.map((a, i) => {
          const d = dt(a.date)
          return (
            <ListRow key={`${a.kind}-${a.refId ?? i}-${a.date}`} variant="divided" density="default"
              leading={<DateTile day={String(d.getDate()).padStart(2, '0')} month={MON[d.getMonth()].toUpperCase()} label={`${d.getDate()} ${LONG_MON[d.getMonth()]}`} />}
              title={a.title} sub={eventSub(a, today)} onClick={a.link ? () => onOpen(a.link!) : undefined} />
          )
        })}
      </ListRows>
    </Section>
  )
}

// ── Shortcuts (today's /me entry points that stay reachable) ───────────────

export interface Shortcut { key: string; title: string; sub: string; icon: string; path: string }

export function ShortcutsCard({ items, onOpen }: { items: readonly Shortcut[]; onOpen: (path: string) => void }) {
  if (!items.length) return null
  return (
    <Section variant="panel" title="Shortcuts" sub="Your pay, papers and profile" body="list">
      <ListRows bleed className="uh-shortcuts" label="Shortcuts">
        {items.map((s) => (
          <ListRow key={s.key} density="default" chevron onClick={() => onOpen(s.path)} ariaLabel={`${s.title}: ${s.sub}`}
            leading={<IconTile icon={s.icon} tone="brand" size={34} />} title={s.title} sub={s.sub} />
        ))}
      </ListRows>
    </Section>
  )
}
