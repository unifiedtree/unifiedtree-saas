import { attendanceDate } from './attendance/date'
import { CorrectionApprovals } from './attendance/CorrectionApprovals'
import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Clock, CheckCircle, XCircle, FileText } from 'lucide-react'
import { clsx } from 'clsx'
import { eachDayOfInterval, endOfMonth, format, startOfMonth } from 'date-fns'
import { motion, AnimatePresence } from 'framer-motion'
import { useToast } from '@/shared/hooks/useToast'
import { usePermission, Can, P } from '@unifiedtree/sdk'
import { StatsSkeleton, Skeleton } from '@unifiedtree/ui-kit'
import { EmptyState } from '@/shared/components/EmptyState'
import { DataTable } from '@/shared/components/DataTable'
import { HrStatCard, HrStatusPill, HrPageHeader, TableCard, HrAvatar, HrTabs, HrTabPanel, HrDrawer, HrButton, type PillTone } from '@/shared/components/hr'
import { useCompanies, useDepartments } from './api/useOrg'
import {
  useMonthlyStats, useAttendanceHistory,
  useTeamDashboard, useMyCorrections,
  useCreateCorrection,
  type StaffStatusResponse,
} from './api/useAttendance'

const TEAM_TONE: Record<string, PillTone> = {
  PRESENT: 'ok', ON_TIME: 'ok', LATE: 'warn', ABSENT: 'red', NOT_MARKED: 'gray',
  ON_LEAVE: 'info', WFH: 'teal', WORK_FROM_HOME: 'teal', HALF_DAY: 'late',
  EARLY_OUT: 'orange', HOLIDAY: 'purple', WEEKEND: 'gray',
}

type Tab = 'my' | 'team' | 'corrections' | 'face'

// Punching is mobile-only — the web app no longer renders a check-in/out widget
// or uses navigator.geolocation. The underlying useCheckIn/useCheckOut hooks are
// intentionally kept in ./api/useAttendance for the mobile/SDK/test clients.

// ── My Attendance Tab ─────────────────────────────────────────────────────────

function MyAttendanceTab() {
  const now = new Date()
  const [year] = useState(now.getFullYear())
  const [month] = useState(now.getMonth() + 1)
  const { data: stats, isLoading: statsLoading, error: statsError, refetch: refetchStats } = useMonthlyStats(year, month)
  const { data: history = [], isLoading: histLoading, error: histError, refetch: refetchHist } = useAttendanceHistory(year, month)

  // Explicit palette — see the legend below for the reason (Anil docx #14).
  // Same colours as the legend dots so a filled day-cell reads unambiguously
  // against its legend entry.
  const STATUS_BG: Record<string, string> = {
    PRESENT: 'bg-emerald-500 text-white shadow-sm',
    ABSENT:  'bg-red-500 text-white shadow-sm',
    LATE:    'bg-amber-500 text-white shadow-sm',
    HALF_DAY:'bg-orange-500 text-white shadow-sm',
    ON_LEAVE:'bg-sky-500 text-white shadow-sm',
    HOLIDAY: 'bg-purple-500 text-white shadow-sm',
    WEEKEND: 'bg-slate-100 text-slate-500 border border-slate-200',
    WFH:     'bg-cyan-500 text-white shadow-sm',
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-1 space-y-6">
        <div className="space-y-3">
          <h3 className="text-sm font-bold uppercase tracking-wider text-text-primary">{format(new Date(year, month - 1), 'MMMM yyyy')} Summary</h3>
          {statsLoading ? (
            <StatsSkeleton />
          ) : statsError ? (
            <EmptyState icon={XCircle} title="Error" description="Failed to load stats" action={{ label: 'Retry', onClick: () => refetchStats() }} />
          ) : stats ? (
            <div className="grid grid-cols-2 gap-3">
              <HrStatCard icon={<CheckCircle size={16} />} color="green"  value={stats.presentDays}            label="Present" />
              <HrStatCard icon={<Clock size={16} />}       color="red"    value={stats.absentDays}             label="Absent" />
              <HrStatCard icon={<Clock size={16} />}       color="orange" value={stats.lateDays}               label="Late" />
              <HrStatCard icon={<CheckCircle size={16} />} color="blue"   value={stats.onTimeDays}             label="On Time" />
              <HrStatCard icon={<Clock size={16} />}       color="purple" value={stats.holidays}               label="Holidays" />
              <HrStatCard icon={<CheckCircle size={16} />} color="green"  value={`${stats.attendanceScore}%`}  label="Score" />
            </div>
          ) : null}
        </div>
      </div>

      <div className="lg:col-span-2 ut-card p-3 sm:p-6">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-base font-bold text-text-primary font-heading">Daily Log</h3>
          <div className="text-sm font-medium text-text-secondary bg-bg-surface px-3 py-1.5 rounded-lg border border-border-default">
            {format(new Date(year, month - 1), 'MMMM yyyy')}
          </div>
        </div>
        
        {histLoading ? (
          <Skeleton className="h-64 w-full rounded-xl" />
        ) : histError ? (
          <EmptyState icon={XCircle} title="Error" description="Failed to load history" action={{ label: 'Retry', onClick: () => refetchHist() }} />
        ) : (
          <MyAttendanceCalendar year={year} month={month} history={history} statusBg={STATUS_BG} />
        )}
        <div className="flex flex-wrap gap-4 mt-8 pt-6 border-t border-border-default">
          {/*
            Explicit palette. Semantic tokens (bg-success / bg-warning /
            bg-bg-base) render as very pale surface fills after the 2026-08-26
            redesign — fine for chip backgrounds behind dark text, invisible
            as 12px dots on a white card. Anil docx item 14: PRESENT / LATE /
            WEEKEND had no visible colour. Palette here mirrors the mobile
            attendance Badge variants (green / amber / red / cyan / purple)
            so the legend, calendar cell fills, and app all use the same
            colours for the same status.
          */}
          {[
            ['PRESENT',  'bg-emerald-500'],
            ['ABSENT',   'bg-red-500'],
            ['LATE',     'bg-amber-500'],
            ['ON_LEAVE', 'bg-sky-500'],
            ['HOLIDAY',  'bg-purple-500'],
            ['WEEKEND',  'bg-slate-400'],
          ].map(([label, bg]) => (
            <div key={label} className="flex items-center gap-2">
              <div className={clsx('w-3 h-3 rounded-full shadow-sm ring-1 ring-white/70', bg)} />
              <span className="text-xs font-medium text-text-secondary">{label.replace('_', ' ')}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── My Attendance Calendar ────────────────────────────────────────────────────
// Iterating with date-fns eachDayOfInterval and looking up by 'yyyy-MM-dd' is
// DST-safe and month-length-safe. The previous implementation walked the
// history array in order, injected padding cells only in front of history[0]'s
// weekday, and derived the day number via `new Date(day.date).getDate()` — all
// three of which break the moment the API omits a day (DST spring-forward, a
// missing weekend row, or a partial month) or when the browser TZ shifts the
// parsed date into the previous day.

type DayStatus = { status: string }

function MyAttendanceCalendar({
  year, month, history, statusBg,
}: {
  year: number
  month: number
  history: { date: string; status: string }[]
  statusBg: Record<string, string>
}) {
  const days = useMemo(() => {
    // month is 1-indexed from the caller (matches backend).
    const first = startOfMonth(new Date(year, month - 1, 1))
    const last = endOfMonth(first)
    return eachDayOfInterval({ start: first, end: last })
  }, [year, month])

  const byDate = useMemo(() => {
    const m = new Map<string, DayStatus>()
    for (const row of history) m.set(row.date, { status: row.status })
    return m
  }, [history])

  const leadingBlanks = days[0].getDay() // 0=Sun … 6=Sat, matches header order

  return (
    <div className="grid grid-cols-7 gap-2 sm:gap-3">
      {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
        <div key={d} className="text-center text-xs font-bold text-text-tertiary uppercase tracking-wider mb-2">{d}</div>
      ))}
      {Array.from({ length: leadingBlanks }).map((_, i) => (
        <div key={`blank-${i}`} className="aspect-square rounded-xl" aria-hidden />
      ))}
      {days.map((d) => {
        const key = format(d, 'yyyy-MM-dd')
        const info = byDate.get(key)
        const status = info?.status ?? 'NOT_MARKED'
        return (
          // 2026-09-10: the cell used to advertise hover:scale-105 +
          // hover:shadow-md, which reads as "click me", but had cursor-default,
          // no onClick, no key handler and no role — users clicked a day and
          // nothing happened. Removed the interactive hover so the affordance
          // matches the behaviour. If we wire day-detail later, put back the
          // hover along with an actual handler.
          <div
            key={key}
            title={`${key} — ${status}`}
            className={clsx(
              'aspect-square rounded-xl flex items-center justify-center text-sm font-bold',
              statusBg[status] ?? 'bg-bg-base text-text-secondary border border-border-default'
            )}
          >
            {d.getDate()}
          </div>
        )
      })}
    </div>
  )
}

// ── Team Dashboard Tab ────────────────────────────────────────────────────────

/**
 * Status filters the roster supports.
 *
 * These are the dashboard's TILE names, not row status values. Only LATE and
 * HALF_DAY happen to coincide with a row's `status`; the rest are derived from
 * punch state, attendanceType and approved leave — see `matchesStatus`.
 */
const TEAM_STATUS_FILTERS = [
  'PRESENT', 'ABSENT', 'LATE', 'WORK_FROM_HOME', 'NOT_MARKED', 'EARLY_OUT', 'ON_LEAVE', 'HALF_DAY',
] as const
type TeamStatusFilter = (typeof TEAM_STATUS_FILTERS)[number]

const STATUS_LABEL: Record<string, string> = {
  PRESENT: 'Present', ABSENT: 'Absent', LATE: 'Late', WORK_FROM_HOME: 'Work from home',
  NOT_MARKED: 'Not marked', EARLY_OUT: 'Early out', ON_LEAVE: 'On leave', HALF_DAY: 'Half day',
}

/**
 * Reproduce, per row, the buckets `AttendanceController.countSummary` counts.
 *
 * This used to be `s.status === f`, which was wrong for four of the six tiles
 * and produced the worst possible failure: a tile saying "Present 30" that
 * drilled into an empty table. The tiles were never counting `status` values —
 * they count a mix of status, attendanceType and approved-leave state, with
 * `present` defined by SUBTRACTION. The server's definitions, verbatim:
 *
 *   late    = status LATE                        onLeave  = approved leave that date
 *   halfDay = status HALF_DAY                    notMarked = no check-in at all
 *   wfh     = attendanceType WFH                 absent   = notMarked AND NOT on leave
 *   present = (checked in) - late - halfDay - wfh
 *
 * So PRESENT is the residue of everyone who punched and is not already claimed
 * by a more specific bucket — which is why a punctual employee (whose row
 * status is ON_TIME, not PRESENT) belongs in it, and why matching the literal
 * string 'PRESENT' found almost nobody.
 *
 * NOT_MARKED deliberately still includes people on leave: it is the raw
 * "nobody punched" bucket, and ABSENT is the narrower unexplained one. That
 * mirrors the server, where the two tiles are separate numbers.
 *
 * EARLY_OUT is a separate axis, not a bucket — an employee can be PRESENT and
 * an Early Out at once, exactly as the server treats it.
 */
function matchesStatus(s: StaffStatusResponse, f: TeamStatusFilter): boolean {
  const checkedIn = !!s.checkInAt
  const isLate = s.status === 'LATE'
  const isHalfDay = s.status === 'HALF_DAY'
  const isWfh = s.attendanceType === 'WFH'

  switch (f) {
    case 'EARLY_OUT':      return s.earlyCheckout === true
    case 'LATE':           return isLate
    case 'HALF_DAY':       return isHalfDay
    case 'WORK_FROM_HOME': return isWfh
    case 'ON_LEAVE':       return s.onLeave === true
    case 'NOT_MARKED':     return !checkedIn
    case 'ABSENT':         return !checkedIn && s.onLeave !== true
    case 'PRESENT':        return checkedIn && !isLate && !isHalfDay && !isWfh
    default:               return false
  }
}

function TeamDashboardTab() {
  const navigate = useNavigate()

  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<StaffStatusResponse | null>(null)

  /* Drill-down + filter state lives in the URL: /hrms/attendance?tab=team&status=LATE
     &department=<id>. Shareable, survives a refresh, and the browser back
     button returns the user to the previous filter rather than to the previous
     page — which is what "back" means to someone who just narrowed a list. */
  const [searchParams, setSearchParams] = useSearchParams()
  const rawDate = searchParams.get('date')
  const parsedDate = rawDate ? new Date(`${rawDate}T00:00:00Z`) : null
  const date = rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) && parsedDate && !Number.isNaN(parsedDate.getTime()) && parsedDate.toISOString().slice(0, 10) === rawDate ? rawDate : attendanceDate()
  const setDate = (value: string) => { const next = new URLSearchParams(searchParams); next.set('date', value); setSearchParams(next, { replace: true }) }
  const raw = searchParams.get('status')
  const statusFilter = (raw && (TEAM_STATUS_FILTERS as readonly string[]).includes(raw)
    ? (raw as TeamStatusFilter)
    : null)
  const departmentFilter = searchParams.get('department') ?? ''

  /* Department is a SERVER-side filter — useTeamDashboard has always accepted
     a departmentId and this screen simply never passed one, so the roster was
     always tenant-wide. Status, by contrast, is filtered client-side below,
     and that is correct here: /v1/attendance/dashboard returns the COMPLETE
     roster in one payload (no paging), so the client holds every row the
     server would have matched. The same client-side approach on the
     server-paginated employee directory would be wrong, which is why the
     directory's filters go to the server instead. */
  const { data, isLoading, error: teamError, refetch: refetchTeam } =
    useTeamDashboard(date, departmentFilter || undefined)

  /* Departments come from the active company. Only mounted for principals who
     can read team attendance (this whole tab is), and useCompanies self-heals
     the employee 403 — see its docblock. */
  const { data: companies = [] } = useCompanies()
  const activeCompanyId = companies[0]?.id ?? ''
  const { data: departments = [] } = useDepartments(activeCompanyId)

  const setParam = (key: 'status' | 'department', next: string | null) => {
    const p = new URLSearchParams(searchParams)
    if (next) p.set(key, next); else p.delete(key)
    p.set('tab', 'team')
    setSearchParams(p, { replace: true })
  }
  const setStatusFilter = (next: TeamStatusFilter | null) => setParam('status', next)

  const all = data?.staffStatuses ?? []
  const staff = all.filter((s) => {
    if (statusFilter && !matchesStatus(s, statusFilter)) return false
    if (!search) return true
    const q = search.toLowerCase()
    return s.fullName.toLowerCase().includes(q) || s.employeeCode.toLowerCase().includes(q)
  })

  /* Tiles double as the filter control — clicking one is the same action as
     arriving from the dashboard, so the two entry points cannot disagree. */
  const tile = (f: TeamStatusFilter) => ({
    onClick: () => setStatusFilter(statusFilter === f ? null : f),
  })

  return (
    <div className="space-y-6">
      {data?.counts && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
          <HrStatCard icon={<CheckCircle size={18} />} color="green"  value={data.counts.present}      label="Present"    {...tile('PRESENT')} />
          <HrStatCard icon={<Clock size={18} />}       color="orange" value={data.counts.late}         label="Late"       {...tile('LATE')} />
          <HrStatCard icon={<Clock size={18} />}       color="blue"   value={data.counts.onLeave}      label="On Leave"   {...tile('ON_LEAVE')} />
          <HrStatCard icon={<Clock size={18} />}       color="teal"   value={data.counts.workFromHome} label="WFH"        {...tile('WORK_FROM_HOME')} />
          <HrStatCard icon={<Clock size={18} />}       color="red"    value={data.counts.notMarked}    label="Not Marked" {...tile('NOT_MARKED')} />
        </div>
      )}

      {/* Count line for an active filter. The Clear control itself lives in the
          FilterBar below, so this states the result without duplicating it. */}
      {(statusFilter || departmentFilter) && (
        <p className="px-1 text-[13px] text-[var(--text-secondary)]">
          Showing <strong className="tabular-nums text-[var(--text-primary)]">{staff.length}</strong>
          {statusFilter && <> {(STATUS_LABEL[statusFilter] ?? statusFilter).toLowerCase()}</>}
          {' '}of <strong className="tabular-nums">{all.length}</strong> on the roster
          {departmentFilter && departments.find((d) => d.id === departmentFilter)
            && <> in {departments.find((d) => d.id === departmentFilter)!.name}</>}
        </p>
      )}

      <TableCard
        search={{ value: search, onChange: setSearch, placeholder: 'Search team…' }}
        filters={[
          {
            key: 'department',
            allLabel: 'All Departments',
            value: departmentFilter,
            options: departments.map((d) => ({ value: d.id, label: d.name })),
            // Server-side: re-queries /v1/attendance/dashboard with departmentId.
            onChange: (v) => setParam('department', v || null),
            hidden: departments.length < 2,
          },
          {
            key: 'status',
            allLabel: 'All Statuses',
            value: statusFilter ?? '',
            options: TEAM_STATUS_FILTERS.map((s) => ({ value: s, label: STATUS_LABEL[s] ?? s })),
            // Client-side over the complete roster — see the note on the
            // useTeamDashboard call above for why that is sound here.
            onChange: (v) => setStatusFilter((v || null) as TeamStatusFilter | null),
          },
        ]}
        /* Clear must drop BOTH params in ONE setSearchParams call. FilterBar's
           default clear calls each filter's onChange in turn, but every one of
           those derives its next URL from the same `searchParams` snapshot —
           so the second write overwrote the first and "Clear" left the
           department filter behind. */
        onClearFilters={() => {
          const p = new URLSearchParams(searchParams)
          p.delete('status'); p.delete('department'); p.set('tab', 'team')
          setSearchParams(p, { replace: true })
        }}
        actions={
          <div className="w-40">
            <input
              type="date" value={date} aria-label="Attendance date"
              onChange={(e) => setDate(e.target.value)}
              className="ut-input ut-input-sm"
            />
          </div>
        }
      >
        {teamError ? (
          <div className="py-10"><EmptyState icon={XCircle} title="Error" description="Failed to load team" action={{ label: 'Retry', onClick: () => refetchTeam() }} /></div>
        ) : (
          <DataTable
            columns={[
              { key: 'employee', header: 'Employee', render: (s) => <HrAvatar name={s.fullName} sub={s.employeeCode} /> },
              { key: 'department', header: 'Department', render: (s) => <span className="text-text-secondary">{s.departmentName ?? '—'}</span> },
              { key: 'jobTitle', header: 'Role', render: (s) => <span className="text-text-secondary">{s.jobTitle ?? '—'}</span> },
              { key: 'status', header: 'Status', render: (s) => (
                <span className="inline-flex items-center gap-1.5">
                  <HrStatusPill tone={TEAM_TONE[s.status] ?? 'gray'}>{s.status.replace(/_/g, ' ')}</HrStatusPill>
                  {s.earlyCheckout && <HrStatusPill tone="orange">Early out</HrStatusPill>}
                </span>
              ) },
              { key: 'in', header: 'Check In', render: (s) => <span className="tabular-nums text-text-secondary">{s.checkInAt ? format(new Date(s.checkInAt), 'h:mm a') : '—'}</span> },
              { key: 'out', header: 'Check Out', render: (s) => <span className="tabular-nums text-text-secondary">{s.checkOutAt ? format(new Date(s.checkOutAt), 'h:mm a') : '—'}</span> },
              { key: 'worked', header: 'Worked', render: (s) => <span className="tabular-nums text-text-secondary">{workedFor(s)}</span> },
              { key: 'location', header: 'Location', render: (s) => <span className="max-w-[140px] truncate text-text-secondary" title={s.locationName}>{s.locationName ?? '—'}</span> },
            ]}
            data={staff}
            keyField="employeeId"
            loading={isLoading}
            onRowClick={(s) => setSelected(s)}
            emptyMessage={statusFilter
              ? `Nobody is ${(STATUS_LABEL[statusFilter] ?? statusFilter).toLowerCase()} on ${format(new Date(date), 'd MMM yyyy')}.`
              : 'No records found for this date'}
          />
        )}
      </TableCard>

      {selected && (
        <StaffAttendanceDrawer
          staff={selected}
          date={date}
          onClose={() => setSelected(null)}
          onOpenProfile={() => { const id = selected.employeeId; setSelected(null); navigate(`/hrms/employees/${id}`) }}
        />
      )}
    </div>
  )
}

/** Worked duration, derived from the two timestamps the roster already returns. */
function workedFor(s: StaffStatusResponse): string {
  if (!s.checkInAt || !s.checkOutAt) return '—'
  const ms = new Date(s.checkOutAt).getTime() - new Date(s.checkInAt).getTime()
  if (!Number.isFinite(ms) || ms <= 0) return '—'
  const mins = Math.round(ms / 60000)
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`
}

/**
 * Row drill-down for one employee's day.
 *
 * Renders entirely from the roster row already in memory — it fires NO extra
 * request. A per-employee attendance history would need a backend change:
 * `GET /v1/attendance/history` is caller-scoped and takes no employeeId, so
 * there is currently no way to fetch another person's history. The drawer
 * therefore links out to the full profile rather than pretending to show one.
 */
function StaffAttendanceDrawer({ staff, date, onClose, onOpenProfile }: {
  staff: StaffStatusResponse
  date: string
  onClose: () => void
  onOpenProfile: () => void
}) {
  const rows: { label: string; value: React.ReactNode }[] = [
    { label: 'Employee code', value: staff.employeeCode },
    { label: 'Department', value: staff.departmentName ?? '—' },
    { label: 'Role', value: staff.jobTitle ?? '—' },
    { label: 'Date', value: format(new Date(date), 'EEEE, d MMM yyyy') },
    { label: 'Status', value: <HrStatusPill tone={TEAM_TONE[staff.status] ?? 'gray'}>{staff.status.replace(/_/g, ' ')}</HrStatusPill> },
    { label: 'Check in', value: staff.checkInAt ? format(new Date(staff.checkInAt), 'h:mm a') : 'Not recorded' },
    { label: 'Check out', value: staff.checkOutAt ? format(new Date(staff.checkOutAt), 'h:mm a') : 'Not recorded' },
    { label: 'Worked', value: workedFor(staff) },
    { label: 'Left early', value: staff.earlyCheckout ? 'Yes — before shift end' : 'No' },
    { label: 'Location', value: staff.locationName ?? 'Not captured' },
  ]

  return (
    <HrDrawer title={staff.fullName} onClose={onClose}
      footer={<HrButton onClick={onOpenProfile}>Open full profile</HrButton>}>
      <dl className="divide-y divide-[var(--border-subtle)]">
        {rows.map((r) => (
          <div key={r.label} className="flex items-baseline justify-between gap-4 py-2.5">
            <dt className="text-[12.5px] text-[var(--text-secondary)]">{r.label}</dt>
            <dd className="text-right text-[13px] font-medium text-[var(--text-primary)]">{r.value}</dd>
          </div>
        ))}
      </dl>
    </HrDrawer>
  )
}

// ── Corrections Tab ───────────────────────────────────────────────────────────

/**
 * "My Corrections" — own request history + the raise-a-request form.
 *
 * Deliberately its own component so the whole panel, and with it the
 * `useMyCorrections()` call inside, mounts ONLY for roles that hold
 * `attendance.checkin.self`.
 *
 * The bug: CorrectionsTab called useMyCorrections() unconditionally. It hits
 * GET /v1/attendance/corrections/my, which AttendanceController gates on
 * `hasAuthority('attendance.checkin.self')` — the code the workspace ADMIN and
 * MANAGER roles do not hold (they were seeded attendance.team.read instead; see
 * the note on the Attendance page component below, from the 2026-09-08 audit).
 * Those roles got a 403, react-query left `data` undefined, and
 * `(myCorr?.content ?? []).length === 0` rendered the cheerful "No correction
 * requests". A wrong-empty is indistinguishable from a real empty, which is
 * precisely why nobody ever reported it: the screen looked like it worked. The
 * sibling approvals fetch had already been gated with `enabled: isManager` for
 * exactly this reason; this one had not.
 *
 * Gating by mount rather than by an `enabled` flag because useMyCorrections()
 * takes no options object — and useAttendance.ts is outside this change's
 * blast radius. Mounting conditionally is the same fix without touching a
 * shared hook every other screen depends on.
 */
function MyCorrectionsPanel() {
  const { toast } = useToast()
  const { data: myCorr } = useMyCorrections()
  const createCorrection = useCreateCorrection()
  const [open, setOpen] = useState(false)
  const todayLocal = () => {
    const d = new Date()
    const yyyy = d.getFullYear()
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    return `${yyyy}-${mm}-${dd}`
  }
  const emptyForm = () => ({ requestedDate: todayLocal(), requestedCheckInAt: '', requestedCheckOutAt: '', reason: '', attachmentUrl: '' })
  const [form, setForm] = useState(emptyForm)

  const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/
  const composeLocalIso = (date: string, time: string): string =>
    new Date(`${date}T${time}:00`).toISOString()

  const handleCreate = async () => {
    if (createCorrection.isPending) return
    if (!form.requestedDate || !form.reason.trim()) { toast('Date and reason required', 'error'); return }
    if (!form.requestedCheckInAt && !form.requestedCheckOutAt) {
      toast('Provide either check-in or check-out time (or both)', 'error')
      return
    }
    if (form.requestedCheckInAt && !TIME_RE.test(form.requestedCheckInAt)) {
      toast('Requested check-in time must be HH:MM (24-hour)', 'error'); return
    }
    if (form.requestedCheckOutAt && !TIME_RE.test(form.requestedCheckOutAt)) {
      toast('Requested check-out time must be HH:MM (24-hour)', 'error'); return
    }
    try {
      await createCorrection.mutateAsync({
        requestedDate: form.requestedDate,
        requestedCheckInAt: form.requestedCheckInAt ? composeLocalIso(form.requestedDate, form.requestedCheckInAt) : undefined,
        requestedCheckOutAt: form.requestedCheckOutAt ? composeLocalIso(form.requestedDate, form.requestedCheckOutAt) : undefined,
        reason: form.reason.trim(),
        attachmentUrl: form.attachmentUrl.trim() || undefined,
      })
      toast('Correction submitted successfully', 'success')
      setOpen(false)
      setForm(emptyForm())
    } catch { toast('Failed to submit correction', 'error') }
  }

  return (
    <div className="ut-card p-6">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-base font-bold text-text-primary font-heading">My Corrections</h3>
          {/* The panel itself only mounts for attendance.checkin.self, which is
              the same authority POST /v1/attendance/corrections enforces, so no
              second <Can> guard is needed around the button. */}
          <button onClick={() => setOpen(!open)} className="text-xs font-bold px-4 py-2 bg-bg-surface hover:bg-interactive-hover border border-border-default text-text-primary rounded-xl transition-colors shadow-sm">
            {open ? 'Close' : '+ New Request'}
          </button>
        </div>

        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden mb-6"
            >
              <div className="ut-card p-5 space-y-4">
                <h4 className="text-[15px] font-semibold text-text-primary">New Request</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-5">
                  <div>
                    <label className="mb-1.5 block text-[13px] font-semibold text-text-secondary">Date *</label>
                    <input type="date" value={form.requestedDate} onChange={(e) => setForm(p => ({ ...p, requestedDate: e.target.value }))} className="ut-input" />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-[13px] font-semibold text-text-secondary">Attachment URL</label>
                    <input type="url" value={form.attachmentUrl} onChange={(e) => setForm(p => ({ ...p, attachmentUrl: e.target.value }))} placeholder="https://…" className="ut-input" />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-5">
                  <div>
                    <label className="mb-1.5 block text-[13px] font-semibold text-text-secondary">Requested Check-In</label>
                    <input type="time" value={form.requestedCheckInAt} onChange={(e) => setForm(p => ({ ...p, requestedCheckInAt: e.target.value }))} className="ut-input" />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-[13px] font-semibold text-text-secondary">Requested Check-Out</label>
                    <input type="time" value={form.requestedCheckOutAt} onChange={(e) => setForm(p => ({ ...p, requestedCheckOutAt: e.target.value }))} className="ut-input" />
                  </div>
                </div>
                <div>
                  <label className="mb-1.5 block text-[13px] font-semibold text-text-secondary">Reason *</label>
                  <textarea rows={3} value={form.reason} onChange={(e) => setForm(p => ({ ...p, reason: e.target.value }))} placeholder="Explain the correction needed..." className="w-full bg-white border border-border-default rounded-xl px-3 py-2 text-sm text-text-primary placeholder-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/20 shadow-sm transition-all resize-y" />
                </div>
                <div className="flex justify-end gap-3 border-t border-border-default pt-4">
                  <button onClick={() => setOpen(false)} className="px-4 py-2 text-text-secondary font-semibold text-sm hover:text-text-primary transition-colors">Cancel</button>
                  <button onClick={handleCreate} disabled={createCorrection.isPending} className="px-5 py-2 bg-primary hover:bg-primary-hover disabled:opacity-50 text-white font-bold text-sm rounded-xl transition-all shadow-sm shadow-primary/30">
                    {createCorrection.isPending ? 'Submitting...' : 'Submit Request'}
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {(myCorr?.content ?? []).length === 0 ? (
          <div className="text-center py-10">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-bg-surface mb-3">
              <Clock size={20} className="text-text-tertiary" />
            </div>
            {/* Trustworthy now: this panel only mounts when the caller can
                actually read /corrections/my, so "none" really does mean none. */}
            <p className="text-text-secondary text-sm font-medium">No correction requests</p>
          </div>
        ) : (
          <div className="space-y-3">
            {(myCorr?.content ?? []).map((c) => (
              <div key={c.id} className="flex items-center justify-between bg-bg-base hover:bg-bg-surface border border-border-default rounded-xl px-5 py-4 transition-colors">
                <div>
                  <p className="text-text-primary text-sm font-bold">{c.requestedDate}</p>
                  <p className="text-text-secondary text-xs font-medium mt-1">{c.reason}</p>
                </div>
                <span className={clsx('text-xs font-bold px-3 py-1 rounded-lg border', c.status === 'PENDING' ? 'bg-warning/10 text-warning border-warning/20' : c.status === 'APPROVED' ? 'bg-success/10 text-success border-success/20' : 'bg-danger/10 text-danger border-danger/20')}>
                  {c.status}
                </span>
              </div>
            ))}
          </div>
        )}
    </div>
  )
}

/**
 * Approvals queue.
 *
 * Mounted only for `attendance.regularization.approve`, the authority both
 * GET /v1/attendance/corrections/approvals and the decision endpoint enforce.
 * That mount condition replaces the old `enabled: isManager` flag — same effect
 * (the approvals endpoint 403s for non-managers, so an employee opening the
 * Corrections tab must never issue the request), now expressed once, the same
 * way MyCorrectionsPanel is gated.
 */

/**
 * Corrections tab shell.
 *
 * The tab is offered to every role (see ATT_TABS), but its two panels are backed
 * by two DIFFERENT authorities, and a role can hold neither:
 *   · My Corrections   → attendance.checkin.self          (GET /corrections/my)
 *   · Pending Approvals→ attendance.regularization.approve (GET /corrections/approvals)
 * Previously the "my" panel rendered unconditionally, so a role with neither
 * authority saw a confident "No correction requests" built entirely out of a
 * 403. Mount each panel only behind its own authority, and when the caller has
 * neither, say so instead of inventing an empty list.
 */
function CorrectionsTab() {
  const canSelfCheckin = usePermission(P.ATTENDANCE_CHECKIN_SELF)
  const isManager = usePermission(P.ATTENDANCE_REGULARIZATION_APPROVE)

  if (!canSelfCheckin && !isManager) {
    return (
      <EmptyState
        icon={Clock}
        title="Corrections aren't available for your role"
        description="Raising an attendance correction needs self check-in access, and reviewing one needs approval access. Your role has neither — ask an admin to grant the right permission if you should see this."
      />
    )
  }

  return (
    <div className="grid grid-cols-1 gap-6">
      {isManager && <CorrectionApprovals />}
      {canSelfCheckin && <MyCorrectionsPanel />}
    </div>
  )
}


function FacePunchTab() {
  return (
    <TableCard>
      <div className="p-4 border-b border-[var(--border-default)]"><h3 className="font-semibold text-lg">Face Punch Logs</h3></div>
      <table className="w-full text-left text-sm">
        <thead className="border-b border-[var(--border-default)] bg-[var(--bg-base)] text-xs text-gray-500">
          <tr><th className="p-4 font-medium">Employee</th><th className="p-4 font-medium">Location/Device</th><th className="p-4 font-medium">Timestamp</th><th className="p-4 font-medium">Match Confidence</th><th className="p-4 font-medium">Status</th></tr>
        </thead>
        <tbody>
          <tr className="border-b border-[var(--border-default)]">
            <td className="p-4 font-semibold">Rajesh Kumar</td>
            <td className="p-4 text-gray-500">Kiosk-Pune-01</td>
            <td className="p-4">May 14, 08:30 AM</td>
            <td className="p-4">
              <div className="flex items-center gap-2">
                <div className="w-12 h-1.5 bg-gray-200 rounded-full overflow-hidden"><div className="w-[98%] h-full bg-green-500"></div></div>
                98%
              </div>
            </td>
            <td className="p-4"><span className="badge bg-green-100 text-green-700 px-2 py-1 rounded">Verified</span></td>
          </tr>
          <tr>
            <td className="p-4 font-semibold">Priya Mehta</td>
            <td className="p-4 text-gray-500">Mobile App (Geofenced)</td>
            <td className="p-4">May 14, 09:02 AM</td>
            <td className="p-4">
              <div className="flex items-center gap-2">
                <div className="w-12 h-1.5 bg-gray-200 rounded-full overflow-hidden"><div className="w-[72%] h-full bg-orange-500"></div></div>
                72%
              </div>
            </td>
            <td className="p-4"><span className="badge bg-orange-100 text-orange-700 px-2 py-1 rounded">Low Confidence</span></td>
          </tr>
        </tbody>
      </table>
    </TableCard>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

const ATT_TABS: readonly Tab[] = ['my', 'team', 'face', 'corrections']

export const Attendance: React.FC = () => {
  const isManager = usePermission(P.ATTENDANCE_TEAM_READ)
  // The My Attendance panel calls /v1/attendance/monthly-stats + /history, both
  // gated on attendance.checkin.self. The route admits HRMS_EMPLOYEE_READ too,
  // so a role WITHOUT self-checkin (the workspace ADMIN / MANAGER roles were
  // seeded team.read but not checkin.self) landed on this tab by default and
  // got two red "Failed to load" blocks — with a Retry that re-issued the same
  // 403 forever. That was the literal "nothing works" screenshot
  // (2026-09-08 audit). Only offer the tab to roles that can load it, and
  // default such roles to the Team dashboard instead.
  const canSelfCheckin = usePermission(P.ATTENDANCE_CHECKIN_SELF)

  // Deep-linking support for ?tab=corrections / ?tab=team so notifications
  // and other pages can land the user on the right tab. Same pattern as
  // Leave.tsx.
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedTab = searchParams.get('tab') as Tab | null
  const fallbackTab: Tab = canSelfCheckin ? 'my' : isManager ? 'team' : 'corrections'
  const initialTab: Tab =
    requestedTab && ATT_TABS.includes(requestedTab) && !(requestedTab === 'my' && !canSelfCheckin)
      ? requestedTab
      : fallbackTab
  const [tab, setTab] = useState<Tab>(initialTab)

  useEffect(() => {
    if (requestedTab && ATT_TABS.includes(requestedTab) && requestedTab !== tab) {
      setTab(requestedTab)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedTab])

  const switchTab = (next: Tab) => {
    setTab(next)
    const p = new URLSearchParams(searchParams)
    p.set('tab', next)
    setSearchParams(p, { replace: true })
  }

  const tabs: { key: Tab; label: string }[] = [
    ...(canSelfCheckin ? [{ key: 'my' as Tab, label: 'My Attendance' }] : []),
    ...(isManager ? [{ key: 'team' as Tab, label: 'Daily Logs' }] : []),
    { key: 'face' as Tab, label: 'Face Punch Logs' },
    { key: 'corrections', label: 'Regularization' },
  ]

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-8">
      <HrPageHeader crumb="Attendance & Time" title="Attendance" subtitle="Track and manage attendance records." />

      <HrTabs tabs={tabs} active={tab} onChange={(k) => switchTab(k as Tab)} />

      {/* Tab Content Area */}
      <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
        {tab === 'my' && canSelfCheckin && <HrTabPanel tabKey="my"><MyAttendanceTab /></HrTabPanel>}
        {tab === 'team' && <HrTabPanel tabKey="team"><TeamDashboardTab /></HrTabPanel>}
        {tab === 'face' && <HrTabPanel tabKey="face"><FacePunchTab /></HrTabPanel>}
        {tab === 'corrections' && <HrTabPanel tabKey="corrections"><CorrectionsTab /></HrTabPanel>}
      </div>
    </div>
  )
}
