// Step 1 — Planning period (design §1.6): Monthly (a month) or Custom range (two dates, at most 62 days); department
// (a department planner picks one of theirs, required) and building (optional); the name, filled in and editable.
// Locked once the roster is published (ROSTER_PERIOD_LOCKED).
import type { Dispatch } from 'react'
import { SegmentedControl } from '@/design/kit/display'
import { DateRangeInput, FieldGrid, Input, MonthInput, Select } from '@/design/kit/overlays'
import type { Branch, Department } from '../../../api/useOrg'
import { MAX_DAYS, monthPeriod, periodLength, rangeProblem, type PlannerAction, type PlannerState } from '../plannerModel'

export function PeriodStep({ state, dispatch, departments, branches, companyWide, departmentsError, scopeLabel }: {
  state: PlannerState
  dispatch: Dispatch<PlannerAction>
  departments: Department[]
  branches: Branch[]
  companyWide: boolean
  departmentsError?: boolean
  /** The scope's name for the roster's default name ("Technical", "Technical · Plant 2"). */
  scopeLabel: (departmentId: string | null, branchId: string | null) => string | null
}) {
  const locked = state.status === 'PUBLISHED'
  const problem = rangeProblem(state.startDate, state.endDate)
  const setPeriod = (periodType: 'MONTH' | 'RANGE', startDate: string, endDate: string) =>
    dispatch({ type: 'period', periodType, startDate, endDate, scopeLabel: scopeLabel(state.departmentId, state.branchId) })
  const setScope = (departmentId: string | null, branchId: string | null) =>
    dispatch({ type: 'scope', departmentId, branchId, scopeLabel: scopeLabel(departmentId, branchId) })

  return (
    <div className="apl-form spl-form">
      <SegmentedControl label="Planning type" semantics="radio" size="sm" value={state.periodType}
        onChange={(v) => {
          if (locked) return
          if (v === 'MONTH') { const m = monthPeriod(state.startDate.slice(0, 7)); setPeriod('MONTH', m.startDate, m.endDate) }
          else setPeriod('RANGE', state.startDate, state.endDate)
        }}
        options={[{ value: 'MONTH', label: 'Monthly', disabled: locked }, { value: 'RANGE', label: 'Custom range', disabled: locked }]} />
      {state.periodType === 'MONTH' ? (
        <MonthInput label="Month" size="md" required disabled={locked} value={state.startDate.slice(0, 7)} presets={false}
          onChange={(_e, v) => { if (v) { const m = monthPeriod(v); setPeriod('MONTH', m.startDate, m.endDate) } }} />
      ) : (
        <DateRangeInput label="Dates" size="md" required disabled={locked} months={1} presets={false}
          value={{ from: state.startDate, to: state.endDate }}
          hint={problem ? undefined : `${periodLength(state.startDate, state.endDate)} days (at most ${MAX_DAYS}).`}
          error={problem ?? undefined}
          onChange={(_e, v) => { if (v.from && v.to) setPeriod('RANGE', v.from, v.to) }} />
      )}
      <FieldGrid columns={2} size="md">
        <Select label="Department" size="md" required={!companyWide} disabled={locked} value={state.departmentId ?? ''}
          placeholder={companyWide ? 'Whole company' : undefined}
          hint={departmentsError ? 'Couldn’t load the departments.' : !companyWide ? 'You plan the departments you head.' : undefined}
          onChange={(e) => setScope(e.target.value || null, state.branchId)}
          options={departments.map((d) => ({ value: d.id, label: d.name }))} />
        <Select label="Building" size="md" disabled={locked} value={state.branchId ?? ''} placeholder="All buildings"
          onChange={(e) => setScope(state.departmentId, e.target.value || null)}
          options={branches.filter((b) => b.active !== false).map((b) => ({ value: b.id, label: b.name }))} />
      </FieldGrid>
      <Input label="Roster name" size="md" required maxLength={120} value={state.name} onChange={(e) => dispatch({ type: 'name', name: e.target.value })} />
      {locked && <p className="spl-note">The period and scope of a published roster can’t change. Plan a new roster for other dates.</p>}
    </div>
  )
}
