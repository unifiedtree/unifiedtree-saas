import React from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { cn } from '../cn';
import { Skeleton } from './Skeleton';
import type { LucideIcon } from 'lucide-react';

type Tone = 'default' | 'success' | 'warning' | 'error' | 'info';

const toneStyles: Record<Tone, { bg: string; icon: string }> = {
  default:  { bg: 'bg-[var(--bg-subtle)]',          icon: 'text-[var(--text-tertiary)]' },
  success:  { bg: 'bg-[var(--status-success-bg)]',   icon: 'text-[var(--status-success-fg)]' },
  warning:  { bg: 'bg-[var(--status-warning-bg)]',   icon: 'text-[var(--status-warning-fg)]' },
  error:    { bg: 'bg-[var(--status-error-bg)]',     icon: 'text-[var(--status-error-fg)]' },
  info:     { bg: 'bg-[var(--status-info-bg)]',      icon: 'text-[var(--status-info-fg)]' },
};

interface StatCardProps {
  label: string;
  value?: string | number;
  delta?: number;
  deltaLabel?: string;
  icon?: LucideIcon;
  tone?: Tone;
  className?: string;
}

export function StatCard({
  label,
  value,
  delta,
  deltaLabel,
  icon: Icon,
  tone = 'default',
  className,
}: StatCardProps) {
  const isLoading = value === undefined;
  const styles = toneStyles[tone];

  const deltaIsPositive = delta !== undefined && delta > 0;
  const deltaIsNegative = delta !== undefined && delta < 0;
  const DeltaIcon = deltaIsPositive ? TrendingUp : deltaIsNegative ? TrendingDown : Minus;

  return (
    <div
      className={cn(
        'rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-5 shadow-xs',
        className,
      )}
    >
      <div className="flex items-start justify-between">
        <p className="text-sm font-medium text-[var(--text-tertiary)]">{label}</p>
        {Icon && (
          <span className={cn('rounded-lg p-2', styles.bg)}>
            <Icon size={16} className={styles.icon} />
          </span>
        )}
      </div>

      <div className="mt-3">
        {isLoading ? (
          <>
            <Skeleton className="mb-2 h-8 w-24" />
            <Skeleton className="h-4 w-16" />
          </>
        ) : (
          <>
            <p className="text-2xl font-bold tracking-tight text-[var(--text-primary)]">
              {value}
            </p>
            {delta !== undefined && (
              <div
                className={cn(
                  'mt-1 flex items-center gap-1 text-xs font-medium',
                  deltaIsPositive && 'text-[var(--status-success-fg)]',
                  deltaIsNegative && 'text-[var(--status-error-fg)]',
                  !deltaIsPositive && !deltaIsNegative && 'text-[var(--text-tertiary)]',
                )}
              >
                <DeltaIcon size={12} />
                <span>
                  {delta > 0 ? '+' : ''}{delta}%{deltaLabel ? ` ${deltaLabel}` : ''}
                </span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
