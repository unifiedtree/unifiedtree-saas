import React from 'react'
import { clsx } from 'clsx'

/**
 * Skeleton primitives — the honest replacement for the "preloading" spinners
 * and hardcoded welcome splashes that used to cover a real network wait.
 *
 * A spinner conveys "something is happening"; a skeleton conveys "the shape of
 * what you'll see, at the position you'll see it, as soon as we have it". That
 * cuts the perceived wait roughly in half because layout doesn't shift when
 * the data arrives — the tiles fade into the exact rectangles their skeletons
 * were sitting in.
 *
 * All variants share:
 *   - a subtle animated pulse (no shimmer sweep — that reads as marketing, not
 *     a working UI)
 *   - the same rounded-xl geometry as the real card, so the swap is invisible
 *   - a light-grey token background that stays legible in both themes
 *
 * Use these directly as fallbacks for TanStack Query `isPending` or React
 * Suspense boundaries.
 */

/** Reusable animated block. `w`/`h` optional so callers can size inline. */
export function SkeletonBlock({
  className,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden
      className={clsx(
        'animate-pulse rounded bg-[var(--bg-subtle)]',
        className,
      )}
      {...rest}
    />
  )
}

/**
 * A single dashboard tile skeleton — matches the geometry of {@code HrStatCard}
 * (border-xl card, icon square top-left, big number, label). Screen readers
 * are told "Loading" once at the wrapper so the entire tile is a single quiet
 * announcement rather than a chorus of decorative blocks.
 */
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
        'ut-card ut-card-sm p-5',
        className,
      )}
    >
      <div className="flex items-start justify-between">
        <SkeletonBlock className="h-10 w-10 rounded-xl" />
        <SkeletonBlock className="h-4 w-12 rounded-full" />
      </div>
      <SkeletonBlock className="mt-4 h-7 w-16" />
      <SkeletonBlock className="mt-3 h-3 w-24" />
      <SkeletonBlock className="mt-2 h-3 w-32" />
    </div>
  )
}

/**
 * A grid of {@link SkeletonCard} tiles. Given a `count`, lays them out in the
 * same 1 / 2 / 4-col responsive grid the KPI row uses so the fade-in doesn't
 * reflow the header underneath.
 */
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
        'grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4',
        className,
      )}
    >
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  )
}

/**
 * A skeleton row (thumbnail + two text lines) — useful for list previews such
 * as the "Recent Attendance" panel while the query resolves.
 */
export function SkeletonRow({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={clsx('flex items-center gap-3 py-2.5', className)}
    >
      <SkeletonBlock className="h-8 w-8 rounded-full" />
      <div className="min-w-0 flex-1 space-y-2">
        <SkeletonBlock className="h-3 w-40 max-w-full" />
        <SkeletonBlock className="h-2.5 w-24 max-w-full" />
      </div>
      <SkeletonBlock className="h-5 w-16 rounded-full" />
    </div>
  )
}
