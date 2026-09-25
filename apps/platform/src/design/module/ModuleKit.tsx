// The module-page pattern, taken from the Claude Design screens already built
// (Attendance, Payroll, Master): a page header, the design's view tabs
// (SubTabs), stat tiles (StatTile), section headings with an icon tile, quiet
// section states (SectionState), approval cards (ApprovalCard), list rows,
// form panels and the dark toast. Modules without a design of their own
// (Leave, Expenses, Hiring…) are assembled from these parts so every page
// speaks the same visual language as the designed ones.
import { createElement as h, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { HrPageHeader } from '@/shared/components/hr'
import { DesignFrame } from '@/design/dc/DesignFrame'
import { SubTabs } from '@/design/dc/SubTabs'
import { StatTile } from '@/design/dc/StatTile'
import { SectionState } from '@/design/dc/SectionState'
import { ApprovalCard } from '@/design/dc/ApprovalCard'
import { dashIcon } from '@/design/dc/icons'

export const FONT = 'Inter,-apple-system,sans-serif'
export const HEAD_FONT = "'Plus Jakarta Sans',Inter,sans-serif"
export const CARD: CSSProperties = { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 16, boxShadow: '0 1px 2px rgba(15,23,42,.04)', minWidth: 0 }

/** Page frame: header, then content on the design's 28px rhythm. */
export function ModulePage({ crumb, title, subtitle, actions, children, gap = 28 }: { crumb: string; title: string; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; gap?: number }) {
  return (
    <DesignFrame>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr)', gap, minWidth: 0, fontFamily: FONT, color: '#0f172a' }}>
        <div style={{ marginBottom: -32, minWidth: 0 }}><HrPageHeader crumb={crumb} title={title} subtitle={subtitle} actions={actions} /></div>
        {children}
      </div>
    </DesignFrame>
  )
}

export interface ViewTab { key: string; label: string; count?: number | string | null; urgent?: boolean; icon?: string; tip?: string }
/** The design's view tabs. The active one is kept in ?view= (or the given param) so links and Back work. */
export function Views({ items, active, onChange, label = 'Views' }: { items: ViewTab[]; active: string; onChange: (k: string) => void; label?: string }) {
  return h(SubTabs as any, {
    label,
    items: items.map((t) => ({ key: t.key, label: t.label, count: t.count === 0 ? undefined : t.count ?? undefined, urgent: t.urgent, icon: t.icon ? dashIcon(t.icon, 15) : null, tip: t.tip, active: t.key === active, onClick: () => onChange(t.key) })),
  })
}

/** Keeps the chosen view in the URL; unknown or hidden views fall back to the first allowed one. */
export function useView(allowed: string[], param = 'view'): [string, (k: string) => void] {
  const read = () => new URLSearchParams(window.location.search).get(param) || ''
  const [v, setV] = useState(() => read())
  useEffect(() => {
    const on = () => setV(read())
    window.addEventListener('popstate', on)
    return () => window.removeEventListener('popstate', on)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const cur = allowed.includes(v) ? v : allowed[0] || ''
  const set = (k: string) => {
    const u = new URL(window.location.href)
    u.searchParams.set(param, k)
    window.history.replaceState(window.history.state, '', u.pathname + u.search + u.hash)
    setV(k)
  }
  return [cur, set]
}

export interface Tile { icon: string; color: 'blue' | 'green' | 'orange' | 'red' | 'purple' | 'teal'; label: string; value: ReactNode; sub?: ReactNode; onClick?: () => void; tip?: string }
export function StatRow({ tiles, min = 200 }: { tiles: Tile[]; min?: number }) {
  return (
    <div role="group" style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit,minmax(min(100%,${min}px),1fr))`, gap: 12 }}>
      {tiles.map((t) => h(StatTile as any, { key: t.label, tile: { ...t, icon: dashIcon(t.icon, 17), chart: null, onClick: t.onClick || (() => {}) } }))}
    </div>
  )
}

/** A section heading: icon tile, title and a divider, then its content. */
export function Section({ icon, title, aside, children, id }: { icon: string; title: string; aside?: ReactNode; children?: ReactNode; id?: string }) {
  const hid = id || `sec-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
  return (
    <section aria-labelledby={hid} style={{ display: 'grid', gap: 16, minWidth: 0 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px 14px', paddingBottom: 14, borderBottom: '1px solid #e2e8f0' }}>
        <span aria-hidden="true" style={{ flex: '0 0 auto', width: 36, height: 36, boxSizing: 'border-box', borderRadius: 11, background: '#ecfdf5', border: '1px solid #d1fae5', color: '#0f6e56', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{dashIcon(icon, 18)}</span>
        <h2 id={hid} style={{ margin: 0, flex: '1 1 220px', minWidth: 0, fontFamily: HEAD_FONT, fontSize: 21, fontWeight: 700, letterSpacing: '-.015em', lineHeight: 1.25 }}>{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  )
}

/** A smaller heading inside a view ("Waiting for your OK", "Already decided"). */
export function SubHeading({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
      <h3 style={{ margin: 0, flex: '1 1 auto', fontFamily: HEAD_FONT, fontSize: 16, fontWeight: 800 }}>{children}</h3>
      {aside}
    </div>
  )
}

/** Loading, error or empty, in the design's quiet style. */
export function State({ kind, title, description, onRetry, icon, height }: { kind: 'loading' | 'error' | 'empty'; title?: string; description?: string; onRetry?: () => void; icon?: string; height?: number }) {
  return h(SectionState as any, { kind, title, description, retry: onRetry, icon, height })
}

export interface Approval {
  id: string; name: string; sub?: string; status?: string
  facts: { k: string; v: ReactNode }[]; reason?: string; raised?: string; attachment?: string; note?: string
}
export function ApprovalList({ items, onDecide, busy, approveLabel, approveTip, canDecide = true, onAttachment }: {
  items: Approval[]; onDecide: (id: string, status: 'APPROVED' | 'REJECTED', note: string) => void; busy?: boolean; approveLabel?: string; approveTip?: string; canDecide?: boolean | ((a: Approval) => boolean); onAttachment?: (a: Approval) => void
}) {
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {items.map((r) => h(ApprovalCard as any, { key: r.id, request: { status: 'PENDING', ...r }, busy, onDecide, onAttachment, approveLabel, approveTip, canDecide: typeof canDecide === 'function' ? canDecide(r) : canDecide }))}
    </div>
  )
}

/** Rows in one white card (the design's "Already decided" list). */
export function RowList({ children }: { children: ReactNode }) {
  return <div style={{ ...CARD, overflow: 'hidden' }}>{children}</div>
}
export function Row({ lead, title, meta, note, trail, onClick, muted }: { lead?: ReactNode; title: ReactNode; meta?: ReactNode; note?: ReactNode; trail?: ReactNode; onClick?: () => void; muted?: boolean }) {
  const Tag = onClick ? 'button' : 'div'
  return h(Tag as any, {
    type: onClick ? 'button' : undefined, onClick, className: onClick ? 'ut-row-hover' : undefined,
    style: { width: '100%', textAlign: 'left', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 16px', padding: '12px 16px', border: 0, borderBottom: '1px solid #f1f5f9', background: 'transparent', font: 'inherit', color: 'inherit', cursor: onClick ? 'pointer' : 'default', opacity: muted ? 0.7 : 1, boxSizing: 'border-box' },
  },
  lead,
  h('span', { style: { flex: '1 1 220px', minWidth: 0, display: 'grid', gap: 2, fontSize: 13 } },
    h('strong', { style: { fontSize: 13.5, fontVariantNumeric: 'tabular-nums' } }, title),
    meta ? h('span', { style: { color: '#64748b' } }, meta) : null,
    note ? h('span', { style: { color: '#475569', fontStyle: 'italic' } }, note) : null),
  trail ? h('span', { style: { flex: '0 0 auto', display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } }, trail) : null)
}

/** A white form/content panel with an optional title row. */
export function Panel({ title, sub, aside, children, pad = 20, style }: { title?: ReactNode; sub?: ReactNode; aside?: ReactNode; children: ReactNode; pad?: number; style?: CSSProperties }) {
  return (
    <div style={{ ...CARD, padding: pad, display: 'grid', gap: 16, ...style }}>
      {(title || aside) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: '6px 12px' }}>
          <div style={{ flex: '1 1 220px', minWidth: 0, display: 'grid', gap: 2 }}>
            {title && <h3 style={{ margin: 0, fontFamily: HEAD_FONT, fontSize: 16, fontWeight: 700 }}>{title}</h3>}
            {sub && <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: '#64748b' }}>{sub}</p>}
          </div>
          {aside}
        </div>
      )}
      {children}
    </div>
  )
}

/** Notes inside panels: plain, amber (caution) or red (blocking). */
export function Note({ tone, children }: { tone?: 'amber' | 'red' | 'green'; children: ReactNode }) {
  const c = tone === 'red' ? ['#fef2f2', '#fecaca', '#b91c1c'] : tone === 'amber' ? ['#fffbeb', '#fde68a', '#92400e'] : tone === 'green' ? ['#ecfdf5', '#a7f3d0', '#065f46'] : ['#f8fafc', '#eef2f6', '#475569']
  return <p role={tone === 'red' ? 'alert' : undefined} style={{ margin: 0, padding: '10px 12px', borderRadius: 10, background: c[0], border: `1px solid ${c[1]}`, fontSize: 12.5, lineHeight: 1.5, color: c[2] }}>{children}</p>
}

/** Label/value tiles (the workspace's grey fact tiles). */
export function Facts({ items, min = 150 }: { items: { k: string; v: ReactNode }[]; min?: number }) {
  return (
    <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: `repeat(auto-fill,minmax(min(100%,${min}px),1fr))`, gap: 10 }}>
      {items.map((f) => (
        <div key={f.k} style={{ padding: '10px 12px', borderRadius: 12, background: '#f8fafc', minWidth: 0 }}>
          <dt style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: '#64748b' }}>{f.k}</dt>
          <dd style={{ margin: '3px 0 0', fontSize: 14, fontWeight: 600, fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere' }}>{f.v}</dd>
        </div>
      ))}
    </dl>
  )
}

/** The design's dark toast (bottom centre); `node` renders it. */
export function useDesignToast() {
  const [t, set] = useState<null | { msg: string; err?: boolean; detail?: string }>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => () => clearTimeout(timer.current), [])
  const show = (msg: string, err?: boolean, detail?: string) => { clearTimeout(timer.current); set({ msg, err, detail }); timer.current = setTimeout(() => set(null), err ? 7000 : 3200) }
  const node = t ? (
    <div role={t.err ? 'alert' : 'status'} style={{ position: 'fixed', left: '50%', bottom: 24, transform: 'translateX(-50%)', zIndex: 1400, display: 'flex', alignItems: t.detail ? 'flex-start' : 'center', gap: 10, width: 'max-content', maxWidth: 'min(460px,calc(100vw - 32px))', padding: '12px 14px', borderRadius: 14, background: '#0f172a', color: '#fff', boxShadow: '0 18px 36px -14px rgba(15,23,42,.6)', boxSizing: 'border-box', fontFamily: FONT }}>
      <span aria-hidden="true" style={{ display: 'inline-flex', color: t.err ? '#fca5a5' : '#34d399', marginTop: t.detail ? 1 : 0 }}>{dashIcon(t.err ? 'alertTriangle' : 'check', 18)}</span>
      <span style={{ display: 'grid', gap: 3 }}><strong style={{ fontSize: 13.5, fontWeight: 700, lineHeight: 1.35 }}>{t.msg}</strong>{t.detail && <span style={{ fontSize: 12.5, color: '#cbd5e1', lineHeight: 1.45 }}>{t.detail}</span>}</span>
      <button type="button" aria-label="Dismiss" onClick={() => set(null)} style={{ border: 0, background: 'transparent', color: '#94a3b8', cursor: 'pointer', display: 'inline-flex', padding: 2, marginLeft: 4 }}>{dashIcon('x', 15)}</button>
    </div>
  ) : null
  return { show, node }
}

/** "3 days" / "0.5 day" */
export const days = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)} ${n === 1 ? 'day' : 'days'}`
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** "2026-09-25" → "25 Sep 2026" (no timezone shifts). */
export const dmy = (iso?: string | null) => { if (!iso) return '—'; const [y, m, d] = iso.slice(0, 10).split('-').map(Number); return `${d} ${MON[m - 1]} ${y}` }
/** "2026-09-25" → "25 Sep" */
export const dm = (iso?: string | null) => { if (!iso) return '—'; const [, m, d] = iso.slice(0, 10).split('-').map(Number); return `${d} ${MON[m - 1]}` }
/** A range: "25 – 27 Sep 2026", "30 Sep – 2 Oct 2026". */
export const range = (a: string, b: string) => (a === b ? dmy(a) : a.slice(0, 7) === b.slice(0, 7) ? `${Number(a.slice(8, 10))} – ${dmy(b)}` : `${dm(a)} – ${dmy(b)}`)
/** Today in the browser's calendar (India for our users), never UTC. */
export const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
/** When something was raised: "25 Sep, 10:42 am". */
export const stamp = (at?: string | null) => (at ? new Date(at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '')
