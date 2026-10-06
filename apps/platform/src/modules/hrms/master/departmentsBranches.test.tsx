// E-10: the Departments page loads the branches, so a department's "Branches" field (Add and Edit)
// lists its company's branches there too, not only when the form opens from Add employee.
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ComponentType, Context, ReactNode } from 'react'
import { NEEDS } from './MasterContainer'
import * as Design from '@/design/master/MasterDesign'
import type { Rec } from './masterData'

const AppCtx = Design.AppCtx as unknown as Context<any>
const FormFrame = Design.FormFrame as unknown as Context<ComponentType<any> | null>
const DeptForm = (Design as unknown as Record<'DeptForm', ComponentType<any>>).DeptForm
const Frame = ({ title, children }: { title: ReactNode; children: ReactNode }) => <section><h2>{title}</h2>{children}</section>

const db = (branches: Rec[]): Record<string, Rec[]> => ({
  companies: [{ id: 'co-1', name: 'Acme Labs', status: 'Active' }],
  branches,
  depts: [{ id: 'd1', _key: 'd1', co: 'co-1', name: 'Engineering', code: 'ENG', parent: null, status: 'Active', t: 'teal', icon: 'code', branches: ['b1'] }],
  desigs: [], grades: [], classes: [], shifts: [], agencies: [], employees: [], leaves: [], policies: [], components: [], statutory: [],
})
const editEngineering = (branches: Rec[]) => {
  const d = db(branches)
  const ctx = { db: d, update: () => {}, toast: () => {}, go: () => {}, route: { p: 'departments', co: '' }, act: { defaultCo: 'co-1' } }
  return renderToStaticMarkup(<AppCtx.Provider value={ctx}><FormFrame.Provider value={Frame}><DeptForm x={d.depts[0]} init={d.depts[0]} onClose={() => {}} /></FormFrame.Provider></AppCtx.Provider>)
}

describe('Departments page', () => {
  it('loads the branches with the departments', () => {
    expect(NEEDS.departments).toEqual(expect.arrayContaining(['depts', 'branches']))
  })

  it('so Edit department shows the branch it works at', () => {
    const html = editEngineering([{ id: 'b1', co: 'co-1', name: 'Pune HQ', city: 'Pune', kind: 'Head office', status: 'Active' }])
    expect(html).toContain('Pune HQ')
  })

  it('pages that never used branches still don’t load them', () => {
    for (const p of ['designations', 'grades', 'leaves', 'components']) expect(NEEDS[p], p).not.toContain('branches')
  })
})
