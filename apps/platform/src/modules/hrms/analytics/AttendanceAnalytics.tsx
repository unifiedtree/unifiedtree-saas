import React, { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Clock, Plane, AlertCircle } from 'lucide-react'
import { format, startOfMonth } from 'date-fns'
import {
  ResponsiveContainer,
  PieChart, Pie, Cell,
  BarChart, Bar,
  XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts'
import {
  HrPageHeader, HrStatCard, HrStatusPill, TableCard, HrAvatar,
} from '@/shared/components/hr'
import { useTeamDashboard } from '../api/useAttendance'
import { useAttendanceSummaryReport, useLateMarksReport } from '../api/useReports'
import { useCompanies } from '../api/useOrg'

const CHART = {
  blue: '#2563EB',
  green: '#22C55E',
  amber: '#F59E0B',
  purple: '#8B5CF6',
  red: '#EF4444',
  teal: '#06B6D4',
  gray: '#94A3B8',
}

const selectCls =
  'rounded-lg border border-border-default bg-white px-3 py-2 text-sm text-text-primary focus:border-[#FF9D00] focus:outline-none focus:ring-2 focus:ring-[#FF9D00]/20'

// Today's status breakdown → donut slices (label, value, color)
const STATUS_SLICES: { key: string; label: string; color: string }[] = [
  { key: 'present',      label: 'Present',     color: CHART.green },
  { key: 'late',         label: 'Late',        color: CHART.amber },
  { key: 'workFromHome', label: 'Work Home',   color: CHART.teal },
  { key: 'onLeave',      label: 'On Leave',    color: CHART.purple },
  { key: 'halfDay',      label: 'Half Day',    color: '#C16E00' },
  { key: 'absent',       label: 'Absent',      color: CHART.red },
  { key: 'notMarked',    label: 'Not Marked',  color: CHART.gray },
]

export const AttendanceAnalytics: React.FC = () => {
  const today = format(new Date(), 'yyyy-MM-dd')
  const monthStart = format(startOfMonth(new Date()), 'yyyy-MM-dd')

  // ── Company scope (reports require a companyId) ──────────────────────────────
  const { data: companies = [], isLoading: companiesLoading } = useCompanies()
  const [companyId, setCompanyId] = useState<string>('')
  useEffect(() => {
    if (!companyId && companies.length > 0) setCompanyId(companies[0].id)
  }, [companies, companyId])

  // ── Live data ────────────────────────────────────────────────────────────────
  const { data: dashboard, isLoading: dashLoading } = useTeamDashboard(today)
  const { data: summary = [], isLoading: summaryLoading } =
    useAttendanceSummaryReport(companyId || null, monthStart, today)
  const { data: lateMarks = [], isLoading: lateLoading } =
    useLateMarksReport(companyId || null, monthStart, today)

  const counts = dashboard?.counts

  // ── Donut: today's status breakdown ──────────────────────────────────────────
  const donutData = useMemo(() => {
    if (!counts) return []
    return STATUS_SLICES
      .map((s) => ({ name: s.label, value: (counts as unknown as Record<string, number>)[s.key] ?? 0, color: s.color }))
      .filter((d) => d.value > 0)
  }, [counts])

  const totalToday = useMemo(
    () => donutData.reduce((acc, d) => acc + d.value, 0),
    [donutData],
  )

  // ── Bar: late marks aggregated per employee (top 10 by # of late marks) ───────
  const lateByEmployee = useMemo(() => {
    const map = new Map<string, { name: string; marks: number; totalMins: number }>()
    for (const r of lateMarks) {
      const key = r.employee_code || r.employee_name
      const cur = map.get(key) ?? { name: r.employee_name, marks: 0, totalMins: 0 }
      cur.marks += 1
      cur.totalMins += r.late_by_minutes ?? 0
      map.set(key, cur)
    }
    return [...map.values()]
      .sort((a, b) => b.marks - a.marks)
      .slice(0, 10)
      .map((e) => ({ name: e.name, 'Late Marks': e.marks, avgMins: Math.round(e.totalMins / e.marks) }))
  }, [lateMarks])

  return (
    <div className="mx-auto max-w-6xl p-6 sm:p-8">
      <HrPageHeader
        crumb="Attendance & Time"
        title="Attendance Analytics"
        subtitle={`Live attendance snapshot for ${format(new Date(), 'EEEE, d MMM yyyy')}`}
        actions={
          <select
            value={companyId}
            onChange={(e) => setCompanyId(e.target.value)}
            className={selectCls}
            disabled={companiesLoading || companies.length === 0}
          >
            {companies.length === 0 && <option value="">No companies</option>}
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        }
      />

      {/* ── KPI cards (today, from team dashboard) ─────────────────────────────── */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <HrStatCard
          icon={<CheckCircle2 size={18} />}
          color="green"
          value={counts?.present ?? 0}
          label="Present Today"
          sub={totalToday > 0 ? `${Math.round(((counts?.present ?? 0) / totalToday) * 100)}% of tracked staff` : 'No records yet'}
          loading={dashLoading}
        />
        <HrStatCard
          icon={<Clock size={18} />}
          color="orange"
          value={counts?.late ?? 0}
          label="Late Today"
          sub={(counts?.late ?? 0) > 0 ? 'Arrived after grace window' : 'All on time'}
          loading={dashLoading}
        />
        <HrStatCard
          icon={<Plane size={18} />}
          color="purple"
          value={counts?.onLeave ?? 0}
          label="On Leave Today"
          sub={`${counts?.workFromHome ?? 0} working from home`}
          loading={dashLoading}
        />
        <HrStatCard
          icon={<AlertCircle size={18} />}
          color="red"
          value={counts?.notMarked ?? 0}
          label="Not Marked"
          sub={(counts?.absent ?? 0) > 0 ? `${counts?.absent} marked absent` : 'No absences'}
          loading={dashLoading}
        />
      </div>

      {/* ── Charts row ─────────────────────────────────────────────────────────── */}
      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Donut: today's status breakdown */}
        <div className="rounded-xl border border-border-default bg-white p-5 shadow-sm">
          <p className="text-sm font-semibold text-text-primary">Today's Status Breakdown</p>
          <p className="mb-3 text-xs text-text-tertiary">Live distribution across tracked staff</p>
          {dashLoading ? (
            <div className="flex h-[260px] items-center justify-center text-sm text-text-tertiary">Loading…</div>
          ) : donutData.length === 0 ? (
            <div className="flex h-[260px] items-center justify-center text-sm text-text-tertiary">No attendance recorded yet</div>
          ) : (
            <div className="flex flex-col items-center gap-4 sm:flex-row">
              <div className="relative h-[220px] w-full sm:w-1/2">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={donutData}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={62}
                      outerRadius={90}
                      paddingAngle={2}
                      stroke="none"
                    >
                      {donutData.map((d) => <Cell key={d.name} fill={d.color} />)}
                    </Pie>
                    <Tooltip
                      contentStyle={{ backgroundColor: '#ffffff', border: '1px solid #E5E7EB', borderRadius: 8, fontSize: 12 }}
                      labelStyle={{ color: '#111827' }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-[26px] font-bold leading-none text-text-primary">{totalToday}</span>
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">Tracked</span>
                </div>
              </div>
              <ul className="w-full space-y-2 sm:w-1/2">
                {donutData.map((d) => (
                  <li key={d.name} className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: d.color }} />
                      <span className="text-text-secondary">{d.name}</span>
                    </span>
                    <span className="font-semibold text-text-primary">{d.value}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Bar: late marks per employee (period to date) */}
        <div className="rounded-xl border border-border-default bg-white p-5 shadow-sm">
          <p className="text-sm font-semibold text-text-primary">Late Marks This Month</p>
          <p className="mb-3 text-xs text-text-tertiary">Top offenders since {format(startOfMonth(new Date()), 'd MMM')}</p>
          {!companyId ? (
            <div className="flex h-[260px] items-center justify-center text-sm text-text-tertiary">Select a company to view late marks</div>
          ) : lateLoading ? (
            <div className="flex h-[260px] items-center justify-center text-sm text-text-tertiary">Loading…</div>
          ) : lateByEmployee.length === 0 ? (
            <div className="flex h-[260px] items-center justify-center text-sm text-text-tertiary">No late marks in this period</div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={lateByEmployee} layout="vertical" margin={{ top: 4, right: 16, left: 80, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" horizontal={false} />
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: '#94A3B8' }} />
                <YAxis type="category" dataKey="name" width={80} tick={{ fontSize: 10, fill: '#94A3B8' }} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#ffffff', border: '1px solid #E5E7EB', borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: '#111827' }}
                  formatter={(v: number, _n, p) => [`${v} marks · ${(p?.payload?.avgMins ?? 0)} min avg`, 'Late']}
                />
                <Bar dataKey="Late Marks" fill="#F59E0B" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* ── Per-employee attendance summary ────────────────────────────────────── */}
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-text-primary">Employee Attendance Summary</h2>
        <span className="text-xs text-text-tertiary">
          {format(startOfMonth(new Date()), 'd MMM')} – {format(new Date(), 'd MMM yyyy')}
        </span>
      </div>
      <TableCard>
        <table className="hr-table">
          <thead>
            <tr>
              <th>Employee</th>
              <th>Department</th>
              <th>Present</th>
              <th>Late</th>
              <th>Avg Hours</th>
              <th>Overtime (min)</th>
            </tr>
          </thead>
          <tbody>
            {!companyId ? (
              <tr><td colSpan={6} className="py-10 text-center text-sm text-text-tertiary">Select a company to view the summary.</td></tr>
            ) : summaryLoading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <tr key={i}>
                  {Array.from({ length: 6 }).map((__, j) => (
                    <td key={j}><div className="h-4 w-full max-w-[120px] animate-pulse rounded bg-bg-base" /></td>
                  ))}
                </tr>
              ))
            ) : summary.length === 0 ? (
              <tr><td colSpan={6} className="py-10 text-center text-sm text-text-tertiary">No attendance records for this period.</td></tr>
            ) : (
              summary.map((r, i) => (
                <tr key={r.employee_code}>
                  <td><HrAvatar name={r.employee_name} sub={r.employee_code} seed={i} /></td>
                  <td>{r.department ?? '—'}</td>
                  <td>{r.present_days}</td>
                  <td>{r.late_days > 0 ? <HrStatusPill tone="late">{r.late_days}</HrStatusPill> : r.late_days}</td>
                  <td>{r.avg_hours != null ? r.avg_hours.toFixed(1) : '—'}</td>
                  <td>{r.total_overtime_mins}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </TableCard>
    </div>
  )
}
