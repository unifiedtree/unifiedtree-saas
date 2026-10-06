import { describe, expect, it } from 'vitest'
import type { Rec } from '../master/masterData'
import {
  agencyIsRequired, bulkStatusTargets, deptOptions, deptScope, desigOptions, startType, exitChange, filterEmployees, sortEmployees, statusOptions, suggestedLastDay, tenure, typeOptions,
  type DirectoryFilter, type Lookups,
} from './directoryModel'

const depts: Rec[] = [
  { id: 'eng', name: 'Engineering', parent: null },
  { id: 'web', name: 'Web', parent: 'eng' },
  { id: 'hr', name: 'People', parent: null },
]
const desigs: Record<string, string> = { se: 'Software Engineer', hrg: 'HR Generalist' }
const look: Lookups = {
  depts,
  deptName: (id) => depts.find((d) => d.id === id)?.name ?? '—',
  desigName: (id) => desigs[id] ?? '—',
}
const E: Rec[] = [
  { id: '1', name: 'Priya Sharma', code: 'ION-0001', email: 'priya@x.in', dept: 'eng', desig: 'se', branch: 'b1', type: 'Full-time', status: 'Active', joined: '2022-03-12' },
  { id: '2', name: 'Rahul Kumar', code: 'ION-0002', email: 'rahul@x.in', dept: 'web', desig: 'se', branch: 'b1', type: 'Intern', status: 'Probation', joined: '2024-01-03' },
  { id: '3', name: 'Ananya Iyer', code: 'ION-0003', email: 'ananya@x.in', dept: 'hr', desig: 'hrg', branch: 'b2', type: 'Full-time', status: 'On notice', joined: '2023-07-18' },
  { id: '4', name: 'Mohammed Arif', code: 'ION-0004', email: '', dept: '', desig: '', branch: 'b2', type: 'Contract', status: 'Exited', joined: '2021-09-28' },
]
const none: DirectoryFilter = { status: '', dept: '', branch: '', type: '', q: '', milestone: { on: false, ids: null } }
const names = (rows: Rec[]) => rows.map((e) => e.name)

describe('filterEmployees', () => {
  it('keeps everyone without filters', () => expect(filterEmployees(E, none, look)).toHaveLength(4))
  it('a department covers its sub-departments', () => {
    expect(deptScope('eng', depts)).toEqual(['eng', 'web'])
    expect(names(filterEmployees(E, { ...none, dept: 'eng' }, look))).toEqual(['Priya Sharma', 'Rahul Kumar'])
  })
  it('"No department" lists people without one', () => expect(names(filterEmployees(E, { ...none, dept: '__none' }, look))).toEqual(['Mohammed Arif']))
  it('searches name, code, email and designation', () => {
    expect(names(filterEmployees(E, { ...none, q: 'ion-0003' }, look))).toEqual(['Ananya Iyer'])
    expect(names(filterEmployees(E, { ...none, q: 'rahul@' }, look))).toEqual(['Rahul Kumar'])
    expect(names(filterEmployees(E, { ...none, q: 'generalist' }, look))).toEqual(['Ananya Iyer'])
  })
  it('status, branch and type combine', () => {
    expect(names(filterEmployees(E, { ...none, status: 'Exited' }, look))).toEqual(['Mohammed Arif'])
    expect(names(filterEmployees(E, { ...none, branch: 'b2', type: 'Full-time' }, look))).toEqual(['Ananya Iyer'])
  })
  it('designation narrows to the people with that title, with the other filters', () => {
    expect(names(filterEmployees(E, { ...none, desig: 'se' }, look))).toEqual(['Priya Sharma', 'Rahul Kumar'])
    expect(names(filterEmployees(E, { ...none, desig: 'se', dept: 'web' }, look))).toEqual(['Rahul Kumar'])
    expect(names(filterEmployees(E, { ...none, desig: 'hrg', status: 'Active' }, look))).toEqual([])
  })
  it('a milestone shows only the people the server picked, nobody while loading', () => {
    expect(names(filterEmployees(E, { ...none, milestone: { on: true, ids: new Set(['2']) } }, look))).toEqual(['Rahul Kumar'])
    expect(filterEmployees(E, { ...none, milestone: { on: true, ids: null } }, look)).toHaveLength(0)
  })
})

describe('sortEmployees', () => {
  it('by code, name, joining date, and department then designation', () => {
    expect(names(sortEmployees(E, { k: 'code', d: -1 }, look))[0]).toBe('Mohammed Arif')
    expect(names(sortEmployees(E, { k: 'name', d: 1 }, look))[0]).toBe('Ananya Iyer')
    expect(names(sortEmployees(E, { k: 'joined', d: 1 }, look))[0]).toBe('Mohammed Arif')
    expect(names(sortEmployees(E, { k: 'desig', d: 1 }, look))).toEqual(['Priya Sharma', 'Ananya Iyer', 'Rahul Kumar', 'Mohammed Arif'])
  })
})

describe('options', () => {
  it('status pills: the base five, then others found, with counts', () => {
    const o = statusOptions([...E, { id: '5', status: 'Terminated' }])
    expect(o.map((x) => x.value)).toEqual(['Active', 'Probation', 'On notice', 'Exited', 'Suspended', 'Terminated'])
    expect(o.find((x) => x.value === 'Suspended')?.count).toBe(0)
  })
  it('types come from the data: active employment types, then any other type on a record — no fixed list', () => {
    const classes: Rec[] = [{ type: 'Full-time', status: 'Active' }, { type: 'Consultant', status: 'Active' }, { type: 'Apprentice', status: 'Active' }, { type: 'Part-time', status: 'Inactive' }]
    expect(typeOptions(E, classes)).toEqual(['Full-time', 'Consultant', 'Apprentice', 'Intern', 'Contract'])
    expect(typeOptions(E)).toEqual(['Full-time', 'Intern', 'Contract'])
  })
  it('designations: all by name, or those of the chosen department (and its sub-departments)', () => {
    const ds: Rec[] = [{ id: 'se', name: 'Software Engineer', dept: 'eng' }, { id: 'fe', name: 'Frontend Dev', dept: 'web' }, { id: 'hrg', name: 'HR Generalist', dept: 'hr' }, { id: 'in', name: 'Intern', dept: '' }]
    expect(desigOptions(ds, depts, '').map((o) => o.label)).toEqual(['Frontend Dev', 'HR Generalist', 'Intern', 'Software Engineer'])
    expect(desigOptions(ds, depts, 'eng').map((o) => o.value)).toEqual(['fe', 'in', 'se'])
    expect(desigOptions(ds, depts, 'eng').find((o) => o.value === 'fe')?.sub).toBe('Web')
  })
  it('departments: each parent followed by its children', () => expect(deptOptions(depts).map((d) => d.label)).toEqual(['Engineering', 'Web', 'People']))
})

describe('status changes', () => {
  it('Mark as probation skips the exited, the same status and people serving notice', () => {
    expect(bulkStatusTargets(E, new Set(['1', '2', '3', '4']), 'Probation').map((e) => e.id)).toEqual(['1'])
    expect(bulkStatusTargets(E, new Set(['1', '2', '3', '4']), 'Active').map((e) => e.id)).toEqual(['2', '3'])
  })
  it('Start exit: today or earlier exits now, later starts notice', () => {
    expect(exitChange('2026-10-05', '2026-10-05')).toEqual({ status: 'Exited', exitOn: '2026-10-05' })
    expect(exitChange('2026-12-04', '2026-10-05')).toEqual({ status: 'On notice', lwd: '2026-12-04' })
  })
  it('suggested last day: full-time notice, 60 days without one', () => {
    expect(suggestedLastDay([{ code: 'FULL_TIME', notice: 30 }], '2026-10-05')).toBe('2026-11-04')
    expect(suggestedLastDay([], '2026-10-05')).toBe('2026-12-04')
  })
  it('tenure', () => {
    const today = new Date('2026-10-05T10:00:00')
    expect(tenure('2026-10-01', today)).toBe('Joined this month')
    expect(tenure('2024-07-01', today)).toBe('2 yr 3 mo')
    expect(tenure('', today)).toBe('—')
  })
})

describe('Add employee: employment type and staffing agency (w43)', () => {
  const base = { showAgency: true, canAgency: true, contractType: 'Contract' }
  it('a contract worker needs their agency on Add', () => {
    expect(agencyIsRequired({ ...base, type: 'Contract', isEdit: false })).toBe(true)
    expect(agencyIsRequired({ ...base, type: 'Full-time', isEdit: false })).toBe(false)
  })
  it('on Edit only when the type changes to Contract', () => {
    expect(agencyIsRequired({ ...base, type: 'Contract', isEdit: true, wasType: 'Full-time' })).toBe(true)
    expect(agencyIsRequired({ ...base, type: 'Contract', isEdit: true, wasType: 'Contract' })).toBe(false)
  })
  it('not for someone who can’t see or link agencies', () => {
    expect(agencyIsRequired({ ...base, showAgency: false, type: 'Contract', isEdit: false })).toBe(false)
    expect(agencyIsRequired({ ...base, canAgency: false, type: 'Contract', isEdit: false })).toBe(false)
  })
  it('a new person starts as the company’s Full-time, else its first type', () => {
    expect(startType(['Consultant', 'Contract', 'Full-time', 'Intern'], 'Full-time')).toBe('Full-time')
    expect(startType(['Consultant', 'Contract', 'Intern'], 'Full-time')).toBe('Consultant')
    expect(startType(['Contract', 'Full-time'], 'Contract')).toBe('Contract')
    expect(startType([], 'Full-time')).toBe('Full-time')
  })
})
