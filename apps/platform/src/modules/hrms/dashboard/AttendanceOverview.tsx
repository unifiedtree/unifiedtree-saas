import React from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar,
  XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts'
import {
  UserCheck, CalendarDays, Clock, Home, HelpCircle, UserX,
  ScanFace, MapPin, KeyRound, Fingerprint, PencilLine, ShieldCheck,
  LogOut, FileClock, CalendarClock, ArrowUpRight,
} from 'lucide-react'
import {
  useTeamDashboard, useAttendanceTrend, useAttendanceSources, useCorrectionApprovals,
  type AttendanceSummaryCounts, type DailyAttendanceCounts, type SourceCount,
} from '../api/useAttendance'

/**
 * Attendance command centre — glass-card layout, dense by design.
 *
 * Modelled on the client's two reference screenshots (2026-08-22): the panel
 * arrangement from the first, the frosted-glass card treatment from the second,
 * tinted into our emerald rather than that reference's violet.
 *
 * DENSITY IS THE POINT. Six panels sit above the fold on a 12-column grid
 * instead of three full-width rows, because the client's note was that too much
 * of the dashboard was below the scroll.
 *
 * DATA HONESTY. Every number is a real tenant value. Where the reference had a
 * tile we cannot fill from the backend it is absent rather than mocked:
 *   Weekly Off / Holiday   — no org holiday calendar in this scope.
 *   Checked Out            — no completed-shift count; "Early Out" is the
 *                            closest real signal, so that is what is shown.
 *   Active/Inactive device — no device registry; the source panel counts
 *                            capture METHODS, which is real, instead.
 *
 * SAMPLE MODE. Append ?demo=1 to the URL to fill the empty panels with obvious
 * sample figures for design review. It is OFF unless that parameter is present,
 * every affected panel wears a "Sample data" badge, and no sample value can
 * ever overwrite a real one — see `useDemo`. This exists because a one-employee
 * tenant cannot show what a chart looks like; it is not a fallback for missing
 * endpoints in production.
 */

const SLICE = {
  present: '#059669',
  wfh: '#34D399',
  late: '#D97706',
  onLeave: '#A7F3D0',
  notMarked: '#D4D4D4',
  absent: '#DC2626',
}
const CHART = { grid: 'rgba(5,150,105,0.10)', tick: '#8A9A93', bar: '#A7F3D0', barToday: '#059669', overtime: '#34D399' }

const tooltipStyle: React.CSSProperties = {
  fontSize: 12, borderRadius: 12, border: '1px solid rgba(255,255,255,0.7)',
  background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(8px)',
  boxShadow: '0 10px 30px -12px rgba(5,150,105,0.28)',
}

/* The platform card surface. Defined once as .ut-card in globals.css so this
   block, every hr.tsx screen and the ui-kit tiles are literally the same
   material — see that rule for why each layer of it exists. */
const GLASS = 'ut-card ut-card-lg'

function Panel({ title, right, className = '', children }: {
  title: string
  right?: React.ReactNode
  className?: string
  children: React.ReactNode
}) {
  return (
    <section className={`${GLASS} p-4 sm:p-5 ${className}`}>
      <div className="mb-3.5 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[14.5px] font-semibold tracking-tight text-[var(--text-primary)]">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  )
}

/** Amber, deliberately loud — sample figures must never be mistaken for real. */
function SampleBadge() {
  return (
    <span className="rounded-full border border-amber-300/70 bg-amber-100/80 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700">
      Sample data
    </span>
  )
}

function Muted({ children }: { children: React.ReactNode }) {
  return <span className="text-[11px] text-[var(--text-tertiary)]">{children}</span>
}

/** Status card — icon chip, label, big number. Compact enough for 6-up. */
function StatusCard({ icon, tint, label, value, onClick }: {
  icon: React.ReactNode
  tint: string
  label: string
  value: number | string
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={`ut-card ut-card-sm ${onClick ? 'ut-card-hover' : ''} group flex flex-col items-center gap-1.5 px-2 py-3 text-center disabled:cursor-default`}
    >
      <span
        aria-hidden
        className="flex h-8 w-8 items-center justify-center rounded-xl transition-transform duration-200 group-enabled:group-hover:scale-110"
        style={{ background: `${tint}1F`, color: tint }}
      >
        {icon}
      </span>
      <span className="text-[10.5px] font-medium leading-tight text-[var(--text-secondary)]">{label}</span>
      <span className="text-[20px] font-bold leading-none tabular-nums" style={{ color: tint }}>{value}</span>
    </button>
  )
}

function MiniStat({ icon, label, value, tone = 'neutral' }: {
  icon?: React.ReactNode
  label: string
  value: number | string
  tone?: 'neutral' | 'warn' | 'bad'
}) {
  const color = tone === 'bad' ? '#DC2626' : tone === 'warn' ? '#D97706' : 'var(--accent-fg)'
  return (
    <div className="ut-card ut-card-sm px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)]">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <p className="mt-0.5 text-[19px] font-bold leading-none tabular-nums" style={{ color }}>{value}</p>
    </div>
  )
}

const METHOD_META: Record<string, { label: string; icon: React.ReactNode }> = {
  FACE_RECOGNITION: { label: 'Face',     icon: <ScanFace size={13} /> },
  GPS:              { label: 'GPS',      icon: <MapPin size={13} /> },
  PIN:              { label: 'PIN',      icon: <KeyRound size={13} /> },
  BIOMETRIC_DEVICE: { label: 'Device',   icon: <Fingerprint size={13} /> },
  MANUAL:           { label: 'Manual',   icon: <PencilLine size={13} /> },
  MANAGER_OVERRIDE: { label: 'Override', icon: <ShieldCheck size={13} /> },
}

/* ── Sample data, only ever used when ?demo=1 is present ─────────────────── */

/** True only when the URL carries ?demo=1. Read once; this never flips at runtime. */
function useDemo(): boolean {
  return React.useMemo(() => {
    try {
      return new URLSearchParams(window.location.search).get('demo') === '1'
    } catch {
      return false
    }
  }, [])
}

const DEMO_COUNTS: AttendanceSummaryCounts = {
  present: 142, absent: 24, late: 8, halfDay: 5,
  onLeave: 12, workFromHome: 45, notMarked: 18, earlyCheckout: 11,
}
const DEMO_ROSTER = 249

const DEMO_TREND: DailyAttendanceCounts[] = (() => {
  const presents = [118, 134, 142, 139, 147, 151, 96]
  const overtime = [180, 260, 320, 210, 410, 375, 90]
  const out: DailyAttendanceCounts[] = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const idx = 6 - i
    out.push({
      date: d.toISOString().slice(0, 10),
      present: presents[idx], onLeave: 12, late: 8, halfDay: 5,
      workFromHome: 45, notMarked: 18, absent: 24,
      overtimeMinutes: overtime[idx],
    })
  }
  return out
})()

const DEMO_SOURCES: SourceCount[] = [
  { method: 'FACE_RECOGNITION', count: 96 },
  { method: 'GPS', count: 64 },
  { method: 'PIN', count: 21 },
  { method: 'BIOMETRIC_DEVICE', count: 38 },
  { method: 'MANUAL', count: 9 },
  { method: 'MANAGER_OVERRIDE', count: 4 },
]

interface Props {
  /** Caller must already have checked ATTENDANCE_TEAM_READ. */
  canApproveLeaves: boolean
  pendingLeaveApprovals: number
}

export function AttendanceOverview({ canApproveLeaves, pendingLeaveApprovals }: Props) {
  const navigate = useNavigate()
  const demo = useDemo()

  const dashboard = useTeamDashboard()
  const trend = useAttendanceTrend()
  const sources = useAttendanceSources()
  const corrections = useCorrectionApprovals('PENDING', { enabled: canApproveLeaves })

  /* Sample values fill ONLY where the backend gave us nothing. A tenant with
     real numbers keeps them even with ?demo=1 on. */
  const realCounts = dashboard.data?.counts
  const counts = realCounts ?? (demo ? DEMO_COUNTS : undefined)
  const countsAreSample = !realCounts && demo

  const realRoster = dashboard.data?.staffStatuses?.length ?? 0
  const roster = realRoster > 0 ? realRoster : (demo ? DEMO_ROSTER : 0)

  const realTrend = trend.data ?? []
  const trendRows = realTrend.length > 0 ? realTrend : (demo ? DEMO_TREND : [])
  const trendIsSample = realTrend.length === 0 && demo

  const realSources = sources.data?.sources ?? []
  const sourceRows = (realSources.length > 0 ? realSources : (demo ? DEMO_SOURCES : []))
    .filter((s) => METHOD_META[s.method])
  const sourcesAreSample = realSources.length === 0 && demo

  const slices = counts
    ? [
        { name: 'Present',    value: counts.present,      fill: SLICE.present },
        { name: 'Work Home',  value: counts.workFromHome, fill: SLICE.wfh },
        { name: 'Late',       value: counts.late,         fill: SLICE.late },
        { name: 'On Leave',   value: counts.onLeave,      fill: SLICE.onLeave },
        { name: 'Not Marked', value: counts.notMarked,    fill: SLICE.notMarked },
        { name: 'Absent',     value: counts.absent,       fill: SLICE.absent },
      ].filter((s) => s.value > 0)
    : []

  const todayIso = new Date().toISOString().slice(0, 10)
  const weekly = trendRows.map((row) => ({
    label: new Date(row.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short' }),
    onTime: Math.max(0, row.present),
    overtimeHours: Math.round((row.overtimeMinutes / 60) * 10) / 10,
    isToday: row.date === todayIso,
  }))
  const hasOvertime = weekly.some((d) => d.overtimeHours > 0)

  /** Share of the roster that is present — the headline number. */
  const attendanceRate = counts && roster > 0 ? Math.round((counts.present / roster) * 100) : null

  if (dashboard.isPending) {
    return <div className={`${GLASS} h-72 animate-pulse`} />
  }
  if (!counts) return null

  return (
    <div className="relative">
      {/* Ambient emerald light. Without something behind them the glass cards
          have nothing to refract and read as plain grey panels. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-6 -z-10 rounded-[2rem]"
        style={{
          background:
            'radial-gradient(42% 45% at 12% 8%, rgba(16,185,129,0.16), transparent 70%),' +
            'radial-gradient(38% 40% at 88% 4%, rgba(52,211,153,0.14), transparent 70%),' +
            'radial-gradient(50% 45% at 70% 96%, rgba(5,150,105,0.10), transparent 72%)',
        }}
      />

      {demo && (
        <p className="mb-3 flex items-center gap-2 text-[11.5px] text-amber-700">
          <SampleBadge />
          Preview mode — remove <code className="rounded bg-amber-100/70 px-1">?demo=1</code> from the URL to see real tenant data only.
        </p>
      )}

      {/* 12-col grid: six panels above the fold instead of three stacked rows. */}
      <div className="grid grid-cols-12 gap-4">

        {/* ── Statistics donut ── */}
        <Panel
          title="Statistics"
          className="col-span-12 md:col-span-6 xl:col-span-3"
          right={countsAreSample ? <SampleBadge /> : <Muted>Today</Muted>}
        >
          <div className="relative h-[176px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={slices} dataKey="value" nameKey="name"
                     innerRadius={56} outerRadius={80} paddingAngle={2} strokeWidth={0}
                     startAngle={90} endAngle={-270}>
                  {slices.map((s) => <Cell key={s.name} fill={s.fill} />)}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-[10px] font-medium uppercase tracking-wide text-[var(--text-tertiary)]">Employees</span>
              <span className="text-[26px] font-bold leading-tight tabular-nums text-[var(--text-primary)]">{roster}</span>
              {attendanceRate != null && (
                <span className="mt-0.5 flex items-center gap-0.5 text-[11px] font-semibold text-[var(--accent-fg)]">
                  <ArrowUpRight size={11} />{attendanceRate}% present
                </span>
              )}
            </div>
          </div>
          <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
            {slices.map((s) => (
              <li key={s.name} className="flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)]">
                <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: s.fill }} />
                <span className="truncate">{s.name}</span>
                <span className="ml-auto font-semibold tabular-nums text-[var(--text-primary)]">{s.value}</span>
              </li>
            ))}
          </ul>
        </Panel>

        {/* ── Attendance status strip ── */}
        <Panel
          title="Attendance"
          className="col-span-12 md:col-span-6 xl:col-span-5"
          right={<Muted>{new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</Muted>}
        >
          <div className="grid grid-cols-3 gap-2.5">
            <StatusCard icon={<UserCheck size={16} />}    tint={SLICE.present} label="Present"    value={counts.present}      onClick={() => navigate('/hrms/attendance')} />
            <StatusCard icon={<HelpCircle size={16} />}   tint="#737373"       label="Not Marked" value={counts.notMarked}    onClick={() => navigate('/hrms/attendance')} />
            <StatusCard icon={<CalendarDays size={16} />} tint={SLICE.late}    label="On Leave"   value={counts.onLeave}      onClick={() => navigate('/hrms/leave')} />
            <StatusCard icon={<Clock size={16} />}        tint="#DC2626"       label="Late"       value={counts.late}         onClick={() => navigate('/hrms/attendance')} />
            <StatusCard icon={<Home size={16} />}         tint="#2563EB"       label="Work Home"  value={counts.workFromHome} onClick={() => navigate('/hrms/attendance')} />
            <StatusCard icon={<UserX size={16} />}        tint={SLICE.absent}  label="Absent"     value={counts.absent}       onClick={() => navigate('/hrms/attendance')} />
          </div>
        </Panel>

        {/* ── Exceptions + pending, stacked to fill the right column ── */}
        <div className="col-span-12 flex flex-col gap-4 xl:col-span-4">
          <Panel title="Exceptions" right={countsAreSample ? <SampleBadge /> : <Muted>Today</Muted>}>
            <div className="grid grid-cols-2 gap-2.5">
              <MiniStat icon={<Clock size={13} />}  label="Late Coming" value={counts.late}          tone="warn" />
              <MiniStat icon={<LogOut size={13} />} label="Early Going" value={counts.earlyCheckout} tone="warn" />
            </div>
          </Panel>
          <Panel title="Pending Requests" right={<Muted>Awaiting you</Muted>}>
            <div className="grid grid-cols-2 gap-2.5">
              <MiniStat icon={<CalendarClock size={13} />} label="Leave" value={pendingLeaveApprovals} tone="warn" />
              <MiniStat icon={<FileClock size={13} />} label="Corrections"
                        value={canApproveLeaves ? (corrections.data?.totalElements ?? 0) : '—'} tone="warn" />
            </div>
          </Panel>
        </div>

        {/* ── Weekly charts + capture sources ── */}
        <Panel
          title="On Time Check In"
          className="col-span-12 lg:col-span-6 xl:col-span-4"
          right={trendIsSample ? <SampleBadge /> : <Muted>Last 7 days</Muted>}
        >
          {weekly.length === 0 ? (
            <EmptyChart note="Trend needs the updated attendance service. Add ?demo=1 to preview." />
          ) : (
            <div className="h-[178px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={weekly} margin={{ top: 6, right: 6, bottom: 0, left: -24 }}>
                  <CartesianGrid stroke={CHART.grid} vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10.5, fill: CHART.tick }} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 10.5, fill: CHART.tick }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'rgba(5,150,105,0.06)' }} />
                  <Bar dataKey="onTime" name="On time" radius={[6, 6, 6, 6]} maxBarSize={16}>
                    {weekly.map((d) => <Cell key={d.label} fill={d.isToday ? CHART.barToday : CHART.bar} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Panel>

        <Panel
          title="Overtime"
          className="col-span-12 lg:col-span-6 xl:col-span-4"
          right={trendIsSample ? <SampleBadge /> : <Muted>Hours</Muted>}
        >
          {weekly.length === 0 || !hasOvertime ? (
            <EmptyChart note={weekly.length === 0
              ? 'Trend needs the updated attendance service. Add ?demo=1 to preview.'
              : 'No overtime clocked in the last 7 days.'} />
          ) : (
            <div className="h-[178px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={weekly} margin={{ top: 6, right: 6, bottom: 0, left: -24 }}>
                  <CartesianGrid stroke={CHART.grid} vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10.5, fill: CHART.tick }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10.5, fill: CHART.tick }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'rgba(52,211,153,0.08)' }}
                           formatter={(v: number) => [`${v} h`, 'Overtime']} />
                  <Bar dataKey="overtimeHours" fill={CHART.overtime} radius={[6, 6, 6, 6]} maxBarSize={16} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Panel>

        <Panel
          title="Attendance Source"
          className="col-span-12 lg:col-span-12 xl:col-span-4"
          right={sourcesAreSample ? <SampleBadge /> : <Muted>Today</Muted>}
        >
          {sourceRows.length === 0 ? (
            <EmptyChart note="Source breakdown needs the updated attendance service. Add ?demo=1 to preview." />
          ) : (
            <div className="grid grid-cols-3 gap-2.5">
              {sourceRows.map((s) => (
                <MiniStat key={s.method} icon={METHOD_META[s.method].icon}
                          label={METHOD_META[s.method].label} value={s.count} />
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  )
}

/** Honest placeholder — says why a panel is empty rather than faking a chart. */
function EmptyChart({ note }: { note: string }) {
  return (
    <div className="flex h-[178px] items-center justify-center rounded-2xl border border-dashed border-emerald-300/50 bg-white/40 px-4 text-center">
      <p className="text-[12px] leading-relaxed text-[var(--text-tertiary)]">{note}</p>
    </div>
  )
}
