// Attendance analytics · Overview (prototype PgTime a-analytics tab 0, plus today's blocks the page already had;
// AUDIT C12: the design's four figures and the department and branch bars on top, today's blocks restyled below).
import { Fragment, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  BarList, Card, CellPerson, EmptyState, ErrorState, MiniStat, MiniStatGrid, Section, SectionLink, SkeletonStats, StatCard, Table,
  type TableColumn,
} from '@/design/kit/display'
import { Input } from '@/design/kit/overlays'
import { MON, MONTHS, WDL, dt } from '@/design/dc/dates'
import { arrivalNote, barTone, dur, monthLabel, monthName, pct, rateDelta, trendChart } from './analyticsModel'
import type { useAnalyticsData } from './useAnalyticsData'
import type { InsightGroup } from '../../api/useAttendanceInsights'

type Analytics = ReturnType<typeof useAnalyticsData>
interface Props {
  m: { month: string; past: boolean; from: string; to: string }
  today: string
  a: Analytics
  mobile: boolean
  onCalendar: () => void
}

/** Today's (or the past month's) mix: one row per bucket, in the order the page has always used. */
const MIX: [string, keyof Mixable, string, string][] = [
  ['On time', 'regular', 'var(--u-success-2,#1F9D6E)', ''], ['Late', 'late', 'var(--u-warning,#C8912E)', 'LATE'],
  ['Half day', 'halfDay', 'var(--u-holiday,#8B4FE0)', ''], ['Working from home', 'wfh', 'var(--u-info,#2585C7)', 'WFH'],
  ['On leave', 'onLeave', 'var(--u-leave,#E0661B)', 'ON_LEAVE'], ['Absent', 'absent', 'var(--u-danger,#D9352B)', 'ABSENT'],
  ['Not marked yet', 'notMarked', 'var(--u-ink3,#6A7A73)', 'NOT_MARKED'], ['Day off', 'other', 'var(--u-gy,#C9D2CE)', ''],
]
interface Mixable { regular: number; late: number; halfDay: number; wfh: number; onLeave: number; absent: number; notMarked: number; other: number }

export function OverviewView({ m, today, a, mobile, onCalendar }: Props) {
  const navigate = useNavigate()
  const d = a.data
  const openLogs = (status: string, date?: string) => navigate(`/hrms/attendance?tab=team${status ? '&status=' + status : ''}${date ? '&date=' + date : ''}`)
  const prevName = monthName(`${m.from.slice(0, 4)}-${String(((Number(m.from.slice(5, 7)) + 10) % 12) + 1).padStart(2, '0')}-01`)
  const overall = a.byDept.data?.overall, previous = a.byDept.data?.previous

  return (
    <>
      {/* The design's month figures and bars (BW-20). A server without the breakdown leaves them out. */}
      {!a.byDept.notAvailable && (
        <Section title={m.past ? `${monthLabel(m.from)} overall` : `${monthName(m.from)} so far`} id="ov-figures"
          loading={a.byDept.isLoading} skeleton="stats" error={a.byDept.error} onRetry={() => a.byDept.refetch()}>
          {overall && (
            <MiniStatGrid>
              <MiniStat label="Attendance rate" tone="success" countUp={false} value={pct(overall.ratePct)}
                note={rateDelta(overall.ratePct, previous?.ratePct, prevName)?.text ?? (overall.ratePct == null ? 'No working days yet' : `Nothing to compare in ${prevName}`)} />
              <MiniStat label="Avg arrival" tone={overall.avgArrivalMinutes != null && overall.avgArrivalMinutes > 0 ? 'warning' : 'success'} countUp={false}
                value={overall.avgArrivalTime} note={arrivalNote(overall.avgArrivalMinutes) ?? 'No check-ins against a shift yet'} />
              <MiniStat label="Late marks" tone="warning" value={overall.lateDays} countUp={false}
                note={`Across ${d.workingDays} working ${d.workingDays === 1 ? 'day' : 'days'}`} />
              <MiniStat label="Unplanned absence" tone="danger" countUp={false} value={pct(overall.unplannedAbsencePct)}
                note={`${overall.absentDays} ${overall.absentDays === 1 ? 'day' : 'days'} with no punch and no leave`} />
            </MiniStatGrid>
          )}
        </Section>
      )}
      {!a.byDept.notAvailable && (
        <div className="apl-row">
          <GroupBars title="Attendance by department" q={a.byDept} none="No department" />
          <GroupBars title="Attendance by branch" q={a.byBranch} none="No branch" />
        </div>
      )}

      {a.error ? (
        <Card><ErrorState title="Couldn’t load attendance" error={a.error} onRetry={a.retry} /></Card>
      ) : a.loading ? (
        <SkeletonStats />
      ) : !d.counts ? (
        <Card><EmptyState icon="chart" title="No attendance yet this month" hint="These charts fill in as soon as people start checking in." /></Card>
      ) : (
        <>
          <TodayBlock m={m} today={today} a={a} onOpenLogs={openLogs} onCalendar={onCalendar} />
          <MonthBlock m={m} today={today} a={a} mobile={mobile} onOpenLogs={openLogs} />
        </>
      )}
    </>
  )
}

function GroupBars({ title, q, none }: { title: string; q: Analytics['byDept']; none: string }) {
  const groups: InsightGroup[] = q.data?.groups ?? []
  const shown = groups.filter((g) => g.current.ratePct != null)
  return (
    <Section title={title} className="apl-half" loading={q.isLoading} skeleton="list" error={q.error} onRetry={() => q.refetch()}
      empty={!q.isLoading && !q.error && shown.length === 0 ? { title: 'No attendance yet', hint: 'The bars fill in as people check in.' } : false}>
      <BarList label={title} labelWidth="34%" items={shown.map((g) => ({
        key: g.id ?? 'none', label: g.name ?? none, value: `${Math.round(g.current.ratePct!)}%`, pct: g.current.ratePct!, tone: barTone(g.current.ratePct),
        title: `${g.name ?? none}: ${g.current.attendedDays} of ${g.current.attendedDays + g.current.absentDays + g.current.notMarkedDays} expected days came in (${g.people} ${g.people === 1 ? 'person' : 'people'})`,
      }))} />
    </Section>
  )
}

function TodayBlock({ m, today, a, onOpenLogs, onCalendar }: { m: Props['m']; today: string; a: Analytics; onOpenLogs: (s: string, d?: string) => void; onCalendar: () => void }) {
  const d = a.data, c = d.counts as Mixable & { total: number; present: number }
  const past = m.past
  const expected = (c.present || 0) + (c.absent || 0) + (c.notMarked || 0), rate = expected ? Math.round((c.present / expected) * 100) : 0
  const grace = d.graceMin != null ? `After the ${d.graceMin}-min grace time` : 'After each shift’s grace time'
  const td = dt(today), name = monthLabel(m.from)
  const tile = (label: string, accent: string, icon: string, value: number, note: string, status: string) => (
    <StatCard key={label} label={label} value={value ?? 0} note={note} icon={icon} accent={accent} countUp={false}
      ariaLabel={undefined} onClick={() => (past ? onCalendar() : onOpenLogs(status))} />
  )
  const total = c.total || 0, T = total || 1
  const mix = MIX.map(([label, key, color, status]) => ({ label, n: (c as unknown as Record<string, number>)[key] || 0, color, status }))
  const C = 2 * Math.PI * 64
  let acc = 0
  const arcs = mix.map((x) => { const len = (x.n / T) * C; const arc = { ...x, dash: `${Math.max(0, len - 2).toFixed(2)} ${C.toFixed(2)}`, off: (-acc).toFixed(2) }; acc += len; return arc })
  const srcTotal = d.sources.reduce((n, s) => n + s.n, 0)
  const srcLine = d.sourcesLoading ? 'Loading…'
    : d.sourcesMissing ? `Couldn’t load how people checked in ${past ? 'in ' + monthName(m.from) : 'this month'}.`
      : `${srcTotal} ${srcTotal === 1 ? 'check-in' : 'check-ins'} ${past ? 'in ' + monthName(m.from) : 'today'}, by the way they punched`
  return (
    <section aria-labelledby="ov-today" className="apl-block">
      <div className="apl-block__head">
        <h2 id="ov-today">{past ? 'Month in total' : 'Today'}</h2>
        <span className="apl-chip">{past ? name : `${WDL[td.getDay()]}, ${td.getDate()} ${MON[td.getMonth()]}`}</span>
      </div>
      <div role="group" aria-label={past ? `${name} in numbers` : 'Today’s numbers'} className="apl-tiles">
        {tile('Came in', 'present', 'userCheck', c.present, `${rate}% of ${past ? 'expected days' : 'people expected'}`, 'PRESENT')}
        {tile('Late', 'late', 'clock', c.late, grace, 'LATE')}
        {tile('On leave', 'leave', 'userMinus', c.onLeave, `+ ${c.wfh ?? 0} working from home`, 'ON_LEAVE')}
        {past
          ? tile('Absent', 'absent', 'userX', c.absent, 'No check-in and no leave', 'ABSENT')
          : tile('Not marked', 'none', 'help', c.notMarked, `+ ${c.absent ?? 0} marked absent`, 'NOT_MARKED')}
      </div>
      <div className="apl-row">
        <Section title={past ? 'Who was where' : 'Who’s where today'} level={3} className="apl-grow-15"
          sub={past ? `Each person counted once for each working day (${total} in all), grouped by what they were doing.` : `All ${total} people, grouped by what they’re doing. Tap a row to see who.`}>
          <div className="apl-mix">
            <div className="apl-mix__ring">
              <svg viewBox="0 0 172 172" width="172" height="172" role="img" aria-label={`${past ? name : 'Today'}: ${mix.map((x) => `${x.n} ${x.label.toLowerCase()}`).join(', ')}`}>
                <circle cx="86" cy="86" r="64" fill="none" stroke="var(--u-hv,#F0F4F2)" strokeWidth="24" />
                {arcs.map((x) => (
                  <circle key={x.label} cx="86" cy="86" r="64" fill="none" stroke={x.color} strokeWidth="24" strokeDasharray={x.dash} strokeDashoffset={x.off} transform="rotate(-90 86 86)">
                    <title>{`${x.label}: ${x.n}`}</title>
                  </circle>
                ))}
              </svg>
              <span className="apl-mix__center"><strong>{total}</strong><span>{past ? 'days' : 'people'}</span></span>
            </div>
            <ul className="apl-mix__list">
              {mix.map((x) => {
                const opens = !!x.status && !past
                const body = (
                  <>
                    <i className="apl-dot" style={{ background: x.color }} aria-hidden="true" />
                    <span className="apl-mix__label">{x.label}</span>
                    <strong>{x.n}</strong>
                    <span className="apl-mix__pct">{Math.round((x.n / T) * 100)}%</span>
                  </>
                )
                return (
                  <li key={x.label}>
                    {opens
                      ? <button type="button" className="apl-mix__item" onClick={() => onOpenLogs(x.status)} title={`See who: ${x.label.toLowerCase()}`}>{body}</button>
                      : <div className="apl-mix__item">{body}</div>}
                  </li>
                )
              })}
            </ul>
          </div>
        </Section>
        <Card as="article" className="apl-grow-1" padding="md">
          <div className="apl-block">
            <div>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>How people checked in</h3>
              <p className="apl-note" style={{ marginTop: 4 }}>{srcLine}</p>
            </div>
            <ul className="apl-src">
              {d.sources.map((s) => (
                <li key={s.label}>
                  <span className="apl-src__label">{s.label}</span>
                  <span className="apl-src__n"><strong>{s.n}</strong><span>{` · ${Math.round((s.n / (srcTotal || 1)) * 100)}%`}</span></span>
                  <span className="apl-bar" aria-hidden="true"><span style={{ width: `${((s.n / (srcTotal || 1)) * 100).toFixed(1)}%` }} /></span>
                </li>
              ))}
            </ul>
          </div>
        </Card>
      </div>
    </section>
  )
}

function MonthBlock({ m, today, a, mobile, onOpenLogs }: { m: Props['m']; today: string; a: Analytics; mobile: boolean; onOpenLogs: (s: string, d?: string) => void }) {
  const navigate = useNavigate()
  const d = a.data
  const [q, setQ] = useState('')
  const chart = useMemo(() => trendChart({ month: m.month, today, past: m.past, daily: d.daily, holidays: d.holidays, offWd: d.offWd, mobile }),
    [m.month, today, m.past, d.daily, d.holidays, d.offWd, mobile])
  const n = chart.days.length, mon = MON[Number(m.month.slice(5, 7)) - 1]
  const lmMax = Math.max(1, ...d.lateMarks.map((l) => l.n))
  const rows = d.summary.filter((r) => !q.trim() || `${r.name} ${r.dept} ${r.code}`.toLowerCase().includes(q.trim().toLowerCase()))
  const wd = d.workingDays
  const columns: TableColumn<typeof rows[number]>[] = [
    { key: 'name', header: 'Employee', primary: true, render: (r) => <CellPerson name={r.name} sub={r.code} /> },
    { key: 'dept', header: 'Department', render: (r) => r.dept },
    {
      key: 'present', header: 'Days present', render: (r) => (
        <span className="apl-days">
          <span className="apl-days__bar" aria-hidden="true"><span style={{ width: `${(wd ? Math.min(100, (r.present / wd) * 100) : 0).toFixed(1)}%` }} /></span>
          <b style={{ fontWeight: 600 }}>{`${r.present} of ${wd}`}</b>
        </span>
      ),
    },
    { key: 'late', header: 'Late', render: (r) => (r.late ? `${r.late === 1 ? '1 time' : r.late + ' times'}` : <span className="apl-muted">Never</span>) },
    { key: 'avg', header: 'Hours a day', numeric: true, render: (r) => <span className="apl-num">{r.avgHours ? dur(Math.round(r.avgHours * 60)) : '—'}</span> },
    { key: 'ot', header: 'Overtime', numeric: true, render: (r) => <span className="apl-num">{r.ot ? dur(r.ot) : '—'}</span> },
  ]
  return (
    <section aria-labelledby="ov-month" className="apl-block">
      <div className="apl-block__head">
        <h2 id="ov-month">{m.past ? 'Day by day' : 'This month'}</h2>
        <span className="apl-chip">{`1–${n} ${mon} · ${wd} working days`}</span>
      </div>
      <div className="apl-row">
        <Card as="article" className="apl-grow-2" padding="md">
          <div className="apl-block">
            <div className="apl-cal__head">
              <div>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Attendance trend</h3>
                <p className="apl-note" style={{ marginTop: 4 }}>Each bar is one day. Tap a bar to open that day’s logs.</p>
              </div>
              <ul className="apl-legend">
                <li><i style={{ background: 'var(--u-success-2,#1F9D6E)' }} />On time</li>
                <li><i style={{ background: 'var(--u-warning,#C8912E)' }} />Late</li>
                <li><i style={{ background: 'var(--u-danger,#D9352B)' }} />Absent</li>
                <li><i style={{ background: 'var(--u-gy,#C9D2CE)' }} />Day off</li>
              </ul>
            </div>
            <svg className="apl-trend" viewBox={`0 0 ${chart.width} ${chart.height}`} role="img" aria-label={chart.aria}>
              {chart.grid.map((g) => (
                <Fragment key={g.label}>
                  <line x1={g.x1} x2={g.x2} y1={g.y} y2={g.y} className="apl-trend__grid" strokeDasharray={g.dashed ? '3 4' : undefined} />
                  <text x={g.x1 - 6} y={g.y + 3.5} textAnchor="end" fontSize="10.5" className="apl-trend__axis">{g.label}</text>
                </Fragment>
              ))}
              {chart.days.map((x) => (
                <g key={x.iso} className={`apl-trend__day${x.today ? ' apl-trend__day--today' : ''}`} data-tip={x.tip} onClick={() => onOpenLogs('', x.iso)}>
                  <title>{x.tip}</title>
                  <rect className="apl-trend__hl" x={x.hx} y={x.hy} width={x.hw} height={x.hh} rx="6" />
                  <rect className={x.off ? 'apl-trend__off' : 'apl-trend__on'} x={x.x} y={x.y1} width={x.w} height={x.h1} rx="2.5" />
                  <rect className="apl-trend__late" x={x.x} y={x.y2} width={x.w} height={x.h2} rx="2.5" />
                  <rect className="apl-trend__absent" x={x.x} y={x.y3} width={x.w} height={x.h3} rx="2.5" />
                  <text x={x.cx} y={chart.height - 8} textAnchor="middle" fontSize="10.5" className={x.today ? 'apl-trend__lbl apl-trend__lbl--today' : 'apl-trend__lbl'}>{x.label}</text>
                </g>
              ))}
            </svg>
          </div>
        </Card>
        {a.canReport && (
          <Section title="Late most often" level={3} sub="Times each person came in after the grace time" className="apl-grow-1"
            empty={d.lateMarks.length === 0 ? { title: 'No late marks', hint: `Nobody was late in ${MONTHS[Number(m.month.slice(5, 7)) - 1]}.`, variant: 'plain' } : false}>
            <div className="apl-late">
              {d.lateMarks.map((l) => (
                <button key={l.code} type="button" className="apl-late__item" onClick={() => l.id && navigate('/hrms/employees/' + l.id)}>
                  <CellPerson name={l.name} sub={l.dept !== '—' ? l.dept : undefined} />
                  <span className="apl-late__times">{l.n === 1 ? '1 time' : `${l.n} times`}</span>
                  <span className="apl-bar apl-bar--late" aria-hidden="true"><span style={{ width: `${((l.n / lmMax) * 100).toFixed(1)}%` }} /></span>
                </button>
              ))}
            </div>
          </Section>
        )}
      </div>
      {a.canReport && (
        <Section title="Everyone’s month" level={3} body="flush" sub={`Days present, late marks, hours and overtime for ${monthLabel(m.from)}`}
          actions={<div className="apl-search"><Input aria-label="Find a person or team" placeholder="Find a person or team" type="search" value={q} onChange={(e) => setQ(e.target.value)} leading="search" /></div>}
          error={a.summaryError} onRetry={a.retry}
          footer={(
            <div className="apl-foot">
              <span>{`Showing ${rows.length} of ${d.summary.length} people`}</span>
              <SectionLink label="Open the full report" arrow onClick={() => navigate(d.reportLink)} />
            </div>
          )}>
          <Table label={`Everyone’s month, ${monthLabel(m.from)}`} columns={columns} rows={rows} rowKey={(r) => r.code}
            loading={a.summaryLoading} mobile="cards" empty="No one matches that search."
            onRowClick={(r) => r.id && navigate('/hrms/employees/' + r.id)} rowLabel={(r) => `Open ${r.name}`} />
        </Section>
      )}
    </section>
  )
}
