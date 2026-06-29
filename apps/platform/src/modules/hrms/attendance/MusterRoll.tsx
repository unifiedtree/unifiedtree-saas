import React, { useMemo, useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  CalendarDays, ChevronLeft, ChevronRight, Users, CheckCircle2,
  Clock, UserX, Plane, Home, RefreshCw,
} from 'lucide-react'
import {
  ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar,
  XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts'
import {
  HrPageHeader, HrStatCard, HrStatusPill, TableCard, HrButton, HrAvatar,
  type PillTone,
} from '@/shared/components/hr'
import { useToast } from '@/shared/hooks/useToast'
import { useCompanies, useDepartments } from '../api/useOrg'
import { useTeamDashboard, useAttendanceLogs, type StaffStatusResponse } from '../api/useAttendance'

// Muster roll = the daily attendance register. Everything here is derived from
// two live endpoints: the team dashboard (per-staff status + counts for a date)
// and the attendance event log (raw punches for the same date). No mock data.

const CHART = {
  present: '#22C55E',
  late: '#F59E0B',
  halfDay: '#06B6D4',
  onLeave: '#8B5CF6',
  wfh: '#2563EB',
  absent: '#EF4444',
  notMarked: '#94A3B8',
}

// Map a backend status string to a styled pill + readable label.
function statusMeta(status?: string): { tone: PillTone; label: string } {
  const s = (status ?? '').toUpperCase()
  switch (s) {
    case 'PRESENT': return { tone: 'ok', label: 'Present' }
    case 'LATE': return { tone: 'late', label: 'Late' }
    case 'HALF_DAY':
    case 'HALFDAY': return { tone: 'teal', label: 'Half Day' }
    case 'ON_LEAVE':
    case 'LEAVE': return { tone: 'purple', label: 'On Leave' }
    case 'WORK_FROM_HOME':
    case 'WFH': return { tone: 'blue', label: 'Work From Home' }
    case 'ABSENT': return { tone: 'red', label: 'Absent' }
    case 'NOT_MARKED':
    case 'NOTMARKED':
    case '': return { tone: 'gray', label: 'Not Marked' }
    default: return { tone: 'info', label: s.replace(/_/g, ' ') }
  }
}

function fullName(s: StaffStatusResponse): string {
  return s.fullName?.trim() || s.employeeCode || 'Unknown'
}

// Render an ISO timestamp as a short local time, or an em-dash when missing.
function fmtTime(iso?: string): string {
  if (!iso) return '—'
  try { return format(parseISO(iso), 'hh:mm a') } catch { return '—' }
}

function toISODate(d: Date): string {
  return format(d, 'yyyy-MM-dd')
}

export const MusterRoll: React.FC = () => {
  const { toast } = useToast()
  const today = useMemo(() => toISODate(new Date()), [])
  const [date, setDate] = useState<string>(today)
  const [deptId, setDeptId] = useState<string>('')
  const [search, setSearch] = useState('')

  const { data: companies = [] } = useCompanies()
  const companyId = companies[0]?.id ?? ''
  const { data: departments = [] } = useDepartments(companyId)

  const {
    data: dashboard,
    isLoading: dashLoading,
    isFetching: dashFetching,
    error: dashError,
    refetch: refetchDash,
  } = useTeamDashboard(date, deptId || undefined)

  const { data: logs = [], refetch: refetchLogs } = useAttendanceLogs(date, deptId || undefined)

  const counts = dashboard?.counts
  const staff = dashboard?.staffStatuses ?? []

  // Punch counts per employee (from raw events) enrich the register's "punches" column.
  const punchByEmp = useMemo(() => {
    const m = new Map<string, number>()
    for (const ev of logs) m.set(ev.employeeId, (m.get(ev.employeeId) ?? 0) + 1)
    return m
  }, [logs])

  const totalStaff = staff.length

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const rows = q
      ? staff.filter((s) =>
          fullName(s).toLowerCase().includes(q) ||
          (s.employeeCode ?? '').toLowerCase().includes(q) ||
          (s.departmentName ?? '').toLowerCase().includes(q))
      : staff
    // Stable, useful ordering: by name.
    return [...rows].sort((a, b) => fullName(a).localeCompare(fullName(b)))
  }, [staff, search])

  // Distribution data for the charts — only non-zero buckets in the pie.
  const distribution = useMemo(() => {
    if (!counts) return [] as { key: string; label: string; value: number; color: string }[]
    return [
      { key: 'present', label: 'Present', value: counts.present, color: CHART.present },
      { key: 'late', label: 'Late', value: counts.late, color: CHART.late },
      { key: 'halfDay', label: 'Half Day', value: counts.halfDay, color: CHART.halfDay },
      { key: 'onLeave', label: 'On Leave', value: counts.onLeave, color: CHART.onLeave },
      { key: 'wfh', label: 'WFH', value: counts.workFromHome, color: CHART.wfh },
      { key: 'absent', label: 'Absent', value: counts.absent, color: CHART.absent },
      { key: 'notMarked', label: 'Not Marked', value: counts.notMarked, color: CHART.notMarked },
    ]
  }, [counts])

  const pieData = useMemo(() => distribution.filter((d) => d.value > 0), [distribution])
  const distributionTotal = useMemo(() => distribution.reduce((a, d) => a + d.value, 0), [distribution])

  const shiftDay = (delta: number) => {
    const d = parseISO(date)
    d.setDate(d.getDate() + delta)
    setDate(toISODate(d))
  }

  const onRefresh = () => {
    refetchDash()
    refetchLogs()
    toast('Muster roll refreshed', 'info')
  }

  const isToday = date === today
  const headcountLabel = counts
    ? `${counts.present + counts.late + counts.workFromHome} of ${distributionTotal} marked in`
    : undefined

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6 sm:p-8">
      <HrPageHeader
        crumb="Attendance & Time"
        title="Muster Roll"
        subtitle="Daily attendance register — every staff member's status and punch times for the selected day."
        actions={
          <HrButton variant="ghost" onClick={onRefresh} disabled={dashFetching}>
            <RefreshCw size={16} className={dashFetching ? 'animate-spin' : ''} /> Refresh
          </HrButton>
        }
      />

      {/* Controls: date stepper + department filter */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border-default bg-white p-3 shadow-sm">
        <div className="flex items-center gap-1">
          <button
            onClick={() => shiftDay(-1)}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-border-default text-text-secondary transition-colors hover:bg-bg-base"
            aria-label="Previous day"
          >
            <ChevronLeft size={16} />
          </button>
          <div className="relative">
            <CalendarDays size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary" />
            <input
              type="date"
              value={date}
              max={today}
              onChange={(e) => e.target.value && setDate(e.target.value)}
              className="rounded-lg border border-border-default bg-white py-2 pl-8 pr-3 text-sm text-text-primary focus:border-[#FF9D00] focus:outline-none focus:ring-2 focus:ring-[#FF9D00]/20"
            />
          </div>
          <button
            onClick={() => shiftDay(1)}
            disabled={isToday}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-border-default text-text-secondary transition-colors hover:bg-bg-base disabled:opacity-40"
            aria-label="Next day"
          >
            <ChevronRight size={16} />
          </button>
          {!isToday && (
            <button
              onClick={() => setDate(today)}
              className="ml-1 rounded-lg px-2.5 py-2 text-xs font-semibold text-[#C16E00] transition-colors hover:bg-[#FFF4E1]"
            >
              Today
            </button>
          )}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">Department</span>
          <select
            value={deptId}
            onChange={(e) => setDeptId(e.target.value)}
            className="rounded-lg border border-border-default bg-white py-2 pl-3 pr-8 text-sm text-text-primary focus:border-[#FF9D00] focus:outline-none focus:ring-2 focus:ring-[#FF9D00]/20"
          >
            <option value="">All departments</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </div>
      </div>

      <p className="-mt-2 text-sm font-medium text-text-secondary">
        {format(parseISO(date), 'EEEE, d MMMM yyyy')}
        {headcountLabel && <span className="text-text-tertiary"> · {headcountLabel}</span>}
      </p>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <HrStatCard
          icon={<Users size={18} />} color="blue"
          value={totalStaff} label="On Roster" loading={dashLoading}
          sub="Staff in scope"
        />
        <HrStatCard
          icon={<CheckCircle2 size={18} />} color="green"
          value={counts?.present ?? 0} label="Present" loading={dashLoading}
          sub={counts ? `${counts.workFromHome} WFH` : undefined}
        />
        <HrStatCard
          icon={<Clock size={18} />} color="orange"
          value={counts?.late ?? 0} label="Late" loading={dashLoading}
          sub={counts ? `${counts.halfDay} half-day` : undefined}
        />
        <HrStatCard
          icon={<UserX size={18} />} color="red"
          value={counts?.absent ?? 0} label="Absent" loading={dashLoading}
          sub={counts ? `${counts.notMarked} not marked` : undefined}
        />
      </div>

      {/* Charts: distribution pie + status bar */}
      {!dashLoading && distributionTotal > 0 && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-border-default bg-white p-5 shadow-sm">
            <h3 className="mb-1 text-sm font-bold text-text-primary">Status Distribution</h3>
            <p className="mb-3 text-xs text-text-tertiary">Share of roster by attendance status</p>
            <div className="flex items-center gap-4">
              <div className="h-44 w-44 shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={pieData} dataKey="value" nameKey="label" innerRadius={42} outerRadius={70} paddingAngle={2}>
                      {pieData.map((d) => <Cell key={d.key} fill={d.color} />)}
                    </Pie>
                    <Tooltip formatter={(v: number, n) => [`${v}`, n as string]} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex-1 space-y-1.5">
                {distribution.filter((d) => d.value > 0).map((d) => (
                  <div key={d.key} className="flex items-center gap-2 text-sm">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: d.color }} />
                    <span className="text-text-secondary">{d.label}</span>
                    <span className="ml-auto font-semibold text-text-primary">{d.value}</span>
                    <span className="w-10 text-right text-xs text-text-tertiary">
                      {Math.round((d.value / distributionTotal) * 100)}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-border-default bg-white p-5 shadow-sm">
            <h3 className="mb-1 text-sm font-bold text-text-primary">Headcount by Status</h3>
            <p className="mb-3 text-xs text-text-tertiary">Number of staff in each bucket</p>
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={distribution} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#EEF0F3" />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#6B7280' }} interval={0} angle={-20} textAnchor="end" height={48} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#6B7280' }} />
                  <Tooltip cursor={{ fill: '#FFF4E1' }} formatter={(v: number) => [`${v}`, 'Staff']} />
                  <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                    {distribution.map((d) => <Cell key={d.key} fill={d.color} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {/* Register */}
      <TableCard
        search={{ value: search, onChange: setSearch, placeholder: 'Search name, code or department…' }}
        footer={
          <div className="flex items-center justify-between text-xs text-text-tertiary">
            <span>{filtered.length} of {totalStaff} staff shown</span>
            <span>{logs.length} punch events logged</span>
          </div>
        }
      >
        <table className="hr-table">
          <thead>
            <tr>
              <th>Employee</th>
              <th>Department</th>
              <th>Status</th>
              <th>Check In</th>
              <th>Check Out</th>
              <th>Location</th>
              <th className="text-right">Punches</th>
            </tr>
          </thead>
          <tbody>
            {dashLoading ? (
              [...Array(6)].map((_, i) => (
                <tr key={i}>
                  <td>
                    <div className="flex items-center gap-2.5">
                      <div className="h-8 w-8 shrink-0 animate-pulse rounded-full bg-bg-base" />
                      <div className="space-y-1.5">
                        <div className="h-3 w-32 animate-pulse rounded bg-bg-base" />
                        <div className="h-2.5 w-20 animate-pulse rounded bg-bg-base" />
                      </div>
                    </div>
                  </td>
                  {[...Array(6)].map((__, j) => (
                    <td key={j}><div className="h-3 w-16 animate-pulse rounded bg-bg-base" /></td>
                  ))}
                </tr>
              ))
            ) : dashError ? (
              <tr>
                <td colSpan={7}>
                  <div className="flex flex-col items-center gap-3 py-12 text-center">
                    <p className="text-sm font-medium text-text-secondary">Couldn’t load the muster roll for this day.</p>
                    <HrButton variant="ghost" size="sm" onClick={() => refetchDash()}>
                      <RefreshCw size={14} /> Retry
                    </HrButton>
                  </div>
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={7}>
                  <div className="flex flex-col items-center gap-2 py-12 text-center">
                    <CalendarDays size={28} className="text-text-tertiary" />
                    <p className="text-sm font-medium text-text-secondary">
                      {totalStaff === 0 ? 'No attendance records for this day.' : 'No staff match your search.'}
                    </p>
                    <p className="text-xs text-text-tertiary">
                      {totalStaff === 0 ? 'Pick another date or department.' : 'Try a different name or code.'}
                    </p>
                  </div>
                </td>
              </tr>
            ) : (
              filtered.map((s, idx) => {
                const meta = statusMeta(s.status)
                const punches = punchByEmp.get(s.employeeId) ?? 0
                return (
                  <tr key={s.employeeId}>
                    <td>
                      <HrAvatar
                        name={fullName(s)}
                        sub={[s.employeeCode, s.jobTitle].filter(Boolean).join(' · ') || undefined}
                        seed={idx}
                      />
                    </td>
                    <td className="text-text-secondary">{s.departmentName ?? '—'}</td>
                    <td><HrStatusPill tone={meta.tone}>{meta.label}</HrStatusPill></td>
                    <td className="font-medium text-text-primary">{fmtTime(s.checkInAt)}</td>
                    <td className="font-medium text-text-primary">{fmtTime(s.checkOutAt)}</td>
                    <td className="text-text-secondary">{s.locationName ?? '—'}</td>
                    <td className="text-right tabular-nums text-text-secondary">
                      {punches > 0 ? punches : '—'}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </TableCard>

      {/* Quick legend / WFH + leave callouts derived from counts */}
      {!dashLoading && counts && (counts.workFromHome > 0 || counts.onLeave > 0) && (
        <div className="flex flex-wrap gap-3">
          {counts.onLeave > 0 && (
            <div className="flex items-center gap-2 rounded-xl border border-[#E9D5FF] bg-[#F3E8FF] px-4 py-2.5">
              <Plane size={15} className="text-[#7C3AED]" />
              <span className="text-sm font-medium text-text-secondary">{counts.onLeave} on approved leave today</span>
            </div>
          )}
          {counts.workFromHome > 0 && (
            <div className="flex items-center gap-2 rounded-xl border border-[#BFDBFE] bg-[#DBEAFE] px-4 py-2.5">
              <Home size={15} className="text-[#1D4ED8]" />
              <span className="text-sm font-medium text-text-secondary">{counts.workFromHome} working from home</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
