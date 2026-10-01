// Team schedule (/team?view=schedule; prototype TeamSchedule.dc.html): the week, one row per person,
// read from GET /v1/team/schedule (the shift in force with its day facts: approved leave, weekly
// off, holiday) and GET /v1/team/time-off (work from home, and requests still waiting). The top
// row counts who is in the office each day. A request waiting for you opens Approvals. Names link
// to the employee page only for people who can open it (hrms.employee.read); managers usually
// can't. Read-only: shift planning is on hold (DECISIONS 21).
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { apiJson } from '@/core/api/client'
import { Button, Callout, Card, ErrorState, PageHeader } from '@/design/kit/display'
import { Pager, WeekGrid, WeekLegend, shiftWeek, weekCoverage, weekDays, weekLabel, type WeekCell, type WeekRow } from '@/design/kit/data'
import { istToday } from '@/design/dc/dates'
import { fmtDayFull } from '@/shared/components/calendar/dateMath'
import { useTeamTimeOff } from '../api/shared/useTeamTimeOff'
import type { InboxTab, TeamTimeOffEntry } from '../api/shared/contracts'
import { type ScheduleDay, type TeamView, scheduleCell, schedulePeople } from './teamModel'

const PER_PAGE = 10

export function TeamSchedule({ canOpenPeople, onView }: { canOpenPeople: boolean; onView: (view: TeamView, tab?: InboxTab) => void }) {
  const navigate = useNavigate()
  const [anchor, setAnchor] = useState(() => istToday())
  const [page, setPage] = useState(0)
  const days = useMemo(() => weekDays(anchor), [anchor])
  const from = days[0], to = days[6]
  // The same key AttendanceContainer reads and a shift assignment refreshes.
  const q = useQuery({
    queryKey: ['team', 'schedule', from, to],
    queryFn: () => apiJson<ScheduleDay[]>(`/v1/team/schedule?from=${from}&to=${to}`),
  })
  const timeOff = useTeamTimeOff(from, to)
  const people = useMemo(() => schedulePeople(q.data), [q.data])
  const byPerson = useMemo(() => {
    const m = new Map<string, TeamTimeOffEntry[]>()
    for (const e of timeOff.data ?? []) m.set(e.employeeId, [...(m.get(e.employeeId) ?? []), e])
    return m
  }, [timeOff.data])

  const allRows: WeekRow[] = useMemo(() => people.map((p) => ({
    key: p.employeeId,
    name: p.name,
    href: canOpenPeople ? `/hrms/employees/${p.employeeId}` : undefined,
    onOpen: canOpenPeople ? () => navigate(`/hrms/employees/${p.employeeId}`) : undefined,
    cells: days.map((d): WeekCell => {
      const c = scheduleCell(p.days.get(d), byPerson.get(p.employeeId) ?? [], d)
      const cell: WeekCell = { tone: c.tone, title: c.title, sub: c.sub }
      if (c.pending?.canDecide) {
        const tab: InboxTab = c.pending.kind === 'LEAVE' ? 'leave' : 'requests'
        cell.onClick = () => onView('approvals', tab)
        cell.label = `${p.name}, ${fmtDayFull(d)}: ${c.pending.kind === 'LEAVE' ? 'leave' : 'work from home'} waiting for you. Open Approvals.`
        cell.tip = 'Open Approvals to decide'
      }
      return cell
    }),
  })), [people, days, byPerson, canOpenPeople, navigate, onView])

  // The coverage row counts the whole team, not just this page of it.
  const coverage = useMemo(() => days.map((_, i) => {
    const c = weekCoverage(allRows, i)
    return c ? { count: c.count, total: c.total, thin: c.thin, rest: c.rest === 'holiday' ? 'Holiday' : c.rest === 'off' ? 'Weekly off' : undefined } : null
  }), [allRows, days])

  const pageRows = allRows.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE)
  const move = (weeks: number) => { setAnchor((a) => (weeks === 0 ? istToday() : shiftWeek(a, weeks))); setPage(0) }
  const label = weekLabel(days)

  return (
    <>
      <PageHeader title="Team schedule" sub={`${label} · shifts, leave and work from home in one view`}
        actions={(
          <>
            <Button variant="secondary" size={38} onClick={() => move(-1)}>← Previous</Button>
            <Button variant="secondary" size={38} onClick={() => move(0)}>This week</Button>
            <Button variant="secondary" size={38} onClick={() => move(1)}>Next →</Button>
          </>
        )} />
      {timeOff.error ? (
        <Callout tone="warning" icon="alertTriangle">Work from home and waiting requests couldn’t be loaded just now; shifts, leave and days off are shown.</Callout>
      ) : null}
      <Card as="section" label="Schedule" padding="none" className="tm-sched">
        {q.error ? <ErrorState title="Couldn’t load the schedule" error={q.error} onRetry={() => q.refetch()} retrying={q.isFetching} /> : (
          <WeekGrid days={days} rows={pageRows} label={`Team schedule, ${label}`} variant="tiles" coverage={coverage}
            loading={q.isLoading} loadingRows={6} onWeekChange={(d) => move(d)}
            empty="No one in your team scope. Shifts for the people who report to you appear here." />
        )}
      </Card>
      {allRows.length > PER_PAGE && (
        <Pager page={page} pageSize={PER_PAGE} total={allRows.length} onPageChange={setPage} noun="people" />
      )}
      <WeekLegend items={[
        { tone: 'shift', label: 'General shift' },
        { tone: 'alt', label: 'Other shifts' },
        { tone: 'home', label: 'Home' },
        { tone: 'leave', label: 'Leave' },
        { tone: 'holiday', label: 'Holiday' },
        { tone: 'off', label: 'Weekly off' },
        { tone: 'pending', label: 'Waiting for you · tap to decide' },
      ]} />
    </>
  )
}
