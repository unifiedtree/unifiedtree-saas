import { describe, expect, it } from 'vitest'
import type { ImportValidation, PlanResponse, RosterSummary } from '../../../api/rosterTypes'
import {
  applyError, applySummary, canOpen, changeScope, checkLines, defaultName, filterProblems, furthestStep, initialState, monthPeriod,
  nextMonth, periodLabel, periodLength, periodTypeOf, plannableDepartments, previewTable, problemCounts, problemWhere, rangeProblem,
  replaceableDrafts, stepStates, validateBlocker, withDraft, type ImportProblem, type ImportState,
} from './importModel'

const problem = (severity: ImportProblem['severity'], over: Partial<ImportProblem> = {}): ImportProblem =>
  ({ rowNo: 3, column: 'F', date: '2027-01-01', code: 'UNKNOWN_CODE', severity, message: 'x', ...over })

const plan = (over: Partial<PlanResponse> = {}): PlanResponse => ({
  days: [{ date: '2027-01-01', weekday: 5, holidayName: null }, { date: '2027-01-02', weekday: 6, holidayName: 'Holiday' }],
  rows: [{
    employeeId: 'e1', employeeName: 'Ravi Kumar', employeeCode: 'TV-101', designationId: null, designationName: 'Technician',
    departmentName: 'Technical', branchName: null, rotationOffset: 0,
    cells: [
      { token: 's1', code: 'A', edited: false, overlay: null, outside: false, issueIds: ['k1'] },
      { token: null, code: null, edited: false, overlay: { type: 'PH', label: 'Holiday', halfDay: false }, outside: false, issueIds: [] },
    ],
    totals: { working: 1, weeklyOff: 0, holiday: 1, leave: 0, unplanned: 0 },
  }],
  coverage: [],
  checks: {
    errors: [], infos: [],
    warnings: [{ key: 'k1', id: 'W4', level: 'warning', employeeId: 'e1', dates: ['2027-01-01'], shiftPolicyId: null, designationId: null, message: 'rest' }],
    summary: [
      { id: 'W1', level: 'warning', count: 0, label: 'All employees assigned' },
      { id: 'W4', level: 'warning', count: 1, label: '1 employee has insufficient rest' },
      { id: 'E3', level: 'error', count: 0, label: 'No one is on two rosters' },
    ],
  },
  members: [{ employeeId: 'e1', rotationOffset: 0 }],
  ...over,
})

const validation = (over: Partial<ImportValidation> = {}): ImportValidation => ({
  startDate: '2027-01-01', endDate: '2027-01-31', sheetName: 'Roster', headerRow: 2, rows: [], problems: [],
  summary: { rows: 1, matched: 1, errors: 0, warnings: 0 }, plan: plan(), ...over,
})

const summary = (over: Partial<RosterSummary>): RosterSummary => ({
  id: 'r1', companyId: 'c1', name: 'January', periodType: 'MONTH', startDate: '2027-01-01', endDate: '2027-01-31', departmentId: 'd1',
  departmentName: 'Technical', branchId: null, branchName: null, status: 'DRAFT', source: 'PLANNER', hasUnpublishedChanges: false,
  version: 0, memberCount: 3, publishedByName: null, publishedAt: null, updatedByName: null, updatedAt: '2026-10-10T00:00:00Z',
  canEdit: true, canPublish: true, ...over,
})

const base = (): ImportState => initialState('2026-10-10')

describe('the period', () => {
  it('starts on next month', () => {
    expect(base()).toMatchObject({ periodType: 'MONTH', startDate: '2026-11-01', endDate: '2026-11-30', target: 'new', validation: null })
    expect(nextMonth('2026-12-31')).toBe('2027-01')
  })

  it('works out months, lengths and labels', () => {
    expect(monthPeriod('2027-02')).toEqual({ startDate: '2027-02-01', endDate: '2027-02-28' })
    expect(monthPeriod('2028-02').endDate).toBe('2028-02-29')
    expect(periodLength('2026-10-15', '2026-11-14')).toBe(31)
    expect(periodLabel('2027-01-01', '2027-01-31')).toBe('January 2027')
    expect(periodLabel('2026-10-01', '2026-10-14')).toBe('1 – 14 Oct 2026')
    expect(periodLabel('2026-10-15', '2026-11-14')).toBe('15 Oct – 14 Nov 2026')
    expect(periodLabel('2026-12-20', '2027-01-10')).toBe('20 Dec 2026 – 10 Jan 2027')
    expect(periodTypeOf('2027-01-01', '2027-01-31')).toBe('MONTH')
    expect(periodTypeOf('2027-01-01', '2027-01-30')).toBe('RANGE')
  })

  it('refuses the periods the server refuses', () => {
    expect(rangeProblem('', '2027-01-01')).toBe('Pick the first and last day.')
    expect(rangeProblem('2027-01-10', '2027-01-01')).toBe('The last day is before the first day.')
    expect(rangeProblem('2027-01-01', '2027-03-04')).toBe('A roster covers at most 62 days.')
    expect(rangeProblem('2027-01-01', '2027-03-03')).toBeNull()
  })

  it('names a new roster as the store would', () => {
    expect(defaultName('2027-01-01', '2027-01-31', 'Technical')).toBe('January 2027 · Technical')
    expect(defaultName('2027-01-01', '2027-01-31', '')).toBe('January 2027')
    expect(defaultName('2027-01-01', '2027-01-31', 'x'.repeat(200))).toHaveLength(120)
  })
})

describe('who may import where', () => {
  const deps = [
    { id: 'd2', name: 'Technical', active: true, departmentHeadEmployeeId: 'me' },
    { id: 'd1', name: 'Admin', active: true, departmentHeadEmployeeId: 'other' },
    { id: 'd3', name: 'Old', active: false, departmentHeadEmployeeId: 'me' },
  ]
  it('HR sees every active department; a department head only the ones they head', () => {
    expect(plannableDepartments(deps, true, null).map((d) => d.id)).toEqual(['d1', 'd2'])
    expect(plannableDepartments(deps, false, 'me').map((d) => d.id)).toEqual(['d2'])
    expect(plannableDepartments(deps, false, undefined)).toEqual([])
  })

  it('only never-published drafts can be replaced, newest period first', () => {
    const list = [summary({ id: 'a', startDate: '2026-11-01' }), summary({ id: 'b', status: 'PUBLISHED', version: 1 }),
      summary({ id: 'c', version: 2 }), summary({ id: 'd', startDate: '2027-01-01' })]
    expect(replaceableDrafts(list).map((r) => r.id)).toEqual(['d', 'a'])
  })

  it('choosing a draft takes its period and scope', () => {
    const d = summary({ id: 'x', startDate: '2026-10-15', endDate: '2026-11-14', departmentId: 'd9', branchId: 'b1' })
    const s = withDraft({ ...base(), validation: validation() }, d)
    expect(s).toMatchObject({ target: 'replace', periodType: 'RANGE', startDate: '2026-10-15', endDate: '2026-11-14', departmentId: 'd9', branchId: 'b1', validation: null })
    expect(withDraft(s, null).draft).toBeNull()
  })
})

describe('step gating', () => {
  const ok = { hasFile: true, companyId: 'c1', companyWide: true }

  it('the file can be checked once the period, scope, target and file are set', () => {
    expect(validateBlocker(base(), ok)).toBeNull()
    expect(validateBlocker(base(), { ...ok, companyId: '' })).toBe('Choose the company first.')
    expect(validateBlocker(base(), { ...ok, hasFile: false })).toBe('Choose the roster file.')
    expect(validateBlocker(base(), { ...ok, companyWide: false })).toBe('Choose one of the departments you head.')
    expect(validateBlocker({ ...base(), departmentId: 'd1' }, { ...ok, companyWide: false })).toBeNull()
    expect(validateBlocker({ ...base(), target: 'replace' }, ok)).toBe('Choose the draft whose days the file replaces.')
    expect(validateBlocker({ ...base(), startDate: '2026-11-10', endDate: '2026-11-01' }, ok)).toBe('The last day is before the first day.')
  })

  it('preview and apply open only after a check with no errors and someone matched', () => {
    expect(furthestStep(base())).toBe('import')
    expect(canOpen('validate', base())).toBe(false)
    const checked = { ...base(), validation: validation() }
    expect(furthestStep(checked)).toBe('apply')
    expect(canOpen('preview', checked)).toBe(true)
    const withErrors = { ...base(), validation: validation({ summary: { rows: 2, matched: 1, errors: 1, warnings: 0 } }) }
    expect(furthestStep(withErrors)).toBe('validate')
    expect(canOpen('preview', withErrors)).toBe(false)
    expect(canOpen('validate', withErrors)).toBe(true)
    const nobody = { ...base(), validation: validation({ summary: { rows: 1, matched: 0, errors: 0, warnings: 0 }, plan: null }) }
    expect(furthestStep(nobody)).toBe('validate')
  })

  it('warnings never stop the draft', () => {
    const warned = { ...base(), validation: validation({ summary: { rows: 1, matched: 1, errors: 0, warnings: 4 } }) }
    expect(canOpen('apply', warned)).toBe(true)
  })

  it('changing the period, scope, target or file drops the last check', () => {
    const checked = { ...base(), validation: validation() }
    expect(changeScope(checked, { departmentId: 'd1' }).validation).toBeNull()
    expect(changeScope(checked, { fileName: 'other.xlsx' }).validation).toBeNull()
    const replacing = withDraft(base(), summary({}))
    expect(changeScope(replacing, { target: 'new' })).toMatchObject({ target: 'new', draft: null })
  })

  it('the step track marks the steps before the current one done', () => {
    expect(stepStates('preview').map((s) => s.state)).toEqual(['done', 'done', 'current', 'todo'])
    expect(stepStates('import').map((s) => s.label)).toEqual(['Import', 'Validate', 'Preview', 'Apply'])
  })
})

describe('problems', () => {
  const list = [problem('error'), problem('warning', { rowNo: null, column: null }), problem('info', { date: null }), problem('error', { rowNo: 9 })]

  it('counts and filters by severity', () => {
    expect(problemCounts(list)).toEqual({ all: 4, error: 2, warning: 1, info: 1 })
    expect(filterProblems(list, 'error').map((p) => p.rowNo)).toEqual([3, 9])
    expect(filterProblems(list, 'warning')).toHaveLength(1)
    expect(filterProblems(list, 'all')).toHaveLength(4)
    expect(filterProblems([], 'error')).toEqual([])
  })

  it('says where a problem is', () => {
    expect(problemWhere({ column: 'M', date: '2027-01-12' })).toBe('Column M · 12 Jan')
    expect(problemWhere({ column: 'B', date: null })).toBe('Column B')
    expect(problemWhere({ column: null, date: '2027-01-26' })).toBe('26 Jan')
    expect(problemWhere({ column: null, date: null })).toBe('')
  })
})

describe('preview and apply', () => {
  it('turns the plan into a plain table with overlays and flagged cells', () => {
    const t = previewTable(plan())
    expect(t.days).toEqual([
      { date: '2027-01-01', day: 1, weekday: 'F', holiday: null },
      { date: '2027-01-02', day: 2, weekday: 'S', holiday: 'Holiday' },
    ])
    expect(t.rows[0].cells).toEqual([
      { code: 'A', overlay: null, outside: false, flagged: 'warning' },
      { code: null, overlay: 'PH', outside: false, flagged: null },
    ])
    expect(t.rows[0]).toMatchObject({ name: 'Ravi Kumar', code: 'TV-101', designation: 'Technician', working: 1, holiday: 1 })
  })

  it('lists the schedule check with errors first', () => {
    expect(checkLines(plan()).map((l) => l.label)).toEqual(['No one is on two rosters', 'All employees assigned', '1 employee has insufficient rest'])
  })

  it('says what apply does', () => {
    const s = { ...base(), startDate: '2027-01-01', endDate: '2027-01-31', validation: validation({ summary: { rows: 3, matched: 3, errors: 0, warnings: 0 } }) }
    expect(applySummary(s)).toBe('A new draft roster for January 2027 is created with 3 people.')
    expect(applySummary({ ...withDraft(s, summary({ name: 'Jan plan' })), validation: s.validation }))
      .toBe('The people and days of the draft “Jan plan” are replaced by the file’s 3 people.')
  })

  it('explains the refusals it knows', () => {
    expect(applyError('ROSTER_CHANGED', 'x')).toContain('Someone else saved this draft')
    expect(applyError('ROSTER_PUBLISHED', 'x')).toContain('Import into a new draft')
    expect(applyError('IMPORT_FILE_INVALID', 'The file still has 2 errors.')).toBe('The file still has 2 errors.')
    expect(applyError(undefined, '')).toBe('The draft couldn’t be saved. Try again.')
  })
})
