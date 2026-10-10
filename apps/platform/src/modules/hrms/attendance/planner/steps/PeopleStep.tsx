// Step 5 — People (design §1.6): designation groups with a tick and a count ("Technical Executive · 12"), opening to
// the people; "No designation" with its warning (they count toward no requirement); people already on another
// roster in the period are tagged and left unticked. Start days: spread within each designation (default), the same
// start for everyone, or continuing from the roster that ends the day before.
import { useState, type Dispatch } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Button, SegmentedControl } from '@/design/kit/display'
import { Checkbox, Select } from '@/design/kit/overlays'
import type { PlannerPerson, RosterSummary, StaggerMode } from '../../../api/rosterTypes'
import { NO_DESIGNATION, otherRostersOf, periodLabel, type PeopleGroup, type PlannerAction, type PlannerState } from '../plannerModel'

export function PeopleStep({ state, dispatch, groups, loading, error, onRetry, continueFrom, outOfScope }: {
  state: PlannerState
  dispatch: Dispatch<PlannerAction>
  groups: PeopleGroup[]
  loading: boolean
  error: unknown
  onRetry: () => void
  /** Published rosters of this scope that end the day before this one starts. */
  continueFrom: RosterSummary[]
  /** Members who are not among the scope's people any more. */
  outOfScope: string[]
}) {
  const [open, setOpen] = useState<Set<string>>(new Set())
  const members = new Set(state.members.map((m) => m.employeeId))
  const all = groups.flatMap((g) => g.people)
  const setMembers = (ids: Set<string>) => {
    // Display order: people already on the roster keep their place; new ones follow in the list's order.
    dispatch({ type: 'members', employeeIds: [...state.members.map((m) => m.employeeId).filter((id) => ids.has(id)), ...all.map((p) => p.employeeId).filter((id) => ids.has(id) && !members.has(id))] })
    dispatch({ type: 'designations', designationIds: groups.filter((g) => g.people.some((p) => ids.has(p.employeeId))).map((g) => g.designationId) })
  }
  const toggleGroup = (g: PeopleGroup, on: boolean) => {
    const ids = new Set(members)
    for (const p of g.people) if (on) { if (!otherRostersOf(p, state.rosterId).length) ids.add(p.employeeId) } else ids.delete(p.employeeId)
    setMembers(ids)
  }
  const togglePerson = (p: PlannerPerson, on: boolean) => {
    const ids = new Set(members)
    if (on) ids.add(p.employeeId); else ids.delete(p.employeeId)
    setMembers(ids)
  }
  const stagger = state.config.staggerMode
  const setStagger = (mode: StaggerMode, from?: string | null) => dispatch({ type: 'stagger', mode, continueFromRosterId: mode === 'CONTINUE' ? from ?? continueFrom[0]?.id ?? null : null })

  if (loading) return <p className="spl-note">Loading the people in this scope…</p>
  if (error) return <div className="spl-note" data-tone="red">Couldn’t load the people. <Button variant="ghost" size={30} onClick={onRetry}>Try again</Button></div>
  return (
    <div className="spl-form">
      {groups.length === 0 && <p className="spl-note">No one works in this scope.</p>}
      <ul className="spl-groups">
        {groups.map((g) => {
          const inGroup = g.people.filter((p) => members.has(p.employeeId)).length
          const isOpen = open.has(g.designationId)
          return (
            <li key={g.designationId || 'none'} className="spl-groups__item">
              <div className="spl-groups__head">
                <Checkbox checked={inGroup > 0} aria-checked={inGroup > 0 && inGroup < g.people.length ? 'mixed' : undefined}
                  onChange={(on) => toggleGroup(g, on)}
                  label={<span>{g.name} <span className="spl-groups__count">· {inGroup === g.people.length ? g.people.length : `${inGroup} of ${g.people.length}`}</span></span>}
                  description={g.designationId === NO_DESIGNATION ? 'They count toward no staffing requirement.' : undefined} />
                <button type="button" className="spl-groups__open" aria-expanded={isOpen} aria-label={`${isOpen ? 'Hide' : 'Show'} ${g.name}`}
                  onClick={() => setOpen((s) => { const n = new Set(s); if (n.has(g.designationId)) n.delete(g.designationId); else n.add(g.designationId); return n })}>
                  {isOpen ? <ChevronDown size={15} aria-hidden="true" /> : <ChevronRight size={15} aria-hidden="true" />}
                </button>
              </div>
              {isOpen && (
                <ul className="spl-groups__people">
                  {g.people.map((p) => {
                    const other = otherRostersOf(p, state.rosterId)
                    return (
                      <li key={p.employeeId}>
                        <Checkbox checked={members.has(p.employeeId)} onChange={(on) => togglePerson(p, on)}
                          label={<span>{p.name}{p.code ? <span className="apl-muted"> · {p.code}</span> : null}</span>}
                          description={other.length ? other.map((o) => `On ‘${o.name}’, ${periodLabel(o.startDate, o.endDate)}`).join('; ') : undefined} />
                      </li>
                    )
                  })}
                </ul>
              )}
            </li>
          )
        })}
      </ul>
      {outOfScope.length > 0 && (
        <div className="spl-note" data-tone="amber">
          {outOfScope.length === 1 ? '1 person on this roster isn’t' : `${outOfScope.length} people on this roster aren’t`} in this scope any more.{' '}
          <Button variant="ghost" size={30} onClick={() => dispatch({ type: 'members', employeeIds: state.members.map((m) => m.employeeId).filter((id) => !outOfScope.includes(id)) })}>Remove them</Button>
        </div>
      )}
      <div className="spl-field">
        <span className="spl-field__label">Start days</span>
        <SegmentedControl label="Start days" semantics="radio" size="sm" value={stagger} onChange={(v) => setStagger(v as StaggerMode)}
          options={[{ value: 'SPREAD', label: 'Spread' }, { value: 'SAME', label: 'Same start' }, { value: 'CONTINUE', label: 'Continue', disabled: !continueFrom.length }]} />
        <span className="spl-field__hint">
          {stagger === 'SPREAD' ? 'People of each designation start on different days of the pattern, so every shift is covered.'
            : stagger === 'SAME' ? 'Everyone starts on day 1 of the pattern.'
              : 'Each person carries on from where they were on the previous roster; new people are spread.'}
          {!continueFrom.length && stagger !== 'CONTINUE' ? ' “Continue” needs a published roster of this scope ending the day before.' : ''}
        </span>
        {stagger === 'CONTINUE' && continueFrom.length > 1 && (
          <Select size="md" aria-label="Continue from" value={state.config.continueFromRosterId ?? ''} onChange={(e) => setStagger('CONTINUE', e.target.value)}
            options={continueFrom.map((r) => ({ value: r.id, label: r.name }))} />
        )}
      </div>
    </div>
  )
}
