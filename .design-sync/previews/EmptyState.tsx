import { EmptyState } from '@unifiedtree/design-sync-entry'
import { CalendarOff, Users, XCircle } from 'lucide-react'

// First-run directory (Employees.tsx shape): a primary action that starts the
// user off. `icon` is the lucide component itself, not an element.
export function WithAction() {
  return (
    <div className="ut-card">
      <EmptyState
        icon={Users}
        title="No employees yet"
        description="Add your first employee or import the directory from a CSV to get started."
        action={{ label: 'Add employee', onClick: () => {} }}
      />
    </div>
  )
}

// A filtered list with nothing in it — no action, just the explanation.
export function WithoutAction() {
  return (
    <div className="ut-card">
      <EmptyState
        icon={CalendarOff}
        title="No leave requests"
        description="Nobody on your team has applied for leave in September 2026."
      />
    </div>
  )
}

// The failed-fetch placeholder every HRMS screen renders in place of its
// table (Attendance.tsx shape): the action retries the query.
export function ErrorWithRetry() {
  return (
    <div className="ut-card">
      <EmptyState
        icon={XCircle}
        title="Failed to load attendance"
        description="The attendance service did not respond in time. Retry in a moment."
        action={{ label: 'Retry', onClick: () => {} }}
      />
    </div>
  )
}
