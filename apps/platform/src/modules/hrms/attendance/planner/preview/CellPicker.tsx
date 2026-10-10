// The cell picker (design §1.6 "Cell edits"): the ticked shifts' codes with name and time, WO and Clear, for one
// cell or a selected range. Opens from the grid next to the cell it was asked on.
import type { RefObject } from 'react'
import { Popover } from '@/design/kit/overlays'
import { WO_TOKEN, type CellToken } from '../../../api/rosterTypes'
import type { ShiftLite } from '../plannerModel'

export function CellPicker({ open, anchorRef, onClose, shifts, current, count, onPick }: {
  open: boolean
  anchorRef: RefObject<HTMLElement | null>
  onClose: () => void
  shifts: readonly ShiftLite[]
  /** The token the cell has now (marked in the list), when one cell is picked. */
  current?: CellToken
  /** How many days the choice fills. */
  count: number
  onPick: (token: CellToken) => void
}) {
  const pick = (t: CellToken) => { onPick(t); onClose() }
  return (
    <Popover open={open} anchorRef={anchorRef} onClose={onClose} placement="bottom-start" role="dialog" aria-label="Choose a shift" initialFocus="first" width={248} className="spl-picker">
      <div className="spl-picker__head">{count > 1 ? `Fill ${count} days` : 'Set this day'}</div>
      <div className="spl-picker__list" role="group" aria-label="Shifts">
        {shifts.map((s) => (
          <button key={s.id} type="button" className="spl-picker__opt" aria-pressed={current === s.id} onClick={() => pick(s.id)}>
            <span className="spl-code" data-tone={s.tone}>{s.code}</span>
            <span className="spl-picker__name">{s.name}</span>
            <span className="spl-picker__time">{s.start}–{s.end}</span>
          </button>
        ))}
        <button type="button" className="spl-picker__opt" aria-pressed={current === WO_TOKEN} onClick={() => pick(WO_TOKEN)}>
          <span className="spl-code" data-tone="wo">WO</span>
          <span className="spl-picker__name">Weekly off</span>
          <span className="spl-picker__time">W</span>
        </button>
        <button type="button" className="spl-picker__opt spl-picker__opt--clear" onClick={() => pick(null)}>
          <span className="spl-code" data-tone="">–</span>
          <span className="spl-picker__name">Clear</span>
          <span className="spl-picker__time">Del</span>
        </button>
      </div>
      {!shifts.length && <p className="spl-picker__note">Tick shifts in step 2 to plan them here.</p>}
    </Popover>
  )
}
