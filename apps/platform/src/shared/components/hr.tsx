import React from 'react'
import { clsx } from 'clsx'
import { Search } from 'lucide-react'

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
  green:  'bg-[var(--accent-bg)] text-[var(--accent-fg)]',
  blue:   'bg-[#EFF6FF] text-[#2563EB]',
  orange: 'bg-[#FFFBEB] text-[#D97706]',
  red:    'bg-[#FEF2F2] text-[#DC2626]',
  purple: 'bg-[#F5F3FF] text-[#7C3AED]',
  teal:   'bg-[#F0FDFA] text-[#0D9488]',
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
    <div className="group rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-[var(--border-strong)] hover:shadow-md">
      <div className="flex items-start justify-between">
        <div className={clsx('flex h-10 w-10 items-center justify-center rounded-xl', STAT_ICON[color])}>
          {icon}
        </div>
        {trend && (
          <span className={clsx(
            'inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-semibold',
            trend.dir === 'up'
              ? 'bg-[var(--status-success-bg)] text-[var(--status-success-fg)]'
              : 'bg-[var(--status-error-bg)] text-[var(--status-error-fg)]',
          )}>
            {trend.dir === 'up' ? '↑' : '↓'} {trend.value}
          </span>
        )}
      </div>
      <p className="mt-4 text-[28px] font-semibold leading-none tracking-tight tabular-nums text-[var(--text-primary)]">
        {loading ? <span className="inline-block h-7 w-16 animate-pulse-subtle rounded bg-[var(--bg-subtle)]" /> : value}
      </p>
      <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--text-tertiary)]">{label}</p>
      {sub && <p className="mt-1 text-xs text-[var(--text-secondary)]">{sub}</p>}
    </div>
  )
}

// ── Status pill ──────────────────────────────────────────────────────────────
export type PillTone = 'ok' | 'warn' | 'info' | 'late' | 'purple' | 'red' | 'pink' | 'teal' | 'gray' | 'green' | 'orange' | 'blue'
const PILL: Record<PillTone, string> = {
  ok:     'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  green:  'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  warn:   'bg-amber-50 text-amber-700 ring-amber-600/20',
  orange: 'bg-orange-50 text-orange-700 ring-orange-600/20',
  info:   'bg-blue-50 text-blue-700 ring-blue-700/10',
  blue:   'bg-blue-50 text-blue-700 ring-blue-700/10',
  late:   'bg-orange-50 text-orange-700 ring-orange-600/20',
  purple: 'bg-purple-50 text-purple-700 ring-purple-700/10',
  red:    'bg-rose-50 text-rose-700 ring-rose-600/10',
  pink:   'bg-pink-50 text-pink-700 ring-pink-700/10',
  teal:   'bg-teal-50 text-teal-700 ring-teal-600/20',
  gray:   'bg-slate-50 text-slate-600 ring-slate-500/10',
}

export function HrStatusPill({ tone = 'gray', children }: { tone?: PillTone; children: React.ReactNode }) {
  return (
    <span className={clsx('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset', PILL[tone])}>
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
        {crumb && <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-tertiary)]">{crumb}</p>}
        <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-[var(--text-primary)]">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-[var(--text-secondary)]">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
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
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-all duration-150 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
        size === 'sm' ? 'h-8 px-3 text-xs' : 'h-9 px-4 text-sm',
        variant === 'primary' && 'bg-[var(--interactive-primary)] text-white shadow-sm hover:bg-[var(--interactive-primary-hover)]',
        variant === 'ghost' && 'border border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-xs hover:bg-[var(--bg-subtle)] hover:border-[var(--border-strong)]',
        variant === 'danger' && 'bg-[var(--interactive-danger)] text-white shadow-sm hover:bg-[var(--interactive-danger-hover)]',
        className,
      )}
    >
      {children}
    </button>
  )
}

// ── Table card: gray toolbar (search + actions) → scrollable table → footer ──
export function TableCard({
  search, actions, footer, children,
}: {
  search?: { value: string; onChange: (v: string) => void; placeholder?: string }
  actions?: React.ReactNode
  footer?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] shadow-sm">
      {(search || actions) && (
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3.5 py-3">
          {search && (
            <div className="relative min-w-[220px] flex-1">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" />
              <input
                value={search.value}
                onChange={(e) => search.onChange(e.target.value)}
                placeholder={search.placeholder ?? 'Search…'}
                className="h-9 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-base)] py-1.5 pl-9 pr-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] outline-none transition-[border-color,box-shadow] focus:border-[var(--border-focus)] focus:bg-[var(--bg-surface)] focus:ring-4 focus:ring-[var(--accent-solid)]/12"
              />
            </div>
          )}
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className="overflow-x-auto">{children}</div>
      {footer && <div className="border-t border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-3">{footer}</div>}
    </div>
  )
}

// ── Row avatar (colored initials + name/sub) ─────────────────────────────────
const AV_COLORS = ['#6C5CE7', '#E8590C', '#059669', '#2563EB', '#D97706', '#DB2777', '#0D9488', '#7C3AED', '#0891B2', '#65A30D']
export function HrAvatar({ name, sub, seed = 0 }: { name: string; sub?: string; seed?: number }) {
  const initials = name.split(' ').map((p) => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '?'
  const bg = AV_COLORS[Math.abs(seed) % AV_COLORS.length]
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white" style={{ background: bg }}>
        {initials}
      </div>
      <div className="min-w-0">
        <p className="truncate text-[13px] font-semibold text-[var(--text-primary)]">{name}</p>
        {sub && <p className="truncate text-xs text-[var(--text-tertiary)]">{sub}</p>}
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
    <div ref={ref} role="tablist" onKeyDown={onKeyDown}
      className={clsx('mb-6 flex gap-1 border-b border-[var(--border-default)]', className)}>
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
              '-mb-px inline-flex items-center gap-1.5 border-b-2 px-3.5 py-2.5 text-sm font-medium transition-colors',
              sel ? 'border-[var(--accent-solid)] text-[var(--accent-fg-strong)]' : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
            )}
          >
            {t.label}
            {t.badge != null && <span aria-hidden>{t.badge}</span>}
          </button>
        )
      })}
    </div>
  )
}

// Wrap the active tab's content so screen readers associate it with its tab.
export function HrTabPanel({ tabKey, children }: { tabKey: string; children: React.ReactNode }) {
  return <div role="tabpanel" id={`panel-${tabKey}`} aria-labelledby={`tab-${tabKey}`} tabIndex={0} className="focus:outline-none">{children}</div>
}
