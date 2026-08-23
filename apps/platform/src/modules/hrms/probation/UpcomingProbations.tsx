import React from 'react'
import { useNavigate } from 'react-router-dom'
import { format } from 'date-fns'
import { CalendarClock } from 'lucide-react'
import { DataTable, Badge, type Column } from '@unifiedtree/ui-kit'
import { useUpcomingProbations, type UpcomingProbation } from '../api/useProbation'

function daysTone(d: number): 'error' | 'warning' | 'info' {
  if (d <= 3) return 'error'
  if (d <= 7) return 'warning'
  return 'info'
}

function daysLabel(d: number): string {
  return d < 0 ? `${Math.abs(d)}d overdue` : `${d}d left`
}

const columns: Column<UpcomingProbation>[] = [
  {
    key: 'employee',
    header: 'Employee',
    cell: (r) => (
      <div>
        <p className="font-semibold text-text-primary">{r.employeeName}</p>
        <p className="text-xs text-text-secondary">{r.employeeCode}{r.jobTitle ? ` · ${r.jobTitle}` : ''}</p>
      </div>
    ),
  },
  { key: 'manager', header: 'Manager', cell: (r) => r.managerName ?? '—', hideBelow: 'md' },
  {
    key: 'endDate', header: 'Probation End',
    cell: (r) => format(new Date(r.probationEndDate), 'd MMM yyyy'), hideBelow: 'sm',
  },
  {
    key: 'daysRemaining', header: 'Days',
    cell: (r) => <Badge tone={daysTone(r.daysRemaining)}>{daysLabel(r.daysRemaining)}</Badge>,
  },
]

export const UpcomingProbations: React.FC = () => {
  const navigate = useNavigate()
  const { data = [], isLoading } = useUpcomingProbations(30)

  const empty = !isLoading && data.length === 0

  return (
    <div className="ut-card overflow-hidden">
      <div className="flex items-center gap-2 border-b border-border-light px-5 py-4">
        <CalendarClock size={16} className="text-primary" />
        <h2 className="text-sm font-bold text-text-primary">Upcoming Probation Confirmations</h2>
        {data.length > 0 && (
          <span className="ml-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-xs font-semibold text-primary">
            {data.length}
          </span>
        )}
        {empty && (
          /* The quiet state lives in the header row instead of a ~300px
             centred empty-block below it — a reminder card with nothing to
             remind about should cost one line, not a third of the screen. */
          <span className="ml-auto text-xs text-text-tertiary">
            None ending in the next 30 days
          </span>
        )}
      </div>
      {!empty && (
        <DataTable
          columns={columns}
          data={data}
          getRowKey={(r) => r.employeeId}
          isLoading={isLoading}
          onRowClick={(r) => navigate(`/hrms/employees/${r.employeeId}`)}
          emptyVariant="first-run"
          emptyTitle="No upcoming confirmations"
          emptyDescription="No employees have probation ending in the next 30 days."
        />
      )}
    </div>
  )
}
