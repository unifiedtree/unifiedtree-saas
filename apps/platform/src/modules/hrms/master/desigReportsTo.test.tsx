// Designations → "Reports to" (audit H-56), rendered as markup: the table's column and the form's field.
// The Hierarchy view's rows come from desigTree (desigTree.test.ts); switching to it needs a browser.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ComponentType, Context, ReactNode } from 'react'
import * as Design from '@/design/master/MasterDesign'
import { desigRec } from './masterData'

const AppCtx = Design.AppCtx as unknown as Context<any>
const FormFrame = Design.FormFrame as unknown as Context<ComponentType<any> | null>
const PAGES = Design.PAGES as unknown as Record<string, ComponentType>
const CREATE_FORMS = Design.CREATE_FORMS as unknown as Record<string, (v: any, onClose: () => void) => ReactNode>

function InlineFrame({ title, children }: { title: ReactNode; children: ReactNode }) {
  return <section data-frame=""><h2>{title}</h2>{children}</section>
}

const raw = (id: string, title: string, reportsToDesignationId?: string) =>
  desigRec({ id, title, companyId: 'co-1', departmentId: 'd1', grade: '', active: true, reportsToDesignationId } as any)
const db = {
  companies: [{ id: 'co-1', name: 'Acme Labs' }],
  branches: [], depts: [{ id: 'd1', co: 'co-1', name: 'Engineering', code: 'ENG', parent: null, status: 'Active', t: 'teal', icon: 'code' }],
  desigs: [raw('ceo', 'Chief Executive'), raw('cto', 'Chief Technology Officer', 'ceo'), raw('eng', 'Engineer', 'cto')],
  grades: [], classes: [], shifts: [], agencies: [], employees: [], leaves: [], policies: [], components: [], statutory: [],
}
const ctx = { db, d: { desig: {}, dept: {}, grade: {}, branch: {}, co: {}, type: {}, shift: {} }, update: () => {}, toast: () => {}, go: () => {}, t: { pageSize: 10 }, act: { defaultCo: 'co-1' } }
const render = (node: ReactNode) => renderToStaticMarkup(
  <AppCtx.Provider value={ctx}><FormFrame.Provider value={InlineFrame}>{node}</FormFrame.Provider></AppCtx.Provider>,
)

const realError = console.error
beforeAll(() => { console.error = (...a: unknown[]) => { if (!String(a[0]).includes('useLayoutEffect does nothing on the server')) realError(...a) } })
afterAll(() => { console.error = realError })

describe('Designations: reports to', () => {
  it('maps the API field', () => {
    expect(db.desigs[1].reportsTo).toBe('ceo')
    expect(db.desigs[0].reportsTo).toBe('')
  })
  it('the table has a Reports to column, "Top" for the top of the ladder, and a Hierarchy switch', () => {
    const Page = PAGES.designations
    const html = render(<Page />)
    expect(html).toContain('<th>Reports to</th>')
    expect(html).toContain('>Top<')
    expect(html).toContain('Hierarchy')
  })
  it('the form asks who it reports to', () => {
    const html = render(CREATE_FORMS.desigs({ dept: 'd1' }, () => {}))
    expect(html).toContain('Reports to')
    expect(html).toContain('No one · top of the ladder')
  })
})
