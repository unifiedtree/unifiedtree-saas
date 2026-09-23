import { SkeletonCard } from '@unifiedtree/design-sync-entry'

// The loading placeholder that stands in for one KPI tile (icon bubble, chip,
// label, value and sub line) while a dashboard query is pending.
export function Default() {
  return <SkeletonCard />
}

// `ariaLabel` names what is loading for screen readers; `className` extends
// the card (here a slightly stronger ring so the placeholder reads as a tile
// on a busy page). Visually the pulse blocks are the same.
export function LabelledAndExtended() {
  return <SkeletonCard ariaLabel="Loading headcount" className="ring-gray-200" />
}
