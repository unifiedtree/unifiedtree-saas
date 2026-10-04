// The Master pages' own Add forms on a workspace with several companies: a
// Company field picks where the new record goes. It starts on the company the
// page is filtered to (?co=), else the first; the save carries that company to
// the API; a workspace with one company gets no field and saves as before; edit
// forms don't offer it; and Add employee → Create still saves in the employee's
// company. Rendered as markup (the repo has no DOM test environment): the frame
// keeps the form's Save so a test can press it after rendering.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ComponentType, Context, ReactNode } from 'react'

const sent: { url: string; body: any }[] = []
vi.mock('@/core/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/core/api/client')>('@/core/api/client')
  return {
    ...actual,
    apiJson: async (url: string, init?: { body?: string }) => { sent.push({ url, body: init?.body ? JSON.parse(init.body) : undefined }); return { id: 'new-1' } },
  }
})

import * as Design from '@/design/master/MasterDesign'
import { SYNC, type SyncEnv } from './masterSync'
import { scopeDb } from './masterCreate'
import type { Rec } from './masterData'

type Forms = 'DeptForm' | 'ClassForm' | 'GradeForm' | 'ShiftForm' | 'LeaveForm' | 'AgencyForm'
const AppCtx = Design.AppCtx as unknown as Context<any>
const FormFrame = Design.FormFrame as unknown as Context<ComponentType<any> | null>
const F = Design as unknown as Record<Forms, ComponentType<any>>
const CREATE_FORMS = Design.CREATE_FORMS as unknown as Record<string, (v: Rec, onClose: () => void) => ReactNode>

const ACME = { id: 'co-1', name: 'Acme Labs', status: 'Active' }
const BETA = { id: 'co-2', name: 'Beta Works', status: 'Active' }
const dbOf = (companies: Rec[]): Record<string, Rec[]> => ({
  companies,
  branches: [
    { id: 'b1', co: 'co-1', name: 'Pune HQ', city: 'Pune', kind: 'Head office', status: 'Active' },
    { id: 'b2', co: 'co-2', name: 'Kochi Plant', city: 'Kochi', kind: 'Plant', status: 'Active' },
  ],
  depts: [
    { id: 'd1', _key: 'd1', co: 'co-1', name: 'Engineering', code: 'ENG', parent: null, status: 'Active', t: 'teal', icon: 'code' },
    { id: 'd2', _key: 'd2', co: 'co-2', name: 'Operations', code: 'OPS', parent: null, status: 'Active', t: 'blue', icon: 'truck' },
  ],
  desigs: [], grades: [], classes: [], shifts: [], agencies: [], employees: [], leaves: [], policies: [], components: [], statutory: [],
})
const TWO = dbOf([ACME, BETA])

/** Each page's Add form, as its Add button opens it. */
const ADD: Record<Forms, ReactNode> = {
  DeptForm: <F.DeptForm x={null} init={{ t: 'teal', icon: 'briefcase' }} onClose={() => {}} />,
  ClassForm: <F.ClassForm c={null} onClose={() => {}} />,
  GradeForm: <F.GradeForm g={null} onClose={() => {}} />,
  ShiftForm: <F.ShiftForm s={null} onClose={() => {}} />,
  LeaveForm: <F.LeaveForm l={null} onClose={() => {}} />,
  AgencyForm: <F.AgencyForm a={null} onClose={() => {}} />,
}

/** Draws a RecordForm in place (its drawer portals) and keeps its Save. */
let pressSave: (() => void) | null = null
function Frame({ title, onSubmit, children }: { title: ReactNode; onSubmit: () => void; children: ReactNode }) {
  pressSave = onSubmit
  return <section><h2>{title}</h2>{children}</section>
}

function open(form: ReactNode, { db = TWO, co = '', defaultCo = 'co-1' }: { db?: Record<string, Rec[]>; co?: string; defaultCo?: string } = {}) {
  const saved: Rec[] = []
  const update = (k: string, fn: Rec[] | ((l: Rec[]) => Rec[])) => {
    const prev = db[k] || []
    const next = typeof fn === 'function' ? fn(prev) : fn
    saved.push(...next.filter((r) => !prev.includes(r)))
  }
  const ctx = { db, update, toast: () => {}, go: () => {}, route: { p: 'x', co }, act: { defaultCo, canBands: true } }
  pressSave = null
  const html = renderToStaticMarkup(<AppCtx.Provider value={ctx}><FormFrame.Provider value={Frame}>{form}</FormFrame.Provider></AppCtx.Provider>)
  /** Presses Save; the new record the form made, or undefined when its checks stopped it. */
  const save = () => { pressSave!(); return saved[0] }
  return { html, save }
}
/** The company the form's Company field shows, or null when there is no such field. */
const companyShown = (html: string) => {
  if (!html.includes('<label>Company<em>*</em></label>')) return null
  return html.match(/<label>Company<em>\*<\/em><\/label><div class="dd field"><button[^>]*><span>([^<]*)<\/span>/)?.[1] ?? ''
}

const env = (over: Partial<SyncEnv> = {}): SyncEnv => ({
  today: '2026-10-04', defaultCo: 'co-1', coOfDept: (id) => ({ d1: 'co-1', d2: 'co-2' } as Record<string, string>)[id], branches: [], settings: null,
  nextGradeLevel: 1, canInvite: false, canAssignShift: false, canBands: true, gradeIdOf: () => undefined, warn: () => {}, ...over,
})
const add = (rec: Rec) => ({ added: [rec], changed: [], removed: [] })

// The design's list popovers use useLayoutEffect, which React warns about when rendering to markup.
const realError = console.error
beforeAll(() => { console.error = (...a: unknown[]) => { if (!String(a[0]).includes('useLayoutEffect does nothing on the server')) realError(...a) } })
afterAll(() => { console.error = realError })
beforeEach(() => { sent.length = 0 })

describe('Add forms on a workspace with two companies', () => {
  it('ask which company, starting on the first', () => {
    for (const [name, form] of Object.entries(ADD)) expect(companyShown(open(form).html), name).toBe('Acme Labs')
  })
  it('start on the company the page is filtered to', () => {
    for (const [name, form] of Object.entries(ADD)) expect(companyShown(open(form, { co: 'co-2' }).html), name).toBe('Beta Works')
  })
  it('a filter that isn’t an active company falls back to the first', () => {
    expect(companyShown(open(ADD.DeptForm, { co: 'co-gone' }).html)).toBe('Acme Labs')
  })
  it('a sub-team starts in its parent’s company', () => {
    expect(companyShown(open(<F.DeptForm x={null} init={{ parent: 'd2', t: 'blue', icon: 'truck' }} onClose={() => {}} />).html)).toBe('Beta Works')
  })
  it('offer the chosen company’s branches and sites only', () => {
    const dept = open(ADD.DeptForm, { co: 'co-2' }).html
    expect(dept).toContain('Kochi Plant')
    expect(dept).not.toContain('Pune HQ')
    const agency = open(ADD.AgencyForm, { co: 'co-2' }).html
    expect(agency).toContain('Kochi')
    expect(agency).not.toContain('Pune')
  })
  it('save the department in the chosen company', async () => {
    const rec = open(<F.DeptForm x={null} init={{ name: 'Data Science', code: 'DSC', t: 'teal', icon: 'briefcase' }} onClose={() => {}} />, { co: 'co-2' }).save()
    expect(rec).toMatchObject({ name: 'Data Science', co: 'co-2' })
    await SYNC.depts(add(rec), env())
    expect(sent).toEqual([{ url: '/v1/hrms/departments', body: expect.objectContaining({ companyId: 'co-2', name: 'Data Science', code: 'DSC' }) }])
  })
  it('save a duplicated shift in the chosen company', async () => {
    const late = { id: 's1', _key: 's1', name: 'Late', code: 'LATE', kind: 'Fixed', start: 660, end: 1200, grace: 10, hours: 8, offs: ['Sun'], ot: false, rate: null, status: 'Active', icon: 'sun', t: 'amber' }
    const rec = open(<F.ShiftForm s={null} copy={{ ...late, name: 'Late (copy)', code: '' }} onClose={() => {}} />, { co: 'co-2' }).save()
    expect(rec).toMatchObject({ name: 'Late (copy)', co: 'co-2' })
    await SYNC.shifts(add(rec), env())
    expect(sent.map((s) => s.url)).toEqual(['/v1/shifts?companyId=co-2'])
  })
})

describe('the save sends the company the form chose', () => {
  const cases: [string, Rec, (s: { url: string; body: any }) => string][] = [
    ['depts', { name: 'Data Science', code: 'DSC', t: 'teal', icon: 'briefcase' }, (s) => s.body.companyId],
    ['grades', { id: 'L9', name: 'Principal', min: null, max: null }, (s) => s.body.companyId],
    ['classes', { name: 'Apprentice', code: 'APPRENTICE' }, (s) => s.body.companyId],
    ['agencies', { name: 'Apex Staffing', reg: 'APX-1', contact: 'Ravi', sites: ['b2'] }, (s) => s.body.companyId],
    ['shifts', { name: 'Late', kind: 'Fixed', start: 660, end: 1200, grace: 10, hours: 8, offs: [], ot: false }, (s) => new URL(s.url, 'http://x').searchParams.get('companyId')!],
    ['leaves', { name: 'Marriage Leave', code: 'MRL', cat: 'Casual', quota: 3, paid: true, carry: 0, accrual: 'Upfront' }, (s) => new URL(s.url, 'http://x').searchParams.get('companyId')!],
  ]
  it('the chosen company', async () => {
    for (const [k, rec, coOfCall] of cases) {
      sent.length = 0
      await SYNC[k](add({ ...rec, co: 'co-2' }), env())
      expect(sent.map(coOfCall), k).toEqual(['co-2'])
    }
  })
  it('no choice (one company): the default company, as before', async () => {
    for (const [k, rec, coOfCall] of cases) {
      sent.length = 0
      await SYNC[k](add(rec), env())
      expect(sent.map(coOfCall), k).toEqual(['co-1'])
    }
  })
  it('a sub-team goes where its parent is', async () => {
    await SYNC.depts(add({ name: 'Night shift team', code: 'NST', parent: 'd2', co: 'co-2' }), env())
    expect(sent[0].body).toMatchObject({ companyId: 'co-2', parentDepartmentId: 'd2' })
  })
})

describe('a workspace with one company', () => {
  const ONE = dbOf([ACME])
  it('gets no Company field on any add form', () => {
    for (const [name, form] of Object.entries(ADD)) expect(companyShown(open(form, { db: ONE }).html), name).toBeNull()
  })
  it('a second company that’s inactive doesn’t count', () => {
    expect(companyShown(open(ADD.DeptForm, { db: dbOf([ACME, { ...BETA, status: 'Inactive' }]) }).html)).toBeNull()
  })
  it('saves in its default company, as before', async () => {
    const rec = open(<F.DeptForm x={null} init={{ name: 'Data Science', code: 'DSC', t: 'teal', icon: 'briefcase' }} onClose={() => {}} />, { db: ONE }).save()
    expect(rec.co).toBeUndefined()
    await SYNC.depts(add(rec), env())
    expect(sent[0].body.companyId).toBe('co-1')
  })
})

describe('edit forms', () => {
  it('don’t offer the company', () => {
    const forms: ReactNode[] = [
      <F.DeptForm x={TWO.depts[1]} init={TWO.depts[1]} onClose={() => {}} />,
      <F.ClassForm c={{ id: 't1', _key: 't1', name: 'Apprentice', code: 'APPRENTICE', status: 'Active', co: 'co-2' }} onClose={() => {}} />,
      <F.GradeForm g={{ id: 'L1', _key: 'g1', name: 'Junior', min: null, max: null, status: 'Active', co: 'co-2' }} onClose={() => {}} />,
      <F.AgencyForm a={{ id: 'a1', _key: 'a1', name: 'Apex', reg: 'APX-1', contact: 'Ravi', sites: ['b2'], workers: 0, status: 'Active', co: 'co-2' }} onClose={() => {}} />,
    ]
    for (const form of forms) expect(companyShown(open(form, { co: 'co-1' }).html)).toBeNull()
  })
})

describe('Add employee → Create', () => {
  // As MasterCreateField hosts a Master add form: only the employee's company (co-2) in the data, and the
  // container saves with that company as the default — here while the page is filtered to another company.
  const hosted = { db: scopeDb(TWO, 'co-2'), co: 'co-1', defaultCo: 'co-2' }
  it('shows no Company field: the employee’s company is fixed', () => {
    for (const k of ['depts', 'classes', 'shifts', 'agencies']) expect(companyShown(open(CREATE_FORMS[k]({ co: 'co-2' }, () => {}), hosted).html), k).toBeNull()
  })
  it('still saves in the employee’s company', async () => {
    const rec = open(<F.DeptForm x={null} init={{ name: 'Data Science', code: 'DSC', t: 'teal', icon: 'briefcase' }} onClose={() => {}} />, hosted).save()
    expect(rec.co).toBeUndefined()
    await SYNC.depts(add(rec), env({ defaultCo: 'co-2' }))
    expect(sent[0].body.companyId).toBe('co-2')
  })
})
