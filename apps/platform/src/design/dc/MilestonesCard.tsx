// "Upcoming milestones" on the Company Admin Dashboard: birthdays, work
// anniversaries and retirements. Each list has its own date range — its usual
// window, a preset (This month, Next month, Next 3 / 6 months, This year) or a
// custom range picked on the calendar (at most 12 months) — kept in this card's
// state, and its "View all" opens the directory on the same range.
//
// Taken out of the generated dashboard view (scripts/design-build.mjs, POST) so
// the range logic lives in one place; the look is the design's card. The staff
// dashboard's card (modules/hrms/milestones/UpcomingMilestones.tsx) reuses the
// range menu, the custom range and the data hook from here.
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { HrAvatar } from '@/shared/components/hr'
import { SkeletonBlock } from '@/shared/components/SkeletonCard'
import {
  useMilestones, useMilestonesBetween, useRetirementsBetween, useRetirementsDue,
  type Milestone, type RetirementDue,
} from '@/modules/hrms/api/useMilestones'
import { DatePicker } from './DatePicker'
import { dashIcon } from './icons'
import { dt, istToday, MON } from './dates'
import {
  DEFAULT_CHOICE, choiceLabel, emptyText, lastTo, presetRange, rangeLabel, rangeOf, rangeOptions, rangeReach, reachNote, rowLabels, serverRange, viewAllPath,
  type DateRange, type MilestoneKind, type RangeChoice, type RangePreset, type RangeReach,
} from './milestoneRange'
import './MilestonesCard.css'

export type { MilestoneKind, RangeChoice } from './milestoneRange'
export const INITIAL_CHOICES: Record<MilestoneKind, RangeChoice> = { birthdays: DEFAULT_CHOICE, anniversaries: DEFAULT_CHOICE, retirements: DEFAULT_CHOICE }

// ── data ─────────────────────────────────────────────────────────────────────
export interface MilestoneColumn { items: Milestone[]; isLoading: boolean; isError: boolean; refetch: () => void }
type Q<T> = { data?: T; isLoading: boolean; isError: boolean; refetch: () => unknown }
const column = <T,>(q: Q<T>, pick: (d: T | undefined) => Milestone[]): MilestoneColumn =>
  ({ items: pick(q.data), isLoading: q.isLoading, isError: q.isError, refetch: () => { q.refetch() } })
const fromDue = (rows?: RetirementDue[]): Milestone[] => (rows ?? []).map((r) => ({
  employeeId: r.employeeId, name: r.name, initials: r.initials, department: r.department, date: r.retirementDate, years: r.retirementAge,
}))

/** Whether retirements come from retirement due (one company, people who can read employee records). */
export const usesRetirementDue = (opts: { companyId?: string; canReadEmployees?: boolean }) => !!opts.canReadEmployees && !!opts.companyId

/**
 * The three lists for the chosen ranges. A list on its own window reads the
 * request the dashboard already makes (same query, shared cache); a range asks
 * the server for that list only. With `canReadEmployees` and a company,
 * retirements come from retirement due for that company, as before.
 */
export function useMilestoneColumns(
  choices: Record<MilestoneKind, RangeChoice>,
  opts: { today: string; companyId?: string; canReadEmployees?: boolean },
): Record<MilestoneKind, MilestoneColumn> {
  const { today, companyId } = opts
  const companyScoped = usesRetirementDue(opts)
  const bRange = serverRange('birthdays', choices.birthdays, today)
  const aRange = serverRange('anniversaries', choices.anniversaries, today)
  const rRange = serverRange('retirements', choices.retirements, today)
  const shared = useMilestones({ birthdayDays: 14, anniversaryDays: 31, retirementMonths: 6 }, { enabled: !bRange || !aRange || (!rRange && !companyScoped) })
  const birthdays = useMilestonesBetween('birthdays', bRange)
  const anniversaries = useMilestonesBetween('anniversaries', aRange)
  const retirements = useMilestonesBetween('retirements', rRange, { enabled: !companyScoped })
  // The dashboard's own six-month window, worked out the same way so the request is shared.
  const sixMonthsOut = dt(today)
  sixMonthsOut.setMonth(sixMonthsOut.getMonth() + 6)
  const retirementDays = Math.round((sixMonthsOut.getTime() - dt(today).getTime()) / 86400000)
  const dueWindow = useRetirementsDue(retirementDays, { companyId, enabled: companyScoped && !rRange })
  const dueRange = useRetirementsBetween(rRange, { companyId, enabled: companyScoped })
  const own = (kind: MilestoneKind) => column(shared, (d) => d?.[kind] ?? [])
  return {
    birthdays: bRange ? column(birthdays, (d) => d ?? []) : own('birthdays'),
    anniversaries: aRange ? column(anniversaries, (d) => d ?? []) : own('anniversaries'),
    retirements: companyScoped
      ? column(rRange ? dueRange : dueWindow, fromDue)
      : rRange ? column(retirements, (d) => d ?? []) : own('retirements'),
  }
}

// ── range menu ───────────────────────────────────────────────────────────────
export type RangeTone = 'warn' | 'info' | 'ok'
const TONES: Record<RangeTone, { bg: string; fg: string; border: string }> = {
  warn: { bg: '#fffbeb', fg: '#b45309', border: '#fde68a' },
  info: { bg: '#eff6ff', fg: '#1d4ed8', border: '#bfdbfe' },
  ok: { bg: '#ecfdf5', fg: '#047857', border: '#a7f3d0' },
}
/** Short dates for the menu: no year when the range sits in this year, only the end's year when it runs into the next. */
function menuDates(r: DateRange, today: string): string {
  const dm = (iso: string) => `${dt(iso).getDate()} ${MON[dt(iso).getMonth()]}`
  const y = today.slice(0, 4), thisYear = r.from.slice(0, 4) === y && r.to.slice(0, 4) === y
  if (!thisYear) return r.from.slice(0, 4) === y && r.from !== r.to ? `${dm(r.from)} – ${dm(r.to)} ${r.to.slice(0, 4)}` : rangeLabel(r)
  if (r.from === r.to) return dm(r.from)
  return r.from.slice(0, 7) === r.to.slice(0, 7) ? `${dt(r.from).getDate()} – ${dm(r.to)}` : `${dm(r.from)} – ${dm(r.to)}`
}

/** The pill that picks a list's range: presets with their dates, then "Custom range". */
export function MilestoneRangeMenu({ kind, choice, today, tone = 'ok', onChange }: {
  kind: MilestoneKind; choice: RangeChoice; today: string; tone?: RangeTone; onChange: (c: RangeChoice) => void
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const options = rangeOptions(kind)
  const t = TONES[tone]
  const items = () => Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? [])

  useEffect(() => {
    if (!open) return
    const down = (e: MouseEvent) => { if (!rootRef.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', down)
    const all = items()
    ;(all.find((b) => b.getAttribute('aria-checked') === 'true') || all[0])?.focus()
    return () => document.removeEventListener('mousedown', down)
  }, [open])

  const close = () => { setOpen(false); btnRef.current?.focus() }
  const pick = (p: RangePreset) => {
    close()
    if (p === choice.preset) return
    if (p === 'custom') {
      // Start from the dates on show, so the calendar opens where the list already is.
      const r = rangeOf(kind, choice, today)
      onChange({ preset: 'custom', from: r.from, to: r.to })
    } else onChange({ preset: p })
  }
  const onKey = (e: KeyboardEvent) => {
    if (!open) return
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return }
    if (e.key === 'Tab') { setOpen(false); return }
    const all = items(), i = all.indexOf(document.activeElement as HTMLButtonElement)
    const to = e.key === 'ArrowDown' ? Math.min(all.length - 1, i + 1) : e.key === 'ArrowUp' ? Math.max(0, i - 1) : e.key === 'Home' ? 0 : e.key === 'End' ? all.length - 1 : null
    if (to != null) { e.preventDefault(); all[to]?.focus() }
  }

  return (
    <div ref={rootRef} onKeyDown={onKey} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        ref={btnRef} type="button" className="ms-pill" aria-haspopup="menu" aria-expanded={open}
        aria-label={`Date range for ${kind === 'anniversaries' ? 'work anniversaries' : kind}: ${choiceLabel(kind, choice)}`}
        onClick={() => setOpen((o) => !o)}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 26, padding: '0 8px 0 10px', borderRadius: 999, border: `1px solid ${t.border}`, background: t.bg, color: t.fg, fontFamily: 'inherit', fontSize: 11.5, fontWeight: 700, whiteSpace: 'nowrap', cursor: 'pointer' }}
      >
        {dashIcon('calendar', 12)}
        {choiceLabel(kind, choice)}
        {dashIcon('chevronDown', 13, { transform: open ? 'rotate(180deg)' : undefined, transition: 'transform .15s' })}
      </button>
      {open && (
        <div
          ref={listRef} role="menu" aria-label="Choose a date range"
          style={{ position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 40, width: 268, maxWidth: 'calc(100vw - 32px)', boxSizing: 'border-box', padding: 6, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, boxShadow: '0 18px 40px -14px rgba(15,23,42,.28), 0 2px 6px rgba(15,23,42,.06)', display: 'grid', gap: 2 }}
        >
          {options.map((o) => {
            const on = o.value === choice.preset
            const dates = o.value === 'custom' ? (on ? menuDates(rangeOf(kind, choice, today), today) : 'Pick on the calendar') : menuDates(presetRange(kind, o.value, today), today)
            return (
              <button
                key={o.value} type="button" role="menuitemradio" aria-checked={on} className="ms-opt" onClick={() => pick(o.value)}
                style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 10px', border: 0, borderRadius: 8, background: on ? '#ecfdf5' : 'transparent', color: on ? '#0a5240' : '#0f172a', fontFamily: 'inherit', fontSize: 13, fontWeight: on ? 700 : 500, textAlign: 'left', cursor: 'pointer' }}
              >
                <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap' }}>{o.label}</span>
                <span style={{ fontSize: 11.5, fontWeight: 500, color: '#64748b', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{dates}</span>
                <span style={{ width: 14, display: 'inline-flex', color: '#0f6e56' }}>{on ? dashIcon('check', 14) : null}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

/**
 * From / To on the calendar for a custom range. To stays within 12 months of
 * From, and both stay inside `reach` (rangeReach: how far the list's source
 * shows).
 */
export function MilestoneCustomRange({ kind, value, today, reach = {}, onChange }: {
  kind: MilestoneKind; value: DateRange; today: string; reach?: RangeReach; onChange: (r: DateRange) => void
}) {
  const setFrom = (from: string) => {
    if (!from) return
    const end = lastTo(from, reach)
    const to = value.to < from ? from : value.to > end ? end : value.to
    onChange({ from, to })
  }
  const setTo = (to: string) => { if (to) onChange({ from: value.from, to }) }
  const label: CSSProperties = { fontSize: 11.5, fontWeight: 600, color: '#475569' }
  return (
    <div role="group" aria-label="Custom date range" style={{ display: 'grid', gap: 8, margin: '6px 0 8px' }}>
      <div style={{ display: 'grid', gap: 4, minWidth: 0 }}>
        <span style={label}>From</span>
        <DatePicker value={value.from} today={today} min={reach.min} max={reach.max} onChange={(_e: unknown, v: string) => setFrom(v)} label="From" />
      </div>
      <div style={{ display: 'grid', gap: 4, minWidth: 0 }}>
        <span style={label}>To</span>
        <DatePicker value={value.to} today={today} min={value.from} max={lastTo(value.from, reach)} onChange={(_e: unknown, v: string) => setTo(v)} label="To" />
      </div>
      <p style={{ margin: 0, fontSize: 11.5, color: '#64748b' }}>{reachNote(kind, reach)}</p>
    </div>
  )
}

// ── the card ─────────────────────────────────────────────────────────────────
const MAX_ROWS = 8
const COLS: { kind: MilestoneKind; title: string; icon: string; tone: RangeTone }[] = [
  { kind: 'birthdays', title: 'Birthdays', icon: 'cake', tone: 'warn' },
  { kind: 'anniversaries', title: 'Work anniversaries', icon: 'award', tone: 'info' },
  { kind: 'retirements', title: 'Retirements', icon: 'star', tone: 'ok' },
]

function Column({ kind, title, icon, tone, choice, col, today, reach, onChoice, onNavigate }: {
  kind: MilestoneKind; title: string; icon: string; tone: RangeTone; choice: RangeChoice; col: MilestoneColumn; today: string
  reach: RangeReach; onChoice: (c: RangeChoice) => void; onNavigate: (path: string) => void
}) {
  const [all, setAll] = useState(false)
  const range = rangeOf(kind, choice, today)
  useEffect(() => { setAll(false) }, [range.from, range.to])
  const rows = col.items
  const shown = all ? rows : rows.slice(0, MAX_ROWS)
  const viewAll = viewAllPath(kind, choice, today)
  const note: CSSProperties = { margin: '6px 0 0', fontSize: 12.5, lineHeight: 1.5, color: '#64748b' }
  return (
    <div data-milestone-list={kind} style={{ minWidth: 0, background: '#f8fafc', border: '1px solid #f1f5f9', borderRadius: 12, padding: '12px 14px', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '8px', paddingBottom: 10, marginBottom: 6, borderBottom: '1px solid #e2e8f0' }}>
        <p style={{ margin: 0, minWidth: 0, display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 700, color: '#0f172a' }}>
          <span style={{ color: '#0f6e56', display: 'inline-flex' }}>{dashIcon(icon, 15)}</span>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
          {!col.isLoading && !col.isError && <span data-milestone-count style={{ fontSize: 11, fontWeight: 700, color: '#64748b', fontVariantNumeric: 'tabular-nums' }}>{rows.length}</span>}
        </p>
        <MilestoneRangeMenu kind={kind} choice={choice} today={today} tone={tone} onChange={onChoice} />
      </div>
      {choice.preset === 'custom'
        ? <MilestoneCustomRange kind={kind} value={range} today={today} reach={reach} onChange={(r) => onChoice({ preset: 'custom', ...r })} />
        : <p data-milestone-range style={{ margin: '0 0 2px', fontSize: 11.5, color: '#64748b', fontVariantNumeric: 'tabular-nums' }}>{rangeLabel(range)}</p>}
      <div style={{ display: 'grid', flex: 1, alignContent: 'start', ...(all && rows.length > MAX_ROWS ? { maxHeight: 440, overflowY: 'auto', padding: '0 6px', margin: '0 -6px' } : {}) }} aria-busy={col.isLoading || undefined}>
        {col.isLoading ? (
          <div role="status" aria-label={`Loading ${title.toLowerCase()}`} style={{ display: 'grid', gap: 10, padding: '8px 0' }}>
            {[0, 1, 2].map((i) => <SkeletonBlock key={i} style={{ height: 32, borderRadius: 8 }} />)}
          </div>
        ) : col.isError ? (
          <p role="alert" style={note}>
            Couldn’t load {title.toLowerCase()}.{' '}
            <button type="button" className="ms-link" onClick={col.refetch} style={{ color: '#0f6e56', fontWeight: 600, fontSize: 12.5, background: 'none', border: 0, padding: 0, cursor: 'pointer', fontFamily: 'inherit' }}>Try again</button>
          </p>
        ) : rows.length === 0 ? (
          <p style={note}>{emptyText(kind, choice)}</p>
        ) : shown.map((m) => {
          const l = rowLabels(kind, m.date, m.years, today)
          return (
            <button
              key={`${m.employeeId}-${m.date}`} type="button" className="ms-row" data-tip={`→ /hrms/employees/${m.employeeId}`}
              onClick={() => onNavigate(`/hrms/employees/${m.employeeId}`)}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, background: 'none', border: 0, padding: '8px 6px', margin: '0 -6px', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}
            >
              <HrAvatar name={m.name} sub={m.department || ''} />
              <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1, flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                <strong style={{ fontSize: 12, fontWeight: 700, color: '#0f172a' }}>{l.when}</strong>
                <span style={{ fontSize: 11, color: '#64748b' }}>{l.sub}</span>
              </span>
            </button>
          )
        })}
      </div>
      {!col.isLoading && !col.isError && rows.length > MAX_ROWS && (
        <button type="button" className="ms-link" onClick={() => setAll((a) => !a)} aria-expanded={all} style={{ marginTop: 4, alignSelf: 'flex-start', color: '#334155', fontWeight: 600, fontSize: 12, background: 'none', border: 0, padding: 0, cursor: 'pointer', fontFamily: 'inherit' }}>
          {all ? 'Show fewer' : `Show all ${rows.length}`}
        </button>
      )}
      <button type="button" className="ms-link" data-tip={`→ ${viewAll}`} onClick={() => onNavigate(viewAll)} style={{ marginTop: 8, alignSelf: 'flex-start', color: '#0f6e56', fontWeight: 600, fontSize: 12, background: 'none', border: 0, padding: 0, cursor: 'pointer', fontFamily: 'inherit' }}>
        View all →
      </button>
    </div>
  )
}

export function MilestonesCard({ today: todayProp, companyId, canReadEmployees, onNavigate }: {
  today?: string; companyId?: string; canReadEmployees?: boolean; onNavigate?: (path: string) => void
}) {
  const today = todayProp || istToday()
  const [choices, setChoices] = useState<Record<MilestoneKind, RangeChoice>>(INITIAL_CHOICES)
  const cols = useMilestoneColumns(choices, { today, companyId, canReadEmployees })
  const retirementDue = usesRetirementDue({ companyId, canReadEmployees })
  const go = (path: string) => onNavigate && onNavigate(path)
  return (
    <div data-milestones-card style={{ minWidth: 0, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 16, boxShadow: '0 1px 2px rgba(15,23,42,.04)', padding: '20px 22px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
        <h2 style={{ margin: 0, fontFamily: "'Plus Jakarta Sans',Inter,sans-serif", fontWeight: 700, fontSize: 15, color: '#0f172a', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ display: 'inline-flex', width: 28, height: 28, borderRadius: 8, background: '#ecfdf5', color: '#0f6e56', alignItems: 'center', justifyContent: 'center' }}>{dashIcon('cake', 16)}</span>
          Upcoming milestones
        </h2>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(max(220px,30%),1fr))', gap: 12 }}>
        {COLS.map((c) => (
          <Column
            key={c.kind} {...c} choice={choices[c.kind]} col={cols[c.kind]} today={today} reach={rangeReach(c.kind, today, retirementDue)} onNavigate={go}
            onChoice={(next) => setChoices((cur) => ({ ...cur, [c.kind]: next }))}
          />
        ))}
      </div>
    </div>
  )
}
