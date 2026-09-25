// Company Admin Dashboard — logic ported from the Claude Design prototype
// (HrmsPrototype.dc.html, dashboard section). The markup is generated
// (AdminDashboard.view.tsx); this class computes the same view model from
// real data supplied by AdminDashboardContainer instead of the prototype's
// sample data. Each section carries its own loading / empty / error state.
import { createElement, Fragment } from 'react'
import { DCLogic, dc } from './dc-runtime'
import { AdminDashboardView } from './AdminDashboard.view'
import { dashIcon } from './icons'
import { DashChart } from './chart'
import { HrAvatar, HrButton, HrStatusPill } from '@/shared/components/hr'
import { SkeletonBlock } from '@/shared/components/SkeletonCard'
import { dt, isoOf, fmtShort, fmtWd, WD } from './dates'

export type SectionKey =
  | 'live' | 'summary' | 'alerts' | 'trend' | 'today' | 'dept' | 'performers' | 'onboarding'
  | 'hiring' | 'projects' | 'payroll' | 'activity' | 'notices' | 'milestones' | 'probations'
export type SectionStatus = 'live' | 'loading' | 'empty' | 'error'

/** Round a chart's top up to a tidy value and return ticks from top to 0. */
function niceScale(max: number, steps = 4): { max: number; ticks: number[] } {
  if (!(max > 0)) return { max: steps, ticks: Array.from({ length: steps + 1 }, (_, i) => steps - i) }
  const raw = max / steps, mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || raw
  const top = step * steps
  return { max: top, ticks: Array.from({ length: steps + 1 }, (_, i) => top - i * step) }
}
const lakh = (n: number) => '₹' + (n / 100000).toLocaleString('en-IN', { maximumFractionDigits: 1 }) + 'L'

export class AdminDashboard extends DCLogic {
  state: any = { calOpen: false, noticeOpen: false, editingId: null, form: { title: '', body: '', expiry: '' }, saving: false }

  renderVals() {
    const p = this.props
    const D = p.data || {}
    const go = (path: string) => p.onNavigate && p.onNavigate(path)
    const ic = dashIcon
    const U = DashChart
    const secIn: Record<string, { state: SectionStatus; retry?: () => void }> = p.sec || {}
    const S = (k: SectionKey) => {
      const x = secIn[k] || { state: 'loading' as SectionStatus }
      return { state: x.state, retry: x.retry || (() => {}), isLive: x.state === 'live', notLive: x.state !== 'live', isLoading: x.state === 'loading', isEmpty: x.state === 'empty', isError: x.state === 'error', tilesOk: x.state !== 'error' }
    }
    const sec: Record<SectionKey, ReturnType<typeof S>> = {} as any
    ;(['live', 'summary', 'alerts', 'trend', 'today', 'dept', 'performers', 'onboarding', 'hiring', 'projects', 'payroll', 'activity', 'notices', 'milestones', 'probations'] as SectionKey[]).forEach((k) => { sec[k] = S(k) })

    const hasPayroll = !!p.hasPayroll, canHiring = !!p.canHiring, canBilling = !!p.canBilling
    const mobile = !!p.mobile, emerald = p.chartPalette === 'emerald'
    const today: string = D.today
    const sel: string = p.date || today
    const isToday = sel === today
    const inr = (n: any) => '₹' + Math.round(Number(n)).toLocaleString('en-IN')
    const daily: Record<string, any> = D.daily || {}
    const zero = { total: 0, present: 0, onLeave: 0, late: 0, halfDay: 0, wfh: 0, notMarked: 0, absent: 0, earlyOut: 0, regular: 0, other: 0 }
    const liveEmpty = sec.live.isEmpty, liveLoading = sec.live.isLoading
    const c = liveEmpty ? zero : D.counts || zero
    const s = D.summary || {}
    const TONE: Record<string, string> = { blue: '#3b82f6', green: '#10b981', orange: '#f97316', red: '#f43f5e', purple: '#8b5cf6', teal: '#14b8a6' }
    const tc = (col: string) => (emerald ? '#10b981' : TONE[col])
    const P = emerald
      ? { regular: '#0f6e56', late: '#10b981', absent: '#0a5240', leave: '#34d399', wfh: '#6ee7b7', half: '#a7f3d0', notMarked: '#94a3b8', other: '#e2e8f0', early: '#047857', dept: '#0f6e56', hire: ['#0a5240', '#0f6e56', '#10b981', '#6ee7b7'], pay: '#0f6e56', ring: '#10b981', act: {} as Record<string, string> }
      : { regular: '#10b981', late: '#f59e0b', absent: '#f43f5e', leave: '#8b5cf6', wfh: '#14b8a6', half: '#fb923c', notMarked: '#94a3b8', other: '#e2e8f0', early: '#eab308', dept: '#8b5cf6', hire: ['#1d4ed8', '#3b82f6', '#60a5fa', '#93c5fd'], pay: '#10b981', ring: '#3b82f6', act: { update: '#3b82f6', approve: '#10b981', regularize: '#f59e0b', payroll: '#8b5cf6', onboard: '#14b8a6' } as Record<string, string> }

    // 7-day window ending on the selected date (drives sparklines + trend chart)
    const win: any[] = []
    for (let i = 6; i >= 0; i--) {
      const x = dt(sel)
      x.setDate(x.getDate() - i)
      const k = isoOf(x)
      if (daily[k]) win.push({ iso: k, ...daily[k] })
    }
    const spark = (vals: number[], col: string, loading: boolean, empty: boolean) => {
      if (vals.length < 2 || loading || empty) return null
      const lo = Math.min(...vals), hi = Math.max(...vals), rg = hi - lo || 1
      const pts = vals.map((v, i) => [(i / (vals.length - 1)) * 100, 27 - ((v - lo) / rg) * 22])
      const line = U.smooth(pts, 30)
      return createElement('svg', { viewBox: '0 0 100 30', preserveAspectRatio: 'none', 'aria-hidden': 'true', style: { display: 'block', flex: '0 1 68px', minWidth: 0, width: 68, height: 26 } },
        createElement('path', { d: `${line} L100,30 L0,30 Z`, fill: tc(col), fillOpacity: 0.14 }),
        createElement('path', { d: line, fill: 'none', stroke: tc(col), strokeWidth: 2, vectorEffect: 'non-scaling-stroke', strokeLinecap: 'round', strokeLinejoin: 'round' }))
    }
    const ratio = (r: number, col: string, loading: boolean, empty: boolean) =>
      loading || empty || !isFinite(r)
        ? null
        : createElement('svg', { viewBox: '0 0 100 6', preserveAspectRatio: 'none', 'aria-hidden': 'true', style: { display: 'block', flex: '0 1 60px', minWidth: 0, width: 60, height: 6, borderRadius: 3 } },
          createElement('rect', { width: 100, height: 6, fill: '#f1f5f9' }),
          createElement('rect', { width: Math.max(0, Math.min(100, r * 100)), height: 6, fill: tc(col) }))
    const sub = (text: string, extra: any) => ({ text, extra })
    const att = (status: string) => `/hrms/attendance?tab=team&status=${status}&date=${sel}`
    const dayWord = isToday ? 'today' : `on ${fmtShort(sel).slice(0, -5)}`
    const T = c.total || 1, pct = (n: number) => Math.round((n / T) * 100)
    const skel = createElement(SkeletonBlock, { style: { height: 24, width: 56, borderRadius: 6, display: 'inline-block' } } as any)
    const tile = (icon: string, color: string, label: string, value: any, subNode: any, path: string, loading: boolean) => {
      const sn = subNode && typeof subNode === 'object' && 'text' in subNode ? subNode : { text: subNode, extra: null }
      return { icon: ic(icon, 17), color, label, value: loading ? skel : value, sub: loading ? 'Loading…' : sn.text, chart: loading ? null : sn.extra, tip: '→ ' + path, onClick: () => go(path) }
    }
    const liveTiles = [
      // With no roster in scope today (the attendance API scopes it to a non-HR role's own team), show the directory's active count rather than a contradicting 0.
      p.canReadEmployees && tile('users', 'blue', 'Total Employees', liveEmpty && s.active != null ? s.active : c.total, sub(liveEmpty || s.active == null ? 'Employee directory' : `${s.active} active · employee directory`, ratio((s.active ?? 0) / T, 'blue', liveLoading, liveEmpty || s.active == null)), '/hrms/employees', liveLoading),
      p.canReadTeam && tile('userCheck', 'green', 'Present', c.present, sub(`Checked in ${dayWord}`, spark(win.map((w) => w.present), 'green', liveLoading, liveEmpty)), att('PRESENT'), liveLoading),
      p.canReadTeam && tile('userMinus', 'orange', 'On Leave', c.onLeave, sub(`Approved leave ${dayWord} · ${pct(c.onLeave)}%`, ratio(c.onLeave / T, 'orange', liveLoading, liveEmpty)), att('ON_LEAVE'), liveLoading),
      p.canReadTeam && tile('alert', 'red', 'Late Arrivals', c.late, sub(liveEmpty || !c.late ? 'No one late' : 'Needs attention · see who', spark(win.map((w) => w.late), 'red', liveLoading, liveEmpty)), att('LATE'), liveLoading),
      p.canReadTeam && tile('bulb', 'purple', 'Half Day', c.halfDay, `${pct(c.halfDay)}% of roster`, att('HALF_DAY'), liveLoading),
      p.canReadTeam && tile('home', 'blue', 'Work From Home', c.wfh, `${pct(c.wfh)}% of roster`, att('WORK_FROM_HOME'), liveLoading),
      p.canReadTeam && tile('help', 'orange', 'Not Marked', c.notMarked, 'No punch recorded', att('NOT_MARKED'), liveLoading),
      p.canReadTeam && tile('userX', 'red', 'Absence', c.absent, 'Unplanned, no leave', att('ABSENT'), liveLoading),
    ].filter(Boolean)
    const sumLoading = sec.summary.isLoading, sumEmpty = sec.summary.isEmpty
    const payVals = (D.payroll || []).map((m: any) => m.gross)
    const complianceDue = Number(s.complianceDue || 0), complianceDone = Number(s.complianceDone || 0)
    const summaryTiles = [
      s.active != null && tile('users', 'green', 'Active employees', sumEmpty ? 0 : s.active, 'Excludes exited and on-notice', '/hrms/employees?status=ACTIVE', sumLoading),
      canHiring && s.openRoles != null && tile('briefcase', 'blue', 'Open roles', sumEmpty ? 0 : s.openRoles, sumEmpty || !s.openRoles ? 'No open requisitions' : s.pipeline != null ? `${s.pipeline} candidates in pipeline` : 'Open requisitions', '/hrms/hiring?status=OPEN', sumLoading),
      s.complianceDue != null && tile('shield', 'teal', 'Compliance completion', sumEmpty || !complianceDue ? 'No items due' : Math.round((complianceDone / complianceDue) * 100) + '%', sumEmpty || !complianceDue ? 'Nothing due this month through today' : sub(`${complianceDone} of ${complianceDue} obligations due this month through today completed`, ratio(complianceDone / complianceDue, 'teal', sumLoading, false)), '/hrms/compliance', sumLoading),
      hasPayroll && s.hasPayrollFigure && tile('rupee', 'purple', `Finalized payroll · ${s.payrollMonth || ''}`, sumEmpty || s.payrollGross == null ? 'Not finalized' : inr(s.payrollGross), sub('Gross amount from locked or paid payroll', spark(payVals, 'purple', sumLoading, sumEmpty)), '/hrms/payroll/runs', sumLoading),
    ].filter(Boolean)

    const pulse = (color: string) => createElement('span', { 'aria-hidden': 'true', style: { position: 'relative', display: 'inline-flex', width: 8, height: 8, flexShrink: 0 } },
      createElement('span', { style: { position: 'relative', width: 8, height: 8, borderRadius: 999, background: color, boxShadow: '0 0 0 3px ' + color + '33, 0 0 10px ' + color + '99' } }))
    const alerts = ((D.alerts || []) as any[]).filter((a) => a.count > 0).sort((a, b) => b.count - a.count).map((a) => {
      const lvl = a.count >= 5 ? 'high' : a.count >= 3 ? 'med' : 'low'
      return { ...a, isHigh: lvl === 'high', isMed: lvl === 'med', isLow: lvl === 'low', pulse: lvl === 'high' ? pulse('#e11d48') : null, tip: '→ ' + a.path, onClick: () => go(a.path) }
    })
    const alertTotal = alerts.reduce((n, a) => n + a.count, 0)
    const quickActions = ((p.quickActions || []) as any[]).map((q) => ({ label: q.label, icon: ic(q.icon, 16), tip: '→ ' + q.path, onClick: () => go(q.path) }))
    const se = D.seats || { used: 0, purchased: 0 }, remaining = se.purchased - se.used, rr = se.purchased ? remaining / se.purchased : 1
    const seats = {
      used: se.used, purchased: se.purchased, remaining,
      pct: se.purchased ? Math.round((se.used / se.purchased) * 100) : 0,
      tone: remaining <= 0 ? 'red' : rr <= 0.05 ? 'late' : rr <= 0.15 ? 'warn' : 'ok',
      status: remaining <= 0 ? 'Seats exhausted' : rr <= 0.05 ? 'Almost full' : rr <= 0.15 ? 'Running low' : 'Healthy',
    }

    // Charts
    const trendRows = win.map((w) => ({
      label: `${WD[dt(w.iso).getDay()]} ${dt(w.iso).getDate()}`, title: fmtWd(w.iso), iso: w.iso,
      values: [w.regular, w.late, w.absent], display: [String(w.regular), String(w.late), String(w.absent)],
      tip: 'Loads ' + fmtWd(w.iso) + ' into the dashboard',
    }))
    const trendScale = niceScale(Math.max(0, ...trendRows.flatMap((r) => r.values)))
    const trendSeries = [
      { label: 'Regular check-ins', short: ' regular', color: P.regular, area: true },
      { label: 'Late', short: ' late', color: P.late },
      { label: 'Absent', short: ' absent', color: P.absent, dashed: emerald },
    ]
    const todayCounts = ([
      ['Regular check-ins', c.regular, 'PRESENT', P.regular], ['Late arrivals', c.late, 'LATE', P.late], ['Absent', c.absent, 'ABSENT', P.absent], ['On leave', c.onLeave, 'ON_LEAVE', P.leave],
      ['Work from home', c.wfh, 'WORK_FROM_HOME', P.wfh], ['Not marked', c.notMarked, 'NOT_MARKED', P.notMarked], ['Half day', c.halfDay, 'HALF_DAY', P.half], ['Early departures', c.earlyOut, 'EARLY_OUT', P.early],
    ] as [string, number, string, string][]).map(([label, count, code, color]) => ({ label, count, color, fill: code === 'EARLY_OUT' ? '#ffffff' : color, tip: '→ ' + att(code), onClick: () => go(att(code)) }))
    let acc = 0
    const donut = ([[c.regular, P.regular], [c.late, P.late], [c.wfh, P.wfh], [c.halfDay, P.half], [c.onLeave, P.leave], [c.absent, P.absent], [c.notMarked, P.notMarked], [c.other, P.other]] as [number, string][])
      .filter(([v]) => v > 0)
      .map(([v, color]) => {
        const pc = (v / T) * 100, len = Math.max(pc - 0.8, 0.4)
        const seg = { color, dash: `${len.toFixed(2)} ${(100 - len).toFixed(2)}`, offset: (25 - acc).toFixed(2) }
        acc += pc
        return seg
      })
    const deptMax = Math.max(1, ...((D.departments || []) as any[]).map((d) => d.active))
    const departments = ((D.departments || []) as any[]).map((d) => ({
      ...d, pct: Math.round((d.active / deptMax) * 100),
      tip: '→ ' + `/hrms/employees?department=${encodeURIComponent(d.name)}`,
      onClick: () => go(d.id ? `/hrms/employees?departmentId=${encodeURIComponent(d.id)}` : '/hrms/employees'),
    }))
    const performers = ((D.performers || []) as any[]).map((x) => ({ ...x, meta: `${x.dept ? x.dept + ' · ' : ''}${x.reviews} completed reviews`, rating: Number(x.rating).toFixed(1) }))
    const onboarding = ((D.onboarding || []) as any[]).map((o) => {
      const pc = o.total ? Math.round((o.completed / o.total) * 100) : 0
      return {
        ...o, pct: pc, tasks: `${o.completed}/${o.total} tasks`, color: emerald ? '#10b981' : pc >= 75 ? '#10b981' : pc >= 40 ? '#3b82f6' : '#f59e0b',
        tone: 'info', statusLabel: o.statusLabel || 'In progress', tip: '→ ' + `/hrms/onboarding/instances/${o.id}`, onClick: () => go(`/hrms/onboarding/instances/${o.id}`),
      }
    })
    const h = D.hiring || { openJobs: 0, stages: [] }, sMax = Math.max(...h.stages.map((x: any) => x.count), 1)
    const hiring = {
      openJobs: h.openJobs, pipeline: h.stages.reduce((n: number, x: any) => n + x.count, 0),
      interviews: (h.stages.find((x: any) => x.stage === 'INTERVIEW') || {}).count || 0,
      stages: h.stages.map((x: any, i: number) => ({ ...x, pct: Math.round((x.count / sMax) * 100), color: P.hire[i] || P.hire[0], tip: '→ ' + `/hrms/hiring?tab=candidates&stage=${x.stage}`, onClick: () => go(`/hrms/hiring?tab=candidates&stage=${x.stage}`) })),
    }
    const pj = D.projects || {}
    const pr = (D.payroll || []) as any[]
    const payRows = pr.map((m) => ({ label: m.label, title: m.title || m.label, values: [m.gross], display: [inr(m.gross)], month: m.month, tip: '→ /hrms/payroll/runs?month=' + m.month }))
    const payVals2 = pr.map((m) => Number(m.gross) || 0)
    const payLo = payVals2.length ? Math.min(...payVals2) : 0, payHi = payVals2.length ? Math.max(...payVals2) : 0
    const payPad = Math.max((payHi - payLo) * 0.25, payHi * 0.04, 1)
    const payMin = Math.max(0, Math.floor((payLo - payPad) / 100000) * 100000), payMaxRaw = Math.ceil((payHi + payPad) / 100000) * 100000
    const payStep = Math.max(100000, Math.ceil((payMaxRaw - payMin) / 4 / 100000) * 100000), payMax = payMin + payStep * 4
    const payTicks = [4, 3, 2, 1, 0].map((i) => lakh(payMin + payStep * i))
    const activity = ((D.activity || []) as any[]).map((e) => ({ ...e, color: P.act[e.type] || '#10b981', tip: '→ ' + e.path, onClick: () => e.path && go(e.path) }))

    // Notices — saved and archived through the API (the container refetches).
    const noticeList = (D.notices || []) as any[]
    const notices = noticeList.map((nt) => ({
      ...nt,
      meta: `Published ${nt.published}` + (nt.until ? ` · Until ${nt.until}` : ''),
      onEdit: p.canManageNotices ? () => this.setState({ noticeOpen: true, editingId: nt.id, form: { title: nt.title, body: nt.body, expiry: nt.expiryIso || '' } }) : undefined,
      editTip: 'Opens the Edit notice form', archiveTip: 'Archives this notice',
      onArchive: p.canManageNotices ? () => p.onArchiveNotice && p.onArchiveNotice(nt.id) : undefined,
    }))
    const form = this.state.form
    const saveNotice = async () => {
      if (!form.title.trim() || !form.body.trim() || this.state.saving) return
      this.setState({ saving: true })
      try {
        const ok = p.onSaveNotice ? await p.onSaveNotice({ id: this.state.editingId, title: form.title.trim(), body: form.body.trim(), expiry: form.expiry || null }) : false
        if (ok !== false) this.setState({ noticeOpen: false, editingId: null, form: { title: '', body: '', expiry: '' } })
      } finally {
        this.setState({ saving: false })
      }
    }
    const ms = D.milestones || { birthdays: [], anniversaries: [], retirements: [] }
    const mcol = (title: string, icon: string, rows: any[], windowLabel: string, tone: string, filter: string) => ({
      title, icon: ic(icon, 15), count: rows.length, window: windowLabel, tone,
      viewTip: '→ /hrms/employees?filter=' + filter, onViewAll: () => go(`/hrms/employees?filter=${filter}`),
      rows: rows.map((r) => ({ ...r, tip: '→ ' + `/hrms/employees/${r.id}`, onClick: () => go(`/hrms/employees/${r.id}`) })),
    })
    const milestoneCols = [
      mcol('Birthdays', 'cake', ms.birthdays || [], 'Next 14 days', 'warn', 'birthday'),
      mcol('Work anniversaries', 'award', ms.anniversaries || [], 'Next 31 days', 'info', 'anniversary'),
      mcol('Retirements', 'star', ms.retirements || [], 'Next 6 months', 'ok', 'retirement'),
    ]
    const probations = (D.probations || []) as any[]
    const probationColumns = [
      { key: 'name', header: 'Employee', render: (r: any) => createElement(HrAvatar, { name: r.name, sub: `${r.code || ''}${r.code && r.title ? ' · ' : ''}${r.title || ''}` } as any) },
      { key: 'manager', header: 'Manager', render: (r: any) => r.manager || '—' },
      { key: 'end', header: 'Probation end', render: (r: any) => createElement('span', { style: { fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' } }, r.end) },
      { key: 'days', header: 'Days', render: (r: any) => createElement(HrStatusPill, { tone: r.days <= 3 ? 'red' : r.days <= 7 ? 'warn' : 'info' } as any, r.days < 0 ? `${-r.days}d overdue` : `${r.days}d left`) },
    ]
    const op = D.ops || {}, exceptions = c.late + c.absent + c.notMarked
    const ops = [
      { bigIcon: ic('clock', 84), eyebrow: liveEmpty ? 'No exceptions' : `${exceptions} exceptions ${dayWord}`, title: 'Attendance follow-up', body: "Review today's attendance exceptions and open the employee list behind each count.", cta: 'Review attendance', tip: '→ ' + `/hrms/attendance?tab=team&date=${sel}`, onClick: () => go(`/hrms/attendance?tab=team&date=${sel}`) },
      { bigIcon: ic('inbox', 84), eyebrow: !op.corrections ? 'Nothing waiting' : `${op.corrections} awaiting review`, title: 'Correction requests', body: 'Approve or reject regularization requests before the payroll cut-off.', cta: 'Review requests', tip: '→ /hrms/attendance?tab=corrections', onClick: () => go('/hrms/attendance?tab=corrections') },
      { bigIcon: ic('calendarPlus', 84), eyebrow: !op.leave ? 'Nothing waiting' : `${op.leave} awaiting review`, title: 'Leave approvals', body: 'Employees are waiting on a first-level decision for their leave.', cta: 'Open leave approvals', tip: '→ /hrms/leave?tab=approvals', onClick: () => go('/hrms/leave?tab=approvals') },
    ]

    const calOpen = this.state.calOpen
    const chip = createElement('button', {
      type: 'button', onClick: () => this.setState({ calOpen: !this.state.calOpen }), 'aria-haspopup': 'dialog', 'aria-expanded': calOpen, 'data-tip': 'Opens calendar · choose the dashboard date',
      style: { display: 'inline-flex', alignItems: 'center', gap: 8, height: 40, padding: '0 12px', fontSize: 13, fontWeight: 600, color: isToday ? '#334155' : '#0a5240', background: isToday ? '#fff' : '#ecfdf5', border: `1px solid ${isToday ? '#e2e8f0' : '#6ee7b7'}`, borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap', boxShadow: calOpen ? '0 0 0 3px #a7f3d0' : '0 1px 2px rgba(15,23,42,.04)' },
    }, ic('calendarDays', 15, { color: '#0f6e56' }), isToday ? D.todayLabel : `Viewing ${fmtWd(sel)}`, ic('chevronDown', 14, { color: '#64748b' }))
    const headerActions = createElement(Fragment, null, chip,
      p.canExport ? createElement(HrButton, { variant: 'ghost', disabled: !!p.exporting, 'data-tip': `Downloads headcount-${today}.csv`, onClick: () => p.onExportHeadcount && p.onExportHeadcount() } as any, ic('download', 15), p.exporting ? ' Preparing…' : ' Export headcount') : null,
      p.canAddEmployee ? createElement(HrButton, { 'data-tip': '→ /hrms/employees?add=1', onClick: () => go('/hrms/employees?add=1') } as any, ic('userPlus', 15), ' Add employee') : null)
    const trendSel = trendRows.findIndex((r) => r.iso === sel)
    const setDate = (iso: string | null) => p.onDate && p.onDate(iso)

    return {
      sec, hasPayroll, canBilling, canHiring,
      palette: emerald ? 'emerald' : 'tones',
      greeting: `${D.greetingWord || 'Good morning'}, ${D.firstName || 'there'} 👋`,
      headerActions,
      icClock: ic('clock', 16), icActivity: ic('activity', 16), icUsers: ic('users', 16), icBuilding: ic('building', 16), icBriefcase: ic('briefcase', 16), icRupee: ic('rupee', 16),
      icInbox: ic('inbox', 16), icMegaphone: ic('megaphone', 16), icCake: ic('cake', 16), icCalendarClock: ic('calendarClock', 16), icCalendarDays: ic('calendarDays', 18),
      icSeats: ic('armchair', 15), icPlus: ic('plus', 14), icArrow: ic('arrowRight', 14),
      calDesktop: calOpen && !mobile, calMobile: calOpen && mobile, closeCal: () => this.setState({ calOpen: false }),
      applyDate: (iso: string) => { this.setState({ calOpen: false }); setDate(iso === today ? null : iso) },
      openTracking: (iso: string) => { this.setState({ calOpen: false }); go(`/hrms/attendance?tab=team&date=${iso}`) },
      selIso: sel, todayIso: today, daily, holidays: D.holidays || [],
      isPastDate: !isToday && !sec.live.isError,
      selLong: fmtWd(sel),
      backToToday: () => setDate(null),
      liveChip: isToday ? 'Today · IST' : `${fmtShort(sel)} · IST`,
      todayTitle: isToday ? "Today's Attendance" : `Attendance · ${fmtShort(sel)}`,
      liveTiles, summaryTiles,
      alerts, alertTotal,
      urgentPulse: sec.alerts.isLive && alerts.some((a) => a.isHigh) ? pulse('#e11d48') : null,
      alertsList: sec.alerts.isLive && alerts.length > 0,
      alertsCaughtUp: (sec.alerts.isLive && alerts.length === 0) || sec.alerts.isEmpty,
      alertsBusy: sec.alerts.isLoading || sec.alerts.isError,
      icChevronRight: ic('chevronRight', 16), icCheck: ic('checkCircle', 18),
      quickActions,
      seats, seatsUsed: se.used, seatsPurchased: se.purchased, showSeats: !!p.canBilling && se.purchased > 0,
      skValue: { style: { height: 32, width: 96, borderRadius: 8 } },
      goBilling: () => go('/settings/billing'),
      goAttendance: () => go(`/hrms/attendance?tab=team&date=${sel}`),
      goEmployees: () => go('/hrms/employees'),
      goPerformance: () => go('/hrms/performance'),
      goOnboarding: () => go('/hrms/onboarding/instances'),
      goHiring: () => go('/hrms/hiring'),
      goOpenRoles: () => go('/hrms/hiring?status=OPEN'),
      goCandidates: () => go('/hrms/hiring?tab=candidates'),
      goInterviews: () => go('/hrms/hiring?tab=candidates&stage=INTERVIEW'),
      goProjects: () => go('/projects'),
      goPayroll: () => go('/hrms/payroll-dashboard'),
      goAudit: () => go('/audit-logs'),
      goProbationList: () => go('/hrms/employees?status=PROBATION'),
      zero: 0,
      rosterTotal: c.total, presentCount: c.present, otherCount: c.other || 0,
      donut, donutLabel: `${c.present} of ${c.total} present`,
      todayCounts, trendRows, trendSeries, trendMax: trendScale.max, trendTicks: trendScale.ticks.map(String), trendSel,
      trendPick: (i: number) => { const r = trendRows[i]; if (r) setDate(r.iso === today ? null : r.iso) },
      departments, deptColor: P.dept, performers, onboarding, hiring,
      projects: pj, ringColor: P.ring, ringDash: `${pj.completion || 0} ${100 - (pj.completion || 0)}`, ringLabel: `${pj.completion || 0}% of tasks completed`,
      payRows, paySeries: [{ label: 'Gross payroll', short: ' gross', color: P.pay, area: true }],
      payMin, payMax, payTicks, payLast: payRows.length - 1,
      payPick: (i: number) => { const r = payRows[i]; if (r) go(`/hrms/payroll/runs?month=${r.month}`) },
      activity, notices,
      noticeCountLabel: `${D.noticeTotal ?? notices.length} active ${(D.noticeTotal ?? notices.length) === 1 ? 'notice' : 'notices'} · 5 per page`,
      canManageNotices: !!p.canManageNotices,
      milestoneCols, probations, probationColumns, probationCount: probations.length,
      openEmployeeRow: (r: any) => go(`/hrms/employees/${r.id}`),
      ops,
      noticeOpen: this.state.noticeOpen,
      noticeModalTitle: this.state.editingId ? 'Edit notice' : 'New notice',
      setNoticeOpen: (o: boolean) => this.setState({ noticeOpen: !!o }),
      openNotice: () => this.setState({ noticeOpen: true, editingId: null, form: { title: '', body: '', expiry: '' } }),
      closeNotice: () => this.setState({ noticeOpen: false }),
      saveNotice,
      saveDisabled: !form.title.trim() || !form.body.trim() || this.state.saving,
      form, todayMin: today,
      setFormTitle: (e: any) => this.setState({ form: { ...form, title: e.target.value } }),
      setFormBody: (e: any) => this.setState({ form: { ...form, body: e.target.value } }),
      setFormExpiry: (e: any) => this.setState({ form: { ...form, expiry: e.target.value } }),
      probationTips: JSON.stringify(probations.map((r) => '→ /hrms/employees/' + r.id)),
      tips: {
        goBilling: '→ /settings/billing', goAttendance: '→ ' + `/hrms/attendance?tab=team&date=${sel}`, goEmployees: '→ /hrms/employees', goPerformance: '→ /hrms/performance',
        goOnboarding: '→ /hrms/onboarding/instances', goHiring: '→ /hrms/hiring', goOpenRoles: '→ /hrms/hiring?status=OPEN', goCandidates: '→ /hrms/hiring?tab=candidates',
        goInterviews: '→ /hrms/hiring?tab=candidates&stage=INTERVIEW', goProjects: '→ /projects', goPayroll: '→ /hrms/payroll-dashboard', goAudit: '→ /audit-logs',
        goProbationList: '→ /hrms/employees?status=PROBATION', openNotice: 'Opens the Add notice form', backToToday: "Back to today's data",
      },
    }
  }
  render() { return dc(this, AdminDashboardView, 'AdminDashboard') }
}
