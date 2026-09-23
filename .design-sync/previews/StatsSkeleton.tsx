import { StatsSkeleton, TableSkeleton } from '@unifiedtree/design-sync-entry'

// The KPI strip while the attendance dashboard loads (Attendance.tsx renders
// a bare <StatsSkeleton />): four tiles, the default count.
export function FourStats() {
  return <StatsSkeleton />
}

// count={3} — the three-tile strip a request screen (advance / expense) uses.
export function ThreeStats() {
  return <StatsSkeleton count={3} />
}

// The whole list-screen loading state: the KPI strip above a table placeholder.
export function DashboardLoading() {
  return (
    <div className="space-y-6">
      <StatsSkeleton count={4} />
      <div className="ut-card overflow-hidden">
        <TableSkeleton rows={4} cols={4} />
      </div>
    </div>
  )
}
