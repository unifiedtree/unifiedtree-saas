// The Master design's wiring for Add employee → "Create": which fields get it,
// that it is shown but inactive with the reason when the permission is missing,
// and that the panel hosts each list's own Master add form. Rendered as markup
// (the repo has no DOM test environment); clicking through the open panel
// needs a browser.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ComponentType, Context, ReactNode } from 'react'
import * as Design from '@/design/master/MasterDesign'
import { MasterCreateField } from './MasterCreateField'
import type { CreateKind } from './masterCreate'

const AppCtx = Design.AppCtx as unknown as Context<any>
const FormFrame = Design.FormFrame as unknown as Context<ComponentType<any> | null>
const EmpForm = Design.EmpForm as unknown as ComponentType<{ emp: any; onClose: () => void }>
const CREATE_FORMS = Design.CREATE_FORMS as unknown as Record<CreateKind, (v: any, onClose: () => void) => ReactNode>

/** Draws a RecordForm in place: its drawer portals, which markup rendering can't do. */
function InlineFrame({ title, cta, children }: { title: ReactNode; cta: ReactNode; children: ReactNode }) {
  return <section data-frame=""><h2>{title}</h2>{children}<button type="button">{cta}</button></section>
}

const db = {
  companies: [{ id: 'co-1', name: 'Acme Labs' }, { id: 'co-2', name: 'Other Co' }],
  branches: [{ id: 'b1', co: 'co-1', name: 'Pune HQ', kind: 'Head office', status: 'Active', city: 'Pune' }],
  depts: [{ id: 'd1', co: 'co-1', name: 'Engineering', code: 'ENG', parent: null, status: 'Active', t: 'teal' }],
  desigs: [], grades: [], classes: [], shifts: [], agencies: [], employees: [], leaves: [], policies: [], components: [], statutory: [],
}
const ctx = (act: Record<string, unknown>) => ({
  db, update: () => {}, toast: () => {}, go: () => {},
  act: { defaultCo: 'co-1', canAssignShift: true, nextCode: '', showAgency: true, canAgency: true, typeOptions: () => ['Full-time', 'Part-time', 'Intern', 'Contract'], ...act },
})
const render = (node: ReactNode, act: Record<string, unknown> = {}) => renderToStaticMarkup(
  <AppCtx.Provider value={ctx(act)}><FormFrame.Provider value={InlineFrame}>{node}</FormFrame.Provider></AppCtx.Provider>,
)
const marker = (k: string) => <i data-create={k} />

// The design's list popovers use useLayoutEffect, which React warns about when rendering to markup.
const realError = console.error
beforeAll(() => { console.error = (...a: unknown[]) => { if (!String(a[0]).includes('useLayoutEffect does nothing on the server')) realError(...a) } })
afterAll(() => { console.error = realError })

describe('Add employee fields', () => {
  it('Branch, Department, Designation, Employment type and Shift get Create', () => {
    const html = render(<EmpForm emp={null} onClose={() => {}} />, { inlineCreate: marker })
    for (const k of ['branches', 'depts', 'desigs', 'classes', 'shifts']) expect(html).toContain(`data-create="${k}"`)
    // Staffing agency shows only for a contract worker (the form starts as Full-time).
    expect(html).not.toContain('data-create="agencies"')
    expect(html).not.toContain('data-create="companies"')
  })
  it('Edit details has none', () => {
    const emp = { id: 'e1', name: 'Asha Rao', code: 'E-1', first: 'Asha', last: 'Rao', email: 'asha@acme.test', co: 'co-1', branch: 'b1', dept: 'd1', desig: '', type: 'Full-time', joined: '2026-01-05', status: 'Active' }
    expect(render(<EmpForm emp={emp} onClose={() => {}} />, { inlineCreate: marker })).not.toContain('data-create=')
  })
  it('without the container’s Create the form is as before', () => {
    expect(render(<EmpForm emp={null} onClose={() => {}} />)).not.toContain('data-create=')
  })
})

describe('the hosted add forms', () => {
  it('are the Master pages’ own forms, drawn in the frame they are given', () => {
    const titles: Record<CreateKind, string> = {
      branches: 'Add branch', depts: 'Add department', desigs: 'Add designation', classes: 'Add classification', shifts: 'Add shift', agencies: 'Add staffing agency',
    }
    for (const [k, title] of Object.entries(titles) as [CreateKind, string][]) {
      const html = render(CREATE_FORMS[k]({ co: 'co-1', dept: 'd1' }, () => {}))
      expect(html).toContain('data-frame=""')
      expect(html).toContain(`<h2>${title}</h2>`)
      expect(html).not.toContain('class="drawer"')
    }
  })
  it('a new branch starts in the employee’s company', () => {
    expect(render(CREATE_FORMS.branches({ co: 'co-2' }, () => {}))).toContain('Other Co')
  })
})

describe('MasterCreateField', () => {
  const field = (allowed: boolean, co: string) => render(
    <MasterCreateField kind="depts" values={{ co }} set={() => {}} allowed={allowed} create={async () => 'id'} />,
  )
  it('is a Create beside the field', () => {
    const html = field(true, 'co-1')
    expect(html).toContain('aria-label="Create department"')
    expect(html).not.toContain('aria-disabled')
  })
  it('without the permission it is shown, inactive, with the reason', () => {
    const html = field(false, 'co-1')
    expect(html).toContain('aria-disabled="true"')
    expect(html).toContain('data-tip="You need permission to manage departments — ask an admin."')
  })
  it('asks for a company first', () => {
    expect(field(true, '')).toContain('data-tip="Pick a company first."')
  })
})
