import React from 'react'
import { Link } from 'react-router-dom'
import { Users, TrendingDown, Clock, Calendar, AlarmClock, PieChart } from 'lucide-react'
import { Can, P } from '@unifiedtree/sdk'
import { HrPageHeader } from '@/shared/components/hr'

interface ReportCard {
  title: string
  description: string
  to: string
  icon: React.ReactNode
  permCode: string
  color: string
}

const REPORT_CARDS: ReportCard[] = [
  {
    title: 'Headcount',
    description: 'Active, probation, and notice-period headcount by department as of any date.',
    to: '/hrms/reports/headcount',
    icon: <Users size={20} />,
    permCode: P.HRMS_REPORT_HEADCOUNT,
    color: 'text-[#FF9D00]',
  },
  {
    title: 'Attrition',
    description: 'Monthly exits, resignations, terminations, and attrition percentage.',
    to: '/hrms/reports/attrition',
    icon: <TrendingDown size={20} />,
    permCode: P.HRMS_REPORT_ATTRITION,
    color: 'text-rose-500',
  },
  {
    title: 'Attendance Summary',
    description: 'Per-employee present days, late days, average hours, and overtime for a period.',
    to: '/hrms/reports/attendance-summary',
    icon: <Clock size={20} />,
    permCode: P.HRMS_REPORT_ATTENDANCE,
    color: 'text-amber-500',
  },
  {
    title: 'Leave Balance',
    description: 'Leave entitlement, used, pending, carry-forward, and available per employee.',
    to: '/hrms/reports/leave-balance',
    icon: <Calendar size={20} />,
    permCode: P.HRMS_REPORT_LEAVE,
    color: 'text-emerald-600',
  },
  {
    title: 'Late Marks',
    description: 'All late-arrival records with minutes late and check-in time for a date range.',
    to: '/hrms/reports/late-marks',
    icon: <AlarmClock size={20} />,
    permCode: P.HRMS_REPORT_ATTENDANCE,
    color: 'text-orange-500',
  },
  {
    title: 'Diversity',
    description: 'Headcount breakdown by gender and department for the active workforce.',
    to: '/hrms/reports/diversity',
    icon: <PieChart size={20} />,
    permCode: P.HRMS_REPORT_DIVERSITY,
    color: 'text-violet-500',
  },
]

export function ReportsIndex() {
  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6 sm:p-8">
      <HrPageHeader crumb="Reports & Analytics" title="Reports" subtitle="Analytical views of your workforce data" />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {REPORT_CARDS.map((card) => (
          <Can key={card.to} code={card.permCode}>
            <Link
              to={card.to}
              className="group flex flex-col gap-3 rounded-2xl border border-border-default bg-white p-5 shadow-sm transition-all hover:border-[#FFD68A] hover:bg-[#FFF4E1]/40 hover:shadow-md"
            >
              <div className={`flex h-9 w-9 items-center justify-center rounded-xl bg-bg-base ${card.color}`}>
                {card.icon}
              </div>
              <div>
                <p className="text-sm font-semibold text-text-primary transition-colors group-hover:text-[#C16E00]">
                  {card.title}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-text-secondary">{card.description}</p>
              </div>
            </Link>
          </Can>
        ))}
      </div>
    </div>
  )
}
