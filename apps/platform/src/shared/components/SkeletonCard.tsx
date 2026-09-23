import React from 'react'
import { clsx } from 'clsx'

export function SkeletonBlock({
  className,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden
      className={clsx(
        'animate-pulse rounded bg-gray-100',
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
        'ut-card ut-card-sm p-6 bg-white ring-1 ring-gray-200 rounded-2xl shadow-sm',
        className,
      )}
    >
      <div className="flex items-start justify-between">
        <SkeletonBlock className="h-12 w-12 rounded-xl" />
        <SkeletonBlock className="h-6 w-16 rounded-full" />
      </div>
      <div className="mt-5">
        <SkeletonBlock className="h-3 w-20 mb-3" />
        <SkeletonBlock className="h-8 w-32" />
        <SkeletonBlock className="mt-3 h-3 w-40" />
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
