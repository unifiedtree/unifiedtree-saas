// Step 2 — Shifts (design §1.6): the company's active shifts as a checklist (code, name, start–end, break as the shift
// drawer derives it, Night, people on it today). Shift Schedules stays the one place shifts are defined: "Add custom
// shift" and "Edit shifts" open it in a new browser tab, and the planner reads the shifts again when it gets focus back.
import type { Dispatch } from 'react'
import { ExternalLink } from 'lucide-react'
import { Checkbox } from '@/design/kit/overlays'
import { hm } from '../../shifts/shiftModel'
import type { PlannerAction, PlannerState, ShiftLite } from '../plannerModel'

export function ShiftsStep({ state, dispatch, shifts, canEditShifts, loading }: {
  state: PlannerState
  dispatch: Dispatch<PlannerAction>
  shifts: ShiftLite[]
  canEditShifts: boolean
  loading?: boolean
}) {
  const ticked = new Set(state.config.shiftIds)
  const toggle = (id: string, on: boolean) => {
    const next = shifts.filter((s) => (s.id === id ? on : ticked.has(s.id))).map((s) => s.id)
    dispatch({ type: 'shifts', shiftIds: next })
  }
  if (loading) return <p className="spl-note">Loading the shifts…</p>
  return (
    <div className="spl-form">
      {shifts.length === 0 && <p className="spl-note" data-tone="amber">There are no shifts yet.{canEditShifts ? ' Add one in Shift Schedules.' : ' Ask HR to add shifts in Shift Schedules.'}</p>}
      <ul className="spl-shifts">
        {shifts.map((s) => (
          <li key={s.id} className="spl-shifts__item">
            <Checkbox checked={ticked.has(s.id)} onChange={(on) => toggle(s.id, on)}
              label={<span className="spl-shifts__label"><span className="spl-code" data-tone={s.tone}>{s.code}</span><b>{s.name}</b>{s.night && <span className="spl-tag">Night</span>}</span>}
              description={[
                `${s.start}–${s.end}`,
                s.breakMinutes ? `${hm(s.breakMinutes)} break` : 'No break',
                s.people != null ? `${s.people} ${s.people === 1 ? 'person' : 'people'} today` : null,
                s.hasCode ? null : 'Add a code to use it in imports',
              ].filter(Boolean).join(' · ')} />
          </li>
        ))}
      </ul>
      {canEditShifts && (
        <div className="spl-links">
          <a className="spl-link" href="/hrms/shifts?tab=schedules&add=1" target="_blank" rel="noopener">Add custom shift <ExternalLink size={13} aria-hidden="true" /></a>
          <a className="spl-link" href="/hrms/shifts?tab=schedules" target="_blank" rel="noopener">Edit shifts <ExternalLink size={13} aria-hidden="true" /></a>
        </div>
      )}
      <p className="spl-note">Changes to a shift apply everywhere it is used.</p>
    </div>
  )
}
