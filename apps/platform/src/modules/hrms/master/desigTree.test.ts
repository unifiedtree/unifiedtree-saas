import { describe, expect, it } from 'vitest'
import { descendantsOf, desigTree, reportsToOptions, type DesigLike } from './desigTree'

const d = (id: string, reportsTo = '', co = 'c1', extra: Partial<DesigLike> = {}): DesigLike => ({ id, _key: id, name: id, reportsTo, co, status: 'Active', ...extra })

describe('desigTree', () => {
  it('lays the ladder out top to bottom, A–Z at each level', () => {
    const rows = desigTree([d('Engineer', 'Lead'), d('CEO'), d('Lead', 'CTO'), d('CTO', 'CEO'), d('Analyst', 'CEO')])
    expect(rows.map((r) => `${r.depth}:${r.d.id}`)).toEqual(['0:CEO', '1:Analyst', '1:CTO', '2:Lead', '3:Engineer'])
    expect(rows.find((r) => r.d.id === 'CEO')!.children).toBe(2)
  })
  it('never hangs on a loop, a missing link or another company', () => {
    const rows = desigTree([d('A', 'B'), d('B', 'A'), d('C', 'A'), d('X', 'gone'), d('Y', 'Z', 'c1'), d('Z', '', 'c2')])
    expect(rows).toHaveLength(6)
    expect(rows.filter((r) => r.depth === 0).map((r) => r.d.id).sort()).toEqual(['A', 'B', 'X', 'Y', 'Z'])
    expect(rows.find((r) => r.d.id === 'C')!.depth).toBe(1)
  })
})

describe('reportsToOptions', () => {
  const list = [d('CEO'), d('CTO', 'CEO'), d('Lead', 'CTO'), d('Eng', 'Lead'), d('Old', '', 'c1', { status: 'Inactive' }), d('Other', '', 'c2'), { id: 'DS1', name: 'New one', co: 'c1' }]
  it('leaves out itself, everything below it, inactive, unsaved and other-company titles', () => {
    expect(reportsToOptions(list, 'CTO', 'c1').map((x) => x.id)).toEqual(['CEO'])
    expect(reportsToOptions(list, null, 'c1').map((x) => x.id)).toEqual(['CEO', 'CTO', 'Eng', 'Lead'])
    expect([...descendantsOf(list, 'CEO')].sort()).toEqual(['CTO', 'Eng', 'Lead'])
  })
})
