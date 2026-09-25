// Roster — ported from the design component ShiftRoster.dc.html. Assigning a
// shift uses the existing effective-date assignment (POST /v1/shifts/employee/{id}).
import { createElement } from 'react'
import { DCLogic, dc } from './dc-runtime'
import { ShiftRosterView } from './ShiftRoster.view'
import { HrButton } from '@/shared/components/hr'
import { dashIcon, dashIconComponent } from './icons'
import { tones as T, FALLBACK_TONE as FT, fmt, overnight, dayLabel } from './shift-util'
import { istToday, addDays } from './dates'

export class ShiftRoster extends DCLogic {
  state: any = { filter: null, q: '', open: null, busy: false, f: { shift: '', date: addDays(istToday(), 1), note: '' } }
  renderVals() {
    const p = this.props, st = p.state || 'live', mobile = !!p.mobile, canEdit = p.canEdit ?? true
    const shifts: any[] = p.shifts || [], roster: any[] = p.roster || [], byId: Record<string, any> = {}
    shifts.forEach((s) => { byId[s.id] = s })
    const noShift = roster.filter((r) => !byId[r.shift]).length
    const total = roster.length
    const chipList = [
      { key: 'all', label: 'Everyone', count: total, tip: 'Everyone on the roster' },
      ...shifts.map((s) => { const t = T[s.tone] || FT; return { key: s.id, label: s.name, count: s.people || 0, icon: dashIcon(t.icon, 14, { color: t.fg }), tip: `Only people on ${s.name}` } }),
      ...(noShift ? [{ key: 'none', label: 'No shift yet', count: noShift, urgent: true, tip: 'People who still need a shift' }] : []),
    ]
    const f0 = this.state.filter || p.initialFilter || 'all', filter = chipList.some((c) => c.key === f0) ? f0 : 'all'
    const chips = chipList.map((c) => ({ ...c, active: c.key === filter, onClick: () => this.setState({ filter: c.key }) }))
    const q = this.state.q.trim().toLowerCase()
    const tomorrow = addDays(istToday(), 1)
    const rows = (st === 'live' ? roster : [])
      .filter((r) => { const has = !!byId[r.shift]; return (filter === 'all' || (filter === 'none' ? !has : r.shift === filter)) && (!q || `${r.name} ${r.code} ${r.dept}`.toLowerCase().includes(q)) })
      .map((r) => {
        const s = byId[r.shift], t = s ? T[s.tone] || FT : FT
        return {
          ...r, hasShift: !!s, noShift: !s, shiftName: s ? s.name : '', range: s ? `${fmt(s.start)} – ${fmt(s.end)}` : '',
          iconEl: dashIcon(t.icon, 16, { color: t.fg }), tint: t.bg, edge: t.border, rowBg: s ? '#ffffff' : '#fffdf5',
          tip: s ? 'Opens Change shift' : 'Opens Assign shift',
          onChange: () => canEdit && this.setState({ open: r.id, f: { shift: '', date: tomorrow, note: '' } }),
        }
      })
    const fc = (chipList.find((c) => c.key === filter) || chipList[0]).count
    const emp0 = roster.find((r) => r.id === this.state.open), f = this.state.f, cur = emp0 && byId[emp0.shift]
    const opts = emp0
      ? shifts.map((s) => {
        const t = T[s.tone] || FT, isCur = !!cur && cur.id === s.id
        return {
          ...s, iconEl: dashIcon(t.icon, 18, { color: t.fg }), tint: t.bg, edge: t.border, bar: t.bar,
          range: `${fmt(s.start)} – ${fmt(s.end)}${overnight(s.start, s.end) ? ' (next day)' : ''}`,
          current: isCur, active: !isCur && f.shift === s.id, inactive: !isCur && f.shift !== s.id, onClick: () => this.setState({ f: { ...this.state.f, shift: s.id } }),
        }
      })
      : []
    const valid = !!(f.shift && f.date) && !this.state.busy, close = () => this.setState({ open: null })
    const save = async () => {
      if (!valid || !emp0 || !p.onAssign) return
      this.setState({ busy: true })
      // The note is kept with the assignment and shows in the person's shift history.
      try { const ok = await p.onAssign(emp0.id, f.shift, f.date, f.note); if (ok !== false) close() } finally { this.setState({ busy: false }) }
    }
    const drawerFooter = emp0
      ? createElement('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 8 } },
        createElement(HrButton, { variant: 'ghost', onClick: close } as any, 'Cancel'),
        createElement(HrButton, { onClick: save, disabled: !valid } as any, this.state.busy ? 'Saving…' : cur ? 'Save change' : 'Assign shift'))
      : null
    const pick = f.shift && byId[f.shift]
    return {
      chips, q: this.state.q, setQ: (e: any) => this.setState({ q: e.target.value }), isDesktop: !mobile, isMobile: mobile,
      isError: st === 'error', isLoading: st === 'loading', isEmpty: st === 'empty', showList: st === 'live', rows, noRows: st === 'live' && rows.length === 0,
      footLine: `Showing ${rows.length} of ${fc} ${fc === 1 ? 'person' : 'people'}`,
      drawerOpen: !!emp0, drawerTitle: emp0 ? (cur ? `Change shift · ${emp0.name}` : `Assign a shift · ${emp0.name}`) : '', close, drawerFooter, opts, f,
      emp: emp0
        ? { name: emp0.name, sub: `${emp0.code} · ${emp0.dept}`, nowText: cur ? `Right now: ${cur.name}, ${fmt(cur.start)} – ${fmt(cur.end)}${emp0.since ? ` (since ${emp0.since})` : ''}` : `Right now: no shift yet${emp0.since ? ' · ' + emp0.since : ''}` }
        : {},
      dateHelp: pick && emp0 ? `${emp0.name.split(' ')[0]} starts ${pick.name} on ${dayLabel(f.date)}.` : 'Pick a shift above first.',
      tomorrowMin: tomorrow,
      setDate: (e: any) => this.setState({ f: { ...f, date: e.target.value } }), setNote: (e: any) => this.setState({ f: { ...f, note: e.target.value } }),
      icSearch: dashIcon('search', 15), icSwap: dashIcon('swap', 14), icPlus: dashIcon('plus', 14), icAlert: dashIcon('alert', 14), icCheck: dashIcon('check', 13),
      sk: { style: { height: 420, width: '100%', borderRadius: 18 } }, emptyIcon: dashIconComponent('users'), retry: () => p.onRetry && p.onRetry(),
    }
  }
  render() { return dc(this, ShiftRosterView, 'ShiftRoster') }
}
