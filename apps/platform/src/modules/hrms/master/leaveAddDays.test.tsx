// A new leave rule starts at 0 days a year: the admin types the number they want
// (owner decision, Oct 2026). Rendered as markup (the repo has no DOM test environment).
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ComponentType, Context, ReactNode } from 'react'
import * as Design from '@/design/master/MasterDesign'

const AppCtx = Design.AppCtx as unknown as Context<any>
const FormFrame = Design.FormFrame as unknown as Context<ComponentType<any> | null>
const LeaveForm = (Design as unknown as Record<string, ComponentType<any>>).LeaveForm

const db = {
  companies: [{ id: 'co-1', name: 'Acme Labs', status: 'Active' }],
  branches: [], depts: [], desigs: [], grades: [], classes: [], shifts: [], agencies: [], employees: [],
  leaves: [], policies: [], components: [], statutory: [],
}
const Frame = ({ children }: { children: ReactNode }) => <section>{children}</section>

describe('Master → Leave rules → Add', () => {
  it('pre-fills the annual quota with 0 days', () => {
    const ctx = { db, update: () => {}, toast: () => {}, go: () => {}, route: { p: 'x', co: '' }, act: { defaultCo: 'co-1', canBands: true } }
    const html = renderToStaticMarkup(
      <AppCtx.Provider value={ctx}><FormFrame.Provider value={Frame}><LeaveForm l={null} onClose={() => {}} /></FormFrame.Provider></AppCtx.Provider>)
    const quota = html.slice(html.indexOf('Annual quota'))
    expect(quota.match(/<input[^>]*>/)?.[0]).toMatch(/value="0"/)
  })
})
