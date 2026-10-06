// Employment types, owner decision 6 Oct 2026: five fixed defaults every company has, and the company's
// own types — which people can now be given. Master → Classification Rules marks the defaults "Default"
// and locks them; a company's own type shows (and is picked) by its name, and saves by its code.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const sent: { url: string; method?: string; body: any }[] = []
vi.mock('@/core/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/core/api/client')>('@/core/api/client')
  return {
    ...actual,
    apiJson: async (url: string, init?: { method?: string; body?: string }) => {
      sent.push({ url, method: init?.method, body: init?.body ? JSON.parse(init.body) : undefined })
      return { id: 'new-1' }
    },
  }
})

import { SYNC, typeCodeOf, type SyncEnv } from './masterSync'
import { DEFAULT_TYPE_CODES, classRec, employeeRec, isDefaultType, typeLabel, type Rec } from './masterData'
import type { EmploymentTypeRecord } from '../api/useOrg'
import type { WorkforceEmployee } from '../api/useWorkforce'

const type = (code: string, name: string, over: Partial<EmploymentTypeRecord> = {}): EmploymentTypeRecord =>
  ({ id: `t-${code}`, companyId: 'co-1', code, name, payrollEligible: true, system: false, active: true, ...over })
const classes = [type('FULL_TIME', 'Full Time', { system: true }), type('CONTRACT', 'Contract'), type('APPRENTICE', 'Apprentice')]
  .map((t) => classRec(t, null, ''))
const env = (over: Partial<SyncEnv> = {}): SyncEnv => ({
  today: '2026-10-06', defaultCo: 'co-1', coOfDept: () => 'co-1', branches: [], settings: null,
  nextGradeLevel: 1, canInvite: false, canAssignShift: false, canBands: true, gradeIdOf: () => undefined, warn: () => {},
  typeCodeOf: (label, co) => classes.find((x) => x.co === co && x.type === label)?.code || undefined, ...over,
})
beforeEach(() => { sent.length = 0 })

describe('the five defaults', () => {
  it('are Full-time, Part-time, Contract, Intern and Consultant', () => {
    expect(DEFAULT_TYPE_CODES).toEqual(['FULL_TIME', 'PART_TIME', 'INTERN', 'CONTRACT', 'CONSULTANT'])
  })
  it('are marked by the server, or by their code on an older server — even a row not marked as a system row', () => {
    expect(isDefaultType({ code: 'CONTRACT' })).toBe(true)
    expect(isDefaultType({ code: ' intern ' })).toBe(true)
    expect(isDefaultType({ code: 'APPRENTICE' })).toBe(false)
    expect(isDefaultType({ code: 'APPRENTICE', builtIn: true })).toBe(true)
    expect(classes.map((c) => [c.code, c.system])).toEqual([['FULL_TIME', true], ['CONTRACT', true], ['APPRENTICE', false]])
  })
  it('keep their labels; a company’s own type is shown by its name', () => {
    expect(classes.map((c) => c.type)).toEqual(['Full-time', 'Contract', 'Apprentice'])
    expect(typeLabel('PART_TIME')).toBe('Part-time')
    expect(typeLabel('APPRENTICE', () => 'Apprentice (1 yr)')).toBe('Apprentice (1 yr)')
    expect(typeLabel('SEASONAL_STAFF')).toBe('Seasonal staff') // name unknown: the code, tidied
  })
})

describe('people with a company’s own type', () => {
  const emp = (employmentType: string) => ({ id: 'e1', companyId: 'co-1', employeeCode: 'E1', firstName: 'A', lastName: 'B', employmentType } as unknown as WorkforceEmployee)
  const names = (co: string, code: string) => (co === 'co-1' && code === 'APPRENTICE' ? 'Apprentice' : undefined)

  it('show the type’s name in Master, and the defaults as before', () => {
    expect(employeeRec(emp('APPRENTICE'), new Map(), new Map(), names).type).toBe('Apprentice')
    expect(employeeRec(emp('CONTRACT'), new Map(), new Map(), names).type).toBe('Contract')
    expect(employeeRec(emp('FULL_TIME'), new Map(), new Map()).type).toBe('Full-time')
  })

  it('save the type’s code: on Add and on an edit', async () => {
    expect(typeCodeOf('Apprentice', 'co-1', env())).toBe('APPRENTICE')
    expect(typeCodeOf('Contract', 'co-1', env())).toBe('CONTRACT')
    expect(typeCodeOf('Apprentice', 'co-2', env())).toBeUndefined() // another company's type
    await SYNC.employees({ added: [{ co: 'co-1', first: 'Asha', last: 'Rao', type: 'Apprentice', branch: 'b1' } as Rec], changed: [], removed: [] }, env())
    expect(sent[0].body.employmentType).toBe('APPRENTICE')
    sent.length = 0
    const was: Rec = { _key: 'e1', co: 'co-1', first: 'Asha', type: 'Full-time', status: 'Active' }
    await SYNC.employees({ added: [], changed: [[was, { ...was, type: 'Apprentice' }]], removed: [] }, env())
    expect(sent).toEqual([{ url: '/v1/hrms/employees/e1', method: 'PUT', body: { employmentType: 'APPRENTICE' } }])
  })

  it('a contract worker is still linked to their agency (code CONTRACT)', async () => {
    await SYNC.employees({ added: [{ co: 'co-1', first: 'Ravi', type: 'Contract', agency: 'ag-1' } as Rec], changed: [], removed: [] }, env())
    expect(sent[0].body.employmentType).toBe('CONTRACT')
    expect(sent.some((s) => s.url === '/v1/hrms/contractors/ag-1/workers/new-1' && s.method === 'PUT')).toBe(true)
  })
})

describe('Classification Rules saves', () => {
  const full = classes[0], own = classes[2]
  it('a default can’t be renamed or switched off', async () => {
    await expect(SYNC.classes({ added: [], changed: [[full, { ...full, name: 'Permanent' }]], removed: [] }, env())).rejects.toThrow('can’t be changed')
    await expect(SYNC.classes({ added: [], changed: [[full, { ...full, status: 'Inactive' }]], removed: [] }, env())).rejects.toThrow('can’t be changed')
    expect(sent).toEqual([])
  })
  it('a default switched off by an older workspace can be switched on again', async () => {
    const off = { ...full, status: 'Inactive' }
    await SYNC.classes({ added: [], changed: [[off, { ...off, status: 'Active' }]], removed: [] }, env())
    expect(sent[0]).toMatchObject({ url: '/v1/hrms/employment-types/t-FULL_TIME', method: 'PUT', body: { name: 'Full Time', code: 'FULL_TIME', active: true } })
  })
  it('a company’s own type can be added, renamed and switched off', async () => {
    await SYNC.classes({ added: [{ co: 'co-1', name: ' Seasonal ', code: 'seasonal' } as Rec], changed: [], removed: [] }, env())
    expect(sent[0]).toMatchObject({ url: '/v1/hrms/employment-types', method: 'POST', body: { companyId: 'co-1', name: 'Seasonal', code: 'SEASONAL', active: true } })
    await SYNC.classes({ added: [], changed: [[own, { ...own, name: 'Apprentices', status: 'Inactive' }]], removed: [] }, env())
    expect(sent[1]).toMatchObject({ method: 'PUT', body: { name: 'Apprentices', code: 'APPRENTICE', active: false } })
  })
})
