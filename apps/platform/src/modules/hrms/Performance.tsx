// Performance (/hrms/performance) on the redesign kit (P-GROW; prototype PgGrow p-center, and
// EmpGrowth e-rev for the two "My" views). The page's own views are inline pills under the
// header (DECISIONS 21), kept in ?view= with today's keys, names and order:
//   - hrms.performance.read: Review cycles, Employee reviews, Goals & KPIs, People.
//     Managers (no performance.write) see their team only; the API scopes every list.
//   - hrms.performance.review.self: My reviews (my cycle, my self-review, kind words,
//     reviews I write, feedback about me) and My goals.
// Someone with only the self views gets the employee page ("Reviews and goals").
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { usePermission } from '@unifiedtree/sdk'
import { useRoles } from '@/shared/hooks/useRoles'
import { Button, EmptyState, PageFrame, PageHeader, PillTabs } from '@/design/kit/display'
import { CyclesView } from './performance/CyclesView'
import { ReviewsView } from './performance/ReviewsView'
import { KpisView } from './performance/KpisView'
import { PeopleView } from './performance/PeopleView'
import { MyReviewsView } from './performance/MyReviewsView'
import { MyGoalsView } from './performance/MyGoalsView'
import './performance/grow.css'

type View = 'cycles' | 'reviews' | 'kpis' | 'people' | 'my-reviews' | 'my-goals'

const SUBS: Record<View, string> = {
  cycles: 'Run review cycles, read feedback and track company goals.',
  reviews: 'Every review in the current cycle, and where each one stands.',
  kpis: 'Company KPIs and the goals people are working towards.',
  people: 'Your team, their latest rating and last review.',
  'my-reviews': 'Reviews you need to write, and the feedback about you.',
  'my-goals': 'The goals you’re working towards.',
}

export const Performance = () => {
  // Owners and admins don't get My reviews / My goals (the rule My work, Leave and Attendance use).
  const { isAdmin } = useRoles()
  const canSelf = usePermission('hrms.performance.review.self') && !isAdmin
  const canRead = usePermission('hrms.performance.read')
  const canWrite = usePermission('hrms.performance.write')
  const canManageKpi = usePermission('hrms.kpi.manage')
  const [params, setParams] = useSearchParams()
  const views: { key: View; label: string }[] = [
    ...(canRead ? [
      { key: 'cycles' as const, label: 'Review cycles' },
      { key: 'reviews' as const, label: 'Employee reviews' },
      { key: 'kpis' as const, label: 'Goals & KPIs' },
      { key: 'people' as const, label: 'People' },
    ] : []),
    ...(canSelf ? [{ key: 'my-reviews' as const, label: 'My reviews' }, { key: 'my-goals' as const, label: 'My goals' }] : []),
  ]
  const view: View | undefined = views.find((v) => v.key === params.get('view'))?.key ?? views[0]?.key
  // A counter per "new" action: the view opens its panel when it changes (the button lives in the header).
  const [adding, setAdding] = useState<{ view: View; n: number } | null>(null)
  const addKey = (v: View) => (adding?.view === v ? adding.n : 0)
  const add = (v: View) => setAdding((a) => ({ view: v, n: (a?.n ?? 0) + 1 }))
  const setView = (next: string) => {
    const sp = new URLSearchParams(params)
    sp.set('view', next)
    setParams(sp, { replace: true })
  }
  const selfOnly = !canRead && canSelf
  const action = view === 'cycles' && canWrite ? <Button variant="primary" icon="plus" onClick={() => add('cycles')}>New cycle</Button>
    : view === 'kpis' && canManageKpi ? <Button variant="primary" icon="plus" onClick={() => add('kpis')}>Add goal</Button>
      : view === 'my-goals' ? <Button variant="primary" icon="plus" onClick={() => add('my-goals')}>Add a goal</Button>
        : undefined

  if (!view) {
    return (
      <PageFrame label="Performance">
        <PageHeader eyebrow="Performance" title="Performance" />
        <EmptyState icon="lock" title="No performance access" hint="Ask an admin if you should see reviews or goals." />
      </PageFrame>
    )
  }
  return (
    <PageFrame label="Performance" className="grw-page">
      <PageHeader eyebrow={selfOnly ? undefined : 'Performance'} title={selfOnly ? 'Reviews and goals' : 'Performance'}
        sub={selfOnly && view === 'my-reviews' ? 'Where your review cycle stands, and how your goals are going.' : SUBS[view]} actions={action} />
      {views.length > 1 && (
        <PillTabs label="Performance views" semantics="toggle" activeKey={view} onSelect={setView}
          items={views.map((v) => ({ key: v.key, label: v.label }))} />
      )}
      {view === 'cycles' && <CyclesView addKey={addKey('cycles')} />}
      {view === 'reviews' && <ReviewsView />}
      {view === 'kpis' && <KpisView addKey={addKey('kpis')} />}
      {view === 'people' && <PeopleView />}
      {view === 'my-reviews' && <MyReviewsView />}
      {view === 'my-goals' && <MyGoalsView addKey={addKey('my-goals')} />}
    </PageFrame>
  )
}
