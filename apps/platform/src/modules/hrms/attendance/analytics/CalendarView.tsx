// Attendance analytics · Calendar (no design of its own; kept, restyled on the kit). Each box is one day of the
// chosen month: the share who came in, a holiday, a weekly off, or no data. A day opens its numbers on the side and
// links to that day's logs.
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, ErrorState, Skeleton, StatusPill, SectionLink } from '@/design/kit/display'
import { MON, MONTHS, WDL, dt } from '@/design/dc/dates'
import { dayKind, dayRate, leadingBlanks, monthEnd, monthLabel, pickDay, rateBand, type DayKind } from './analyticsModel'
import type { useAnalyticsData } from './useAnalyticsData'

type Analytics = ReturnType<typeof useAnalyticsData>

const BAND_CLASS: Record<string, string> = { Great: 'great', Good: 'good', 'Needs a look': 'low' }
const BAND_TONE: Record<string, 'success' | 'mint' | 'warning'> = { Great: 'success', Good: 'mint', 'Needs a look': 'warning' }

export function CalendarView({ m, today, a, mobile }: { m: { month: string; past: boolean }; today: string; a: Analytics; mobile: boolean }) {
  const navigate = useNavigate()
  const [sel, setSel] = useState<string | null>(null)
  if (a.trendError) return <Card><ErrorState title="Couldn’t load the calendar" error={a.trendError} onRetry={a.retry} /></Card>
  if (a.loading) return <Card><Skeleton style={{ height: 460, width: '100%', borderRadius: 18 }} /></Card>

  const d = a.data, ym = m.month, mon = MON[Number(ym.slice(5, 7)) - 1], dim = Number(monthEnd(ym).slice(8))
  const ctx = { today, daily: d.daily, holidays: d.holidays, offWd: d.offWd }
  const iso = (n: number) => `${ym}-${String(n).padStart(2, '0')}`
  const day = pickDay(sel, { month: ym, ...ctx })
  let best: { d: number; rt: number } | null = null, low: { d: number; rt: number } | null = null
  const cells = Array.from({ length: dim }, (_, i) => {
    const n = i + 1, key = iso(n), k: DayKind = dayKind(key, ctx), r = d.daily[key]
    let main = '', aria: string, cls: string = k
    if (k === 'work') {
      const rt = dayRate(r), band = rateBand(rt)
      main = `${rt}%`; aria = `${n} ${mon}: ${rt}% came in, ${band.toLowerCase()}`; cls = BAND_CLASS[band]
      if (!best || rt > best.rt) best = { d: n, rt }
      if (!low || rt < low.rt) low = { d: n, rt }
    } else if (k === 'holiday') { main = mobile ? 'Hol.' : 'Holiday'; aria = `${n} ${mon}: ${d.holidays[key]}` }
    else if (k === 'off') { main = 'Off'; aria = `${n} ${mon}: weekly off` }
    else if (k === 'future') { aria = `${n} ${mon}: coming up` }
    else { main = '—'; aria = `${n} ${mon}: no data` }
    return { n, key, k, main, aria, cls }
  })
  const b = best as { d: number; rt: number } | null, l = low as { d: number; rt: number } | null
  const cv = mobile
    ? { vb: '0 0 50 50', inset: 1.5, w: 47, h: 47, r: 10, tx: 25, ty1: 23, ty2: 39, anchor: 'middle' as const, fs1: 15, fs2: 10.5 }
    : { vb: '0 0 100 74', inset: 2, w: 96, h: 70, r: 11, tx: 12, ty1: 25, ty2: 60, anchor: 'start' as const, fs1: 15, fs2: 18 }

  const k = dayKind(day, ctx), r = d.daily[day], sd = dt(day), T = r?.total || 1, rt = k === 'work' ? dayRate(r) : 0, band = rateBand(rt)
  const rows = k === 'work' && r
    ? ([['On time', r.regular, 'var(--u-success-2,#1F9D6E)'], ['Late', r.late, 'var(--u-warning,#C8912E)'], ['Half day', r.halfDay, 'var(--u-holiday,#8B4FE0)'],
      ['Working from home', r.wfh, 'var(--u-info,#2585C7)'], ['On leave', r.onLeave, 'var(--u-leave,#E0661B)'], ['Absent', r.absent, 'var(--u-danger,#D9352B)'],
      ['Not marked yet', r.notMarked, 'var(--u-ink3,#6A7A73)']] as [string, number, string][]).filter((x) => (x[1] || 0) > 0)
    : []
  const chip = day === today ? 'Today' : k === 'holiday' ? d.holidays[day] : k === 'off' ? 'Weekly off' : k === 'future' ? 'Coming up' : ''
  const present = r?.present || 0, expected = present + (r?.absent || 0) + (r?.notMarked || 0)

  return (
    <div className="apl-row" style={{ alignItems: 'flex-start' }}>
      <Card as="section" labelledBy="cal-title" className="apl-grow-2" padding="md">
        <div className="apl-cal">
          <div className="apl-cal__head">
            <div>
              <h3 id="cal-title">{monthLabel(`${ym}-01`)}</h3>
              <p>{b && l ? `Best day ${b.d} ${mon} (${b.rt}%) · Lowest ${l.d} ${mon} (${l.rt}%)` : 'No working days recorded yet'}</p>
            </div>
            <ul className="apl-legend">
              <li><i className="apl-cal__swatch apl-sw--great" />Great · 95%+</li>
              <li><i className="apl-cal__swatch apl-sw--good" />Good · 90–94%</li>
              <li><i className="apl-cal__swatch apl-sw--low" />Needs a look · below 90%</li>
              <li><i className="apl-cal__swatch apl-sw--off" />Day off</li>
              <li><i className="apl-cal__swatch apl-sw--holiday" />Holiday</li>
            </ul>
          </div>
          <div className="apl-cal__wd" aria-hidden="true">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((w) => <span key={w}>{w}</span>)}</div>
          <div className="apl-cal__grid">
            {Array.from({ length: leadingBlanks(ym) }, (_, i) => <span key={`b${i}`} aria-hidden="true" />)}
            {cells.map((c) => (
              <button key={c.key} type="button" aria-pressed={c.key === day} aria-label={c.aria}
                className={`apl-cal__day apl-cal--${c.cls}${c.key === today ? ' apl-cal__day--today' : ''}`}
                title={c.k === 'future' ? 'Coming up' : 'Shows this day’s details'} onClick={() => setSel(c.key)}>
                <svg viewBox={cv.vb} aria-hidden="true">
                  <rect x={cv.inset} y={cv.inset} width={cv.w} height={cv.h} rx={cv.r} />
                  <text x={cv.tx} y={cv.ty1} textAnchor={cv.anchor} fontSize={cv.fs1}>{c.n}</text>
                  <text x={cv.tx} y={cv.ty2} textAnchor={cv.anchor} fontSize={cv.fs2}>{c.main}</text>
                </svg>
              </button>
            ))}
          </div>
        </div>
      </Card>
      <Card as="aside" className="apl-grow-1" padding="md">
        <div className="apl-side" aria-live="polite">
          <div className="apl-side__head">
            <h3>{`${WDL[sd.getDay()]}, ${sd.getDate()} ${MONTHS[sd.getMonth()]}${day.slice(0, 4) === today.slice(0, 4) ? '' : ' ' + sd.getFullYear()}`}</h3>
            {chip && <StatusPill tone="neutral">{chip}</StatusPill>}
          </div>
          {k === 'work' && (
            <>
              <div className="apl-side__big">
                <strong>{present}</strong>
                <span>{`of ${expected} expected came in`}</span>
                <span style={{ marginLeft: 'auto' }}><StatusPill tone={BAND_TONE[band]}>{`${rt}% · ${band}`}</StatusPill></span>
              </div>
              <ul className="apl-side__rows">
                {rows.map(([label, n, color]) => (
                  <li key={label}>
                    <span><span>{label}</span><strong>{n}</strong></span>
                    <span className="apl-bar" aria-hidden="true"><span style={{ width: `${((n / T) * 100).toFixed(1)}%`, background: color }} /></span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {(k === 'off' || k === 'holiday') && (
            <p>{k === 'holiday' ? `${d.holidays[day]}: a company holiday, so no one was expected at work.`
              : present ? `${WDL[sd.getDay()]} is a weekly off. ${present} ${present === 1 ? 'person' : 'people'} still checked in.` : `${WDL[sd.getDay()]} is a weekly off.`}</p>
          )}
          {k === 'future' && <p>This day hasn’t happened yet.</p>}
          {k === 'none' && <p>No attendance was recorded for this day.</p>}
          {k !== 'future' && (
            <SectionLink label="Open this day’s logs" arrow onClick={() => navigate(`/hrms/attendance?tab=team&date=${day}`)} />
          )}
        </div>
      </Card>
    </div>
  )
}
