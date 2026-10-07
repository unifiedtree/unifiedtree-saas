// Daily tracking (/hrms/attendance), rebuilt on the redesign kit (PgAttendance "Today", PgTime a-daily,
// EmpTime e-att). The module's pages (Analytics, Daily tracking, Shifts…) are the header's top tabs
// (the shell); this page's own views are the inline pills at the top of the page, under them (DECISIONS 21):
//
//   HR and managers   Daily Logs · Face Punch · Regularization · Review · My Attendance · Timesheet
//   everyone else     My Attendance · Regularization · Timesheet
//
// Each view loads its own data, shows its own loading, error and empty states, and every tab,
// button and action shows only with the permission its endpoint checks. ?tab= keeps the view
// (team, face, corrections, review, my, timesheet; unknown or hidden → the first one), ?date= the
// Daily Logs day and ?status= its filter card.
import { useNavigate, useSearchParams } from 'react-router-dom'
import { usePermission, useAnyPermission, P } from '@unifiedtree/sdk'
import { CountBadge, PageFrame, PillTabs, type PillTab } from '@/design/kit/display'
import { usePersonalPages } from '@/shared/hooks/usePersonalPages'
import { isReadyPage } from '@/shared/navigation/pageRegistry'
import { useCorrectionApprovals } from '../../api/useAttendance'
import { useFaceReviewEvents, useReviewExceptions } from '../../api/useAttendanceReview'
import { addDays, istToday } from '@/design/dc/dates'
import { DailyLogs } from './DailyLogs'
import { FacePunch } from './FacePunch'
import { Regularization } from './Regularization'
import { ReviewView } from './ReviewView'
import { MyAttendance } from './MyAttendance'
import { Timesheet } from '../timesheet/Timesheet'
import './daily.css'

export type DailyTab = 'team' | 'face' | 'corrections' | 'review' | 'my' | 'timesheet'

export interface DailyPerms {
  team: boolean; face: boolean; review: boolean; override: boolean; approve: boolean; self: boolean
  admin: boolean; report: boolean; assist: boolean; timesheetApprove: boolean; leaveOthers: boolean
  /** My Attendance, your own fixes and timesheet: the personal pages rule (usePersonalPages). */
  personalPages: boolean
}

export function useDailyPerms(): DailyPerms {
  const personal = usePersonalPages()
  return {
    team: usePermission(P.ATTENDANCE_TEAM_READ),
    face: usePermission(P.ATTENDANCE_FACE_ADMIN_READ),
    review: usePermission('attendance.status.review'),
    override: usePermission('attendance.status.override'),
    approve: usePermission(P.ATTENDANCE_REGULARIZATION_APPROVE),
    self: usePermission(P.ATTENDANCE_CHECKIN_SELF),
    admin: usePermission('attendance.workforce.admin'),
    report: usePermission(P.HRMS_REPORT_ATTENDANCE),
    assist: useAnyPermission([P.ATTENDANCE_ASSISTED_PUNCH_TEAM, P.ATTENDANCE_ASSISTED_PUNCH_ANY]),
    timesheetApprove: usePermission(P.HRMS_TIMESHEET_APPROVE),
    leaveOthers: usePermission(P.HRMS_LEAVE_APPLY_OTHERS),
    personalPages: personal,
  }
}

/** The views this person gets, in order (the registry's tab rules, att-daily:*). */
export function dailyTabs(p: DailyPerms, timesheetReady: boolean): DailyTab[] {
  const tabs: DailyTab[] = []
  if (p.team) tabs.push('team')
  // The face list answers anyone with the face log or the review permission.
  if (p.team && (p.face || p.review)) tabs.push('face')
  tabs.push('corrections')
  if (p.team && p.review) tabs.push('review')
  if (p.self && p.personalPages) tabs.push('my')
  if (timesheetReady && ((p.self && p.personalPages) || p.timesheetApprove)) tabs.push('timesheet')
  // Staff open on their own month; Regularization moves after it (today's order).
  if (!p.team) {
    const i = tabs.indexOf('my')
    if (i > 0) { tabs.splice(i, 1); tabs.unshift('my') }
  }
  return tabs
}

const LABEL: Record<DailyTab, string> = {
  team: 'Daily Logs', face: 'Face Punch', corrections: 'Regularization', review: 'Review', my: 'My Attendance', timesheet: 'Timesheet',
}
const ICON: Record<DailyTab, string> = { team: 'list', face: 'scanFace', corrections: 'pencil', review: 'clipboard', my: 'userCheck', timesheet: 'timer' }

export function DailyTracking() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const perms = useDailyPerms()
  const today = istToday()
  const tabs = dailyTabs(perms, isReadyPage({ pkg: 'P-ATT-DAY' }))
  const asked = (params.get('tab') || '') as DailyTab
  const tab: DailyTab = tabs.includes(asked) ? asked : tabs[0]

  // Badge counts: what is waiting for this person on each view.
  const weekAgo = addDays(today, -6)
  const pending = useCorrectionApprovals('PENDING', { enabled: perms.approve, size: 100 })
  const faces = useFaceReviewEvents(weekAgo, today, tabs.includes('face'))
  const review = useReviewExceptions(weekAgo, today, tabs.includes('review'))
  const counts: Partial<Record<DailyTab, number>> = {
    corrections: perms.approve ? pending.data?.totalElements ?? pending.data?.content.length ?? 0 : 0,
    face: (faces.data ?? []).filter((e) => e.status === 'REVIEW').length,
    review: review.data?.length ?? 0,
  }

  const go = (next: string) => {
    const q = new URLSearchParams(params)
    q.set('tab', next)
    if (next !== 'team') { q.delete('date'); q.delete('status') }
    // Each view keeps its own start / end dates (Review, Regularization): a new view starts on its default.
    if (next !== tab) { q.delete('from'); q.delete('to') }
    navigate(`/hrms/attendance?${q}`, { replace: true })
  }
  const items: PillTab[] = tabs.map((k) => ({
    key: k,
    icon: ICON[k],
    ariaLabel: counts[k] ? `${LABEL[k]} ${counts[k]}` : LABEL[k],
    label: counts[k] ? <>{LABEL[k]} <CountBadge tone={k === 'face' || k === 'review' ? 'gold' : 'brand'}>{counts[k]}</CountBadge></> : LABEL[k],
  }))
  const pills = <PillTabs items={items} activeKey={tab} onSelect={go} label="Daily tracking views" className="udt-views" />

  return (
    <PageFrame label="Daily tracking" className="udt">
      {pills}
      {tab === 'team' && <DailyLogs perms={perms} />}
      {tab === 'face' && <FacePunch perms={perms} />}
      {tab === 'corrections' && <Regularization perms={perms} />}
      {tab === 'review' && <ReviewView perms={perms} />}
      {tab === 'my' && <MyAttendance perms={perms} />}
      {tab === 'timesheet' && <Timesheet perms={perms} />}
    </PageFrame>
  )
}
