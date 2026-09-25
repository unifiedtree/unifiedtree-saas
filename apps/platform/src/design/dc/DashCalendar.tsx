// Ported from the design component DashCalendar.dc.html.
import { createRef } from 'react'
import { DCLogic, dc } from './dc-runtime'
import { DashCalendarView } from './DashCalendar.view'
import { dashIcon } from './icons'

export class DashCalendar extends DCLogic {
  state: any = { month: null, pick: null }
  rootRef = createRef<HTMLDivElement>()
  componentDidMount() {
    const el = this.rootRef.current
    if (el && el.focus) el.focus({ preventScroll: true })
  }
  today(): string { return this.props.today }
  iso(d: Date) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
  cur(): string { return this.state.pick || this.props.selected || this.today() }
  set(k: string) { if (k <= this.today()) this.setState({ pick: k, month: k.slice(0, 7) }) }
  shift(days: number) {
    const d = new Date(this.cur() + 'T00:00:00')
    d.setDate(d.getDate() + days)
    this.set(this.iso(d))
  }
  apply = () => {
    const k = this.cur()
    if (k <= this.today() && this.props.onApply) this.props.onApply(k)
  }
  onKey = (e: any) => {
    const mv = ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 } as Record<string, number>)[e.key]
    if (mv) { e.preventDefault(); this.shift(mv) } else if (e.key === 'Enter') { e.preventDefault(); this.apply() } else if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation(); if (this.props.onClose) this.props.onClose()
    }
  }
  renderVals() {
    const p = this.props, today = this.today(), pick = this.cur()
    const daily: Record<string, any> = p.daily || {}, holidays: any[] = p.holidays || []
    const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
    const MON = MONTHS.map((m) => m.slice(0, 3)), WDL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    const month: string = this.state.month || pick.slice(0, 7), [y, m] = month.split('-').map(Number)
    const first = new Date(y, m - 1, 1), off = (first.getDay() + 6) % 7, dim = new Date(y, m, 0).getDate(), total = Math.ceil((off + dim) / 7) * 7
    const hol: Record<string, string> = {}
    holidays.forEach((h: any) => { hol[h.date] = h.name })
    const emerald = p.palette === 'emerald'
    const rate = emerald ? { hi: '#0f6e56', mid: '#34d399', lo: '#a7f3d0' } : { hi: '#10b981', mid: '#f59e0b', lo: '#f43f5e' }
    const rateOf = (k: string) => {
      const d = daily[k]
      if (!d) return null
      const sch = d.total - d.other
      return sch > 0 ? d.present / sch : null
    }
    const rc = (r: number) => (r >= 0.9 ? rate.hi : r >= 0.75 ? rate.mid : rate.lo)
    // Weekly offs: the trend flags a day nobody in scope was scheduled (the company's and each person's own
    // week-offs). Days it doesn't cover follow the weekdays that were always off; Sunday when nothing is known.
    const seenOff: Record<number, boolean> = {}
    Object.keys(daily).forEach((k) => { const o = daily[k]?.weeklyOff; if (typeof o === 'boolean') { const w = new Date(k + 'T00:00:00').getDay(); seenOff[w] = (seenOff[w] ?? true) && o } })
    const offWd = Object.keys(seenOff).length ? Object.keys(seenOff).map(Number).filter((w) => seenOff[w]) : [0]
    const isWeekOff = (k: string) => { const o = daily[k]?.weeklyOff; return typeof o === 'boolean' ? o : offWd.includes(new Date(k + 'T00:00:00').getDay()) }
    const cells: any[] = []
    for (let i = 0; i < total; i++) {
      const d = new Date(y, m - 1, 1 - off + i), k = this.iso(d), inM = d.getMonth() === m - 1, fut = k > today, wd = d.getDay(), isHol = !!hol[k], wOff = isWeekOff(k)
      const r = rateOf(k)
      const kind = !inM ? 'out' : fut ? 'future' : k === pick ? 'sel' : k === today ? 'today' : wOff || isHol ? 'off' : 'day'
      const hasRate = inM && !fut && r != null && !wOff && !isHol
      cells.push({
        key: k, day: d.getDate(),
        isSel: kind === 'sel', isToday: kind === 'today', isDay: kind === 'day', isOff: kind === 'off', isFuture: kind === 'future', isOut: kind === 'out',
        markColor: kind === 'sel' ? '#ffffff' : hasRate ? rc(r as number) : '#ffffff',
        markOpacity: hasRate ? 1 : 0,
        holidayOpacity: isHol ? 1 : 0,
        label: `${WDL[wd]}, ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}${isHol ? ' · ' + hol[k] : wOff ? ' · Weekly off' : ''}${fut ? ' · no attendance yet' : ''}`,
        onClick: () => { if (!fut && inM) this.setState({ pick: k }) },
      })
    }
    const monthShift = (dm: number) => () => {
      const d = new Date(y, m - 1 + dm, 1)
      this.setState({ month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` })
    }
    const pd = daily[pick], pw = new Date(pick + 'T00:00:00'), pwd = pw.getDay(), r = rateOf(pick)
    const tag = pick === today ? ['ok', 'Today'] : hol[pick] ? ['warn', hol[pick]] : isWeekOff(pick) ? ['gray', 'Weekly off'] : ['info', 'Past day']
    const sc = emerald ? ['#0f6e56', '#10b981', '#0a5240', '#34d399'] : ['#10b981', '#f59e0b', '#f43f5e', '#8b5cf6']
    const panel = {
      title: `${WDL[pwd]}, ${pw.getDate()} ${MON[pw.getMonth()]} ${pw.getFullYear()}`,
      tone: tag[0], tag: tag[1], hasData: !!pd, noData: !pd,
      note: 'No attendance was recorded for this day, so the dashboard would show empty counts.',
      rate: r != null ? Math.round(r * 100) + '%' : '—',
      ratePct: r != null ? Math.round(r * 100) : 0,
      rateColor: r != null ? rc(r) : '#e2e8f0',
      scheduled: pd ? `${pd.present} of ${pd.total - pd.other} scheduled staff present` : '',
      stats: pd ? ([['Present', pd.present, sc[0]], ['Late', pd.late, sc[1]], ['Absent', pd.absent, sc[2]], ['On leave', pd.onLeave, sc[3]]] as any[]).map(([label, value, color]) => ({ label, value, color })) : [],
    }
    const lastWorking = () => {
      const d = new Date(today + 'T00:00:00')
      let guard = 0
      do { d.setDate(d.getDate() - 1) } while ((isWeekOff(this.iso(d)) || hol[this.iso(d)]) && ++guard < 60)
      this.set(this.iso(d))
    }
    return {
      rootRef: this.rootRef, onKey: this.onKey, monthLabel: `${MONTHS[m - 1]} ${y}`, cells, rate, panel,
      icPrev: dashIcon('chevronLeft', 16), icNext: dashIcon('chevronRight', 16),
      prevMonth: monthShift(-1), nextMonth: monthShift(1),
      pickToday: () => this.set(today),
      pickYesterday: () => { const d = new Date(today + 'T00:00:00'); d.setDate(d.getDate() - 1); this.set(this.iso(d)) },
      pickLastWorking: lastWorking,
      apply: this.apply,
      applyLabel: pick === today ? 'Show today on dashboard' : `Show ${pw.getDate()} ${MON[pw.getMonth()]} on dashboard`,
      close: () => p.onClose && p.onClose(),
      openTracking: () => p.onOpenTracking && p.onOpenTracking(pick),
    }
  }
  render() { return dc(this, DashCalendarView, 'DashCalendar') }
}
