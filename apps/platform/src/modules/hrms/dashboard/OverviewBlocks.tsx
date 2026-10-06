// Overview pieces of the admin dashboard (PgDashboard "overview"): the date chip and its start / end
// picker, the past-date and period banners, the seats strip, and "Today’s attendance".
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Avatar, Button, EmptyState, Section, SegmentedControl, StatusPill, type StatusTone } from '@/design/kit/display'
import { dashIcon } from '@/design/dc/icons'
import { DateRangeBody } from '@/design/kit/DateRangePicker'
import { spanDays, type ViewPreset, type WorkCalendar } from '@/design/kit/dateRangeModel'
import { fmtLong, fmtShort, fmtWd, dt, MON } from '@/design/dc/dates'
import { offWeekdays, type DayBuckets } from '../attendance/attendanceBuckets'
import type { StaffStatusResponse } from '../api/useAttendance'
import { attRows, pctOf, type AttFilter, type PillTone } from './dashboardModel'
import { MAX_RANGE_DAYS, chipRangeLabel, dashboardPresets, dayCount, periodLabel } from './dashboardRange'

// ── Date chip + the dashboard's start / end picker ──────────────────────────
// Owner decision (6 Oct 2026): a plain calendar where you pick a start and an end date (one click is a single
// day), the quick picks of dashboardPresets, and Apply / Cancel. No numbers inside the picker: the cards show them.
export function DateChipButton({ sel, from, today, daily, holidays, onApply }: {
  /** The day shown (a range's last day). */
  sel: string
  /** A range's first day; null for one day. */
  from: string | null
  today: string; daily: Record<string, DayBuckets>; holidays: { date: string; name: string }[]
  onApply: (picked: { from: string; to: string }) => void
}) {
  const [open, setOpen] = useState(false)
  const chipRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLSpanElement>(null)
  const isToday = !from && sel === today
  const calendar = useMemo<WorkCalendar>(() => ({
    off: new Set(offWeekdays(daily)), holidays: new Map(holidays.map((h) => [h.date, h.name])),
  }), [daily, holidays])
  const presets = useMemo(() => dashboardPresets(today), [today])
  useEffect(() => { if (open) popRef.current?.focus({ preventScroll: true }) }, [open])
  const close = () => { setOpen(false); chipRef.current?.focus({ preventScroll: true }) }
  const tag = from ? 'Period' : isToday ? 'Today' : 'Viewing'
  const text = from ? chipRangeLabel(from, sel) : fmtLong(sel)
  return (
    <span className="ud-cal-wrap">
      <button ref={chipRef} type="button" className="ud-date" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        aria-label={from ? `Viewing ${periodLabel(from, sel)} · change the dashboard dates` : isToday ? `Today, ${fmtLong(sel)} · change the dashboard date` : `Viewing ${fmtWd(sel)} · change the dashboard date`}>
        <span className="ud-date__ic" aria-hidden="true">{dashIcon('calendar', 15)}</span>
        <span className="ud-date__txt" aria-hidden="true"><span className="ud-date__tag">{tag}</span><span>{text}</span></span>
        <span className="ud-date__chev" aria-hidden="true">{dashIcon('chevronDown', 14)}</span>
      </button>
      {open && (
        <>
          <span className="ud-cal-scrim" onClick={close} aria-hidden="true" />
          <span ref={popRef} className="ud-cal-pop ud-range-pop" role="dialog" aria-modal="true" aria-label="Choose dashboard date" tabIndex={-1}
            onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close() } }}>
            <DashRangeBody sel={sel} from={from} today={today} calendar={calendar} presets={presets}
              onApply={(r) => { close(); onApply(r) }} onCancel={close} />
          </span>
        </>
      )}
    </span>
  )
}

/** The picker's content (exported for tests: it renders without a document). */
export function DashRangeBody({ sel, from, today, calendar, presets, onApply, onCancel }: {
  sel: string; from: string | null; today: string; calendar: WorkCalendar; presets: ViewPreset[]
  onApply: (picked: { from: string; to: string }) => void; onCancel: () => void
}) {
  return (
    <>
      <p className="ud-range-pop__t">Dashboard dates</p>
      <DateRangeBody from={from ?? sel} to={sel} max={today} today={today} calendar={calendar} presets={presets}
        legend={false} maxSpan={MAX_RANGE_DAYS} doneLabel="Apply" onCancel={onCancel}
        footerText={(r) => (r ? `${dayCount(spanDays(r.from, r.to))} · ${periodLabel(r.from, r.to)}` : 'Pick a start, then an end date')}
        onDone={(p) => onApply({ from: p.from, to: p.to })} />
    </>
  )
}

// ── Past-date banner (kept from today: client decision) ─────────────────────
export function PastBanner({ sel, onBack }: { sel: string; onBack: () => void }) {
  return (
    <div role="status" className="ud-past">
      <span className="ud-past__ic" aria-hidden="true">{dashIcon('calendarDays', 18)}</span>
      <span className="ud-past__txt">
        Viewing <strong>{fmtWd(sel)}</strong>. Every card shows that day as it was, except the holidays, birthdays, anniversaries and retirements in Upcoming events, which count from today. Anything marked “As of today” keeps no history, so it shows today.
      </span>
      <Button variant="secondary" size={32} onClick={onBack}>Back to today</Button>
    </div>
  )
}

// ── Period banner (a date range) ─────────────────────────────────────────────
export function RangeBanner({ from, to, today, onBack }: { from: string; to: string; today: string; onBack: () => void }) {
  const end = to === today ? 'today' : fmtWd(to)
  return (
    <div role="status" className="ud-past">
      <span className="ud-past__ic" aria-hidden="true">{dashIcon('calendarDays', 18)}</span>
      <span className="ud-past__txt">
        Viewing <strong>{periodLabel(from, to)}</strong> ({dayCount(spanDays(from, to))}). The cards at the top add up the period; Total employees is the headcount on {end}, with the period’s joiners and leavers. The rest of the page shows {end}.
      </span>
      <Button variant="secondary" size={32} onClick={onBack}>Back to today</Button>
    </div>
  )
}

export function AsOfToday({ title = 'This keeps no history, so it shows today' }: { title?: string }) {
  return <span className="ud-asof" title={title}>{dashIcon('clock', 12)}As of today</span>
}

// ── Seats (workspace.billing.manage). The strip warns at ≥ 90 % used; billing managers always see the line. ──
// soft (a server with the soft seat limit): adding over the seats is allowed and billed at the cycle's end, so a
// full workspace isn't "blocked"; overNote says how many extra users will be billed.
export function SeatsStrip({ used, total, isPast, onAdd, soft = false, overNote = null }: { used: number; total: number; isPast: boolean; onAdd: () => void; soft?: boolean; overNote?: string | null }) {
  const left = Math.max(0, total - used), pct = total ? Math.min(100, Math.round((used / total) * 100)) : 0
  const full = total > 0 && used >= total, warn = !full && total > 0 && used / total >= 0.9
  const blocked = full && !soft
  const tone = blocked ? 'full' : warn || (full && soft) ? 'warn' : 'ok'
  return (
    <div role={blocked ? 'alert' : 'status'} className={`ud-seats ud-seats--${tone} ufx-rise`}>
      <div className="ud-seats__lead">
        <span className="ud-seats__ic" aria-hidden="true">{dashIcon('armchair', 17)}</span>
        <span className="ud-seats__eyebrow">Seats used</span>
        <span className="ud-seats__n">{used}<small> / {total}</small></span>
      </div>
      <span className="ud-seats__bar" aria-hidden="true"><span style={{ width: `${pct}%` }} /></span>
      <div className="ud-seats__msg">
        {overNote
          ? <><b>{overNote}.</b> Add seats to cover them.</>
          : full && soft
          ? <><b>All {total} seats are in use.</b> You can still add employees; extra users are billed at the end of the cycle.</>
          : full
          ? <><b>All {total} seats are in use.</b> Adding employees is blocked until you add seats.</>
          : warn
            ? <><b>{left} {left === 1 ? 'seat' : 'seats'} left.</b> Add seats before the next batch of joiners.</>
            : <><b>{left} {left === 1 ? 'seat' : 'seats'} left</b> of {total}.</>}
        {isPast && <> <AsOfToday title="Seats keep no history, so this is today’s count" /></>}
      </div>
      <Button variant={blocked ? 'danger' : 'secondary'} size={32} onClick={onAdd}>{blocked ? 'Upgrade to add more employees' : 'Add seats'}</Button>
    </div>
  )
}

// ── Today's attendance ───────────────────────────────────────────────────────
const PILL: Record<PillTone, StatusTone> = { ok: 'brand', warn: 'warning', bad: 'danger', mint: 'mint', info: 'neutral', gray: 'muted' }

export function TodayAttendance({ staff, counts, sel, isToday, loading, error, onRetry, onOpen, style }: {
  staff: readonly StaffStatusResponse[]; counts: DayBuckets; sel: string; isToday: boolean
  loading: boolean; error: unknown; onRetry: () => void; onOpen: () => void; style?: CSSProperties
}) {
  const [f, setF] = useState<AttFilter>('all')
  const over = !isToday
  const rows = attRows(staff, f, over)
  const sched = Math.max(0, counts.total - (counts.other || 0))
  const d = dt(sel)
  const title = isToday ? 'Today’s attendance' : `Attendance on ${fmtWd(sel).slice(0, -5)}`
  const noneN = over ? counts.absent : counts.notMarked
  return (
    <Section variant="dashboard" level={3} title={title} body="flush" style={style}
      sub={`${counts.present} of ${sched} checked in · IST`}
      actions={<SegmentedControl<AttFilter> label="Filter check-ins" size="sm" value={f} onChange={setF}
        options={[{ value: 'all', label: 'All' }, { value: 'late', label: 'Late', count: counts.late }, { value: 'none', label: over ? 'Absent' : 'Not marked', count: noneN }]} />}
      loading={loading} error={error} onRetry={onRetry}
      footerLink={{ label: 'Open daily tracking', onClick: onOpen }}>
      {rows.length ? (
        <div role="list" aria-label={`Check-ins ${isToday ? 'today' : `on ${d.getDate()} ${MON[d.getMonth()]}`}`} className="ud-inbox-list" style={{ paddingTop: 0 }}>
          {rows.map((r) => (
            <div key={r.id} role="listitem" className="ud-att-row">
              <Avatar name={r.name} size={32} />
              <div className="ud-inbox-row__txt">
                <div className="ud-inbox-row__name">{r.name}</div>
                <div className="ud-inbox-row__sub">{r.dept}</div>
              </div>
              <span className="ud-att-row__t">{r.time}</span>
              <StatusPill tone={PILL[r.tone]} minWidth={96}>{r.status}</StatusPill>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState icon="users" minHeight={250}
          title={!staff.length ? 'No records for this period.' : f === 'late' ? 'No one is late.' : f === 'none' ? (over ? 'No one was absent.' : 'Everyone has punched in.') : 'No records for this period.'}
          hint={!staff.length ? 'Check-ins appear here as people punch in.' : ''} />
      )}
    </Section>
  )
}

export const pctNote = (n: number, whole: number) => `${pctOf(n, whole)}%`
export const shortDay = (iso: string) => fmtShort(iso).slice(0, -5)
