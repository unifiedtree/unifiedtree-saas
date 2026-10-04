// /hrms/att-analytics — Attendance analytics (P-ATT-PLAN; prototype PgTime a-analytics). The page's own views are
// inline pill tabs (DECISIONS 21): Overview · Punctuality · Calendar, kept in ?tab= with the month in ?month= (a past
// month; this month by default). Everything needs attendance.team.read, as before.
import { useSearchParams } from 'react-router-dom'
import { P, usePermission } from '@unifiedtree/sdk'
import { Button, EmptyState, PageFrame, PageHeader, PillTabs } from '@/design/kit/display'
import { MonthField } from '@/shared/components/calendar'
import { useIsMobile } from '@/design/dc/DesignFrame'
import { istToday } from '@/design/dc/dates'
import { useNavigate } from 'react-router-dom'
import { analyticsMonth, checkInsIn, monthLabel, monthName } from './analyticsModel'
import { useAnalyticsData } from './useAnalyticsData'
import { OverviewView } from './OverviewView'
import { PunctualityView } from './PunctualityView'
import { CalendarView } from './CalendarView'
import './analytics.css'

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'punctuality', label: 'Punctuality' },
  { key: 'calendar', label: 'Calendar' },
] as const
type Tab = typeof TABS[number]['key']

export function AnalyticsPage() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const mobile = useIsMobile()
  const today = istToday()
  const canTeam = usePermission(P.ATTENDANCE_TEAM_READ)
  const companyWide = usePermission('attendance.workforce.admin')
  const m = analyticsMonth(params.get('month'), today)
  const tab: Tab = (TABS.find((t) => t.key === params.get('tab'))?.key ?? 'overview')
  const a = useAnalyticsData(m, today)

  const setTab = (next: string) => {
    const sp = new URLSearchParams(params)
    sp.set('tab', next)
    setParams(sp, { replace: true })
  }
  const setMonth = (ym: string) => {
    const sp = new URLSearchParams(params)
    if (/^\d{4}-\d{2}$/.test(ym) && ym < m.current) sp.set('month', ym); else sp.delete('month')
    setParams(sp, { replace: true })
  }
  const who = companyWide ? 'across the company' : 'across your team'
  const sub = tab === 'punctuality' ? 'Who is often late, and when.'
    : tab === 'calendar' ? 'Each box is one day. Greener means more people came in. Tap a day to see what happened.'
      : m.past ? `How everyone did in ${monthLabel(m.from)}.` : `How ${monthName(m.from)} is going ${who}.`

  if (!canTeam) {
    return (
      <PageFrame label="Attendance analytics">
        <PageHeader eyebrow="Attendance & time" title="Attendance analytics" />
        <EmptyState icon="lock" title="Analytics needs team attendance access" hint="Ask an admin for the permission to see your team’s attendance." />
      </PageFrame>
    )
  }

  return (
    <PageFrame label="Attendance analytics" className="apl-page">
      <PageHeader eyebrow="Attendance & time" title="Attendance analytics" sub={sub}
        actions={(
          <>
            <MonthField value={m.month} max={m.current} onChange={(_e, v) => setMonth(v)} aria-label="Month" align="end" style={{ width: 196 }} />
            <Button variant="secondary" icon="download" onClick={() => navigate(a.data.reportLink)}>Download report</Button>
          </>
        )} />
      <PillTabs label="Analytics views" semantics="tabs" className="apl-tabs" activeKey={tab} onSelect={setTab} items={TABS.map((t) => ({ key: t.key, label: t.label }))} />
      {tab === 'overview' && <OverviewView m={m} today={today} a={a} mobile={mobile} onCalendar={() => setTab('calendar')} />}
      {tab === 'punctuality' && <PunctualityView m={m} checkIns={checkInsIn(m, a.byDept.data?.overall.attendedDays, a.data.daily)} />}
      {tab === 'calendar' && <CalendarView m={m} today={today} a={a} mobile={mobile} />}
    </PageFrame>
  )
}
