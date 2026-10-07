// Calendar everywhere, server side (7 Oct 2026): the paged lists send the start / end calendar's ?from=&to= to the
// API, and send nothing without it (today's call). Rendered as markup (the repo has no DOM test environment): each
// page is rendered at a URL with and without a range; the box must be there, and the queries the page set up are
// run against a stub API to read the URLs they ask for.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider, type QueryKey } from '@tanstack/react-query'
import type { ReactElement } from 'react'

const auth = vi.hoisted(() => ({ state: { status: 'authenticated', user: { id: 'u-1', roles: ['OWNER'], permissions: [] }, tenant: { id: 't-1' }, modules: [] } as Record<string, unknown> }))
vi.mock('@unifiedtree/sdk', async (importOriginal) => {
  const real = await importOriginal<typeof import('@unifiedtree/sdk')>()
  const useAuthStore = Object.assign((sel: (s: Record<string, unknown>) => unknown) => sel(auth.state), { getState: () => auth.state })
  return { ...real, useAuthStore, useAnyPermission: () => true, usePermission: () => true, getAccessToken: () => '' }
})
vi.mock('@/shared/navigation/useAccess', () => ({ useAccessContext: () => ({ modules: ['hrms'] }) }))
vi.mock('@/shared/hooks/usePersonalPages', () => ({ usePersonalPages: () => true }))
const api = vi.hoisted(() => ({ calls: [] as string[] }))
vi.mock('@/core/api/client', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/core/api/client')>()
  return { ...real, apiJson: async (path: string) => { api.calls.push(path); return {} } }
})

import { rangeQs, rangeKey, setRangeParams, LIST_MAX_DAYS } from './listRange'
import { Leave } from '../../Leave'
import { EmployeeLeave } from '../../employees/workspace/EmployeeLeave'
import { Expense } from '../../Expense'
import { FullAndFinal } from '../../FullAndFinal'
import { ExitCenter } from '../../exit/ExitCenter'
import { OffersTab } from '../../hiring/OffersTab'
import { RequisitionsTab } from '../../hiring/RequisitionsTab'
import { GeneratedLettersList } from '../../letters/GeneratedLetters'
import { DistributionsList } from '../../letters/Distributions'
import { EmployeeDocuments } from '../../employees/workspace/EmployeeDocuments'
import { RequestsView } from '../../attendance/shifts/RequestsView'
import { ManualEntry } from '../../attendance/ManualEntry'
import { PayrollContainer } from '../../payroll/PayrollContainer'
import { useEmployeeDocuments } from '../useDocument'
import { CurrentCompanyProvider } from '../../company/CurrentCompany'

const R = 'from=2026-10-01&to=2026-10-07'
const BOX = '01/10/2026 – 07/10/2026'

beforeEach(() => {
  api.calls = []
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} })
})
afterEach(() => { vi.unstubAllGlobals() })

/** Renders `el` at `url`; returns the markup and the query client holding the queries the page set up. */
function render(el: ReactElement, url: string, seed?: (qc: QueryClient) => void) {
  // useView (ModuleKit) reads the address bar itself.
  const q = url.includes('?') ? url.slice(url.indexOf('?')) : ''
  vi.stubGlobal('window', { location: { search: q, href: `http://demo.localhost${url}`, pathname: url.split('?')[0], hash: '' }, innerWidth: 1440, addEventListener: () => {}, removeEventListener: () => {}, matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }) })
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  seed?.(qc)
  const html = renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[url]}><CurrentCompanyProvider>{el}</CurrentCompanyProvider></MemoryRouter>
    </QueryClientProvider>,
  )
  return { html, qc }
}

/** Runs every query under `prefix` the page set up and returns the URLs they asked the API for. */
async function urls(qc: QueryClient, prefix: QueryKey): Promise<string[]> {
  api.calls = []
  for (const q of qc.getQueryCache().findAll({ queryKey: prefix })) {
    const fn = q.options.queryFn as ((ctx: unknown) => Promise<unknown>) | undefined
    if (typeof fn === 'function') await fn({ queryKey: q.queryKey, signal: new AbortController().signal, meta: undefined, client: qc })
  }
  return api.calls
}

/** The page with a range: the box shows it and every list call carries it; without: no box text, no dates sent. */
async function wired(make: () => ReactElement, path: string, prefix: QueryKey, endpoint: string, filterKey: string, plain = '', seed?: (qc: QueryClient) => void) {
  const on = render(make(), `${path}${path.includes('?') ? '&' : '?'}${R}`, seed)
  expect(on.html).toContain(`data-filter="${filterKey}"`)
  expect(on.html).toContain(BOX)
  const withRange = (await urls(on.qc, prefix)).filter((u) => u.startsWith(endpoint))
  expect(withRange.length).toBeGreaterThan(0)
  for (const u of withRange) expect(u).toContain(R)
  const off = render(make(), path, seed)
  expect(off.html).toContain(`data-filter="${filterKey}"`)
  if (plain) expect(off.html).toContain(plain)
  const without = (await urls(off.qc, prefix)).filter((u) => u.startsWith(endpoint))
  expect(without.length).toBeGreaterThan(0)
  for (const u of without) expect(u).not.toContain('from=')
  return { on, off }
}

describe('the query helpers', () => {
  it('send both ends, or nothing', () => {
    expect(rangeQs({ from: '2026-10-01', to: '2026-10-07' })).toBe(`&${R}`)
    expect(rangeQs(null)).toBe('')
    expect(rangeQs(undefined)).toBe('')
    expect(setRangeParams(new URLSearchParams('page=0'), { from: '2026-10-01', to: '2026-10-07' }).toString()).toBe(`page=0&${R}`)
    expect(setRangeParams(new URLSearchParams('page=0'), null).toString()).toBe('page=0')
    expect(rangeKey({ from: '2026-10-01', to: '2026-10-07' })).toBe('2026-10-01..2026-10-07')
    expect(rangeKey(null)).toBe('all')
    expect(LIST_MAX_DAYS).toBe(366)
  })
})

describe('each paged list sends the range to the server', () => {
  it('Leave · My leave', async () => {
    await wired(() => <Leave />, '/hrms/leave?tab=my', ['hrms', 'leave', 'my'], '/v1/leave/my', 'my-leave-dates')
  })
  it('Leave · Decided (the list and its counts)', async () => {
    await wired(() => <Leave />, '/hrms/leave?tab=history', ['hrms', 'leave', 'approvals', 'history'], '/v1/leave/approvals/history', 'decided-leave-dates')
  })
  it('Employee workspace · Leave requests', async () => {
    await wired(() => <EmployeeLeave employeeId="e-1" firstName="Asha" />, '/hrms/employees/e-1?tab=leave', ['hrms', 'leave', 'employee', 'e-1', 'requests'], '/v1/leave/employees/e-1/requests', 'employee-leave-dates')
  })
  it('Expenses · My claims', async () => {
    await wired(() => <Expense />, '/hrms/expenses?tab=my', ['hrms', 'expense', 'my'], '/v1/expense/my', 'my-claim-dates')
  })
  it('Expenses · Approvals', async () => {
    await wired(() => <Expense />, '/hrms/expenses?tab=approvals', ['hrms', 'expense', 'approvals'], '/v1/expense/claims/approvals', 'claim-approval-dates')
  })
  it('Advances & loans (admin)', async () => {
    // The list is drawn once loaded (one advance in the cache, under the key with and without the dates).
    const one = { content: [{ id: 'a-1', employeeId: 'e-1', employeeName: 'Asha Rao', employeeCode: 'E1', reason: 'Medical', amount: 1000, monthlyDeduction: 500, repaymentMonths: 2, outstandingAmount: 1000, status: 'REQUESTED' }], page: 0, size: 100, totalElements: 1, totalPages: 1, last: true }
    const seed = (qc: QueryClient) => {
      qc.setQueryData(['hrms', 'advance', 'company', 0, undefined, 100], one)
      qc.setQueryData(['hrms', 'advance', 'company', 0, undefined, 100, '2026-10-01..2026-10-07'], one)
    }
    await wired(() => <PayrollContainer />, '/hrms/advances', ['hrms', 'advance', 'company', 0, undefined, 100], '/v1/advance/requests?page=0&size=100', 'advance-dates', '', seed)
  })
  it('Full & final settlements', async () => {
    await wired(() => <FullAndFinal />, '/hrms/fnf', ['hrms', 'fnf', 'settlements'], '/v1/fnf/settlements', 'fnf-dates')
  })
  it('Resignation & exit', async () => {
    await wired(() => <ExitCenter />, '/hrms/exit?tab=exited', ['hrms', 'employees', 'exits'], '/v1/hrms/employees/exits', 'exit-dates')
  })
  it('Hiring · Offers', async () => {
    await wired(() => <OffersTab creating={false} onCreateDone={() => {}} />, '/hrms/hiring?tab=offers', ['hrms', 'hiring', 'offers'], '/v1/hiring/offers', 'offer-dates')
  })
  it('Hiring · Requisitions', async () => {
    await wired(() => <RequisitionsTab creating={false} onCreateDone={() => {}} />, '/hrms/hiring?tab=requisitions', ['hrms', 'hiring', 'requisitions'], '/v1/hiring/requisitions', 'requisition-dates')
  })
  it('Letters · Generated', async () => {
    await wired(() => <GeneratedLettersList mine={false} />, '/hrms/letters/generated', ['hrms', 'letters', 'generated'], '/v1/letters/generated', 'letter-dates')
  })
  it('Letters · Distributions', async () => {
    await wired(() => <DistributionsList />, '/hrms/letters/distributions', ['hrms', 'letters', 'distributions', 'list'], '/v1/letters/distributions', 'distribution-dates')
  })
  it('Employee workspace · Documents', async () => {
    await wired(() => <EmployeeDocuments employeeId="e-1" />, '/hrms/employees/e-1?tab=documents', ['hrms', 'document', 'employee', 'e-1'], '/v1/document/employee/e-1', 'employee-document-dates')
  })
  it('Shift requests · Already decided (own keys, last 30 days without them)', async () => {
    const on = render(<RequestsView canApprove shifts={[]} />, '/hrms/shifts?tab=requests&decidedFrom=2026-10-01&decidedTo=2026-10-07')
    expect(on.html).toContain('data-filter="decided-shift-dates"')
    expect(on.html).toContain(BOX)
    expect(await urls(on.qc, ['shifts', 'requests', 'decided'])).toEqual([`/v1/shifts/change-requests/decided?days=30&${R}`])
    // The Overtime tab's ?from=&to= are not this list's.
    const other = render(<RequestsView canApprove shifts={[]} />, `/hrms/shifts?tab=requests&${R}`)
    expect(other.html).toContain('Last 30 days')
    expect(await urls(other.qc, ['shifts', 'requests', 'decided'])).toEqual(['/v1/shifts/change-requests/decided?days=30'])
  })
  it('Manual entry · Recent manual entries (the server already took from / to)', async () => {
    const { off } = await wired(() => <ManualEntry />, '/hrms/attendance/manual-entry', ['hrms', 'attendance', 'manual-entries', 'recent'], '/v1/attendance/manual-entries', 'manual-entry-dates', 'Last 30 days')
    expect(await urls(off.qc, ['hrms', 'attendance', 'manual-entries', 'recent'])).toEqual(['/v1/attendance/manual-entries?limit=20'])
  })
})

describe('a range the server would refuse never leaves the page', () => {
  it('a link longer than 366 days is ignored (the list as before)', async () => {
    const { html, qc } = render(<FullAndFinal />, '/hrms/fnf?from=2025-01-01&to=2026-10-07')
    expect(html).not.toContain('01/01/2025')
    for (const u of await urls(qc, ['hrms', 'fnf', 'settlements'])) expect(u).not.toContain('from=')
  })
  it('a backwards link is ignored', async () => {
    const { qc } = render(<DistributionsList />, '/hrms/letters/distributions?from=2026-10-07&to=2026-10-01')
    for (const u of await urls(qc, ['hrms', 'letters', 'distributions', 'list'])) expect(u).not.toContain('from=')
  })
})

describe('the Document Vault file uses the same hook', () => {
  it('one person\'s documents, with and without dates', async () => {
    function Probe({ range }: { range: { from: string; to: string } | null }) { useEmployeeDocuments('e-2', 0, true, 20, range); return null }
    const on = render(<Probe range={{ from: '2026-10-01', to: '2026-10-07' }} />, '/hrms/documents')
    expect(await urls(on.qc, ['hrms', 'document', 'employee', 'e-2'])).toEqual([`/v1/document/employee/e-2?page=0&size=20&${R}`])
    const off = render(<Probe range={null} />, '/hrms/documents')
    expect(await urls(off.qc, ['hrms', 'document', 'employee', 'e-2'])).toEqual(['/v1/document/employee/e-2?page=0&size=20'])
  })
})
