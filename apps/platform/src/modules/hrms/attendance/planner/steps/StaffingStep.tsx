// Step 4 — Staffing (design §1.6, D-S2): how many people of each designation each shift needs, the same every day
// of the period. Rows are the designations among the scope's people (plus any added); columns the ticked shifts;
// blank = no requirement. The coverage rows and the "Required coverage met" check follow these numbers.
import { useMemo, useState, type Dispatch } from 'react'
import { Button, errorText } from '@/design/kit/display'
import { Select, useToast } from '@/design/kit/overlays'
import { apiJson } from '@/core/api/client'
import type { RosterDetail, RosterSummary } from '../../../api/rosterTypes'
import type { Designation } from '../../../api/useOrg'
import { NO_DESIGNATION, type PeopleGroup, type PlannerAction, type PlannerState, type ShiftLite } from '../plannerModel'

export function StaffingStep({ state, dispatch, ticked, groups, designations, previous }: {
  state: PlannerState
  dispatch: Dispatch<PlannerAction>
  ticked: ShiftLite[]
  /** The scope's people by designation. */
  groups: PeopleGroup[]
  /** The company's designations, for "Add designation" (empty when they can't be read). */
  designations: Designation[]
  /** The roster to copy the numbers from, when there is one. */
  previous: RosterSummary | null
}) {
  const toast = useToast()
  const [added, setAdded] = useState<string[]>([])
  const [copying, setCopying] = useState(false)
  const names = useMemo(() => {
    const m = new Map<string, string>()
    for (const d of designations) m.set(d.id, d.title)
    for (const g of groups) if (g.designationId !== NO_DESIGNATION) m.set(g.designationId, g.name)
    return m
  }, [designations, groups])
  const rows = useMemo(() => {
    const ids = [...groups.filter((g) => g.designationId !== NO_DESIGNATION).map((g) => g.designationId)]
    for (const id of [...state.staffing.map((x) => x.designationId), ...added]) if (!ids.includes(id)) ids.push(id)
    return ids
  }, [groups, state.staffing, added])
  const count = (id: string) => groups.find((g) => g.designationId === id)?.people.length ?? 0
  const value = (d: string, s: string) => state.staffing.find((x) => x.designationId === d && x.shiftPolicyId === s)?.required
  const set = (d: string, s: string, raw: string) => {
    const t = raw.trim()
    const n = t === '' ? null : Math.max(0, Math.min(999, Math.round(Number(t))))
    if (n != null && !Number.isFinite(n)) return
    dispatch({ type: 'required', designationId: d, shiftPolicyId: s, required: n })
  }
  const copy = async () => {
    if (!previous) return
    setCopying(true)
    try {
      const d = await apiJson<RosterDetail>(`/v1/rosters/${previous.id}`)
      dispatch({ type: 'staffing', staffing: d.staffing })
      toast.success(`Numbers copied from ${previous.name}`)
    } catch (e) { toast.error('Couldn’t copy the numbers', { detail: errorText(e, 'Try again in a moment.') }) } finally { setCopying(false) }
  }
  const addable = designations.filter((d) => d.active !== false && !rows.includes(d.id))

  if (!ticked.length) return <p className="spl-note">Tick the shifts in step 2 first.</p>
  return (
    <div className="spl-form">
      {rows.length === 0 ? <p className="spl-note">No one in this scope has a designation yet.</p> : (
        <div className="spl-staff" role="group" aria-label="Staffing requirement">
          <table className="spl-staff__table">
            <thead>
              <tr>
                <th scope="col">Designation</th>
                {ticked.map((s) => <th key={s.id} scope="col" title={`${s.name} ${s.start}–${s.end}`}><span className="spl-code spl-code--sm" data-tone={s.tone}>{s.code}</span></th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d}>
                  <th scope="row"><span className="spl-staff__name">{names.get(d) ?? 'Designation'}</span><span className="spl-staff__count">{count(d)}</span></th>
                  {ticked.map((s) => (
                    <td key={s.id}>
                      <input className="spl-staff__input" type="number" inputMode="numeric" min={0} max={999} placeholder="–"
                        aria-label={`${names.get(d) ?? 'Designation'} on ${s.code}`} value={value(d, s.id) ?? ''} onChange={(e) => set(d, s.id, e.target.value)} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="spl-links">
        {addable.length > 0 && (
          <Select size="md" aria-label="Add designation" value="" placeholder="Add designation" fieldClassName="spl-inline-select"
            onChange={(e) => { if (e.target.value) setAdded((a) => [...a, e.target.value]) }}
            options={addable.map((d) => ({ value: d.id, label: d.title }))} />
        )}
        {previous && <Button variant="ghost" size={32} loading={copying} onClick={copy}>Copy from {previous.name}</Button>}
      </div>
      <p className="spl-note">Blank means no requirement. The same numbers apply on every day of the period; holidays aren’t checked.</p>
    </div>
  )
}
