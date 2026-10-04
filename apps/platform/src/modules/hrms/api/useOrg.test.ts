import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CURRENT_USER_KEY } from '@/shared/hooks/useCurrentUser'
import { COMPANY_LIST_PERMISSIONS, companiesQuery, useCompanies } from './useOrg'
import { answers, fakeApi } from './shared/testing'

// The permission lookup is the SDK's (useAnyPermission: exact code or "*"). A
// server render reads the auth store's initial state, so the hook test below
// stands in for it with the codes it is given and records what it was asked.
const perms = vi.hoisted(() => ({ granted: new Set<string>(), asked: [] as string[][] }))
vi.mock('@unifiedtree/sdk', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@unifiedtree/sdk')>()),
  useAnyPermission: (codes: string[]) => {
    perms.asked.push(codes)
    return codes.some((c) => perms.granted.has(c) || perms.granted.has('*'))
  },
}))

const CO = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const ME = { id: 'u-1', email: 'ravi@ionora.com', employeeId: 'e-1', companyId: CO, companyName: 'Ionora Technologies' }
const LIST = [{ id: CO, name: 'Ionora Technologies', active: true }, { id: 'c-2', name: 'Ionora Labs', active: true }]

/** The server: users/me answers `me`; the company list answers `list` (or throws it). */
function server(me: unknown = ME, list: () => unknown = () => LIST) {
  return fakeApi((path) => (path === '/v1/users/me' ? me : list()))
}
const paths = (calls: { path: string }[]) => calls.map((c) => c.path)

describe('useCompanies without org.company.read (employees, managers)', () => {
  it('never asks for the company list; the own company comes from /users/me', async () => {
    const { api, calls } = server(ME, () => { throw answers.forbidden() })
    const q = companiesQuery(false, new QueryClient(), api)
    await expect(q.queryFn()).resolves.toEqual([{ id: CO, name: 'Ionora Technologies', active: true }])
    expect(paths(calls)).toEqual(['/v1/users/me'])
  })

  it('the page still gets the company it needs (companies[0].id, as Leave and Shifts read it)', async () => {
    const companies = await companiesQuery(false, new QueryClient(), server().api).queryFn()
    const companyId: string = companies[0]?.id ?? ''
    expect(companyId).toBe(CO)
  })

  it('reuses the /users/me the shell already loaded (no second call)', async () => {
    const qc = new QueryClient()
    qc.setQueryData(CURRENT_USER_KEY, ME)
    const { api, calls } = server()
    await expect(companiesQuery(false, qc, api).queryFn()).resolves.toEqual([{ id: CO, name: 'Ionora Technologies', active: true }])
    expect(calls).toEqual([])
  })

  it('a login with no company of its own gets the 403 the list call gave, still without asking for the list', async () => {
    const { api, calls } = server({ ...ME, employeeId: null, companyId: null, companyName: null })
    await expect(companiesQuery(false, new QueryClient(), api).queryFn()).rejects.toMatchObject({ status: 403 })
    expect(paths(calls)).toEqual(['/v1/users/me'])
  })

  it('keeps its own key, under the company key (so company saves refresh it too)', () => {
    expect(companiesQuery(false, new QueryClient()).queryKey).toEqual(['hrms', 'companies', 'own'])
  })
})

describe('useCompanies with org.company.read', () => {
  it('reads the full list', async () => {
    const { api, calls } = server()
    const q = companiesQuery(true, new QueryClient(), api)
    expect(q.queryKey).toEqual(['hrms', 'companies'])
    await expect(q.queryFn()).resolves.toEqual(LIST)
    expect(paths(calls)).toEqual(['/v1/hrms/companies'])
  })

  it('a 403 anyway (role changed since sign-in) still falls back to the own company', async () => {
    const { api, calls } = server(ME, () => { throw answers.forbidden() })
    await expect(companiesQuery(true, new QueryClient(), api).queryFn()).resolves.toEqual([{ id: CO, name: 'Ionora Technologies', active: true }])
    expect(paths(calls)).toEqual(['/v1/hrms/companies', '/v1/users/me'])
  })

  it('other failures stay errors', async () => {
    await expect(companiesQuery(true, new QueryClient(), server(ME, () => { throw answers.serverError() }).api).queryFn()).rejects.toMatchObject({ status: 500 })
    await expect(companiesQuery(true, new QueryClient(), server({ ...ME, companyId: null }, () => { throw answers.forbidden() }).api).queryFn()).rejects.toMatchObject({ status: 403 })
  })
})

describe('useCompanies picks the query from the signed-in person’s permissions', () => {
  /** Renders a component that calls useCompanies and returns the query keys it registered (nothing is fetched on the server). */
  function keysFor(codes: string[]) {
    perms.granted = new Set(codes)
    perms.asked = []
    const qc = new QueryClient()
    const Probe = () => { useCompanies(); return null }
    renderToString(createElement(QueryClientProvider, { client: qc }, createElement(Probe)))
    return qc.getQueryCache().getAll().map((q) => q.queryKey)
  }

  it('asks exactly the server’s guard on GET /v1/hrms/companies', () => {
    expect(COMPANY_LIST_PERMISSIONS).toEqual(['org.company.read', 'platform.admin'])
    keysFor([])
    expect(perms.asked.at(-1)).toEqual(['org.company.read', 'platform.admin'])
  })

  it('an employee or manager (no org.company.read) only gets the own-company query', () => {
    expect(keysFor(['leave.request.self', 'attendance.checkin.self', 'attendance.team.read', 'hrms.leave.approve.l1'])).toEqual([['hrms', 'companies', 'own']])
  })

  it('org.company.read, platform.admin or the "*" superuser get the list', () => {
    expect(keysFor(['org.company.read'])).toEqual([['hrms', 'companies']])
    expect(keysFor(['platform.admin'])).toEqual([['hrms', 'companies']])
    expect(keysFor(['*'])).toEqual([['hrms', 'companies']])
  })
})
