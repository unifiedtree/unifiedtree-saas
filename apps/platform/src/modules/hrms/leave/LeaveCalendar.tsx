import { useMemo, useState } from 'react'
import { AlertTriangle, CalendarDays, ChevronLeft, ChevronRight, Lock } from 'lucide-react'
import { clsx } from 'clsx'
import {
  addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameMonth, isToday,
  max as maxDate, min as minDate, parseISO, startOfMonth, startOfWeek,
} from 'date-fns'
import { usePermission, P } from '@unifiedtree/sdk'
import { TableSkeleton } from '@unifiedtree/ui-kit'
import { EmptyState } from '@/shared/components/EmptyState'
import { HrAvatar, HrButton, HrStatusPill } from '@/shared/components/hr'
import { useCurrentUser } from '@/shared/hooks/useCurrentUser'
import { useCompanies } from '../api/useOrg'
import { useWeekendDays, jsWeekendDays } from '../api/useSettings'
import type { LeaveRequestResponse } from '../api/useLeave'
import { useLeaveCalendarSelf, useLeaveCalendarTeam } from './useLeaveCalendar'

const WEEKDAY_LABELS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']
/** Chips shown inside one day cell before collapsing to "+N more". */
const MAX_CHIPS_PER_DAY = 3

interface AwayEntry {
  id: string
  name: string
  leaveType: string
  start: Date
  end: Date
  totalDays: number
}

const dayKey = (d: Date) => format(d, 'yyyy-MM-dd')
const spanLabel = (e: AwayEntry) =>
  dayKey(e.start) === dayKey(e.end)
    ? format(e.start, 'd MMM yyyy')
    : `${format(e.start, 'd MMM')} – ${format(e.end, 'd MMM yyyy')}`

// ── Leave Calendar ("Who's away") ─────────────────────────────────────────────
//
// Month grid of APPROVED leave. Approvers (hrms.leave.approve.l1) see the
// requests in their approvals history — tenant-wide for HR/admin — plus their
// own; everyone else sees their own approved leave. See useLeaveCalendar.ts
// for why this walks paged lists instead of asking for one month.
export function LeaveCalendar() {
  const canSeeTeam = usePermission(P.HRMS_LEAVE_APPROVE_L1)
  const canSeeOwn = usePermission(P.LEAVE_BALANCE_READ)
  const team = useLeaveCalendarTeam(canSeeTeam)
  const self = useLeaveCalendarSelf(canSeeOwn)

  const { data: me } = useCurrentUser()
  const { data: companies = [] } = useCompanies()
  const companyId = companies[0]?.id ?? me?.companyId ?? undefined
  const { data: weekendCfg } = useWeekendDays(companyId)
  // The company's weekly off days (stored as ISO days), as getDay() numbers.
  const weekendDays = useMemo<Set<number>>(() => jsWeekendDays(weekendCfg?.weekendDays), [weekendCfg])

  const [month, setMonth] = useState(() => startOfMonth(new Date()))
  const monthStart = startOfMonth(month)
  const monthEnd = endOfMonth(month)

  const myName = me?.displayName || [me?.firstName, me?.lastName].filter(Boolean).join(' ') || 'You'

  // APPROVED rows from both lists, de-duplicated by request id (an approver's
  // own leave can appear in both).
  const entries = useMemo<AwayEntry[]>(() => {
    const byId = new Map<string, LeaveRequestResponse>()
    for (const r of [...(team.data?.rows ?? []), ...(self.data?.rows ?? [])]) {
      if (r.status === 'APPROVED' && r.startDate && r.endDate && !byId.has(r.id)) byId.set(r.id, r)
    }
    const ownIds = new Set((self.data?.rows ?? []).map((r) => r.id))
    return [...byId.values()].map((r) => ({
      id: r.id,
      name: r.employeeName || (ownIds.has(r.id) ? myName : r.employeeCode || 'Employee'),
      leaveType: r.leaveTypeName || 'Leave',
      start: parseISO(r.startDate),
      end: parseISO(r.endDate),
      totalDays: r.totalDays,
    }))
  }, [team.data, self.data, myName])

  const monthEntries = useMemo(
    () => entries
      .filter((e) => e.start <= monthEnd && e.end >= monthStart)
      .sort((a, b) => a.start.getTime() - b.start.getTime() || a.name.localeCompare(b.name)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entries, month],
  )

  const byDay = useMemo(() => {
    const map = new Map<string, AwayEntry[]>()
    for (const e of monthEntries) {
      for (const d of eachDayOfInterval({ start: maxDate([e.start, monthStart]), end: minDate([e.end, monthEnd]) })) {
        const k = dayKey(d)
        map.set(k, [...(map.get(k) ?? []), e])
      }
    }
    return map
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthEntries])

  const gridDays = eachDayOfInterval({
    start: startOfWeek(monthStart, { weekStartsOn: 1 }),
    end: endOfWeek(monthEnd, { weekStartsOn: 1 }),
  })

  if (!canSeeTeam && !canSeeOwn) {
    return (
      <div className="ut-card">
        <EmptyState
          icon={Lock}
          title="Leave calendar unavailable"
          description="Your role cannot read leave requests, so there is nothing to place on the calendar."
        />
      </div>
    )
  }

  const isLoading = (canSeeTeam && team.isLoading) || (canSeeOwn && self.isLoading)
  const isError = (canSeeTeam && team.isError) || (canSeeOwn && self.isError)
  const retry = () => { if (canSeeTeam) void team.refetch(); if (canSeeOwn) void self.refetch() }
  // Approvals history is ordered by last decision; /my has no server order, so
  // its note must not claim "most recent".
  const truncatedNote = canSeeTeam && team.data?.truncated
    ? `Showing the ${team.data.rows.length} most recently decided requests of ${team.data.totalElements}. Older approvals are not placed on this calendar.`
    : canSeeOwn && self.data?.truncated
      ? `Showing ${self.data.rows.length} of your ${self.data.totalElements} requests. The rest are not placed on this calendar.`
      : null

  return (
    <div className="space-y-4">
      <div className="ut-card p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="m-0 text-base font-semibold text-[var(--text-primary)]">
              {format(month, 'MMMM yyyy')} — Who's away?
            </h3>
            <p className="mt-0.5 text-xs text-[var(--text-tertiary)]">
              {canSeeTeam
                ? 'Approved leave from your approvals history, plus your own.'
                : 'Your approved leave. The team view needs leave-approval access.'}
            </p>
          </div>
          <div className="flex gap-2">
            <HrButton variant="ghost" size="sm" onClick={() => setMonth((m) => addMonths(m, -1))}>
              <ChevronLeft size={14} /> Prev
            </HrButton>
            <HrButton
              variant="ghost"
              size="sm"
              disabled={isSameMonth(month, new Date())}
              onClick={() => setMonth(startOfMonth(new Date()))}
            >
              Today
            </HrButton>
            <HrButton variant="ghost" size="sm" onClick={() => setMonth((m) => addMonths(m, 1))}>
              Next <ChevronRight size={14} />
            </HrButton>
          </div>
        </div>

        {isLoading ? (
          <TableSkeleton />
        ) : isError ? (
          <EmptyState
            icon={AlertTriangle}
            title="Couldn't load the leave calendar"
            description="The leave requests behind this calendar failed to load. Check your connection and try again."
            action={{ label: 'Retry', onClick: retry }}
          />
        ) : (
          <>
            {truncatedNote && (
              <p className="mb-3 rounded-md bg-[var(--bg-subtle)] px-3 py-2 text-xs text-[var(--text-secondary)]">
                {truncatedNote}
              </p>
            )}
            <div className="overflow-x-auto">
              <div className="grid min-w-[640px] grid-cols-7 gap-2">
                {WEEKDAY_LABELS.map((d) => (
                  <div key={d} className="text-center text-xs font-semibold text-[var(--text-tertiary)]">{d}</div>
                ))}
                {gridDays.map((day) => {
                  const inMonth = isSameMonth(day, month)
                  const away = inMonth ? byDay.get(dayKey(day)) ?? [] : []
                  const weekend = weekendDays.has(day.getDay())
                  const today = isToday(day)
                  return (
                    <div
                      key={dayKey(day)}
                      data-date={dayKey(day)}
                      className={clsx(
                        'flex min-h-[96px] flex-col rounded-lg border p-2',
                        inMonth ? 'border-[var(--border-default)]' : 'border-transparent opacity-40',
                        weekend && 'bg-[var(--bg-subtle)]',
                        today && 'ring-2 ring-[var(--accent-fg,#0f6e56)]',
                      )}
                    >
                      <div className="flex items-center justify-between">
                        {today ? <span className="text-[10px] font-semibold uppercase text-[var(--accent-fg,#0f6e56)]">Today</span> : <span />}
                        <span className="text-sm font-semibold tabular-nums text-[var(--text-primary)]">{format(day, 'd')}</span>
                      </div>
                      {inMonth && (
                        <div className="mt-auto space-y-1 text-left">
                          {away.slice(0, MAX_CHIPS_PER_DAY).map((e) => (
                            <div
                              key={e.id}
                              className="rounded bg-[#F3E8FF] px-1.5 py-1 text-[11px] leading-tight text-[#6D28D9]"
                              title={`${e.name} · ${e.leaveType} · ${spanLabel(e)}`}
                            >
                              <div className="truncate font-semibold">{e.name}</div>
                              <div className="truncate opacity-80">{e.leaveType} · {spanLabel(e)}</div>
                            </div>
                          ))}
                          {away.length > MAX_CHIPS_PER_DAY && (
                            <div className="text-[11px] font-medium text-[var(--text-tertiary)]">
                              +{away.length - MAX_CHIPS_PER_DAY} more (see list below)
                            </div>
                          )}
                          {away.length === 0 && weekend && (
                            <div className="text-center text-[11px] text-[var(--text-tertiary)]">Weekend</div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          </>
        )}
      </div>

      {!isLoading && !isError && (
        <div className="ut-card p-5">
          <h4 className="m-0 mb-3 text-sm font-semibold text-[var(--text-primary)]">
            Away in {format(month, 'MMMM yyyy')}
          </h4>
          {monthEntries.length === 0 ? (
            <EmptyState
              icon={CalendarDays}
              title="No one is on approved leave this month"
              description="Approved leave requests that overlap this month will appear here and on the calendar above."
            />
          ) : (
            <ul className="divide-y divide-[var(--border-subtle)]" aria-label="Approved leave this month">
              {monthEntries.map((e, i) => (
                <li key={e.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                  <HrAvatar name={e.name} sub={e.leaveType} seed={i} />
                  <div className="flex items-center gap-3 text-xs text-[var(--text-secondary)]">
                    <span className="tabular-nums">{spanLabel(e)}</span>
                    <HrStatusPill tone="purple">
                      {e.totalDays} {e.totalDays === 1 ? 'day' : 'days'}
                    </HrStatusPill>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
