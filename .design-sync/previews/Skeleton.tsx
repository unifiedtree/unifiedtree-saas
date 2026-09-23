import { Skeleton } from '@unifiedtree/design-sync-entry'

// The text-block shape a detail panel shows while its record loads: a heading
// line and three body lines at descending widths (the CardSkeleton recipe).
export function TextLines() {
  return (
    <div className="max-w-md">
      <Skeleton className="mb-3 h-5 w-2/5" />
      <Skeleton className="mb-2 h-4 w-full" />
      <Skeleton className="mb-2 h-4 w-4/5" />
      <Skeleton className="h-4 w-3/5" />
    </div>
  )
}

// rounded → a circle: the avatar + name / code pair of an employee list row,
// at the three avatar sizes the screens use.
export function AvatarRows() {
  return (
    <div className="max-w-md space-y-4">
      <div className="flex items-center gap-3">
        <Skeleton rounded className="h-12 w-12" />
        <div className="flex-1">
          <Skeleton className="mb-2 h-4 w-1/2" />
          <Skeleton className="h-3 w-1/4" />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Skeleton rounded className="h-10 w-10" />
        <div className="flex-1">
          <Skeleton className="mb-2 h-4 w-1/3" />
          <Skeleton className="h-3 w-1/4" />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Skeleton rounded className="h-8 w-8" />
        <div className="flex-1">
          <Skeleton className="mb-2 h-4 w-2/5" />
          <Skeleton className="h-3 w-1/4" />
        </div>
      </div>
    </div>
  )
}

// Block shapes: status pills, a button, a KPI value with its label, and the
// chart placeholder the attendance dashboard shows (Attendance.tsx).
export function BlocksAndPills() {
  return (
    <div className="max-w-md space-y-4">
      <div className="flex items-center gap-3">
        <Skeleton rounded className="h-6 w-20" />
        <Skeleton rounded className="h-6 w-24" />
        <Skeleton className="h-9 w-28 rounded-lg" />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Skeleton className="mb-2 h-8 w-1/2" />
          <Skeleton className="h-3 w-2/5" />
        </div>
        <div>
          <Skeleton className="mb-2 h-8 w-1/2" />
          <Skeleton className="h-3 w-2/5" />
        </div>
      </div>
      <Skeleton className="h-40 w-full rounded-xl" />
    </div>
  )
}
