// hand-owned: rebuilt by hand for the redesign (P-DASH); no generator writes this file.
// "Upcoming milestones" on the Company Admin Dashboard: birthdays, work
// anniversaries and retirements. Each list has its own date range — its usual
// window, a preset (This month, Next month, Next 3 / 6 months, This year) or a
// custom range picked on the calendar (at most 12 months) — kept in this card's
// state, and its "View all" opens the directory on the same range.
//
// Hand-built on the redesign kit (PgDashboard "Upcoming milestones": three columns, each with its range pill);
// tokens only, so it follows dark mode. The range logic lives in milestoneRange.ts. The staff card
// (modules/hrms/milestones/UpcomingMilestones.tsx) reuses the range menu, the custom range and the data hook.
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { Avatar, Section } from '@/design/kit/display'
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
        ref={btnRef} type="button" className={`ud-ms-pill ud-ms-pill--${tone}`} aria-haspopup="menu" aria-expanded={open}
        aria-label={`Date range for ${kind === 'anniversaries' ? 'work anniversaries' : kind}: ${choiceLabel(kind, choice)}`}
        onClick={() => setOpen((o) => !o)}
      >
        {choiceLabel(kind, choice)}
        {dashIcon('chevronDown', 12, { transform: open ? 'rotate(180deg)' : undefined, transition: 'transform .15s' })}
      </button>
      {open && (
        <div ref={listRef} role="menu" aria-label="Choose a date range" className="ud-ms-menu">
          {options.map((o) => {
            const on = o.value === choice.preset
            const dates = o.value === 'custom' ? (on ? menuDates(rangeOf(kind, choice, today), today) : 'Pick on the calendar') : menuDates(presetRange(kind, o.value, today), today)
            return (
              <button key={o.value} type="button" role="menuitemradio" aria-checked={on} className="ud-ms-opt" onClick={() => pick(o.value)}>
                <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap' }}>{o.label}</span>
                <span className="ud-ms-opt__d">{dates}</span>
                <span className="ud-ms-opt__ck">{on ? dashIcon('check', 14) : null}</span>
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
  return (
    <div role="group" aria-label="Custom date range" className="ud-ms-custom">
      <div style={{ display: 'grid', gap: 4, minWidth: 0 }}>
        <span>From</span>
        <DatePicker value={value.from} today={today} min={reach.min} max={reach.max} onChange={(_e: unknown, v: string) => setFrom(v)} label="From" />
      </div>
      <div style={{ display: 'grid', gap: 4, minWidth: 0 }}>
        <span>To</span>
        <DatePicker value={value.to} today={today} min={value.from} max={lastTo(value.from, reach)} onChange={(_e: unknown, v: string) => setTo(v)} label="To" />
      </div>
      <p>{reachNote(kind, reach)}</p>
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
const ICON_COLOR: Record<RangeTone, string> = { warn: 'var(--u-gdt,#8A5A10)', info: 'color-mix(in oklab,var(--u-k-people,#3B6FD9) 80%,var(--u-ink,#0E1B16))', ok: 'var(--u-brt,#0F6E56)' }
const AV_CLASS: Record<RangeTone, string> = { warn: 'ud-av--gold', info: 'ud-av--blue', ok: '' }

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
  return (
    <div data-milestone-list={kind} className="ud-ms-col">
      <div className="ud-ms-col__head">
        <p className="ud-ms-col__title">
          <span style={{ display: 'inline-flex', flexShrink: 0, color: ICON_COLOR[tone] }} aria-hidden="true">{dashIcon(icon, 16)}</span>
          <span>{title}</span>
          {!col.isLoading && !col.isError && <span data-milestone-count className="ud-ms-col__n">{rows.length}</span>}
        </p>
        <MilestoneRangeMenu kind={kind} choice={choice} today={today} tone={tone} onChange={onChoice} />
      </div>
      {choice.preset === 'custom'
        ? <MilestoneCustomRange kind={kind} value={range} today={today} reach={reach} onChange={(r) => onChoice({ preset: 'custom', ...r })} />
        : <div data-milestone-range className="ud-ms-col__range">{rangeLabel(range)}</div>}
      <div style={{ display: 'grid', gap: 6, alignContent: 'start', ...(all && rows.length > MAX_ROWS ? { maxHeight: 440, overflowY: 'auto', padding: '0 6px', margin: '0 -6px' } : {}) }} aria-busy={col.isLoading || undefined}>
        {col.isLoading ? (
          <div role="status" aria-label={`Loading ${title.toLowerCase()}`} style={{ display: 'grid', gap: 10, padding: '4px 0' }}>
            {[0, 1, 2].map((i) => <span key={i} className="uk-skel uk-skel--hv" style={{ height: 30, borderRadius: 8 }} />)}
          </div>
        ) : col.isError ? (
          <p role="alert" className="ud-ms-note">
            Couldn’t load {title.toLowerCase()}.{' '}
            <button type="button" className="ud-ms-link ud-ms-link--quiet" onClick={col.refetch} style={{ display: 'inline-flex' }}>Try again</button>
          </p>
        ) : rows.length === 0 ? (
          <p className="ud-ms-note">{emptyText(kind, choice)}</p>
        ) : shown.map((m) => {
          const l = rowLabels(kind, m.date, m.years, today)
          return (
            <button key={`${m.employeeId}-${m.date}`} type="button" className="ud-ms-row" onClick={() => onNavigate(`/hrms/employees/${m.employeeId}`)}>
              <Avatar name={m.name} initials={m.initials} size={30} className={AV_CLASS[tone]} />
              <span className="ud-ms-row__txt">
                <span className="ud-ms-row__name" style={{ display: 'block' }}>{m.name}</span>
                <span className="ud-ms-row__sub" style={{ display: 'block' }}>{l.sub}{m.department ? ` · ${m.department}` : ''}</span>
              </span>
              <span className="ud-ms-row__when">{l.when}</span>
            </button>
          )
        })}
      </div>
      {!col.isLoading && !col.isError && rows.length > MAX_ROWS && (
        <button type="button" className="ud-ms-link ud-ms-link--quiet" onClick={() => setAll((a) => !a)} aria-expanded={all}>
          {all ? 'Show fewer' : `Show all ${rows.length}`}
        </button>
      )}
      <button type="button" className="ud-ms-link" onClick={() => onNavigate(viewAll)}>
        View all{dashIcon('arrowRight', 13)}
      </button>
    </div>
  )
}

export function MilestonesCard({ today: todayProp, companyId, canReadEmployees, onNavigate, style }: {
  today?: string; companyId?: string; canReadEmployees?: boolean; onNavigate?: (path: string) => void; style?: CSSProperties
}) {
  const today = todayProp || istToday()
  const [choices, setChoices] = useState<Record<MilestoneKind, RangeChoice>>(INITIAL_CHOICES)
  const cols = useMilestoneColumns(choices, { today, companyId, canReadEmployees })
  const retirementDue = usesRetirementDue({ companyId, canReadEmployees })
  const go = (path: string) => onNavigate && onNavigate(path)
  return (
    <div data-milestones-card style={{ minWidth: 0, display: 'flex', ...style }}>
      <Section variant="dashboard" level={3} title="Upcoming milestones" sub="Birthdays, work anniversaries and retirements" body="flush" style={{ flex: 1 }}>
        <div className="ud-ms-grid">
          {COLS.map((c) => (
            <Column
              key={c.kind} {...c} choice={choices[c.kind]} col={cols[c.kind]} today={today} reach={rangeReach(c.kind, today, retirementDue)} onNavigate={go}
              onChoice={(next) => setChoices((cur) => ({ ...cur, [c.kind]: next }))}
            />
          ))}
        </div>
      </Section>
    </div>
  )
}
