// Ported from the design component DatePicker.dc.html.
import { createRef } from 'react'
import { DCLogic, dc } from './dc-runtime'
import { DatePickerView } from './DatePicker.view'
import { dashIcon } from './icons'
import { istToday } from './dates'

export class DatePicker extends DCLogic {
  state: any = { open: false, view: 'days', month: null, cur: null }
  rootRef = createRef<HTMLDivElement>()
  triggerRef = createRef<HTMLButtonElement>()
  popEl: HTMLElement | null = null
  _down?: (e: MouseEvent) => void
  _re?: () => void
  _skip = false
  setPop = (el: HTMLElement | null) => {
    this.popEl = el
    if (el && this.state.open) this.place()
  }
  componentDidMount() {
    this._down = (e: MouseEvent) => {
      if (!this.state.open) return
      const path = e.composedPath ? e.composedPath() : []
      const inside = [this.rootRef.current, this.popEl].some((el) => el && (path.indexOf(el) >= 0 || el.contains(e.target as Node)))
      if (!inside) this.close()
    }
    this._re = () => { if (this.state.open) this.place() }
    document.addEventListener('mousedown', this._down, true)
    window.addEventListener('resize', this._re)
    window.addEventListener('scroll', this._re, true)
  }
  componentWillUnmount() {
    if (this._down) document.removeEventListener('mousedown', this._down, true)
    if (this._re) { window.removeEventListener('resize', this._re); window.removeEventListener('scroll', this._re, true) }
  }
  componentDidUpdate() { if (this.state.open) this.place() }
  place() {
    const t = this.triggerRef.current, el = this.popEl
    if (!t || !el) return
    const r = t.getBoundingClientRect(), W = el.offsetWidth || 316, H = el.offsetHeight || 390, vw = window.innerWidth, vh = window.innerHeight, g = 6
    let top = r.bottom + g
    if (top + H > vh - 8) { const up = r.top - g - H; top = up >= 8 ? up : Math.max(8, vh - 8 - H) }
    const left = Math.min(Math.max(8, r.left), Math.max(8, vw - W - 8))
    el.style.top = top + 'px'
    el.style.left = left + 'px'
    const b = el.getBoundingClientRect()
    if (Math.abs(b.top - top) > 0.5 || Math.abs(b.left - left) > 0.5) {
      el.style.top = 2 * top - b.top + 'px'
      el.style.left = 2 * left - b.left + 'px'
    }
  }
  P(s: string) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d || 1) }
  I(d: Date) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
  add(iso: string, n: number) { const d = this.P(iso); d.setDate(d.getDate() + n); return this.I(d) }
  addM(iso: string, n: number) {
    const d = this.P(iso), day = d.getDate(), t = new Date(d.getFullYear(), d.getMonth() + n, 1)
    t.setDate(Math.min(day, new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate()))
    return this.I(t)
  }
  today(): string { return this.props.today || istToday() }
  ok(iso: string) { const { min, max } = this.props; return (!min || iso >= min) && (!max || iso <= max) }
  clamp(iso: string) { const { min, max } = this.props; if (min && iso < min) return min; if (max && iso > max) return max; return iso }
  emit(v: string) { const f = this.props.onChange; if (f) f({ target: { value: v } }, v) }
  openIt() {
    const base = this.clamp(this.props.value || this.today())
    this.setState({ open: true, view: 'days', month: base.slice(0, 7), cur: base })
  }
  close() { this.setState({ open: false }) }
  toggle = () => {
    if (this._skip) { this._skip = false; return }
    if (this.state.open) this.close(); else this.openIt()
  }
  pick(iso: string) { if (!this.ok(iso)) return; this.emit(iso); this.close() }
  pickMonth(ym: string) {
    const cur = this.state.cur || this.today(), day = Number(cur.slice(8, 10)) || 1, dim = new Date(+ym.slice(0, 4), +ym.slice(5, 7), 0).getDate()
    this.setState({ view: 'days', month: ym, cur: this.clamp(`${ym}-${String(Math.min(day, dim)).padStart(2, '0')}`) })
  }
  triggerKey = (e: any) => {
    const k = e.key, s = this.state
    if (!s.open) { if (k === 'ArrowDown' || k === 'ArrowUp') { e.preventDefault(); this.openIt() } return }
    if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(); return }
    if (k === 'Tab') { this.close(); return }
    if (s.view === 'months') {
      const mv = ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -3, ArrowDown: 3 } as Record<string, number>)[k]
      if (mv) { e.preventDefault(); this.setState({ month: this.addM(s.month + '-01', mv).slice(0, 7) }) } else if (k === 'Enter' || k === ' ') { e.preventDefault(); this._skip = true; this.pickMonth(s.month) }
      return
    }
    const cur = s.cur || this.clamp(this.props.value || this.today()), wd = (this.P(cur).getDay() + 6) % 7
    const to = ({
      ArrowLeft: this.add(cur, -1), ArrowRight: this.add(cur, 1), ArrowUp: this.add(cur, -7), ArrowDown: this.add(cur, 7),
      PageUp: this.addM(cur, -1), PageDown: this.addM(cur, 1), Home: this.add(cur, -wd), End: this.add(cur, 6 - wd),
    } as Record<string, string>)[k]
    if (to) { e.preventDefault(); const c = this.clamp(to); this.setState({ cur: c, month: c.slice(0, 7) }) } else if (k === 'Enter' || k === ' ') { e.preventDefault(); this._skip = true; this.pick(cur) }
  }
  renderVals() {
    const p = this.props, s = this.state
    const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
    const MON = MONTHS.map((x) => x.slice(0, 3)), WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], WDL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    const today = this.today(), value: string = p.value || '', placeholder = p.placeholder || 'Pick a date'
    const fmt = (iso: string) => { const d = this.P(iso); return `${WD[d.getDay()]}, ${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}` }
    const month: string = s.month || (value || today).slice(0, 7), y = +month.slice(0, 4), m = +month.slice(5, 7)
    const off = (new Date(y, m - 1, 1).getDay() + 6) % 7, isMonths = s.view === 'months'
    const cells: any[] = []
    for (let i = 0; i < 42; i++) {
      const d = new Date(y, m - 1, 1 - off + i), k = this.I(d), inM = d.getMonth() === m - 1, en = this.ok(k)
      const kind = !en ? 'dis' : k === value ? 'sel' : k === today ? 'today' : !inM ? 'out' : 'day'
      cells.push({
        iso: k, day: d.getDate(), isDis: kind === 'dis', isSel: kind === 'sel', isToday: kind === 'today', isOut: kind === 'out', isDay: kind === 'day',
        isCursor: s.open && !isMonths && en && k === s.cur,
        aria: `${WDL[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}${k === today ? ' (today)' : ''}${en ? '' : ' — not available'}`,
        onClick: () => this.pick(k),
      })
    }
    const minYM = p.min ? p.min.slice(0, 7) : null, maxYM = p.max ? p.max.slice(0, 7) : null
    const ym = (yy: number, mm: number) => `${yy}-${String(mm).padStart(2, '0')}`
    const months = MON.map((label, i) => {
      const v = ym(y, i + 1), dis = (minYM && v < minYM) || (maxYM && v > maxYM)
      const kind = dis ? 'dis' : value.slice(0, 7) === v ? 'sel' : today.slice(0, 7) === v ? 'cur' : 'norm'
      return { label, isDis: kind === 'dis', isSel: kind === 'sel', isCur: kind === 'cur', isNorm: kind === 'norm', isCursor: s.open && isMonths && !dis && v === month, onClick: () => this.pickMonth(v) }
    })
    const pm = m === 1 ? ym(y - 1, 12) : ym(y, m - 1), nm = m === 12 ? ym(y + 1, 1) : ym(y, m + 1)
    const prevOk = isMonths ? !(minYM && ym(y - 1, 12) < minYM) : !(minYM && pm < minYM)
    const nextOk = isMonths ? !(maxYM && ym(y + 1, 1) > maxYM) : !(maxYM && nm > maxYM)
    const d0 = this.P(today), nextMon = this.add(today, (8 - d0.getDay()) % 7 || 7)
    const seen: Record<string, boolean> = {}
    const presets = ([['Today', today], ['Yesterday', this.add(today, -1)], ['Tomorrow', this.add(today, 1)], ['Next Monday', nextMon]] as [string, string][])
      .filter(([, v]) => this.ok(v) && !seen[v] && (seen[v] = true))
      .slice(0, 3)
      .map(([label, v]) => ({ label, active: v === value, inactive: v !== value, onClick: () => this.pick(v) }))
    const showClear = !!p.clearable && !!value
    return {
      rootRef: this.rootRef, triggerRef: this.triggerRef, setPop: this.setPop, toggle: this.toggle, triggerKey: this.triggerKey,
      keepFocus: (e: any) => e.preventDefault(),
      open: s.open, hasValue: !!value, noValue: !value, display: value ? fmt(value) : '', placeholder,
      triggerAria: `${p.label || 'Date'}: ${value ? fmt(value) : 'not set'}`,
      isDays: !isMonths, isMonths, title: isMonths ? String(y) : `${MONTHS[m - 1]} ${y}`,
      viewAria: isMonths ? 'Back to days' : 'Choose month',
      toggleView: () => this.setState({ view: isMonths ? 'days' : 'months' }),
      prevOn: prevOk, prevOff: !prevOk, nextOn: nextOk, nextOff: !nextOk,
      prevAria: isMonths ? 'Previous year' : 'Previous month', nextAria: isMonths ? 'Next year' : 'Next month',
      prev: () => this.setState({ month: isMonths ? ym(y - 1, m) : pm }),
      next: () => this.setState({ month: isMonths ? ym(y + 1, m) : nm }),
      cells, months, presets, showClear, hasFooter: presets.length > 0 || showClear,
      clear: () => { this.emit(''); this.close() },
      icCal: dashIcon('calendar', 16), icChev: dashIcon('chevronDown', 16), icCaret: dashIcon('chevronDown', 14), icPrev: dashIcon('chevronLeft', 16), icNext: dashIcon('chevronRight', 16),
    }
  }
  render() { return dc(this, DatePickerView, 'DatePicker') }
}
