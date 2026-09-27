import React from 'react'
import { clsx } from 'clsx'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, ChevronDown, Search, X } from 'lucide-react'
import { DateField } from './calendar'
import { SidePanel } from '@/design/kit/SidePanel'
import { StatusPill, type StatusTone } from '@/design/kit/StatusPill'
import { PageHeader } from '@/design/kit/PageHeader'
import { Avatar } from '@/design/kit/Avatar'
import { LegacyStatCard, statTone } from '@/design/dc/StatTile.view'

/**
 * Reusable building blocks shared by every HR list/detail screen so they all
 * share one look: the redesign's (design_handoff_hrms_redesign), drawn with the
 * design tokens var(--u-*) so light and dark both work. The stat card, status
 * pill, page header and avatar are the redesign kit's own pieces
 * (src/design/kit); the rest are styled to match them. All are presentational —
 * screens feed them live data from our React Query hooks.
 *
 * Brand colour is the emerald token (--u-br / --u-brt). Status colours
 * (success/warning/danger/info…) stay distinct for at-a-glance scanning.
 */

// ── KPI stat card ──────────────────────────────────────────────────────────────
// The design's stat card (prototype UtStat, kit StatCard "stat"): round tone
// icon, label, figure (counts up), then the change and the note.
type StatColor = 'blue' | 'green' | 'orange' | 'red' | 'purple' | 'teal'

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
  return (
    <LegacyStatCard
      label={label}
      value={value}
      icon={icon}
      tone={statTone(color)}
      note={sub}
      delta={trend?.value}
      trend={trend?.dir}
      mood={trend ? (trend.dir === 'up' ? 'good' : 'bad') : 'flat'}
      onClick={onClick}
      loading={loading}
    />
  )
}

// ── Status pill ──────────────────────────────────────────────────────────────
// The kit StatusPill (22px, 12px/500, soft fill + readable text in both themes).
// The old tone names map onto the design's palette.
export type PillTone = 'ok' | 'warn' | 'info' | 'late' | 'purple' | 'red' | 'pink' | 'teal' | 'gray' | 'green' | 'orange' | 'blue'
const PILL: Record<PillTone, StatusTone> = {
  ok: 'success',
  green: 'success',
  warn: 'warning',
  late: 'warning',
  orange: 'leave',
  info: 'info',
  blue: 'info',
  purple: 'holiday',
  pink: 'holiday',
  red: 'danger',
  teal: 'mint',
  gray: 'neutral',
}

export function HrStatusPill({ tone = 'gray', children }: { tone?: PillTone; children: React.ReactNode }) {
  return <StatusPill tone={PILL[tone] ?? 'neutral'}>{children}</StatusPill>
}

// ── Page header (title + subtitle + actions) ─────────────────────────────────
// The kit PageHeader: context line, 28/34 title, one-line summary, actions on
// the right, no card behind it (the design's page header).
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
    <div className={clsx('mb-5 min-w-0', className)}>
      <PageHeader eyebrow={crumb} title={title} sub={subtitle} actions={actions} />
      {(tabs || filters) && (
        <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          {tabs && <div className="min-w-0">{tabs}</div>}
          {filters && <div className="flex w-full flex-wrap items-center gap-3 sm:w-auto">{filters}</div>}
        </div>
      )}
    </div>
  )
}

// ── Green primary / white secondary / red buttons (the kit Button's look) ────
// Sizes: md = 38px (the design's default), sm = 32px (small inline buttons).
// Tailwind classes on purpose: callers' own utilities (mt-2, w-full, flex-1)
// keep working exactly as before.
const BTN_BASE =
  'btn-press inline-flex items-center justify-center whitespace-nowrap border font-medium leading-none transition-[background-color,border-color,color,box-shadow] duration-200 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-[.55]'
const BTN_SIZE = {
  md: 'h-[38px] gap-2 rounded-[10px] px-[14px] text-[13.5px]',
  sm: 'h-8 gap-1.5 rounded-[9px] px-3 text-[12.5px]',
}
const BTN_VARIANT = {
  primary:
    'border-transparent bg-[var(--u-br,#0F6E56)] text-[var(--u-onbr,#fff)] hover:bg-[var(--u-brh,#0B5A46)] focus-visible:shadow-[0_0_0_2px_var(--u-sf,#fff),0_0_0_4px_var(--u-br,#0F6E56)]',
  ghost:
    'border-[var(--u-ln,#E3E9E6)] bg-[var(--u-sf,#fff)] text-[var(--u-ink,#0E1B16)] hover:border-[var(--u-br,#0F6E56)] focus-visible:border-[var(--u-br,#0F6E56)] focus-visible:shadow-[var(--u-focus,0_0_0_3px_#E8F3EE)]',
  // The red fill stays the light-theme red in dark too (as the kit's danger), so white text keeps its contrast.
  danger:
    'border-transparent bg-[var(--u-danger-fill,#C4453A)] text-[var(--u-onbr,#fff)] hover:bg-[var(--u-danger-fill-h,#B23A2F)] focus-visible:shadow-[0_0_0_2px_var(--u-sf,#fff),0_0_0_4px_var(--u-br,#0F6E56)]',
}

export function HrButton({
  variant = 'primary', size = 'md', className, children, ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger'; size?: 'sm' | 'md' }) {
  return (
    <button
      {...rest}
      className={clsx(
        BTN_BASE,
        BTN_SIZE[size],
        BTN_VARIANT[variant],
        variant === 'primary' && size === 'md' && 'shadow-[0_12px_24px_-14px_rgba(15,110,86,.9),inset_0_1px_0_rgba(255,255,255,.16)]',
        variant === 'ghost' && size === 'sm' && 'hover:text-[var(--u-brt,#0F6E56)]',
        className,
      )}
    >
      {children}
    </button>
  )
}

// ── Table card: toolbar (search + actions) → scrollable table → footer ──
// The design's table card: white card (18px corners, hairline, card shadow), a
// toolbar with the 40px search field, the table scrolling sideways inside the
// card, and a quiet footer strip. Keeps the platform's .ut-card class.
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
    <div
      className="ut-card overflow-hidden"
      style={{ borderRadius: 18, borderColor: 'var(--u-ln,#E3E9E6)', background: 'var(--u-sf,#fff)', boxShadow: 'var(--u-shc,0 1px 2px rgba(14,27,22,.05))' }}
    >
      {hasToolbar && (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-b border-[var(--u-ln2,#EDF1EF)] px-5 py-4">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
            {search && (
              <div className="relative min-w-[240px] flex-1 sm:max-w-[320px]">
                <Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--u-ink3,#6A7A73)]" />
                <input
                  value={search.value}
                  onChange={(e) => search.onChange(e.target.value)}
                  placeholder={search.placeholder ?? 'Search records…'}
                  className="h-10 w-full rounded-[11px] border border-[var(--u-ln,#E3E9E6)] bg-[var(--u-sf,#fff)] pl-10 pr-3 text-[13.5px] text-[var(--u-ink,#0E1B16)] outline-none transition-[border-color,box-shadow] placeholder:text-[var(--u-ink3,#6A7A73)] hover:border-[var(--u-gy,#C9D2CE)] focus:border-[var(--u-br,#0F6E56)] focus:shadow-[var(--u-focus,0_0_0_3px_#E8F3EE)] focus-visible:outline-none"
                />
              </div>
            )}
            {filterNode}
          </div>
          {actions && <div className="flex shrink-0 flex-wrap items-center gap-3">{actions}</div>}
        </div>
      )}
      <div className="overflow-x-auto">{children}</div>
      {footer && <div className="border-t border-[var(--u-ln2,#EDF1EF)] bg-[var(--u-sf2,#F7F9F8)] px-5 py-3.5">{footer}</div>}
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

// The fields' colours as inline styles, so they follow the theme tokens (the
// shared .ut-input/.ut-select rules carry a light fill), and an active filter
// really shows its brand tint.
const FIELD_IDLE: React.CSSProperties = { backgroundColor: 'var(--u-sf,#fff)' }
const FIELD_ACTIVE: React.CSSProperties = { backgroundColor: 'var(--u-brs,#E8F3EE)', borderColor: 'var(--u-brl,#BFDFD1)', color: 'var(--u-brt,#0F6E56)' }

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
        const on = f.value !== ''
        const tint = on && 'font-medium'
        // `key` is deliberately NOT part of this object: React requires it to be
        // passed directly to JSX, and spreading it warns on every render.
        const shared = {
          value: f.value,
          'aria-label': f.ariaLabel ?? f.allLabel,
          'data-filter': f.key,
          onChange: (e: React.ChangeEvent<HTMLSelectElement | HTMLInputElement>) => f.onChange(e.target.value),
        }

        if (f.type === 'date') {
          // The shared calendar (day / month / year views); same width, onChange('yyyy-MM-dd' or '').
          return (
            <DateField
              key={f.key}
              value={f.value}
              aria-label={f.ariaLabel ?? f.allLabel}
              data-filter={f.key}
              placeholder={f.allLabel}
              onChange={(e) => f.onChange(e.target.value)}
              format="short"
              clearable
              style={{ width: f.width ?? 150, ...(on ? FIELD_ACTIVE : FIELD_IDLE) }}
              className={clsx('ut-input ut-input-sm', tint)}
            />
          )
        }

        if (f.type === 'text') {
          return (
            <input
              key={f.key}
              {...shared}
              type="text"
              placeholder={f.allLabel}
              style={{ width: f.width ?? 170, ...(on ? FIELD_ACTIVE : FIELD_IDLE) }}
              className={clsx('ut-input ut-input-sm', tint)}
            />
          )
        }

        return (
          <select
            key={f.key}
            {...shared}
            style={on ? FIELD_ACTIVE : FIELD_IDLE}
            className={clsx('ut-select ut-select-sm w-auto min-w-[140px] max-w-[200px]', tint)}
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
          className="inline-flex h-8 items-center gap-1 rounded-[8px] px-2.5 text-[12.5px] font-medium text-[var(--u-ink2,#4A5A54)] transition-colors hover:bg-[var(--u-hv,#F0F4F2)] hover:text-[var(--u-ink,#0E1B16)] focus-visible:outline-none focus-visible:shadow-[var(--u-focus,0_0_0_3px_#E8F3EE)]"
        >
          <X size={13} aria-hidden="true" /> Clear {active.length === 1 ? 'filter' : `${active.length} filters`}
        </button>
      )}
    </div>
  )
}

// ── Row avatar (initials + name/sub) ─────────────────────────────────────────
// The kit Avatar (36px circle, brand soft 2 with brand initials), then the name
// and a quiet second line.
export function HrAvatar({ name, sub, seed: _seed = 0 }: { name?: string | null; sub?: string; seed?: number }) {
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
  // The same two letters as before (first letters of the first two words).
  const initials = safeName.split(' ').map((p) => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '?'
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Avatar name={safeName || null} initials={initials} size={36} tone="soft" weight={600} />
      <div className="min-w-0">
        {/* Falls back to an em dash rather than rendering an empty row, so a
            missing name reads as absent data instead of a broken layout. */}
        <p className="truncate text-[13.5px] font-medium text-[var(--u-ink,#0E1B16)]">{safeName || '—'}</p>
        {sub && <p className="truncate text-[12px] text-[var(--u-ink3,#6A7A73)]">{sub}</p>}
      </div>
    </div>
  )
}

// ── Accessible tab bar (role=tablist + roving focus + arrow keys) ────────────
// The design's pill tabs (kit PillTabs look: 40px outlined pills, the active one
// solid brand green), keeping the tab roles, ids and keys this bar always had.
export interface HrTab { key: string; label: React.ReactNode; badge?: React.ReactNode }
export function HrTabs({ tabs, active, onChange, className }: {
  tabs: HrTab[]
  active: string
  onChange: (key: string) => void
  className?: string
}) {
  const ref = React.useRef<HTMLDivElement>(null)
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
    <div className={clsx('mb-6 min-w-0', className)}>
      <div
        ref={ref}
        role="tablist"
        onKeyDown={onKeyDown}
        className="uk-ptabs"
      >
        {tabs.map((t) => {
          const sel = t.key === active
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              id={`tab-${t.key}`}
              aria-selected={sel}
              aria-controls={`panel-${t.key}`}
              tabIndex={sel ? 0 : -1}
              data-active={sel ? 'true' : undefined}
              onClick={() => onChange(t.key)}
              className={clsx('uk-ptab', sel ? 'is-on' : 'ufx-spot')}
            >
              {t.label}
              {t.badge != null && (
                <span
                  aria-hidden
                  className={clsx(
                    'inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1.5 text-[11.5px] font-medium leading-none tabular-nums',
                    sel ? 'bg-white/20 text-[var(--u-onbr,#fff)]' : 'bg-[var(--u-hv,#F0F4F2)] text-[var(--u-ink2,#4A5A54)]',
                  )}
                >
                  {t.badge}
                </span>
              )}
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
// The trigger is the shared field; the list is the design's menu (12px corners,
// hairline, popover shadow).
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
        style={{ backgroundColor: 'var(--u-sf,#fff)' }}
        className={clsx(
          'ut-input flex items-center justify-between gap-2 text-left font-medium',
          size === 'sm' && 'ut-input-sm',
          open && '!border-[var(--u-br,#0F6E56)] !shadow-[var(--u-focus,0_0_0_3px_#E8F3EE)]',
        )}
      >
        <span className={clsx('truncate', !selected && 'text-[var(--u-ink3,#6A7A73)]')}>
          {selected?.label ?? placeholder}
        </span>
        <ChevronDown
          size={15}
          aria-hidden="true"
          className={clsx('shrink-0 text-[var(--u-ink3,#6A7A73)] transition-transform duration-150', open && 'rotate-180')}
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
            transition={{ duration: 0.13, ease: [0.2, 0.8, 0.2, 1] }}
            className="absolute left-0 right-0 top-[calc(100%+6px)] z-dropdown max-h-60 origin-top overflow-y-auto rounded-[12px] border border-[var(--u-ln,#E3E9E6)] bg-[var(--u-sf,#fff)] p-1.5 shadow-[var(--u-shp,0_24px_60px_-20px_rgba(14,27,22,.35))]"
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
                    'flex w-full items-center justify-between gap-2 rounded-[9px] px-3 py-2 text-left text-[13.5px] transition-colors',
                    i === active && 'bg-[var(--u-hv,#F0F4F2)]',
                    isSelected ? 'font-medium text-[var(--u-brt,#0F6E56)]' : 'text-[var(--u-ink,#0E1B16)]',
                  )}
                >
                  <span className="truncate">{o.label}</span>
                  {isSelected && <Check size={15} aria-hidden="true" className="shrink-0 text-[var(--u-brt,#0F6E56)]" />}
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
// The design's side panel (kit SidePanel): square edges, 1px left border, the gradient-blur
// backdrop as a sibling of the panel, round close button, sticky footer. Same props and
// behaviour as before: role="dialog" named by the title (an h3), close button "Close panel",
// Escape / backdrop / close call onClose, Tab stays inside, focus goes back on unmount.
// `width` is still a max-width class (full width on phones).
export function HrDrawer({
  title, onClose, footer, children, width = 'max-w-lg',
}: {
  title: React.ReactNode
  onClose: () => void
  footer?: React.ReactNode
  children: React.ReactNode
  width?: string
}) {
  return (
    <SidePanel open onClose={onClose} title={title} titleAs="h3" closeLabel="Close panel" panelClassName={clsx('w-full', width)} footer={footer}>
      {children}
    </SidePanel>
  )
}
