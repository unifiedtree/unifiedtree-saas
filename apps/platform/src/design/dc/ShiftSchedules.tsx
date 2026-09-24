// Shift Schedules — ported from the design component ShiftSchedules.dc.html.
// Shifts are the company's shift policies (GET/POST/PUT/DELETE /v1/shifts).
import { createElement } from 'react'
import { DCLogic, dc } from './dc-runtime'
import { ShiftSchedulesView } from './ShiftSchedules.view'
import { HrButton } from '@/shared/components/hr'
import { dashIcon, dashIconComponent } from './icons'
import { tones as T, FALLBACK_TONE as FT, fmt, span, overnight, dur, addMin } from './shift-util'

export class ShiftSchedules extends DCLogic {
  state: any = { drawer: null, f: null, confirm: null, blocked: null, busy: false }
  componentDidMount() { if (this.props.openAddKey) this.openNew() }
  componentDidUpdate(pp: any) { if (this.props.openAddKey && this.props.openAddKey !== pp.openAddKey) this.openNew() }
  openNew() { this.setState({ drawer: 'new', f: { name: '', start: '09:00', end: '17:00', grace: '15', breakMin: '60', tone: 'sun' }, confirm: null, blocked: null }) }
  renderVals() {
    const p = this.props, st = p.state || 'live', canEdit = p.canEdit ?? true
    const shifts: any[] = p.shifts || []
    const brk = (m: number) => (m ? (m === 60 ? '1 hour break' : `${m} min break`) : 'No break')
    const list = (st === 'live' ? shifts : []).map((s) => {
      const t = T[s.tone] || FT, on = overnight(s.start, s.end), ppl = s.people || 0
      return {
        ...s, iconEl: dashIcon(t.icon, 20, { color: t.fg }), tint: t.bg, edge: t.border, bar: t.bar,
        startLabel: fmt(s.start), endLabel: fmt(s.end), overnight: on, pillTone: on ? 'purple' : 'ok', pillLabel: on ? 'Overnight' : 'Day shift',
        peopleLabel: ppl === 1 ? '1 person' : `${ppl} people`, peopleTip: `→ Roster · ${s.name}`,
        hoursLabel: `${dur(span(s.start, s.end))} a day`, lateLabel: s.grace ? `Late after ${fmt(addMin(s.start, s.grace))}` : 'Late right at the start', breakLabel: brk(s.breakMin),
        blocked: this.state.blocked === s.id, confirming: this.state.confirm === s.id,
        blockText: ppl === 1 ? '1 person is on this shift.' : `${ppl} people are on this shift.`,
        onEdit: () => this.setState({ drawer: s.id, f: { name: s.name, start: s.start, end: s.end, grace: String(s.grace), breakMin: String(s.breakMin), tone: s.tone }, confirm: null, blocked: null }),
        onDelete: () => this.setState(ppl > 0 ? { blocked: s.id, confirm: null } : { confirm: s.id, blocked: null }),
        onPeople: () => p.onSeePeople && p.onSeePeople(s.id),
        doDelete: () => { this.setState({ confirm: null }); if (p.onDelete) p.onDelete(s.id) },
        cancel: () => this.setState({ confirm: null, blocked: null }),
      }
    })
    const nights = list.filter((s) => s.overnight).length, onShift = list.reduce((n, s) => n + (s.people || 0), 0), noShift = p.noShift || 0
    const f = this.state.f, isNew = this.state.drawer === 'new'
    const close = () => this.setState({ drawer: null, f: null }), setF = (o: any) => this.setState({ f: { ...this.state.f, ...o } })
    const valid = !!(f && f.name.trim() && f.start && f.end && f.start !== f.end) && !this.state.busy && canEdit
    const save = async () => {
      if (!valid || !p.onSave) return
      this.setState({ busy: true })
      try {
        const ok = await p.onSave({ id: isNew ? null : this.state.drawer, name: f.name.trim(), start: f.start, end: f.end, grace: Number(f.grace), breakMin: Number(f.breakMin), tone: f.tone })
        if (ok !== false) close()
      } finally { this.setState({ busy: false }) }
    }
    const tf = f ? T[f.tone] || FT : FT, ov = f ? overnight(f.start, f.end) : false
    const pv = f
      ? { range: `${fmt(f.start)} → ${fmt(f.end)}${ov ? ' (next day)' : ''}`, bar: tf.bar, line: `${dur(span(f.start, f.end))} a day${ov ? ' · goes past midnight' : ''}`, lateLine: `People who check in after ${fmt(Number(f.grace) ? addMin(f.start, Number(f.grace)) : f.start)} are marked late.` }
      : {}
    const drawerFooter = f
      ? createElement('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 8 } },
        createElement(HrButton, { variant: 'ghost', onClick: close } as any, 'Cancel'),
        createElement(HrButton, { onClick: save, disabled: !valid } as any, this.state.busy ? 'Saving…' : isNew ? 'Add shift' : 'Save changes'))
      : null
    return {
      isError: st === 'error', isLoading: st === 'loading', isEmpty: st === 'empty' || (st === 'live' && list.length === 0), hasList: st === 'live' && list.length > 0,
      list, skel: [1, 2, 3, 4], sk: { style: { height: 250, width: '100%', borderRadius: 18 } },
      countLabel: `${list.length} shift${list.length === 1 ? '' : 's'}`,
      nightLabel: nights ? (nights === 1 ? '1 goes past midnight' : `${nights} go past midnight`) : 'None past midnight',
      peopleLabel: `${onShift} ${onShift === 1 ? 'person' : 'people'} on a shift`, hasNoShift: noShift > 0, noShiftLabel: `${noShift} without a shift`,
      seeNoShift: () => p.onSeePeople && p.onSeePeople('none'),
      openAdd: () => this.openNew(), addAction: canEdit ? { label: 'Add a shift', onClick: () => this.openNew() } : undefined,
      drawerOpen: !!f, drawerTitle: isNew ? 'Add a shift' : `Edit ${(f && f.name) || 'shift'}`, closeDrawer: close, drawerFooter, f: f || {}, pv,
      sameTime: !!(f && f.start === f.end),
      toneOpts: Object.keys(T).map((k) => ({ key: k, label: T[k].label, icon: dashIcon(T[k].icon, 20, { color: T[k].fg }), active: !!f && f.tone === k, inactive: !f || f.tone !== k, onClick: () => setF({ tone: k }) })),
      setName: (e: any) => setF({ name: e.target.value }), setStart: (e: any) => setF({ start: e.target.value }),
      startPresets: ['06:00', '09:00', '14:00'], endPresets: ['14:00', '18:00', '22:00'],
      setEnd: (e: any) => setF({ end: e.target.value }), setGrace: (e: any) => setF({ grace: e.target.value }), setBreak: (e: any) => setF({ breakMin: e.target.value }),
      icClock: dashIcon('clock', 14), icMoon: dashIcon('moon', 14), icUsers: dashIcon('users', 14), icAlert: dashIcon('alert', 14), icTimer: dashIcon('timer', 14),
      icCoffee: dashIcon('coffee', 14), icArrow: dashIcon('arrowRight', 18), icPencil: dashIcon('pencil', 14), icTrash: dashIcon('trash', 14),
      icChevron: dashIcon('chevronRight', 15), icPlusBig: dashIcon('plus', 22), emptyIcon: dashIconComponent('calendarClock'), retry: () => p.onRetry && p.onRetry(),
    }
  }
  render() { return dc(this, ShiftSchedulesView, 'ShiftSchedules') }
}
