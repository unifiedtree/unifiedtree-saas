import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Cake, Award, PartyPopper, type LucideIcon } from 'lucide-react'
import { usePermission, P } from '@unifiedtree/sdk'
import type { Milestone } from '../api/useMilestones'
import { istToday } from '@/design/dc/dates'
import { emptyText, rangeLabel, rangeOf, type MilestoneKind, type RangeChoice } from '@/design/dc/milestoneRange'
import {
  INITIAL_CHOICES, MilestoneCustomRange, MilestoneRangeMenu, useMilestoneColumns, type MilestoneColumn, type RangeTone,
} from '@/design/dc/MilestonesCard'

/**
 * Upcoming people milestones — birthdays, work anniversaries, retirements.
 *
 * Three columns, mirroring the client's reference design and the mobile app's
 * milestones screen. Added 2026-08-22 to close the web-vs-app parity gap the
 * client raised: the app has had this since launch, the web dashboard never
 * did.
 *
 * No permission gate — the endpoint is isAuthenticated() and the payload
 * carries no salary or contact PII, only name + department + date.
 *
 * Each column has its own date range (its usual window, a preset or a custom
 * range on the calendar, at most 12 months), with the same menu as the admin
 * dashboard's card (design/dc/MilestonesCard).
 */

/**
 * Relative day label. A column's own window only returns today or later; a
 * custom range can include days already past, which show their date.
 */
function whenLabel(iso: string): string {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const d = new Date(`${iso}T00:00:00`)
  const days = Math.round((d.getTime() - today.getTime()) / 86_400_000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  if (days === -1) return 'Yesterday'
  if (days > 0 && days <= 30) return `in ${days} days`
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

/** Rows shown before "Show all N": a whole year of birthdays would otherwise fill the page. */
const MAX_ROWS = 8

/** Deterministic avatar tint so the same person keeps the same colour. */
const TINTS = [
  'bg-emerald-100 text-emerald-700',
  'bg-sky-100 text-sky-700',
  'bg-amber-100 text-amber-700',
  'bg-violet-100 text-violet-700',
  'bg-rose-100 text-rose-700',
]
function tintFor(id: string): string {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return TINTS[h % TINTS.length]
}

interface ColumnProps {
  kind: MilestoneKind
  title: string
  icon: LucideIcon
  tone: RangeTone
  choice: RangeChoice
  onChoice: (c: RangeChoice) => void
  today: string
  col: MilestoneColumn
  /** Suffix builder for the secondary line, e.g. "3 years". */
  detail?: (m: Milestone) => string | null
  onPick: (m: Milestone) => void
}

const Column: React.FC<ColumnProps> = ({
  kind, title, icon: Icon, tone, choice, onChoice, today, col, detail, onPick,
}) => {
  const { items, isLoading, isError, refetch } = col
  const range = rangeOf(kind, choice, today)
  const [all, setAll] = useState(false)
  useEffect(() => { setAll(false) }, [range.from, range.to])
  const shown = all ? items : items.slice(0, MAX_ROWS)
  return (
  <div className="min-w-0 flex-1" data-milestone-list={kind}>
    <div className="mb-1 flex items-center gap-2">
      <Icon size={14} className="shrink-0 text-primary" aria-hidden />
      <h3 className="min-w-0 truncate text-xs font-bold uppercase tracking-wide text-text-secondary">{title}</h3>
      {!isLoading && items.length > 0 && (
        <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[11px] font-semibold text-primary">
          {items.length}
        </span>
      )}
      <span className="ml-auto">
        <MilestoneRangeMenu kind={kind} choice={choice} today={today} tone={tone} onChange={onChoice} />
      </span>
    </div>
    {choice.preset === 'custom'
      ? <MilestoneCustomRange value={range} today={today} onChange={(r) => onChoice({ preset: 'custom', ...r })} />
      : <p className="mb-3 text-[11.5px] tabular-nums text-text-secondary" data-milestone-range>{rangeLabel(range)}</p>}

    {isLoading ? (
      <div className="space-y-2" role="status" aria-label={`Loading ${title}`}>
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center gap-2.5">
            <div className="h-8 w-8 shrink-0 animate-pulse rounded-full bg-slate-200" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="h-3 w-2/3 animate-pulse rounded bg-slate-200" />
              <div className="h-2.5 w-1/3 animate-pulse rounded bg-slate-100" />
            </div>
          </div>
        ))}
      </div>
    ) : isError ? (
      <p className="text-xs leading-relaxed text-text-secondary" role="alert">
        Unable to load {title.toLowerCase()}. <button type="button" className="text-primary underline" onClick={refetch}>Try again</button>
      </p>
    ) : items.length === 0 ? (
      <p className="text-xs leading-relaxed text-text-secondary">{emptyText(kind, choice)}</p>
    ) : (
      <ul className="space-y-2">
        {shown.map((m) => {
          const extra = detail?.(m)
          return (
            <li key={`${m.employeeId}-${m.date}`}>
              <button
                type="button"
                onClick={() => onPick(m)}
                className="flex w-full items-center gap-2.5 rounded-lg p-1 text-left transition-colors hover:bg-slate-50"
              >
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${tintFor(m.employeeId)}`}
                  aria-hidden
                >
                  {m.initials}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-text-primary">{m.name}</span>
                  <span className="block truncate text-xs text-text-secondary">
                    {whenLabel(m.date)}
                    {extra ? ` · ${extra}` : m.department ? ` · ${m.department}` : ''}
                  </span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    )}
    {!isLoading && !isError && items.length > MAX_ROWS && (
      <button type="button" className="mt-2 text-xs font-semibold text-text-secondary hover:underline" aria-expanded={all} onClick={() => setAll((a) => !a)}>
        {all ? 'Show fewer' : `Show all ${items.length}`}
      </button>
    )}
  </div>
  )
}

export const UpcomingMilestones: React.FC = () => {
  const navigate = useNavigate()
  // The card itself is deliberately open to everyone (GET /v1/hrms/milestones
  // is isAuthenticated), but the row click goes to /hrms/employees/:id, which
  // is RouteGuard hrms.employee.read — removed from EMPLOYEE (V051) and from
  // DEPT_MANAGER/MANAGER (V112). For most seats a birthday click landed on
  // "Access Restricted" (2026-09-08 audit). Only navigate when the target
  // route will actually open; otherwise the row is informational.
  const canOpenEmployee = usePermission(P.HRMS_EMPLOYEE_READ)
  const today = istToday()
  // Each column's range lives here. Columns show their own loading, error and
  // empty states, so a quiet list still offers its range menu.
  const [choices, setChoices] = useState<Record<MilestoneKind, RangeChoice>>(INITIAL_CHOICES)
  const cols = useMilestoneColumns(choices, { today })
  const setChoice = (kind: MilestoneKind) => (next: RangeChoice) => setChoices((cur) => ({ ...cur, [kind]: next }))

  const open = (m: Milestone) => {
    if (canOpenEmployee) navigate(`/hrms/employees/${m.employeeId}`)
  }

  return (
    // Not overflow-hidden: each column's range menu opens below the card's edge.
    <div className="ut-card" data-milestones-staff-card>
      <div className="flex items-center gap-2 border-b border-border-light px-5 py-4">
        <PartyPopper size={16} className="text-primary" aria-hidden />
        <h2 className="text-sm font-bold text-text-primary">Upcoming Milestones</h2>
      </div>

      <div className="flex flex-col gap-6 p-5 sm:flex-row sm:gap-8">
        <Column
          kind="birthdays"
          title="Birthdays"
          icon={Cake}
          tone="warn"
          choice={choices.birthdays}
          onChoice={setChoice('birthdays')}
          today={today}
          col={cols.birthdays}
          onPick={open}
        />
        <Column
          kind="anniversaries"
          title="Work Anniversaries"
          icon={Award}
          tone="info"
          choice={choices.anniversaries}
          onChoice={setChoice('anniversaries')}
          today={today}
          col={cols.anniversaries}
          detail={(m) => (m.years ? `${m.years} year${m.years === 1 ? '' : 's'}` : null)}
          onPick={open}
        />
        <Column
          kind="retirements"
          title="Retirements"
          icon={PartyPopper}
          tone="ok"
          choice={choices.retirements}
          onChoice={setChoice('retirements')}
          today={today}
          col={cols.retirements}
          onPick={open}
        />
      </div>
    </div>
  )
}
