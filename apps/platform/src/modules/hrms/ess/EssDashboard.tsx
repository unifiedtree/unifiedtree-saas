// My workspace (/me, /hrms/ess): an employee's landing page, in the design
// language of the redesigned modules (design/module/ModuleKit). This month's
// attendance, leave at a glance, the self-service requests, attendance history
// and daily time entries. Every shortcut shows only when its page would open
// for this person (the same permissions as the routes in App.tsx).
import { useNavigate } from 'react-router-dom'
import { P, useAnyPermission, usePermission, useAuthStore as useSdkStore } from '@unifiedtree/sdk'
import { useAuthStore } from '@/core/auth/authStore'
import { HrButton, HrStatusPill, type PillTone } from '@/shared/components/hr'
import { dashIcon } from '@/design/dc/icons'
import { ModulePage, StatRow, Panel, State, Row, Facts, Note, days, range, CARD } from '@/design/module/ModuleKit'
import { useMonthlyStats } from '../api/useAttendance'
import { useMyBalances, useMyLeaves } from '../api/useLeave'
import { useMyInterviews } from '../api/useHiring'
import { AttendanceHistory } from './AttendanceHistory'
import { TimeEntries } from './TimeEntries'

const LEAVE: Record<string, [string, PillTone]> = { APPROVED: ['Approved', 'ok'], PENDING: ['Pending', 'warn'], REJECTED: ['Rejected', 'red'], CANCELLED: ['Cancelled', 'gray'], PENDING_L2: ['Awaiting HR', 'purple'] }

function Shortcut({ icon, title, sub, cta, onClick }: { icon: string; title: string; sub: string; cta: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="ut-row-hover"
      style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', border: 0, borderBottom: '1px solid #f1f5f9', background: 'transparent', font: 'inherit', color: 'inherit', textAlign: 'left', cursor: 'pointer' }}>
      <span aria-hidden="true" style={{ flex: '0 0 auto', width: 36, height: 36, borderRadius: 11, background: '#ecfdf5', border: '1px solid #d1fae5', color: '#0f6e56', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{dashIcon(icon, 17)}</span>
      <span style={{ flex: 1, minWidth: 0, display: 'grid', gap: 2 }}><strong style={{ fontSize: 14 }}>{title}</strong><span style={{ fontSize: 12.5, color: '#64748b' }}>{sub}</span></span>
      <span style={{ flex: '0 0 auto', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12.5, fontWeight: 700, color: '#0f6e56' }}>{cta}{dashIcon('arrowRight', 14)}</span>
    </button>
  )
}

export function EssDashboard() {
  const navigate = useNavigate()
  const user = useSdkStore((s) => s.user)
  const canLeave = useAnyPermission([P.HRMS_LEAVE_READ, P.HRMS_ESS_READ, P.LEAVE_REQUEST_SELF])
  const canOnboarding = useAnyPermission([P.HRMS_ONBOARDING_INSTANCE_READ, P.HRMS_ONBOARDING_TASK_COMPLETE, 'hrms.onboarding.asset.read'])
  // /me/salary and /me/payslips also sit behind the payroll module.
  const payroll = useAuthStore((s) => s.tenant?.activeModules.includes('payroll') ?? false)
  const canSalary = usePermission(P.PAYROLL_STRUCTURE_READ_SELF) && payroll
  const canPayslips = usePermission(P.PAYROLL_PAYSLIP_READ_SELF) && payroll
  const canWfh = useAnyPermission(['wfh.request.self', P.HRMS_ESS_READ, P.ATTENDANCE_CHECKIN_SELF])
  const canShift = useAnyPermission([P.HRMS_ESS_READ, P.ATTENDANCE_CHECKIN_SELF])
  const canAssets = usePermission('hrms.onboarding.asset.self')
  // Interviews show up only for people who have been asked to take one.
  const canInterviews = useAnyPermission(['hrms.hiring.interview.self', 'hrms.hiring.read'])
  const interviews = useMyInterviews(canInterviews)
  const interviewCount = interviews.data?.length ?? 0
  const scorecardsDue = (interviews.data ?? []).filter((i) => i.started && i.scorecards.length === 0).length
  const canLetters = usePermission(P.HRMS_LETTERS_READ_SELF)
  const stats = useMonthlyStats()
  const bal = useMyBalances()
  const mine = useMyLeaves(0)
  const recent = (mine.data?.content ?? []).slice(0, 4)
  const pending = (mine.data?.content ?? []).filter((l) => l.status === 'PENDING' || l.status === 'PENDING_L2').length
  const hour = new Date().getHours(), greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const m = stats.data
  const open = () => navigate('/hrms/attendance')

  return (
    <ModulePage crumb="My workspace" title={`${greeting}, ${user?.firstName || 'there'}`} subtitle={today}
      actions={canLeave ? <HrButton onClick={() => navigate('/hrms/leave?tab=apply')}>{dashIcon('plus', 15)} Apply for leave</HrButton> : undefined}>
      <div style={{ display: 'grid', gap: 12 }}>
        <h2 style={{ margin: 0, fontFamily: "'Plus Jakarta Sans',Inter,sans-serif", fontSize: 16, fontWeight: 800 }}>This month</h2>
        {stats.isLoading ? <State kind="loading" height={96} />
          : stats.error ? <State kind="error" title="Couldn’t load this month’s attendance" description="Check your connection and try again." onRetry={() => stats.refetch()} />
            : m ? <StatRow min={150} tiles={[
              { icon: 'checkCircle', color: 'green', label: 'Present', value: String(m.presentDays), sub: 'days with a punch', onClick: open },
              { icon: 'circleX', color: 'red', label: 'Absent', value: String(m.absentDays), sub: 'working days missed', onClick: open },
              { icon: 'clock', color: 'orange', label: 'Late', value: String(m.lateDays), sub: 'after shift start + grace', onClick: open },
              { icon: 'sunrise', color: 'blue', label: 'On time', value: String(m.onTimeDays), sub: 'within your shift', onClick: open },
              { icon: 'target', color: 'teal', label: 'Score', value: `${m.attendanceScore}%`, sub: 'present of working days', onClick: open },
            ]} /> : null}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,380px),1fr))', gap: 16, alignItems: 'start' }}>
        <Panel title="Leave" sub={pending ? `${pending} ${pending === 1 ? 'request is' : 'requests are'} waiting for approval` : 'Your balance this year'}
          aside={canLeave ? <HrButton size="sm" variant="ghost" onClick={() => navigate('/hrms/leave')}>Open leave</HrButton> : undefined}>
          {bal.isLoading ? <State kind="loading" height={80} />
            : bal.error ? <State kind="error" title="Couldn’t load your leave balance" onRetry={() => bal.refetch()} />
              : (bal.data ?? []).length === 0 ? <Note>No leave types have been set up for you yet. Ask HR to add them.</Note>
                : <Facts min={140} items={(bal.data ?? []).slice(0, 6).map((b) => ({ k: b.leaveTypeName, v: `${days(b.available)} left` }))} />}
          {recent.length > 0 && (
            <div style={{ ...CARD, overflow: 'hidden', boxShadow: 'none' }}>
              {recent.map((l) => { const [lab, tone] = LEAVE[l.status] || [l.status, 'gray' as PillTone]; return <Row key={l.id} title={`${l.leaveTypeName || 'Leave'} · ${range(l.startDate, l.endDate)}`} meta={days(Number(l.totalDays))} trail={<HrStatusPill tone={tone}>{lab}</HrStatusPill>} /> })}
            </div>
          )}
        </Panel>
        <div style={{ ...CARD, overflow: 'hidden' }}>
          <div style={{ padding: '18px 20px 12px', display: 'grid', gap: 2, borderBottom: '1px solid #f1f5f9' }}>
            <h3 style={{ margin: 0, fontFamily: "'Plus Jakarta Sans',Inter,sans-serif", fontSize: 16, fontWeight: 700 }}>Requests and records</h3>
            <p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>Things you can ask for or look up yourself</p>
          </div>
            {canWfh && <Shortcut icon="home" title="Work from home" sub="Ask to work from home on some days" cta="Request" onClick={() => navigate('/me/wfh')} />}
            {canShift && <Shortcut icon="swap" title="Shift change" sub="Ask HR to move you to another shift" cta="Request" onClick={() => navigate('/me/shift-change')} />}
            {canPayslips && <Shortcut icon="receipt" title="Payslips" sub="Download your monthly payslips" cta="Open" onClick={() => navigate('/me/payslips')} />}
            {canSalary && <Shortcut icon="rupee" title="Salary" sub="Your salary structure and components" cta="View" onClick={() => navigate('/me/salary')} />}
            {canOnboarding && <Shortcut icon="clipboard" title="Onboarding tasks" sub="Your onboarding checklist" cta="Open" onClick={() => navigate('/hrms/onboarding/instances')} />}
            {canAssets && <Shortcut icon="briefcase" title="My assets" sub="Company equipment handed to you" cta="View" onClick={() => navigate('/me/assets')} />}
            {canInterviews && interviewCount > 0 && <Shortcut icon="calendarClock" title="Interviews" sub={scorecardsDue ? `${scorecardsDue} ${scorecardsDue === 1 ? 'scorecard is' : 'scorecards are'} waiting for you` : `${interviewCount} ${interviewCount === 1 ? 'interview' : 'interviews'} you’re taking`} cta="Open" onClick={() => navigate('/me/interviews')} />}
            {canLetters && <Shortcut icon="fileText" title="Letters" sub="Offer, appointment and other letters HR has issued to you" cta="Open" onClick={() => navigate('/hrms/letters/my')} />}
            <Shortcut icon="userCheck" title="Profile" sub="Your photo, contact details and documents" cta="Open" onClick={() => navigate('/profile')} />
        </div>
      </div>

      <AttendanceHistory />
      <TimeEntries />
    </ModulePage>
  )
}
