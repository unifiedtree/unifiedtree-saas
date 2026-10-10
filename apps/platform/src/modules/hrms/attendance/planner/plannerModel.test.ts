import { describe, expect, it } from 'vitest'
import { WO_TOKEN } from '../../api/rosterTypes'
import {
  PREVIEW_KIND, UNDO_LIMIT, addDaysIso, checkCountLabel, continueCandidates, coverageCell, coverageView, defaultRosterName, draftBody,
  fromDetail, gridView, groupPeople, initialState, isDirty, isoWeekday, monthPeriod, otherRostersOf, patternCodes, patternDay,
  patternNote, patternStrip, periodLabel, periodLength, planRequest, plannerReducer, previousRoster, publishReach, rangeProblem,
  savedLabel, signature, summaryText, toShiftLites, tokenForTyped, type PlannerAction, type PlannerState,
} from './plannerModel'
import { DES, PEOPLE, POLICIES, SH, cell, checks, detail, emp, issue, planOf, summary } from './__fixtures__/rosterFixtures'

const TODAY = '2026-10-10'
const run = (s: PlannerState, ...actions: PlannerAction[]) => actions.reduce(plannerReducer, s)
const shifts = toShiftLites(POLICIES)
const shiftMap = new Map(shifts.map((s) => [s.id, s]))
const people = new Map(PEOPLE.map((p) => [p.employeeId, p]))
const PATTERN = [SH.A, SH.A, SH.B, SH.B, SH.C, SH.C, WO_TOKEN].map(patternDay)

/** A new October roster with two people, a pattern, generated. */
function generated() {
  return run(initialState(TODAY),
    { type: 'pattern', pattern: PATTERN, repeats: true, templateId: null },
    { type: 'members', employeeIds: [emp(1), emp(2)] },
    { type: 'generate' })
}
/** The server's answer to `s`'s request, laying A for everyone (B for edited cells is not its business). */
function answer(s: PlannerState, token = SH.A, o?: { offsets?: number[] }) {
  const n = periodLength(s.startDate, s.endDate)
  return planOf(s.startDate, s.endDate, s.members.map((m, i) => ({
    employeeId: m.employeeId, offset: o?.offsets?.[i] ?? i,
    cells: Array.from({ length: n }, (_, d) => {
      const r = s.rows[m.employeeId]
      const kept = r && r.edited.includes(d)
      return cell(kept ? r.cells[d] : token, kept ? null : 'A', { edited: !!kept })
    }),
  })))
}

describe('dates and names', () => {
  it('works out months, ranges and their limits', () => {
    expect(monthPeriod('2026-10')).toEqual({ startDate: '2026-10-01', endDate: '2026-10-31' })
    expect(monthPeriod('2026-02')).toEqual({ startDate: '2026-02-01', endDate: '2026-02-28' })
    expect(monthPeriod('2028-02').endDate).toBe('2028-02-29')
    expect(periodLength('2026-10-01', '2026-10-31')).toBe(31)
    expect(addDaysIso('2026-10-31', 1)).toBe('2026-11-01')
    expect(isoWeekday('2026-10-12')).toBe(1)
    expect(isoWeekday('2026-10-11')).toBe(7)
    expect(rangeProblem('2026-10-01', '2026-12-01')).toBeNull() // 62 days, the most
    expect(rangeProblem('2026-10-01', '2026-12-02')).toBe('A roster covers at most 62 days.')
    expect(rangeProblem('', '2026-10-01')).toBe('Pick the first and last day.')
    expect(rangeProblem('2026-10-05', '2026-10-01')).toBe('The last day is before the first day.')
  })
  it('names a roster after its period and scope', () => {
    expect(periodLabel('2026-10-01', '2026-10-31')).toBe('October 2026')
    expect(periodLabel('2026-10-01', '2026-10-14')).toBe('1 – 14 Oct 2026')
    expect(periodLabel('2026-09-28', '2026-10-11')).toBe('28 Sep – 11 Oct 2026')
    expect(periodLabel('2026-12-20', '2027-01-10')).toBe('20 Dec 2026 – 10 Jan 2027')
    expect(defaultRosterName('2026-10-01', '2026-10-31', 'Technical')).toBe('October 2026 – Technical')
  })
})

describe('shifts as the planner shows them', () => {
  it('orders by start time, gives night its own colour and derives the break', () => {
    expect(shifts.map((s) => s.code)).toEqual(['A', 'G', 'B', 'C'])
    expect(shifts.find((s) => s.code === 'C')).toMatchObject({ night: true, tone: 'night' })
    expect(shifts.find((s) => s.code === 'A')).toMatchObject({ tone: '1', breakMinutes: 30, people: 5, start: '06:00', end: '14:00' })
    expect(shifts.find((s) => s.code === 'G')?.breakMinutes).toBe(60)
  })
  it('falls back to the name’s first letters for a shift with no code', () => {
    const [s] = toShiftLites([{ ...POLICIES[0], code: null, name: 'General shift' }])
    expect(s).toMatchObject({ code: 'GS', hasCode: false })
  })
  it('reads typed codes: W is a weekly off, a code or a unique start of one is a shift', () => {
    expect(tokenForTyped('w', shifts)).toBe(WO_TOKEN)
    expect(tokenForTyped('a', shifts)).toBe(SH.A)
    expect(tokenForTyped('C', shifts)).toBe(SH.C)
    expect(tokenForTyped('X', shifts)).toBeUndefined()
  })
})

describe('patterns', () => {
  it('shows codes, two cycles in the strip and what the weekly-off mode does to WO days', () => {
    expect(patternCodes(PATTERN, shiftMap).join(' ')).toBe('A A B B C C WO')
    expect(patternStrip(PATTERN, true)).toHaveLength(14)
    expect(patternStrip(PATTERN, false)).toHaveLength(7)
    expect(patternNote(PATTERN, 'FIXED')).toBe('With fixed weekly offs, people also get the pattern’s WO days off.')
    expect(patternNote(PATTERN, 'CUSTOM')).toMatch(/left empty/)
    expect(patternNote(PATTERN, 'ROTATIONAL')).toBeNull()
    expect(patternNote([patternDay(SH.A)], 'ROTATIONAL')).toMatch(/no WO day/)
  })
})

describe('the draft: which changes lay the pattern again', () => {
  it('asks nothing before the first Generate', () => {
    const s = run(initialState(TODAY), { type: 'pattern', pattern: PATTERN, repeats: true, templateId: null }, { type: 'members', employeeIds: [emp(1)] })
    expect(s.rev).toBe(0)
    expect(s.generated).toBe(false)
  })
  it('regenerates for pattern, mode, people, start days and period; refreshes for staffing, shifts and cells; nothing for the name', () => {
    expect(PREVIEW_KIND.pattern).toBe('regenerate')
    expect(PREVIEW_KIND.weeklyOffMode).toBe('regenerate')
    expect(PREVIEW_KIND.members).toBe('regenerate')
    expect(PREVIEW_KIND.stagger).toBe('regenerate')
    expect(PREVIEW_KIND.period).toBe('regenerate')
    expect(PREVIEW_KIND.required).toBe('refresh')
    expect(PREVIEW_KIND.shifts).toBe('refresh')
    expect(PREVIEW_KIND.cells).toBe('refresh')
    expect(PREVIEW_KIND.name).toBeNull()
    let s = generated()
    expect(s).toMatchObject({ rev: 1, pendingRegenerate: true })
    s = run(s, { type: 'plan', rev: 1, regenerate: true, plan: answer(s) })
    expect(s.pendingRegenerate).toBe(false)
    const staffed = run(s, { type: 'required', designationId: DES.TE, shiftPolicyId: SH.A, required: 2 })
    expect(staffed).toMatchObject({ rev: 2, pendingRegenerate: false })
    expect(planRequest(staffed).regenerate).toBe(false)
    const repatterned = run(s, { type: 'weeklyOffMode', mode: 'FIXED' })
    expect(repatterned).toMatchObject({ rev: 2, pendingRegenerate: true })
    expect(planRequest(repatterned).regenerate).toBe(true)
    expect(run(s, { type: 'name', name: 'October' }).rev).toBe(s.rev)
  })
  it('tracks unsaved changes; a new roster’s defaults are its starting point', () => {
    const s0 = initialState(TODAY)
    expect(isDirty(s0)).toBe(false)
    const ticked = run(s0, { type: 'newDefaults', shiftIds: [SH.A], employeeIds: [emp(1)] })
    expect(ticked.config.shiftIds).toEqual([SH.A])
    expect(ticked.members).toHaveLength(1)
    expect(isDirty(ticked)).toBe(false)
    expect(isDirty(run(ticked, { type: 'name', name: 'Night team' }))).toBe(true)
    expect(isDirty(run(ticked, { type: 'name', name: ticked.name }))).toBe(false)
    // After the planner changed something, defaults no longer hide it.
    expect(isDirty(run(s0, { type: 'name', name: 'Mine' }, { type: 'newDefaults', shiftIds: [SH.A] }))).toBe(true)
  })
  it('never lays new-roster defaults over a saved roster', () => {
    const s = fromDetail(detail(), TODAY)
    expect(run(s, { type: 'newDefaults', shiftIds: [SH.A, SH.B, SH.C, SH.G], employeeIds: [emp(5)] })).toBe(s)
  })
  it('follows the period and scope in the name until the planner types one', () => {
    const s = run(initialState(TODAY), { type: 'scope', departmentId: 'd1', branchId: null, scopeLabel: 'Technical' })
    expect(s.name).toBe('October 2026 – Technical')
    const t = run(s, { type: 'name', name: 'Mine' }, { type: 'period', periodType: 'MONTH', startDate: '2026-11-01', endDate: '2026-11-30', scopeLabel: 'Technical' })
    expect(t.name).toBe('Mine')
  })
})

describe('cell edits and undo', () => {
  it('paints an edit at once, marks it edited and undoes it', () => {
    let s = generated()
    s = run(s, { type: 'plan', rev: 1, regenerate: true, plan: answer(s) })
    s = run(s, { type: 'cells', edits: [{ employeeId: emp(1), index: 2, token: SH.B }, { employeeId: emp(1), index: 3, token: WO_TOKEN }] })
    expect(s.rows[emp(1)].cells.slice(0, 4)).toEqual([SH.A, SH.A, SH.B, WO_TOKEN])
    expect(s.rows[emp(1)].edited).toEqual([2, 3])
    expect(s.undo).toHaveLength(1)
    expect(planRequest(s).rows[0].edited).toEqual([2, 3])
    s = run(s, { type: 'undo' })
    expect(s.rows[emp(1)].cells.slice(0, 4)).toEqual([SH.A, SH.A, SH.A, SH.A])
    expect(s.rows[emp(1)].edited).toEqual([])
  })
  it('keeps the last 50 edits and ignores an edit that changes nothing', () => {
    let s = generated()
    s = run(s, { type: 'plan', rev: 1, regenerate: true, plan: answer(s) })
    for (let i = 0; i < 60; i++) s = run(s, { type: 'cells', edits: [{ employeeId: emp(1), index: i % 31, token: i % 2 ? SH.B : SH.C }] })
    expect(s.undo).toHaveLength(UNDO_LIMIT)
    const rev = s.rev
    const same = run(s, { type: 'cells', edits: [{ employeeId: emp(1), index: 59 % 31, token: SH.B }] })
    expect(same.rev).toBe(rev)
  })
  it('lets a day before joining or after leaving only be cleared', () => {
    let s = generated()
    const plan = answer(s)
    plan.rows[0].cells[0] = cell(null, null, { outside: true })
    s = run(s, { type: 'plan', rev: 1, regenerate: true, plan })
    expect(run(s, { type: 'cells', edits: [{ employeeId: emp(1), index: 0, token: SH.A }] }).rows[emp(1)].cells[0]).toBeNull()
    const s2 = run(s, { type: 'cells', edits: [{ employeeId: emp(1), index: 0, token: null }] })
    expect(s2.rows[emp(1)].edited).toContain(0)
  })
  it('never changes a published roster’s days before today', () => {
    const d = detail({ roster: { status: 'PUBLISHED', version: 1 }, rows: [{ employeeId: emp(1), cells: Array.from({ length: 31 }, () => SH.A), edited: [] }] })
    let s = fromDetail(d, TODAY)
    s = run(s, { type: 'cells', edits: [{ employeeId: emp(1), index: 3, token: SH.B }, { employeeId: emp(1), index: 9, token: SH.B }] })
    expect(s.rows[emp(1)].cells[3]).toBe(SH.A) // 4 Oct
    expect(s.rows[emp(1)].cells[9]).toBe(SH.B) // 10 Oct, today
  })
})

describe('preview answers', () => {
  it('adopts a regenerate answer for the current state: cells, edited marks and offsets', () => {
    const s = generated()
    const t = run(s, { type: 'plan', rev: 1, regenerate: true, plan: answer(s, SH.A, { offsets: [0, 3] }) })
    expect(t.rows[emp(2)].cells[0]).toBe(SH.A)
    expect(t.members.map((m) => m.rotationOffset)).toEqual([0, 3])
    expect(t.planRev).toBe(1)
    expect(t.undo).toEqual([])
  })
  it('shows an overtaken answer but keeps the newer working copy and asks again', () => {
    let s = generated()
    const asked = answer(s)
    s = run(s, { type: 'pattern', pattern: PATTERN.slice(0, 6), repeats: true, templateId: null })
    s = run(s, { type: 'plan', rev: 1, regenerate: true, plan: asked })
    expect(s.plan).toBe(asked)
    expect(s.rows[emp(1)]).toBeUndefined()
    expect(s.pendingRegenerate).toBe(true)
    expect(s.rev > s.planRev).toBe(true)
  })
  it('ignores an answer older than the one shown', () => {
    const s = generated()
    const newer = run(s, { type: 'plan', rev: 1, regenerate: true, plan: answer(s) })
    expect(run(newer, { type: 'plan', rev: 0, regenerate: false, plan: answer(s, SH.C) })).toBe(newer)
  })
  it('does not take cells from a refresh answer', () => {
    let s = generated()
    s = run(s, { type: 'plan', rev: 1, regenerate: true, plan: answer(s) })
    s = run(s, { type: 'cells', edits: [{ employeeId: emp(1), index: 5, token: SH.C }] })
    const t = run(s, { type: 'plan', rev: s.rev, regenerate: false, plan: answer(s, SH.B) })
    expect(t.rows[emp(1)].cells[5]).toBe(SH.C)
    expect(t.rows[emp(1)].cells[0]).toBe(SH.A)
  })
  it('puts a published roster’s past days back after a regenerate and asks once more', () => {
    const d = detail({ roster: { status: 'PUBLISHED', version: 1 }, rows: [{ employeeId: emp(1), cells: Array.from({ length: 31 }, () => SH.A), edited: [] }], members: [{ employeeId: emp(1), rotationOffset: 0 }] })
    let s = fromDetail(d, TODAY)
    s = run(s, { type: 'pattern', pattern: [patternDay(SH.C)], repeats: true, templateId: null })
    const t = run(s, { type: 'plan', rev: s.rev, regenerate: true, plan: answer(s, SH.C) })
    expect(t.rows[emp(1)].cells[0]).toBe(SH.A)
    expect(t.rows[emp(1)].cells[9]).toBe(SH.C)
    expect(t.rev).toBe(s.rev + 1)
  })
  it('with “Keep my edits” off, a regenerate drops the edited marks; the request still keeps later edits', () => {
    let s = generated()
    s = run(s, { type: 'plan', rev: 1, regenerate: true, plan: answer(s) })
    s = run(s, { type: 'cells', edits: [{ employeeId: emp(1), index: 1, token: SH.B }] }, { type: 'keepEdits', on: false })
    s = run(s, { type: 'pattern', pattern: PATTERN.slice(0, 5), repeats: true, templateId: null })
    expect(s.rows[emp(1)].edited).toEqual([])
    expect(planRequest(s).keepEdits).toBe(true)
    const reset = run(generated(), { type: 'resetEdits' })
    expect(reset.pendingRegenerate).toBe(true)
  })
})

describe('members and start days', () => {
  it('keeps chosen offsets, leaves new people’s for the server, and sends 0 when saving', () => {
    let s = generated()
    s = run(s, { type: 'plan', rev: 1, regenerate: true, plan: answer(s, SH.A, { offsets: [0, 4] }) })
    s = run(s, { type: 'members', employeeIds: [emp(2), emp(3)] })
    expect(s.members).toEqual([{ employeeId: emp(2), rotationOffset: 4 }, { employeeId: emp(3), rotationOffset: null }])
    expect(s.rows[emp(1)]).toBeUndefined()
    expect(planRequest(s).members.map((m) => m.rotationOffset)).toEqual([4, -1])
    expect(draftBody(s).members[1].rotationOffset).toBe(0)
  })
  it('chooses start days again for everyone when the way of choosing changes', () => {
    let s = generated()
    s = run(s, { type: 'plan', rev: 1, regenerate: true, plan: answer(s, SH.A, { offsets: [0, 4] }) })
    s = run(s, { type: 'stagger', mode: 'SAME', continueFromRosterId: 'x' })
    expect(s.members.every((m) => m.rotationOffset === null)).toBe(true)
    expect(planRequest(s).members.every((m) => m.rotationOffset === -1)).toBe(true)
    expect(s.config).toMatchObject({ staggerMode: 'SAME', continueFromRosterId: null })
  })
  it('moves the working copy with the period, by date', () => {
    let s = generated()
    s = run(s, { type: 'plan', rev: 1, regenerate: true, plan: answer(s) })
    s = run(s, { type: 'cells', edits: [{ employeeId: emp(1), index: 9, token: SH.C }] })
    s = run(s, { type: 'period', periodType: 'RANGE', startDate: '2026-10-08', endDate: '2026-10-21' })
    expect(s.rows[emp(1)].cells).toHaveLength(14)
    expect(s.rows[emp(1)].cells[2]).toBe(SH.C)
    expect(s.rows[emp(1)].edited).toEqual([2])
  })
  it('sets one person’s start day and removes a person', () => {
    let s = generated()
    s = run(s, { type: 'plan', rev: 1, regenerate: true, plan: answer(s) })
    expect(run(s, { type: 'offset', employeeId: emp(2), offset: 2 })).toMatchObject({ pendingRegenerate: true, members: [{ employeeId: emp(1), rotationOffset: 0 }, { employeeId: emp(2), rotationOffset: 2 }] })
    const t = run(s, { type: 'removeMember', employeeId: emp(1) })
    expect(t.members.map((m) => m.employeeId)).toEqual([emp(2)])
    expect(t.pendingRegenerate).toBe(false)
  })
})

describe('loading and saving', () => {
  it('opens a draft saved before its first Generate with no start days chosen', () => {
    const s = fromDetail(detail(), TODAY)
    expect(s).toMatchObject({ generated: false, status: 'DRAFT', lockVersion: 3 })
    expect(s.members.every((m) => m.rotationOffset === null)).toBe(true)
    expect(isDirty(s)).toBe(false)
  })
  it('opens a roster with days as generated, with its offsets', () => {
    const s = fromDetail(detail({ rows: [{ employeeId: emp(1), cells: [SH.A], edited: [0] }] }), TODAY)
    expect(s.generated).toBe(true)
    expect(s.members[1].rotationOffset).toBe(1)
    expect(s.rows[emp(1)].cells).toHaveLength(31)
  })
  it('after saving is clean, unless something changed while it saved', () => {
    const s = run(generated(), { type: 'name', name: 'Saved name' })
    const sent = signature(s)
    const saved = run(s, { type: 'saved', detail: detail({ roster: { lockVersion: 7 } }), sentSig: sent, sentRev: s.rev })
    expect(saved).toMatchObject({ rosterId: '11111111-2222-3333-4444-555555555555', lockVersion: 7, status: 'DRAFT' })
    expect(isDirty(saved)).toBe(false)
    expect(draftBody(saved).lockVersion).toBe(7)
    const typed = run(s, { type: 'name', name: 'Typed while saving' })
    expect(isDirty(run(typed, { type: 'saved', detail: detail(), sentSig: sent, sentRev: s.rev }))).toBe(true)
  })
})

describe('grid view', () => {
  it('shows the working copy with the answer’s overlays, issues and totals', () => {
    let s = generated()
    const plan = answer(s)
    plan.rows[0].cells[1] = cell(SH.A, 'A', { overlay: { type: 'PH', label: 'Gandhi Jayanti', halfDay: false }, issueIds: ['w1'] })
    plan.rows[0].cells[4] = cell(SH.A, 'A', { issueIds: ['w1', 'e1'] })
    plan.checks = checks({ errors: [issue('e1', 'E1', 'error')], warnings: [issue('w1', 'W4', 'warning')] })
    s = run(s, { type: 'plan', rev: 1, regenerate: true, plan })
    s = run(s, { type: 'cells', edits: [{ employeeId: emp(2), index: 0, token: WO_TOKEN }] })
    const v = gridView(s, shiftMap, people)
    expect(v.days).toHaveLength(31)
    expect(v.days[9]).toMatchObject({ date: '2026-10-10', today: true, letter: 'S', weekend: true })
    expect(v.rows.map((r) => r.name)).toEqual(['Someone', 'Someone'])
    expect(v.rows[0].cells[1]).toMatchObject({ code: 'A', tone: '1', level: 'warning', overlay: { type: 'PH' } })
    expect(v.rows[0].cells[4].level).toBe('error')
    expect(v.rows[1].cells[0]).toMatchObject({ code: 'WO', tone: 'wo', edited: true })
    expect(v.rows[0].totals?.working).toBe(31)
  })
  it('names people the answer doesn’t know yet from the people list, and filters by designation', () => {
    const s = run(initialState(TODAY), { type: 'members', employeeIds: [emp(1), emp(5), emp(7)] })
    const v = gridView(s, shiftMap, people)
    expect(v.rows.map((r) => r.name)).toEqual(['Surender Rao', 'Anil Varma', 'Chandra Sekhar'])
    expect(v.rows[0].cells.every((c) => c.code == null)).toBe(true)
    expect(gridView(s, shiftMap, people, DES.HV).rows.map((r) => r.name)).toEqual(['Anil Varma'])
    expect(gridView(s, shiftMap, people, '').rows.map((r) => r.name)).toEqual(['Chandra Sekhar'])
  })
  it('marks a published roster’s days before today as locked', () => {
    const s = fromDetail(detail({ roster: { status: 'PUBLISHED' }, rows: [{ employeeId: emp(1), cells: [SH.A], edited: [] }] }), TODAY)
    const v = gridView(s, shiftMap, people)
    expect(v.rows[0].cells[8].locked).toBe(true)
    expect(v.rows[0].cells[9].locked).toBe(false)
  })
})

describe('coverage and checks', () => {
  it('labels coverage per day: met, short, more than needed, no requirement, holiday', () => {
    expect(coverageCell({ required: 4, scheduled: 4, status: 'OK' })).toMatchObject({ label: '4/4', tone: 'ok' })
    expect(coverageCell({ required: 2, scheduled: 1, status: 'SHORT' })).toMatchObject({ label: '1/2', tone: 'short', title: '1 of 2 needed' })
    expect(coverageCell({ required: 4, scheduled: 5, status: 'OVER' })).toMatchObject({ label: '5/4', tone: 'over' })
    expect(coverageCell({ required: null, scheduled: 3, status: 'NONE' })).toMatchObject({ label: '', tone: 'none' })
    expect(coverageCell({ required: 2, scheduled: 0, status: 'HOLIDAY' })).toMatchObject({ label: '–', tone: 'holiday' })
  })
  it('groups coverage by shift in the ticked order, with designation rows under each', () => {
    const plan = planOf('2026-10-01', '2026-10-02', [], {
      coverage: [
        { shiftPolicyId: SH.C, code: 'C', designationId: null, perDay: [{ required: 2, scheduled: 1, status: 'SHORT' }, { required: 2, scheduled: 2, status: 'OK' }] },
        { shiftPolicyId: SH.A, code: 'A', designationId: null, perDay: [{ required: 4, scheduled: 4, status: 'OK' }, { required: 4, scheduled: 4, status: 'OK' }] },
        { shiftPolicyId: SH.C, code: 'C', designationId: DES.HV, perDay: [{ required: 1, scheduled: 0, status: 'SHORT' }, { required: 1, scheduled: 1, status: 'OK' }] },
      ],
    })
    const g = coverageView(plan, [SH.A, SH.C], shiftMap, new Map([[DES.HV, 'HVAC Technician']]))
    expect(g.map((x) => x.line.label)).toEqual(['A · Morning', 'C · Night'])
    expect(g[1].line.short).toBe(1)
    expect(g[1].parts.map((p) => p.label)).toEqual(['HVAC Technician'])
  })
  it('never shows a holiday column as a gap, even with the requirement on it', () => {
    const plan = planOf('2026-10-01', '2026-10-02', [], {
      coverage: [{ shiftPolicyId: SH.A, code: 'A', designationId: null, perDay: [{ required: 2, scheduled: 0, status: 'SHORT' }, { required: 2, scheduled: 0, status: 'SHORT' }] }],
    })
    plan.days[1].holidayName = 'Gandhi Jayanti'
    const [g] = coverageView(plan, [SH.A], shiftMap, new Map())
    expect(g.line.cells.map((c) => c.label)).toEqual(['0/2', '–'])
    expect(g.line.short).toBe(1)
  })
  it('counts errors and warnings for the toolbar', () => {
    expect(checkCountLabel(checks({ errors: [issue('a', 'E1', 'error'), issue('b', 'E3', 'error')], warnings: [issue('c', 'W1', 'warning')] }))).toBe('2 errors · 1 warning')
    expect(checkCountLabel(checks())).toBe('No issues')
    expect(summaryText('✓ All employees assigned')).toBe('All employees assigned')
    expect(summaryText('⚠ 2 employees have insufficient rest')).toBe('2 employees have insufficient rest')
  })
})

describe('people, other rosters and publishing', () => {
  it('groups people by designation with “No designation” last', () => {
    const g = groupPeople(PEOPLE)
    expect(g.map((x) => `${x.name} ${x.people.length}`)).toEqual(['HVAC Technician 2', 'Technical Executive 4', 'No designation 1'])
    expect(otherRostersOf(PEOPLE[5], null)).toHaveLength(1)
    expect(otherRostersOf(PEOPLE[5], 'f0000000-0000-0000-0000-0000000000f0')).toHaveLength(0)
  })
  it('offers to continue from a published roster of the same scope ending the day before, and to copy from the latest earlier one', () => {
    const sept = summary({ id: 's1', name: 'September', startDate: '2026-09-01', endDate: '2026-09-30', status: 'PUBLISHED' })
    const other = summary({ id: 's2', name: 'Elsewhere', startDate: '2026-09-01', endDate: '2026-09-30', status: 'PUBLISHED', departmentId: 'zz' })
    const s = { rosterId: null, departmentId: sept.departmentId, branchId: null, startDate: '2026-10-01' }
    expect(continueCandidates([sept, other], s).map((r) => r.id)).toEqual(['s1'])
    expect(continueCandidates([{ ...sept, status: 'DRAFT' }], s)).toEqual([])
    expect(previousRoster([sept, other], s)?.id).toBe('s1')
  })
  it('publishes the planned days from today on and tells the people who have one', () => {
    let s = generated()
    s = run(s, { type: 'plan', rev: 1, regenerate: true, plan: answer(s) })
    s = run(s, { type: 'cells', edits: Array.from({ length: 31 }, (_, i) => ({ employeeId: emp(2), index: i, token: null })) })
    expect(publishReach(s)).toEqual({ from: TODAY, days: 22, people: 1, past: false })
  })
  it('says when the draft was saved', () => {
    const t = Date.UTC(2026, 9, 10, 8, 0)
    expect(savedLabel(null, t)).toBe('')
    expect(savedLabel(t - 20_000, t)).toBe('Saved just now')
    expect(savedLabel(t - 5 * 60_000, t)).toBe('Saved 5 min ago')
  })
  it('builds the preview request from the draft', () => {
    const s = generated()
    const req = planRequest(s)
    expect(req).toMatchObject({ startDate: '2026-10-01', endDate: '2026-10-31', rosterId: null, regenerate: true, keepEdits: true })
    expect(req.config.pattern).toHaveLength(7)
    expect(req.rows).toEqual([])
  })
})

