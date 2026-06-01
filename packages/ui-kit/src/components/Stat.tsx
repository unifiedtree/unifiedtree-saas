import React from 'react'
import { cn } from '../lib/cn'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { Skeleton } from './Skeleton'

type Trend = 'up' | 'down' | 'neutral'

const trendConfig: Record<Trend, { icon: React.FC<{ size?: number }>, color: string, label: string }> = {
  up: {
    icon: ({ size = 14 }) => <TrendingUp size={size} />,
    color: 'text-emerald-400',
    label: 'increase',
  },
  down: {
    icon: ({ size = 14 }) => <TrendingDown size={size} />,
    color: 'text-red-400',
    label: 'decrease',
  },
  neutral: {
    icon: ({ size = 14 }) => <Minus size={size} />,
    color: 'text-slate-400',
    label: 'no change',
  },
}

export interface StatProps extends React.HTMLAttributes<HTMLDivElement> {
  label: string
  value: string | number
  trend?: Trend
  trendValue?: string
  trendLabel?: string
  icon?: React.ReactNode
  iconColor?: string
  loading?: boolean
  variant?: 'default' | 'compact' | 'featured'
}

export const Stat: React.FC<StatProps> = ({
  label,
  value,
  trend,
  trendValue,
  trendLabel,
  icon,
  iconColor = 'text-indigo-400',
  loading = false,
  variant = 'default',
  className,
  ...props
}) => {
  if (loading) {
    return (
      <div
        className={cn(
          'rounded-2xl border border-slate-700/50 bg-slate-900/60 p-6',
          variant === 'featured' && 'border-indigo-500/30',
          className
        )}
        {...props}
      >
        <div className="flex items-start justify-between mb-3">
          <Skeleton height={14} width="50%" />
          {icon && <Skeleton width={36} height={36} rounded />}
        </div>
        <Skeleton height={32} width="70%" className="mb-2" />
        <Skeleton height={12} width="40%" />
      </div>
    )
  }

  if (variant === 'compact') {
    const TIcon = trend ? trendConfig[trend].icon : null
    const tColor = trend ? trendConfig[trend].color : ''
    return (
      <div className={cn('flex items-center justify-between', className)} {...props}>
        <div className="flex items-center gap-2">
          {icon && <span className={cn('shrink-0', iconColor)}>{icon}</span>}
          <span className="text-sm text-slate-400">{label}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-slate-200">{value}</span>
          {TIcon && trendValue && (
            <span className={cn('flex items-center gap-0.5 text-xs', tColor)}>
              <TIcon />
              {trendValue}
            </span>
          )}
        </div>
      </div>
    )
  }

  const TrendIcon = trend ? trendConfig[trend].icon : null
  const trendColor = trend ? trendConfig[trend].color : ''

  return (
    <div
      className={cn(
        'rounded-2xl border bg-slate-900/60 p-6 flex flex-col gap-3',
        variant === 'featured'
          ? 'border-indigo-500/30 bg-gradient-to-br from-slate-900/80 to-indigo-900/10 shadow-lg shadow-indigo-500/10'
          : 'border-slate-700/50',
        className
      )}
      {...props}
    >
      <div className="flex items-start justify-between">
        <p className="text-sm font-medium text-slate-400">{label}</p>
        {icon && (
          <div
            className={cn(
              'w-9 h-9 rounded-lg flex items-center justify-center bg-slate-800/60 border border-slate-700/50',
              iconColor
            )}
          >
            {icon}
          </div>
        )}
      </div>
      <p
        className={cn(
          'font-bold text-slate-100 leading-none',
          variant === 'featured' ? 'text-4xl' : 'text-2xl'
        )}
      >
        {value}
      </p>
      {(TrendIcon && (trendValue || trendLabel)) && (
        <div className="flex items-center gap-1.5">
          <span className={cn('flex items-center gap-1 text-xs font-semibold', trendColor)}>
            <TrendIcon />
            {trendValue}
          </span>
          {trendLabel && <span className="text-xs text-slate-500">{trendLabel}</span>}
        </div>
      )}
    </div>
  )
}
