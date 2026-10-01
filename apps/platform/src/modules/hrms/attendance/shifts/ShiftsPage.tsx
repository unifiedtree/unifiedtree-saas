// /hrms/shifts — Shifts & overtime (P-ATT-PLAN; prototype PgTime a-shifts, and EmpTime e-shift for My Shift). The
// page's own views are inline pill tabs (DECISIONS 21), kept in ?tab= with today's names and order:
//   people with attendance.team.read: Shift Schedules · Roster · Overtime · Shift Requests
//   everyone else (attendance.checkin.self): My Shift
// Shift planning (rotations, a week grid to plan) is on hold (DECISIONS 21).
import { useCallback, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { P, usePermission } from '@unifiedtree/sdk'
import { apiJson } from '@/core/api/client'
import { Button, CountBadge, EmptyState, PageFrame, PageHeader, PillTabs } from '@/design/kit/display'
import { istToday } from '@/design/dc/dates'
import { useCompanies } from '../../api/useOrg'
import { useTeamDashboard } from '../../api/useAttendance'
import { useEmployeeShift, useShiftPolicies } from '../../api/useShiftPolicies'
import { usePendingShiftRequests } from '../../api/useShiftRequests'
import { useOvertimeEntries, useTeamOvertimeRequests } from '../../api/useOvertime'
import { useOvertimeRules } from '../../api/shared/useOvertimeRules'
import { SchedulesView } from './SchedulesView'
import { RosterView, type RosterRow } from './RosterView'
import { OvertimeView } from './OvertimeView'
import { RequestsView } from './RequestsView'
import { MyShiftView } from './MyShiftView'
import { hhmm } from './shiftModel'
import '../analytics/analytics.css'

type Tab = 'schedules' | 'roster' | 'overtime' | 'requests' | 'myshift'
const HR_TABS: { key: Tab; label: string }[] = [
  { key: 'schedules', label: 'Shift Schedules' }, { key: 'roster', label: 'Roster' }, { key: 'overtime', label: 'Overtime' }, { key: 'requests', label: 'Shift Requests' },
]
interface ScheduleRow { employeeId: string; employeeName: string; shiftPolicyId?: string | null; shiftName?: string | null; since?: string | null; joinedOn?: string | null }

export function ShiftsPage() {
  const [params, setParams] = useSearchParams()
  const today = istToday()
  const canTeam = usePermission(P.ATTENDANCE_TEAM_READ)
  const canApprove = usePermission(P.ATTENDANCE_REGULARIZATION_APPROVE)
  const canOt = usePermission('attendance.overtime.approve')
  const canShiftAdmin = usePermission('attendance.workforce.admin')
  const canPolicy = usePermission('attendance.policy.manage')
  const canSelf = usePermission(P.ATTENDANCE_CHECKIN_SELF)
  const tabs = canTeam ? HR_TABS : [{ key: 'myshift' as Tab, label: 'My Shift' }]
  const tab: Tab = tabs.find((t) => t.key === params.get('tab'))?.key ?? tabs[0].key
  const [addKey, setAddKey] = useState(0)
  const [rosterFilter, setRosterFilter] = useState('all')

  const { data: companies = [] } = useCompanies()
  const companyId: string = companies[0]?.id ?? ''
  const policies = useShiftPolicies(companyId)
  const shifts = useMemo(() => [...(policies.data ?? [])].sort((a, b) => hhmm(a.startTime).localeCompare(hhmm(b.startTime))), [policies.data])
  const teamToday = useTeamDashboard(today, undefined, canTeam)
  const schedule = useQuery({
    queryKey: ['team', 'schedule', today, today],
    queryFn: () => apiJson<ScheduleRow[]>(`/v1/team/schedule?from=${today}&to=${today}`),
    enabled: canTeam,
  })
  const me = useQuery({ queryKey: ['employees', 'me'], queryFn: () => apiJson<{ id: string }>('/v1/employees/me'), enabled: canSelf && !canTeam, staleTime: 300_000 })
  const myShift = useEmployeeShift(me.data?.id, { enabled: !canTeam })
  const rules = useOvertimeRules(companyId, { enabled: !!companyId && (canTeam || canSelf) })
  // Counts on the tabs (the same queries the views read, so nothing loads twice).
  const pending = usePendingShiftRequests({ enabled: canApprove && canTeam })
  const prevMonthStart = (() => { const d = new Date(`${today.slice(0, 8)}01T00:00:00`); d.setDate(0); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01` })()
  const otEntries = useOvertimeEntries(prevMonthStart, today, canTeam)
  const otRequests = useTeamOvertimeRequests(prevMonthStart, addThirty(today), canTeam)

  const people = useMemo(() => {
    const m = new Map<string, { code: string; dept: string }>()
    for (const s of teamToday.data?.staffStatuses ?? []) m.set(s.employeeId, { code: s.employeeCode, dept: s.departmentName || '—' })
    return m
  }, [teamToday.data])
  const who = useCallback((id: string) => people.get(id), [people])
  const roster: RosterRow[] = useMemo(() => (schedule.data ?? []).map((r) => {
    const p = people.get(r.employeeId)
    const shift = r.shiftPolicyId || (r.shiftName ? shifts.find((s) => s.name === r.shiftName)?.id ?? null : null)
    return { id: r.employeeId, name: r.employeeName, code: p?.code ?? '—', dept: p?.dept ?? '—', shift, since: r.since ?? null, joinedOn: r.joinedOn ?? null }
  }), [schedule.data, people, shifts])
  const perShift = useMemo(() => { const m = new Map<string, number>(); for (const r of roster) if (r.shift) m.set(r.shift, (m.get(r.shift) ?? 0) + 1); return m }, [roster])
  const noShift = roster.filter((r) => !r.shift || !shifts.some((s) => s.id === r.shift)).length
  const otWaiting = (otEntries.data ?? []).filter((o) => o.status === 'PENDING').length + (otRequests.data ?? []).filter((o) => o.status === 'PENDING').length
  const count: Partial<Record<Tab, number>> = { roster: schedule.isSuccess ? noShift : 0, overtime: otWaiting, requests: pending.data?.length ?? 0 }

  const setTab = (next: string) => {
    const sp = new URLSearchParams(params)
    sp.set('tab', next)
    setParams(sp, { replace: true })
  }
  const seePeople = (shiftId: string) => { setRosterFilter(shiftId); setTab('roster') }

  const mine = myShift.data
  const subs: Record<Tab, string> = {
    schedules: 'Shift timings, grace periods and who works them.',
    roster: 'Who works which shift today. Move someone to another shift from a date you choose.',
    overtime: 'Hours worked beyond the shift. Approved overtime is recorded, not paid.',
    requests: 'Requests from employees who want to move shifts.',
    myshift: mine?.shiftName
      ? `You work the ${mine.shiftName} shift, ${hhmm(mine.startTime)} to ${hhmm(mine.endTime)}${mine.gracePeriodMinutes ? ` with ${mine.gracePeriodMinutes} minutes’ grace` : ''}. Pick another shift to ask HR to move you.`
      : 'Your work timing, and requests to change it.',
  }

  if (!canTeam && !canSelf) {
    return (
      <PageFrame label="Shifts & overtime">
        <PageHeader eyebrow="Attendance & time" title="Shifts & overtime" />
        <EmptyState icon="lock" title="Nothing to show here" hint="Shifts appear for people who punch in or look after a team." />
      </PageFrame>
    )
  }

  return (
    <PageFrame label="Shifts & overtime" className="apl-page">
      <PageHeader eyebrow="Attendance & time" title={canTeam ? 'Shifts & overtime' : 'My Shift'} sub={subs[tab]}
        actions={canTeam && canShiftAdmin ? <Button icon="plus" onClick={() => { setTab('schedules'); setAddKey((k) => k + 1) }}>Add shift</Button> : undefined} />
      {tabs.length > 1 && (
        <PillTabs label="Shifts & overtime views" semantics="tabs" className="apl-tabs" activeKey={tab} onSelect={setTab}
          items={tabs.map((t) => ({ key: t.key, label: <><span>{t.label}</span>{count[t.key] ? <CountBadge tone="gold" size="sm">{count[t.key]}</CountBadge> : null}</> }))} />
      )}
      {tab === 'schedules' && (
        <SchedulesView companyId={companyId} shifts={shifts} loading={policies.isLoading || !companyId} error={policies.error} onRetry={() => policies.refetch()}
          canEdit={canShiftAdmin} addKey={addKey} people={perShift} noShift={schedule.isSuccess ? noShift : 0} onSeePeople={seePeople} />
      )}
      {tab === 'roster' && (
        <RosterView rows={roster} shifts={shifts} loading={schedule.isLoading} error={schedule.error} onRetry={() => schedule.refetch()}
          canEdit={canShiftAdmin} filter={rosterFilter} onFilter={setRosterFilter} today={today} />
      )}
      {tab === 'overtime' && (
        <OvertimeView today={today} companyId={companyId} canTeam={canTeam} canDecide={canOt} canPolicy={canPolicy} canSelf={canSelf} who={who} />
      )}
      {tab === 'requests' && <RequestsView canApprove={canApprove} shifts={shifts} />}
      {tab === 'myshift' && (
        <MyShiftView shifts={shifts} shiftsLoading={policies.isLoading || !companyId} mine={mine} today={today} canSelf={canSelf}
          minimumMinutes={rules.data?.minimumMinutes ?? null} />
      )}
    </PageFrame>
  )
}

function addThirty(iso: string) {
  const d = new Date(`${iso}T00:00:00`)
  d.setDate(d.getDate() + 30)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
