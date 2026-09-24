// Workforce Analytics, ported from the Claude Design export
// (docs/Designs/UnifiedTree Workforce Analytics (offline).html). The container
// (modules/hrms/analytics/WorkforceAnalytics) loads the headcount, diversity and
// attrition reports and does the exports; this class turns them into the
// design's KPIs, charts and department table. Each chart shows only when the
// person may read its report.
import { createElement as h, useEffect, useRef, useState } from 'react'
import { DCLogic, dc } from './dc-runtime'
import { WorkforceAnalyticsView } from './WorkforceAnalytics.view'
import { HrButton, HrStatusPill } from '@/shared/components/hr'

const P = {
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  check: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM16 11l2 2 4-4',
  trend: 'M22 17l-8.5-8.5-5 5L2 7M16 17h6v-6',
  hourglass: 'M5 22h14M5 2h14M17 22v-4.17a2 2 0 0 0-.59-1.42L12 12l-4.41 4.41A2 2 0 0 0 7 17.83V22M7 2v4.17a2 2 0 0 0 .59 1.42L12 12l4.41-4.41A2 2 0 0 0 17 6.17V2',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  lock: 'M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2zM7 11V7a5 5 0 0 1 10 0v4',
  building: 'M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18ZM6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2M10 6h4M10 10h4M10 14h4M10 18h4',
  nodata: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3M8.5 8.5l5 5M13.5 8.5l-5 5',
}
const Ico = ({ d, size = 20 }: { d: string; size?: number }) => h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', style: { flexShrink: 0 } }, h('path', { d }))
const LockIcon = ({ size }: { size?: number }) => Ico({ d: P.lock, size }), CoIcon = ({ size }: { size?: number }) => Ico({ d: P.building, size }), NoDataIcon = ({ size }: { size?: number }) => Ico({ d: P.nodata, size })

export interface WaDept { id: string | null; dept: string; none: boolean; total: number; active: number; notice: number; probation: number }
/** Per department (by id; null = no department): people with each gender. */
export interface WaGender { women: number; men: number; other: number }
export interface WaMonth { m: string; label: string; short: string; exits: number; resign: number; term: number; other: number; headcount: number; pct: number }
export interface WaData {
  depts: WaDept[] | null
  gender: { total: WaGender; byDept: Map<string, WaGender> } | null
  months: WaMonth[] | null
  directory: number | null
}
export type ExportKind = 'pdf' | 'xlsx' | 'csv' | 'png-headcount' | 'png-attrition'

const num = (n: number) => Number(n).toLocaleString('en-IN')
const sortKey = (n: number) => String(Math.round(Number(n) * 10)).padStart(8, '0')
const pctOf = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0)
export const GENDER_SERIES: [string, keyof WaGender, string][] = [['Women', 'women', '#0f6e56'], ['Men', 'men', '#34d399'], ['Other or not specified', 'other', '#a7f3d0']]

/** The design's Export menu: PDF snapshot, Excel workbook, departments CSV. */
function ExportMenu({ busy, onPick, allow }: { busy: boolean; onPick: (k: ExportKind) => void; allow: { csv: boolean } }) {
  const [open, setOpen] = useState(false), ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const f = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', f); document.addEventListener('keydown', k)
    return () => { document.removeEventListener('pointerdown', f); document.removeEventListener('keydown', k) }
  }, [open])
  const item = (k: ExportKind, label: string, sub: string) => h('button', {
    type: 'button', role: 'menuitem', key: k, onClick: () => { setOpen(false); onPick(k) },
    style: { display: 'flex', flexDirection: 'column', gap: 1, width: '100%', textAlign: 'left', padding: '8px 11px', border: 0, background: 'transparent', borderRadius: 8, cursor: 'pointer', font: "600 13.5px 'Plus Jakarta Sans',sans-serif", color: '#0f172a' },
    onMouseEnter: (e: any) => (e.currentTarget.style.background = '#f0fdf4'), onMouseLeave: (e: any) => (e.currentTarget.style.background = 'transparent'),
  }, label, h('span', { style: { fontSize: 11.5, fontWeight: 500, color: '#64748b' } }, sub))
  return h('div', { ref, style: { position: 'relative' } },
    h(HrButton as any, { variant: 'ghost', disabled: busy, onClick: () => setOpen((o) => !o), 'aria-haspopup': 'menu', 'aria-expanded': open }, h(Ico, { d: busy ? P.hourglass : P.download, size: 16 }), busy ? 'Preparing…' : 'Export'),
    open && h('div', { role: 'menu', style: { position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 60, width: 260, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, boxShadow: '0 16px 40px -14px rgba(15,110,86,.3)', padding: 5 } },
      h('div', { style: { padding: '6px 11px 4px', fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: '#64748b' } }, 'Download'),
      item('pdf', 'Dashboard snapshot (PDF)', 'All charts on one page, print-ready'),
      item('xlsx', 'Data workbook (.xlsx)', 'One sheet per chart + departments'),
      allow.csv && item('csv', 'Departments (CSV)', 'The table below as raw rows')))
}

export class WorkforceAnalytics extends DCLogic {
  state = { hi: -1, seg: -1, mi: -1, exporting: false, toast: null as null | { msg: string; tone?: 'err' } }
  private tt: ReturnType<typeof setTimeout> | undefined
  componentWillUnmount() { clearTimeout(this.tt) }
  toast = (msg: string, tone?: 'err') => { this.setState({ toast: { msg, tone } }); clearTimeout(this.tt); this.tt = setTimeout(() => this.setState({ toast: null }), tone === 'err' ? 6000 : 3200) }
  run = async (k: ExportKind) => {
    if (this.state.exporting) return
    this.setState({ exporting: true })
    try { const msg = await this.props.onExport(k); if (msg) this.toast(msg) } catch (e) { this.toast(e instanceof Error && e.message ? e.message : 'Could not export the report', 'err') } finally { this.setState({ exporting: false }) }
  }

  renderVals() {
    const p = this.props, s = this.state, D: WaData | undefined = p.data
    const st: string = p.state || 'loading', mob = !!p.mobile
    const denied = st === 'denied', locked = !!p.locked, noCo = !p.company
    const loading = !denied && !noCo && st === 'loading'
    const error = !denied && !noCo && st === 'error'
    const empty = !denied && !noCo && st === 'empty'
    const ready = !denied && !noCo && st === 'live' && !!D
    const canHead = !!p.canHead, canDiv = !!p.canDiv, canAttr = !!p.canAttr
    const open = (r: string) => p.onOpen?.(r)
    const ico = (d: string) => h(Ico, { d })
    const out: any = {}
    const openDept = (r: WaDept) => p.onDept?.(r)

    const rows = D?.depts || [], months = D?.months || []
    const t = rows.reduce((a, r) => ({ total: a.total + r.total, active: a.active + r.active, notice: a.notice + r.notice, probation: a.probation + r.probation }), { total: 0, active: 0, notice: 0, probation: 0 })
    const last = months[months.length - 1]
    const dash = { value: '—', sub: ' ' }
    out.kpis = [
      { label: 'Total headcount', ...(ready && canHead ? { value: num(t.total), sub: D!.directory != null ? `${num(D!.directory)} in directory` : `${rows.filter((r) => !r.none).length} departments` } : dash), color: 'blue', icon: ico(P.users), open: canHead ? () => open('headcount') : undefined },
      { label: 'Active employees', ...(ready && canHead ? { value: num(t.active), sub: `${pctOf(t.active, t.total)}% of headcount` } : dash), color: 'green', icon: ico(P.check), open: canHead ? () => open('headcount') : undefined },
      { label: 'Attrition (latest month)', ...(ready && canAttr && last ? { value: last.pct.toFixed(1) + '%', sub: `${last.exits} ${last.exits === 1 ? 'exit' : 'exits'} · ${last.label}` } : dash), color: 'red', icon: ico(P.trend), open: canAttr ? () => open('attrition') : undefined },
      { label: 'On notice / probation', ...(ready && canHead ? { value: num(t.notice + t.probation), sub: `${t.notice} notice · ${t.probation} probation` } : dash), color: 'orange', icon: ico(P.hourglass), open: canHead ? () => open('headcount') : undefined },
    ].map((k) => ({ ...k, loading }))

    if (ready && canHead && rows.length) {
      const max = Math.max(...rows.map((r) => r.total), 1), raw = (max * 1.1) / 4
      const step = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000].find((x) => x >= raw) || Math.ceil(raw / 1000) * 1000, top = step * 4, q = (v: number) => v.toFixed(1)
      out.tk = { t1: num(step), t2: num(step * 2), t3: num(step * 3), t4: num(top) }
      out.bars = rows.map((r, i) => {
        const H = (r.total / top) * 216, seg = (v: number) => (v > 0 ? Math.max(3, (v / Math.max(1, r.total)) * H) : 0), hn = seg(r.notice), hp = seg(r.probation)
        const ha = Math.max(0, H - hn - hp - (hn ? 1 : 0) - (hp ? 1 : 0)), ya = H - ha, yn = ya - (hn ? 1 : 0) - hn, yp = Math.max(0, yn - (hp ? 1 : 0) - hp)
        return {
          label: r.dept, named: !r.none, none: r.none, top: num(r.total), tipSub: `${num(r.total)} employees · ${pctOf(r.total, t.total)}%`,
          hint: p.canDirectory ? (r.none ? 'Open this company’s directory' : `Open ${r.dept} in the directory`) : r.dept,
          H: q(H), ha: q(ha), hn: q(hn), hp: q(hp), ya: q(ya), yn: q(yn), yp: q(yp), va: num(r.active), vb: num(r.notice), vc: num(r.probation),
          hot: s.hi === i, enter: () => this.state.hi !== i && this.setState({ hi: i }), open: () => openDept(r),
        }
      })
      { const nd = rows.filter((r) => !r.none).length; out.deptCount = `${nd} ${nd === 1 ? 'dept' : 'depts'}` }
    } else { out.bars = []; out.tk = {}; out.deptCount = '' }

    const G = D?.gender
    if (ready && canDiv && G) {
      const tot = G.total.women + G.total.men + G.total.other, C = 2 * Math.PI * 70
      let acc = 0
      out.segs = GENDER_SERIES.map(([label, k, c], i) => {
        const len = tot ? (G.total[k] / tot) * C : 0
        const g = { label, c, count: num(G.total[k]), pct: `${pctOf(G.total[k], tot)}%`, da: `${len.toFixed(2)} ${(C - len).toFixed(2)}`, off: (-acc).toFixed(2), sw: s.seg === i ? 30 : 22, i0: i === 0, i1: i === 1, i2: i === 2, enter: () => this.state.seg !== i && this.setState({ seg: i }) }
        acc += len
        return g
      })
      const sg = out.segs[s.seg]
      out.center = sg ? { v: sg.pct, l: sg.label === 'Other or not specified' ? 'Other' : sg.label } : { v: num(tot), l: 'People' }
      out.peopleCount = `${num(tot)} people`
      const cand = rows.filter((r) => !r.none && r.id).map((r) => ({ r, g: G.byDept.get(r.id!) })).filter((x) => x.g && x.g.women + x.g.men > 0)
      const best = cand.sort((a, b) => Math.abs(50 - pctOf(a.g!.women, a.g!.women + a.g!.men + a.g!.other)) - Math.abs(50 - pctOf(b.g!.women, b.g!.women + b.g!.men + b.g!.other)))[0]
      out.balanced = best ? `${best.r.dept} · ${pctOf(best.g!.women, best.g!.women + best.g!.men + best.g!.other)}% women` : tot && G.total.other === tot ? 'No gender recorded yet' : 'Not enough data'
    } else { out.segs = []; out.center = { v: '—', l: 'People' }; out.peopleCount = ''; out.balanced = '—' }

    if (ready && canAttr && months.length) {
      const peak = Math.max(...months.map((x) => x.pct), 0), aStep = Math.max(1, Math.ceil((peak * 1.15) / 3)), aTop = aStep * 3
      out.ay = { a1: aStep + '%', a2: aStep * 2 + '%', a3: aTop + '%' }
      const pts = months.map((x, i) => [i * 100 + 50, 220 - (x.pct / aTop) * 220])
      out.vb = `0 0 ${months.length * 100} 220`
      out.lineD = pts.map((pt, i) => (i ? 'L' : 'M') + pt[0].toFixed(1) + ',' + pt[1].toFixed(1)).join(' ')
      out.areaD = `${out.lineD} L${pts[pts.length - 1][0]},220 L${pts[0][0]},220 Z`
      const mi = s.mi >= 0 && s.mi < months.length ? s.mi : months.length - 1
      out.months = months.map((x, i) => ({ short: x.short, x0: i * 100, cx: pts[i][0].toFixed(1), cy: pts[i][1].toFixed(1), r: i === mi ? 8 : 5, band: i === mi ? '#ecfdf5' : 'transparent', enter: () => this.state.mi !== i && this.setState({ mi: i }) }))
      const m = months[mi]
      const split = [m.resign && `${m.resign} resigned`, m.term && `${m.term} terminated`, m.other && `${m.other} other`].filter(Boolean).join(' · ') || 'none'
      out.ro = { label: m.label, pct: m.pct.toFixed(1) + '%', exits: m.exits, split, hc: num(m.headcount) }
      out.periodText = `${months[0].label} – ${last.label}`
    } else { out.months = []; out.ay = {}; out.ro = {}; out.vb = '0 0 100 220'; out.lineD = ''; out.areaD = ''; out.periodText = '' }

    if (ready && canHead) {
      const main = rows.filter((r) => !r.none), none = rows.find((r) => r.none)
      const women = (r: WaDept) => { const g = G && r.id ? G.byDept.get(r.id) : G && r.none ? G.byDept.get('') : undefined; return g && g.women + g.men + g.other ? `${pctOf(g.women, g.women + g.men + g.other)}%` : '—' }
      const pill = (v: number, tone: string) => (v ? h(HrStatusPill as any, { tone }, num(v)) : h('span', { style: { color: '#94a3b8' } }, '0'))
      const share = (r: { total: number }) => h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 8 } }, h('b', { style: { minWidth: 32 } }, `${pctOf(r.total, t.total)}%`), h('span', { style: { width: 64, height: 6, borderRadius: 4, background: '#f1f5f9', overflow: 'hidden', display: 'inline-block' } }, h('span', { style: { display: 'block', height: '100%', width: `${t.total ? (r.total / t.total) * 100 : 0}%`, background: '#0f6e56' } })))
      out.cols = [
        { key: 'dept', header: 'Department', sortable: true, render: (r: WaDept) => h('span', { style: { fontWeight: 700, color: '#0f6e56' } }, r.dept) },
        { key: 'sT', header: 'Total', sortable: true, render: (r: WaDept) => h('b', null, num(r.total)) },
        { key: 'sA', header: 'Active', sortable: true, render: (r: WaDept) => num(r.active) },
        { key: 'sN', header: 'On notice', sortable: true, render: (r: WaDept) => pill(r.notice, 'orange') },
        { key: 'sP', header: 'Probation', sortable: true, render: (r: WaDept) => pill(r.probation, 'blue') },
        ...(canDiv ? [{ key: 'sW', header: 'Women', sortable: true, render: (r: WaDept) => women(r) }] : []),
        { key: 'sT2', header: 'Share', sortable: true, render: share },
      ]
      out.tRows = main.map((r) => {
        const g = G && r.id ? G.byDept.get(r.id) : undefined
        return { ...r, id: r.id || r.dept, sT: sortKey(r.total), sA: sortKey(r.active), sN: sortKey(r.notice), sP: sortKey(r.probation), sW: sortKey(g && g.women + g.men + g.other ? (g.women / (g.women + g.men + g.other)) * 100 : -1), sT2: sortKey(r.total) }
      })
      const td = (c: any, x?: object) => h('td', { style: { padding: '16px 24px', ...x } }, c)
      out.tfoot = h('tfoot', null,
        none && h('tr', { onClick: () => openDept(none), style: { cursor: p.canDirectory ? 'pointer' : 'default', borderTop: '1px solid #f1f5f9' } }, td(h('span', { style: { fontStyle: 'italic', fontWeight: 600, color: '#64748b' } }, 'No department')), td(h('b', null, num(none.total))), td(num(none.active)), td(pill(none.notice, 'orange')), td(pill(none.probation, 'blue')), ...(canDiv ? [td(women(none))] : []), td(share(none))),
        h('tr', { style: { background: '#f8fafc', borderTop: '2px solid #e2e8f0' } }, ...['Total', num(t.total), num(t.active), num(t.notice), num(t.probation), ...(canDiv ? [G ? `${pctOf(G.total.women, G.total.women + G.total.men + G.total.other)}%` : '—'] : []), '100%'].map((v) => td(v, { fontWeight: 800, color: '#0f172a' }))))
      out.tTitle = h('div', null, h('div', { style: { fontSize: 15, fontWeight: 700, color: '#0f172a' } }, 'Departments'), h('div', { style: { fontSize: 12.5, color: '#64748b', marginTop: 2, fontWeight: 500 } }, p.canDirectory ? 'Click a department to open it in the Workforce Directory' : 'Headcount by department'))
      out.mRows = rows.map((r) => ({ dept: r.dept, named: !r.none, none: r.none, total: num(r.total), share: `${pctOf(r.total, t.total)}%`, active: num(r.active), np: `${r.notice} · ${r.probation}`, women: canDiv ? women(r) : '—', open: () => openDept(r) }))
    } else { out.cols = []; out.tRows = []; out.tfoot = null; out.tTitle = null; out.mRows = [] }

    return {
      ...out, allowed: !denied, denied, locked, noCo, ready, canHead, canDiv, canAttr,
      lockIcon: LockIcon, coIcon: CoIcon, noDataIcon: NoDataIcon,
      headerActions: !denied && ready ? h(ExportMenu, { busy: s.exporting, onPick: this.run, allow: { csv: canHead } }) : null,
      companies: p.companies || [], company: p.company || '', setCompany: (v: string) => { this.setState({ hi: -1, mi: -1, seg: -1 }); p.setCompany?.(v) },
      periods: p.periods || [], period: p.period, setPeriod: (v: string) => { this.setState({ hi: -1, mi: -1 }); p.setPeriod?.(v) },
      asOfText: p.asOf ? `Data as of ${p.asOf}` : '',
      vNoCo: !denied && noCo, vEmpty: empty, vError: error, vBody: loading || ready, vLoading: loading,
      errText: p.errText || 'Something went wrong while loading. Your filters are kept.',
      retry: () => p.onRetry?.(),
      skelBars: ['h-48 w-12 rounded-md', 'h-36 w-12 rounded-md', 'h-32 w-12 rounded-md', 'h-20 w-12 rounded-md', 'h-16 w-12 rounded-md', 'h-10 w-12 rounded-md'], skelRows: [1, 2, 3, 4],
      clearHi: () => this.state.hi !== -1 && this.setState({ hi: -1 }), clearSeg: () => this.state.seg !== -1 && this.setState({ seg: -1 }), clearMonth: () => this.state.mi !== -1 && this.setState({ mi: -1 }),
      dlHead: () => this.run('png-headcount'), dlAttr: () => this.run('png-attrition'),
      openHeadcount: () => open('headcount'), openDiversity: () => open('diversity'), openAttrition: () => open('attrition'), openDept,
      tableDesk: ready && canHead && !mob, tableMob: ready && canHead && mob,
      toastOn: !!s.toast && s.toast.tone !== 'err', toastErr: !!s.toast && s.toast.tone === 'err', toastMsg: s.toast ? s.toast.msg : '',
    }
  }
  render() { return dc(this, WorkforceAnalyticsView, 'WorkforceAnalytics') }
}
