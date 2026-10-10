// The planner page and the planner tab, rendered as markup with the data hooks answering as the server does:
// who sees Publish (a department planner doesn't), the "information only" note, the phone note, and the
// FEATURE_NOT_READY state that stays inside the planner (nothing else on Shifts & overtime depends on it).
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { HttpError } from '@/core/api/client'
import { COMPANY, PEOPLE, POLICIES, detail, emp } from './__fixtures__/rosterFixtures'

const perms = new Set<string>()
const ok = <T,>(data: T) => ({ data, isLoading: false, isError: false, error: null, refetch: () => Promise.resolve(), dataUpdatedAt: 1 })
const failed = (error: unknown) => ({ data: undefined, isLoading: false, isError: true, error, refetch: () => Promise.resolve(), dataUpdatedAt: 0 })
const mutation = { mutateAsync: async () => ({}), isPending: false }
const notReady = () => new HttpError('This isn’t switched on yet.', 503, { errorCode: 'FEATURE_NOT_READY' })
const DEPT = 'dddddddd-0000-0000-0000-000000000001'
const answers: { detail: unknown; rosters: unknown; templates: unknown; headId: string | null } = { detail: { data: undefined, isLoading: false, error: null }, rosters: ok([]), templates: ok([]), headId: null }

vi.mock('@unifiedtree/sdk', async () => ({ ...(await vi.importActual<object>('@unifiedtree/sdk')), usePermission: (c: string) => perms.has(c) }))
vi.mock('../../company/CurrentCompany', () => ({ useCurrentCompany: () => ({ companyId: COMPANY, company: { id: COMPANY, name: 'Demo' }, companies: [], multi: false, isLoading: false, error: null, version: 0, setCompany: () => {} }) }))
vi.mock('../../api/useShiftPolicies', async () => ({ ...(await vi.importActual<object>('../../api/useShiftPolicies')), useShiftPolicies: () => ok(POLICIES) }))
vi.mock('../../api/useOrg', async () => ({
  ...(await vi.importActual<object>('../../api/useOrg')),
  useDepartments: () => ok([{ id: DEPT, companyId: COMPANY, name: 'Technical', active: true, departmentHeadEmployeeId: answers.headId ?? undefined }]),
  useBranches: () => ok([]),
  useDesignations: () => ok([]),
}))
vi.mock('../../api/useSettings', async () => ({ ...(await vi.importActual<object>('../../api/useSettings')), useHolidays: () => ok([]), useCreateHoliday: () => mutation }))
vi.mock('../../api/useRosters', async () => ({
  ...(await vi.importActual<object>('../../api/useRosters')),
  useRoster: () => answers.detail,
  useRosters: () => answers.rosters,
  useRotationTemplates: () => answers.templates,
  useRosterSettings: () => ok({ companyId: COMPANY, minRestMinutes: 480, rostersDriveAttendance: false, updatedByName: null, updatedAt: null }),
  usePlannerPeople: () => ok(PEOPLE),
  useSaveRoster: () => mutation, usePublishRoster: () => mutation, useDiscardRosterChanges: () => mutation, useDeleteRoster: () => mutation,
  useSaveTemplate: () => mutation, useDeleteTemplate: () => mutation, useSaveRosterSettings: () => mutation,
}))

import { PlannerPage } from './PlannerPage'
import { PlannerHome } from './PlannerHome'

function html(path: string, el = <PlannerPage />) {
  const qc = new QueryClient()
  qc.setQueryData(['employees', 'me'], { id: emp(9) })
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/hrms/shifts/planner/new" element={el} />
          <Route path="/hrms/shifts/planner/:rosterId" element={el} />
          <Route path="/hrms/shifts" element={el} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}
const as = (...codes: string[]) => { perms.clear(); for (const c of codes) perms.add(c) }
const reset = () => { answers.detail = { data: undefined, isLoading: false, error: null }; answers.rosters = ok([]); answers.templates = ok([]); answers.headId = null }

describe('Planner page', () => {
  it('gives a company-wide planner who publishes the steps, Save draft, Check and Publish, with the information-only note', () => {
    reset(); as('attendance.roster.plan', 'attendance.roster.publish', 'attendance.workforce.admin')
    const out = html('/hrms/shifts/planner/new')
    for (const t of ['Planning period', 'Shifts', 'Rotation pattern', 'Staffing', 'People', 'Weekly offs and holidays', 'Generate']) expect(out).toContain(t)
    expect(out).toContain('Save draft')
    expect(out).toContain('>Check<')
    expect(out).toContain('>Publish<')
    expect(out).toContain('Until rosters drive attendance for the company, late marks, weekly offs and overtime still follow each person’s assigned shift.')
    expect(out).toContain('The planner needs a wider screen. Open it on a computer.')
    expect(out).toContain('Live preview')
    expect(out).not.toContain('HR publishes this roster')
  })
  it('shows a department planner no Publish, only that HR publishes it', () => {
    reset(); as('attendance.roster.plan'); answers.headId = emp(9)
    const out = html('/hrms/shifts/planner/new')
    expect(out).toContain('HR publishes this roster when it’s ready.')
    expect(out).not.toContain('>Publish<')
    expect(out).toContain('Save draft')
  })
  it('tells a department planner who heads no department that HR plans for the company', () => {
    reset(); as('attendance.roster.plan'); answers.headId = null
    const out = html('/hrms/shifts/planner/new')
    expect(out).toContain('You don’t head a department.')
    expect(out).not.toContain('Save draft')
  })
  it('says shift planning isn’t switched on yet while the tables are missing, and nothing else', () => {
    reset(); as('attendance.roster.plan', 'attendance.roster.publish', 'attendance.workforce.admin')
    answers.detail = failed(notReady())
    const out = html('/hrms/shifts/planner/11111111-2222-3333-4444-555555555555')
    expect(out).toContain('Shift planning isn’t switched on yet.')
    expect(out).not.toContain('Save draft')
    expect(out).not.toContain('Live preview')
  })
  it('opens a published roster with its status, who published it and Publish changes once changed', () => {
    reset(); as('attendance.roster.plan', 'attendance.roster.publish', 'attendance.workforce.admin')
    answers.detail = ok(detail({ roster: { status: 'PUBLISHED', version: 2, hasUnpublishedChanges: true, publishedByName: 'HR Admin', publishedAt: '2026-09-30T09:00:00Z' } }))
    const out = html('/hrms/shifts/planner/11111111-2222-3333-4444-555555555555')
    expect(out).toContain('Published by HR Admin on 30 Sep 2026 · version 2')
    expect(out).toContain('Published · changes not published')
    expect(out).toContain('Publish changes')
  })
  it('refuses a path that isn’t a roster', () => {
    reset(); as('attendance.roster.plan')
    expect(html('/hrms/shifts/planner/import')).toContain('This page isn’t available.')
  })
  it('lets someone without the planner permissions in no further', () => {
    reset(); as('attendance.team.read')
    expect(html('/hrms/shifts/planner/new')).toContain('Not available for your role')
  })
})

describe('Planner tab', () => {
  it('lists rosters with Plan a roster and Import from Excel', () => {
    reset(); as('attendance.roster.plan', 'attendance.roster.publish', 'attendance.workforce.admin')
    const out = html('/hrms/shifts', <PlannerHome companyId={COMPANY} />)
    expect(out).toContain('Plan a roster')
    expect(out).toContain('Import from Excel')
    expect(out).toContain('Rotation patterns')
    expect(out).toContain('No rosters yet')
    expect(out).toContain('Rest between shifts: at least <b>8 h</b>')
  })
  it('shows its own “not switched on yet” state and nothing else', () => {
    reset(); as('attendance.roster.plan', 'attendance.roster.publish', 'attendance.workforce.admin')
    answers.rosters = failed(notReady())
    const out = html('/hrms/shifts', <PlannerHome companyId={COMPANY} />)
    expect(out).toContain('Shift planning isn’t switched on yet.')
    expect(out).not.toContain('Plan a roster')
  })
  it('lets a publisher who doesn’t plan see the rosters, without planning buttons', () => {
    reset(); as('attendance.roster.publish', 'attendance.workforce.admin')
    answers.rosters = ok([{ ...detail().roster, status: 'DRAFT' }])
    const out = html('/hrms/shifts', <PlannerHome companyId={COMPANY} />)
    expect(out).toContain('October 2026 – Technical')
    expect(out).not.toContain('Plan a roster')
    expect(out).not.toContain('>Delete<')
  })
})
