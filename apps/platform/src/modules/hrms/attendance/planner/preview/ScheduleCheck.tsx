// The Schedule check (design §1.4, §1.6): the owner's lines ("✓ All employees assigned", "⚠ 2 employees have
// insufficient rest", …), each opening to its issues; clicking an issue scrolls to its cells and flashes them.
// Errors block publishing, warnings need ticking when publishing, infos never block.
import { useState } from 'react'
import { AlertTriangle, Check, ChevronDown, ChevronRight, Info, XCircle } from 'lucide-react'
import type { Checks, Issue } from '../../../api/rosterTypes'
import { allIssues, summaryText } from '../plannerModel'

/** The line for a check when the server sends no summary of its own. */
const FALLBACK: Record<Issue['id'], string> = {
  E1: 'Shifts that can still be used', E2: 'Everyone is in the roster’s scope', E3: 'No duplicate assignments',
  E4: 'Days only while employed', E5: 'Everyone is in your departments', W1: 'All employees assigned', W2: 'Weekly offs available',
  W3: 'Required coverage met', W4: 'Enough rest between shifts', W5: 'Night shift coverage', W6: 'No overlapping assignments',
  W7: 'Everyone has a designation', I1: 'Shifts on leave or holidays', I2: 'More people than needed',
}
const ORDER: Issue['id'][] = ['E1', 'E2', 'E3', 'E4', 'E5', 'W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7', 'I1', 'I2']
const DMON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const dm = (iso: string) => `${Number(iso.slice(8, 10))} ${DMON[Number(iso.slice(5, 7)) - 1]}`
export const datesLabel = (dates: readonly string[]) => (dates.length === 0 ? '' : dates.length <= 3 ? dates.map(dm).join(', ') : `${dm(dates[0])} and ${dates.length - 1} more days`)

export interface CheckLine { id: Issue['id']; level: Issue['level']; count: number; label: string; issues: Issue[] }

/** The lines to show: the server's summary, with each line's issues; any issue without a line gets one. */
export function checkLines(checks: Checks | null | undefined): CheckLine[] {
  if (!checks) return []
  const issues = allIssues(checks)
  const lines: CheckLine[] = (checks.summary ?? []).map((s) => ({ id: s.id, level: s.level, count: s.count, label: summaryText(s.label) || FALLBACK[s.id], issues: issues.filter((i) => i.id === s.id) }))
  for (const id of ORDER) {
    if (lines.some((l) => l.id === id)) continue
    const of = issues.filter((i) => i.id === id)
    if (of.length) lines.push({ id, level: of[0].level, count: of.length, label: FALLBACK[id], issues: of })
  }
  const rank = (l: CheckLine) => (l.count === 0 ? 3 : l.level === 'error' ? 0 : l.level === 'warning' ? 1 : 2)
  return lines.sort((a, b) => rank(a) - rank(b) || ORDER.indexOf(a.id) - ORDER.indexOf(b.id))
}

const Icon = ({ l }: { l: CheckLine }) => (l.count === 0 ? <Check size={15} aria-hidden="true" />
  : l.level === 'error' ? <XCircle size={15} aria-hidden="true" /> : l.level === 'warning' ? <AlertTriangle size={15} aria-hidden="true" /> : <Info size={15} aria-hidden="true" />)

export function ScheduleCheck({ checks, updating, full, onReview, compact }: {
  checks: Checks | null | undefined
  /** A newer answer is on its way. */
  updating?: boolean
  /** These are the full checks of the saved roster (with the database checks), not the preview's. */
  full?: boolean
  /** Scroll to an issue's cells. */
  onReview?: (issue: Issue) => void
  /** Phone: the lines only. */
  compact?: boolean
}) {
  const [open, setOpen] = useState<Issue['id'] | null>(null)
  const lines = checkLines(checks)
  if (!checks) return <p className="spl-check__empty">Generate the schedule to check it.</p>
  return (
    <div className="spl-check" aria-busy={updating || undefined}>
      <div className="spl-check__head">
        <strong>Schedule check</strong>
        <span className="spl-check__sub">{updating ? 'Updating…' : full ? 'Full check of the saved roster' : 'Checked as you plan'}</span>
      </div>
      {lines.length === 0 && <p className="spl-check__empty"><Check size={15} aria-hidden="true" /> Nothing to flag.</p>}
      <ul className="spl-check__list">
        {lines.map((l) => {
          const expandable = !compact && l.count > 0 && l.issues.length > 0
          const isOpen = open === l.id && expandable
          return (
            <li key={l.id} className="spl-check__line" data-level={l.count === 0 ? 'ok' : l.level}>
              <button type="button" className="spl-check__btn" disabled={!expandable} aria-expanded={expandable ? isOpen : undefined} onClick={() => setOpen(isOpen ? null : l.id)}>
                <span className="spl-check__icon"><Icon l={l} /></span>
                <span className="spl-check__label">{l.label}</span>
                {l.count > 0 && <span className="spl-check__count">{l.count}</span>}
                {expandable && (isOpen ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />)}
              </button>
              {isOpen && (
                <ul className="spl-check__issues">
                  {l.issues.map((i) => (
                    <li key={i.key}>
                      <button type="button" className="spl-check__issue" onClick={() => onReview?.(i)} disabled={!onReview || (!i.employeeId && !i.dates.length)}>
                        <span>{i.message}</span>
                        {i.dates.length > 0 && <span className="spl-check__dates">{datesLabel(i.dates)}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
