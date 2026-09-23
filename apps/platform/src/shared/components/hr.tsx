import React from 'react'
import { createPortal } from 'react-dom'
import { clsx } from 'clsx'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, ChevronDown, Search, X } from 'lucide-react'

/**
 * Reusable building blocks shared by every HR list/detail screen so they all
 * share one premium, token-driven look. All are presentational — screens feed
 * them live data from our React Query hooks.
 *
 * Brand colour comes from the design-system tokens (emerald). Status/semantic
 * colours (success/warning/error/info) stay distinct for at-a-glance scanning.
 */

// ── KPI stat card ──────────────────────────────────────────────────────────────
type StatColor = 'blue' | 'green' | 'orange' | 'red' | 'purple' | 'teal'
const STAT_ICON: Record<StatColor, string> = {
  green:  'bg-emerald-50 text-[#0F6E56] border border-emerald-200/60 dark:bg-emerald-950/60 dark:text-emerald-400 dark:border-emerald-800/40',
  blue:   'bg-blue-50 text-blue-600 border border-blue-200/60 dark:bg-blue-950/60 dark:text-blue-400 dark:border-blue-800/40',
  orange: 'bg-amber-50 text-amber-600 border border-amber-200/60 dark:bg-amber-950/60 dark:text-amber-400 dark:border-amber-800/40',
  red:    'bg-rose-50 text-rose-600 border border-rose-200/60 dark:bg-rose-950/60 dark:text-rose-400 dark:border-rose-800/40',
  purple: 'bg-purple-50 text-purple-600 border border-purple-200/60 dark:bg-purple-950/60 dark:text-purple-400 dark:border-purple-800/40',
  teal:   'bg-teal-50 text-teal-600 border border-teal-200/60 dark:bg-teal-950/60 dark:text-teal-400 dark:border-teal-800/40',
}

export function HrStatCard({
  icon, color = 'blue', value, label, trend, sub, loading, onClick,
}: {
  icon: React.ReactNode
  color?: StatColor
  value: React.ReactNode
  label: string
  trend?: { dir: 'up' | 'down'; value: string }
  sub?: React.ReactNode
  loading?: boolean
  /**
   * Makes the tile a drill-down. When supplied the card renders as a <button>,
   * gains the hover lift and a pointer cursor; without it the card is inert and
   * visually flat on hover.
   *
   * The lift used to be unconditional, which is the thing globals.css warns
   * about on `.ut-card-hover`: "a static stat tile that rises on hover promises
   * an action it doesn't have". Every stat tile in the product was making that
   * promise and only a handful could keep it.
   */
  onClick?: () => void
}) {
  const interactive = typeof onClick === 'function'
  const Tag = (interactive ? 'button' : 'div') as 'button' | 'div'
  return (
    <Tag
      {...(interactive ? { type: 'button' as const, onClick } : {})}
      className={clsx(
        'ut-card ut-card-sm group relative overflow-hidden p-6 transition-all duration-300 bg-white ring-1 ring-gray-200 shadow-sm rounded-2xl',
        interactive
          ? 'ut-card-hover w-full cursor-pointer text-left hover:ring-emerald-300 focus-visible:ring-2 focus-visible:ring-emerald-500'
          : 'cursor-default',
      )}
    >
      <div className="absolute top-0 right-0 p-6 opacity-5 transition-transform duration-500 group-hover:scale-110 group-hover:-rotate-12 group-hover:opacity-10 pointer-events-none">
        {React.cloneElement(icon as React.ReactElement, { size: 120 })}
      </div>
      <div className="relative z-10 flex items-start justify-between">
        <div className={clsx('flex h-12 w-12 items-center justify-center rounded-xl transition-transform duration-200 group-hover:scale-105 shadow-sm', STAT_ICON[color])}>
          {icon}
        </div>
        {trend && (
          <span className={clsx(
            'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-bold tracking-tight shadow-sm',
            trend.dir === 'up'
              ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
              : 'bg-rose-50 text-rose-700 ring-1 ring-rose-200',
          )}>
            {trend.dir === 'up' ? '↑' : '↓'} {trend.value}
          </span>
        )}
      </div>
      <div className="relative z-10 mt-5">
        <p className="text-[12px] font-bold uppercase tracking-wider text-gray-500">{label}</p>
        <p className="mt-1 text-[32px] font-black leading-none tracking-tight text-gray-900 tabular-nums">
          {loading ? <span className="inline-block h-8 w-24 animate-pulse rounded-lg bg-gray-100" /> : value}
        </p>
        {sub && <p className="mt-2 text-[13px] font-medium text-gray-400">{sub}</p>}
      </div>
    </Tag>
  )
}

// ── Status pill ──────────────────────────────────────────────────────────────
export type PillTone = 'ok' | 'warn' | 'info' | 'late' | 'purple' | 'red' | 'pink' | 'teal' | 'gray' | 'green' | 'orange' | 'blue'
const PILL: Record<PillTone, string> = {
  ok:     'bg-emerald-50 text-emerald-700 border border-emerald-200/80 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800/40',
  green:  'bg-emerald-50 text-emerald-700 border border-emerald-200/80 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800/40',
  warn:   'bg-amber-50 text-amber-700 border border-amber-200/80 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800/40',
  orange: 'bg-orange-50 text-orange-700 border border-orange-200/80 dark:bg-orange-950/60 dark:text-orange-300 dark:border-orange-800/40',
  info:   'bg-blue-50 text-blue-700 border border-blue-200/80 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-800/40',
  blue:   'bg-blue-50 text-blue-700 border border-blue-200/80 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-800/40',
  late:   'bg-orange-50 text-orange-700 border border-orange-200/80 dark:bg-orange-950/60 dark:text-orange-300 dark:border-orange-800/40',
  purple: 'bg-purple-50 text-purple-700 border border-purple-200/80 dark:bg-purple-950/60 dark:text-purple-300 dark:border-purple-800/40',
  red:    'bg-rose-50 text-rose-700 border border-rose-200/80 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800/40',
  pink:   'bg-pink-50 text-pink-700 border border-pink-200/80 dark:bg-pink-950/60 dark:text-pink-300 dark:border-pink-800/40',
  teal:   'bg-teal-50 text-teal-700 border border-teal-200/80 dark:bg-teal-950/60 dark:text-teal-300 dark:border-teal-800/40',
  gray:   'bg-slate-100 text-slate-700 border border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
}

export function HrStatusPill({ tone = 'gray', children }: { tone?: PillTone; children: React.ReactNode }) {
  return (
    <span className={clsx('inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold tracking-tight shadow-2xs', PILL[tone])}>
      {children}
    </span>
  )
}

// ── Page header (title + subtitle + actions) ─────────────────────────────────
export function HrPageHeader({
  title, subtitle, crumb, actions, tabs, filters, className
}: {
  title: string
  subtitle?: React.ReactNode
  crumb?: React.ReactNode
  actions?: React.ReactNode
  tabs?: React.ReactNode
  filters?: React.ReactNode
  className?: string
}) {
  return (
    <div className={clsx(
      "relative mb-8 overflow-hidden rounded-[20px] bg-white p-6 shadow-sm ring-1 ring-[var(--border-default)] dark:bg-[var(--bg-surface)] sm:p-8",
      className
    )}>
      {/* Subtle brand background glows */}
      <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-emerald-500/5 opacity-70 blur-3xl" aria-hidden="true" />
      <div className="pointer-events-none absolute -bottom-20 -left-20 h-48 w-48 rounded-full bg-emerald-500/5 opacity-70 blur-3xl" aria-hidden="true" />

      <div className="relative flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          {crumb && <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-[#0F6E56] dark:text-emerald-400">{crumb}</p>}
          <h1 className="text-[26px] font-bold leading-tight tracking-tight text-[var(--text-primary)] sm:text-3xl">{title}</h1>
          {subtitle && <p className="mt-2 text-[14px] font-medium leading-relaxed text-[var(--text-secondary)] max-w-2xl">{subtitle}</p>}
        </div>
        {actions && <div className="mt-2 flex shrink-0 flex-wrap items-center gap-3 sm:ml-6 sm:mt-0">{actions}</div>}
      </div>

      {(tabs || filters) && (
        <div className="relative mt-6 flex flex-col gap-4 border-t border-[var(--border-subtle)] pt-6 sm:flex-row sm:items-center sm:justify-between">
          {tabs && <div className="-mb-6 -mt-2 sm:-mb-8 sm:-mt-2">{tabs}</div>}
          {filters && <div className="flex w-full flex-wrap items-center gap-3 sm:w-auto">{filters}</div>}
        </div>
      )}
    </div>
  )
}

// ── Green primary / ghost buttons (brand style) ─────────────────────────────
export function HrButton({
  variant = 'primary', size = 'md', className, children, ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger'; size?: 'sm' | 'md' }) {
  return (
    <button
      {...rest}
      className={clsx(
        'btn-press inline-flex items-center justify-center gap-1.5 rounded-md font-semibold transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
        size === 'sm' ? 'h-8 px-3 text-xs' : 'h-10 px-4 text-sm',
        variant === 'primary' && 'bg-[var(--interactive-primary)] text-white shadow-sm hover:bg-[var(--interactive-primary-hover)] hover:shadow-sm',
        variant === 'ghost' && 'border border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-xs hover:bg-[var(--bg-subtle)] hover:border-[var(--border-strong)]',
        variant === 'danger' && 'bg-[var(--interactive-danger)] text-white shadow-sm hover:bg-[var(--interactive-danger-hover)]',
        className,
      )}
    >
      {children}
    </button>
  )
}

// ── Table card: toolbar (search + actions) → scrollable table → footer ──
export function TableCard({
  search, filters, onClearFilters, actions, footer, children,
}: {
  search?: { value: string; onChange: (v: string) => void; placeholder?: string }
  /**
   * Filter controls for this list. Pass `FilterDef[]` and TableCard renders the
   * standard bar; pass a node to render something custom.
   *
   * Added as its own slot rather than folding filters into `actions` because
   * filters and actions answer different questions ("which rows?" vs "do what
   * to them?") and belong on opposite sides of the toolbar. 42 screens had each
   * hand-rolled a row of bare <select>s into `actions`, which is why no two
   * looked or behaved alike.
   */
  filters?: FilterDef[] | React.ReactNode
  /**
   * Clear-all override, forwarded to FilterBar.
   *
   * Needed whenever two filters write to the SAME store — URL search params,
   * say. FilterBar's default clear calls each `onChange('')` in turn, and if
   * each derives its next value from one snapshot of that store, the last write
   * wins and the others are silently lost. Screens in that situation clear
   * everything in a single write here instead.
   */
  onClearFilters?: () => void
  actions?: React.ReactNode
  footer?: React.ReactNode
  children: React.ReactNode
}) {
  const filterNode = Array.isArray(filters)
    ? <FilterBar filters={filters} onClearAll={onClearFilters} />
    : filters
  const hasToolbar = Boolean(search || filterNode || actions)
  return (
    <div className="ut-card overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-gray-200">
      {hasToolbar && (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-b border-gray-100 bg-white/50 px-6 py-5">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
            {search && (
              <div className="relative min-w-[240px] flex-1 sm:max-w-[320px]">
                <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  value={search.value}
                  onChange={(e) => search.onChange(e.target.value)}
                  placeholder={search.placeholder ?? 'Search records…'}
                  className="w-full rounded-[10px] border border-gray-200 bg-gray-50/50 py-2 pl-10 pr-4 text-sm font-medium text-gray-900 placeholder:text-gray-400 focus:border-emerald-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500 transition-all shadow-sm"
                />
              </div>
            )}
            {filterNode}
          </div>
          {actions && <div className="flex shrink-0 flex-wrap items-center gap-3">{actions}</div>}
        </div>
      )}
      <div className="overflow-x-auto bg-white">{children}</div>
      {footer && <div className="border-t border-gray-100 bg-gray-50/50 px-6 py-4">{footer}</div>}
    </div>
  )
}

/* ── FilterBar ──────────────────────────────────────────────────────────────
 *
 * One filter row for every list screen.
 *
 * Built on the NATIVE <select> styled by `.ut-select` rather than on the custom
 * HrSelect listbox, deliberately: 42 screens already use native selects and
 * only 2 use HrSelect, native gives correct keyboard and screen-reader
 * behaviour for free, and `.ut-select` already restyles the trigger (the OS
 * still owns the open list — see globals.css). HrSelect remains available where
 * a screen genuinely needs rich options.
 * ──────────────────────────────────────────────────────────────────────────── */

export interface FilterOption {
  value: string
  label: string
}

export interface FilterDef {
  /** Stable key — also the React key and the test handle. */
  key: string
  /**
   * For a select: the "all" option, e.g. "All Departments".
   * For text/date: the placeholder and the accessible name, e.g. "Actor email".
   */
  allLabel: string
  /** Current value; '' means unfiltered. */
  value: string
  /** Required for `type: 'select'` (the default); ignored otherwise. */
  options?: FilterOption[]
  onChange: (value: string) => void
  /** Hide entirely — e.g. a branch filter on a single-branch tenant. */
  hidden?: boolean
  /** Accessible name when it differs from `allLabel`. */
  ariaLabel?: string
  /**
   * Control shape. Defaults to 'select'.
   *
   * Added for the audit trail, whose six backend filters are not all
   * enumerable: `actor` and `resourceId` are free text and `from`/`to` are
   * dates. A select-only bar could not express them, and forking a
   * screen-specific bar would have put the product straight back to the
   * divergent filter rows this primitive exists to remove.
   */
  type?: 'select' | 'text' | 'date'
  /** Width hint in px for text/date inputs. Selects size themselves. */
  width?: number
}

export function FilterBar({ filters, onClearAll }: {
  filters: FilterDef[]
  /**
   * Called by "Clear all". Omit and FilterBar clears each filter itself by
   * calling every `onChange('')` — correct for the common case, so most callers
   * pass nothing.
   */
  onClearAll?: () => void
}) {
  const visible = filters.filter((f) => !f.hidden)
  const active = visible.filter((f) => f.value !== '')
  if (visible.length === 0) return null

  const clearAll = () => {
    if (onClearAll) onClearAll()
    else active.forEach((f) => f.onChange(''))
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {visible.map((f) => {
        // An active filter is tinted whatever its shape, so it is obvious at a
        // glance which constraints are narrowing the list — the commonest
        // "why can't I see my data" support question on list screens.
        const activeTint = f.value !== ''
          && 'border-[var(--accent-border)] bg-[var(--accent-bg)] font-semibold text-[var(--accent-fg-strong)]'
        // `key` is deliberately NOT part of this object: React requires it to be
        // passed directly to JSX, and spreading it warns on every render.
        const shared = {
          value: f.value,
          'aria-label': f.ariaLabel ?? f.allLabel,
          'data-filter': f.key,
          onChange: (e: React.ChangeEvent<HTMLSelectElement | HTMLInputElement>) => f.onChange(e.target.value),
        }

        if (f.type === 'text' || f.type === 'date') {
          return (
            <input
              key={f.key}
              {...shared}
              type={f.type === 'date' ? 'date' : 'text'}
              placeholder={f.type === 'text' ? f.allLabel : undefined}
              style={{ width: f.width ?? (f.type === 'date' ? 150 : 170) }}
              className={clsx('ut-input ut-input-sm', activeTint)}
            />
          )
        }

        return (
          <select
            key={f.key}
            {...shared}
            className={clsx('ut-select ut-select-sm w-auto min-w-[140px] max-w-[200px]', activeTint)}
          >
            <option value="">{f.allLabel}</option>
            {(f.options ?? []).map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        )
      })}

      {active.length > 0 && (
        <button
          type="button"
          onClick={clearAll}
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[12px] font-semibold text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
        >
          <X size={13} /> Clear {active.length === 1 ? 'filter' : `${active.length} filters`}
        </button>
      )}
    </div>
  )
}

// ── Row avatar (colored initials + name/sub) ─────────────────────────────────
const AV_COLORS = ['#0F6E56', '#0A5240', '#237D67', '#397467']
export function HrAvatar({ name, sub, seed = 0 }: { name?: string | null; sub?: string; seed?: number }) {
  // 2026-09-10: `name` was typed `string` and dereferenced directly with
  // name.split(' '). A report row whose employee_name came back NULL (Postgres
  // `x || NULL` is NULL — an employee with no last_name) therefore threw
  // "Cannot read properties of null (reading 'split')" INSIDE render, which
  // unmounts the entire React tree: the Attendance Analytics page went blank
  // and stayed blank through back/forward until a hard reload.
  //
  // A shared primitive used by ~20 tables must never be able to do that, no
  // matter what the server sends. The type now admits null and the value is
  // coerced before use.
  const safeName = (name ?? '').trim()
  const initials = safeName.split(' ').map((p) => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '?'
  const bg = AV_COLORS[Math.abs(seed) % AV_COLORS.length]
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold text-white shadow-xs" style={{ background: bg }}>
        {initials}
      </div>
      <div className="min-w-0">
        {/* Falls back to an em dash rather than rendering an empty row, so a
            missing name reads as absent data instead of a broken layout. */}
        <p className="truncate text-[13px] font-semibold text-[var(--text-primary)]">{safeName || '—'}</p>
        {sub && <p className="truncate text-xs font-medium text-[var(--text-tertiary)]">{sub}</p>}
      </div>
    </div>
  )
}

// ── Accessible tab bar (role=tablist + roving focus + arrow keys) ────────────
export interface HrTab { key: string; label: React.ReactNode; badge?: React.ReactNode }
export function HrTabs({ tabs, active, onChange, className }: {
  tabs: HrTab[]
  active: string
  onChange: (key: string) => void
  className?: string
}) {
  const ref = React.useRef<HTMLDivElement>(null)
  const pillId = React.useId()
  const focusTab = (i: number) => requestAnimationFrame(() =>
    ref.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[i]?.focus())
  // Scroll the selected tab into view whenever it changes.
  //
  // The tab strip is a horizontal scroller, which is the right mobile pattern,
  // but it meant the active tab could sit off-screen: land on
  // /hrms/employees/:id?tab=performance at 360px and the strip still showed
  // "Overview | Personal | Job", with the actually-selected tab several
  // hundred pixels to the right. `nearest` leaves an already-visible tab where
  // it is, so this is inert on desktop.
  React.useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[aria-selected="true"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [active])

  const onKeyDown = (e: React.KeyboardEvent) => {
    const i = tabs.findIndex((t) => t.key === active)
    if (i < 0) return
    let n = -1
    if (e.key === 'ArrowRight') n = (i + 1) % tabs.length
    else if (e.key === 'ArrowLeft') n = (i - 1 + tabs.length) % tabs.length
    else if (e.key === 'Home') n = 0
    else if (e.key === 'End') n = tabs.length - 1
    if (n >= 0) { e.preventDefault(); onChange(tabs[n].key); focusTab(n) }
  }
  return (
    <div className={clsx('mb-6 overflow-x-auto scrollbar-hide', className)}>
      <div
        ref={ref}
        role="tablist"
        onKeyDown={onKeyDown}
        className="inline-flex w-max items-center gap-1 rounded-[14px] bg-gray-100/80 p-1.5 shadow-inner"
      >
        {tabs.map((t) => {
          const sel = t.key === active
          return (
            <button
              key={t.key}
              role="tab"
              id={`tab-${t.key}`}
              aria-selected={sel}
              aria-controls={`panel-${t.key}`}
              tabIndex={sel ? 0 : -1}
              onClick={() => onChange(t.key)}
              className={clsx(
                'relative shrink-0 rounded-[10px] px-5 py-2 text-[13px] font-bold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500',
                sel ? 'text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700',
              )}
            >
              {sel && (
                <motion.span
                  layoutId={`hrtab-pill-${pillId}`}
                  aria-hidden
                  className="absolute inset-0 rounded-[10px] bg-white shadow-sm ring-1 ring-black/5"
                  transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                />
              )}
              <span className="relative z-10 inline-flex items-center gap-2">
                {t.label}
                {t.badge != null && (
                  <span
                    aria-hidden
                    className={clsx(
                      'rounded-full px-2 py-0.5 text-[10px] font-bold leading-none',
                      sel ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-200/50 text-gray-500',
                    )}
                  >
                    {t.badge}
                  </span>
                )}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function HrTabPanel({ tabKey, children }: { tabKey: string; children: React.ReactNode }) {
  return <div role="tabpanel" id={`panel-${tabKey}`} aria-labelledby={`tab-${tabKey}`} tabIndex={0} className="focus:outline-none">{children}</div>
}

// ── Custom select (listbox) ──────────────────────────────────────────────────
export interface HrSelectOption { value: string; label: React.ReactNode }
export function HrSelect({
  value, onChange, options, placeholder = 'Select…', size = 'md', disabled, className,
}: {
  value: string
  onChange: (value: string) => void
  options: HrSelectOption[]
  placeholder?: string
  size?: 'sm' | 'md'
  disabled?: boolean
  className?: string
}) {
  const [open, setOpen] = React.useState(false)
  const [active, setActive] = React.useState(-1)
  const rootRef = React.useRef<HTMLDivElement>(null)
  const btnRef = React.useRef<HTMLButtonElement>(null)
  const listRef = React.useRef<HTMLDivElement>(null)
  const listboxId = React.useId()
  const selectedIndex = options.findIndex((o) => o.value === value)
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined

  const openList = () => {
    if (disabled) return
    setActive(selectedIndex >= 0 ? selectedIndex : 0)
    setOpen(true)
  }
  const close = (refocus = true) => {
    setOpen(false)
    if (refocus) btnRef.current?.focus()
  }
  const commit = (i: number) => {
    const opt = options[i]
    if (opt) onChange(opt.value)
    close()
  }

  React.useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  React.useEffect(() => {
    if (!open) return
    listRef.current
      ?.querySelectorAll<HTMLElement>('[role="option"]')[active]
      ?.scrollIntoView({ block: 'nearest' })
  }, [open, active])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        openList()
      }
      return
    }
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); setActive((i) => Math.min(i + 1, options.length - 1)); break
      case 'ArrowUp':   e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); break
      case 'Home':      e.preventDefault(); setActive(0); break
      case 'End':       e.preventDefault(); setActive(options.length - 1); break
      case 'Enter': case ' ': e.preventDefault(); commit(active); break
      case 'Escape':    e.preventDefault(); close(); break
      case 'Tab':       close(false); break
    }
  }

  return (
    <div ref={rootRef} onKeyDown={onKeyDown} className={clsx('relative', className)}>
      <button
        ref={btnRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        onClick={() => (open ? close() : openList())}
        className={clsx(
          'ut-input flex items-center justify-between gap-2 text-left font-medium',
          size === 'sm' && 'ut-input-sm',
          open && '!border-[var(--border-focus)] !bg-white shadow-[0_0_0_4px_rgba(15,110,86,0.15)]',
        )}
      >
        <span className={clsx('truncate', !selected && 'text-[var(--text-tertiary)]')}>
          {selected?.label ?? placeholder}
        </span>
        <ChevronDown
          size={15}
          className={clsx('shrink-0 text-[var(--text-tertiary)] transition-transform duration-150', open && 'rotate-180')}
        />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            ref={listRef}
            role="listbox"
            id={listboxId}
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.13, ease: [0.16, 1, 0.3, 1] }}
            className="absolute left-0 right-0 top-[calc(100%+6px)] z-dropdown max-h-60 origin-top overflow-y-auto rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] py-1.5 shadow-[0_16px_48px_-16px_rgba(15,110,86,0.25)]"
          >
            {options.map((o, i) => {
              const isSelected = o.value === value
              return (
                <button
                  key={o.value}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => commit(i)}
                  onMouseEnter={() => setActive(i)}
                  className={clsx(
                    'flex w-full items-center justify-between gap-2 px-3.5 py-2 text-left text-sm font-medium transition-colors',
                    i === active && 'bg-[var(--accent-bg)]',
                    isSelected ? 'font-bold text-[var(--accent-fg)]' : 'text-[var(--text-primary)]',
                  )}
                >
                  <span className="truncate">{o.label}</span>
                  {isSelected && <Check size={15} className="shrink-0 text-[var(--accent-fg)]" />}
                </button>
              )
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Right-hand slide-over drawer ─────────────────────────────────────────────
export function HrDrawer({
  title, onClose, footer, children, width = 'max-w-lg',
}: {
  title: React.ReactNode
  onClose: () => void
  footer?: React.ReactNode
  children: React.ReactNode
  width?: string
}) {
  const panelRef = React.useRef<HTMLDivElement>(null)
  const titleId = React.useId()

  React.useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    panelRef.current?.focus()
    return () => previousFocus?.focus()
  }, [])

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div role="dialog" aria-modal="true" aria-labelledby={titleId} className="fixed inset-0 z-[1000]">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        onClick={onClose}
        aria-hidden
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
      />
      <motion.div
        ref={panelRef}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key !== 'Tab') return
          const elements = Array.from(panelRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]') ?? []).filter(element => element.offsetParent !== null)
          const first = elements[0], last = elements[elements.length - 1]
          if (!first) { event.preventDefault(); return }
          if (event.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) { event.preventDefault(); last.focus() }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
        }}
        initial={{ x: '100%', opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: '100%', opacity: 0 }}
        transition={{ type: 'spring', stiffness: 400, damping: 36 }}
        className={clsx(
          'absolute bottom-0 right-0 top-0 flex w-full flex-col bg-white shadow-2xl focus:outline-none border-l border-gray-200/60',
          width,
        )}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-gray-100 px-7 py-6">
          <h3 id={titleId} className="text-xl font-bold text-gray-900">{title}</h3>
          <button
            onClick={onClose}
            aria-label="Close panel"
            className="flex h-9 w-9 items-center justify-center rounded-full text-gray-400 bg-gray-50 transition-colors hover:bg-gray-100 hover:text-gray-700"
          >
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-7">{children}</div>
        {footer && (
          <div className="flex shrink-0 justify-end gap-3 border-t border-gray-100 bg-gray-50/80 px-7 py-5 backdrop-blur-md">
            {footer}
          </div>
        )}
      </motion.div>
    </div>, document.body
  )
}
