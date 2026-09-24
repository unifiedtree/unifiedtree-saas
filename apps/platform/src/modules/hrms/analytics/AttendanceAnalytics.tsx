import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckCircle2, Clock, Plane, AlertCircle, ChevronLeft, ChevronRight } from 'lucide-react'
import {
  addMonths, endOfMonth, format, getISODay, isAfter, parseISO, startOfMonth, subMonths,
} from 'date-fns'
import {
  ResponsiveContainer,
  PieChart, Pie, Cell,
  BarChart, Bar,
  LineChart, Line, Legend,
  XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts'
import { usePermission, P } from '@unifiedtree/sdk'
import {
  HrPageHeader, HrStatCard, HrStatusPill, TableCard, HrAvatar, HrTabs, HrTabPanel, HrButton,
} from '@/shared/components/hr'
import {
  useTeamDashboard, useAttendanceTrend, useAttendanceSources,
  type DailyAttendanceCounts,
} from '../api/useAttendance'
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
  'rounded-lg border border-border-default bg-white px-3 py-2 text-sm text-text-primary focus:border-[#059669] focus:outline-none focus:ring-2 focus:ring-[#059669]/20'

// Today's status breakdown → donut slices (label, value, color)
const STATUS_SLICES: { key: string; label: string; color: string }[] = [
  { key: 'present',      label: 'Present',     color: CHART.green },
  { key: 'late',         label: 'Late',        color: CHART.amber },
  { key: 'workFromHome', label: 'Work Home',   color: CHART.teal },
  { key: 'onLeave',      label: 'On Leave',    color: CHART.purple },
  { key: 'halfDay',      label: 'Half Day',    color: '#047857' },
  { key: 'absent',       label: 'Absent',      color: CHART.red },
  { key: 'notMarked',    label: 'Not Marked',  color: CHART.gray },
]

// Capture methods returned by GET /v1/attendance/dashboard/sources (CheckInMethod enum).
const SOURCE_LABELS: Record<string, string> = {
  BIOMETRIC_DEVICE: 'Biometric device',
  FACE_RECOGNITION: 'Face recognition',
  GPS: 'GPS',
  MANAGER_OVERRIDE: 'Manager override',
  MANUAL: 'Manual entry',
  PIN: 'PIN',
}

const WEEKDAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']

const tooltipStyle = { backgroundColor: '#ffffff', border: '1px solid #E5E7EB', borderRadius: 8, fontSize: 12 }

/** Drill-down target: Daily Logs filtered to one day (Attendance.tsx reads ?tab=team&date=). */
const dailyLogsHref = (date: string) => `/hrms/attendance?tab=team&date=${date}`

/** Inline error for one block — the query failed, so an empty message would be a lie. */
function BlockError({ message, onRetry, className = 'h-[260px]' }: { message: string; onRetry: () => void; className?: string }) {
  return (
    <div role="alert" className={`flex flex-col items-center justify-center gap-3 text-center text-sm text-text-secondary ${className}`}>
      <span>{message}</span>
      <HrButton size="sm" variant="ghost" onClick={onRetry}>Retry</HrButton>
    </div>
  )
}

/**
 * Month calendar driven by GET /v1/attendance/dashboard/trend — one cell per
 * day with the server's present / late / absent counts. Days after today are
 * never requested (the server would report the whole roster as absent), so
 * they render blank. Clicking a day opens Daily Logs for that date.
 */
function AttendanceCalendar({
  month, days, today, loading, error, onRetry, onPrev, onNext, canNext,
}: {
  month: Date
  days: DailyAttendanceCounts[]
  today: string
  loading: boolean
  error: boolean
  onRetry: () => void
  onPrev: () => void
  onNext: () => void
  canNext: boolean
}) {
  const navigate = useNavigate()
  const byDate = useMemo(() => new Map(days.map((d) => [d.date, d])), [days])
  const first = startOfMonth(month)
  const daysInMonth = endOfMonth(month).getDate()
  const leading = getISODay(first) - 1 // Monday-first grid

  return (
    <div className="ut-card p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="m-0 text-base font-semibold text-text-primary">{format(month, 'MMMM yyyy')}</h3>
          <p className="text-xs text-text-tertiary">Daily present, late and absent counts · click a day to open its logs</p>
        </div>
        <div className="flex items-center gap-2">
          <HrButton size="sm" variant="ghost" onClick={onPrev} aria-label="Previous month">
            <ChevronLeft size={14} /> Prev
          </HrButton>
          <HrButton size="sm" variant="ghost" onClick={onNext} disabled={!canNext} aria-label="Next month">
            Next <ChevronRight size={14} />
          </HrButton>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap gap-4 text-xs text-text-secondary">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: CHART.green }} />Present</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: CHART.amber }} />Late</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: CHART.red }} />Absent</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: CHART.purple }} />On leave</span>
      </div>

      {error ? (
        <BlockError message="Couldn't load attendance for this month." onRetry={onRetry} className="h-[320px]" />
      ) : !loading && days.length === 0 ? (
        <div className="flex h-[320px] items-center justify-center text-sm text-text-tertiary">No attendance data for this month</div>
      ) : (
        <div className="grid grid-cols-7 gap-2" data-testid="attendance-calendar">
          {WEEKDAYS.map((d) => (
            <div key={d} className="text-center text-xs font-semibold text-text-tertiary">{d}</div>
          ))}
          {Array.from({ length: leading }).map((_, i) => <div key={`pad-${i}`} />)}
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const date = format(new Date(first.getFullYear(), first.getMonth(), i + 1), 'yyyy-MM-dd')
            const weekend = (leading + i) % 7 >= 5
            const future = date > today
            const row = byDate.get(date)
            const base = `flex h-[92px] flex-col rounded-lg border border-border-default p-2 text-left ${weekend ? 'bg-bg-subtle' : 'bg-white'}`
            if (future || (!row && !loading)) {
              return (
                <div key={date} className={`${base} opacity-60`}>
                  <span className="text-right text-sm font-semibold text-text-tertiary">{i + 1}</span>
                </div>
              )
            }
            if (!row) {
              return (
                <div key={date} className={base}>
                  <span className="text-right text-sm font-semibold text-text-tertiary">{i + 1}</span>
                  <div className="mt-auto h-3 w-full animate-pulse rounded bg-bg-base" />
                </div>
              )
            }
            const label = `${format(parseISO(date), 'd MMM yyyy')}: ${row.present} present, ${row.late} late, ${row.absent} absent${row.onLeave ? `, ${row.onLeave} on leave` : ''}. Open daily logs`
            return (
              <button
                key={date}
                type="button"
                data-date={date}
                aria-label={label}
                title={label}
                onClick={() => navigate(dailyLogsHref(date))}
                className={`${base} transition-colors hover:border-[#059669] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#059669]/30 ${date === today ? 'ring-2 ring-[#059669]/40' : ''}`}
              >
                <span className="w-full text-right text-sm font-semibold text-text-primary">{i + 1}</span>
                <span className="mt-auto flex flex-col gap-0.5 text-[11px] tabular-nums leading-tight">
                  <span style={{ color: '#15803D' }}>{row.present} present</span>
                  {row.late > 0 && <span style={{ color: '#B45309' }}>{row.late} late</span>}
                  <span style={{ color: '#B91C1C' }}>{row.absent} absent</span>
                  {row.onLeave > 0 && <span style={{ color: '#6D28D9' }}>{row.onLeave} on leave</span>}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export const AttendanceAnalytics: React.FC = () => {
  const navigate = useNavigate()
  const now = new Date()
  const today = format(now, 'yyyy-MM-dd')
  const canTeamRead = usePermission(P.ATTENDANCE_TEAM_READ)

  // ── Period: one calendar month, clipped at today (the trend endpoint caps at
  // 31 days, and future days would be reported as whole-roster absences) ──────
  const [month, setMonth] = useState<Date>(() => startOfMonth(now))
  const isCurrentMonth = format(month, 'yyyy-MM') === format(now, 'yyyy-MM')
  const periodFrom = format(month, 'yyyy-MM-dd')
  const periodTo = isAfter(endOfMonth(month), now) ? today : format(endOfMonth(month), 'yyyy-MM-dd')
  const periodLabel = `${format(parseISO(periodFrom), 'd MMM')} – ${format(parseISO(periodTo), 'd MMM yyyy')}`
  const goPrev = () => setMonth((m) => subMonths(m, 1))
  const goNext = () => { if (!isCurrentMonth) setMonth((m) => addMonths(m, 1)) }

  // ── Company scope (reports require a companyId) ──────────────────────────────
  const { data: companies = [], isLoading: companiesLoading } = useCompanies()
  const [companyId, setCompanyId] = useState<string>('')
  useEffect(() => {
    if (!companyId && companies.length > 0) setCompanyId(companies[0].id)
  }, [companies, companyId])

  // ── Live data ────────────────────────────────────────────────────────────────
  const { data: dashboard, isLoading: dashLoading, isError: dashError, refetch: refetchDash } = useTeamDashboard(today)
  const { data: summary = [], isLoading: summaryLoading, isError: summaryError, refetch: refetchSummary } =
    useAttendanceSummaryReport(companyId || null, periodFrom, periodTo)
  const { data: lateMarks = [], isLoading: lateLoading, isError: lateError, refetch: refetchLate } =
    useLateMarksReport(companyId || null, periodFrom, periodTo)
  const { data: trend = [], isLoading: trendLoading, isError: trendError, refetch: refetchTrend } =
    useAttendanceTrend(periodFrom, periodTo, undefined, canTeamRead)
  const { data: sources, isLoading: sourcesLoading, isError: sourcesError, refetch: refetchSources } =
    useAttendanceSources(today, undefined, canTeamRead)

  
  const [tab, setTab] = useState<'dash' | 'cal'>('dash')
  const tabs = [
    { key: 'dash', label: 'Dashboard Overview' },
    { key: 'cal', label: 'Attendance Calendar' }
  ]

  const counts = dashboard?.counts

  // ── Trend line: per-day present / late / absent for the period ──────────────
  const trendData = useMemo(
    () => trend.map((d) => ({ date: d.date, Present: d.present, Late: d.late, Absent: d.absent })),
    [trend],
  )

  // ── Punch sources today (zero-count methods are kept for a stable shape) ─────
  const sourceRows = useMemo(() => {
    if (!sources) return []
    const rows = sources.sources.map((s) => ({ label: SOURCE_LABELS[s.method] ?? s.method, count: s.count }))
    if (sources.unknown > 0) rows.push({ label: 'Not recorded', count: sources.unknown })
    return rows.sort((a, b) => b.count - a.count)
  }, [sources])
  const sourcesTotal = sourceRows.reduce((acc, r) => acc + r.count, 0)

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
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1" role="group" aria-label="Period">
              <HrButton size="sm" variant="ghost" onClick={goPrev} aria-label="Previous period">
                <ChevronLeft size={14} />
              </HrButton>
              <input
                type="month"
                aria-label="Period month"
                value={format(month, 'yyyy-MM')}
                max={format(now, 'yyyy-MM')}
                onChange={(e) => {
                  if (!/^\d{4}-\d{2}$/.test(e.target.value)) return
                  const picked = startOfMonth(parseISO(`${e.target.value}-01`))
                  if (!isAfter(picked, now)) setMonth(picked)
                }}
                className={selectCls}
              />
              <HrButton size="sm" variant="ghost" onClick={goNext} disabled={isCurrentMonth} aria-label="Next period">
                <ChevronRight size={14} />
              </HrButton>
            </div>
            <select
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
              className={selectCls}
              aria-label="Company"
              disabled={companiesLoading || companies.length === 0}
            >
              {companies.length === 0 && <option value="">No companies</option>}
              {companies.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        }
      />


      <HrTabs tabs={tabs} active={tab} onChange={(k) => setTab(k as any)} />
      
      <div className="mt-6">
        {tab === 'dash' && (
          <HrTabPanel tabKey="dash">
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
        <div className="ut-card ut-card-lg p-5">
          <p className="text-sm font-semibold text-text-primary">Today's Status Breakdown</p>
          <p className="mb-3 text-xs text-text-tertiary">Live distribution across tracked staff</p>
          {dashLoading ? (
            <div className="flex h-[260px] items-center justify-center text-sm text-text-tertiary">Loading…</div>
          ) : dashError ? (
            <BlockError message="Couldn't load today's attendance." onRetry={() => refetchDash()} />
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
        <div className="ut-card ut-card-lg p-5">
          <p className="text-sm font-semibold text-text-primary">Late Marks · {format(month, 'MMM yyyy')}</p>
          <p className="mb-3 text-xs text-text-tertiary">Top offenders, {periodLabel}</p>
          {!companyId ? (
            <div className="flex h-[260px] items-center justify-center text-sm text-text-tertiary">Select a company to view late marks</div>
          ) : lateLoading ? (
            <div className="flex h-[260px] items-center justify-center text-sm text-text-tertiary">Loading…</div>
          ) : lateError ? (
            <BlockError message="Couldn't load late marks." onRetry={() => refetchLate()} />
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

      {/* ── Trend (period) + punch sources (today) ──────────────────────────────── */}
      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="ut-card ut-card-lg p-5 lg:col-span-2">
          <p className="text-sm font-semibold text-text-primary">Attendance Trend</p>
          <p className="mb-3 text-xs text-text-tertiary">Daily present, late and absent, {periodLabel} · click a day to open its logs</p>
          {!canTeamRead ? (
            <div className="flex h-[260px] items-center justify-center text-sm text-text-tertiary">You need team attendance access to view the trend</div>
          ) : trendLoading ? (
            <div className="flex h-[260px] items-center justify-center text-sm text-text-tertiary">Loading…</div>
          ) : trendError ? (
            <BlockError message="Couldn't load the attendance trend." onRetry={() => refetchTrend()} />
          ) : trendData.length === 0 ? (
            <div className="flex h-[260px] items-center justify-center text-sm text-text-tertiary">No attendance data for this period</div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <LineChart
                data={trendData}
                margin={{ top: 4, right: 16, left: -8, bottom: 4 }}
                onClick={(state) => {
                  const label = state?.activeLabel
                  if (typeof label === 'string') navigate(dailyLogsHref(label))
                }}
                style={{ cursor: 'pointer' }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
                <XAxis dataKey="date" tickFormatter={(d: string) => format(parseISO(d), 'd')} tick={{ fontSize: 11, fill: '#94A3B8' }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#94A3B8' }} />
                <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: '#111827' }} labelFormatter={(d: string) => format(parseISO(d), 'EEE, d MMM yyyy')} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="Present" stroke={CHART.green} strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="Late" stroke={CHART.amber} strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="Absent" stroke={CHART.red} strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="ut-card ut-card-lg p-5">
          <p className="text-sm font-semibold text-text-primary">Punch Sources Today</p>
          <p className="mb-3 text-xs text-text-tertiary">How today's check-ins were captured</p>
          {!canTeamRead ? (
            <div className="flex h-[260px] items-center justify-center text-sm text-text-tertiary">You need team attendance access to view punch sources</div>
          ) : sourcesLoading ? (
            <div className="flex h-[260px] items-center justify-center text-sm text-text-tertiary">Loading…</div>
          ) : sourcesError ? (
            <BlockError message="Couldn't load punch sources." onRetry={() => refetchSources()} />
          ) : sourcesTotal === 0 ? (
            <div className="flex h-[260px] items-center justify-center text-sm text-text-tertiary">No check-ins recorded today</div>
          ) : (
            <ul className="space-y-3" data-testid="punch-sources">
              {sourceRows.map((r) => (
                <li key={r.label} className="text-sm">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-text-secondary">{r.label}</span>
                    <span className="font-semibold tabular-nums text-text-primary">{r.count}</span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-bg-subtle">
                    <div className="h-1.5 rounded-full bg-[#059669]" style={{ width: `${Math.round((r.count / sourcesTotal) * 100)}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* ── Per-employee attendance summary ────────────────────────────────────── */}
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-text-primary">Employee Attendance Summary</h2>
        <span className="text-xs text-text-tertiary">{periodLabel}</span>
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
            ) : summaryError ? (
              <tr><td colSpan={6}><BlockError message="Couldn't load the attendance summary." onRetry={() => refetchSummary()} className="py-10" /></td></tr>
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
          </HrTabPanel>
        )}
        {tab === 'cal' && (
          <HrTabPanel tabKey="cal">
            {canTeamRead ? (
              <AttendanceCalendar
                month={month}
                days={trend}
                today={today}
                loading={trendLoading}
                error={trendError}
                onRetry={() => refetchTrend()}
                onPrev={goPrev}
                onNext={goNext}
                canNext={!isCurrentMonth}
              />
            ) : (
              <div className="ut-card p-10 text-center text-sm text-text-tertiary">
                You need team attendance access to view the attendance calendar.
              </div>
            )}
          </HrTabPanel>
        )}
      </div>

    </div>
  )
}
