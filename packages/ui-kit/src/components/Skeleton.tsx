import React from 'react';
import { cn } from '../cn';

// ─── Base Skeleton ───────────────────────────────────────────────────────────
interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  rounded?: boolean;
}

export function Skeleton({ className, rounded = false, ...props }: SkeletonProps) {
  return (
    <div
      className={cn(
        'animate-pulse bg-gradient-to-r from-[var(--bg-muted)] via-[var(--bg-subtle)] to-[var(--bg-muted)]',
        'bg-[length:200%_100%]',
        rounded ? 'rounded-full' : 'rounded-md',
        '[animation:shimmer_2s_ease-in-out_infinite]',
        className,
      )}
      aria-hidden="true"
      {...props}
    />
  );
}

// ─── TableSkeleton ───────────────────────────────────────────────────────────
interface TableSkeletonProps {
  rows?: number;
  cols?: number;
  className?: string;
}

export function TableSkeleton({ rows = 5, cols = 4, className }: TableSkeletonProps) {
  return (
    <div className={cn('w-full', className)} role="status" aria-label="Loading table data">
      {/* Header */}
      <div className="flex gap-4 border-b border-[var(--border-default)] px-4 py-3">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} className="h-4 flex-1" style={{ maxWidth: i === 0 ? '40%' : undefined }} />
        ))}
      </div>
      {/* Rows */}
      {Array.from({ length: rows }).map((_, row) => (
        <div key={row} className="flex gap-4 border-b border-[var(--border-subtle)] px-4 py-3">
          {Array.from({ length: cols }).map((_, col) => (
            <Skeleton
              key={col}
              className="h-4 flex-1"
              style={{ opacity: 1 - row * 0.1, maxWidth: col === 0 ? '40%' : undefined }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

// ─── CardSkeleton ─────────────────────────────────────────────────────────────
export function CardSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-6',
        className,
      )}
      role="status"
      aria-label="Loading"
    >
      <Skeleton className="mb-3 h-5 w-2/5" />
      <Skeleton className="mb-2 h-4 w-full" />
      <Skeleton className="mb-2 h-4 w-4/5" />
      <Skeleton className="h-4 w-3/5" />
    </div>
  );
}

// ─── StatsSkeleton ────────────────────────────────────────────────────────────
export function StatsSkeleton({ count = 4, className }: { count?: number; className?: string }) {
  return (
    <div
      className={cn('grid gap-4', className)}
      style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}
      role="status"
      aria-label="Loading stats"
    >
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-5"
        >
          <Skeleton className="mb-3 h-4 w-1/2" />
          <Skeleton className="mb-2 h-8 w-3/4" />
          <Skeleton className="h-3 w-2/5" />
        </div>
      ))}
    </div>
  );
}
