import React from 'react'
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
  icon, color = 'blue', value, label, trend, sub, loading,
}: {
  icon: React.ReactNode
  color?: StatColor
  value: React.ReactNode
  label: string
  trend?: { dir: 'up' | 'down'; value: string }
  sub?: React.ReactNode
  loading?: boolean
}) {
  return (
    <div className="ut-card ut-card-sm ut-card-hover group relative overflow-hidden p-5 transition-all duration-300">
      <div className="flex items-start justify-between">
        <div className={clsx('flex h-11 w-11 items-center justify-center rounded-2xl transition-transform duration-200 group-hover:scale-105', STAT_ICON[color])}>
          {icon}
        </div>
        {trend && (
          <span className={clsx(
            'inline-flex items-center gap-0.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold tracking-tight',
            trend.dir === 'up'
              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/80 dark:text-emerald-300'
              : 'bg-rose-50 text-rose-700 dark:bg-rose-950/80 dark:text-rose-300',
          )}>
            {trend.dir === 'up' ? '↑' : '↓'} {trend.value}
          </span>
        )}
      </div>
      <p className="mt-4 text-[28px] font-bold leading-none tracking-tight tabular-nums text-[var(--text-primary)]">
        {loading ? <span className="inline-block h-7 w-20 animate-pulse-subtle rounded-md bg-[var(--bg-subtle)]" /> : value}
      </p>
      <p className="mt-2.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--text-tertiary)]">{label}</p>
      {sub && <p className="mt-1 text-xs font-medium text-[var(--text-secondary)]">{sub}</p>}
    </div>
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
  title, subtitle, crumb, actions,
}: {
  title: string
  subtitle?: React.ReactNode
  crumb?: string
  actions?: React.ReactNode
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        {crumb && <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--accent-fg)]">{crumb}</p>}
        <h1 className="text-[26px] font-bold leading-tight tracking-tight text-[var(--text-primary)]">{title}</h1>
        {subtitle && <p className="mt-1 text-sm font-medium text-[var(--text-secondary)]">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2.5">{actions}</div>}
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
        'btn-press inline-flex items-center justify-center gap-1.5 rounded-xl font-semibold transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
        size === 'sm' ? 'h-8 px-3 text-xs' : 'h-9.5 px-4 text-sm',
        variant === 'primary' && 'bg-[var(--interactive-primary)] text-white shadow-[0_4px_14px_0_rgba(15,110,86,0.35)] hover:bg-[var(--interactive-primary-hover)] hover:shadow-[0_6px_20px_0_rgba(15,110,86,0.45)]',
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
  search, actions, footer, children,
}: {
  search?: { value: string; onChange: (v: string) => void; placeholder?: string }
  actions?: React.ReactNode
  footer?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="ut-card overflow-hidden">
      {(search || actions) && (
        <div className="flex flex-wrap items-center gap-3 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-3.5">
          {search && (
            <div className="relative min-w-[240px] flex-1">
              <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" />
              <input
                value={search.value}
                onChange={(e) => search.onChange(e.target.value)}
                placeholder={search.placeholder ?? 'Search records…'}
                className="ut-input ut-input-sm pl-9.5"
              />
            </div>
          )}
          {actions && <div className="flex flex-wrap items-center gap-2.5">{actions}</div>}
        </div>
      )}
      <div className="overflow-x-auto">{children}</div>
      {footer && <div className="border-t border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-3.5">{footer}</div>}
    </div>
  )
}

// ── Row avatar (colored initials + name/sub) ─────────────────────────────────
const AV_COLORS = ['#0F6E56', '#2563EB', '#D97706', '#DB2777', '#0D9488', '#7C3AED', '#0891B2', '#059669']
export function HrAvatar({ name, sub, seed = 0 }: { name: string; sub?: string; seed?: number }) {
  const initials = name.split(' ').map((p) => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '?'
  const bg = AV_COLORS[Math.abs(seed) % AV_COLORS.length]
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-8.5 w-8.5 shrink-0 items-center justify-center rounded-xl text-[11px] font-bold text-white shadow-xs" style={{ background: bg }}>
        {initials}
      </div>
      <div className="min-w-0">
        <p className="truncate text-[13px] font-semibold text-[var(--text-primary)]">{name}</p>
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
        className="ut-card ut-card-sm inline-flex w-max items-center gap-1 p-1.5"
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
                'relative shrink-0 rounded-xl px-4 py-2 text-xs font-bold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]',
                sel ? 'text-white' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
              )}
            >
              {sel && (
                <motion.span
                  layoutId={`hrtab-pill-${pillId}`}
                  aria-hidden
                  className="absolute inset-0 rounded-xl bg-[var(--interactive-primary)] shadow-[0_4px_14px_0_rgba(15,110,86,0.35)]"
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
                      sel ? 'bg-white/20 text-white' : 'bg-[var(--accent-bg)] text-[var(--accent-fg)]',
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
  title, onClose, footer, children, width = 'max-w-md',
}: {
  title: React.ReactNode
  onClose: () => void
  footer?: React.ReactNode
  children: React.ReactNode
  width?: string
}) {
  const panelRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    panelRef.current?.focus()
  }, [])

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-modal-backdrop">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.18 }}
        onClick={onClose}
        aria-hidden
        className="absolute inset-0 bg-slate-950/50 backdrop-blur-sm"
      />
      <motion.div
        ref={panelRef}
        tabIndex={-1}
        initial={{ x: 56, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 400, damping: 36 }}
        className={clsx(
          'absolute bottom-0 right-0 top-0 z-modal flex w-full flex-col border-l border-[var(--border-default)] bg-[var(--bg-surface)] shadow-[-32px_0_72px_-32px_rgba(15,110,86,0.35)] focus:outline-none',
          width,
        )}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--border-subtle)] px-6 py-4.5">
          <h3 className="text-base font-bold text-[var(--text-primary)]">{title}</h3>
          <button
            onClick={onClose}
            aria-label="Close panel"
            className="flex h-8 w-8 items-center justify-center rounded-xl text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)]"
          >
            <X size={17} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-6">{children}</div>
        {footer && (
          <div className="flex shrink-0 justify-end gap-3 border-t border-[var(--border-subtle)] bg-[var(--bg-subtle)]/50 p-5">
            {footer}
          </div>
        )}
      </motion.div>
    </div>
  )
}
