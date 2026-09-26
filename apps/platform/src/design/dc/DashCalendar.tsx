// Ported from the design component DashCalendar.dc.html.
import { createRef } from 'react'
import { DCLogic, dc } from './dc-runtime'
import { DashCalendarView } from './DashCalendar.view'
import { dashIcon } from './icons'
import { monthStep, yearStep } from '@/shared/components/calendar'

/** First year the month/year views offer (attendance data can't predate it). */
const FIRST_YEAR = 2000

export class DashCalendar extends DCLogic {
  state: any = { month: null, pick: null, view: 'days', curMonth: null, curYear: null, kbd: false }
  rootRef = createRef<HTMLDivElement>()
  uid = 'dcal' + Math.random().toString(36).slice(2, 8)
  componentDidMount() {
    const el = this.rootRef.current
    if (el && el.focus) el.focus({ preventScroll: true })
  }
  today(): string { return this.props.today }
  iso(d: Date) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
  cur(): string { return this.state.pick || this.props.selected || this.today() }
  set(k: string) { if (k <= this.today()) this.setState({ pick: k, month: k.slice(0, 7), view: 'days' }) }
  shift(days: number) {
    const d = new Date(this.cur() + 'T00:00:00')
    d.setDate(d.getDate() + days)
    this.set(this.iso(d))
  }
  apply = () => {
    const k = this.cur()
    if (k <= this.today() && this.props.onApply) this.props.onApply(k)
  }
  // Month and year views (the header's "September ▾" / "2026 ▾" chips), shared with every date field.
  shownMonth(): string { return this.state.month || this.cur().slice(0, 7) }
  clampYm(ym: string): string { const t = this.today().slice(0, 7), lo = `${FIRST_YEAR}-01`; return ym > t ? t : ym < lo ? lo : ym }
  showMonths = () => {
    const s = this.state
    if (s.view === 'months') { this.setState({ view: 'days' }); return }
    const ym = s.view === 'years' ? this.clampYm(`${s.curYear}-${this.shownMonth().slice(5, 7)}`) : this.shownMonth()
    this.setState({ view: 'months', curMonth: ym })
  }
  showYears = () => {
    const s = this.state
    if (s.view === 'years') { this.setState({ view: 'days' }); return }
    this.setState({ view: 'years', curYear: Number((s.view === 'months' ? s.curMonth : this.shownMonth()).slice(0, 4)) })
  }
  pickMonth = (ym: string) => { if (ym <= this.today().slice(0, 7)) this.setState({ view: 'days', month: ym }) }
  pickYear = (y: number) => {
    if (y < FIRST_YEAR || y > Number(this.today().slice(0, 4))) return
    this.setState({ view: 'months', curMonth: this.clampYm(`${y}-${this.shownMonth().slice(5, 7)}`) })
  }
  onKey = (e: any) => {
    const s = this.state
    if (s.view !== 'days' && e.key !== 'Escape') {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (s.view === 'months') this.pickMonth(s.curMonth); else this.pickYear(s.curYear); return }
      const ty = Number(this.today().slice(0, 4))
      if (s.view === 'months') {
        const n = monthStep(e.key, s.curMonth)
        if (n) { e.preventDefault(); this.setState({ curMonth: this.clampYm(n), kbd: true }) }
      } else {
        const n = yearStep(e.key, s.curYear, FIRST_YEAR, ty)
        if (n !== null) { e.preventDefault(); this.setState({ curYear: Math.min(Math.max(n, FIRST_YEAR), ty), kbd: true }) }
      }
      return
    }
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
    const view: string = this.state.view, ty = Number(today.slice(0, 4))
    const curMonth: string = this.state.curMonth || month, curYear: number = this.state.curYear || y
    const nav = view === 'months'
      ? { prev: () => this.setState({ curMonth: this.clampYm(`${Number(curMonth.slice(0, 4)) - 1}${curMonth.slice(4)}`) }), next: () => this.setState({ curMonth: this.clampYm(`${Number(curMonth.slice(0, 4)) + 1}${curMonth.slice(4)}`) }),
        prevOff: Number(curMonth.slice(0, 4)) <= FIRST_YEAR, nextOff: Number(curMonth.slice(0, 4)) >= ty, prevAria: 'Previous year', nextAria: 'Next year' }
      : view === 'years'
        ? { prev: () => this.setState({ curYear: Math.max(FIRST_YEAR, curYear - 10) }), next: () => this.setState({ curYear: Math.min(ty, curYear + 10) }),
          prevOff: curYear <= FIRST_YEAR, nextOff: curYear >= ty, prevAria: 'Previous decade', nextAria: 'Next decade' }
        : { prev: monthShift(-1), next: monthShift(1), prevOff: false, nextOff: false, prevAria: 'Previous month', nextAria: 'Next month' }
    const pd = daily[pick], pw = new Date(pick + 'T00:00:00'), pwd = pw.getDay(), r = rateOf(pick)
    const tag = pick === today ? ['ok', 'Today'] : hol[pick] ? ['warn', hol[pick]] : isWeekOff(pick) ? ['gray', 'Weekly off'] : ['info', 'Past day']
    const sc = emerald ? ['#0f6e56', '#10b981', '#0a5240', '#34d399'] : ['#10b981', '#f59e0b', '#f43f5e', '#8b5cf6']
    const panel = {
      title: `${WDL[pwd]}, ${pw.getDate()} ${MON[pw.getMonth()]} ${pw.getFullYear()}`,
      tone: tag[0], tag: tag[1], hasData: !!pd, noData: !pd,
      // Only the recent days' attendance is loaded here; an older day isn't "empty", it just isn't loaded yet.
      note: pick < (Object.keys(daily).sort()[0] || today)
        ? 'This day’s attendance isn’t loaded here yet. Show it on the dashboard to see that day’s numbers.'
        : 'No attendance was recorded for this day, so the dashboard would show empty counts.',
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
      prevMonth: nav.prev, nextMonth: nav.next, prevOff: nav.prevOff, nextOff: nav.nextOff, prevAria: nav.prevAria, nextAria: nav.nextAria,
      isDays: view === 'days', isMonths: view === 'months', isYears: view === 'years',
      monthChip: MONTHS[Number((view === 'months' ? curMonth : month).slice(5, 7)) - 1], yearChip: view === 'years' ? curYear : view === 'months' ? Number(curMonth.slice(0, 4)) : y,
      showMonths: this.showMonths, showYears: this.showYears,
      grids: { uid: this.uid, today, max: today, min: `${FIRST_YEAR}-01-01`, lo: FIRST_YEAR, hi: ty, curMonth, curYear, kbd: !!this.state.kbd, selectedMonth: pick.slice(0, 7), selectedYear: Number(pick.slice(0, 4)), pickMonth: this.pickMonth, pickYear: this.pickYear },
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
