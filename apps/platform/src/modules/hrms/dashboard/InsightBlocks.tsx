// People, Hiring & projects, Payroll & activity cards of the admin dashboard (PgDashboard). Each card renders
// only the real data it gets; pieces whose data the backend doesn't send yet are left out (see the report):
// the performers' average rating (BW-114), onboarding department / joining date (BW-115), candidates "this
// quarter" and stage conversion (BW-116 / BW-66), project owner, due date and health (BW-117).
import { useState, type CSSProperties } from 'react'
import { Avatar, Button, EmptyState, Section, SegmentedControl, StatusPill, type StatusTone } from '@/design/kit/display'
import { dashIcon } from '@/design/dc/icons'
import { fmtShort } from '@/design/dc/dates'
import { inr, lakh, monthName, type PayMonth } from './dashboardModel'

type Common = { loading: boolean; error: unknown; onRetry: () => void; style?: CSSProperties }
const bar = (pct: number, tone?: 'gold' | 'red' | 'mint') => (
  <span className={`ud-bar${tone ? ' ud-bar--' + tone : ''}`} aria-hidden="true"><span className="ufx-grow-x" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} /></span>
)

// ── People ───────────────────────────────────────────────────────────────────
/** Everyone on the roll per department: confirmed, on probation and serving notice (the people a bar's click lists). */
export function DeptCard({ rows, sub, onPick, ...c }: Common & { rows: { id: string | null; name: string; people: number }[]; sub: string; onPick: (id: string | null) => void }) {
  const max = Math.max(1, ...rows.map((r) => r.people))
  const sorted = [...rows].sort((a, b) => b.people - a.people)
  return (
    <Section variant="dashboard" level={3} title="Dept distribution" sub={sub} body="list" {...c}
      empty={!rows.length ? { title: 'No records for this period.', icon: 'chart' } : undefined}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '0 4px 8px' }}>
        {sorted.map((d, i) => (
          <button key={d.id ?? 'none'} type="button" className="ud-dept" onClick={() => onPick(d.id)} title={`Filter the directory to ${d.name}`}
            aria-label={`${d.name}: ${d.people} ${d.people === 1 ? 'person' : 'people'}. Filter the directory`}>
            <span className="ud-dept__name">{d.name}</span>
            {bar((d.people / max) * 100, i === 0 ? undefined : 'mint')}
            <span className="ud-dept__n">{d.people}</span>
          </button>
        ))}
      </div>
    </Section>
  )
}

export function PerformersCard({ rows, sub, onOpen, ...c }: Common & { rows: { id: string; name: string; dept: string; rating: number; reviews: number }[]; sub: string; onOpen: () => void }) {
  return (
    <Section variant="dashboard" level={3} title="Top performers" sub={sub} body="list" {...c}
      actions={<Button variant="plain" size={32} trailingIcon="arrowRight" onClick={onOpen}>View</Button>}
      empty={!rows.length ? { title: 'No completed ratings yet.', icon: 'star' } : undefined}>
      <div role="list" aria-label="Top performers">
        {rows.map((m, i) => (
          <div key={m.id} role="listitem" className="ud-att-row">
            <span className="ud-rank">{i + 1}</span>
            <Avatar name={m.name} size={32} />
            <div className="ud-inbox-row__txt">
              <div className="ud-inbox-row__name">{m.name}</div>
              <div className="ud-inbox-row__sub">{m.dept ? `${m.dept} · ` : ''}{m.reviews} completed {m.reviews === 1 ? 'review' : 'reviews'}</div>
            </div>
            <span className="ud-star" aria-label={`Rating ${Number(m.rating).toFixed(1)}`}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M11.52 2.3a.53.53 0 0 1 .95 0l2.31 4.68a2.12 2.12 0 0 0 1.6 1.16l5.16.76a.53.53 0 0 1 .3.9l-3.74 3.64a2.12 2.12 0 0 0-.61 1.88l.88 5.14a.53.53 0 0 1-.77.56l-4.62-2.43a2.12 2.12 0 0 0-1.97 0L6.4 21.01a.53.53 0 0 1-.77-.56l.88-5.14a2.12 2.12 0 0 0-.61-1.88L2.16 9.8a.53.53 0 0 1 .3-.9l5.16-.76a2.12 2.12 0 0 0 1.6-1.16z" /></svg>
              {Number(m.rating).toFixed(1)}
            </span>
          </div>
        ))}
      </div>
    </Section>
  )
}

export function OnboardingCard({ rows, sub, onOpen, onAll, ...c }: Common & { rows: { id: string; name: string; statusLabel: string; completed: number; total: number }[]; sub: string; onOpen: (id: string) => void; onAll: () => void }) {
  return (
    <Section variant="dashboard" level={3} title="Onboarding tracker" sub={sub} body="list" {...c}
      actions={<Button variant="plain" size={32} trailingIcon="arrowRight" onClick={onAll}>View</Button>}
      empty={!rows.length ? { title: 'No onboarding runs in progress.', icon: 'clipboard' } : undefined}>
      <div role="list" aria-label="Onboarding runs">
        {rows.map((o) => (
          <div key={o.id} role="listitem">
            <button type="button" className="ud-onb" onClick={() => onOpen(o.id)}>
              <Avatar name={o.name} size={34} />
              <span className="ud-onb__txt">
                <span className="ud-onb__top"><span className="ud-onb__name">{o.name}</span><span className="ud-onb__prog">{o.completed}/{o.total}</span></span>
                <span className="ud-onb__sub" style={{ display: 'block' }}>{o.statusLabel} · {o.completed} of {o.total} tasks</span>
                {bar(o.total ? (o.completed / o.total) * 100 : 0)}
              </span>
            </button>
          </div>
        ))}
      </div>
    </Section>
  )
}

// ── Hiring & projects ────────────────────────────────────────────────────────
export function PipelineCard({ openJobs, stages, stagesLabel, onOpen, onStage, ...c }: Common & {
  openJobs: number; stages: { stage: string; label: string; count: number }[]; stagesLabel: string; onOpen: () => void; onStage: (stage: string) => void
}) {
  const total = stages.reduce((n, s) => n + s.count, 0)
  const max = Math.max(1, ...stages.map((s) => s.count))
  const empty = !total && !openJobs
  return (
    <Section variant="dashboard" level={3} title="Recruitment & pipeline" sub={`${openJobs} open ${openJobs === 1 ? 'role' : 'roles'} · ${total} ${total === 1 ? 'candidate' : 'candidates'} in the pipeline`}
      actions={<Button variant="plain" size={32} trailingIcon="arrowRight" onClick={onOpen}>Open hiring</Button>}
      body="default" {...c} empty={empty ? { title: 'No candidates recorded.', icon: 'briefcase' } : undefined}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div className="ud-pay__meta" style={{ marginBottom: 2 }}>{stagesLabel}</div>
        {stages.map((g) => (
          <button key={g.stage} type="button" className="ud-stage" onClick={() => onStage(g.stage)} aria-label={`${g.label}: ${g.count}. Open the pipeline at this stage`}>
            <span className="ud-stage__name">{g.label}</span>
            {bar(g.count ? Math.max(3, (g.count / max) * 100) : 0, g.stage === 'HIRED' ? 'gold' : undefined)}
            <span className="ud-stage__n">{g.count}</span>
          </button>
        ))}
      </div>
    </Section>
  )
}

const PROJ_TONE: Record<string, StatusTone> = { ACTIVE: 'brand', COMPLETED: 'mint', CANCELLED: 'muted' }
export function ProjectsCard({ rows, isPast, sel, onManage, ...c }: Common & {
  rows: { id: string; name: string; status: string; total: number; completed: number }[]; isPast: boolean; sel: string; onManage: () => void
}) {
  const active = rows.filter((p) => p.status === 'ACTIVE').length
  return (
    <Section variant="dashboard" level={3} title="Projects & productivity"
      sub={rows.length ? `${active} active ${active === 1 ? 'project' : 'projects'}${isPast ? ` on ${fmtShort(sel)}` : ''}` : 'Nothing in progress'}
      actions={<Button variant="plain" size={32} trailingIcon="arrowRight" onClick={onManage}>Manage projects</Button>}
      body="list" {...c} empty={!rows.length ? { title: 'No projects yet.', icon: 'target' } : undefined}>
      <div role="list" aria-label="Projects">
        {rows.slice(0, 6).map((p) => {
          const pct = p.total ? Math.round((p.completed / p.total) * 100) : 0
          const status = p.status.charAt(0) + p.status.slice(1).toLowerCase()
          return (
            <div key={p.id} role="listitem" className="ud-proj">
              <div className="ud-proj__top">
                <div style={{ minWidth: 0 }}>
                  <div className="ud-proj__name">{p.name}</div>
                  <div className="ud-proj__sub">{p.total ? `${p.completed} of ${p.total} tasks done` : 'No tasks yet'}</div>
                </div>
                <StatusPill tone={PROJ_TONE[p.status] ?? 'neutral'}>{status}</StatusPill>
              </div>
              <div className="ud-proj__bar">{bar(pct)}<span className="ud-proj__pct">{pct}%</span></div>
            </div>
          )
        })}
      </div>
    </Section>
  )
}

// ── Payroll & activity ───────────────────────────────────────────────────────
export function PayrollCard({ months6, months12, range, headline, onBar, ...c }: Common & {
  months6: PayMonth[]; months12: PayMonth[]; range: string
  /** From the dashboard summary: the month's finalized payroll (null = not finalized); undefined when not readable. */
  headline?: { month: string; gross: number | null }
  onBar: (m: PayMonth) => void
}) {
  const [n, setN] = useState<'6' | '12'>('6')
  const ms = n === '6' ? months6 : months12
  const max = Math.max(1, ...ms.map((m) => m.gross))
  const last = ms[ms.length - 1]
  const now = headline ? headline.gross : last ? last.gross : null
  const nowMonth = headline ? headline.month : last?.month
  // The change against the month before the headline month, when both are finalized.
  const all = months12, at = nowMonth ? all.findIndex((m) => m.month === nowMonth) : -1
  const cur = at >= 0 ? all[at] : undefined, prev = at > 0 ? all[at - 1] : undefined
  const delta = now != null && cur?.finalized && prev?.finalized && prev.gross ? ((now - prev.gross) / prev.gross) * 100 : null
  return (
    <Section variant="dashboard" level={3} title="Monthly payroll expense" sub="Gross payroll from locked and paid runs, and runs in review. Amounts in INR." body="flush" {...c}
      actions={<SegmentedControl<'6' | '12'> label="Range" size="sm" value={n} onChange={setN} options={[{ value: '6', label: '6 months' }, { value: '12', label: '12 months' }]} />}
      empty={!ms.length && !headline ? { title: 'No finalized payroll runs.', hint: range ? `${range}. Totals appear here once a pay run is locked.` : 'Totals appear here once a pay run is locked.', icon: 'rupee' } : undefined}>
      <div className="ud-pay">
        <div className="ud-pay__head">
          <span className="ud-pay__now">{now != null ? inr(now) : 'Not finalized'}</span>
          <span className="ud-pay__meta">
            {nowMonth ? `Finalized payroll · ${nowMonth}` : ''}
            {nowMonth && now == null ? ` · ${monthName(nowMonth)} isn’t locked yet` : ''}
            {delta != null && prev ? <> · <b className={delta < 0 ? 'is-down' : ''}>{delta >= 0 ? '↑' : '↓'} {Math.abs(delta).toFixed(1)}%</b> vs {prev!.label}</> : null}
            {last && !last.finalized ? ` · ${monthName(last.month).split(' ')[0]} is in review` : ''}
          </span>
        </div>
        <div className="ud-pay__meta" style={{ marginTop: 2 }}>{range}</div>
        {!ms.length ? (
          <EmptyState icon="rupee" minHeight={200} title="No payroll runs in these months." hint="Totals appear here once a pay run is locked." />
        ) : <>
        <div className="ud-pay__bars" role="group" aria-label="Payroll by month">
          {ms.map((m) => (
            <button key={m.month} type="button" className="ud-pay__col" onClick={() => onBar(m)} title={`${m.title} · ${inr(m.gross)} · ${m.finalized ? 'locked or paid' : 'in review'}`}
              aria-label={`${m.title}: ${inr(m.gross)}, ${m.finalized ? 'locked or paid' : 'in review'}. Open the run`}>
              <span className="ud-pay__v">{lakh(m.gross).slice(1, -1)}</span>
              <span className={`ud-pay__bar ufx-grow-y${m.finalized ? '' : ' ud-pay__bar--rev'}`} style={{ height: `${Math.max(2, Math.round((m.gross / max) * 82))}%` }} />
            </button>
          ))}
        </div>
        <div className="ud-pay__months" aria-hidden="true">{ms.map((m) => <span key={m.month}>{m.label}</span>)}</div>
        <div className="ud-pay__legend"><span><i />Locked or paid</span><span><i className="is-rev" />In review</span><span style={{ marginLeft: 'auto' }}>₹ lakh</span></div>
        </>}
      </div>
    </Section>
  )
}

const ACT_ICON: Record<string, string> = { approve: 'checkCircle', regularize: 'clock', payroll: 'rupee', onboard: 'userPlus', update: 'pencil' }
export function ActivityCard({ rows, title, onAll, onOpen, ...c }: Common & {
  rows: { id: string; type: string; actor: string; action: string; record: string; module: string; rel: string; path: string }[]
  title: string; onAll: () => void; onOpen: (path: string) => void
}) {
  return (
    <Section variant="dashboard" level={3} title={title} sub="Latest changes across the company" body="flush" {...c}
      actions={<Button variant="plain" size={32} trailingIcon="arrowRight" onClick={onAll}>View all</Button>}
      empty={!rows.length ? { title: 'No records for this period.', icon: 'activity' } : undefined}>
      <div className="ud-act" role="list" aria-label="Recent activity">
        {rows.map((a) => (
          <div key={a.id} role="listitem" style={{ display: 'flex' }}><button type="button" className="ud-act__item" onClick={() => onOpen(a.path)}>
            <span className="ud-act__rail"><span className="ud-act__ic" aria-hidden="true">{dashIcon(ACT_ICON[a.type] || 'pencil', 15)}</span><span className="ud-act__line" /></span>
            <span className="ud-act__txt">
              <span className="ud-act__title" style={{ display: 'block' }}>{a.actor} {a.action}{a.record ? ` · ${a.record}` : ''}</span>
              <span className="ud-act__meta" style={{ display: 'block' }}>{a.module ? `${a.module} · ` : ''}{a.rel}</span>
            </span>
          </button></div>
        ))}
      </div>
    </Section>
  )
}
