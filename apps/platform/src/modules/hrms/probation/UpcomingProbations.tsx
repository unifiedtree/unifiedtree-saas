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
        <p className="font-semibold text-slate-900">{r.employeeName}</p>
        <p className="text-xs text-slate-500">{r.employeeCode}{r.jobTitle ? ` · ${r.jobTitle}` : ''}</p>
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

  return (
    <div className="bg-white border border-[#0F6E56]/15 rounded-2xl shadow-sm overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-4 border-b border-slate-100">
        <CalendarClock size={16} className="text-[#0F6E56]" />
        <h2 className="text-sm font-bold text-slate-800">Upcoming Probation Confirmations</h2>
        {data.length > 0 && (
          <span className="ml-1 text-xs bg-[#0F6E56]/10 text-[#0F6E56] px-1.5 py-0.5 rounded-full font-semibold">
            {data.length}
          </span>
        )}
      </div>
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
    </div>
  )
}
