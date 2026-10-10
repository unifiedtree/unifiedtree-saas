// Step 3 — Pattern (design §1.6): use a saved pattern, or build one with the pattern builder; "Save as pattern…"
// keeps it for later rosters. Changing the pattern lays the roster again (edited cells stay with "Keep my edits").
import { useState, type Dispatch } from 'react'
import { Button, errorText } from '@/design/kit/display'
import { Dialog, Input, PanelButton, Select, useToast } from '@/design/kit/overlays'
import { errorCodeOf } from '@/core/api/featureNotReady'
import type { RotationTemplate } from '../../../api/rosterTypes'
import { useSaveTemplate } from '../../../api/useRosters'
import { PatternBuilder } from '../PatternBuilder'
import { patternDay, samePattern, type PlannerAction, type PlannerState, type ShiftLite } from '../plannerModel'

export function PatternStep({ state, dispatch, templates, shifts, ticked, companyId, canSaveTemplate }: {
  state: PlannerState
  dispatch: Dispatch<PlannerAction>
  templates: RotationTemplate[]
  /** Every active shift (a saved pattern may use one that isn't ticked). */
  shifts: ShiftLite[]
  ticked: ShiftLite[]
  companyId: string
  canSaveTemplate: boolean
}) {
  const toast = useToast()
  const saveTemplate = useSaveTemplate()
  const [naming, setNaming] = useState<string | null>(null)
  const { pattern, repeats, templateId, weeklyOffMode } = state.config
  const chosen = templates.find((t) => t.id === templateId)
  // The builder offers the ticked shifts plus any the pattern already uses.
  const offered = [...ticked, ...shifts.filter((s) => !ticked.some((t) => t.id === s.id) && pattern.some((d) => d.shiftPolicyId === s.id))]

  const applyTemplate = (id: string) => {
    const t = templates.find((x) => x.id === id)
    if (t) dispatch({ type: 'pattern', pattern: t.days.map((d) => ({ ...d })), repeats: t.repeats, templateId: t.id })
  }
  const change = (days: typeof pattern, rep: boolean) => {
    // Still the saved pattern only while it matches it.
    const keep = chosen && samePattern(chosen.days, days) && chosen.repeats === rep ? chosen.id : null
    dispatch({ type: 'pattern', pattern: days, repeats: rep, templateId: keep })
  }
  const start = () => change(ticked.length ? [...ticked.slice(0, 3).flatMap((s) => [patternDay(s.id), patternDay(s.id)]), patternDay('WO')] : [patternDay('WO')], true)

  const saveAs = async () => {
    const name = (naming ?? '').trim()
    if (!name) return
    try {
      const t = await saveTemplate.mutateAsync({ companyId, body: { name, departmentId: state.departmentId, repeats, days: pattern } })
      dispatch({ type: 'pattern', pattern, repeats, templateId: t.id })
      toast.success(`${name} saved as a pattern`)
      setNaming(null)
    } catch (e) {
      toast.error('Couldn’t save the pattern', { detail: errorCodeOf(e) === 'TEMPLATE_NAME_TAKEN' ? 'A pattern with this name already exists.' : errorText(e, 'Try again in a moment.') })
    }
  }

  return (
    <div className="spl-form">
      {templates.length > 0 && (
        <Select label="Use a saved pattern" size="md" value={chosen?.id ?? ''} placeholder={pattern.length ? 'Your own pattern' : 'Choose a pattern'}
          onChange={(e) => { if (e.target.value) applyTemplate(e.target.value) }}
          options={templates.map((t) => ({ value: t.id, label: `${t.name} · ${t.days.length} days` }))} />
      )}
      {pattern.length === 0 ? (
        <div className="spl-empty spl-empty--left">
          <span className="apl-muted">Build the cycle each person follows, such as A A B B C C WO.</span>
          <Button variant="secondary" icon="plus" onClick={start}>Build a pattern</Button>
        </div>
      ) : (
        <>
          <PatternBuilder days={pattern} repeats={repeats} shifts={offered} weeklyOffMode={weeklyOffMode} onChange={change} />
          {canSaveTemplate && !chosen && <div><Button variant="ghost" size={32} onClick={() => setNaming('')}>Save as pattern…</Button></div>}
        </>
      )}
      <Dialog open={naming != null} onClose={() => setNaming(null)} busy={saveTemplate.isPending} title="Save as pattern" sub="Use it again for later rosters."
        footer={(
          <>
            <PanelButton variant="secondary" onClick={() => setNaming(null)} disabled={saveTemplate.isPending}>Cancel</PanelButton>
            <PanelButton variant="primary" busy={saveTemplate.isPending} blockedReason={(naming ?? '').trim() ? null : 'Give the pattern a name'} onClick={saveAs}>Save pattern</PanelButton>
          </>
        )}>
        <Input label="Name" required maxLength={80} placeholder="e.g. Technical team rotation" value={naming ?? ''} onChange={(e) => setNaming(e.target.value)} />
      </Dialog>
    </div>
  )
}
