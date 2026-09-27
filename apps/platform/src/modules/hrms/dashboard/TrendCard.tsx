// "Weekly attendance trend" (PgDashboard "attendance"): seven stacked columns ending on the viewed day —
// regular check-ins, late marks and absences — with "Off" for weekly offs and holidays. Click a day to load it.
import type { CSSProperties } from 'react'
import { Section } from '@/design/kit/display'
import { fmtShort } from '@/design/dc/dates'
import { niceScale, type TrendColumn } from './dashboardModel'

export function TrendCard({ cols, sel, isToday, loading, error, onRetry, onPick, style }: {
  cols: TrendColumn[]; sel: string; isToday: boolean; loading: boolean; error: unknown; onRetry: () => void
  onPick: (iso: string) => void; style?: CSSProperties
}) {
  const scale = niceScale(Math.max(0, ...cols.map((c) => c.regular + c.late + c.absent)))
  const cur = cols.find((c) => c.iso === sel)
  const empty = !cols.some((c) => c.regular + c.late + c.absent > 0)
  const h = (v: number) => `${((v / scale.max) * 100).toFixed(1)}%`
  return (
    <Section variant="dashboard" level={3} title="Weekly attendance trend" sub="Regular check-ins, late marks and absences" body="flush" style={style}
      actions={<span className="ud-chip">{isToday ? 'Last 7 days · IST' : `7 days to ${fmtShort(sel)} · IST`}</span>}
      loading={loading} error={error} onRetry={onRetry} skeleton="chart">
      <div className="ud-trend-head">
        <div className="ud-legend">
          <span><i style={{ background: 'var(--u-br,#0F6E56)' }} />Regular check-ins</span>
          <span><i style={{ background: 'var(--u-gd,#C8912E)' }} />Late</span>
          <span><i style={{ background: 'var(--u-rd,#C4453A)' }} />Absent</span>
        </div>
        {cur && (
          <div className="ud-selbox" aria-live="polite">
            <b>{cur.title}</b>
            <span><i style={{ background: 'var(--u-br,#0F6E56)' }} /><b>{cur.regular}</b>regular</span>
            <span><i style={{ background: 'var(--u-gd,#C8912E)' }} /><b>{cur.late}</b>late</span>
            <span><i style={{ background: 'var(--u-rd,#C4453A)' }} /><b>{cur.absent}</b>absent</span>
          </div>
        )}
      </div>
      <div className="ud-chart">
        <div className="ud-chart__grid" aria-hidden="true">
          {scale.ticks.map((t) => <div key={t}><span>{t}</span><span /></div>)}
        </div>
        <div className="ud-chart__cols" role="group" aria-label="Days">
          {cols.map((c) => c.off ? (
            <div key={c.iso} className="ud-col ud-col--off" title={`${c.title} · weekly off or holiday`}>
              <span className="ud-col__off"><span>Off</span></span>
              <span className="ud-col__label">{c.label}</span>
            </div>
          ) : (
            <button key={c.iso} type="button" className="ud-col" aria-pressed={c.iso === sel} onClick={() => onPick(c.iso)}
              title={`${c.title} · ${c.regular} regular · ${c.late} late · ${c.absent} absent`}
              aria-label={`${c.title}: ${c.regular} regular, ${c.late} late, ${c.absent} absent. Load this day into the dashboard`}>
              <span className="ud-col__lane">
                <span className="ud-col__stack ufx-grow-y">
                  <span className="ud-col__a" style={{ height: h(c.absent) }} />
                  <span className="ud-col__l" style={{ height: h(c.late) }} />
                  <span className="ud-col__r" style={{ height: h(c.regular) }} />
                </span>
              </span>
              <span className="ud-col__label">{c.label}</span>
            </button>
          ))}
        </div>
        {empty && <div className="ud-chart__empty"><span>{isToday ? 'No check-ins in the last 7 days' : 'No check-ins in these 7 days'}</span></div>}
      </div>
      <p className="ud-foot-note">Click a day to load it into the dashboard.</p>
    </Section>
  )
}

export type { TrendColumn }
