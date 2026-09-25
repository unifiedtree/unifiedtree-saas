// Daily Logs — ported from the design component AttDailyLogs.dc.html.
// Rows come from GET /v1/attendance/dashboard?date= via the attendance container.
import { createElement } from 'react'
import { DCLogic, dc } from './dc-runtime'
import { AttDailyLogsView } from './AttDailyLogs.view'
import { HrAvatar, HrButton, HrStatusPill } from '@/shared/components/hr'
import { dashIcon, dashIconComponent } from './icons'
import { fmtShort } from './dates'

// Row statuses. The six tiles are the design's; HALF_DAY rows get their own
// label (the API has half days, the design's sample data didn't).
const LBL: Record<string, [string, string, string, string]> = {
  PRESENT: ['Came in', 'ok', 'green', 'userCheck'],
  LATE: ['Late', 'late', 'orange', 'clock'],
  WFH: ['From home', 'teal', 'teal', 'home'],
  ON_LEAVE: ['On leave', 'purple', 'purple', 'userMinus'],
  NOT_MARKED: ['Not marked', 'gray', 'blue', 'help'],
  ABSENT: ['Absent', 'red', 'red', 'userX'],
  HALF_DAY: ['Half day', 'late', 'orange', 'bulb'],
  EARLY_OUT: ['Left early', 'late', 'orange', 'clock'],
  // Effective statuses from the attendance policy (V143.10) that have no tile.
  HOLIDAY: ['Holiday', 'purple', 'purple', 'calendar'],
  WEEKLY_OFF: ['Weekly off', 'gray', 'blue', 'calendar'],
  NOT_TRACKED: ['Not tracked', 'gray', 'blue', 'help'],
}
const TILE_KEYS = ['PRESENT', 'LATE', 'WFH', 'ON_LEAVE', 'NOT_MARKED', 'ABSENT']
/** URL statuses (from the dashboard) → this page's status keys. */
const ALIAS: Record<string, string> = { WORK_FROM_HOME: 'WFH' }

export class AttDailyLogs extends DCLogic {
  state: any = { status: null, q: '', dept: '', open: null }
  renderVals() {
    const p = this.props
    const L = p.logs || { rows: [], departments: [], total: 0 }
    const st = p.state || 'live', mobile = !!p.mobile, nav = p.onNavigate || (() => {})
    const isLoading = st === 'loading', isError = st === 'error', isEmpty = st === 'empty'
    const status0 = this.state.status ?? (p.initialStatus || '')
    const status = ALIAS[status0] || status0
    const date: string = L.date || p.date
    const isToday = date === L.today
    const dateLabel = date ? fmtShort(date) : ''
    const base: any[] = (isEmpty || isLoading ? [] : L.rows || []).map((r: any) => (!isToday && r.status === 'NOT_MARKED' ? { ...r, status: 'ABSENT', src: 'No punch · no leave' } : r))
    const IN: Record<string, string[]> = { PRESENT: ['PRESENT', 'LATE', 'WFH', 'HALF_DAY'] }
    const inStatus = (r: any, k: string) => (k === 'EARLY_OUT' ? !!r.earlyOut : (IN[k] || [k]).includes(r.status))
    const counts: Record<string, number> = {}
    TILE_KEYS.forEach((k) => { counts[k] = base.filter((r) => inStatus(r, k)).length })
    const total = base.length
    const tiles = TILE_KEYS.map((k) => {
      const sel = status === k, n = isEmpty ? 0 : counts[k] || 0
      return {
        icon: dashIcon(LBL[k][3], 17), color: LBL[k][2], label: LBL[k][0], value: isLoading ? '—' : n,
        sub: sel ? 'Showing now · tap to clear' : 'Tap to see who', tip: sel ? 'Clears this filter' : `Shows only ${LBL[k][0].toLowerCase()}`,
        sel, unsel: !sel, onClick: () => this.setState({ status: sel ? '' : k }),
      }
    })
    const q = this.state.q.trim().toLowerCase(), dept = this.state.dept
    const rows = base
      .filter((r) => (!status || inStatus(r, status)) && (!dept || r.dept === dept) && (!q || `${r.name} ${r.code}`.toLowerCase().includes(q)))
      .map((r) => ({
        ...r, statusLabel: LBL[r.status] ? (LBL[r.status][0] === 'From home' ? 'Work from home' : LBL[r.status][0]) : r.status,
        tone: LBL[r.status] ? LBL[r.status][1] : 'gray', lateShort: r.late ? `${r.late} min late` : '', onOpen: () => this.setState({ open: r.id }),
      }))
    const cnt = isEmpty ? 0 : status ? base.filter((r) => inStatus(r, status)).length : total
    const statusWord = status && LBL[status] ? LBL[status][0].toLowerCase() : ''
    const resultLine = isLoading ? 'Loading this day’s roster…' : `Showing ${rows.length} of ${cnt}${status ? ' · ' + statusWord : ' people'}${dept ? ' in ' + dept : ''} · ${dateLabel}, IST`
    const cell = (v: any, extra?: any) => createElement('span', { style: Object.assign({ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }, extra || {}) }, v)
    const columns = [
      { key: 'name', header: 'Employee', render: (r: any) => createElement(HrAvatar, { name: r.name, sub: r.code } as any) },
      { key: 'dept', header: 'Department' },
      { key: 'shift', header: 'Shift', render: (r: any) => createElement('span', { style: { fontSize: 12, color: '#475569' } }, r.shift) },
      { key: 'status', header: 'Status', render: (r: any) => createElement(HrStatusPill, { tone: r.tone } as any, r.statusLabel) },
      { key: 'in', header: 'Check in', render: (r: any) => cell(r.in) },
      { key: 'late', header: 'Late by', render: (r: any) => (r.late ? cell(`${r.late} min`, { color: '#c2410c', fontWeight: 700 }) : cell('—', { color: '#94a3b8' })) },
      { key: 'out', header: 'Check out', render: (r: any) => cell(r.out) },
      { key: 'worked', header: 'Hours worked', render: (r: any) => cell(r.worked, { fontWeight: 600 }) },
    ]
    const d0 = base.find((r) => r.id === this.state.open)
    const d = d0
      ? {
        ...d0, sub: `${d0.code} · ${d0.dept}`, statusLabel: LBL[d0.status] ? LBL[d0.status][0] : d0.status, tone: LBL[d0.status] ? LBL[d0.status][1] : 'gray',
        isLate: d0.late > 0, lateLabel: `${d0.late} min late`,
        facts: [
          { k: 'Date', v: dateLabel }, { k: 'Shift', v: d0.shift }, { k: 'Check in', v: d0.in }, { k: 'Shift starts', v: d0.exp },
          { k: 'Check out', v: d0.out }, { k: 'Hours worked', v: d0.worked }, { k: 'How they punched', v: d0.src }, { k: 'Late by', v: d0.late ? `${d0.late} min` : '—' },
          // Why the day has this status (attendance policy or a reviewer's change).
          ...(d0.note ? [{ k: d0.manual ? 'Changed by a reviewer' : 'Why this status', v: d0.note }] : []),
        ],
      }
      : {}
    const drawerFooter = d0
      ? createElement('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between' } },
        createElement(HrButton, { onClick: () => nav('/hrms/employees/' + d0.id), 'data-tip': '→ /hrms/employees/' + d0.id } as any, 'Open full profile'),
        createElement('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 8 } },
          p.canRegularize ? createElement(HrButton, { variant: 'ghost', onClick: () => { this.setState({ open: null }); if (p.onRegularize) p.onRegularize(d0, date) }, 'data-tip': 'Opens a fix request for this day' } as any, 'Fix this day') : null,
          p.canOverride && p.onChangeStatus ? createElement(HrButton, { variant: 'ghost', onClick: () => { this.setState({ open: null }); p.onChangeStatus(d0, date) }, 'data-tip': 'Excuse the day or set Present, Late, Half day or Absent, with a reason' } as any, 'Change status') : null,
          createElement(HrButton, { variant: 'ghost', onClick: () => nav(`/hrms/employees/${d0.id}?tab=attendance`), 'data-tip': 'Opens this person’s attendance history' } as any, 'View history')))
      : null
    const setDay = (e: any) => { const v = (e && e.target ? e.target.value : e) || L.today; if (p.onDate) p.onDate(v) }
    return {
      tiles, resultLine, hasStatus: !!status, clearStatus: () => this.setState({ status: '' }),
      isError, notError: !isError, isLoading, rows, noRows: rows.length === 0, columns, showTable: !mobile, showCards: mobile && !isLoading,
      search: { value: this.state.q, onChange: (v: string) => this.setState({ q: v }), placeholder: 'Find a person or EMP code…' },
      filters: [{ key: 'dept', allLabel: 'All departments', value: dept, options: (L.departments || []).map((x: string) => ({ value: x, label: x })), onChange: (v: string) => this.setState({ dept: v }) }],
      clear: () => this.setState({ q: '', dept: '', status: '' }),
      setDay, dayValue: date, maxDay: L.today,
      open: (r: any) => this.setState({ open: r.id }),
      drawerOpen: !!d0, d, drawerFooter, close: () => this.setState({ open: null }),
      retry: { label: 'Try again', onClick: () => p.onRetry && p.onRetry() },
      errIcon: dashIconComponent('circleX'), icX: dashIcon('x', 13),
    }
  }
  render() { return dc(this, AttDailyLogsView, 'AttDailyLogs') }
}
