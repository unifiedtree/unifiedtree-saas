// Step 6 — Weekly off and holidays (design §1.6; pending-owner default 4): Fixed (each person's usual weekly off days),
// Rotational (the WO days in the pattern) or Custom (picked in the preview). The period's holidays come from Settings ›
// Holidays (D-S6); "Add holiday" adds one to the company calendar there (settings.holidays.write).
import { useState, type Dispatch } from 'react'
import { Button, errorText } from '@/design/kit/display'
import { DateInput, FieldGrid, Input, PanelButton, Select, SidePanel, useToast } from '@/design/kit/overlays'
import type { WeeklyOffMode } from '../../../api/rosterTypes'
import { useCreateHoliday, type HolidayResponse, type HolidayType } from '../../../api/useSettings'
import { patternNote, type PlannerAction, type PlannerState } from '../plannerModel'

export const OFF_MODES: { value: WeeklyOffMode; label: string; hint: string }[] = [
  { value: 'FIXED', label: 'Fixed', hint: 'Each person’s usual weekly off days.' },
  { value: 'ROTATIONAL', label: 'Rotational', hint: 'The WO days in the pattern.' },
  { value: 'CUSTOM', label: 'Custom', hint: 'You pick days off in the preview.' },
]
const TYPES: { value: HolidayType; label: string }[] = [
  { value: 'COMPANY', label: 'Company holiday' }, { value: 'NATIONAL', label: 'National' }, { value: 'FESTIVAL', label: 'Festival' },
  { value: 'REGIONAL', label: 'Regional' }, { value: 'OPTIONAL', label: 'Optional' }, { value: 'RESTRICTED', label: 'Restricted' },
]
const DMON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const dm = (iso: string) => `${Number(iso.slice(8, 10))} ${DMON[Number(iso.slice(5, 7)) - 1]}`

export function OffsStep({ state, dispatch, holidays, holidaysLoading, companyId, canAddHoliday, onHolidayAdded }: {
  state: PlannerState
  dispatch: Dispatch<PlannerAction>
  /** The period's active holidays. */
  holidays: HolidayResponse[]
  holidaysLoading: boolean
  companyId: string
  canAddHoliday: boolean
  onHolidayAdded: () => void
}) {
  const toast = useToast()
  const create = useCreateHoliday()
  const [draft, setDraft] = useState<{ date: string; name: string; type: HolidayType } | null>(null)
  const mode = state.config.weeklyOffMode
  const note = state.config.pattern.length ? patternNote(state.config.pattern, mode) : null
  const inPeriod = !!draft?.date && draft.date >= state.startDate && draft.date <= state.endDate
  const blocked = !draft ? null : !draft.date ? 'Pick the day' : !inPeriod ? 'Pick a day in this roster’s period' : !draft.name.trim() ? 'Give the holiday a name' : null
  const add = async () => {
    if (!draft || blocked) return
    try {
      await create.mutateAsync({ companyId, holidayDate: draft.date, holidayName: draft.name.trim(), holidayType: draft.type })
      toast.success(`${draft.name.trim()} added on ${dm(draft.date)}`, { detail: 'It is on the company’s holiday calendar now.' })
      setDraft(null)
      onHolidayAdded()
    } catch (e) { toast.error('Couldn’t add the holiday', { detail: errorText(e, 'Try again in a moment.') }) }
  }

  return (
    <div className="spl-form">
      <div className="spl-radios" role="radiogroup" aria-label="Weekly off">
        {OFF_MODES.map((m) => (
          <label key={m.value} className="spl-radio" data-on={mode === m.value ? '' : undefined}>
            <input type="radio" name="spl-off-mode" value={m.value} checked={mode === m.value} onChange={() => dispatch({ type: 'weeklyOffMode', mode: m.value })} />
            <span><b>{m.label}</b><span className="spl-radio__hint">{m.hint}</span></span>
          </label>
        ))}
      </div>
      {note && <p className="spl-note" data-tone="amber">{note}</p>}
      <div className="spl-field">
        <span className="spl-field__label">Holidays in this period</span>
        {holidaysLoading ? <span className="spl-field__hint">Loading…</span> : holidays.length === 0 ? <span className="spl-field__hint">None in Settings › Holidays.</span> : (
          <ul className="spl-holidays">
            {holidays.map((h) => <li key={h.id}><span className="spl-code spl-code--sm" data-tone="ph">PH</span><b>{dm(h.holidayDate)}</b> {h.holidayName}</li>)}
          </ul>
        )}
        {canAddHoliday
          ? <div><Button variant="ghost" size={32} icon="plus" onClick={() => setDraft({ date: '', name: '', type: 'COMPANY' })}>Add holiday</Button></div>
          : <span className="spl-field__hint">Ask HR to add holidays in Settings › Holidays.</span>}
      </div>

      <SidePanel open={!!draft} onClose={() => setDraft(null)} busy={create.isPending} title="Add a holiday" sub="It goes on the company’s holiday calendar, for everyone in the company."
        footer={(
          <>
            <PanelButton variant="secondary" size="lg" onClick={() => setDraft(null)} disabled={create.isPending}>Cancel</PanelButton>
            <PanelButton variant="primary" size="lg" busy={create.isPending} blockedReason={blocked} onClick={add}>Add holiday</PanelButton>
          </>
        )}>
        {draft && (
          <div className="apl-form">
            <FieldGrid columns={2}>
              <DateInput label="Day" required min={state.startDate} max={state.endDate} value={draft.date} presets={false} onChange={(_e, v) => setDraft({ ...draft, date: v })} />
              <Select label="Type" value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value as HolidayType })} options={TYPES} />
            </FieldGrid>
            <Input label="Name" required maxLength={120} placeholder="e.g. Company holiday" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </div>
        )}
      </SidePanel>
    </div>
  )
}
