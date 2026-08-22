import React from 'react'
import { useNavigate } from 'react-router-dom'
import { Cake, Award, PartyPopper, type LucideIcon } from 'lucide-react'
import { useMilestones, type Milestone } from '../api/useMilestones'

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
 */

/**
 * Relative day label. The server hands back the NEXT occurrence, so `date` is
 * always today or later and we never render a negative case.
 */
function whenLabel(iso: string): string {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const d = new Date(`${iso}T00:00:00`)
  const days = Math.round((d.getTime() - today.getTime()) / 86_400_000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  if (days <= 30) return `in ${days} days`
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

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
  title: string
  icon: LucideIcon
  items: Milestone[]
  emptyHint: string
  /** Suffix builder for the secondary line, e.g. "3 years". */
  detail?: (m: Milestone) => string | null
  isLoading: boolean
  onPick: (m: Milestone) => void
}

const Column: React.FC<ColumnProps> = ({
  title, icon: Icon, items, emptyHint, detail, isLoading, onPick,
}) => (
  <div className="min-w-0 flex-1">
    <div className="mb-3 flex items-center gap-2">
      <Icon size={14} className="shrink-0 text-primary" aria-hidden />
      <h3 className="text-xs font-bold uppercase tracking-wide text-text-secondary">{title}</h3>
      {items.length > 0 && (
        <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[11px] font-semibold text-primary">
          {items.length}
        </span>
      )}
    </div>

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
    ) : items.length === 0 ? (
      <p className="text-xs leading-relaxed text-text-secondary">{emptyHint}</p>
    ) : (
      <ul className="space-y-2">
        {items.map((m) => {
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
  </div>
)

export const UpcomingMilestones: React.FC = () => {
  const navigate = useNavigate()
  const { data, isLoading } = useMilestones({ birthdayDays: 14, anniversaryDays: 31, retirementMonths: 6 })

  const birthdays = data?.birthdays ?? []
  const anniversaries = data?.anniversaries ?? []
  const retirements = data?.retirements ?? []
  const total = birthdays.length + anniversaries.length + retirements.length

  // Nothing at all and nothing loading: stay off the dashboard rather than
  // render three empty columns. An all-quiet fortnight is the common case for
  // a small workspace and an empty card reads as broken.
  if (!isLoading && total === 0) return null

  const open = (m: Milestone) => navigate(`/hrms/employees/${m.employeeId}`)

  return (
    <div className="overflow-hidden rounded-2xl border border-primary/15 bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-border-light px-5 py-4">
        <PartyPopper size={16} className="text-primary" aria-hidden />
        <h2 className="text-sm font-bold text-text-primary">Upcoming Milestones</h2>
      </div>

      <div className="flex flex-col gap-6 p-5 sm:flex-row sm:gap-8">
        <Column
          title="Birthdays"
          icon={Cake}
          items={birthdays}
          emptyHint="No birthdays in the next 14 days."
          isLoading={isLoading}
          onPick={open}
        />
        <Column
          title="Work Anniversaries"
          icon={Award}
          items={anniversaries}
          emptyHint="No work anniversaries in the next month."
          detail={(m) => (m.years ? `${m.years} year${m.years === 1 ? '' : 's'}` : null)}
          isLoading={isLoading}
          onPick={open}
        />
        <Column
          title="Retirements"
          icon={PartyPopper}
          items={retirements}
          emptyHint="No retirements in the next 6 months."
          isLoading={isLoading}
          onPick={open}
        />
      </div>
    </div>
  )
}
