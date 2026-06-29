import React from 'react'
import { clsx } from 'clsx'
import { Search } from 'lucide-react'

/**
 * Reusable building blocks that match the client HR mockup's component patterns
 * exactly, so every HR list/detail screen shares one faithful look. All are
 * presentational — screens feed them live data from our React Query hooks.
 */

// ── KPI stat card ──────────────────────────────────────────────────────────────
type StatColor = 'blue' | 'green' | 'orange' | 'red' | 'purple' | 'teal'
const STAT_ICON: Record<StatColor, string> = {
  blue:   'bg-[#DBEAFE] text-[#2563EB]',
  green:  'bg-[#D1FAE5] text-[#10B981]',
  orange: 'bg-[#FEF3C7] text-[#F59E0B]',
  red:    'bg-[#FEE2E2] text-[#EF4444]',
  purple: 'bg-[#EDE9FE] text-[#8B5CF6]',
  teal:   'bg-[#CCFBF1] text-[#0F766E]',
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
    <div className="rounded-xl border border-border-default bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between">
        <div className={clsx('flex h-9 w-9 items-center justify-center rounded-lg', STAT_ICON[color])}>
          {icon}
        </div>
        {trend && (
          <span className={clsx(
            'rounded-full px-2 py-0.5 text-[11px] font-semibold',
            trend.dir === 'up' ? 'bg-[#DCFCE7] text-[#15803D]' : 'bg-[#FEE2E2] text-[#B91C1C]',
          )}>
            {trend.dir === 'up' ? '↑' : '↓'} {trend.value}
          </span>
        )}
      </div>
      <p className="mt-3 text-2xl font-bold leading-none text-text-primary">{loading ? '—' : value}</p>
      <p className="mt-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">{label}</p>
      {sub && <p className="mt-1 text-xs text-text-secondary">{sub}</p>}
    </div>
  )
}

// ── Status pill ──────────────────────────────────────────────────────────────
export type PillTone = 'ok' | 'warn' | 'info' | 'late' | 'purple' | 'red' | 'pink' | 'teal' | 'gray' | 'green' | 'orange' | 'blue'
const PILL: Record<PillTone, string> = {
  ok:     'bg-[#DCFCE7] text-[#15803D]',
  green:  'bg-[#DCFCE7] text-[#15803D]',
  warn:   'bg-[#FEF3C7] text-[#B45309]',
  orange: 'bg-[#FFEDD5] text-[#C2410C]',
  info:   'bg-[#DBEAFE] text-[#1D4ED8]',
  blue:   'bg-[#DBEAFE] text-[#1D4ED8]',
  late:   'bg-[#FED7AA] text-[#C2410C]',
  purple: 'bg-[#F3E8FF] text-[#7C3AED]',
  red:    'bg-[#FEE2E2] text-[#B91C1C]',
  pink:   'bg-[#FCE7F3] text-[#BE185D]',
  teal:   'bg-[#CCFBF1] text-[#0F766E]',
  gray:   'bg-[#F4F4F6] text-[#6B7280]',
}

export function HrStatusPill({ tone = 'gray', children }: { tone?: PillTone; children: React.ReactNode }) {
  return (
    <span className={clsx('inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold', PILL[tone])}>
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
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        {crumb && <p className="mb-0.5 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">{crumb}</p>}
        <h1 className="text-[22px] font-bold leading-tight text-text-primary">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-text-secondary">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

// ── Amber primary / ghost buttons (client style) ─────────────────────────────
export function HrButton({
  variant = 'primary', size = 'md', className, children, ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger'; size?: 'sm' | 'md' }) {
  return (
    <button
      {...rest}
      className={clsx(
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-semibold transition-colors disabled:opacity-50',
        size === 'sm' ? 'px-2.5 py-1.5 text-xs' : 'px-3.5 py-2 text-sm',
        variant === 'primary' && 'bg-[#FF9D00] text-white hover:bg-[#E08A00]',
        variant === 'ghost' && 'border border-border-default bg-white text-text-primary hover:bg-bg-base',
        variant === 'danger' && 'bg-[#EF4444] text-white hover:bg-[#DC2626]',
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
    <div className="overflow-hidden rounded-xl border border-border-default bg-white shadow-sm">
      {(search || actions) && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border-default bg-bg-base px-3 py-2.5">
          {search && (
            <div className="relative min-w-[220px] flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
              <input
                value={search.value}
                onChange={(e) => search.onChange(e.target.value)}
                placeholder={search.placeholder ?? 'Search…'}
                className="w-full rounded-lg border border-border-default bg-white py-1.5 pl-8 pr-3 text-sm focus:border-[#FF9D00] focus:outline-none focus:ring-2 focus:ring-[#FF9D00]/20"
              />
            </div>
          )}
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className="overflow-x-auto">{children}</div>
      {footer && <div className="border-t border-border-default bg-bg-base px-4 py-3">{footer}</div>}
    </div>
  )
}

// ── Row avatar (colored initials + name/sub) ─────────────────────────────────
const AV_COLORS = ['#6C5CE7', '#FF6B6B', '#22C55E', '#4096FF', '#F59E0B', '#EC4899', '#14B8A6', '#A855F7', '#06B6D4', '#84CC16']
export function HrAvatar({ name, sub, seed = 0 }: { name: string; sub?: string; seed?: number }) {
  const initials = name.split(' ').map((p) => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '?'
  const bg = AV_COLORS[Math.abs(seed) % AV_COLORS.length]
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white" style={{ background: bg }}>
        {initials}
      </div>
      <div className="min-w-0">
        <p className="truncate text-[13px] font-semibold text-text-primary">{name}</p>
        {sub && <p className="truncate text-xs text-text-tertiary">{sub}</p>}
      </div>
    </div>
  )
}
