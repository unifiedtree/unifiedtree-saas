// Overview pieces of the admin dashboard (PgDashboard "overview"): the date chip on the shared dashboard
// calendar, the past-date banner, the seats strip, and "Today’s attendance".
import { useState, type CSSProperties } from 'react'
import { Avatar, Button, EmptyState, Section, SegmentedControl, StatusPill, type StatusTone } from '@/design/kit/display'
import { dashIcon } from '@/design/dc/icons'
import { DashCalendar } from '@/design/dc/DashCalendar'
import { fmtLong, fmtShort, fmtWd, dt, MON } from '@/design/dc/dates'
import type { DayBuckets } from '../attendance/attendanceBuckets'
import type { StaffStatusResponse } from '../api/useAttendance'
import { attRows, pctOf, type AttFilter, type PillTone } from './dashboardModel'

// ── Date chip + the dashboard calendar ───────────────────────────────────────
export function DateChipButton({ sel, today, daily, holidays, onApply, onOpenTracking }: {
  sel: string; today: string; daily: Record<string, DayBuckets>; holidays: { date: string; name: string }[]
  onApply: (iso: string | null) => void; onOpenTracking: (iso: string) => void
}) {
  const [open, setOpen] = useState(false)
  const isToday = sel === today
  return (
    <span className="ud-cal-wrap">
      <button type="button" className="ud-date" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        aria-label={isToday ? `Today, ${fmtLong(sel)} · change the dashboard date` : `Viewing ${fmtWd(sel)} · change the dashboard date`}>
        <span className="ud-date__ic" aria-hidden="true">{dashIcon('calendar', 15)}</span>
        <span className="ud-date__txt" aria-hidden="true"><span className="ud-date__tag">{isToday ? 'Today' : 'Viewing'}</span><span>{fmtLong(sel)}</span></span>
        <span className="ud-date__chev" aria-hidden="true">{dashIcon('chevronDown', 14)}</span>
      </button>
      {open && (
        <>
          <span className="ud-cal-scrim" onClick={() => setOpen(false)} aria-hidden="true" />
          <span className="ud-cal-pop">
            <DashCalendar selected={sel} today={today} daily={daily} holidays={holidays} palette="emerald"
              onApply={(iso: string) => { setOpen(false); onApply(iso === today ? null : iso) }}
              onClose={() => setOpen(false)}
              onOpenTracking={(iso: string) => { setOpen(false); onOpenTracking(iso) }} />
          </span>
        </>
      )}
    </span>
  )
}

// ── Past-date banner (kept from today: client decision) ─────────────────────
export function PastBanner({ sel, onBack }: { sel: string; onBack: () => void }) {
  return (
    <div role="status" className="ud-past">
      <span className="ud-past__ic" aria-hidden="true">{dashIcon('calendarDays', 18)}</span>
      <span className="ud-past__txt">
        Viewing <strong>{fmtWd(sel)}</strong>. Every card shows that day as it was, except Upcoming milestones, which counts from today. Anything marked “As of today” keeps no history, so it shows today.
      </span>
      <Button variant="secondary" size={32} onClick={onBack}>Back to today</Button>
    </div>
  )
}

export function AsOfToday({ title = 'This keeps no history, so it shows today' }: { title?: string }) {
  return <span className="ud-asof" title={title}>{dashIcon('clock', 12)}As of today</span>
}

// ── Seats (workspace.billing.manage). The strip warns at ≥ 90 % used; billing managers always see the line. ──
export function SeatsStrip({ used, total, isPast, onAdd }: { used: number; total: number; isPast: boolean; onAdd: () => void }) {
  const left = Math.max(0, total - used), pct = total ? Math.min(100, Math.round((used / total) * 100)) : 0
  const full = total > 0 && used >= total, warn = !full && total > 0 && used / total >= 0.9
  const tone = full ? 'full' : warn ? 'warn' : 'ok'
  return (
    <div role={full ? 'alert' : 'status'} className={`ud-seats ud-seats--${tone} ufx-rise`}>
      <div className="ud-seats__lead">
        <span className="ud-seats__ic" aria-hidden="true">{dashIcon('armchair', 17)}</span>
        <span className="ud-seats__eyebrow">Seats used</span>
        <span className="ud-seats__n">{used}<small> / {total}</small></span>
      </div>
      <span className="ud-seats__bar" aria-hidden="true"><span style={{ width: `${pct}%` }} /></span>
      <div className="ud-seats__msg">
        {full
          ? <><b>All {total} seats are in use.</b> Adding employees is blocked until you add seats.</>
          : warn
            ? <><b>{left} {left === 1 ? 'seat' : 'seats'} left.</b> Add seats before the next batch of joiners.</>
            : <><b>{left} {left === 1 ? 'seat' : 'seats'} left</b> of {total}.</>}
        {isPast && <> <AsOfToday title="Seats keep no history, so this is today’s count" /></>}
      </div>
      <Button variant={full ? 'danger' : 'secondary'} size={32} onClick={onAdd}>{full ? 'Upgrade to add more employees' : 'Add seats'}</Button>
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
