// Ported from the design component TimePicker.dc.html.
import { createRef } from 'react'
import { DCLogic, dc } from './dc-runtime'
import { TimePickerView } from './TimePicker.view'
import { dashIcon } from './icons'

export class TimePicker extends DCLogic {
  state: any = { open: false }
  rootRef = createRef<HTMLDivElement>()
  triggerRef = createRef<HTMLButtonElement>()
  hRef = createRef<HTMLDivElement>()
  mRef = createRef<HTMLDivElement>()
  popEl: HTMLElement | null = null
  _down?: (e: MouseEvent) => void
  _re?: () => void
  _skip = false
  _kbd = false
  setPop = (el: HTMLElement | null) => {
    this.popEl = el
    if (el && this.state.open) { this.place(); setTimeout(() => this.center(), 0) }
  }
  componentDidMount() {
    this._down = (e: MouseEvent) => {
      if (!this.state.open) return
      const path = e.composedPath ? e.composedPath() : []
      const inside = [this.rootRef.current, this.popEl].some((el) => el && (path.indexOf(el) >= 0 || el.contains(e.target as Node)))
      if (!inside) this.setState({ open: false })
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
  componentDidUpdate(pp: any, ps: any) {
    if (!this.state.open) return
    this.place()
    if (!ps.open || (pp.value !== this.props.value && this._kbd)) { this._kbd = false; this.center() }
  }
  place() {
    const t = this.triggerRef.current, el = this.popEl
    if (!t || !el) return
    const r = t.getBoundingClientRect(), W = el.offsetWidth || 276, H = el.offsetHeight || 330, vw = window.innerWidth, vh = window.innerHeight, g = 6
    let top = r.bottom + g
    if (top + H > vh - 8) { const up = r.top - g - H; top = up >= 8 ? up : Math.max(8, vh - 8 - H) }
    const left = Math.min(Math.max(8, r.left), Math.max(8, vw - W - 8))
    el.style.top = top + 'px'
    el.style.left = left + 'px'
    const b = el.getBoundingClientRect()
    if (Math.abs(b.top - top) > 0.5 || Math.abs(b.left - left) > 0.5) { el.style.top = 2 * top - b.top + 'px'; el.style.left = 2 * left - b.left + 'px' }
  }
  center() {
    ;[this.hRef.current, this.mRef.current].forEach((col) => {
      if (!col) return
      const el = col.querySelector('[data-sel="1"]') as HTMLElement | null
      if (el) col.scrollTop = Math.max(0, el.offsetTop - col.clientHeight / 2 + el.offsetHeight / 2)
    })
  }
  parse(v: string) { const m = /^(\d{1,2}):(\d{2})/.exec(v || ''); return m ? { h: Math.min(23, +m[1]), m: Math.min(59, +m[2]) } : null }
  step() { return Math.max(1, Math.min(30, Number(this.props.step) || 5)) }
  emitHM(h: number, mi: number) {
    const v = `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`, f = this.props.onChange
    if (f) f({ target: { value: v } }, v)
  }
  toggle = () => {
    if (this._skip) { this._skip = false; return }
    this.setState((s: any) => ({ open: !s.open }))
  }
  triggerKey = (e: any) => {
    const k = e.key
    if (!this.state.open) { if (k === 'ArrowDown' || k === 'ArrowUp') { e.preventDefault(); this.setState({ open: true }) } return }
    if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); this.setState({ open: false }); return }
    if (k === 'Tab') { this.setState({ open: false }); return }
    if (k === 'Enter' || k === ' ') { e.preventDefault(); this._skip = true; this.setState({ open: false }); return }
    const dir = ({ ArrowUp: 1, ArrowDown: -1 } as Record<string, number>)[k]
    if (dir) {
      e.preventDefault()
      const c = this.parse(this.props.value) || { h: 9, m: 0 }, st = this.step()
      let t = c.h * 60 + Math.round(c.m / st) * st + dir * st
      t = ((t % 1440) + 1440) % 1440
      this._kbd = true
      this.emitHM(Math.floor(t / 60), t % 60)
    }
  }
  renderVals() {
    const p = this.props, s = this.state, pad = (n: number) => String(n).padStart(2, '0')
    const cur = this.parse(p.value), base = cur || { h: 9, m: 0 }, h12 = ((base.h + 11) % 12) + 1, isPm = base.h >= 12
    const to24 = (hh: number, pmv: boolean) => (hh % 12) + (pmv ? 12 : 0)
    const fmt = (t: { h: number; m: number }) => `${((t.h + 11) % 12) + 1}:${pad(t.m)} ${t.h >= 12 ? 'PM' : 'AM'}`
    const hours = Array.from({ length: 12 }, (_, i) => i + 1).map((n) => { const on = !!cur && n === h12; return { label: pad(n), sel: on, unsel: !on, onClick: () => this.emitHM(to24(n, isPm), base.m) } })
    const st = this.step(), mins: number[] = []
    for (let x = 0; x < 60; x += st) mins.push(x)
    if (cur && mins.indexOf(cur.m) < 0) { mins.push(cur.m); mins.sort((a, b) => a - b) }
    const minutes = mins.map((x) => { const on = !!cur && x === cur.m; return { label: pad(x), sel: on, unsel: !on, onClick: () => this.emitHM(base.h, x) } })
    const periods = ([['AM', false], ['PM', true]] as [string, boolean][]).map(([label, pmv]) => { const on = !!cur && isPm === pmv; return { label, sel: on, unsel: !on, onClick: () => this.emitHM(to24(h12, pmv), base.m) } })
    const presets = ((p.presets || ['09:00', '13:00', '18:00']) as string[]).map((v) => this.parse(v)).filter(Boolean).map((t: any) => {
      const v = `${pad(t.h)}:${pad(t.m)}`, on = !!cur && `${pad(cur.h)}:${pad(cur.m)}` === v
      return { label: fmt(t), active: on, inactive: !on, onClick: () => this.emitHM(t.h, t.m) }
    })
    return {
      rootRef: this.rootRef, triggerRef: this.triggerRef, hRef: this.hRef, mRef: this.mRef, setPop: this.setPop, toggle: this.toggle, triggerKey: this.triggerKey,
      keepFocus: (e: any) => e.preventDefault(), open: s.open, hasValue: !!cur, noValue: !cur, display: cur ? fmt(cur) : '',
      placeholder: p.placeholder || 'Pick a time', big: cur ? fmt(cur) : '--:--', heading: p.label || 'Time',
      triggerAria: `${p.label || 'Time'}: ${cur ? fmt(cur) : 'not set'}`, hours, minutes, periods, presets,
      done: () => this.setState({ open: false }), icClock: dashIcon('clock', 16), icChev: dashIcon('chevronDown', 16),
    }
  }
  render() { return dc(this, TimePickerView, 'TimePicker') }
}
