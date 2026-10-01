// The admin dashboard page (PgDashboard.dc.html, default layout: the section pills and the quick-action tile
// row), composed from the redesign kit and tokens. Data and actions come from AdminDashboardContainer; this file
// only lays them out, in the design's order:
//   Overview (greeting, date chip, stat cards, quick actions, seats, Needs your action + Today's attendance),
//   Attendance (weekly trend), Upcoming (Upcoming events: notices, holidays, birthdays, anniversaries and
//   retirements; probation), People, Hiring & projects, Payroll & activity. A section the viewer has no
//   permission for is hidden, and so is its pill.
// The section pills are the page's own sub-sections, so they sit in the page under the top bar (which shows the
// module's pages, DECISIONS 21) and stay in view while the page scrolls. Release 1.1 made the page about 10%
// tighter (the client: it felt too spacious): the same content and order, with less space (dashboard.css).
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import {
  Button, PageFrame, PageHeader, PillTabs, QuickActionGrid, QuickActionTile, SectionHeading, StatCard, type QuickIconKind,
} from '@/design/kit/display'
import { SidePanel } from '@/design/kit/overlays'
import { MilestonesCard } from '@/design/dc/MilestonesCard'
import { fmtShort } from '@/design/dc/dates'
import type { DayBuckets } from '../attendance/attendanceBuckets'
import type { StaffStatusResponse } from '../api/useAttendance'
import type { UpcomingProbation } from '../api/useProbation'
import { NeedsAction, type Inbox } from './NeedsAction'
import { DateChipButton, PastBanner, SeatsStrip, TodayAttendance } from './OverviewBlocks'
import { TrendCard } from './TrendCard'
import { NoticesStrip, type NoticeVm } from './NoticesStrip'
import { ProbationCard } from './ProbationCard'
import { ActivityCard, DeptCard, OnboardingCard, PayrollCard, PerformersCard, PipelineCard, ProjectsCard } from './InsightBlocks'
import { ProjectProductivity } from './ProjectProductivity'
import { sectionPills, type DashSection, type PayMonth, type TrendColumn } from './dashboardModel'
import { useSectionSpy } from './useSectionSpy'
import './dashboard.css'

type Series = readonly number[] | null
export interface DashboardVm {
  today: string; sel: string; isPast: boolean
  greeting: string
  greetSub: { inN: number | null; sched: number | null; needN: number; past: string | null }
  emptyWorkspace: boolean
  sections: Record<DashSection, boolean>
  daily: Record<string, DayBuckets>; holidays: { date: string; name: string }[]
  counts: DayBuckets; staff: StaffStatusResponse[]; liveLoading: boolean; liveError: unknown
  stats: {
    showTotal: boolean; showAtt: boolean; total: number; totalNote: string; presentNote: string; leaveNote: string; lateNote: string
    spark: { present: Series; leave: Series; late: Series; half: Series; wfh: Series; none: Series; absent: Series }; sparkDot?: number
  }
  quick: { key: string; label: string; path: string; hint: string; kind?: QuickIconKind }[]
  seats: { used: number; total: number } | null
  addEmployee: { disabledReason: string | null } | null
  canExport: boolean; exporting: boolean; exportName: string
  inbox: Inbox; canAtt: boolean; canFix: boolean; canLeave: boolean; canWfh: boolean
  trendCols: TrendColumn[]; trendLoading: boolean; trendError: unknown
  showNotices: boolean; notices: NoticeVm[]; noticeTotal: number; noticesLoading: boolean; noticesError: boolean; noticePage: number; noticePages: number; canManageNotices: boolean
  compliance: { due: number; done: number } | null
  companyId?: string; canReadEmployees: boolean
  /** The Upcoming events holidays list's "View all" (the Leave page's Holidays view), when the viewer can open it. */
  holidaysHref: string | null
  showProbations: boolean; probations: UpcomingProbation[]; probationsLoading: boolean; probationsError: unknown; canDecideProbation: boolean; canProbationConfig: boolean
  showDept: boolean; showPerformers: boolean; showOnboarding: boolean
  departments: { id: string | null; name: string; active: number }[]; deptLoading: boolean; deptError: unknown
  performers: { id: string; name: string; dept: string; rating: number; reviews: number }[]; performersLoading: boolean; performersError: unknown
  onboarding: { id: string; name: string; status: string; statusLabel: string; completed: number; total: number }[]; onboardingLoading: boolean; onboardingError: unknown
  showHiring: boolean; showProjects: boolean
  hiring: { openJobs: number; stages: { stage: string; label: string; count: number }[] }; hiringLoading: boolean; hiringError: unknown
  projects: { id: string; name: string; status: string; total: number; completed: number }[]; projectsLoading: boolean; projectsError: unknown
  showPayroll: boolean; showActivity: boolean
  months6: PayMonth[]; months12: PayMonth[]; payRange: string; payHeadline?: { month: string; gross: number | null }; payLoading: boolean; payError: unknown
  activity: { id: string; type: string; actor: string; action: string; record: string; module: string; rel: string; path: string }[]; activityLoading: boolean; activityError: unknown
}

export interface DashboardPageProps {
  vm: DashboardVm
  refetch: Record<'live' | 'trend' | 'notices' | 'probations' | 'dept' | 'performers' | 'onboarding' | 'hiring' | 'projects' | 'payroll' | 'activity', () => void>
  onNavigate: (path: string) => void
  onDate: (iso: string | null) => void
  onExport: () => void
  onNoticePage: (p: number) => void
  onSaveNotice: (n: { id?: string | null; title: string; body: string; expiry: string | null }) => Promise<boolean>
  onArchiveNotice: (id: string) => Promise<void>
  projectsOpen: boolean
  onProjects: (open: boolean) => void
}

const flex = (grow: number, basis: number): CSSProperties => ({ flex: `${grow} 1 ${basis}px`, minWidth: 0 })

/** Whether the sticky element has left its place (it is stuck under the top bar): it then gets its edge. */
function useStuck() {
  const sentinel = useRef<HTMLSpanElement>(null)
  const [stuck, setStuck] = useState(false)
  useEffect(() => {
    const el = sentinel.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([e]) => setStuck(!e.isIntersecting), { root: el.closest('#workspace-content'), threshold: 0 })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return { sentinel, stuck }
}

export function DashboardPage({ vm, refetch, onNavigate: go, onDate, onExport, onNoticePage, onSaveNotice, onArchiveNotice, projectsOpen, onProjects }: DashboardPageProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const pills = sectionPills(vm.sections)
  const ready = !vm.liveLoading && !vm.noticesLoading
  const { active, jump } = useSectionSpy(rootRef, pills.map((p) => p.key), ready)
  const { sentinel, stuck } = useStuck()
  const { sel, isPast, counts: c, stats: s } = vm
  const isToday = !isPast
  const day = isToday ? 'today' : `on ${fmtShort(sel).slice(0, -5)}`
  const att = (status: string) => `/hrms/attendance?tab=team&status=${status}&date=${sel}`
  const liveDisabled = !!vm.liveError

  // ── greeting line ──
  const g = vm.greetSub
  const greetSub = vm.emptyWorkspace
    ? 'Your workspace is ready. Add your first employees to see today’s numbers.'
    : (
      <span className="ud-greet-sub">
        {g.inN != null && g.sched != null
          ? g.sched === 0
            ? <>Nobody is scheduled {isToday ? 'today' : `on ${g.past}`}, and </>
            : <><b>{g.inN} of {g.sched}</b> {isToday ? 'people are in' : `people were in on ${g.past}`}, and </>
          : null}
        {g.inN != null
          ? <><b>{g.needN} {g.needN === 1 ? 'thing' : 'things'}</b> {isToday ? (g.needN === 1 ? 'needs you today.' : 'need you today.') : 'were waiting that day.'}</>
          : <>{g.needN ? <><b>{g.needN} {g.needN === 1 ? 'thing' : 'things'}</b> {isToday ? 'need you today.' : 'were waiting that day.'}</> : isToday ? 'Nothing needs you right now.' : 'Here’s how that day looked.'}</>}
      </span>
    )

  const statCard = (props: Parameters<typeof StatCard>[0]) => <StatCard key={props.label} {...props} loading={vm.liveLoading} />
  const cards = [
    s.showTotal && statCard({ label: 'Total employees', aniIcon: 'users', accent: 'people', value: liveDisabled ? null : s.total, note: s.totalNote, onClick: () => go('/hrms/employees') }),
    s.showAtt && statCard({ label: 'Present', aniIcon: 'present', accent: 'present', value: liveDisabled ? null : c.present, note: s.presentNote, spark: s.spark.present, sparkDot: s.sparkDot, sparkLabel: `Present over the last ${s.spark.present?.length ?? 0} working days`, onClick: () => go(att('PRESENT')) }),
    s.showAtt && statCard({ label: 'On leave', aniIcon: 'leave', accent: 'leave', value: liveDisabled ? null : c.onLeave, note: s.leaveNote, spark: s.spark.leave, sparkDot: s.sparkDot, onClick: () => go(att('ON_LEAVE')) }),
    s.showAtt && statCard({ label: 'Late arrivals', aniIcon: 'late', accent: 'late', value: liveDisabled ? null : c.late, note: s.lateNote, spark: s.spark.late, sparkDot: s.sparkDot, onClick: () => go(att('LATE')) }),
    s.showAtt && statCard({ label: 'Half day', aniIcon: 'half', accent: 'half', value: liveDisabled ? null : c.halfDay, note: `${c.total ? Math.round((c.halfDay / c.total) * 100) : 0}% of roster`, spark: s.spark.half, sparkDot: s.sparkDot, onClick: () => go(att('HALF_DAY')) }),
    s.showAtt && statCard({ label: 'Work from home', aniIcon: 'wfh', accent: 'wfh', value: liveDisabled ? null : c.wfh, note: `${c.total ? Math.round((c.wfh / c.total) * 100) : 0}% of roster`, spark: s.spark.wfh, sparkDot: s.sparkDot, onClick: () => go(att('WORK_FROM_HOME')) }),
    s.showAtt && statCard({ label: 'Not marked', aniIcon: 'none', accent: 'none', value: liveDisabled ? null : c.notMarked, note: 'No punch recorded', spark: s.spark.none, sparkDot: s.sparkDot, onClick: () => go(att('NOT_MARKED')) }),
    s.showAtt && statCard({ label: 'Absence', aniIcon: 'absent', accent: 'absent', value: liveDisabled ? null : c.absent, note: 'Unplanned, no leave', spark: s.spark.absent, sparkDot: s.sparkDot, onClick: () => go(att('ABSENT')) }),
  ].filter(Boolean) as JSX.Element[]
  const pairs: JSX.Element[][] = []
  for (let i = 0; i < cards.length; i += 2) pairs.push(cards.slice(i, i + 2))

  const showInbox = vm.canAtt || vm.canFix || vm.canLeave
  const showPeople = vm.sections.people, showHire = vm.sections.hiring, showPay = vm.sections.payroll

  return (
    <div ref={rootRef}>
      <PageFrame gap={34} top={14} className="ud-page" label="Dashboard">
        {pills.length > 1 && (
          <>
            <span ref={sentinel} className="ud-secnav__mark" aria-hidden="true" />
            <div className="ud-secnav" data-dash-nav data-stuck={stuck ? '' : undefined}>
              <PillTabs label="Dashboard sections" semantics="nav" current="location" className="ud-secnav__bar"
                items={pills.map((p) => ({ key: p.key, label: p.label, icon: p.icon }))} activeKey={active}
                onSelect={(k) => jump(k as DashSection)} />
            </div>
          </>
        )}
        {/* ── Overview ─────────────────────────────────────────────────── */}
        <section data-sec="overview" aria-label="Overview" className="ud-group">
          <PageHeader size="greeting" wave title={vm.greeting} sub={greetSub}
            actions={<>
              <DateChipButton sel={sel} today={vm.today} daily={vm.daily} holidays={vm.holidays} onApply={onDate}
                onOpenTracking={(iso) => go(`/hrms/attendance?tab=team&date=${iso}`)} />
              {vm.canExport && <Button variant="secondary" size={46} icon="download" onClick={onExport} loading={vm.exporting} title={`Downloads ${vm.exportName}`}>{vm.exporting ? 'Preparing…' : 'Export headcount'}</Button>}
              {vm.addEmployee && <Button variant="primary" size={46} icon="userPlus" disabled={!!vm.addEmployee.disabledReason} title={vm.addEmployee.disabledReason ?? undefined}
                onClick={() => go('/hrms/employees?add=1')}>Add employee</Button>}
            </>} />
          {isPast && !liveDisabled && <PastBanner sel={sel} onBack={() => onDate(null)} />}
          {liveDisabled && (
            <div className="ud-past" role="alert"><span className="ud-past__txt">Couldn’t load {day}’s attendance.</span><Button size={32} onClick={refetch.live}>Try again</Button></div>
          )}
          {pairs.length > 0 && (
            <div className="ud-stats" role="group" aria-label={isToday ? 'Today at a glance' : `${fmtShort(sel)} at a glance`}>
              {pairs.map((p, i) => <div key={i} className="ud-pair">{p}</div>)}
            </div>
          )}
          {vm.quick.length > 0 && (
            <section aria-label="Quick actions" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <SectionHeading title="Quick actions" level={2} />
              <QuickActionGrid>
                {vm.quick.map((q, i) => (
                  <QuickActionTile key={q.key} index={i} label={q.label} hint={q.hint} kind={q.kind} icon={q.kind ? undefined : 'building'} onClick={() => go(q.path)} />
                ))}
              </QuickActionGrid>
            </section>
          )}
          {vm.seats && <SeatsStrip used={vm.seats.used} total={vm.seats.total} isPast={isPast} onAdd={() => go('/settings/billing')} />}
          {(showInbox || vm.canAtt) && (
            <div className="ud-row">
              {showInbox && (
                <NeedsAction inbox={vm.inbox} isPast={isPast} sel={sel} canAtt={vm.canAtt} canFix={vm.canFix} canLeave={vm.canLeave} canWfh={vm.canWfh}
                  staff={vm.staff} staffLoading={vm.liveLoading} onNavigate={go} style={flex(7, 460)} />
              )}
              {vm.canAtt && (
                <TodayAttendance staff={vm.staff} counts={c} sel={sel} isToday={isToday} loading={vm.liveLoading} error={vm.liveError}
                  onRetry={refetch.live} onOpen={() => go(`/hrms/attendance?tab=team&date=${sel}`)} style={flex(5, 360)} />
              )}
            </div>
          )}
        </section>

        {/* ── Attendance ───────────────────────────────────────────────── */}
        {vm.sections.attendance && (
          <section data-sec="attendance" aria-label="Attendance" className="ud-group ud-group--sec">
            <SectionHeading title="Attendance" sub="How the week went, day by day" icon="clock"
              actions={<Button variant="plain" size={32} trailingIcon="arrowRight" onClick={() => go(`/hrms/attendance?tab=team&date=${sel}`)}>View attendance</Button>} />
            <TrendCard cols={vm.trendCols} sel={sel} isToday={isToday} loading={vm.trendLoading} error={vm.trendError} onRetry={refetch.trend}
              onPick={(iso) => onDate(iso === vm.today ? null : iso)} />
          </section>
        )}

        {/* ── Upcoming ─────────────────────────────────────────────────── */}
        <section data-sec="upcoming" aria-label="Upcoming" className="ud-group ud-group--sec">
          <SectionHeading title="Upcoming" sub="Events, notices and probation reviews" icon="calendar"
            actions={vm.compliance ? (
              <button type="button" className="ud-compliance" style={{ border: 0, background: 'transparent', cursor: 'pointer', font: 'inherit' }} onClick={() => go('/hrms/compliance')}>
                {vm.compliance.due
                  ? <>Compliance {isToday ? 'this month' : `through ${fmtShort(sel)}`}: <b>{vm.compliance.done} of {vm.compliance.due}</b> done</>
                  : <>Compliance: nothing due {isToday ? 'this month' : `this month through ${fmtShort(sel)}`}</>}
              </button>
            ) : undefined} />
          {/* Upcoming events: the company's notices on top, then holidays, birthdays, work anniversaries and retirements. */}
          <MilestonesCard today={vm.today} companyId={vm.companyId} canReadEmployees={vm.canReadEmployees} holidaysHref={vm.holidaysHref} onNavigate={go}
            top={vm.showNotices ? (
              <NoticesStrip notices={vm.notices} total={vm.noticeTotal} page={vm.noticePage} pages={vm.noticePages} isPast={isPast} sel={sel} today={vm.today}
                canManage={vm.canManageNotices} loading={vm.noticesLoading} error={vm.noticesError} onRetry={refetch.notices} onPage={onNoticePage}
                onSave={onSaveNotice} onArchive={onArchiveNotice} />
            ) : undefined} />
          {vm.showProbations && (
            <ProbationCard rows={vm.probations} isPast={isPast} sel={sel} canDecide={vm.canDecideProbation} canReadConfig={vm.canProbationConfig}
              loading={vm.probationsLoading} error={vm.probationsError} onRetry={refetch.probations} onNavigate={go} />
          )}
        </section>

        {/* ── People ───────────────────────────────────────────────────── */}
        {showPeople && (
          <section data-sec="people" aria-label="People" className="ud-group ud-group--sec">
            <SectionHeading title="People" sub="Headcount, performance and onboarding" icon="users"
              actions={vm.canReadEmployees ? <Button variant="plain" size={32} trailingIcon="arrowRight" onClick={() => go('/hrms/employees')}>Open directory</Button> : undefined} />
            <div className="ud-grid3">
              {vm.showDept && <DeptCard rows={vm.departments} loading={vm.deptLoading} error={vm.deptError} onRetry={refetch.dept}
                sub={isToday ? 'Active employees by department. Click a bar to filter the directory.' : `Active employees by department on ${fmtShort(sel)}. Click a bar to filter the directory.`}
                onPick={(id) => go(`/hrms/employees?departmentId=${encodeURIComponent(id || 'none')}`)} />}
              {vm.showPerformers && <PerformersCard rows={vm.performers} loading={vm.performersLoading} error={vm.performersError} onRetry={refetch.performers}
                sub={isToday ? 'Average rating across submitted reviews.' : `Average rating across reviews submitted by ${fmtShort(sel)}.`} onOpen={() => go('/hrms/performance')} />}
              {vm.showOnboarding && <OnboardingCard rows={vm.onboarding} loading={vm.onboardingLoading} error={vm.onboardingError} onRetry={refetch.onboarding}
                sub={isToday ? 'Runs in progress · tasks completed.' : `Runs in progress on ${fmtShort(sel)} · tasks completed by then.`}
                onOpen={(id) => go(`/hrms/onboarding/instances/${id}`)} onAll={() => go('/hrms/onboarding/instances')} />}
            </div>
          </section>
        )}

        {/* ── Hiring & projects ────────────────────────────────────────── */}
        {showHire && (
          <section data-sec="hiring" aria-label="Hiring and projects" className="ud-group ud-group--sec">
            <SectionHeading title="Hiring & projects" sub="Pipeline and delivery at a glance" icon="briefcase" />
            <div className="ud-row">
              {vm.showHiring && <PipelineCard openJobs={vm.hiring.openJobs} stages={vm.hiring.stages} loading={vm.hiringLoading} error={vm.hiringError} onRetry={refetch.hiring}
                stagesLabel={isToday ? 'Candidates by current stage' : `Applied by ${fmtShort(sel)} · current stage`}
                onOpen={() => go('/hrms/hiring')} onStage={(stage) => go(`/hrms/hiring?tab=pipeline&role=all&stage=${stage}${vm.companyId ? `&company=${vm.companyId}` : ''}`)} style={flex(7, 460)} />}
              {vm.showProjects && <ProjectsCard rows={vm.projects} isPast={isPast} sel={sel} loading={vm.projectsLoading} error={vm.projectsError} onRetry={refetch.projects}
                onManage={() => onProjects(true)} style={flex(5, 360)} />}
            </div>
          </section>
        )}

        {/* ── Payroll & activity ───────────────────────────────────────── */}
        {showPay && (
          <section data-sec="payroll" aria-label="Payroll and activity" className="ud-group ud-group--sec">
            <SectionHeading title="Payroll & activity" sub="Monthly spend and what changed recently" icon="rupee"
              actions={vm.showPayroll ? <Button variant="plain" size={32} trailingIcon="arrowRight" onClick={() => go('/hrms/payroll-dashboard')}>Open payroll</Button> : undefined} />
            <div className="ud-row">
              {vm.showPayroll && <PayrollCard months6={vm.months6} months12={vm.months12} range={vm.payRange} headline={vm.payHeadline}
                loading={vm.payLoading} error={vm.payError} onRetry={refetch.payroll} onBar={(m) => go(m.path)} style={flex(7, 460)} />}
              {vm.showActivity && <ActivityCard rows={vm.activity} title={isToday ? 'Live activity feed' : `Activity up to ${fmtShort(sel)}`}
                loading={vm.activityLoading} error={vm.activityError} onRetry={refetch.activity} onAll={() => go('/audit-logs')} onOpen={(p) => go(p)} style={flex(5, 360)} />}
            </div>
          </section>
        )}
      </PageFrame>

      <SidePanel open={projectsOpen && !!vm.companyId} onClose={() => onProjects(false)} title="Projects & Productivity" width={640}>
        {/* The card shows the chosen day; this list is where projects are managed, so it is always today's. */}
        {isPast && (
          <p role="note" className="ud-past" style={{ marginBottom: 16 }}>
            <span className="ud-past__txt"><strong>As of today.</strong> The dashboard card shows {fmtShort(sel)}; the projects and tasks here are today’s, and changes apply today.</span>
          </p>
        )}
        {vm.companyId && <ProjectProductivity companyId={vm.companyId} />}
      </SidePanel>
    </div>
  )
}

