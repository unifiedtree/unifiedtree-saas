// The HRMS's current company (CurrentCompany.tsx) and its list (companySource.ts): the default is the
// person's home company, else the first; a person's choice is remembered; a link's ?co= opens that
// company; a switch drops what was loaded for the other company; one company = no selector.
// Rendered as markup (the repo has no DOM test environment).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

const auth = vi.hoisted(() => ({
  state: { status: 'authenticated', user: { id: 'u-1', roles: ['OWNER'] }, tenant: { id: 't-1' }, modules: [{ key: 'hrms', enabled: true }] } as Record<string, unknown>,
  canList: true,
}))
vi.mock('@unifiedtree/sdk', async (importOriginal) => {
  const real = await importOriginal<typeof import('@unifiedtree/sdk')>()
  const useAuthStore = Object.assign((sel: (s: Record<string, unknown>) => unknown) => sel(auth.state), { getState: () => auth.state })
  return { ...real, useAuthStore, useAnyPermission: () => auth.canList }
})
vi.mock('@/shared/navigation/useAccess', () => ({ useAccessContext: () => ({ modules: ['hrms'] }) }))

import { HttpError, companyHeaderFor, setCompanyHeader } from '@/core/api/client'
import { CURRENT_USER_KEY } from '@/shared/hooks/useCurrentUser'
import { CompanySwitcher } from '@/design/shell/CompanySwitcher'
import { CurrentCompanyProvider, companyStorageKey, isCompanyAccessDenied, resolveCompany, useCurrentCompany, type CurrentCompanyValue } from './CurrentCompany'
import { accessibleCompaniesQuery, isCompanyNeutral, isWorkspaceWide, readMeCompanies, type AccessibleCompanies, type CompanySource } from './companySource'

const A = { id: 'co-a', name: 'Acme Labs' }
const B = { id: 'co-b', name: 'Beta Works' }
const C = { id: 'co-c', name: 'Cobalt Retail' }
const KEY = companyStorageKey('t-1', 'u-1')

/** A localStorage for node (the app's reads and writes are all in try/catch). */
const store = new Map<string, string>()
beforeEach(() => {
  store.clear()
  vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v) }, removeItem: (k: string) => { store.delete(k) } })
  auth.canList = true
  setCompanyHeader(null)
})
afterEach(() => { vi.unstubAllGlobals() })

/** Renders `ui` under the provider with the list already loaded; returns the markup and what the hook saw. */
function render(list: AccessibleCompanies | null, opts: { url?: string; source?: CompanySource; qc?: QueryClient; ui?: ReactNode } = {}) {
  const qc = opts.qc ?? new QueryClient()
  const source = opts.source ?? 'hrms-companies'
  if (list) qc.setQueryData(accessibleCompaniesQuery(true, qc, source).queryKey, list)
  const seen: { value: CurrentCompanyValue | null } = { value: null }
  function Probe() { seen.value = useCurrentCompany(); return <i data-co={seen.value.companyId} /> }
  const html = renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[opts.url ?? '/hrms/leave']}>
        <CurrentCompanyProvider source={source}>
          <Probe />
          {opts.ui}
        </CurrentCompanyProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { html, value: seen.value!, qc }
}

describe('the current company', () => {
  it('starts on the person’s home company', () => {
    expect(render({ companies: [A, B, C], homeId: B.id }).value.companyId).toBe(B.id)
  })

  it('starts on the first company when there is no home company (or it is not in the list)', () => {
    expect(render({ companies: [A, B], homeId: null }).value.companyId).toBe(A.id)
    expect(render({ companies: [A, B], homeId: 'co-gone' }).value.companyId).toBe(A.id)
  })

  it('remembers the person’s choice (per workspace and person)', () => {
    store.set(KEY, C.id)
    expect(render({ companies: [A, B, C], homeId: B.id }).value.companyId).toBe(C.id)
    // Someone else's choice on the same browser is not this person's.
    store.clear(); store.set(companyStorageKey('t-1', 'u-2'), C.id)
    expect(render({ companies: [A, B, C], homeId: B.id }).value.companyId).toBe(B.id)
  })

  it('ignores a remembered company the person can no longer open', () => {
    store.set(KEY, 'co-removed')
    expect(render({ companies: [A, B], homeId: B.id }).value.companyId).toBe(B.id)
  })

  it('opens the company a link names (?co=), over the remembered one', () => {
    store.set(KEY, C.id)
    expect(render({ companies: [A, B, C], homeId: B.id }, { url: '/hrms/master/departments?co=co-a' }).value.companyId).toBe(A.id)
  })

  it('ignores a ?co= the person can’t open', () => {
    expect(render({ companies: [A, B], homeId: B.id }, { url: '/hrms/leave?co=co-other' }).value.companyId).toBe(B.id)
  })

  it('has no company until the list has loaded', () => {
    const { value } = render(null)
    expect(value.companyId).toBe('')
    expect(value.company).toBeNull()
    expect(value.multi).toBe(false)
  })
})

describe('switching company', () => {
  it('drops what was loaded for the other company and keeps the person and the company lists', () => {
    const qc = new QueryClient()
    qc.setQueryData(['hrms', 'leave', 'types', A.id], [{ id: 'lt-a' }])
    qc.setQueryData(['hrms', 'attendance', 'dashboard', '2026-10-06'], { rows: ['someone in A'] })
    qc.setQueryData(['dashboard', 'summary', A.id], { total: 4 })
    qc.setQueryData(CURRENT_USER_KEY, { id: 'u-1', companyId: A.id })
    qc.setQueryData(['hrms', 'companies'], [A, B])
    qc.setQueryData(['rbac', 'roles'], [])
    const { value } = render({ companies: [A, B], homeId: A.id }, { qc })
    expect(value.companyId).toBe(A.id)

    value.setCompany(B.id)

    expect(qc.getQueryData(['hrms', 'leave', 'types', A.id])).toBeUndefined()
    expect(qc.getQueryData(['hrms', 'attendance', 'dashboard', '2026-10-06'])).toBeUndefined()
    expect(qc.getQueryData(['dashboard', 'summary', A.id])).toBeUndefined()
    expect(qc.getQueryData(CURRENT_USER_KEY)).toBeDefined()
    expect(qc.getQueryData(['hrms', 'companies'])).toBeDefined()
    expect(qc.getQueryData(['rbac', 'roles'])).toBeDefined()
    // Remembered for next time.
    expect(store.get(KEY)).toBe(B.id)
    // And the next render is on B.
    expect(render({ companies: [A, B], homeId: A.id }).value.companyId).toBe(B.id)
  })

  it('ignores a company that is not in the list, and the company already open', () => {
    const qc = new QueryClient()
    qc.setQueryData(['hrms', 'leave', 'types', A.id], [{ id: 'lt-a' }])
    const { value } = render({ companies: [A, B], homeId: A.id }, { qc })
    value.setCompany('co-elsewhere')
    value.setCompany(A.id)
    expect(qc.getQueryData(['hrms', 'leave', 'types', A.id])).toBeDefined()
    expect(store.has(KEY)).toBe(false)
  })

  it('keys pages on a version that goes up only on a switch', () => {
    expect(render({ companies: [A, B], homeId: A.id }).value.version).toBe(0)
  })
})

describe('the X-Company-Id header', () => {
  it('is not sent while the list comes from /v1/hrms/companies (production’s CORS would refuse it)', () => {
    render({ companies: [A, B], homeId: B.id })
    expect(companyHeaderFor('/v1/leave/types')).toEqual({})
  })

  it('carries the current company once the list comes from /v1/me/companies, and a switch moves it', () => {
    const { value } = render({ companies: [A, B], homeId: B.id }, { source: 'me-companies' })
    expect(companyHeaderFor('/v1/leave/types?companyId=co-b')).toEqual({ 'X-Company-Id': B.id })
    value.setCompany(A.id)
    expect(companyHeaderFor('/v1/attendance/dashboard')).toEqual({ 'X-Company-Id': A.id })
  })

  it('is never sent to sign-in, public pages or the company list itself', () => {
    setCompanyHeader(B.id)
    for (const p of ['/v1/canonical-auth/refresh', '/v1/auth/login', '/v1/public/module-plans', '/v1/me/companies']) expect(companyHeaderFor(p)).toEqual({})
  })
})

describe('the selector', () => {
  it('shows the current company by name to people with two or more companies', () => {
    const { html } = render({ companies: [A, B], homeId: B.id }, { ui: <CompanySwitcher /> })
    expect(html).toContain('Company: Beta Works. Switch company')
    expect(html).toContain('class="ut-cosel"')
  })

  it('is not there with one company, and the page gets that company as before', () => {
    const { html, value } = render({ companies: [A], homeId: A.id }, { ui: <CompanySwitcher /> })
    expect(html).not.toContain('ut-cosel')
    expect(value.multi).toBe(false)
    expect(value.companyId).toBe(A.id)
  })
})

describe('the list (companySource)', () => {
  const api = (answers: Record<string, unknown>) => async <T,>(path: string): Promise<T> => {
    if (!(path in answers)) throw new Error(`unexpected ${path}`)
    return answers[path] as T
  }

  it('today: the company list, with the person’s own company as home', async () => {
    const qc = new QueryClient()
    const q = accessibleCompaniesQuery(true, qc, 'hrms-companies', api({
      '/v1/hrms/companies': [{ ...A, active: true }, { ...B, active: true }], '/v1/users/me': { id: 'u-1', companyId: B.id },
    }))
    await expect(q.queryFn()).resolves.toEqual({ companies: [A, B], homeId: B.id })
  })

  it('today, someone who is not workspace-wide (an employee, a manager): just their own company', async () => {
    const answers = { '/v1/hrms/companies': [{ ...A, active: true }, { ...B, active: true }], '/v1/users/me': { id: 'u-2', companyId: B.id } }
    await expect(accessibleCompaniesQuery(true, new QueryClient(), 'hrms-companies', api(answers), false).queryFn()).resolves.toEqual({ companies: [B], homeId: B.id })
    // …with no employee record of their own, every company (as the server's allCompanies).
    const noRecord = { ...answers, '/v1/users/me': { id: 'u-3', companyId: null } }
    await expect(accessibleCompaniesQuery(true, new QueryClient(), 'hrms-companies', api(noRecord), false).queryFn()).resolves.toEqual({ companies: [A, B], homeId: null })
    expect(isWorkspaceWide(['EMPLOYEE', 'DEPT_MANAGER'])).toBe(false)
    expect(isWorkspaceWide(['HR_MANAGER'])).toBe(true)
  })

  it('today, without the list permission: just the person’s own company', async () => {
    const q = accessibleCompaniesQuery(false, new QueryClient(), 'hrms-companies', api({ '/v1/users/me': { id: 'u-1', companyId: A.id, companyName: A.name } }))
    await expect(q.queryFn()).resolves.toEqual({ companies: [A], homeId: A.id })
  })

  it('next: GET /v1/me/companies (the contract’s shape), with the person’s roles and home company', async () => {
    const q = accessibleCompaniesQuery(true, new QueryClient(), 'me-companies', api({
      '/v1/me/companies': {
        homeCompanyId: B.id, allCompanies: false,
        companies: [
          { companyId: B.id, name: B.name, logoUrl: null, home: true, access: 'HOME', roles: [{ code: 'DEPT_MANAGER', name: 'Dept Manager', source: 'ROLES' }] },
          { companyId: A.id, name: A.name, logoUrl: null, home: false, access: 'GRANT', roles: [{ code: 'EMPLOYEE', name: 'Employee', source: 'GRANT' }] },
        ],
      },
    }))
    await expect(q.queryFn()).resolves.toEqual({ companies: [{ ...B, role: 'Dept Manager' }, { ...A, role: 'Employee' }], homeId: B.id })
  })

  it('no role line for workspace-wide people (same roles everywhere), and a home flag without homeCompanyId', () => {
    expect(readMeCompanies({ homeCompanyId: null, allCompanies: true, companies: [{ companyId: A.id, name: A.name, home: false, access: 'WORKSPACE', roles: [{ code: 'OWNER', name: 'Owner' }] }] }))
      .toEqual({ companies: [{ ...A, role: null }], homeId: null })
    expect(readMeCompanies({ companies: [{ companyId: A.id, name: A.name }, { companyId: B.id, name: B.name, home: true }] }).homeId).toBe(B.id)
  })

  it('knows the server’s “no access to this company” answer', () => {
    expect(isCompanyAccessDenied(new HttpError('You don’t have access to this company.', 403, { errorCode: 'COMPANY_ACCESS_DENIED' }))).toBe(true)
    expect(isCompanyAccessDenied(new HttpError('Forbidden', 403, { errorCode: 'ACCESS_DENIED' }))).toBe(false)
  })

  it('keeps the person, the company lists and workspace-wide data over a switch', () => {
    for (const k of [['user', 'me'], ['hrms', 'companies'], ['hrms', 'companies', 'accessible', 'list'], ['rbac', 'roles'], ['module-plans'], ['workspace', 'x'], ['employee', 'me']]) expect(isCompanyNeutral(k)).toBe(true)
    for (const k of [['hrms', 'leave', 'types', 'co-a'], ['hrms', 'employees', {}], ['attendance', 'x'], ['dashboard', 'summary'], ['shifts', 'employee'], ['master', 'contractors'], ['employees', 'me']]) expect(isCompanyNeutral(k)).toBe(false)
  })

  it('resolves chosen → home → first', () => {
    expect(resolveCompany([A, B], B.id, A.id)).toBe(B.id)
    expect(resolveCompany([A, B], null, B.id)).toBe(B.id)
    expect(resolveCompany([A, B], null, null)).toBe(A.id)
    expect(resolveCompany([], A.id, A.id)).toBe('')
  })
})

describe('outside the provider (a page rendered on its own)', () => {
  it('is the first company, as pages used to take it', () => {
    const qc = new QueryClient()
    qc.setQueryData(['hrms', 'companies'], [{ ...A, active: true }, { ...B, active: true }])
    let seen: CurrentCompanyValue | null = null
    function Probe() { seen = useCurrentCompany(); return null }
    renderToStaticMarkup(<QueryClientProvider client={qc}><Probe /></QueryClientProvider>)
    expect(seen!.companyId).toBe(A.id)
    expect(seen!.multi).toBe(true)
  })
})
