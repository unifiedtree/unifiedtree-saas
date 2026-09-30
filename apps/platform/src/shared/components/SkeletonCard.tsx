// Loading placeholders in the redesign's look: soft token-tinted shapes with the
// design's slow shimmer (the kit Skeleton's gradient; still when motion is
// reduced), a stat-card outline (prototype PgGeneric) and a list row.
import React from 'react'
import { clsx } from 'clsx'
// For the `uk-shimmer` keyframes.
import '@/design/kit/display.css'

// The kit Skeleton's shimmer (display.css `uk-shimmer`), as utilities so a
// caller's own classes (sizes, radius, display) keep winning as before.
const SHIMMER =
  'bg-[linear-gradient(90deg,var(--u-hv,#F0F4F2)_0%,var(--u-sf2,#F7F9F8)_45%,var(--u-hv,#F0F4F2)_90%)] bg-[length:200%_100%] animate-[uk-shimmer_1.3s_ease-in-out_infinite]'

export function SkeletonBlock({
  className,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden
      className={clsx(
        'rounded',
        SHIMMER,
        className,
      )}
      {...rest}
    />
  )
}

export function SkeletonCard({
  className,
  ariaLabel = 'Loading',
}: {
  className?: string
  ariaLabel?: string
}) {
  return (
    <div
      role="status"
      aria-label={ariaLabel}
      className={clsx(
        'ut-card ut-card-sm flex min-h-[132px] flex-col justify-between p-[18px]',
        className,
      )}
      style={{ borderRadius: 16, borderColor: 'var(--u-ln,#E3E9E6)', background: 'var(--u-sf,#fff)', boxShadow: 'var(--u-shc,0 1px 2px rgba(14,27,22,.05))' }}
    >
      <SkeletonBlock className="h-[42px] w-[42px] !rounded-full" />
      <div className="flex flex-col gap-2">
        <SkeletonBlock className="h-2.5 w-[52%]" />
        <SkeletonBlock className="h-[18px] w-[34%] !rounded-md" />
      </div>
    </div>
  )
}

export function SkeletonCardGrid({
  count = 4,
  className,
}: {
  count?: number
  className?: string
}) {
  return (
    <div
      className={clsx(
        'grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4',
        className,
      )}
    >
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  )
}

export function SkeletonRow({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={clsx('flex items-center gap-3 py-2.5', className)}
    >
      <SkeletonBlock className="h-8 w-8 rounded-full" />
      <div className="min-w-0 flex-1 space-y-2">
        <SkeletonBlock className="h-2.5 w-40 max-w-full" />
        <SkeletonBlock className="h-2 w-24 max-w-full" />
      </div>
      <SkeletonBlock className="h-[22px] w-16 rounded-full" />
    </div>
  )
}
