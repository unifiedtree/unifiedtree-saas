import { CardSkeleton } from '@unifiedtree/design-sync-entry'

// One panel placeholder, as EmployeeDetail.tsx shows while the record loads.
export function Single() {
  return (
    <div className="max-w-md">
      <CardSkeleton />
    </div>
  )
}

// The employee workspace loads its panels side by side: two CardSkeletons in
// the same two-column grid the real cards use (EmployeeJob.tsx).
export function TwoUp() {
  return (
    <div className="grid grid-cols-2 gap-4">
      <CardSkeleton />
      <CardSkeleton />
    </div>
  )
}
