// Attendance Analytics · Calendar — ported from the design component
// AttCalendar.dc.html, for the chosen month (?month=, this month by default)
// instead of the prototype's Sep 2026.
import { DCLogic, dc } from './dc-runtime'
import { AttCalendarView } from './AttCalendar.view'
import { dashIcon } from './icons'
import { dt, MON, MONTHS, WDL } from './dates'

export class AttCalendar extends DCLogic {
  state: any = { sel: null }
  renderVals() {
    const p = this.props, O = p.ov || { daily: {}, holidays: [] }
    const st = p.state || 'live', mobile = !!p.mobile, open = p.onOpenLogs || (() => {}), isEmpty = st === 'empty'
    const today: string = O.today || '', daily: Record<string, any> = O.daily || {}
    const ym: string = O.month || today.slice(0, 7)
    const y = Number(ym.slice(0, 4)), mo = Number(ym.slice(5, 7)) - 1, mon = MON[mo], dim = new Date(y, mo + 1, 0).getDate()
    const isoOfDay = (d: number) => `${ym}-${String(d).padStart(2, '0')}`
    const hol: Record<string, string> = {}
    ;(O.holidays || []).forEach((h: any) => { hol[h.date] = h.name })
    const rateOf = (r: any) => { const e = (r.present || 0) + (r.absent || 0) + (r.notMarked || 0); return e ? Math.round((r.present / e) * 100) : 0 }
    // A weekly off is a day nobody in scope was scheduled (the company's and each person's own week-offs,
    // from the trend); days it doesn't cover follow the weekday pattern, Sunday when nothing is known.
    const offWd: number[] = O.offWeekdays || [0]
    const isOff = (iso: string) => { const r = daily[iso]; return r && typeof r.weeklyOff === 'boolean' ? r.weeklyOff : offWd.includes(dt(iso).getDay()) }
    const kind = (iso: string) => {
      if (iso > today) return 'future'
      if (hol[iso]) return 'holiday'
      if (isOff(iso)) return 'off'
      // No one counted that day (before attendance was tracked, e.g. an old month): no data, not 0%.
      if (isEmpty || !daily[iso] || !daily[iso].total) return 'none'
      return 'work'
    }
    // The day in the side panel: the one tapped in this month, else today (this month) or the
    // month's last working day with numbers (a past month), else its last day.
    let sel: string = this.state.sel && this.state.sel.slice(0, 7) === ym ? this.state.sel : ''
    if (!sel && today.slice(0, 7) === ym) sel = today
    for (let d = dim; !sel && d >= 1; d--) if (kind(isoOfDay(d)) === 'work') sel = isoOfDay(d)
    if (!sel) sel = isoOfDay(dim)
    const TONE = (r: number): [string, string, string] => (r >= 95 ? ['#059669', '#ffffff', 'Great'] : r >= 90 ? ['#a7f3d0', '#065f46', 'Good'] : ['#fde68a', '#92400e', 'Needs a look'])
    const cells: any[] = [], offset = (new Date(y, mo, 1).getDay() + 6) % 7
    let best: any = null, low: any = null
    for (let i = 0; i < offset; i++) cells.push({ blank: true, isDay: false })
    for (let d = 1; d <= dim; d++) {
      const iso = isoOfDay(d), k = kind(iso), r = daily[iso] || {}
      let bg = '#f1f5f9', fg = '#94a3b8', main = '', aria: string
      if (k === 'work') {
        const rt = rateOf(r), t = TONE(rt)
        bg = t[0]; fg = t[1]; main = rt + '%'; aria = `${d} ${mon}: ${rt}% came in, ${t[2].toLowerCase()}`
        if (!best || rt > best.rt) best = { d, rt }
        if (!low || rt < low.rt) low = { d, rt }
      } else if (k === 'holiday') { bg = '#ede9fe'; fg = '#6d28d9'; main = mobile ? 'Hol.' : 'Holiday'; aria = `${d} ${mon}: ${hol[iso]}` } else if (k === 'off') { main = 'Off'; aria = `${d} ${mon}: weekly off` } else if (k === 'future') { bg = '#ffffff'; fg = '#cbd5e1'; aria = `${d} ${mon}: coming up` } else { main = '—'; aria = `${d} ${mon}: no data` }
      const isSel = iso === sel, isToday = iso === today
      cells.push({
        blank: false, isDay: true, day: d, main, bg, fg, aria, sel: isSel, tip: k === 'future' ? 'Coming up' : 'Shows this day’s details',
        stroke: isSel ? '#0f6e56' : isToday ? '#0f172a' : k === 'future' ? '#e2e8f0' : 'none', sw: isSel ? 3.5 : isToday ? 2.5 : k === 'future' ? 1.5 : 0,
        onClick: () => this.setState({ sel: iso }),
      })
    }
    while (cells.length % 7) cells.push({ blank: true, isDay: false })
    const k = kind(sel), r = daily[sel] || {}, sd = dt(sel), T = r.total || 1, rt = k === 'work' ? rateOf(r) : 0, tone = TONE(rt)
    const rows = k === 'work'
      ? ([['On time', r.regular, '#10b981'], ['Late', r.late, '#f59e0b'], ['Half day', r.halfDay, '#84cc16'], ['Working from home', r.wfh, '#14b8a6'], ['On leave', r.onLeave, '#a855f7'], ['Absent', r.absent, '#f43f5e'], ['Not marked yet', r.notMarked, '#64748b']] as [string, number, string][])
        .filter((x) => (x[1] || 0) > 0).map(([label, n, color]) => ({ label, n, color, w: ((n / T) * 100).toFixed(1) + '%' }))
      : []
    const chip = sel === today ? 'Today' : k === 'holiday' ? hol[sel] : k === 'off' ? 'Weekly off' : k === 'future' ? 'Coming up' : ''
    const d = {
      title: `${WDL[sd.getDay()]}, ${sd.getDate()} ${MONTHS[sd.getMonth()]}`, chip, hasChip: !!chip,
      isWork: k === 'work', isOff: k === 'off' || k === 'holiday', isFuture: k === 'future', isNone: k === 'none',
      present: r.present || 0, expected: (r.present || 0) + (r.absent || 0) + (r.notMarked || 0), rate: rt + '%', rateLabel: tone[2],
      isGreat: rt >= 95, isGood: rt >= 90 && rt < 95, isLow: rt < 90, rows,
      offText: k === 'holiday' ? `${hol[sel]} — a company holiday, so no one was expected at work.`
        : r.present ? `${WDL[sd.getDay()]} is a weekly off. ${r.present} ${r.present === 1 ? 'person' : 'people'} still checked in.` : `${WDL[sd.getDay()]} is a weekly off.`,
      open: () => open('', sel), openTip: `→ /hrms/attendance?tab=team&date=${sel}`,
    }
    return {
      isError: st === 'error', isLoading: st === 'loading', showCal: st !== 'error' && st !== 'loading', isDesktop: !mobile, isMobile: mobile, cells, d,
      cv: mobile
        ? { vb: '0 0 50 50', inset: 1.5, w: 47, h: 47, r: 10, tx: 25, ty1: 23, ty2: 39, anchor: 'middle', fs1: 15, fs2: 10.5 }
        : { vb: '0 0 100 74', inset: 2, w: 96, h: 70, r: 11, tx: 12, ty1: 25, ty2: 60, anchor: 'start', fs1: 15, fs2: 18 },
      bestLine: best ? `Best day ${best.d} ${mon} (${best.rt}%) · Lowest ${low.d} ${mon} (${low.rt}%)` : 'No working days recorded yet',
      legend: [{ label: 'Great · 95%+', color: '#059669' }, { label: 'Good · 90–94%', color: '#a7f3d0' }, { label: 'Needs a look · below 90%', color: '#fde68a' }, { label: 'Day off', color: '#f1f5f9' }, { label: 'Holiday', color: '#ede9fe' }],
      monthLabel: `${MONTHS[mo]} ${y}`,
      icChevron: dashIcon('chevronRight', 15), sk: { style: { height: 460, width: '100%', borderRadius: 18 } }, retry: () => p.onRetry && p.onRetry(),
    }
  }
  render() { return dc(this, AttCalendarView, 'AttCalendar') }
}
