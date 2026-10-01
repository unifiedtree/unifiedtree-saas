// The self-service Home at /me (EmpHome.dc.html), employee and manager variants (DECISIONS 12):
// greeting, check in / out, quick actions, Your day, Needs you, My requests, the month or the
// team, Leave, Pay and Upcoming events. Managers also get Punch for a team member, Waiting for
// you and Today's team. Each block reads real API data and hides when its source isn't there.
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { P, useAnyPermission, usePermission, useAuthStore as useSdkStore } from '@unifiedtree/sdk'
import { useAuthStore } from '@/core/auth/authStore'
import { apiJson } from '@/core/api/client'
import {
  Button, PageFrame, PageHeader, QuickActionGrid, QuickActionTile, SectionHeading, StatCard, StatGrid, type QuickIconKind, type StatCardProps,
} from '@/design/kit/display'
import { DateChip } from '@/design/kit/data'
import { useToast } from '@/design/kit/overlays'
import { errorText } from '@/design/kit/EmptyState'
import { MON, WD, addDays, dt, istHour, istToday } from '@/design/dc/dates'
import { useHome } from '@/design/shell/useHome'
import { READY_PAGES } from '@/shared/navigation/pageRegistry'
import { greetingName } from '@/shared/hooks/greetingName'
import { useAttendanceHistory, useAttendanceTrend, useTeamDashboard } from '../../api/useAttendance'
import { useLeaveTypes, useMyBalances, useMyLeaves } from '../../api/useLeave'
import { useMyInterviews } from '../../api/useHiring'
import { useMyWfhRequests } from '../../api/useWfh'
import { useHolidays, useWeekendDays } from '../../api/useSettings'
import type { MyPayslip } from '../../api/usePayrollRuns'
import { usePaySchedule } from '../../api/shared/usePaySchedule'
import { useApprovalsInbox } from '../../api/shared/useApprovalsInbox'
import { useTeamSummary } from '../../api/shared/useTeamSummary'
import type { ApprovalsInbox, InboxTab } from '../../api/shared/contracts'
import { dayBuckets, trendBuckets, type DayBuckets } from '../../attendance/attendanceBuckets'
import { clockIst, workingWindow } from '../../dashboard/dashboardModel'
import { WebPunchDialog } from '../../attendance/webpunch/WebPunchDialog'
import { AssistedPunchDialog } from '../../attendance/webpunch/AssistedPunchDialog'
import { AttendanceHistory } from '../AttendanceHistory'
import { TimeEntries } from '../TimeEntries'
import { HOME_KEYS, useAroundMe, useBreak, useMeEmployee, useMyDay, useMyRequests, useNeedsYou, useUndoCheckOut } from './homeApi'
import {
  CalendarCard, LeaveCard, MyRequestsCard, NeedsYouCard, PayCard, ShortcutsCard, UpcomingEventsCard, YourDay, type Shortcut,
} from './HomeBlocks'
import { AssistedPunchPanel, MessageTeamDialog, TeamPunchEntry, TodaysTeam, WaitingForYou } from './TeamBlocks'
import {
  calendarDays, calendarSub, greetingWord, hm, lateDaysNote, lateSeries, latestPayslip, leaveDays, leaveNote, liveActiveMinutes, longWeekendTip,
  mainBalance, money, monthName, monthOf, monthWord, num, presentSeries, relDay, shiftMinutes, things, weeklyOffSet, wfhDaysInMonth,
} from './homeModel'
import './home.css'

/** Where "Review approvals" goes: the team's Approvals view once P-TEAM ships, else today's queue for the first kind waiting. */
const TODAY_QUEUE: Record<Exclude<InboxTab, 'all'>, string> = {
  leave: '/hrms/leave?tab=approvals',
  requests: '/hrms/leave?tab=approvals',
  attendance: '/hrms/attendance?tab=corrections',
  expenses: '/hrms/expenses?tab=approvals',
}
function approvalsPath(inbox: ApprovalsInbox | undefined): string {
  if (READY_PAGES.has('P-TEAM')) return '/team?view=approvals'
  const tabs = (inbox?.tabs ?? []).filter((t): t is Exclude<InboxTab, 'all'> => t !== 'all')
  const busy = tabs.find((t) => (inbox?.counts[t] ?? 0) > 0) ?? tabs[0]
  return busy ? TODAY_QUEUE[busy] : '/team'
}

const daysWord = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`

export function HomePage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const toast = useToast()
  const go = (path: string) => navigate(path)
  const user = useSdkStore((s) => s.user)
  const home = useHome()
  const team = home.team

  // ── what this person may do (as today's /me) ──
  const payroll = useAuthStore((s) => s.tenant?.activeModules.includes('payroll') ?? false)
  const canLeave = useAnyPermission([P.HRMS_LEAVE_READ, P.HRMS_ESS_READ, P.LEAVE_REQUEST_SELF])
  const canCheckIn = usePermission(P.ATTENDANCE_CHECKIN_SELF)
  const canWfh = useAnyPermission(['wfh.request.self', P.HRMS_ESS_READ, P.ATTENDANCE_CHECKIN_SELF])
  const canShift = useAnyPermission([P.HRMS_ESS_READ, P.ATTENDANCE_CHECKIN_SELF])
  const canSalary = usePermission(P.PAYROLL_STRUCTURE_READ_SELF) && payroll
  const canPayslips = usePermission(P.PAYROLL_PAYSLIP_READ_SELF) && payroll
  const canOnboarding = useAnyPermission([P.HRMS_ONBOARDING_INSTANCE_READ, P.HRMS_ONBOARDING_TASK_COMPLETE, 'hrms.onboarding.asset.read'])
  const canAssets = usePermission('hrms.onboarding.asset.self')
  const canInterviews = useAnyPermission(['hrms.hiring.interview.self', 'hrms.hiring.read'])
  const canLetters = usePermission(P.HRMS_LETTERS_READ_SELF)
  // Interviews show up only for people who have been asked to take one (as today).
  const interviews = useMyInterviews(canInterviews)
  const interviewCount = interviews.data?.length ?? 0
  const scorecardsDue = (interviews.data ?? []).filter((i) => i.started && i.scorecards.length === 0).length
  const canTeamToday = useAnyPermission(['attendance.team.read', 'attendance.workforce.admin'])
  const canAssist = useAnyPermission(['attendance.assisted_punch.team', 'attendance.assisted_punch.any'])
  const canMessage = usePermission('hrms.team.message')

  // ── the clock: the greeting, Your day's timer and the line move on ──
  const [now, setNow] = useState(() => new Date())
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 30_000); return () => clearInterval(t) }, [])
  const today = istToday(now)
  const month = monthOf(today)
  const year = Number(today.slice(0, 4))

  // ── reads ──
  const me = useMeEmployee()
  const companyId = me.data?.companyId ?? ''
  const day = useMyDay({ enabled: canCheckIn })
  const needs = useNeedsYou()
  const reqs = useMyRequests(6)
  const around = useAroundMe(30)
  const balances = useMyBalances()
  const leaves = useMyLeaves(0)
  const types = useLeaveTypes(canLeave ? companyId : '')
  const holidays = useHolidays(companyId, year)
  const nextYear = addDays(today, 30).slice(0, 4) !== today.slice(0, 4)
  const holidaysNext = useHolidays(nextYear ? companyId : '', year + 1)
  const weekend = useWeekendDays(companyId || undefined)
  const history = useAttendanceHistory(year, Number(today.slice(5, 7)), { enabled: canCheckIn && !team })
  const wfh = useMyWfhRequests(0, 50)
  const payslips = useQuery({
    queryKey: ['hrms', 'payroll', 'me', 'payslips'], queryFn: () => apiJson<MyPayslip[]>('/v1/payroll/payslips/me'), enabled: canPayslips, staleTime: 60_000,
  })
  const paySchedule = usePaySchedule({ enabled: canPayslips })
  const inbox = useApprovalsInbox({ tab: 'all', size: 4 }, { enabled: team })
  const teamDash = useTeamDashboard(today, undefined, team && canTeamToday)
  const trend = useAttendanceTrend(addDays(today, -30), today, undefined, team && canTeamToday)
  const summary = useTeamSummary({ enabled: team && canMessage })

  // ── Your day ──
  const myDay = day.notAvailable ? undefined : day.data
  const active = myDay ? liveActiveMinutes(myDay, day.dataUpdatedAt, now.getTime()) : null
  const target = myDay ? shiftMinutes(myDay.shift) : null
  const brk = useBreak()
  const undoOut = useUndoCheckOut()
  const [punch, setPunch] = useState<'in' | 'out' | null>(null)
  const webPunch = !!myDay?.webPunchAllowed
  const onBreak = () => {
    if (!myDay) return
    brk.mutate(myDay.onBreak ? 'end' : 'start', {
      onSuccess: () => toast.success(myDay.onBreak ? 'Break over. Your timer is running again.' : 'Break started. Your timer is paused.'),
      onError: (e) => toast.error(errorText(e, 'Couldn’t change your break. Try again.')),
    })
  }
  const onUndoOut = () => undoOut.mutate(undefined, {
    onSuccess: () => toast.success('Check-out undone. You’re checked in again.'),
    onError: (e) => toast.error(errorText(e, 'Couldn’t undo your check-out.')),
  })

  // ── the person's days ──
  const off = useMemo(() => weeklyOffSet(me.data?.weeklyOffDays, weekend.data?.weekendDays), [me.data?.weeklyOffDays, weekend.data?.weekendDays])
  const holidayList = useMemo(() => [...(holidays.data ?? []), ...(holidaysNext.data ?? [])]
    .filter((h) => h.active !== false).map((h) => ({ date: h.holidayDate, name: h.holidayName })), [holidays.data, holidaysNext.data])
  const myLeaves = useMemo(() => leaves.data?.content ?? [], [leaves.data])
  const wfhRequests = useMemo(() => wfh.data?.content ?? [], [wfh.data])
  const wfhThisMonth = useMemo(() => wfhDaysInMonth(wfhRequests, month, off), [wfhRequests, month, off])
  const needItems = useMemo(() => needs.data?.items ?? [], [needs.data])
  const toFix = useMemo(() => new Set(needItems.filter((n) => n.kind === 'MISSED_PUNCH_OUT' && n.onDate).map((n) => n.onDate as string)), [needItems])
  const calDays = useMemo(() => calendarDays({ month, today, history: history.data ?? [], wfhDays: wfhThisMonth, leaves: myLeaves, toFix, holidays: holidayList, off }),
    [month, today, history.data, wfhThisMonth, myLeaves, toFix, holidayList, off])
  const presentSoFar = calDays.filter((c) => c.date <= today && (c.tone === 'present' || c.tone === 'late' || c.tone === 'home' || c.tone === 'half')).length
  const workingSoFar = calDays.filter((c) => c.date < today && c.tone !== 'off' && c.tone !== 'holiday' && c.tone !== 'leave').length
    + (myDay?.checkedIn ? 1 : 0)
  const tip = useMemo(() => longWeekendTip(holidayList, off, today, leaveDays(myLeaves)), [holidayList, off, today, myLeaves])

  // ── leave and pay ──
  const bal = balances.data ?? []
  const main = mainBalance(bal, types.data)
  const slip = latestPayslip(payslips.data ?? [], today)
  const [payHidden, setPayHidden] = useState(true)
  const nextPay = paySchedule.data?.nextPayDate ?? null
  const payday = nextPay ? (() => {
    const d = dt(nextPay)
    const n = Math.round((d.getTime() - dt(today).getTime()) / 86_400_000)
    const when = n === 0 ? 'today' : n === 1 ? 'tomorrow' : n > 1 ? `in ${n} days` : relDay(nextPay, today)
    return <><b style={{ fontWeight: 500 }}>Next payday {WD[d.getDay()]}, {d.getDate()} {MON[d.getMonth()]}</b> · {when}</>
  })() : null

  // ── the team ──
  const inboxData = inbox.notAvailable ? undefined : inbox.data
  const showInbox = team && !inbox.notAvailable && (inbox.isLoading || !!inboxData?.tabs.length)
  const waitingCount = inboxData?.counts.all ?? 0
  const apprPath = approvalsPath(inboxData)
  const counts = teamDash.data ? dayBuckets(teamDash.data, today) : null
  const teamLabel = summary.data?.departmentNames.length ? summary.data.departmentNames.join(', ') : null
  const [assistOpen, setAssistOpen] = useState(false)
  const [assistFor, setAssistFor] = useState<string | null>(null)
  const [messageOpen, setMessageOpen] = useState(false)

  // ── greeting ──
  const name = greetingName(user?.firstName, user?.lastName) || 'there'
  const title = `${greetingWord(istHour(now))}, ${name}`
  const n = (needs.data?.count ?? 0) + (team ? waitingCount : 0)
  const needLine = n > 0 ? <><b style={{ fontWeight: 500 }}>{things(n)}</b> {n === 1 ? 'needs' : 'need'} you today.</> : <>Nothing needs you today.</>
  const sched = counts ? Math.max(0, counts.total - (counts.other || 0)) : 0
  const sub = team && counts && sched > 0
    ? <><b style={{ fontWeight: 500 }}>{counts.present} of {sched}</b> people in your team are working, and {n > 0 ? needLine : <>nothing needs you today.</>}</>
    : myDay?.checkedIn && active != null
      ? <><b style={{ fontWeight: 500 }}>{hm(active)}</b> into your day, and {n > 0 ? needLine : <>nothing needs you today.</>}</>
      : needLine

  // ── quick actions (Customise and "Most used first" wait for BW-112) ──
  const missed = needItems.filter((x) => x.kind === 'MISSED_PUNCH_OUT')
  const shiftHint = myDay?.shift ? [myDay.shift.name, myDay.shift.start && myDay.shift.end ? `${myDay.shift.start}–${myDay.shift.end}` : ''].filter(Boolean).join(' · ') : undefined
  const tiles: { key: string; label: string; hint?: string; kind: QuickIconKind; badge?: number; path?: string; onClick?: () => void }[] = team ? [
    ...(showInbox ? [{ key: 'approvals', label: 'Approvals', kind: 'calendar' as const, hint: inboxData ? `${waitingCount} waiting for you` : undefined, badge: waitingCount, path: apprPath }] : []),
    { key: 'team-today', label: 'Team today', kind: 'user', hint: counts ? `${counts.present} of ${sched} working` : undefined, path: '/team' },
    ...(canTeamToday ? [{ key: 'team-schedule', label: 'Team schedule', kind: 'swap' as const, hint: 'Who works when', path: READY_PAGES.has('P-TEAM') ? '/team?view=schedule' : '/team' }] : []),
    ...(canMessage ? [{ key: 'message', label: 'Message team', kind: 'megaphone' as const, hint: teamLabel ? `Post to ${teamLabel}` : 'Post to your team', onClick: () => setMessageOpen(true) }] : []),
    ...(canLeave ? [{ key: 'leave', label: 'Apply for leave', kind: 'home' as const, hint: main ? `${num(main.available)} ${main.leaveTypeName.replace(/\s*leave$/i, '').toLowerCase()} days left` : undefined, path: '/hrms/leave?tab=apply' }] : []),
    ...(canPayslips ? [{ key: 'payslip', label: 'Payslip', kind: 'download' as const, hint: slip ? `${monthName(slip.periodMonth)} is ready` : undefined, path: '/me/payslips' }] : []),
  ] : [
    ...(canLeave ? [{ key: 'leave', label: 'Apply for leave', kind: 'calendar' as const, hint: main ? `${num(main.available)} ${main.leaveTypeName.replace(/\s*leave$/i, '').toLowerCase()} days left` : undefined, path: '/hrms/leave?tab=apply' }] : []),
    ...(canWfh ? [{ key: 'wfh', label: 'Work from home', kind: 'home' as const, hint: wfh.data ? `${daysWord(wfhThisMonth.length)} this month` : undefined, path: '/me/wfh' }] : []),
    ...(canShift ? [{ key: 'fix', label: 'Fix a punch', kind: 'clock' as const, hint: missed[0]?.detail ?? 'Ask to correct a punch', badge: missed.length, path: missed[0]?.link ?? '/hrms/attendance?tab=my' }] : []),
    ...(canPayslips ? [{ key: 'payslip', label: 'Payslip', kind: 'download' as const, hint: slip ? `${monthName(slip.periodMonth)} is ready` : undefined, path: '/me/payslips' }] : []),
    ...(canShift ? [{ key: 'shift', label: 'Change shift', kind: 'swap' as const, hint: shiftHint, path: '/me/shift-change' }] : []),
    ...(canLetters ? [{ key: 'letters', label: 'Letters', kind: 'mail' as const, hint: 'From HR', path: '/hrms/letters/my' }] : []),
  ]

  // ── the four cards under the greeting (real figures only; no sparkline where there is no series) ──
  const card = (props: StatCardProps) => <StatCard key={props.label} variant="live" {...props} />
  const histDays = history.data ?? []
  const lateNow = histDays.filter((d) => d.date <= today && d.status === 'LATE').length
  const teamCards = (() => {
    if (!team || !canTeamToday) return []
    const staff = teamDash.data?.staffStatuses ?? []
    const daily: Record<string, DayBuckets> = {}
    for (const r of trend.data ?? []) daily[r.date] = trendBuckets(r, today)
    if (counts) daily[today] = counts
    const win = workingWindow(daily, today)
    const series = (k: keyof DayBuckets) => (win.length >= 2 ? win.map((d) => Number(daily[d][k]) || 0) : null)
    const eff = (x: (typeof staff)[number]) => x.effectiveStatus || (x.checkInAt ? (x.status === 'LATE' ? 'LATE' : 'PRESENT') : x.onLeave ? 'ON_LEAVE' : 'NOT_MARKED')
    const first = (st: string) => staff.find((x) => eff(x) === st)
    const onLeave = first('ON_LEAVE'), late = first('LATE'), none = first('NOT_MARKED')
    const loading = teamDash.isLoading
    return [
      card({ label: 'Team working today', aniIcon: 'present', accent: 'present', loading, value: counts ? `${counts.present} of ${sched}` : null,
        note: counts ? `${Math.max(0, counts.present - counts.wfh)} in office · ${counts.late} late` : undefined, spark: series('present'), onClick: () => go('/team') }),
      card({ label: 'On leave', aniIcon: 'leave', accent: 'leave', loading, value: counts?.onLeave ?? null,
        note: onLeave ? `${onLeave.fullName}${counts && counts.onLeave > 1 ? ` and ${counts.onLeave - 1} more` : ''}` : 'Nobody today', spark: series('onLeave'), onClick: () => go('/team') }),
      card({ label: 'Late today', aniIcon: 'late', accent: 'late', loading, value: counts?.late ?? null,
        note: late ? `${late.fullName} · in at ${clockIst(late.checkInAt)}` : 'Nobody late', spark: series('late'), onClick: () => go('/team') }),
      card({ label: 'Not in yet', aniIcon: 'none', accent: 'none', loading, value: counts?.notMarked ?? null,
        note: none ? `${none.fullName} · no punch yet` : 'Everyone is in', spark: series('notMarked'), onClick: () => go('/team') }),
    ]
  })()
  const myCards = team ? [] : [
    ...(canCheckIn ? [card({ label: 'Present days', aniIcon: 'present', accent: 'present', loading: history.isLoading, value: history.data ? presentSoFar : null,
      note: `of ${workingSoFar} working ${workingSoFar === 1 ? 'day' : 'days'}`, spark: history.data ? presentSeries(histDays, today) : null, onClick: () => go('/hrms/attendance?tab=my') })] : []),
    ...(canLeave && main ? [card({ label: 'Leave left', aniIcon: 'leave', accent: 'leave', value: num(main.available), note: leaveNote(main, bal), onClick: () => go('/hrms/leave') })] : []),
    ...(canCheckIn ? [card({ label: 'Late marks', aniIcon: 'late', accent: 'late', loading: history.isLoading, value: history.data ? lateNow : null,
      note: lateDaysNote(histDays, today) ?? `None in ${monthWord(today)}`, spark: history.data && lateNow ? lateSeries(histDays, today) : null, onClick: () => go('/hrms/attendance?tab=my') })] : []),
    ...(canWfh ? [card({ label: 'Work from home', aniIcon: 'wfh', accent: 'wfh', loading: wfh.isLoading, value: wfh.data ? wfhThisMonth.length : null,
      note: `days in ${monthWord(today)}`, onClick: () => go('/me/wfh') })] : []),
  ]
  const statCards = team ? teamCards : myCards

  // ── today's other /me entry points, kept reachable ──
  const shortcuts: Shortcut[] = [
    ...(team && canWfh ? [{ key: 'wfh', title: 'Work from home', sub: 'Ask to work from home on some days', icon: 'home', path: '/me/wfh' }] : []),
    ...(team && canShift ? [{ key: 'shift', title: 'Shift change', sub: 'Ask HR to move you to another shift', icon: 'swap', path: '/me/shift-change' }] : []),
    ...(canSalary ? [{ key: 'salary', title: 'Salary', sub: 'Your salary structure and components', icon: 'rupee', path: '/me/salary' }] : []),
    ...(canOnboarding ? [{ key: 'onboarding', title: 'Onboarding tasks', sub: 'Your onboarding checklist', icon: 'clipboard', path: '/hrms/onboarding/instances' }] : []),
    ...(canAssets ? [{ key: 'assets', title: 'My assets', sub: 'Company equipment handed to you', icon: 'briefcase', path: '/me/assets' }] : []),
    ...(canInterviews && interviewCount > 0 ? [{
      key: 'interviews', title: 'Interviews', icon: 'calendarClock', path: '/me/interviews',
      sub: scorecardsDue ? `${scorecardsDue} ${scorecardsDue === 1 ? 'scorecard is' : 'scorecards are'} waiting for you` : `${interviewCount} ${interviewCount === 1 ? 'interview' : 'interviews'} you’re taking`,
    }] : []),
    ...(team && canLetters ? [{ key: 'letters', title: 'Letters', sub: 'Letters HR has issued to you', icon: 'fileText', path: '/hrms/letters/my' }] : []),
    { key: 'profile', title: 'Profile', sub: 'Your photo, contact details and documents', icon: 'userCheck', path: '/profile' },
  ]

  const attendanceReady = READY_PAGES.has('P-ATT-DAY')
  const showCheckIn = webPunch && myDay && !myDay.checkedIn
  const showCheckOut = webPunch && myDay && myDay.checkedIn && !myDay.checkedOut

  return (
    <PageFrame width="narrow" top={22} gap={20} label="Home">
      <PageHeader size="greeting" wave align="end" title={title} sub={sub}
        actions={<>
          <DateChip size="home" today={today} value={today} />
          {showCheckOut && <Button variant="secondary" size={46} icon="logOut" onClick={() => setPunch('out')}>Check out</Button>}
          {showCheckIn && <Button variant="secondary" size={46} icon="scanFace" onClick={() => setPunch('in')}>Check in</Button>}
          {myDay?.canUndoCheckOut && <Button variant="secondary" size={46} loading={undoOut.isPending} onClick={onUndoOut}>Undo check-out</Button>}
          {team && showInbox
            ? <Button variant="primary" size={46} icon="inbox" onClick={() => go(apprPath)}>Review approvals</Button>
            : canLeave && <Button variant="primary" size={46} icon="plus" onClick={() => go('/hrms/leave?tab=apply')}>Apply leave</Button>}
        </>} />

      {team && canAssist && <TeamPunchEntry onOpen={() => setAssistOpen(true)} />}

      {statCards.length > 0 && <StatGrid min={230} label={team ? 'Your team today' : 'Your month at a glance'}>{statCards}</StatGrid>}

      {tiles.length > 0 && (
        <section aria-label="Quick actions" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <SectionHeading title="Quick actions" level={2} />
          <QuickActionGrid>
            {tiles.map((t, i) => (
              <QuickActionTile key={t.key} index={i} label={t.label} hint={t.hint} kind={t.kind} badge={t.badge || null}
                badgeLabel={t.badge ? `${t.badge} waiting` : undefined} onClick={t.onClick ?? (() => go(t.path as string))} />
            ))}
          </QuickActionGrid>
        </section>
      )}

      {myDay && (
        <YourDay day={myDay} active={active} target={target} now={now} onBreak={webPunch ? onBreak : undefined} breakBusy={brk.isPending} />
      )}

      <div className="uh-cols">
        <div className="uh-col">
          {showInbox && (
            <WaitingForYou inbox={inboxData} loading={inbox.isLoading} error={inbox.error} onRetry={() => inbox.refetch()} onSeeAll={() => go(apprPath)} />
          )}
          {!needs.notAvailable && (
            <NeedsYouCard items={needItems} count={needs.data?.count ?? 0} loading={needs.isLoading} error={needs.error} onRetry={() => needs.refetch()} today={today} onOpen={go} />
          )}
          {!reqs.notAvailable && (
            <MyRequestsCard requests={reqs.data?.requests ?? []} loading={reqs.isLoading} error={reqs.error} onRetry={() => reqs.refetch()} today={today} onOpen={go} />
          )}
        </div>
        <div className="uh-col">
          {team && canTeamToday && (
            <TodaysTeam staff={teamDash.data?.staffStatuses ?? []} counts={counts} loading={teamDash.isLoading} error={teamDash.error}
              onRetry={() => teamDash.refetch()} onOpen={() => go('/team')} />
          )}
          {!team && canCheckIn && (
            <CalendarCard month={month} monthWord={monthWord(today)} days={calDays} sub={calendarSub(presentSoFar, workingSoFar, [...toFix].filter((d) => monthOf(d) === month).length)}
              loading={history.isLoading} error={history.error} onRetry={() => history.refetch()} onOpen={() => go('/hrms/attendance?tab=my')} />
          )}
          <div className="uh-pair">
            <LeaveCard balances={bal} loading={balances.isLoading} error={balances.error} onRetry={() => balances.refetch()}
              onApply={canLeave ? () => go('/hrms/leave?tab=apply') : undefined} tip={tip} />
            {canPayslips && (
              <PayCard periodLabel={slip ? monthName(slip.periodMonth) : null} net={slip ? money(slip.netPay) : null} hidden={payHidden} onToggle={setPayHidden}
                payday={payday} loading={payslips.isLoading} error={payslips.error} onRetry={() => payslips.refetch()} onAll={() => go('/me/payslips')} />
            )}
          </div>
          {!around.notAvailable && (
            <UpcomingEventsCard items={around.data?.items ?? []} loading={around.isLoading} error={around.error} onRetry={() => around.refetch()} today={today} onOpen={go} />
          )}
        </div>
      </div>

      <ShortcutsCard items={shortcuts} onOpen={go} />

      {/* My attendance and time entries stay on Home until P-ATT-DAY's pages are live. */}
      {!attendanceReady && <AttendanceHistory />}
      {!attendanceReady && <TimeEntries />}

      <WebPunchDialog open={punch !== null} mode={punch ?? 'in'} onClose={() => setPunch(null)} />
      {canAssist && <AssistedPunchPanel open={assistOpen} onClose={() => setAssistOpen(false)} onPick={(id) => { setAssistOpen(false); setAssistFor(id) }} />}
      {canAssist && (
        <AssistedPunchDialog open={assistFor !== null} employeeId={assistFor ?? undefined} onClose={() => setAssistFor(null)}
          onDone={() => { void teamDash.refetch(); void qc.invalidateQueries({ queryKey: HOME_KEYS.eligible }) }} />
      )}
      {canMessage && <MessageTeamDialog open={messageOpen} onClose={() => setMessageOpen(false)} teamLabel={teamLabel} />}
    </PageFrame>
  )
}
