// The report page pattern, on the redesign kit (P-REPORTS). One frame for every
// report: the page header with an Export menu, a filter bar (company, the
// report's own filters, "data as of"), the states (no permission, company list
// not allowed, no company, loading, error, no results, ready), the figures,
// chart sections, and a sortable table that turns into cards on a phone.
// Same section kinds as Workforce analytics (PgSetup r-wfa). Tokens only.
import { createElement as h, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { usePermission } from '@unifiedtree/sdk'
import {
  Button, Card, EmptyState, ErrorState, MiniStat, MiniStatGrid, PageFrame, PageHeader, Section, SkeletonChart, SkeletonStats, SkeletonTable, Table,
  type TableColumn, type TableSort,
} from '@/design/kit/display'
import { Pager } from '@/design/kit/data'
import { Input, Menu, Select, useToast } from '@/design/kit/overlays'
import { DateField } from '@/shared/components/calendar'
import { apiBlob } from '@/core/api/client'
import { saveAndRecord, saveServerFile, svgToPng, xlsxBlob, type ExportFilters, type ExportReportKey, type Sheet } from '@/shared/export/fileExport'
import { EXPORT_SPEC, type ReportKey } from './reportSpec'
import { slug, type useReportCompany } from './useReportCompany'
import './reports.css'

/** A plain card surface (kept for callers that still lay out their own blocks). */
export const SECTION: CSSProperties = {
  background: 'var(--u-sf,#fff)', border: '1px solid var(--u-ln,#E3E9E6)', borderRadius: 16, boxShadow: 'var(--u-shc,0 1px 2px rgba(14,27,22,.05))',
  padding: '16px 18px 14px', minWidth: 0, display: 'flex', flexDirection: 'column',
}
const PATH = {
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  hourglass: 'M5 22h14M5 2h14M17 22v-4.17a2 2 0 0 0-.59-1.42L12 12l-4.41 4.41A2 2 0 0 0 7 17.83V22M7 2v4.17a2 2 0 0 0 .59 1.42L12 12l4.41-4.41A2 2 0 0 0 17 6.17V2',
  lock: 'M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2zM7 11V7a5 5 0 0 1 10 0v4',
}
export const Ico = ({ d, size = 20, width = 2 }: { d: string; size?: number; width?: number }) => h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: width, strokeLinecap: 'round', strokeLinejoin: 'round', style: { flexShrink: 0 }, 'aria-hidden': true }, h('path', { d }))
export const num = (n: number) => Number(n || 0).toLocaleString('en-IN')
// Dates in the browser's own calendar (India for our users), never UTC: at 4 am
// IST, toISOString() still says yesterday.
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const isoDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
export const todayIso = () => isoDate(new Date())
export const monthStartIso = (monthsBack = 0) => { const d = new Date(); return isoDate(new Date(d.getFullYear(), d.getMonth() - monthsBack, 1)) }
/** "2026-09-25" → "25 Sep 2026" */
export const longDate = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return `${d} ${MON[m - 1]} ${y}` }
/** "2026-09-25" → "25 Sep" */
export const dayMonth = (iso: string) => { const [, m, d] = iso.split('-').map(Number); return `${d} ${MON[m - 1]}` }
export const pctOf = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0)
export const sortKey = (n: number) => String(Math.round(Number(n) * 10) + 1e8).padStart(10, '0')

/** The series colours the report charts use (tokens; the PNG export resolves them to their light value). */
export const SERIES_COLORS = { a: 'var(--u-br,#0F6E56)', b: 'var(--u-g2,#5FB39C)', c: 'var(--u-g3,#A9D6C6)', d: 'var(--u-brl,#BFDFD1)', e: 'var(--u-gy,#C9D2CE)' }

export type ReportState = 'loading' | 'error' | 'empty' | 'live'
export interface ReportExports {
  /** Base of every file name, without the extension. */
  fileBase: string
  /** Sheets for the Excel workbook (first row of each is its header). */
  sheets: () => Sheet[]
  /** Filters the server CSV and PDF exports take besides companyId (same as the on-screen query). */
  csvParams: Record<string, string>
}

/** The kit toast (success bottom centre 2.6 s, errors stay longer). `node` is kept for callers that still render it. */
export function useReportToast() {
  const toast = useToast()
  const show = (msg: string, err?: boolean) => { if (err) toast.error(msg); else toast.success(msg) }
  return { show, node: null as ReactNode }
}

/** The Export / Download menu (kit Menu). */
export function ExportMenu({ busy, items, label = 'Export', primary }: { busy: boolean; items: { key: string; label: string; sub: string; run: () => void }[]; label?: string; primary?: boolean }) {
  if (!items.length) return null
  return (
    <Menu label={label} width={290} header={{ title: 'Download' }}
      items={items.map((i) => ({ key: i.key, label: i.label, sub: i.sub, onSelect: i.run, disabled: busy }))}
      trigger={({ props }) => (
        <Button {...props} variant={primary ? 'primary' : 'secondary'} icon={busy ? <Ico d={PATH.hourglass} size={16} /> : 'download'} disabled={busy}>
          {busy ? 'Preparing…' : label}
        </Button>
      )} />
  )
}

/** A date filter on the shared calendar (its "Choose date" dialog), labelled for tests and screen readers. */
export function DateFilter({ label, value, onChange, min, max }: { label: string; value: string; onChange: (v: string) => void; min?: string; max?: string }) {
  return (
    <label className="rp-date">
      <span className="rp-date__label">{label}</span>
      <DateField value={value} min={min} max={max} onChange={(e) => e.target.value && onChange(e.target.value)} aria-label={label} size="sm" format="short" icon={false}
        style={{ flex: 1, minWidth: 0, width: 'auto', height: '100%', padding: 0, border: 0, borderRadius: 0, boxShadow: 'none', background: 'transparent', font: '500 13px var(--u-font)', color: 'var(--u-ink,#0E1B16)' }} />
    </label>
  )
}

/** The company picker every report page and Workforce analytics share (?co=). */
export function CompanyFilter({ co }: { co: ReturnType<typeof useReportCompany> }) {
  return (
    <div className="rp-filters__co">
      <Select aria-label="Company" value={co.company} options={co.options} placeholder={co.company ? undefined : 'Select company…'} size="md"
        disabled={co.locked} onChange={(e) => co.setCompany(e.target.value)} />
    </div>
  )
}

export function ReportPage({ title, subtitle, report, co, filters, note, state, errText, onRetry, exports, children, skeleton = 'bars' }: {
  title: string; subtitle: string; report: ReportKey; co: ReturnType<typeof useReportCompany>
  filters?: ReactNode; note?: string; state: ReportState; errText?: string; onRetry: () => void
  exports?: ReportExports; children?: ReactNode; skeleton?: 'bars' | 'line' | 'table'
}) {
  const spec = EXPORT_SPEC[report]
  const allowed = usePermission(spec.permission)
  const { show } = useReportToast()
  const [busy, setBusy] = useState(false)
  const noCo = !co.loading && !co.company
  const ready = allowed && !noCo && state === 'live'
  const loading = allowed && !noCo && (state === 'loading' || co.loading)
  const run = async (fn: () => Promise<string>) => {
    if (busy) return
    setBusy(true)
    try { show(await fn()) } catch (e) { show(e instanceof Error && e.message ? e.message : 'Could not export the report', true) } finally { setBusy(false) }
  }
  const items = !ready || !exports ? [] : [
    { key: 'pdf', label: 'Report snapshot (PDF)', sub: 'Figures, charts and table, made on the server', run: () => run(async () => {
      // apiBlob, not a link: the route needs the bearer token and tenant header.
      const blob = await apiBlob(`${spec.pdf}?${new URLSearchParams({ companyId: co.company, ...exports.csvParams })}`)
      const file = `${exports.fileBase}.pdf`
      saveServerFile(file, blob)
      return `${file} downloaded`
    }) },
    { key: 'xlsx', label: 'Data workbook (.xlsx)', sub: 'Summary and every row, ready for Excel', run: () => run(async () => {
      const file = `${exports.fileBase}.xlsx`
      saveAndRecord(file, xlsxBlob(exports.sheets()), { report, fmt: 'XLSX', companyId: co.company, filters: exports.csvParams })
      return `${file} downloaded`
    }) },
    { key: 'csv', label: 'Raw rows (CSV)', sub: 'Straight from the server, same filters', run: () => run(async () => {
      const blob = await apiBlob(`${spec.path}?${new URLSearchParams({ companyId: co.company, ...exports.csvParams })}`)
      const file = `${exports.fileBase}.csv`
      saveServerFile(file, blob)
      return `${file} downloaded`
    }) },
  ]

  if (!allowed) {
    return (
      <PageFrame label={title}>
        <PageHeader eyebrow="Reports & analytics" title={title} />
        <Card><EmptyState icon="lock" title="Access restricted" hint="You do not have the required permissions to view this report." /></Card>
      </PageFrame>
    )
  }
  return (
    <PageFrame label={title} className="rp-page">
      <PageHeader eyebrow="Reports & analytics" title={title} sub={subtitle} actions={<ExportMenu busy={busy} items={items} />} />
      <div className="rp-filters">
        <CompanyFilter co={co} />
        {filters}
        {note && <span className="rp-note">{note}</span>}
        {co.locked && <span className="rp-note" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Ico d={PATH.lock} size={14} />You can’t browse companies. Ask an admin for access.</span>}
      </div>
      {noCo && <Card><EmptyState icon="building" variant="dashed" title="Select a company" hint="Choose a company from the filter above to load this report." /></Card>}
      {!noCo && state === 'empty' && !loading && <Card><EmptyState icon="search" variant="dashed" title="No data for this period" hint="Try adjusting your filters or selecting a different date range." /></Card>}
      {!noCo && state === 'error' && !loading && (
        <Card><ErrorState title="Failed to load report" message={errText || 'Something went wrong while loading. Your filters are kept.'} onRetry={onRetry} /></Card>
      )}
      {loading && (
        <div role="status" aria-label="Loading report" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <SkeletonStats />
          {skeleton !== 'table' && <Card><SkeletonChart /></Card>}
          <Card><SkeletonTable /></Card>
        </div>
      )}
      {ready && children}
    </PageFrame>
  )
}

export interface Kpi { label: string; value: string; sub?: string; color: string; icon: string; onClick?: () => void }
export const KPI_ICON = {
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  check: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM16 11l2 2 4-4',
  trend: 'M22 17l-8.5-8.5-5 5L2 7M16 17h6v-6',
  hourglass: PATH.hourglass,
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
  calendar: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
  pie: 'M21.21 15.89A10 10 0 1 1 8 2.83M22 12A10 10 0 0 0 12 2v10z',
  alarm: 'M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM12 9v4l2 2M5 3 2 6M22 6l-3-3',
  timer: 'M10 2h4M12 14l3-3M12 22a8 8 0 1 0 0-16 8 8 0 0 0 0 16z',
}
const TONE: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'neutral'> = {
  green: 'success', orange: 'warning', red: 'danger', blue: 'info', purple: 'neutral', teal: 'neutral',
}
/** The report's figures: the design's "stats" section (MiniStat tiles with a status dot). */
export function KpiRow({ items, title = 'At a glance' }: { items: Kpi[]; title?: string }) {
  return (
    <Section title={title} rise>
      <MiniStatGrid>
        {items.map((k) => <MiniStat key={k.label} label={k.label} value={k.value} note={k.sub} tone={TONE[k.color] ?? 'neutral'} countUp={false} />)}
      </MiniStatGrid>
    </Section>
  )
}

/** A chart card: title, optional pill, legend, PNG download and a footer link. */
export function ReportSection({ title, pill, legend, onDownload, footer, flex, children, aside, sub }: {
  title: string; pill?: ReactNode; legend?: [string, string, ('bar' | 'line')?][]; onDownload?: () => void
  footer?: { label: string; onClick: () => void }; flex?: string; children: ReactNode; aside?: ReactNode; sub?: ReactNode
}) {
  const extra = (pill || aside || legend?.length || onDownload) ? (
    <span className="rp-head-extra">
      {pill}
      {aside}
      {legend?.map(([l, c, kind]) => (
        <span key={l} className="rp-legend"><span className={`rp-legend__sw${kind === 'line' ? ' rp-legend__sw--line' : ''}`} style={{ background: c }} />{l}</span>
      ))}
      {onDownload && <Button variant="secondary" size={32} icon="download" aria-label="Download chart as PNG" title="Download chart as PNG" onClick={onDownload} />}
    </span>
  ) : undefined
  return (
    <Section title={title} sub={sub} actions={extra} style={flex ? { flex } : undefined} rise
      footerLink={footer ? { label: footer.label, onClick: footer.onClick, arrow: true } : undefined}>
      {children}
    </Section>
  )
}

/** PNG of a standalone chart SVG, saved and recorded in the workspace's export log. */
export async function downloadChart(file: string, chart: { svg: string; width: number; height: number }, meta: { report: ExportReportKey; companyId?: string; filters?: ExportFilters }) {
  saveAndRecord(file, await svgToPng(chart.svg, chart.width, chart.height), { ...meta, fmt: 'PNG' })
  return `${file} downloaded`
}

// ── charts ──────────────────────────────────────────────────────────────────
export interface Bar { key: string; label: string; parts: number[]; none?: boolean; tip?: string; onClick?: () => void; hint?: string }

/** Stacked columns with gridlines, value labels and a hover card (Headcount by department). */
export function BarsChart({ bars, series, unit = 'employees', footnote }: { bars: Bar[]; series: [string, string][]; unit?: string; footnote?: string }) {
  const [hi, setHi] = useState(-1)
  const max = Math.max(1, ...bars.map((b) => b.parts.reduce((a, v) => a + v, 0)))
  const raw = (max * 1.1) / 4, step = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000].find((x) => x >= raw) || Math.ceil(raw / 1000) * 1000, top = step * 4
  const total = bars.reduce((a, b) => a + b.parts.reduce((x, v) => x + v, 0), 0)
  const colW = Math.max(320, bars.length * 64)
  return (
    <div className="rp-bars">
      <div style={{ minWidth: colW }}>
        <div className="rp-bars__plot" onMouseLeave={() => setHi(-1)}>
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className={`rp-bars__grid${i ? '' : ' rp-bars__grid--base'}`} style={{ bottom: `${i * 25}%` }}>
              <span className="rp-bars__tick">{num(step * i)}</span>
            </div>
          ))}
          <div className="rp-bars__cols">
            {bars.map((b, i) => {
              const sum = b.parts.reduce((a, v) => a + v, 0), H = (sum / top) * 216
              let y = H
              const rects = b.parts.map((v, j) => {
                if (!v) return null
                const hh = Math.max(3, (v / Math.max(1, sum)) * H) - (j ? 1 : 0)
                y -= hh + (j ? 1 : 0)
                return <rect key={j} x={0} y={Math.max(0, y)} width={44} height={hh} rx={j ? 2 : 4} style={{ fill: series[j][1] }} />
              })
              const body = (
                <>
                  <span className="rp-bars__val">{num(sum)}</span>
                  <svg width={44} height={H.toFixed(1)} aria-hidden="true" style={{ display: 'block', overflow: 'visible', flexShrink: 0 }}>{rects}</svg>
                  {hi === i && (
                    <span role="tooltip" className="rp-tip">
                      <span className="rp-tip__title" style={{ display: 'block' }}>{b.label}</span>
                      <span className="rp-tip__sub" style={{ display: 'block' }}>{b.tip || `${num(sum)} ${unit} · ${pctOf(sum, total)}%`}</span>
                      {series.map(([l, c], j) => (
                        <span key={l} className="rp-tip__row"><span className="rp-legend__sw" style={{ background: c }} /><span>{l}</span><b>{num(b.parts[j])}</b></span>
                      ))}
                      {footnote && b.onClick && <span className="rp-tip__foot" style={{ display: 'block' }}>{footnote}</span>}
                    </span>
                  )}
                </>
              )
              return b.onClick ? (
                <button key={b.key} type="button" onMouseEnter={() => setHi(i)} onFocus={() => setHi(i)} onBlur={() => setHi(-1)} onClick={b.onClick} title={b.hint}
                  className="rp-bars__col is-link ut-bar-col" aria-label={`${b.label}: ${num(sum)}${b.hint ? `. ${b.hint}` : ''}`}>{body}</button>
              ) : (
                <div key={b.key} onMouseEnter={() => setHi(i)} className="rp-bars__col" title={b.hint}>{body}</div>
              )
            })}
          </div>
        </div>
        <div className="rp-bars__labels">
          {bars.map((b) => <div key={b.key} className={`rp-bars__label${b.none ? ' is-none' : ''}`} title={b.label}>{b.label}</div>)}
        </div>
      </div>
    </div>
  )
}

export interface LinePoint { key: string; short: string; value: number }
/** A trend line with a highlighted point and a readout above it (Monthly attrition). */
export function TrendChart({ points, unit = '%', readout }: { points: LinePoint[]; unit?: string; readout: (i: number) => ReactNode }) {
  const [mi, setMi] = useState(-1)
  const cur = mi >= 0 && mi < points.length ? mi : points.length - 1
  const peak = Math.max(0, ...points.map((p) => p.value)), aStep = Math.max(1, Math.ceil((peak * 1.15) / 3)), aTop = aStep * 3
  const pts = points.map((p, i) => [i * 100 + 50, 220 - (p.value / aTop) * 220])
  const lineD = pts.map((pt, i) => `${i ? 'L' : 'M'}${pt[0].toFixed(1)},${pt[1].toFixed(1)}`).join(' ')
  const areaD = pts.length ? `${lineD} L${pts[pts.length - 1][0]},220 L${pts[0][0]},220 Z` : ''
  return (
    <>
      {points.length > 0 && <div className="rp-readout">{readout(cur)}</div>}
      <div className="rp-trend">
        <div style={{ minWidth: Math.max(320, points.length * 46) }}>
          <div className="rp-trend__plot" onMouseLeave={() => setMi(-1)}>
            <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className={`rp-bars__grid${i ? '' : ' rp-bars__grid--base'}`} style={{ bottom: `${(i * 100) / 3}%` }}>
                  <span className="rp-bars__tick">{`${(aStep * i).toFixed(0)}${unit}`}</span>
                </div>
              ))}
            </div>
            <svg viewBox={`0 0 ${Math.max(1, points.length) * 100} 220`} width="100%" role="img" aria-label="Trend" style={{ display: 'block', height: 'auto', overflow: 'visible' }}>
              {points.map((p, i) => <rect key={p.key} x={i * 100} y={0} width={100} height={220} style={{ fill: i === cur ? 'var(--u-brs,#E8F3EE)' : 'transparent', cursor: 'pointer' }} onMouseEnter={() => setMi(i)} onClick={() => setMi(i)} />)}
              <path d={areaD} style={{ fill: 'var(--u-g2,#5FB39C)', fillOpacity: 0.18 }} pointerEvents="none" />
              <path d={lineD} fill="none" style={{ stroke: 'var(--u-brt,#0F6E56)' }} strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" pointerEvents="none" />
              {pts.map((pt, i) => <circle key={i} cx={pt[0].toFixed(1)} cy={pt[1].toFixed(1)} r={i === cur ? 8 : 5} style={{ fill: 'var(--u-sf,#fff)', stroke: 'var(--u-brt,#0F6E56)' }} strokeWidth={3} pointerEvents="none" />)}
            </svg>
          </div>
          <div className="rp-trend__labels">
            {points.map((p) => <span key={p.key}>{p.short}</span>)}
          </div>
        </div>
      </div>
    </>
  )
}

/** A donut with a legend of counts and shares. */
export function DonutChart({ parts, centerLabel = 'People', footer }: { parts: { label: string; value: number; color: string }[]; centerLabel?: string; footer?: ReactNode }) {
  const [seg, setSeg] = useState(-1)
  const tot = parts.reduce((a, p) => a + p.value, 0), C = 2 * Math.PI * 70
  let acc = 0
  const segs = parts.map((p, i) => { const len = tot ? (p.value / tot) * C : 0; const g = { ...p, da: `${len.toFixed(2)} ${(C - len).toFixed(2)}`, off: (-acc).toFixed(2), sw: seg === i ? 30 : 22 }; acc += len; return g })
  const sg = segs[seg]
  return (
    <div className="rp-donut" onMouseLeave={() => setSeg(-1)}>
      <div className="rp-donut__ring">
        <svg width={180} height={180} viewBox="0 0 180 180" role="img" aria-label={parts.map((p) => `${p.label} ${p.value}`).join(', ')} style={{ display: 'block', transform: 'rotate(-90deg)' }}>
          <circle cx={90} cy={90} r={70} fill="none" style={{ stroke: 'var(--u-hv,#F0F4F2)' }} strokeWidth={22} />
          {segs.map((g, i) => <circle key={g.label} cx={90} cy={90} r={70} fill="none" style={{ stroke: g.color, cursor: 'pointer', transition: 'stroke-width .15s' }} strokeWidth={g.sw} strokeDasharray={g.da} strokeDashoffset={g.off} onMouseEnter={() => setSeg(i)} />)}
        </svg>
        <div className="rp-donut__center">
          <div className="rp-donut__value">{sg ? `${pctOf(sg.value, tot)}%` : num(tot)}</div>
          <div className="rp-donut__label">{sg ? sg.label : centerLabel}</div>
        </div>
      </div>
      <div className="rp-donut__rows">
        {segs.map((g, i) => (
          <div key={g.label} onMouseEnter={() => setSeg(i)} className="rp-donut__row">
            <span className="rp-legend__sw" style={{ background: g.color }} />
            <span>{g.label}</span><b style={{ fontWeight: 500 }}>{num(g.value)}</b>
            <span className="rp-donut__pct">{pctOf(g.value, tot)}%</span>
          </div>
        ))}
      </div>
      {footer}
    </div>
  )
}

// ── table ───────────────────────────────────────────────────────────────────
export interface Column<T> { key: string; header: string; sortable?: boolean; render: (r: T) => ReactNode }
type TotalRow = { __total: true; id: string }

/**
 * A sortable report table (kit Table) in a section with a title, an optional
 * search, the totals as the last row, cards on a phone and 25 rows a page when
 * long. Sorting reads the row's own value for the column key (pages pass
 * zero-padded sort keys for figures).
 */
export function ReportTable<T extends { id: string }>({ title, subtitle, columns, rows, footerCells, onRowClick, search, pageSize = 25 }: {
  title: string; subtitle?: string; columns: Column<T>[]; rows: T[]; footerCells?: ReactNode[]
  onRowClick?: (r: T) => void; search?: { placeholder: string; match: (r: T, q: string) => boolean }; pageSize?: number
}) {
  const [q, setQ] = useState('')
  const [page, setPage] = useState(0)
  const [sort, setSort] = useState<TableSort | null>(null)
  const filtered = useMemo(() => (search && q.trim() ? rows.filter((r) => search.match(r, q.trim().toLowerCase())) : rows), [rows, q, search])
  const sorted = useMemo(() => {
    if (!sort) return filtered
    const k = sort.key as keyof T
    return [...filtered].sort((a, b) => {
      const x = String(a[k] ?? ''), y = String(b[k] ?? '')
      return (x < y ? -1 : x > y ? 1 : 0) * (sort.dir === 'asc' ? 1 : -1)
    })
  }, [filtered, sort])
  const pages = Math.max(1, Math.ceil(sorted.length / pageSize)), cur = Math.min(page, pages - 1)
  const shown = sorted.length > pageSize ? sorted.slice(cur * pageSize, (cur + 1) * pageSize) : sorted
  useEffect(() => { setPage(0) }, [q, rows])
  const isTotal = (r: T | TotalRow): r is TotalRow => (r as TotalRow).__total === true
  const withTotal: (T | TotalRow)[] = footerCells && shown.length ? [...shown, { __total: true, id: '__total' }] : shown
  const cols: TableColumn<T | TotalRow>[] = columns.map((c, i) => ({
    key: c.key, header: c.header, label: c.header, sortable: c.sortable, primary: i === 0,
    render: (r) => (isTotal(r) ? (footerCells?.[i] ?? '') : c.render(r)),
  }))
  return (
    <Section title={title} sub={subtitle} body="flush" rise
      actions={search ? (
        <div className="rp-search"><Input aria-label={search.placeholder} placeholder={search.placeholder} value={q} onChange={(e) => setQ(e.target.value)} leading="search" size="md" /></div>
      ) : undefined}
      footer={sorted.length > pageSize ? <div className="rp-pager"><Pager page={cur} pageSize={pageSize} total={sorted.length} onPageChange={setPage} noun="rows" /></div> : undefined}>
      <Table<T | TotalRow> label={title} columns={cols} rows={withTotal} rowKey={(r) => r.id} mobile="cards" minWidth={560}
        sort={sort} onSort={setSort}
        onRowClick={onRowClick ? (r) => { if (!isTotal(r)) onRowClick(r) } : undefined}
        rowClassName={(r) => (isTotal(r) ? 'rp-total' : undefined)}
        empty={q ? `No rows match “${q}”.` : 'No rows.'} />
    </Section>
  )
}

export { slug }
