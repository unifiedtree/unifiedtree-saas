import React from 'react'
import { Link } from 'react-router-dom'
import { Users, TrendingDown, Clock, Calendar, AlarmClock, PieChart } from 'lucide-react'
import { Can, P } from '@unifiedtree/sdk'

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
    color: 'text-[#0F6E56]',
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
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-[#0F172A]">Reports</h1>
        <p className="text-[#64748B] text-sm mt-0.5">Analytical views of your workforce data</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {REPORT_CARDS.map((card) => (
          <Can key={card.to} code={card.permCode}>
            <Link
              to={card.to}
              className="group flex flex-col gap-3 rounded-2xl border border-[#0F6E56]/15 bg-white p-5 hover:border-[#0F6E56]/30 hover:bg-[#0F6E56]/5 hover:shadow-lg transition-all shadow-sm"
            >
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center bg-[#0F6E56]/10 ${card.color}`}>
                {card.icon}
              </div>
              <div>
                <p className="text-sm font-semibold text-[#0F172A] group-hover:text-[#0F6E56] transition-colors">
                  {card.title}
                </p>
                <p className="text-xs text-[#64748B] mt-1 leading-relaxed">{card.description}</p>
              </div>
            </Link>
          </Can>
        ))}
      </div>
    </div>
  )
}
