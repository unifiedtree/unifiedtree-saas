// hand-owned: edited by hand; scripts/design-build.mjs skips this view.
// Rebuilt by hand on the redesign kit (F2d).
//
// A section's quiet states in the redesign's look: loading = the soft shimmer
// bars, empty = the design's empty state, error = the kit ErrorState (red badge,
// "Unable to load this section." and "Try again").
import { EmptyState } from '@/shared/components/EmptyState'
import { SkeletonBlock } from '@/shared/components/SkeletonCard'
import { ErrorState } from '@/design/kit/EmptyState'

export function SectionStateView({ v }: { v: any }) {
  if (v.isLoading) {
    return (
      <div role="status" aria-label="Loading" style={{ display: 'grid', gap: 12, padding: '6px 0' }}>
        <SkeletonBlock {...(v.skA || {})} />
        <SkeletonBlock {...(v.skB || {})} />
        <SkeletonBlock {...(v.skC || {})} />
      </div>
    )
  }
  if (v.isEmpty) return <EmptyState icon={v.emptyIcon} title={v.title} description={v.description} />
  if (v.isError) return <ErrorState title="Unable to load this section." message="" onRetry={v.retry} />
  return null
}
