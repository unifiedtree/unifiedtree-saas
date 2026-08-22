import React, { useMemo, useState } from 'react'
import { Clock, Moon, Timer, Building2 } from 'lucide-react'
import { startOfMonth, endOfMonth, format } from 'date-fns'
import { HrPageHeader, HrStatCard, HrStatusPill, TableCard, HrAvatar } from '@/shared/components/hr'
import { useCompanies } from './../api/useOrg'
// attendance.shift_policies, not org.shifts. This screen used to read useOrg's
// useShifts (/v1/hrms/shifts), which is a different table that the attendance
// engine never reads — so an "Attendance & Time" page was showing timings and a
// grace value that had nothing to do with who actually got marked Late.
// See useShiftPolicies.ts for the full trap.
import { useShiftPolicies, type ShiftType } from './../api/useShiftPolicies'
import { useAttendanceSummaryReport } from './../api/useReports'

const hhmm = (t?: string) => (t ? t.slice(0, 5) : '—')

const TYPE_LABEL: Record<ShiftType, string> = {
  FIXED: 'Fixed',
  FLEXIBLE: 'Flexible',
  ROTATIONAL: 'Rotational',
  NIGHT: 'Night',
}

export const ShiftsAndOt: React.FC = () => {
  const { data: companies = [] } = useCompanies()
  const [companyId, setCompanyId] = useState('')
  const activeCompany = companyId || companies[0]?.id || ''

  const { data: shifts = [], isLoading: shiftsLoading } = useShiftPolicies(activeCompany)

  const now = new Date()
  const from = format(startOfMonth(now), 'yyyy-MM-dd')
  const to = format(endOfMonth(now), 'yyyy-MM-dd')
  const { data: summary = [], isLoading: otLoading } = useAttendanceSummaryReport(activeCompany || null, from, to)

  const otRows = useMemo(
    () => [...summary]
      .filter((r) => (r.total_overtime_mins ?? 0) > 0)
      .sort((a, b) => (b.total_overtime_mins ?? 0) - (a.total_overtime_mins ?? 0)),
    [summary],
  )
  const totalOtHours = useMemo(
    () => Math.round((summary.reduce((s, r) => s + (r.total_overtime_mins ?? 0), 0) / 60) * 10) / 10,
    [summary],
  )
  // /v1/shifts only returns active policies (delete is a soft-delete that drops
  // the row from the list), so an "Active Shifts" tile would just restate
  // shifts.length. Count the night shifts instead — that's a real distinction.
  const nightShifts = shifts.filter((s) => s.shiftType === 'NIGHT').length

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6 sm:p-8">
      <HrPageHeader
        crumb="Attendance & Time"
        title="Shifts & Overtime"
        subtitle="Shift schedules and this month's overtime across the workforce"
        actions={companies.length > 1 ? (
          <div className="relative">
            <Building2 size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
            <select
              value={activeCompany}
              onChange={(e) => setCompanyId(e.target.value)}
              className="rounded-lg border border-border-default bg-white py-2 pl-8 pr-3 text-sm focus:border-[#059669] focus:outline-none"
            >
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        ) : undefined}
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <HrStatCard icon={<Clock size={18} />} color="blue" value={shifts.length} label="Shifts Defined" loading={shiftsLoading} />
        <HrStatCard icon={<Moon size={18} />} color="green" value={nightShifts} label="Night Shifts" loading={shiftsLoading} />
        <HrStatCard icon={<Timer size={18} />} color="orange" value={`${totalOtHours}h`} label="Overtime (This Month)" loading={otLoading} />
      </div>

      {/* Shift schedules */}
      <div>
        <h3 className="mb-2 text-sm font-bold text-text-primary">Shift Schedules</h3>
        <TableCard>
          <table className="hr-table">
            <thead>
              <tr>
                <th>Shift</th>
                <th>Timing</th>
                <th className="hidden sm:table-cell">Grace</th>
                <th className="hidden sm:table-cell">Hours/Day</th>
                <th>Type</th>
              </tr>
            </thead>
            <tbody>
              {shiftsLoading ? (
                [...Array(3)].map((_, i) => <tr key={i}><td colSpan={5} className="py-3"><div className="h-5 w-full animate-pulse rounded bg-bg-base" /></td></tr>)
              ) : shifts.length === 0 ? (
                <tr><td colSpan={5} className="py-12 text-center text-sm text-text-tertiary">No shifts defined for this company yet.</td></tr>
              ) : shifts.map((s) => (
                <tr key={s.id}>
                  <td>
                    <div className="font-medium text-text-primary">{s.name}</div>
                  </td>
                  <td className="text-text-secondary">{hhmm(s.startTime)} – {hhmm(s.endTime)}</td>
                  {/* gracePeriodMinutes — the value the late-mark cutoff actually uses. */}
                  <td className="hidden sm:table-cell text-text-secondary">{s.gracePeriodMinutes} min</td>
                  <td className="hidden sm:table-cell text-text-secondary">{s.workingHoursPerDay != null ? `${s.workingHoursPerDay} h` : '—'}</td>
                  <td>{s.shiftType === 'NIGHT' ? <HrStatusPill tone="purple"><Moon size={11} className="mr-1 inline" />Night</HrStatusPill> : <HrStatusPill tone="info">{TYPE_LABEL[s.shiftType] ?? 'Day'}</HrStatusPill>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableCard>
      </div>

      {/* Overtime this month */}
      <div>
        <h3 className="mb-2 text-sm font-bold text-text-primary">Overtime — {format(now, 'MMMM yyyy')}</h3>
        <TableCard>
          <table className="hr-table">
            <thead>
              <tr>
                <th>Employee</th>
                <th className="hidden sm:table-cell">Present Days</th>
                <th>Overtime</th>
              </tr>
            </thead>
            <tbody>
              {otLoading ? (
                [...Array(3)].map((_, i) => <tr key={i}><td colSpan={3} className="py-3"><div className="h-5 w-full animate-pulse rounded bg-bg-base" /></td></tr>)
              ) : otRows.length === 0 ? (
                <tr><td colSpan={3} className="py-12 text-center text-sm text-text-tertiary">No overtime recorded this month.</td></tr>
              ) : otRows.map((r, i) => (
                <tr key={r.employee_code ?? i}>
                  <td><HrAvatar name={r.employee_name ?? r.employee_code ?? 'Employee'} sub={r.department ?? undefined} seed={i} /></td>
                  <td className="hidden sm:table-cell text-text-secondary">{r.present_days ?? 0}</td>
                  <td className="font-semibold text-text-primary">{Math.round(((r.total_overtime_mins ?? 0) / 60) * 10) / 10}h</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableCard>
      </div>
    </div>
  )
}
