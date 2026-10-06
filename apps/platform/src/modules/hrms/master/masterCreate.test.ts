// Add employee → "Create" beside a field, the Master side: who may use it, how
// the Master page's add form is pointed at the employee's company, how its
// save is caught, and what the employee form selects afterwards — including
// that the rest of a half-filled form is left exactly as it was.
import { describe, expect, it } from 'vitest'
import { CREATE_KINDS, catchSave, createBlockedReason, scopeDb, selectionAfterCreate, type CaughtSave, type CreateKind } from './masterCreate'
import type { Rec } from './masterData'

const TYPE_LABEL = { FULL_TIME: 'Full-time', PART_TIME: 'Part-time', INTERN: 'Intern', CONTRACT: 'Contract', CONSULTANT: 'Consultant' }

/** The employee form's own setter (MasterDesign RecordForm `set`): a field's `clears` empties the fields that depend on it. */
const CLEARS: Record<string, string[]> = { co: ['branch'], dept: ['desig'] }
function applySelection(values: Rec, set: [string, unknown][]) {
  let v = { ...values }
  for (const [k, x] of set) { v = { ...v, [k]: x }; for (const c of CLEARS[k] || []) v[c] = '' }
  return v
}

const halfFilled: Rec = {
  first: 'Asha', last: 'Rao', email: 'asha@acme.test', phone: '+91 98000 00000', co: 'co-1', branch: 'br-1',
  dept: 'd-eng', desig: 'ds-sse', type: 'Full-time', joined: '2026-10-05', shift: '',
}

describe('createBlockedReason', () => {
  it('names the missing permission in plain words', () => {
    expect(createBlockedReason('depts', false, 'co-1')).toBe('You need permission to manage departments — ask an admin.')
    expect(createBlockedReason('shifts', false, 'co-1')).toBe('You need permission to manage shifts — ask an admin.')
    expect(createBlockedReason('branches', false, 'co-1')).toBe('You need permission to manage companies and branches — ask an admin.')
    expect(createBlockedReason('agencies', false, 'co-1')).toBe('You need permission to manage staffing agencies — ask an admin.')
  })
  it('asks for a company first', () => {
    expect(createBlockedReason('depts', true, '')).toBe('Pick a company first.')
  })
  it('is null when it can be used', () => {
    for (const k of Object.keys(CREATE_KINDS) as CreateKind[]) expect(createBlockedReason(k, true, 'co-1')).toBeNull()
  })
})

describe('scopeDb', () => {
  const db: Record<string, Rec[]> = {
    companies: [{ id: 'co-1' }, { id: 'co-2' }],
    branches: [{ id: 'b1', co: 'co-1' }, { id: 'b2', co: 'co-2' }],
    depts: [{ id: 'd1', co: 'co-1' }, { id: 'd2', co: 'co-2' }],
    desigs: [{ id: 'x1', co: 'co-2' }],
    grades: [{ id: 'L1', co: 'co-1' }, { id: 'L1', co: 'co-2' }],
    shifts: [{ id: 's1' }, { id: 's2' }],
  }
  it('keeps only the employee’s company, so the new item is made there', () => {
    const s = scopeDb(db, 'co-1')
    expect(s.companies.map((c) => c.id)).toEqual(['co-1'])
    expect(s.branches.map((b) => b.id)).toEqual(['b1'])
    expect(s.depts.map((d) => d.id)).toEqual(['d1'])
    expect(s.desigs).toEqual([])
    expect(s.grades).toEqual([{ id: 'L1', co: 'co-1' }])
    expect(s.shifts).toBe(db.shifts)
  })
})

describe('catchSave', () => {
  it('catches the new record and the form’s own message, and sends nothing', () => {
    const depts = [{ id: 'd1', _key: 'd1', name: 'Engineering' }]
    const db = { depts }
    const box: { current: CaughtSave | null } = { current: null }
    const { update, toast } = catchSave(db, box)
    const rec = { name: 'Data Science', code: 'DSC', status: 'Active' }
    // What DeptForm's onSave does: update(...concat), toast(...), onClose().
    update('depts', (L) => L.concat([rec]))
    toast('Data Science added')
    expect(box.current).toEqual({ k: 'depts', rec, msg: 'Data Science added' })
    expect(db.depts).toBe(depts)
    expect(depts).toHaveLength(1)
  })
  it('a Cancel catches nothing', () => {
    const box: { current: CaughtSave | null } = { current: null }
    const { toast } = catchSave({ depts: [] }, box)
    toast('ignored')
    expect(box.current).toBeNull()
  })
})

describe('selectionAfterCreate', () => {
  it('selects the new item in the field Create sits beside', () => {
    expect(selectionAfterCreate('depts', { name: 'Data Science' }, 'd-new', halfFilled, TYPE_LABEL)).toEqual({ set: [['dept', 'd-new']] })
    expect(selectionAfterCreate('shifts', { name: 'Late' }, 's-new', halfFilled, TYPE_LABEL)).toEqual({ set: [['shift', 's-new']] })
    expect(selectionAfterCreate('branches', { name: 'Kochi' }, 'b-new', halfFilled, TYPE_LABEL)).toEqual({ set: [['branch', 'b-new']] })
    expect(selectionAfterCreate('agencies', { name: 'Apex' }, 'a-new', halfFilled, TYPE_LABEL)).toEqual({ set: [['agency', 'a-new']] })
    expect(selectionAfterCreate('desigs', { name: 'Analyst', dept: 'd-eng' }, 'ds-new', halfFilled, TYPE_LABEL)).toEqual({ set: [['desig', 'ds-new']] })
  })
  it('a title made under another department moves the form to that department first', () => {
    expect(selectionAfterCreate('desigs', { name: 'Analyst', dept: 'd-data' }, 'ds-new', halfFilled, TYPE_LABEL))
      .toEqual({ set: [['dept', 'd-data'], ['desig', 'ds-new']] })
  })
  it('an employment type is selected by its label when an employee can hold it', () => {
    expect(selectionAfterCreate('classes', { name: 'Consultants', code: 'CONSULTANT' }, 't-new', halfFilled, TYPE_LABEL)).toEqual({ set: [['type', 'Consultant']] })
  })
  it('a company’s own employment type is selected by its name (6 Oct 2026: people can be given it)', () => {
    expect(selectionAfterCreate('classes', { name: 'Apprentice', code: 'APPRENTICE' }, 't-new', halfFilled, TYPE_LABEL)).toEqual({ set: [['type', 'Apprentice']] })
  })
  it('without an id from the server it says so instead of guessing', () => {
    expect(selectionAfterCreate('shifts', { name: 'Late' }, null, halfFilled, TYPE_LABEL)).toEqual({ set: [], note: 'Late was added. Pick it from the list.' })
  })
})

describe('the half-filled employee form', () => {
  it('keeps everything typed when a shift is created and selected', () => {
    const after = applySelection(halfFilled, selectionAfterCreate('shifts', { name: 'Late' }, 's-new', halfFilled, TYPE_LABEL).set)
    expect(after).toEqual({ ...halfFilled, shift: 's-new' })
  })
  it('a new department only resets the designation, as picking one by hand does', () => {
    const after = applySelection(halfFilled, selectionAfterCreate('depts', { name: 'Data' }, 'd-new', halfFilled, TYPE_LABEL).set)
    expect(after).toEqual({ ...halfFilled, dept: 'd-new', desig: '' })
  })
  it('a new title under another department ends with both selected', () => {
    const after = applySelection(halfFilled, selectionAfterCreate('desigs', { name: 'Analyst', dept: 'd-data' }, 'ds-new', halfFilled, TYPE_LABEL).set)
    expect(after).toEqual({ ...halfFilled, dept: 'd-data', desig: 'ds-new' })
  })
  it('a new company type only changes the type', () => {
    const after = applySelection(halfFilled, selectionAfterCreate('classes', { name: 'Apprentice', code: 'APPRENTICE' }, 't', halfFilled, TYPE_LABEL).set)
    expect(after).toEqual({ ...halfFilled, type: 'Apprentice' })
  })
})
