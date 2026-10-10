// Step 7 — Generate (design §1.6): "Generate schedule" the first time; then "Regenerate" with "Keep my edits" (on) and
// "Reset my edits". Generating saves nothing: the roster is a draft until Save draft, and seen by people only once
// published.
import type { Dispatch } from 'react'
import { Button } from '@/design/kit/display'
import { Toggle } from '@/design/kit/overlays'
import type { PlannerAction, PlannerState } from '../plannerModel'

export const generateBlocker = (s: PlannerState) => (!s.members.length ? 'Tick the people in step 5 first.' : !s.config.pattern.length ? 'Build or choose a pattern in step 3 first.' : null)
export const editedCount = (s: PlannerState) => Object.values(s.rows).reduce((n, r) => n + r.edited.length, 0)

export function GenerateStep({ state, dispatch, busy }: { state: PlannerState; dispatch: Dispatch<PlannerAction>; busy?: boolean }) {
  const blocker = generateBlocker(state)
  const edits = editedCount(state)
  if (!state.generated) {
    return (
      <div className="spl-form">
        <p className="spl-field__hint">Lays the pattern over the period for everyone ticked, then checks coverage. Nothing is saved until you save the draft.</p>
        <div><Button icon="calendarCheck" disabled={!!blocker} onClick={() => dispatch({ type: 'generate' })}>Generate schedule</Button></div>
        {blocker && <p className="spl-note">{blocker}</p>}
      </div>
    )
  }
  return (
    <div className="spl-form">
      <Toggle size="md" checked={state.keepEdits} onChange={(on) => dispatch({ type: 'keepEdits', on })} label="Keep my edits"
        description={state.keepEdits ? 'Days you changed by hand stay as they are when the pattern is laid again.' : 'Laying the pattern again replaces days you changed by hand.'} />
      <div className="spl-actions spl-actions--left">
        <Button variant="secondary" loading={busy && state.pendingRegenerate} disabled={!!blocker} onClick={() => dispatch({ type: 'generate' })}>Regenerate</Button>
        <Button variant="ghost" disabled={!edits} onClick={() => dispatch({ type: 'resetEdits' })}>Reset my edits{edits ? ` (${edits})` : ''}</Button>
      </div>
      {blocker && <p className="spl-note">{blocker}</p>}
    </div>
  )
}
