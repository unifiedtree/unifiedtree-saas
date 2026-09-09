import React, { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import {
  CalendarDays, ChevronLeft, ChevronRight, Users, CheckCircle2,
  Clock, UserX, Plane, Home, RefreshCw, ClipboardEdit, Download,
} from 'lucide-react'
import {
  ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar,
  XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts'
import { usePermission, P } from '@unifiedtree/sdk'
import {
  HrPageHeader, HrStatCard, HrStatusPill, TableCard, HrButton, HrAvatar,
  type PillTone,
} from '@/shared/components/hr'
import { useToast } from '@/shared/hooks/useToast'
import { apiBlob } from '@/core/api/client'
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
  const navigate = useNavigate()
  const today = useMemo(() => toISODate(new Date()), [])
  const [date, setDate] = useState<string>(today)
  const [deptId, setDeptId] = useState<string>('')
  const [search, setSearch] = useState('')

  const [exporting, setExporting] = useState(false)

  // GET /v1/reports/attendance-summary/export.csv is gated on
  // @perm.check('hrms.report.attendance') (ReportController). Gate the button on
  // the same code so we never render a download that answers 403.
  const canExport = usePermission(P.HRMS_REPORT_ATTENDANCE)

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

  // Unfiltered roster for the same day. This is the department filter's second
  // source — see departmentOptions below. When no department is selected this
  // resolves to the SAME react-query key as the filtered call above (both pass
  // departmentId: undefined), so it costs zero extra requests in the default
  // case and one while a filter is applied.
  const { data: rosterAll } = useTeamDashboard(date)

  const { data: logs = [], refetch: refetchLogs } = useAttendanceLogs(date, deptId || undefined)

  const counts = dashboard?.counts
  const staff = dashboard?.staffStatuses ?? []

  /*
   * Department filter options — why this is a union of two sources.
   *
   * The filter used to read ONLY useDepartments(companies[0].id). That made the
   * whole control depend on GET /v1/hrms/companies, which WorkforceController
   * gates on `hasAuthority('org.company.read') or hasAuthority('platform.admin')`,
   * and on GET /v1/hrms/departments, gated on
   * `hasAuthority('hrms.department.read') or hasAuthority('platform.admin')`.
   * Two ways that dependency chain leaves the dropdown showing nothing but "All
   * departments" even though the roster below it is full of departments:
   *
   *  1. A role the route admits but that holds neither org code. The route guard
   *     is anyOf(['attendance.team.read', 'hrms.employee.read']) (App.tsx), and
   *     nothing ties either of those to org.company.read. The eight seeded roles
   *     do get both codes (V065 grants org.company.read + hrms.department.read to
   *     SUPER_ADMIN/HR_MANAGER/FINANCE_LEAD/EMPLOYEE/DEPT_MANAGER/OWNER/ADMIN/
   *     MANAGER, V105 re-copies the EMPLOYEE baseline into the manager roles, and
   *     EmployeeBaselinePermissions unions it again at token mint) — but a custom
   *     role built in the workspace Roles & Permissions screen, or a credential
   *     with no employee_id claim to trigger that baseline union, hits this.
   *  2. A multi-company tenant. companies[0] is an arbitrary pick, so the list
   *     could only ever describe ONE company while the roster spans the caller's
   *     entire scope — every other company's departments were unselectable.
   *
   * The roster itself already carries departmentId + departmentName on every
   * StaffStatusResponse, and it arrives on `attendance.team.read` — the exact
   * authority this page already needs to render at all. So union the org list
   * (authoritative names, includes departments with nobody on shift today) with
   * the departments actually present on the unfiltered roster. No new endpoint,
   * no new permission, and the control works for every role the route admits.
   */
  const departmentOptions = useMemo(() => {
    const byId = new Map<string, string>()
    for (const d of departments) byId.set(d.id, d.name)
    for (const s of rosterAll?.staffStatuses ?? []) {
      if (s.departmentId && !byId.has(s.departmentId)) {
        byId.set(s.departmentId, s.departmentName?.trim() || 'Unnamed department')
      }
    }
    // Keep a selection alive even if that department has nobody on the newly
    // picked date, so the control never renders blank against a live filter.
    if (deptId && !byId.has(deptId)) byId.set(deptId, 'Selected department')
    return [...byId.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [departments, rosterAll, deptId])

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

  /*
   * Export the register.
   *
   * A muster roll is a statutory record a labour inspector asks for on paper,
   * and this page shipped with no Export / Download / Print control at all.
   *
   * Endpoint: GET /v1/reports/attendance-summary/export.csv
   *   (ReportController, class-level @RequestMapping("/v1/reports"))
   *   params:  companyId (UUID, required), from + to (ISO LocalDate, required)
   *   guard:   @perm.check('hrms.report.attendance')
   * The muster roll is a single-day register, so from and to are both the
   * selected date — that is what makes the file match what is on screen.
   *
   * The department filter deliberately is NOT sent: attendanceSummaryCsv accepts
   * only companyId/from/to, and inventing a departmentId param would be silently
   * ignored by Spring and hand the inspector a wider file than the screen showed.
   * When a department is selected we say so out loud instead.
   *
   * Downloaded with apiBlob (same pattern as downloadLetterPdf in
   * letters/api/useLetters.ts) so the auth header + refresh-on-401 retry apply.
   * Wrapped in try/catch that toasts: a silent failure here reads as "the button
   * does nothing", which is the exact complaint that got this page reopened.
   */
  const onExportCsv = async () => {
    if (exporting) return
    if (!companyId) {
      toast('No company is visible to your role, so the register cannot be exported', 'error')
      return
    }
    setExporting(true)
    let url: string | undefined
    try {
      const params = new URLSearchParams({ companyId, from: date, to: date })
      const blob = await apiBlob(`/v1/reports/attendance-summary/export.csv?${params}`)
      url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `muster-roll-${date}.csv`
      a.click()
      if (deptId) {
        toast('Exported — note the CSV covers all departments; the server export has no department filter', 'info')
      } else {
        toast('Muster roll exported', 'success')
      }
    } catch (err) {
      toast((err as Error)?.message || 'Failed to export the muster roll', 'error')
    } finally {
      if (url) URL.revokeObjectURL(url)
      setExporting(false)
    }
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
          <>
            <HrButton variant="ghost" onClick={onRefresh} disabled={dashFetching}>
              <RefreshCw size={16} className={dashFetching ? 'animate-spin' : ''} /> Refresh
            </HrButton>
            {/* Gated on hrms.report.attendance — the code ReportController's
                @perm.check enforces on the export route. */}
            {canExport && (
              <HrButton
                onClick={onExportCsv}
                disabled={exporting || !companyId}
                title={companyId
                  ? `Download the register for ${date} as CSV`
                  : 'No company is visible to your role, so the register cannot be exported'}
              >
                <Download size={16} /> {exporting ? 'Exporting…' : 'Export CSV'}
              </HrButton>
            )}
          </>
        }
      />

      {/* Controls: date stepper + department filter */}
      <div className="ut-card ut-card-sm flex flex-wrap items-center gap-3 p-3">
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
              className="rounded-lg border border-border-default bg-white py-2 pl-8 pr-3 text-sm text-text-primary focus:border-[#059669] focus:outline-none focus:ring-2 focus:ring-[#059669]/20"
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
              className="ml-1 rounded-lg px-2.5 py-2 text-xs font-semibold text-[#047857] transition-colors hover:bg-[#ECFDF5]"
            >
              Today
            </button>
          )}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">Department</span>
          {/* An enabled dropdown whose only entry is "All departments" is a lie —
              it looks like a working filter and can never filter anything. When
              neither source yielded a department, disable it and say why. */}
          {departmentOptions.length === 0 ? (
            <span
              className="rounded-lg border border-dashed border-border-default bg-bg-base px-3 py-2 text-sm text-text-tertiary"
              title="No departments are readable for your role, or none have staff on this date."
            >
              No departments available
            </span>
          ) : (
            <select
              value={deptId}
              onChange={(e) => setDeptId(e.target.value)}
              className="rounded-lg border border-border-default bg-white py-2 pl-3 pr-8 text-sm text-text-primary focus:border-[#059669] focus:outline-none focus:ring-2 focus:ring-[#059669]/20"
            >
              <option value="">All departments</option>
              {departmentOptions.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          )}
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
          <div className="ut-card p-5">
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

          <div className="ut-card p-5">
            <h3 className="mb-1 text-sm font-bold text-text-primary">Headcount by Status</h3>
            <p className="mb-3 text-xs text-text-tertiary">Number of staff in each bucket</p>
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={distribution} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#EEF0F3" />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#6B7280' }} interval={0} angle={-20} textAnchor="end" height={48} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#6B7280' }} />
                  <Tooltip cursor={{ fill: '#ECFDF5' }} formatter={(v: number) => [`${v}`, 'Staff']} />
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
              <th className="text-right"><span className="sr-only">Actions</span></th>
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
                  {[...Array(7)].map((__, j) => (
                    <td key={j}><div className="h-3 w-16 animate-pulse rounded bg-bg-base" /></td>
                  ))}
                </tr>
              ))
            ) : dashError ? (
              <tr>
                <td colSpan={8}>
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
                <td colSpan={8}>
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
                    <td className="text-right">
                      {/* Quick jump into Manual Entry for this employee+date.
                          Deep-links via query string so the form arrives
                          pre-populated with the row's context. */}
                      <button
                        type="button"
                        onClick={() =>
                          navigate(`/hrms/attendance/manual-entry?employeeId=${encodeURIComponent(s.employeeId)}&date=${encodeURIComponent(date)}`)
                        }
                        title="Manual attendance entry for this employee"
                        aria-label={`Manual attendance entry for ${fullName(s)}`}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-text-tertiary transition-colors hover:bg-bg-base hover:text-[#047857]"
                      >
                        <ClipboardEdit size={14} />
                      </button>
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
