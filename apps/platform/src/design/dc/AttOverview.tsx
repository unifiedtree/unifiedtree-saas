// Attendance Analytics · Overview — ported from the design component
// AttOverview.dc.html. The prototype was fixed to 1–23 Sep 2026; this version
// draws the current month to date from real data.
import { createElement } from 'react'
import { DCLogic, dc } from './dc-runtime'
import { AttOverviewView } from './AttOverview.view'
import { HrAvatar, HrStatusPill } from '@/shared/components/hr'
import { dashIcon, dashIconComponent } from './icons'
import { dt, MON, WD, WDL } from './dates'

export class AttOverview extends DCLogic {
  state: any = { q: '' }
  renderVals() {
    const p = this.props, O = p.ov || { counts: {}, daily: {}, holidays: [], sources: [], lateMarks: [], summary: [] }
    const st = p.state || 'live', mobile = !!p.mobile, open = p.onOpenLogs || (() => {}), nav = p.onNavigate || (() => {})
    const c = O.counts || {}, total = c.total || 0
    const expected = (c.present || 0) + (c.absent || 0) + (c.notMarked || 0), rate = expected ? Math.round((c.present / expected) * 100) : 0
    const isLoading = st === 'loading'
    const dur = (m: number) => { const h = Math.floor(m / 60), mm = m % 60; return h && mm ? `${h}h ${String(mm).padStart(2, '0')}m` : h ? `${h}h` : `${mm}m` }
    const tile = (label: string, color: string, icon: string, value: any, sub: string, status: string) => ({
      icon: dashIcon(icon, 17), color, label, value: isLoading ? '—' : value, sub, tip: `→ /hrms/attendance?tab=team&status=${status}`, onClick: () => open(status),
    })
    const tiles = [
      tile('Came in', 'green', 'userCheck', c.present ?? 0, `${rate}% of people expected`, 'PRESENT'),
      tile('Late', 'orange', 'clock', c.late ?? 0, O.graceMin != null ? `After the ${O.graceMin}-min grace time` : 'After each shift’s grace time', 'LATE'),
      tile('On leave', 'purple', 'userMinus', c.onLeave ?? 0, `+ ${c.wfh ?? 0} working from home`, 'ON_LEAVE'),
      tile('Not marked', 'blue', 'help', c.notMarked ?? 0, `+ ${c.absent ?? 0} marked absent`, 'NOT_MARKED'),
    ]
    const MIX: [string, number, string, string][] = [
      ['On time', c.regular, '#10b981', ''], ['Late', c.late, '#f59e0b', 'LATE'], ['Half day', c.halfDay, '#84cc16', ''], ['Working from home', c.wfh, '#14b8a6', 'WFH'],
      ['On leave', c.onLeave, '#a855f7', 'ON_LEAVE'], ['Absent', c.absent, '#f43f5e', 'ABSENT'], ['Not marked yet', c.notMarked, '#64748b', 'NOT_MARKED'], ['Day off', c.other, '#cbd5e1', ''],
    ]
    const C = 2 * Math.PI * 64, T = total || 1
    let acc = 0
    const mix = MIX.map(([label, n0, color, status]) => {
      const n = n0 || 0, len = (n / T) * C
      const m = {
        label, n, color, pct: Math.round((n / T) * 100) + '%', dash: `${Math.max(0, len - 2).toFixed(2)} ${C.toFixed(2)}`, off: (-acc).toFixed(2), title: `${label}: ${n}`,
        canOpen: !!status, noOpen: !status, tip: status ? `→ /hrms/attendance?tab=team&status=${status}` : '', onClick: () => { if (status) open(status) },
      }
      acc += len
      return m
    })
    const srcTotal = (O.sources || []).reduce((n: number, s: any) => n + s.n, 0) || 1
    const sources = (O.sources || []).map((s: any) => ({ label: s.label, n: s.n, icon: dashIcon(s.icon, 17), pct: Math.round((s.n / srcTotal) * 100) + '%', w: ((s.n / srcTotal) * 100).toFixed(1) + '%' }))
    const hol: Record<string, string> = {}
    ;(O.holidays || []).forEach((h: any) => { hol[h.date] = h.name })
    const today: string = O.today, td = dt(today), y = td.getFullYear(), mo = td.getMonth(), N = td.getDate()
    const mon = MON[mo], f1 = (n: number) => Math.round(n * 10) / 10
    const W = mobile ? 340 : 720, H = 214, pl = 30, pr = 4, pt = 10, pb = 26, pw = W - pl - pr, ph = H - pt - pb, cw = pw / Math.max(N, 1), bw = Math.max(6, Math.min(20, cw * 0.62))
    let peak = 0
    for (let i = 1; i <= N; i++) { const r = (O.daily || {})[`${y}-${String(mo + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`] || {}; peak = Math.max(peak, (r.present || 0) + (r.absent || 0)) }
    const top = Math.max(10, Math.ceil(peak / 10) * 10), k = ph / top, base = pt + ph, days: any[] = []
    // Weekly offs come from the trend (a day nobody was scheduled), else the weekday pattern; Sunday when nothing is known.
    const offWd: number[] = O.offWeekdays || [0]
    const weeklyOff = (iso: string) => { const r = (O.daily || {})[iso]; return r && typeof r.weeklyOff === 'boolean' ? r.weeklyOff : offWd.includes(dt(iso).getDay()) }
    for (let i = 0; i < N; i++) {
      const day = i + 1, iso = `${y}-${String(mo + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`, r = (O.daily || {})[iso] || {}
      const wd = dt(iso).getDay(), off = weeklyOff(iso) || !!hol[iso], isToday = iso === today
      const onT = off ? 0 : Math.max(0, (r.present || 0) - (r.late || 0)), lt = off ? 0 : r.late || 0, ab = off ? 0 : r.absent || 0
      const x = pl + i * cw + (cw - bw) / 2, h1 = off ? 8 : onT * k, h2 = lt * k, h3 = ab * k, y1 = base - h1, y2 = y1 - h2 - (h2 ? 1.5 : 0), y3 = y2 - h3 - (h3 ? 1.5 : 0)
      days.push({
        x: f1(x), w: f1(bw), y1: f1(y1), h1: f1(h1), c1: off ? '#e2e8f0' : '#10b981', y2: f1(y2), h2: f1(h2), y3: f1(y3), h3: f1(h3), cx: f1(x + bw / 2), ly: H - 8,
        label: !mobile || day % 3 === 1 || isToday ? String(day) : '', lw: isToday ? 800 : 500, lc: isToday ? '#0f6e56' : '#94a3b8',
        hx: f1(pl + i * cw + 1), hy: pt - 6, hw: f1(cw - 2), hh: f1(ph + 10), hl: isToday ? '#ecfdf5' : 'rgba(255,255,255,0)',
        tip: off ? `${WD[wd]} ${day} ${mon} · ${hol[iso] || 'weekly off'}` : `${WD[wd]} ${day} ${mon}${isToday ? ' (today)' : ''} · ${onT} on time · ${lt} late · ${ab} absent — tap to open that day`,
        onClick: () => open('', iso),
      })
    }
    const grid = [0, top / 3, (2 * top) / 3, top].map((v0) => { const v = Math.round(v0); return { y: f1(base - v * k), x1: pl, x2: W - pr, tx: pl - 6, ty: f1(base - v * k + 3.5), label: String(v), dash: v ? '3 4' : 'none' } })
    const lm: any[] = O.lateMarks || [], lmMax = Math.max(1, ...lm.map((l) => l.n))
    const late = lm.map((l) => ({ ...l, times: l.n === 1 ? '1 time' : `${l.n} times`, w: ((l.n / lmMax) * 100).toFixed(1) + '%', tip: '→ /hrms/employees/' + l.id, onClick: () => l.id && nav('/hrms/employees/' + l.id) }))
    const q = this.state.q.trim().toLowerCase(), wdays = O.workingDays || 0
    const rows = (O.summary || [])
      .filter((r: any) => !q || `${r.name} ${r.dept} ${r.code}`.toLowerCase().includes(q))
      .map((r: any) => ({
        ...r, days: `${r.present} of ${wdays}`, dw: (wdays ? Math.min(100, (r.present / wdays) * 100) : 0).toFixed(1) + '%',
        lateTxt: r.late ? (r.late === 1 ? '1 time' : r.late + ' times') : 'Never', otTxt: r.ot ? dur(r.ot) : '—',
        tip: '→ /hrms/employees/' + r.id, onOpen: () => r.id && nav('/hrms/employees/' + r.id),
      }))
    const cell = (v: any, x?: any) => createElement('span', { style: Object.assign({ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }, x || {}) }, v)
    const meter = (r: any) => createElement('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 10 } },
      createElement('span', { style: { width: 72, height: 8, borderRadius: 999, background: '#f1f5f9', overflow: 'hidden', display: 'inline-block' } },
        createElement('span', { style: { display: 'block', height: '100%', width: r.dw, background: '#10b981', borderRadius: 999 } })),
      cell(r.days, { fontWeight: 600 }))
    const columns = [
      { key: 'name', header: 'Employee', render: (r: any) => createElement(HrAvatar, { name: r.name, sub: r.code } as any) },
      { key: 'dept', header: 'Department' },
      { key: 'present', header: 'Days present', render: meter },
      { key: 'late', header: 'Late', render: (r: any) => (r.late ? createElement(HrStatusPill, { tone: 'late' } as any, r.lateTxt) : cell('Never', { color: '#047857', fontWeight: 600 })) },
      { key: 'avg', header: 'Hours a day', render: (r: any) => cell(r.avg) },
      { key: 'ot', header: 'Overtime', render: (r: any) => cell(r.otTxt, r.ot ? { fontWeight: 700 } : { color: '#94a3b8' }) },
    ]
    const monthKey = `${y}-${String(mo + 1).padStart(2, '0')}`
    return {
      isError: st === 'error', isEmpty: st === 'empty', isLoading, isLive: st === 'live', isDesktop: !mobile, isMobile: mobile,
      tiles, total, mix, mixAria: `Today: ${mix.map((m) => `${m.n} ${m.label.toLowerCase()}`).join(', ')}`,
      sources, srcTotal, todayLabel: `${WDL[td.getDay()]}, ${N} ${mon}`, monthChip: `1–${N} ${mon} · ${wdays} working days`,
      legend: [{ label: 'On time', color: '#10b981' }, { label: 'Late', color: '#f59e0b' }, { label: 'Absent', color: '#f43f5e' }, { label: 'Day off', color: '#e2e8f0' }],
      tr: { vb: `0 0 ${W} ${H}`, days, grid, aria: `Daily attendance for 1 to ${N} ${mon}, stacked by on time, late and absent` },
      late, q: this.state.q, setQ: (e: any) => this.setState({ q: e.target.value }), rows, columns,
      rowTips: JSON.stringify(rows.map((r: any) => r.tip)), openRow: (r: any) => r.id && nav('/hrms/employees/' + r.id),
      footLine: `Showing ${rows.length} of ${(O.summary || []).length} people`,
      goReport: () => nav(O.reportLink || `/hrms/reports/attendance-summary?from=${monthKey}-01&to=${today}`),
      icSearch: dashIcon('search', 15), icChevron: dashIcon('chevronRight', 15), emptyIcon: dashIconComponent('chart'),
      skBig: { style: { height: 300, width: '100%', borderRadius: 18 } }, retry: () => p.onRetry && p.onRetry(),
    }
  }
  render() { return dc(this, AttOverviewView, 'AttOverview') }
}
