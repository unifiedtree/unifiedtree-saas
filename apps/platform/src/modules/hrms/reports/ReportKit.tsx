// The report page pattern, taken from the Workforce Analytics design export
// (docs/Designs/UnifiedTree Workforce Analytics (offline).html — its demo data
// is literally "for the Reports template"). One frame for every report: the
// page header with an Export menu, a filter bar (company, the report's own
// filters, "data as of"), the design's seven states (no permission, company
// list not allowed, no company, loading, error, no results, ready), KPI cards,
// chart sections, and a sortable table that turns into cards on a phone.
import { createElement as h, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { usePermission } from '@unifiedtree/sdk'
import { HrButton, HrPageHeader, HrSelect, HrStatCard, TableCard } from '@/shared/components/hr'
import { DateField } from '@/shared/components/calendar'
import { DataTable, type Column } from '@/shared/components/DataTable'
import { EmptyState } from '@/shared/components/EmptyState'
import { SkeletonBlock, SkeletonRow } from '@/shared/components/SkeletonCard'
import { HrPagination } from '@/shared/components/HrPagination'
import { apiBlob } from '@/core/api/client'
import { DesignFrame, useIsMobile } from '@/design/dc/DesignFrame'
import { saveAndRecord, saveServerFile, svgToPng, xlsxBlob, type ExportFilters, type ExportReportKey, type Sheet } from '@/shared/export/fileExport'
import { EXPORT_SPEC, type ReportKey } from './reportSpec'
import { slug, type useReportCompany } from './useReportCompany'

const FONT = "'Plus Jakarta Sans',sans-serif"
export const SECTION: CSSProperties = { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 16, boxShadow: '0 1px 2px rgba(15,23,42,.05)', padding: '16px 18px 14px', minWidth: 0, display: 'flex', flexDirection: 'column' }
const PATH = {
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  hourglass: 'M5 22h14M5 2h14M17 22v-4.17a2 2 0 0 0-.59-1.42L12 12l-4.41 4.41A2 2 0 0 0 7 17.83V22M7 2v4.17a2 2 0 0 0 .59 1.42L12 12l4.41-4.41A2 2 0 0 0 17 6.17V2',
  lock: 'M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2zM7 11V7a5 5 0 0 1 10 0v4',
  building: 'M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18ZM6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2M10 6h4M10 10h4M10 14h4M10 18h4',
  nodata: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3M8.5 8.5l5 5M13.5 8.5l-5 5',
  alert: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 8v4M12 16h.01',
  arrow: 'M5 12h14M12 5l7 7-7 7',
  check: 'M22 11.08V12a10 10 0 1 1-5.93-9.14M22 4 12 14.01l-3-3',
}
export const Ico = ({ d, size = 20, width = 2 }: { d: string; size?: number; width?: number }) => h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: width, strokeLinecap: 'round', strokeLinejoin: 'round', style: { flexShrink: 0 }, 'aria-hidden': true }, h('path', { d }))
const icon = (d: string) => ({ size }: { size?: number }) => Ico({ d, size })
const LockIcon = icon(PATH.lock), CoIcon = icon(PATH.building), NoDataIcon = icon(PATH.nodata)
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

export type ReportState = 'loading' | 'error' | 'empty' | 'live'
export interface ReportExports {
  /** Base of every file name, without the extension. */
  fileBase: string
  /** Sheets for the Excel workbook (first row of each is its header). */
  sheets: () => Sheet[]
  /** Filters the server CSV and PDF exports take besides companyId (same as the on-screen query). */
  csvParams: Record<string, string>
}

/** The design's dark toast, bottom centre. */
export function useReportToast() {
  const [toast, set] = useState<null | { msg: string; err?: boolean }>(null)
  const t = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => () => clearTimeout(t.current), [])
  const show = (msg: string, err?: boolean) => { clearTimeout(t.current); set({ msg, err }); t.current = setTimeout(() => set(null), err ? 6000 : 3200) }
  const node = toast ? (
    <div role={toast.err ? 'alert' : 'status'} style={{ position: 'fixed', left: '50%', bottom: 24, transform: 'translateX(-50%)', zIndex: 90, display: 'flex', alignItems: 'center', gap: 10, width: 'max-content', maxWidth: 'calc(100% - 32px)', padding: '11px 16px', borderRadius: 12, background: toast.err ? '#be123c' : '#0f172a', color: '#fff', fontSize: 13.5, fontWeight: 600, boxShadow: '0 18px 40px -14px rgba(15,23,42,.5)', boxSizing: 'border-box' }}>
      {!toast.err && <span style={{ color: '#6ee7b7', display: 'inline-flex' }}><Ico d={PATH.check} size={17} width={2.2} /></span>}{toast.msg}
    </div>
  ) : null
  return { show, node }
}

/** The design's Export menu. */
export function ExportMenu({ busy, items }: { busy: boolean; items: { key: string; label: string; sub: string; run: () => void }[] }) {
  const [open, setOpen] = useState(false), ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const f = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', f); document.addEventListener('keydown', k)
    return () => { document.removeEventListener('pointerdown', f); document.removeEventListener('keydown', k) }
  }, [open])
  if (!items.length) return null
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <HrButton variant="ghost" disabled={busy} onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}>
        <Ico d={busy ? PATH.hourglass : PATH.download} size={16} />{busy ? 'Preparing…' : 'Export'}
      </HrButton>
      {open && (
        <div role="menu" style={{ position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 60, width: 260, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, boxShadow: '0 16px 40px -14px rgba(15,110,86,.3)', padding: 5 }}>
          <div style={{ padding: '6px 11px 4px', fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: '#64748b' }}>Download</div>
          {items.map((i) => (
            <button key={i.key} type="button" role="menuitem" onClick={() => { setOpen(false); i.run() }} className="ut-menu-item"
              style={{ display: 'flex', flexDirection: 'column', gap: 1, width: '100%', textAlign: 'left', padding: '8px 11px', border: 0, background: 'transparent', borderRadius: 8, cursor: 'pointer', font: `600 13.5px ${FONT}`, color: '#0f172a' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#f0fdf4')} onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
              {i.label}<span style={{ fontSize: 11.5, fontWeight: 500, color: '#64748b' }}>{i.sub}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** A date filter styled like the design's small selects. */
export function DateFilter({ label, value, onChange, min, max }: { label: string; value: string; onChange: (v: string) => void; min?: string; max?: string }) {
  return (
    <label style={{ flex: '0 1 170px', minWidth: 0, display: 'flex', alignItems: 'center', gap: 6, height: 34, padding: '0 10px', border: '1px solid #e2e8f0', borderRadius: 10, background: '#fff', boxSizing: 'border-box' }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: '#64748b', whiteSpace: 'nowrap' }}>{label}</span>
      <DateField value={value} min={min} max={max} onChange={(e) => e.target.value && onChange(e.target.value)} aria-label={label} size="sm" format="short" icon={false}
        style={{ flex: 1, minWidth: 0, width: 'auto', height: '100%', padding: 0, border: 0, borderRadius: 0, boxShadow: 'none', background: 'transparent', font: `600 13px ${FONT}`, color: '#0f172a' }} />
    </label>
  )
}

export function ReportPage({ title, subtitle, report, co, filters, note, state, errText, onRetry, exports, children, skeleton = 'bars' }: {
  title: string; subtitle: string; report: ReportKey; co: ReturnType<typeof useReportCompany>
  filters?: ReactNode; note?: string; state: ReportState; errText?: string; onRetry: () => void
  exports?: ReportExports; children?: ReactNode; skeleton?: 'bars' | 'line' | 'table'
}) {
  const spec = EXPORT_SPEC[report]
  const allowed = usePermission(spec.permission)
  const { show, node: toastNode } = useReportToast()
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
    { key: 'pdf', label: 'Report snapshot (PDF)', sub: 'KPIs, charts and table, made on the server', run: () => run(async () => {
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

  return (
    <DesignFrame>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, fontFamily: FONT, color: '#0f172a', minWidth: 0, fontVariantNumeric: 'tabular-nums' }}>
        {allowed && <HrPageHeader crumb="Reports & Analytics" title={title} subtitle={subtitle} actions={<ExportMenu busy={busy} items={items} />} className="!mb-0" />}
        {!allowed && <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 16 }}><EmptyState icon={LockIcon as any} title="Access restricted" description="You do not have the required permissions to view this report." /></div>}
        {allowed && (
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
            <div style={{ position: 'relative', flex: '0 1 250px', minWidth: 0 }}>
              {noCo && <span aria-hidden="true" style={{ position: 'absolute', inset: 0, borderRadius: 10, boxShadow: '0 0 0 3px rgba(15,110,86,.25)', pointerEvents: 'none', zIndex: 1 }} />}
              <HrSelect value={co.company} options={co.options} onChange={co.setCompany} placeholder="Select company…" size="sm" disabled={co.locked} />
            </div>
            {filters}
            {note && <span style={{ fontSize: 12.5, color: '#64748b', fontWeight: 500 }}>{note}</span>}
            {co.locked && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: '#64748b', fontWeight: 500 }}><Ico d={PATH.lock} size={14} />You can’t browse companies. Ask an admin for access.</span>}
          </div>
        )}
        {allowed && noCo && <div style={{ background: '#fff', border: '1.5px dashed #cbd5e1', borderRadius: 16 }}><EmptyState icon={CoIcon as any} title="Select a company" description="Choose a company from the filter above to load this report." /></div>}
        {allowed && !noCo && state === 'empty' && !loading && <div style={{ background: '#fff', border: '1.5px dashed #cbd5e1', borderRadius: 16 }}><EmptyState icon={NoDataIcon as any} title="No data for this period" description="Try adjusting your filters or selecting a different date range." /></div>}
        {allowed && !noCo && state === 'error' && !loading && (
          <div role="alert" style={{ background: '#fff', border: '1px solid #fecdd3', borderRadius: 16, padding: '18px 20px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px 16px' }}>
            <span style={{ width: 42, height: 42, borderRadius: 12, background: '#fff1f2', border: '1px solid #fecdd3', color: '#e11d48', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Ico d={PATH.alert} size={20} width={2.2} /></span>
            <div style={{ flex: '1 1 240px', minWidth: 0 }}><div style={{ fontSize: 15, fontWeight: 700 }}>Failed to load report</div><div style={{ fontSize: 13, color: '#64748b', marginTop: 2, lineHeight: 1.5 }}>{errText || 'Something went wrong while loading. Your filters are kept.'}</div></div>
            <HrButton variant="ghost" onClick={onRetry}>Retry</HrButton>
          </div>
        )}
        {loading && <ReportSkeleton kind={skeleton} />}
        {ready && children}
      </div>
      {toastNode}
    </DesignFrame>
  )
}

function ReportSkeleton({ kind }: { kind: 'bars' | 'line' | 'table' }) {
  return (
    <div role="status" aria-label="Loading report" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12 }}>
        {[0, 1, 2, 3].map((i) => <HrStatCard key={i} icon={<Ico d={PATH.hourglass} />} color="green" value="—" label="Loading" loading />)}
      </div>
      {kind !== 'table' && (
        <section style={SECTION}>
          <SkeletonBlock className="mb-4 h-4 w-48" />
          {kind === 'bars'
            ? <div style={{ height: 236, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-around', gap: 16, padding: '0 12px 0 40px', borderBottom: '1px solid #f1f5f9' }}>{['h-48', 'h-36', 'h-32', 'h-20', 'h-16', 'h-10'].map((c) => <SkeletonBlock key={c} className={`${c} w-12 rounded-md`} />)}</div>
            : <SkeletonBlock className="h-48 w-full rounded-lg" />}
        </section>
      )}
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 16, padding: '8px 20px' }}>{[1, 2, 3, 4].map((x) => <SkeletonRow key={x} />)}</div>
    </div>
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
export function KpiRow({ items }: { items: Kpi[] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12 }}>
      {items.map((k) => <HrStatCard key={k.label} icon={<Ico d={k.icon} />} color={k.color as any} value={k.value} label={k.label} sub={k.sub} onClick={k.onClick} />)}
    </div>
  )
}

/** A chart card: title, optional pill, legend, PNG download and a footer link. */
export function ReportSection({ title, pill, legend, onDownload, footer, flex, children, aside }: {
  title: string; pill?: ReactNode; legend?: [string, string, ('bar' | 'line')?][]; onDownload?: () => void
  footer?: { label: string; onClick: () => void }; flex?: string; children: ReactNode; aside?: ReactNode
}) {
  return (
    <section style={{ ...SECTION, ...(flex ? { flex } : {}) }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 12px', marginBottom: 14 }}>
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{title}</h2>
        {pill}
        {aside}
        <span style={{ flex: 1 }} />
        {legend?.map(([l, c, kind]) => (
          <span key={l} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#334155', fontWeight: 600 }}>
            <span style={kind === 'line' ? { width: 14, height: 3, borderRadius: 2, background: c } : { width: 10, height: 10, borderRadius: 3, background: c }} />{l}
          </span>
        ))}
        {onDownload && (
          <button type="button" onClick={onDownload} title="Download chart as PNG" aria-label="Download chart as PNG" className="ut-dl-btn"
            style={{ width: 30, height: 30, borderRadius: 8, border: '1px solid #e2e8f0', background: '#fff', color: '#475569', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
            <Ico d={PATH.download} size={15} />
          </button>
        )}
      </div>
      {children}
      {footer && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'auto', paddingTop: 10 }}>
          <button type="button" onClick={footer.onClick} className="ut-link-btn" style={{ border: 0, background: 'transparent', padding: '4px 2px', font: `700 12.5px ${FONT}`, color: '#0f6e56', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            {footer.label}<Ico d={PATH.arrow} size={14} width={2.4} />
          </button>
        </div>
      )}
    </section>
  )
}

/** PNG of a standalone chart SVG, saved and recorded in the workspace's export log. */
export async function downloadChart(file: string, chart: { svg: string; width: number; height: number }, meta: { report: ExportReportKey; companyId?: string; filters?: ExportFilters }) {
  saveAndRecord(file, await svgToPng(chart.svg, chart.width, chart.height), { ...meta, fmt: 'PNG' })
  return `${file} downloaded`
}

// ── charts (the design's markup, as components) ──────────────────────────────
export interface Bar { key: string; label: string; parts: number[]; none?: boolean; tip?: string; onClick?: () => void; hint?: string }

/** Stacked columns with gridlines, value labels and a hover card (Headcount by department). */
export function BarsChart({ bars, series, unit = 'employees', footnote }: { bars: Bar[]; series: [string, string][]; unit?: string; footnote?: string }) {
  const [hi, setHi] = useState(-1)
  const max = Math.max(1, ...bars.map((b) => b.parts.reduce((a, v) => a + v, 0)))
  const raw = (max * 1.1) / 4, step = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000].find((x) => x >= raw) || Math.ceil(raw / 1000) * 1000, top = step * 4
  const total = bars.reduce((a, b) => a + b.parts.reduce((x, v) => x + v, 0), 0)
  const colW = Math.max(480, bars.length * 64)
  return (
    <div style={{ overflowX: 'auto', paddingTop: 4 }}>
      <div style={{ minWidth: colW }}>
        <div style={{ position: 'relative', height: 216, marginLeft: 34 }} onMouseLeave={() => setHi(-1)}>
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} style={{ position: 'absolute', left: 0, right: 0, bottom: `${i * 25}%`, height: 0, borderTop: i ? '1px dashed #e2e8f0' : '1px solid #e2e8f0' }}>
              <span style={{ position: 'absolute', right: 'calc(100% + 8px)', top: -8, fontSize: 11, color: '#94a3b8', fontWeight: 600 }}>{num(step * i)}</span>
            </div>
          ))}
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'stretch' }}>
            {bars.map((b, i) => {
              const sum = b.parts.reduce((a, v) => a + v, 0), H = (sum / top) * 216
              let y = H
              const rects = b.parts.map((v, j) => {
                if (!v) return null
                const hh = Math.max(3, (v / Math.max(1, sum)) * H) - (j ? 1 : 0)
                y -= hh + (j ? 1 : 0)
                return <rect key={j} x={0} y={Math.max(0, y)} width={44} height={hh} rx={j ? 2 : 4} fill={series[j][1]} />
              })
              return (
                <div key={b.key} onMouseEnter={() => setHi(i)} onClick={b.onClick} title={b.hint} role={b.onClick ? 'button' : undefined} tabIndex={b.onClick ? 0 : undefined}
                  onKeyDown={(e) => { if (b.onClick && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); b.onClick() } }}
                  className={b.onClick ? 'ut-bar-col' : undefined}
                  style={{ flex: 1, minWidth: 0, position: 'relative', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', borderRadius: '10px 10px 0 0', cursor: b.onClick ? 'pointer' : 'default', transition: 'background .15s' }}>
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: '#334155', marginBottom: 5 }}>{num(sum)}</span>
                  <svg width={44} height={H.toFixed(1)} aria-hidden="true" style={{ display: 'block', overflow: 'visible', flexShrink: 0 }}>{rects}</svg>
                  {hi === i && (
                    <div role="tooltip" style={{ position: 'absolute', zIndex: 5, top: 4, left: '50%', transform: 'translateX(-50%)', width: 172, background: '#0f172a', color: '#fff', borderRadius: 12, padding: '10px 12px', boxShadow: '0 16px 40px -12px rgba(15,23,42,.5)', pointerEvents: 'none', textAlign: 'left' }}>
                      <div style={{ fontSize: 13, fontWeight: 700 }}>{b.label}</div>
                      <div style={{ fontSize: 11.5, color: '#a7f3d0', marginBottom: 6 }}>{b.tip || `${num(sum)} ${unit} · ${pctOf(sum, total)}%`}</div>
                      {series.map(([l, c], j) => (
                        <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, padding: '2px 0' }}><span style={{ width: 9, height: 9, borderRadius: 3, background: c }} /><span style={{ flex: 1, color: '#cbd5e1' }}>{l}</span><b>{num(b.parts[j])}</b></div>
                      ))}
                      {footnote && b.onClick && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 6 }}>{footnote}</div>}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
        <div style={{ display: 'flex', marginLeft: 34, paddingTop: 8, borderTop: '1px solid #e2e8f0' }}>
          {bars.map((b) => (
            <div key={b.key} style={{ flex: 1, minWidth: 0, textAlign: 'center', fontSize: 12, fontWeight: 600, color: b.none ? '#64748b' : '#334155', fontStyle: b.none ? 'italic' : 'normal', padding: '0 2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={b.label}>{b.label}</div>
          ))}
        </div>
      </div>
    </div>
  )
}

export interface LinePoint { key: string; short: string; value: number }
/** The design's trend line with a highlighted point and a readout above it (Monthly attrition). */
export function TrendChart({ points, unit = '%', readout }: { points: LinePoint[]; unit?: string; readout: (i: number) => ReactNode }) {
  const [mi, setMi] = useState(-1)
  const cur = mi >= 0 && mi < points.length ? mi : points.length - 1
  const peak = Math.max(0, ...points.map((p) => p.value)), aStep = Math.max(1, Math.ceil((peak * 1.15) / 3)), aTop = aStep * 3
  const pts = points.map((p, i) => [i * 100 + 50, 220 - (p.value / aTop) * 220])
  const lineD = pts.map((pt, i) => `${i ? 'L' : 'M'}${pt[0].toFixed(1)},${pt[1].toFixed(1)}`).join(' ')
  const areaD = pts.length ? `${lineD} L${pts[pts.length - 1][0]},220 L${pts[0][0]},220 Z` : ''
  const gid = useMemo(() => `rk-area-${Math.random().toString(36).slice(2, 8)}`, [])
  return (
    <>
      {points.length > 0 && <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 18px', padding: '10px 12px', borderRadius: 12, background: '#f0fdf4', border: '1px solid #d1fae5', marginBottom: 12 }}>{readout(cur)}</div>}
      <div style={{ overflowX: 'auto', paddingTop: 10 }}>
        <div style={{ minWidth: Math.max(560, points.length * 46) }}>
          <div style={{ position: 'relative', marginLeft: 38 }} onMouseLeave={() => setMi(-1)}>
            <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
              {[0, 1, 2, 3].map((i) => (
                <div key={i} style={{ position: 'absolute', left: 0, right: 0, bottom: `${(i * 100) / 3}%`, borderTop: i ? '1px dashed #e2e8f0' : '1px solid #e2e8f0' }}>
                  <span style={{ position: 'absolute', right: 'calc(100% + 8px)', top: -8, fontSize: 11, color: '#94a3b8', fontWeight: 600 }}>{`${(aStep * i).toFixed(0)}${unit}`}</span>
                </div>
              ))}
            </div>
            <svg viewBox={`0 0 ${Math.max(1, points.length) * 100} 220`} width="100%" role="img" aria-label="Trend" style={{ display: 'block', height: 'auto', overflow: 'visible' }}>
              <defs><linearGradient id={gid} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#34d399" stopOpacity=".35" /><stop offset="1" stopColor="#34d399" stopOpacity="0" /></linearGradient></defs>
              {points.map((p, i) => <rect key={p.key} x={i * 100} y={0} width={100} height={220} fill={i === cur ? '#ecfdf5' : 'transparent'} onMouseEnter={() => setMi(i)} onClick={() => setMi(i)} style={{ cursor: 'pointer' }} />)}
              <path d={areaD} fill={`url(#${gid})`} pointerEvents="none" />
              <path d={lineD} fill="none" stroke="#0f6e56" strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" pointerEvents="none" />
              {pts.map((pt, i) => <circle key={i} cx={pt[0].toFixed(1)} cy={pt[1].toFixed(1)} r={i === cur ? 8 : 5} fill="#fff" stroke="#0f6e56" strokeWidth={3} pointerEvents="none" />)}
            </svg>
          </div>
          <div style={{ display: 'flex', marginLeft: 38, paddingTop: 8, borderTop: '1px solid #e2e8f0' }}>
            {points.map((p) => <div key={p.key} style={{ flex: 1, minWidth: 0, textAlign: 'center', fontSize: 11.5, fontWeight: 600, color: '#64748b', whiteSpace: 'nowrap' }}>{p.short}</div>)}
          </div>
        </div>
      </div>
    </>
  )
}

/** The design's donut with a legend of counts and shares. */
export function DonutChart({ parts, centerLabel = 'People', footer }: { parts: { label: string; value: number; color: string }[]; centerLabel?: string; footer?: ReactNode }) {
  const [seg, setSeg] = useState(-1)
  const tot = parts.reduce((a, p) => a + p.value, 0), C = 2 * Math.PI * 70
  let acc = 0
  const segs = parts.map((p, i) => { const len = tot ? (p.value / tot) * C : 0; const g = { ...p, da: `${len.toFixed(2)} ${(C - len).toFixed(2)}`, off: (-acc).toFixed(2), sw: seg === i ? 30 : 22 }; acc += len; return g })
  const sg = segs[seg]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, flex: 1 }} onMouseLeave={() => setSeg(-1)}>
      <div style={{ position: 'relative', width: 180, height: 180 }}>
        <svg width={180} height={180} viewBox="0 0 180 180" role="img" aria-label="Split" style={{ display: 'block', transform: 'rotate(-90deg)' }}>
          <circle cx={90} cy={90} r={70} fill="none" stroke="#f1f5f9" strokeWidth={22} />
          {segs.map((g, i) => <circle key={g.label} cx={90} cy={90} r={70} fill="none" stroke={g.color} strokeWidth={g.sw} strokeDasharray={g.da} strokeDashoffset={g.off} onMouseEnter={() => setSeg(i)} style={{ cursor: 'pointer', transition: 'stroke-width .15s' }} />)}
        </svg>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          <div style={{ fontSize: 26, fontWeight: 800 }}>{sg ? `${pctOf(sg.value, tot)}%` : num(tot)}</div>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em', color: '#64748b', textTransform: 'uppercase', maxWidth: 110, textAlign: 'center' }}>{sg ? sg.label : centerLabel}</div>
        </div>
      </div>
      <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {segs.map((g, i) => (
          <div key={g.label} onMouseEnter={() => setSeg(i)} className="ut-row-hover" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 9px', borderRadius: 9, fontSize: 13, cursor: 'default' }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: g.color, flexShrink: 0 }} />
            <span style={{ flex: 1, color: '#334155', fontWeight: 600 }}>{g.label}</span><b>{num(g.value)}</b>
            <span style={{ width: 40, textAlign: 'right', color: '#64748b', fontWeight: 600 }}>{pctOf(g.value, tot)}%</span>
          </div>
        ))}
      </div>
      {footer}
    </div>
  )
}

/** Sortable table with the design's title block and total footer; cards on a phone; 25 rows a page when long. */
export function ReportTable<T extends { id: string }>({ title, subtitle, columns, rows, footerCells, onRowClick, card, search, pageSize = 25 }: {
  title: string; subtitle?: string; columns: Column<T>[]; rows: T[]; footerCells?: ReactNode[]
  onRowClick?: (r: T) => void; card: (r: T) => { title: string; big: string; small?: string; stats: [string, string][]; muted?: boolean }
  search?: { placeholder: string; match: (r: T, q: string) => boolean }; pageSize?: number
}) {
  const mobile = useIsMobile()
  const [q, setQ] = useState('')
  const [page, setPage] = useState(0)
  const filtered = useMemo(() => (search && q.trim() ? rows.filter((r) => search.match(r, q.trim().toLowerCase())) : rows), [rows, q, search])
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize)), cur = Math.min(page, pages - 1)
  const shown = filtered.length > pageSize ? filtered.slice(cur * pageSize, (cur + 1) * pageSize) : filtered
  useEffect(() => { setPage(0) }, [q, rows])
  const head = <div><div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a' }}>{title}</div>{subtitle && <div style={{ fontSize: 12.5, color: '#64748b', marginTop: 2, fontWeight: 500 }}>{subtitle}</div>}</div>
  const pager = filtered.length > pageSize ? <HrPagination page={cur} pageSize={pageSize} totalElements={filtered.length} totalPages={pages} onPageChange={setPage} /> : undefined
  const td = (c: ReactNode, i: number) => <td key={i} style={{ padding: '16px 24px', fontWeight: 800, color: '#0f172a' }}>{c}</td>
  return (
    <TableCard filters={head} footer={pager} actions={search ? (
      <label style={{ position: 'relative', display: 'block', width: 'min(300px, 100%)' }}>
        <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', display: 'inline-flex' }}><Ico d="M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3" size={15} /></span>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={search.placeholder} aria-label={search.placeholder}
          style={{ width: '100%', boxSizing: 'border-box', height: 36, padding: '0 12px 0 34px', borderRadius: 10, border: '1px solid #e2e8f0', background: '#f8fafc', font: `500 13.5px ${FONT}`, color: '#0f172a', outline: 'none' }} />
      </label>
    ) : undefined}>
      {mobile ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12, background: '#f8fafc' }}>
          {shown.length === 0 && <div style={{ padding: 16, textAlign: 'center', fontSize: 13, color: '#64748b' }}>No rows match “{q}”.</div>}
          {shown.map((r) => {
            const c = card(r)
            return (
              <button key={r.id} type="button" onClick={onRowClick ? () => onRowClick(r) : undefined} disabled={!onRowClick}
                style={{ textAlign: 'left', width: '100%', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10, cursor: onRowClick ? 'pointer' : 'default', fontFamily: 'inherit', color: 'inherit', boxSizing: 'border-box' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 700, color: c.muted ? '#64748b' : '#0f6e56', fontStyle: c.muted ? 'italic' : 'normal' }}>{c.title}</span>
                  <span style={{ fontSize: 18, fontWeight: 800 }}>{c.big}</span>{c.small && <span style={{ fontSize: 12, fontWeight: 600, color: '#64748b' }}>{c.small}</span>}
                </span>
                <span style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(3, c.stats.length)},minmax(0,1fr))`, gap: 6 }}>
                  {c.stats.map(([l, v]) => <span key={l} style={{ background: '#f8fafc', borderRadius: 9, padding: '6px 8px', display: 'flex', flexDirection: 'column' }}><span style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>{l}</span><b style={{ fontSize: 13.5 }}>{v}</b></span>)}
                </span>
              </button>
            )
          })}
        </div>
      ) : (
        <DataTable columns={columns} data={shown} keyField="id" onRowClick={onRowClick} emptyMessage={q ? `No rows match “${q}”.` : 'No rows.'}
          footer={footerCells ? <tfoot><tr style={{ background: '#f8fafc', borderTop: '2px solid #e2e8f0' }}>{footerCells.map(td)}</tr></tfoot> : undefined} />
      )}
    </TableCard>
  )
}

export { slug }
