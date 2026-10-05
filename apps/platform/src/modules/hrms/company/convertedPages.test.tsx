// Pages moved onto the current company (CurrentCompany.tsx): with two or more companies they load the
// company the top bar's selector is on (not the first one) and draw no company picker of their own; with
// one company they are as before. Rendered as markup (the repo has no DOM test environment).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

const auth = vi.hoisted(() => ({ state: { status: 'authenticated', user: { id: 'u-1', roles: ['OWNER'] }, tenant: { id: 't-1' }, modules: [] } as Record<string, unknown> }))
vi.mock('@unifiedtree/sdk', async (importOriginal) => {
  const real = await importOriginal<typeof import('@unifiedtree/sdk')>()
  const useAuthStore = Object.assign((sel: (s: Record<string, unknown>) => unknown) => sel(auth.state), { getState: () => auth.state })
  return { ...real, useAuthStore, useAnyPermission: () => true, usePermission: () => true }
})
vi.mock('@/shared/navigation/useAccess', () => ({ useAccessContext: () => ({ modules: ['hrms'] }) }))

// What each page asked the API layer for.
const asked = vi.hoisted(() => ({ balances: [] as unknown[], usage: [] as unknown[], integrations: [] as unknown[] }))
vi.mock('../api/useLeave', () => ({
  useAllLeaveBalances: (f: { companyId?: string }) => { asked.balances.push(f.companyId); return { data: { content: [], totalElements: 0 }, isLoading: false, error: null } },
  useLeaveUsage: (f: { companyId?: string }) => { asked.usage.push(f.companyId); return { data: [], isLoading: false, error: null } },
}))
vi.mock('../api/useIntegration', () => ({
  useIntegrationConnections: (companyId?: string) => { asked.integrations.push(companyId); return { data: { content: [], totalElements: 0, totalPages: 1 }, isLoading: false, error: null, refetch: () => {} } },
  useCreateConnection: () => ({ mutateAsync: async () => ({}), isPending: false }),
  useToggleConnection: () => ({ mutateAsync: async () => ({}), isPending: false }),
  useDeleteConnection: () => ({ mutateAsync: async () => ({}), isPending: false }),
}))

import { CurrentCompanyProvider } from './CurrentCompany'
import { accessibleCompaniesQuery } from './companySource'
import { AllBalances } from '../leave/AllBalances'
import { Integrations } from '../Integrations'
import { useReportCompany } from '../reports/useReportCompany'
import { CompanyFilter } from '../reports/ReportKit'

const A = { id: 'co-a', name: 'Acme Labs' }
const B = { id: 'co-b', name: 'Beta Works' }

beforeEach(() => {
  asked.balances = []; asked.usage = []; asked.integrations = []
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} })
})

/** `ui` under the app's providers with the company list loaded; the person's home company is B. */
function render(companies: { id: string; name: string }[], ui: ReactNode, url = '/hrms/leave') {
  const qc = new QueryClient()
  qc.setQueryData(accessibleCompaniesQuery(true, qc).queryKey, { companies, homeId: companies.some((c) => c.id === B.id) ? B.id : null })
  qc.setQueryData(['hrms', 'companies'], companies.map((c) => ({ ...c, active: true })))
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[url]}><CurrentCompanyProvider>{ui}</CurrentCompanyProvider></MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('Leave › All balances', () => {
  it('two companies: the current company’s balances, not the first company’s', () => {
    render([A, B], <AllBalances />)
    expect(asked.balances.at(-1)).toBe(B.id)
    expect(asked.usage.at(-1)).toBe(B.id)
  })

  it('a link to company A (?co=) shows A', () => {
    render([A, B], <AllBalances />, '/hrms/leave?view=all-balances&co=co-a')
    expect(asked.balances.at(-1)).toBe(A.id)
  })

  it('one company: that company, as before', () => {
    render([A], <AllBalances />)
    expect(asked.balances.at(-1)).toBe(A.id)
  })
})

describe('HR setup › Integrations', () => {
  it('two companies: the current company’s services, and no company picker on the page', () => {
    const html = render([A, B], <Integrations />, '/hrms/integrations')
    expect(asked.integrations.at(-1)).toBe(B.id)
    expect(html).not.toContain('aria-label="Company"')
  })

  it('one company: that company, and no picker (as before)', () => {
    const html = render([A], <Integrations />, '/hrms/integrations')
    expect(asked.integrations.at(-1)).toBe(A.id)
    expect(html).not.toContain('aria-label="Company"')
  })
})

describe('Reports › company filter', () => {
  function Report() {
    const co = useReportCompany()
    return <div data-company={co.company} data-global={String(co.global)}><CompanyFilter co={co} /></div>
  }

  it('two companies: the report is on the current company and draws no dropdown of its own', () => {
    const html = render([A, B], <Report />, '/hrms/reports/headcount')
    expect(html).toContain('data-company="co-b"')
    expect(html).toContain('data-global="true"')
    expect(html).not.toContain('aria-label="Company"')
  })

  it('one company: its dropdown, on that company, as before', () => {
    const html = render([A], <Report />, '/hrms/reports/headcount')
    expect(html).toContain('data-company="co-a"')
    expect(html).toContain('data-global="false"')
    expect(html).toContain('aria-label="Company"')
  })
})
