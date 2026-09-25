// My team (/team): a manager's day at a glance, in the module kit's style.
// Today's numbers, who's in (the roster the attendance API scopes to the
// manager's team), leave waiting for them (decided right here, same cards as
// the Leave page) and the week's shift roster.
import { useNavigate } from 'react-router-dom'
import { usePermission, P, useAuthStore as useSdkStore } from '@unifiedtree/sdk'
import { HrAvatar, HrButton, HrStatusPill, type PillTone } from '@/shared/components/hr'
import { dashIcon } from '@/design/dc/icons'
import { greetingName } from '@/shared/hooks/greetingName'
import { ModulePage, StatRow, SubHeading, State, RowList, Row, ApprovalList, useDesignToast, todayIso, range, days, stamp } from '@/design/module/ModuleKit'
import { useTeamDashboard } from '../api/useAttendance'
import { usePendingApprovals, useLeaveDecision } from '../api/useLeave'
import { TeamSchedule } from './TeamSchedule'

const time = (at?: string | null) => (at ? new Date(at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '—')
function pill(status?: string): [string, PillTone] {
  const s = (status || '').toUpperCase()
  if (s === 'PRESENT' || s === 'CHECKED_IN' || s === 'ON_TIME') return ['Present', 'ok']
  if (s === 'LATE') return ['Late', 'late']
  if (s === 'ABSENT') return ['Absent', 'red']
  if (s === 'ON_LEAVE') return ['On leave', 'blue']
  if (s === 'NOT_MARKED' || !s) return ['Not marked yet', 'gray']
  return [s.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase()), 'gray']
}

export function TeamDashboard() {
  const navigate = useNavigate()
  const user = useSdkStore((s) => s.user)
  const canTeam = usePermission(P.ATTENDANCE_TEAM_READ)
  const canApprove = usePermission(P.HRMS_LEAVE_APPROVE_L1)
  const { show, node } = useDesignToast()
  const team = useTeamDashboard(todayIso())
  const leave = usePendingApprovals(0, canApprove)
  const decide = useLeaveDecision()
  const c = team.data?.counts, people = team.data?.staffStatuses ?? []
  const pending = leave.data?.content ?? []
  const hour = new Date().getHours(), greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const onDecide = async (id: string, status: 'APPROVED' | 'REJECTED', note: string) => {
    try { await decide.mutateAsync({ requestId: id, status, comment: note.trim() || undefined }); show(`Leave ${status === 'APPROVED' ? 'approved' : 'rejected'}`) } catch (e) { show('Couldn’t save the decision', true, (e as Error)?.message) }
  }
  return (
    <ModulePage crumb="My team" title={`${greeting}, ${greetingName(user?.firstName, user?.lastName) || 'there'}`} subtitle={`Your team today, ${new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}.`}
      actions={canTeam ? <HrButton variant="ghost" onClick={() => navigate('/hrms/attendance')}>{dashIcon('clock', 15)} Team attendance</HrButton> : undefined}>
      {canTeam && (team.isLoading ? <State kind="loading" height={96} /> : <StatRow tiles={[
        { icon: 'userCheck', color: 'green', label: 'Present', value: String(c?.present ?? 0), sub: 'Checked in today' },
        // Today nobody is absent until the day is over; the API's own count of people without a punch.
        { icon: 'help', color: 'orange', label: 'Not marked yet', value: String(c?.notMarked ?? 0), sub: 'No punch so far today' },
        { icon: 'calendarDays', color: 'blue', label: 'On leave', value: String(c?.onLeave ?? 0), sub: 'Approved leave today' },
        ...(canApprove ? [{ icon: 'inbox', color: 'orange' as const, label: 'Waiting for you', value: String(leave.data?.totalElements ?? 0), sub: 'Leave requests to decide' }] : []),
      ]} />)}

      {canApprove && (
        <div style={{ display: 'grid', gap: 12 }}>
          <SubHeading aside={pending.length ? <HrButton size="sm" variant="ghost" onClick={() => navigate('/hrms/leave?tab=approvals')}>All approvals</HrButton> : undefined}>Leave waiting for your OK</SubHeading>
          {leave.isLoading ? <State kind="loading" />
            : leave.error ? <State kind="error" title="Couldn’t load leave requests" onRetry={() => leave.refetch()} />
              : pending.length === 0 ? <State kind="empty" icon="checkCircle" title="All caught up" description="No leave requests are waiting for you." />
                : <ApprovalList items={pending.slice(0, 5).map((l) => ({ id: l.id, name: l.employeeName || 'Employee', sub: [l.employeeCode, l.departmentName].filter(Boolean).join(' · '), facts: [{ k: 'Leave', v: l.leaveTypeName || 'Leave' }, { k: 'Dates', v: range(l.startDate, l.endDate) }, { k: 'Days', v: days(Number(l.totalDays)) }], reason: l.reason || '—', raised: stamp(l.createdAt) }))}
                  onDecide={onDecide} busy={decide.isPending} approveTip="Approves the request and updates their balance" />}
        </div>
      )}

      {canTeam && (
        <div style={{ display: 'grid', gap: 12 }}>
          <SubHeading>Who’s in today</SubHeading>
          {team.isLoading ? <State kind="loading" />
            : team.error ? <State kind="error" title="Couldn’t load your team" onRetry={() => team.refetch()} />
              : people.length === 0 ? <State kind="empty" icon="users" title="No one in your team yet" description="People who report to you appear here with today’s punches." />
                : (
                  <RowList>
                    {people.map((s) => {
                      // The effective status (company attendance policy + reviewers' changes) when the server sends it.
                      const [lab, tone] = pill(s.effectiveStatus || (s.checkInAt ? (s.status === 'LATE' ? 'LATE' : 'PRESENT') : s.onLeave ? 'ON_LEAVE' : s.status))
                      return <Row key={s.employeeId} lead={<HrAvatar name={s.fullName ?? '—'} sub={s.jobTitle ?? s.departmentName ?? ''} />} title={`In ${time(s.checkInAt)} · Out ${time(s.checkOutAt)}`} trail={<HrStatusPill tone={tone}>{lab}</HrStatusPill>} />
                    })}
                  </RowList>
                )}
        </div>
      )}

      <TeamSchedule />
      {!canTeam && !canApprove && <State kind="empty" icon="lock" title="No team access" description="Ask an admin if you manage people and can’t see them here." />}
      {node}
    </ModulePage>
  )
}
