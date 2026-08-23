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
        // Platform card surface — see .ut-card in apps/platform/src/globals.css.
        'ut-card ut-card-sm group p-5',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-[13px] font-medium text-[var(--text-secondary)]">{label}</p>
        {Icon && (
          <span className={cn('flex h-9 w-9 items-center justify-center rounded-lg', styles.bg)}>
            <Icon size={17} className={styles.icon} />
          </span>
        )}
      </div>

      <div className="mt-4">
        {isLoading ? (
          <>
            <Skeleton className="mb-2 h-8 w-24" />
            <Skeleton className="h-4 w-16" />
          </>
        ) : (
          <div className="flex items-end justify-between gap-2">
            <p className="text-3xl font-semibold tabular-nums tracking-tight text-[var(--text-primary)]">
              {value}
            </p>
            {delta !== undefined && (
              <span
                className={cn(
                  'mb-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold',
                  deltaIsPositive && 'bg-[var(--status-success-bg)] text-[var(--status-success-fg)]',
                  deltaIsNegative && 'bg-[var(--status-error-bg)] text-[var(--status-error-fg)]',
                  !deltaIsPositive && !deltaIsNegative && 'bg-[var(--bg-subtle)] text-[var(--text-tertiary)]',
                )}
              >
                <DeltaIcon size={12} />
                {delta > 0 ? '+' : ''}{delta}%
              </span>
            )}
          </div>
        )}
        {!isLoading && deltaLabel && (
          <p className="mt-1.5 text-xs text-[var(--text-tertiary)]">{deltaLabel}</p>
        )}
      </div>
    </div>
  );
}
