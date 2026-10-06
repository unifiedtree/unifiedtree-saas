// w43 (testers 6 Oct): branch and agency logos on their rows, cards and forms (V143.102), an agency's
// contract workers, and the big tiles' icon / initials centred again (a bare `.lg` legend rule used
// to turn ".tile lg" into a left-aligned flex row). Rendered as markup (no DOM test environment).
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ComponentType, Context, ReactNode } from 'react'
import * as Design from '@/design/master/MasterDesign'
import type { Rec } from './masterData'

const AppCtx = Design.AppCtx as unknown as Context<any>
const FormFrame = Design.FormFrame as unknown as Context<ComponentType<any> | null>
const D = Design as unknown as Record<string, ComponentType<any>> & { deriveDB: (db: Record<string, Rec[]>) => unknown }
const PAGES = Design.PAGES as unknown as Record<string, ComponentType>
const Frame = ({ title, children }: { title: ReactNode; children: ReactNode }) => <section><h2>{title}</h2>{children}</section>

const branch = { id: 'b1', _key: 'b1', co: 'co-1', name: 'Pune HQ', code: 'PUN', city: 'Pune', state: 'Maharashtra', kind: 'Head office', status: 'Active', icon: 'building-2', logo: '/v1/public/images/t/b1' }
const plain = { id: 'b2', _key: 'b2', co: 'co-1', name: 'Nagpur Plant', code: 'NAG', city: 'Nagpur', state: 'Maharashtra', kind: 'Plant', status: 'Active', icon: 'factory', logo: null }
const agency = { id: 'a1', _key: 'a1', co: 'co-1', name: 'Apex Staffing', reg: 'APX-1', service: 'Security', contact: 'R. Iyer', phone: '', email: '', workers: 2, sites: ['b1'], licence: null, licenceNo: '', status: 'Active', t: 'orange', logo: '/v1/public/images/t/a1' }
const db: Record<string, Rec[]> = {
  companies: [{ id: 'co-1', name: 'Acme Labs', status: 'Active', ids: {} }], branches: [branch, plain], agencies: [agency],
  depts: [], desigs: [], grades: [], classes: [], shifts: [], employees: [], leaves: [], policies: [], components: [], statutory: [],
}
const ctx = (act: Record<string, unknown> = {}) => ({
  db, d: D.deriveDB(db), update: () => {}, toast: () => {}, go: () => {}, route: { p: 'branches', co: '', q: '' }, t: { nav: 'Top tabs' }, group: null,
  act: { defaultCo: 'co-1', canLogo: { branches: true, agencies: true }, exportAgencies: () => {}, showArchivedBranches: () => {}, loadWorkers: async () => [], ...act },
})
const render = (node: ReactNode, act?: Record<string, unknown>) => renderToStaticMarkup(
  <QueryClientProvider client={new QueryClient()}><AppCtx.Provider value={ctx(act)}><FormFrame.Provider value={Frame}>{node}</FormFrame.Provider></AppCtx.Provider></QueryClientProvider>,
)

describe('Branches', () => {
  it('a branch with a logo shows it in its row; one without keeps its icon', () => {
    const html = render(<PAGES.branches />)
    expect(html).toContain('<span class="tile logo"><img src="/api/v1/public/images/t/b1"')
    expect(html.match(/class="tile logo"/g)).toHaveLength(1)
  })
  it('Edit branch has a Logo section with upload; Add branch doesn’t (it needs the branch first)', () => {
    const edit = render(<D.BranchForm b={branch} init={branch} onClose={() => {}} />)
    expect(edit).toContain('Change logo')
    expect(edit).toContain('data-image-picker="branch"')
    const add = render(<D.BranchForm b={null} init={{ co: 'co-1', kind: 'Branch', status: 'Active' }} onClose={() => {}} />)
    expect(add).not.toContain('data-image-picker')
  })
  it('without the permission the logo is shown, not changeable', () => {
    const html = render(<D.BranchForm b={branch} init={branch} onClose={() => {}} />, { canLogo: { branches: false, agencies: false } })
    expect(html).not.toContain('data-image-picker')
    expect(html).toContain('You don’t have access to change the logo')
  })
})

describe('Contractor Master', () => {
  it('an agency card shows its logo, and its workers count opens the workers list', () => {
    const html = render(<PAGES.contractors />, {})
    expect(html).toContain('<span class="tile lg logo"><img src="/api/v1/public/images/t/a1"')
    expect(html).toContain('aria-label="Workers of Apex Staffing"')
  })
  it('Edit agency has the Logo section', () => {
    expect(render(<D.AgencyForm a={agency} onClose={() => {}} />)).toContain('data-image-picker="agency"')
  })
})

describe('icon alignment', () => {
  it('the legend rule no longer matches the big tiles', () => {
    const css = readFileSync(resolve(__dirname, '../../../design/master/master.css'), 'utf8')
    expect(css).not.toMatch(/(^|\n)\.utm \.lg\{display:flex/)
    expect(css).toContain('.utm .legend .lg{display:flex')
    expect(css).toContain('.utm .tile{width:36px;height:36px;border-radius:10px;display:grid;place-items:center')
  })
})
