// My team (/team): Team today, Team schedule and Approvals as the page's own views (inline pill
// tabs under the header, kept in ?view=; Approvals keeps its kind in ?tab=). Each view shows only
// with the permission its API needs:
//   Team today   anyone who can open /team (each block then needs its own permission)
//   Schedule     attendance.team.read
//   Approvals    any approve permission (leave, work from home, fixes and shift changes, expenses, timesheets)
import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { P, useAnyPermission, usePermission } from '@unifiedtree/sdk'
import { PageFrame } from '@/design/kit/display'
import { Views } from '@/design/module/ModuleKit'
import { TEAM_APPROVE_CODES } from '@/shared/navigation/shellCodes'
import { useApprovalsInbox } from '../api/shared/useApprovalsInbox'
import { useTeamSummary } from '../api/shared/useTeamSummary'
import type { InboxTab } from '../api/shared/contracts'
import { MessageTeamPanel } from './TeamDialogs'
import { TeamApprovals } from './TeamApprovals'
import { TeamSchedule } from './TeamSchedule'
import { NoTeamAccess, TeamToday } from './TeamToday'
import { TEAM_VIEWS, inboxTabsFor, pickTab, pickView, type TeamView } from './teamModel'
import './team.css'

export function TeamDashboard() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const canTeam = usePermission(P.ATTENDANCE_TEAM_READ)
  const canLeaveL1 = usePermission(P.HRMS_LEAVE_APPROVE_L1)
  const canWfh = usePermission(P.WFH_APPROVE)
  const canInbox = useAnyPermission([...TEAM_APPROVE_CODES])
  const canPerformance = usePermission('hrms.performance.read')
  const canDecideProbation = usePermission(P.HRMS_PROBATION_TEAM_DECIDE)
  const canMessage = usePermission(P.HRMS_TEAM_MESSAGE)
  const canOpenPeople = usePermission(P.HRMS_EMPLOYEE_READ)
  const canFixes = usePermission(P.ATTENDANCE_REGULARIZATION_APPROVE)
  const canExpenses = usePermission('hrms.expense.claim.approve')
  const canTimesheets = usePermission(P.HRMS_TIMESHEET_APPROVE)
  const [messaging, setMessaging] = useState(false)

  const summary = useTeamSummary({ enabled: canTeam || canLeaveL1 })
  // The same query Team today's "Waiting for you" reads: one request for the count and the card.
  const inbox = useApprovalsInbox({ tab: 'all', page: 0, size: 3 }, { enabled: canInbox })

  const allowed: TeamView[] = TEAM_VIEWS.map((v) => v.key)
    .filter((k) => k === 'today' || (k === 'schedule' && canTeam) || (k === 'approvals' && canInbox))
  const view = pickView(params.get('view'), allowed)
  const tab = pickTab(params.get('tab'), inboxTabsFor({ leave: canLeaveL1, wfh: canWfh, fixes: canFixes, expenses: canExpenses, timesheets: canTimesheets }))

  const go = (next: TeamView, nextTab?: InboxTab) => {
    const sp = new URLSearchParams(params)
    if (next === 'today') sp.delete('view'); else sp.set('view', next)
    if (next === 'approvals' && nextTab) sp.set('tab', nextTab)
    else if (next !== 'approvals') sp.delete('tab')
    setParams(sp, { replace: true })
    window.scrollTo?.({ top: 0 })
  }

  if (!canTeam && !canLeaveL1 && !canInbox) {
    return <PageFrame width="narrow" label="My team"><NoTeamAccess /></PageFrame>
  }

  const waiting = inbox.data?.counts.all ?? 0
  const members = summary.data?.members
  const teamLabel = summary.data?.scope === 'DEPARTMENT' && summary.data.departmentNames.length ? summary.data.departmentNames.join(', ') : null

  return (
    <PageFrame width="narrow" label="My team" className="tm-page">
      {allowed.length > 1 && (
        <Views label="My team views" active={view} onChange={(k) => go(k as TeamView)}
          items={TEAM_VIEWS.filter((v) => allowed.includes(v.key)).map((v) => ({
            key: v.key, label: v.label, count: v.key === 'approvals' && waiting > 0 ? waiting : undefined,
          }))} />
      )}
      {view === 'today' && (
        <TeamToday summary={summary} canTeam={canTeam} canInbox={canInbox} canTimeOff={canTeam || canLeaveL1 || canWfh}
          canPerformance={canPerformance} canDecideProbation={canDecideProbation} canMessage={canMessage}
          onView={go} onMessage={() => setMessaging(true)} onAttendance={() => navigate('/hrms/attendance')} />
      )}
      {view === 'schedule' && <TeamSchedule canOpenPeople={canOpenPeople} onView={go} />}
      {view === 'approvals' && <div className="tm-approvals"><TeamApprovals tab={tab} onTab={(t) => go('approvals', t)} /></div>}
      {canMessage && (
        <MessageTeamPanel open={messaging} onClose={() => setMessaging(false)}
          teamSize={members ? members.length : null} teamLabel={teamLabel} />
      )}
    </PageFrame>
  )
}
