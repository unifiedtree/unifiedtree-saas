/**
 * Attendance — this employee's week and their recent records.
 *
 * Both endpoints already existed and had no caller in the SPA:
 *   GET /v1/attendance/employee/{id}/weekly-summary
 *   GET /v1/attendance/employee/{id}/records
 *
 * Neither is a new API and neither is an N+1: the week arrives as ONE
 * pre-computed response with week-offs, holidays and approved leave already
 * overlaid server-side, and the records are a single paged request. The page
 * deliberately does NOT reconstruct "was this a working day" from raw punches —
 * the server owns that, and duplicating it here is how two screens start
 * disagreeing about whether someone was absent.
 *
 * Both carry an object-scope guard (AttendanceController.assertCanReadEmployeeAttendance):
 * self, the employee's direct manager, or HR/admin. A manager opening a profile
 * outside their team gets 403, which SectionState renders as a permission state
 * rather than "no attendance".
 */

import { istToday } from '@/design/dc/dates'
import React, { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { Clock, CalendarDays, TrendingUp, LogIn } from 'lucide-react'
import { CardSkeleton } from '@unifiedtree/ui-kit'
import { usePermission } from '@unifiedtree/sdk'
import { TableCard, HrStatusPill, type PillTone } from '@/shared/components/hr'
import { hrPaginationFooter, useClampedPage } from '@/shared/components/HrPagination'
import {
  useEmployeeAttendanceRecords, useEmployeeWeeklySummary,
  type WeeklyDayResponse,
} from '../../api/useAttendance'
import { useEmployeeShift } from '../../api/useShiftPolicies'
import { SectionState, SubSection } from './shared'

/** Server-side day classifications from WeeklyDayResponse.status. */
const DAY_TONE: Record<string, PillTone> = {
  ON_TIME: 'green', LATE: 'warn', WEEKEND: 'gray', HOLIDAY: 'purple',
  ON_LEAVE: 'info', ABSENT: 'red', UPCOMING: 'gray',
}
const DAY_LABEL: Record<string, string> = {
  ON_TIME: 'On time', LATE: 'Late', WEEKEND: 'Week off', HOLIDAY: 'Holiday',
  ON_LEAVE: 'On leave', ABSENT: 'Absent', UPCOMING: 'Upcoming',
}

const RECORD_TONE: Record<string, PillTone> = {
  PRESENT: 'green', LATE: 'warn', HALF_DAY: 'warn', ABSENT: 'red',
  ON_LEAVE: 'info', WFH: 'purple', WEEKLY_OFF: 'gray', HOLIDAY: 'purple',
}

const PAGE_SIZE = 31

function fmtHours(h?: number) {
  if (h == null) return '—'
  const hrs = Math.floor(h)
  const mins = Math.round((h - hrs) * 60)
  return mins ? `${hrs}h ${mins}m` : `${hrs}h`
}

function fmtTime(iso?: string) {
  if (!iso) return '—'
  try { return format(parseISO(iso), 'HH:mm') } catch { return '—' }
}

function Metric({ icon: Icon, label, value, hint }: {
  icon: React.ElementType; label: string; value: string; hint?: string
}) {
  return (
    <div style={{ padding: '10px 12px', borderRadius: 12, background: '#f8fafc' }}>
      <div className="flex items-center gap-2 text-text-secondary">
        <Icon size={14} />
        <span className="text-xs font-semibold">{label}</span>
      </div>
      <p className="mt-1.5 text-xl font-bold text-text-primary">{value}</p>
      {hint && <p className="text-xs text-text-tertiary mt-0.5">{hint}</p>}
    </div>
  )
}

function WeekStrip({ days }: { days: WeeklyDayResponse[] }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
      {days.map((d) => (
        <div key={d.date} style={{ padding: '10px 12px', borderRadius: 12, background: '#f8fafc' }}>
          <p className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide">
            {(() => { try { return format(parseISO(d.date), 'EEE d MMM') } catch { return d.date } })()}
          </p>
          <div className="mt-1.5">
            {/* A day isn't absent until it's over: today with no punch reads "Not marked yet", and days
                before this person's first punch aren't counted ("Not tracked"). */}
            {(() => {
              const today = istToday(), pending = d.date === today && (d.status === 'ABSENT' || d.status === 'UPCOMING')
              const label = pending ? 'Not marked yet' : d.status === 'UPCOMING' && d.date < today ? 'Not tracked' : DAY_LABEL[d.status] ?? d.status
              return <HrStatusPill tone={pending ? 'gray' : DAY_TONE[d.status] ?? 'gray'}>{label}</HrStatusPill>
            })()}
          </div>
          <p className="mt-2 text-sm font-bold text-text-primary">{d.hours ? fmtHours(d.hours) : '—'}</p>
          {(d.checkInTime || d.checkOutTime) && (
            <p className="text-[11px] text-text-tertiary mt-0.5">
              {d.checkInTime ?? '—'} → {d.checkOutTime ?? '—'}
            </p>
          )}
          {d.lateByMinutes ? (
            <p className="text-[11px] text-orange-600 mt-0.5">{d.lateByMinutes}m late</p>
          ) : null}
        </div>
      ))}
    </div>
  )
}

export function EmployeeAttendance({ employeeId }: { employeeId: string }) {
  const [page, setPage] = useState(0)

  // attendance.team.read is the authority both endpoints declare. The server
  // still decides per employee (object-scope guard), so this only avoids firing
  // requests that are guaranteed to 403 for a caller with no team-read at all.
  const canRead = usePermission('attendance.team.read')

  const week = useEmployeeWeeklySummary(employeeId, undefined, { enabled: canRead })
  const records = useEmployeeAttendanceRecords(employeeId, page, PAGE_SIZE, { enabled: canRead })
  const shift = useEmployeeShift(employeeId, { enabled: canRead })

  const total = records.data?.totalElements ?? 0
  const totalPages = records.data?.totalPages ?? 0
  useClampedPage(page, totalPages, setPage)

  if (!canRead) {
    return (
      <SectionState
        error={{ status: 403 }}
        forbiddenTitle="You don’t have access to attendance"
        forbiddenHint="Viewing an employee’s attendance needs the team attendance permission."
      />
    )
  }

  const rows = records.data?.content ?? []
  const w = week.data

  return (
    <div className="flex flex-col gap-3">
      <SubSection
        title="This week"
        hint="Week offs, holidays and approved leave are applied by the attendance service."
      >
        <SectionState
          isLoading={week.isLoading}
          error={week.error}
          isEmpty={!week.isLoading && !week.error && !w?.days?.length}
          emptyIcon={CalendarDays}
          emptyTitle="No attendance this week"
          emptyHint="Nothing has been recorded for this employee in the current week."
          forbiddenTitle="You don’t have access to this employee’s attendance"
          forbiddenHint="Attendance is visible to HR, admins, and the employee’s own manager."
          onRetry={() => week.refetch()}
          skeleton={<CardSkeleton />}
        >
          {w && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <Metric icon={Clock} label="Hours" value={fmtHours(w.totalHours)}
                  hint={w.dailyTargetHours ? `${w.dailyTargetHours}h/day target` : undefined} />
                <Metric icon={CalendarDays} label="Present days" value={String(w.presentDays)} />
                <Metric icon={TrendingUp} label="Overtime" value={fmtHours(w.overtimeHours)} />
                <Metric icon={LogIn} label="Avg arrival" value={w.avgArrivalTime || '—'} />
              </div>
              <WeekStrip days={w.days} />
            </div>
          )}
        </SectionState>
      </SubSection>

      <SubSection
        title="Shift"
        hint="The schedule this employee's punches are measured against."
      >
        <SectionState
          isLoading={shift.isLoading}
          error={shift.error}
          isEmpty={!shift.isLoading && !shift.error && !shift.data?.shiftPolicyId}
          emptyIcon={Clock}
          emptyTitle="No shift assigned"
          emptyHint="Use Change shift at the top of this page so lateness and overtime can be measured."
          onRetry={() => shift.refetch()}
          skeleton={<CardSkeleton />}
        >
          <div className="flex flex-wrap items-center gap-x-8 gap-y-2" style={{ padding: '10px 12px', borderRadius: 12, background: '#f8fafc' }}>
            <div>
              <p className="text-xs text-text-secondary">Shift</p>
              <p className="text-sm font-semibold text-text-primary">{shift.data?.shiftName}</p>
            </div>
            <div>
              <p className="text-xs text-text-secondary">Timing</p>
              <p className="text-sm text-text-primary">
                {shift.data?.startTime ?? '—'} → {shift.data?.endTime ?? '—'}
              </p>
            </div>
            {shift.data?.gracePeriodMinutes != null && (
              <div>
                <p className="text-xs text-text-secondary">Grace</p>
                <p className="text-sm text-text-primary">{shift.data.gracePeriodMinutes} min</p>
              </div>
            )}
            {shift.data?.effectiveFrom && (
              <div>
                <p className="text-xs text-text-secondary">Effective from</p>
                <p className="text-sm text-text-primary">
                  {(() => { try { return format(parseISO(shift.data!.effectiveFrom!), 'd MMM yyyy') } catch { return shift.data!.effectiveFrom } })()}
                </p>
              </div>
            )}
          </div>
        </SectionState>
      </SubSection>

      <SubSection title="Recent records" hint={total ? `${total} day${total === 1 ? '' : 's'} recorded` : undefined}>
        <SectionState
          isLoading={records.isLoading}
          error={records.error}
          isEmpty={!records.isLoading && !records.error && rows.length === 0}
          emptyIcon={CalendarDays}
          emptyTitle="No attendance records"
          emptyHint="Once this employee checks in, their daily records appear here."
          forbiddenTitle="You don’t have access to this employee’s attendance"
          forbiddenHint="Attendance is visible to HR, admins, and the employee’s own manager."
          onRetry={() => records.refetch()}
        >
          <TableCard footer={hrPaginationFooter({
            page, totalPages, totalElements: total, pageSize: PAGE_SIZE, onPageChange: setPage,
          })}>
            <table className="hr-table">
              <thead>
                <tr>
                  <th>Date</th><th>Status</th><th>In</th><th>Out</th><th>Hours</th><th>Late</th><th>OT</th><th>Source</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap">
                      {(() => { try { return format(parseISO(r.attendanceDate), 'd MMM yyyy') } catch { return r.attendanceDate } })()}
                    </td>
                    <td>
                      <HrStatusPill tone={RECORD_TONE[r.attendanceStatus] ?? 'gray'}>
                        {r.attendanceStatus?.replace(/_/g, ' ') ?? '—'}
                      </HrStatusPill>
                    </td>
                    <td>{fmtTime(r.checkInAt)}</td>
                    <td>{fmtTime(r.checkOutAt)}</td>
                    <td>{fmtHours(r.workingHours)}</td>
                    <td>{r.lateByMinutes ? `${r.lateByMinutes}m` : '—'}</td>
                    <td>{r.overtimeMinutes ? `${r.overtimeMinutes}m` : '—'}</td>
                    <td className="text-text-tertiary">
                      {r.regularized ? 'Regularised' : r.manualEntry ? 'Manual' : (r.checkInMethod?.replace(/_/g, ' ') ?? '—')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableCard>
        </SectionState>
      </SubSection>
    </div>
  )
}
