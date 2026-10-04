// The module-page pattern in the redesign's look (design_handoff_hrms_redesign,
// prototype PgGeneric / UtSection / UtStat): the kit page header, the design's
// view pills (SubTabs), stat cards (StatTile), section headings, quiet section
// states (SectionState), approval cards (ApprovalCard), list rows, form panels,
// notes and the kit toast. Modules without a design of their own (Leave,
// Expenses, Hiring…) are assembled from these parts so every page speaks the
// same visual language. Colours are the design tokens only (light and dark).
import { createElement as h, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { HrStatusPill } from '@/shared/components/hr'
import { DesignFrame } from '@/design/dc/DesignFrame'
import { StatTile } from '@/design/dc/StatTile'
import { SectionState } from '@/design/dc/SectionState'
import { ApprovalCard } from '@/design/dc/ApprovalCard'
import { ApprovalShell } from '@/design/dc/ApprovalCard.view'
import { dashIcon } from '@/design/dc/icons'
import { ToastSlot, TOAST_MS } from '@/design/kit/Toast'
import { PageHeader } from '@/design/kit/PageHeader'
import { PageTabsHost } from '@/design/kit/pageTabs'
import { PillTabs, type PillTab } from '@/design/kit/PillTabs'
import { CountBadge } from '@/design/kit/StatusPill'
import { SectionHeading } from '@/design/kit/Section'
import { ErrorState } from '@/design/kit/EmptyState'
import './ModuleKit.css'

export const FONT = "var(--u-font,'Inter',system-ui,sans-serif)"
export const HEAD_FONT = "var(--u-font,'Inter',system-ui,sans-serif)"
/** The design's card surface (UtSection): white, 18px corners, hairline, card shadow. */
export const CARD: CSSProperties = { background: 'var(--u-sf,#fff)', border: '1px solid var(--u-ln,#E3E9E6)', borderRadius: 18, boxShadow: 'var(--u-shc,0 1px 2px rgba(14,27,22,.05))', minWidth: 0 }

/**
 * Page frame: the kit page header (context line, 28/34 title, summary, actions), then content on the design's 20px rhythm.
 * It hosts the header's tab slot (kit pageTabs): the page's Views — the first PillTabs anywhere in the page —
 * move into the header, which draws the Master "Organization Setup" hero card with the segmented tabs inside.
 * `tabs` passes a bar explicitly instead (for one that must stay in a row with filters, or isn't the first).
 */
export function ModulePage({ crumb, title, subtitle, actions, tabs, children, gap = 20 }: { crumb: string; title: string; subtitle?: ReactNode; actions?: ReactNode; tabs?: ReactNode; children: ReactNode; gap?: number }) {
  return (
    <DesignFrame>
      <PageTabsHost>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr)', gap, minWidth: 0, fontFamily: FONT, color: 'var(--u-ink,#0E1B16)' }}>
          <PageHeader eyebrow={crumb} title={title} sub={subtitle} actions={actions} tabs={tabs} />
          {children}
        </div>
      </PageTabsHost>
    </DesignFrame>
  )
}

export interface ViewTab { key: string; label: string; count?: number | string | null; urgent?: boolean; icon?: string; tip?: string }
/**
 * The page's own views: the kit PillTabs with view semantics (role="group", aria-pressed), a count after
 * the label (gold when it's urgent, grey otherwise; 0 shows none), an icon and a tooltip. Inside a
 * ModulePage the bar joins the page header as the hero card's segmented control (the first PillTabs in
 * the page does; `hero={false}` keeps a bar where it stands, e.g. a chooser inside a form). The active
 * one is kept in ?view= (or the given param) by useView so links and Back work. The top bar shows the
 * module's pages (SHELL CONTRACT UPDATE, DECISIONS 21), so `placement` no longer moves the bar: both
 * values render it in the page (the prop stays for the callers that pass it).
 */
export function Views({ items, active, onChange, label = 'Views', hero = true }: { items: ViewTab[]; active: string; onChange: (k: string) => void; label?: string; placement?: 'header' | 'inline'; hero?: boolean }) {
  const tabs: PillTab[] = items.map((t) => {
    const count = t.count === 0 || t.count == null || t.count === '' ? null : t.count
    return {
      key: t.key,
      icon: t.icon,
      tip: t.tip,
      label: count == null ? t.label : <><span>{t.label}</span><CountBadge tone={t.urgent ? 'gold' : 'neutral'} size="sm">{count}</CountBadge></>,
    }
  })
  return <PillTabs items={tabs} activeKey={active} onSelect={onChange} label={label} semantics="toggle" placement={hero ? 'auto' : 'inline'} />
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
/** A row of the design's stat cards (UtStat): repeat(auto-fit, minmax(min(100%, min), 1fr)), 12px apart. */
export function StatRow({ tiles, min = 200 }: { tiles: Tile[]; min?: number }) {
  return (
    <div role="group" style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit,minmax(min(100%,${min}px),1fr))`, gap: 12 }}>
      {tiles.map((t) => h(StatTile as any, { key: t.label, tile: { ...t, icon: dashIcon(t.icon, 20), chart: null, onClick: t.onClick || (() => {}) } }))}
    </div>
  )
}

/** A section heading: the design's group heading (icon tile, 18px title), then its content. */
export function Section({ icon, title, aside, children, id }: { icon: string; title: string; aside?: ReactNode; children?: ReactNode; id?: string }) {
  const hid = id || `sec-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
  return (
    <section aria-labelledby={hid} style={{ display: 'grid', gap: 16, minWidth: 0 }}>
      <SectionHeading icon={icon} title={title} actions={aside} id={hid} />
      {children}
    </section>
  )
}

/** A smaller heading inside a view ("Waiting for your OK", "Already decided"): the design's 16px inline heading. */
export function SubHeading({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return <SectionHeading level={3} title={children} actions={aside} className="umk-subhead" />
}

/** Loading, error or empty, in the design's quiet style. */
export function State({ kind, title, description, onRetry, icon, height }: { kind: 'loading' | 'error' | 'empty'; title?: string; description?: string; onRetry?: () => void; icon?: string; height?: number }) {
  // The design's SectionState error has fixed wording; ours says what failed and why (the server's message).
  if (kind === 'error') return (
    <div style={{ ...CARD, fontFamily: FONT }}>
      <ErrorState title={title || 'Unable to load this section.'} message={description || ''} onRetry={onRetry} />
    </div>
  )
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

/**
 * The ApprovalCard's look with open slots: for requests that need more than
 * approve/reject with a note (expense line items, "Mark reimbursed", disburse…).
 */
export function DecisionCard({ name, sub, status, facts, reason, raised, details, actions }: {
  name: string; sub?: string; status?: [string, string]; facts: { k: string; v: ReactNode }[]; reason?: ReactNode; raised?: string; details?: ReactNode; actions?: ReactNode
}) {
  return (
    <ApprovalShell
      name={name}
      sub={sub}
      basis="1 1 260px"
      status={status ? h(HrStatusPill as any, { tone: status[1] }, status[0]) : null}
      facts={facts}
      body={
        <>
          {reason ? <p style={{ margin: 0, fontSize: 13.5, color: 'var(--u-ink2,#4A5A54)', lineHeight: 1.5 }}>{reason}</p> : null}
          {raised ? <p style={{ margin: 0, fontSize: 12, color: 'var(--u-ink3,#6A7A73)' }}>Raised {raised}</p> : null}
          {details}
        </>
      }
      side={actions ? <div style={{ flex: '0 0 auto', display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end', gap: 8, alignSelf: 'center' }}>{actions}</div> : null}
    />
  )
}

/** Rows in one white card (the design's "Already decided" list). */
export function RowList({ children }: { children: ReactNode }) {
  return <div className="umk-rows" style={{ ...CARD, overflow: 'hidden' }}>{children}</div>
}
/** A list row: leading tile, title with a quiet line (and a note), trailing pills or buttons; a button when it opens something. */
export function Row({ lead, title, meta, note, trail, onClick, muted }: { lead?: ReactNode; title: ReactNode; meta?: ReactNode; note?: ReactNode; trail?: ReactNode; onClick?: () => void; muted?: boolean }) {
  const Tag = onClick ? 'button' : 'div'
  return h(Tag as any, {
    // `ut-row-hover` stays on clickable rows: existing live tests find them by it (ModuleKit.css draws the hover).
    type: onClick ? 'button' : undefined, onClick, className: onClick ? 'umk-row ut-row-hover' : 'umk-row',
    style: muted ? { opacity: 0.7 } : undefined,
  },
  lead,
  h('span', { className: 'umk-row__text' },
    h('strong', { className: 'umk-row__title' }, title),
    meta ? h('span', { className: 'umk-row__meta' }, meta) : null,
    note ? h('span', { className: 'umk-row__note' }, note) : null),
  trail ? h('span', { className: 'umk-row__trail' }, trail) : null)
}

/** A white form/content panel with an optional title row (the design's panel card: 16px title, quiet sub-line). */
export function Panel({ title, sub, aside, children, pad = 20, style }: { title?: ReactNode; sub?: ReactNode; aside?: ReactNode; children: ReactNode; pad?: number; style?: CSSProperties }) {
  return (
    <div style={{ ...CARD, padding: pad, display: 'grid', gap: 16, ...style }}>
      {(title || aside) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: '6px 12px' }}>
          <div style={{ flex: '1 1 220px', minWidth: 0, display: 'grid', gap: 3 }}>
            {title && <h3 style={{ margin: 0, fontFamily: HEAD_FONT, fontSize: 16, lineHeight: '22px', fontWeight: 500, letterSpacing: '-.01em', color: 'var(--u-ink,#0E1B16)' }}>{title}</h3>}
            {sub && <p style={{ margin: 0, fontSize: 13, lineHeight: 1.45, color: 'var(--u-ink3,#6A7A73)' }}>{sub}</p>}
          </div>
          {aside}
        </div>
      )}
      {children}
    </div>
  )
}

/** Notes inside panels: plain, amber (caution), red (blocking) or green — the design's tinted note boxes. */
export function Note({ tone, children }: { tone?: 'amber' | 'red' | 'green'; children: ReactNode }) {
  const t = tone === 'red' ? 'danger' : tone === 'amber' ? 'warning' : tone === 'green' ? 'success' : 'neutral'
  return <p role={tone === 'red' ? 'alert' : undefined} className={`umk-note uk-tone--${t}`}>{children}</p>
}

/** Label/value tiles (grey inset tiles: a quiet label over the figure). */
export function Facts({ items, min = 150 }: { items: { k: string; v: ReactNode }[]; min?: number }) {
  return (
    <dl className="umk-facts" style={{ gridTemplateColumns: `repeat(auto-fill,minmax(min(100%,${min}px),1fr))` }}>
      {items.map((f) => (
        <div key={f.k} className="umk-fact">
          <dt className="uk-kv__k">{f.k}</dt>
          <dd className="uk-kv__v">{f.v}</dd>
        </div>
      ))}
    </dl>
  )
}

/** The design's toast (bottom centre, the shared kit Toast); `node` renders it. Success goes after 2.6s, errors after 7s. */
export function useDesignToast() {
  const [t, set] = useState<null | { msg: string; err?: boolean; detail?: string; n: number }>(null)
  const seq = useRef(0)
  const show = (msg: string, err?: boolean, detail?: string) => set({ msg, err, detail, n: ++seq.current })
  const node = t ? (
    <ToastSlot key={t.n} tone={t.err ? 'error' : 'success'} message={t.msg} detail={t.detail} duration={t.err ? 7000 : TOAST_MS.success}
      onDone={() => set((cur) => (cur && cur.n === t.n ? null : cur))} />
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
