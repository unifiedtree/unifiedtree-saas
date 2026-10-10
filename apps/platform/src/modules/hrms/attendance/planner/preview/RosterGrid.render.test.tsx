// The live preview's grid, rendered as markup (the repo has no DOM test environment): codes, overlays, totals, issue
// outlines, hatched days outside employment, edited dots, locked days, read-only mode and the coverage rows.
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { WO_TOKEN } from '../../../api/rosterTypes'
import { coverageView, fromDetail, gridView, plannerReducer, toShiftLites } from '../plannerModel'
import { RosterGrid, TOTAL_COLUMNS } from './RosterGrid'
import { CoverageRows } from './CoverageRows'
import { checkLines, ScheduleCheck } from './ScheduleCheck'
import { DES, PEOPLE, POLICIES, SH, cell, checks, detail, emp, issue, planOf } from '../__fixtures__/rosterFixtures'

const shifts = toShiftLites(POLICIES)
const shiftMap = new Map(shifts.map((s) => [s.id, s]))
const people = new Map(PEOPLE.map((p) => [p.employeeId, p]))

function state() {
  const rows = [
    { employeeId: emp(1), cells: [SH.A, SH.A, SH.B, SH.B, SH.C, SH.C, WO_TOKEN], edited: [2] },
    { employeeId: emp(2), cells: [SH.B, null, SH.C, SH.C, WO_TOKEN, SH.A, SH.A], edited: [] },
  ]
  const plan = planOf('2026-10-01', '2026-10-07', [
    { employeeId: emp(1), name: 'Surender Rao', designationId: DES.TE, cells: [cell(SH.A, 'A'), cell(SH.A, 'A', { overlay: { type: 'PH', label: 'Gandhi Jayanti', halfDay: false } }), cell(SH.B, 'B', { edited: true }), cell(SH.B, 'B', { issueIds: ['w4'] }), cell(SH.C, 'C', { issueIds: ['e1'] }), cell(SH.C, 'C'), cell(WO_TOKEN, 'WO')] },
    { employeeId: emp(2), name: 'Rakesh Kumar', designationId: DES.TE, cells: [cell(SH.B, 'B', { overlay: { type: 'L', label: 'Casual leave', halfDay: true } }), cell(null, null, { outside: true }), cell(SH.C, 'C'), cell(SH.C, 'C'), cell(WO_TOKEN, 'WO'), cell(SH.A, 'A'), cell(SH.A, 'A')] },
  ], {
    checks: checks({ errors: [issue('e1', 'E1', 'error', { message: 'Shift C (Night) was deleted. Choose another shift for 3 days.' })], warnings: [issue('w4', 'W4', 'warning', { employeeId: emp(1), dates: ['2026-10-04'], message: 'Surender: 6 h rest between B on 4 Oct and C on 5 Oct.' })], summary: [{ id: 'W1', level: 'warning', count: 0, label: '✓ All employees assigned' }, { id: 'W4', level: 'warning', count: 1, label: '⚠ 1 employee has insufficient rest' }] }),
    coverage: [
      { shiftPolicyId: SH.A, code: 'A', designationId: null, perDay: [{ required: 1, scheduled: 1, status: 'OK' }, { required: 1, scheduled: 1, status: 'HOLIDAY' }, { required: 1, scheduled: 0, status: 'SHORT' }, { required: null, scheduled: 0, status: 'NONE' }, { required: 1, scheduled: 0, status: 'SHORT' }, { required: 1, scheduled: 2, status: 'OVER' }, { required: 1, scheduled: 1, status: 'OK' }] },
    ],
  })
  const s = fromDetail(detail({ roster: { startDate: '2026-10-01', endDate: '2026-10-07', periodType: 'RANGE' }, rows, plan }), '2026-10-01')
  return plannerReducer(s, { type: 'refresh' })
}

describe('RosterGrid', () => {
  it('shows codes, overlays, totals, issue outlines and edited days', () => {
    const s = state()
    const out = renderToStaticMarkup(<RosterGrid view={gridView(s, shiftMap, people)} shifts={shifts} onEdit={() => {}} />)
    expect(out).toContain('Surender Rao')
    expect(out).toContain('EMP001')
    expect((out.match(/class="spl-cell"/g) ?? []).length).toBe(14)
    expect(out).toContain('data-type="PH"')
    expect(out).toContain('L½')
    expect(out).toContain('data-level="error"')
    expect(out).toContain('data-level="warning"')
    expect(out).toContain('data-outside=""')
    expect((out.match(/spl-cell__dot/g) ?? []).length).toBe(1)
    expect(out).toContain('>WO<')
    expect(out).toContain('title="Working days"')
    expect(out).toContain('Surender Rao · Thu 1 Oct · A · Morning 06:00–14:00')
  })
  it('is read-only for the import page: no picker, cells marked read-only, no row menu', () => {
    const s = state()
    const out = renderToStaticMarkup(<RosterGrid view={gridView(s, shiftMap, people)} shifts={shifts} readOnly rowMenu={() => [{ key: 'x', label: 'Clear row' }]} />)
    expect(out).toContain('aria-readonly="true"')
    expect(out).not.toContain('Actions for')
    expect(out).toContain('data-readonly=""')
  })
  it('offers the row menu when editable', () => {
    const s = state()
    const out = renderToStaticMarkup(<RosterGrid view={gridView(s, shiftMap, people)} shifts={shifts} onEdit={() => {}} rowMenu={() => [{ key: 'x', label: 'Clear row' }]} />)
    expect(out).toContain('aria-label="Actions for Surender Rao"')
  })
  it('says who is missing when there are no rows', () => {
    const s = plannerReducer(state(), { type: 'members', employeeIds: [] })
    expect(renderToStaticMarkup(<RosterGrid view={gridView(s, shiftMap, people)} shifts={shifts} empty="Tick people in step 5." />)).toContain('Tick people in step 5.')
  })
  it('draws coverage per shift per day under the grid', () => {
    const s = state()
    const groups = coverageView(s.plan, s.config.shiftIds, shiftMap, new Map())
    const out = renderToStaticMarkup(<table><CoverageRows groups={groups} dayCount={7} trailing={TOTAL_COLUMNS} expanded={new Set()} onToggle={() => {}} /></table>)
    expect(out).toContain('Coverage')
    expect(out).toContain('A · Morning')
    expect(out).toContain('2 short')
    expect(out).toContain('data-tone="ok"')
    expect(out).toContain('>0/1<')
    expect(out).toContain('>2/1<')
    expect(out).toContain('>–<')
  })
})

describe('ScheduleCheck', () => {
  it('lists the check lines, problems first, ticks for the ones that pass', () => {
    const s = state()
    const lines = checkLines(s.plan!.checks)
    expect(lines.map((l) => `${l.id}:${l.count}`)).toEqual(['E1:1', 'W4:1', 'W1:0'])
    const out = renderToStaticMarkup(<ScheduleCheck checks={s.plan!.checks} />)
    expect(out).toContain('Schedule check')
    expect(out).toContain('All employees assigned')
    expect(out).toContain('1 employee has insufficient rest')
    expect(out).toContain('Shifts that can still be used')
    expect(out).not.toContain('⚠ 1 employee')
  })
  it('asks to generate before there is anything to check', () => {
    expect(renderToStaticMarkup(<ScheduleCheck checks={null} />)).toContain('Generate the schedule to check it.')
  })
})
